"""Read complex files as plain text with the Python standard library only (no downloads).

Formats: zip / tar / tar.gz / .gz archives (list members, read one member, also nested), Office Open XML
(.docx paragraphs with headings, tables, comments and tracked changes; .xlsx sheets as TSV; .pptx slide text),
OpenDocument (.odt/.ods/.odp), Jupyter notebooks (.ipynb cells and text outputs), CSV/TSV (header, row count,
first rows), JSON (structure summary and head), HTML/XML (text), RTF (text) and plain text. PDF uses PyMuPDF if it
is importable or the `pdftotext` command if present, and otherwise says so instead of installing anything.

Output is bounded: --max-chars (default 20000) and --offset page through long text. Nothing is written.

Usage: python read_any.py <file> [--member <path inside an archive>] [--list] [--max-chars N] [--offset N] [--rows N]
"""
import argparse
import csv
import gzip
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
MAX_MEMBER = 200_000_000


def name_of(path):
    return path.lower()


def docx_text(z):
    """Paragraphs in order (headings as #), tables as tab-separated rows, then comments; insertions/deletions marked."""
    root = ET.fromstring(z.read('word/document.xml'))
    out = []

    def para(p):
        style = p.find(f'{W}pPr/{W}pStyle')
        level = ''
        if style is not None:
            m = re.match(r'(?i)heading\s*(\d)', style.get(f'{W}val', ''))
            if m:
                level = '#' * int(m.group(1)) + ' '
        parts = []
        for node in p.iter():
            if node.tag == f'{W}t':
                parts.append(node.text or '')
            elif node.tag == f'{W}delText':
                parts.append(f'[-{node.text or ""}-]')
            elif node.tag in (f'{W}tab',):
                parts.append('\t')
            elif node.tag in (f'{W}br', f'{W}cr'):
                parts.append('\n')
        text = ''.join(parts)
        return (level + text) if text.strip() else ''

    body = root.find(f'{W}body')
    for el in (body if body is not None else []):
        if el.tag == f'{W}p':
            t = para(el)
            if t:
                out.append(t)
        elif el.tag == f'{W}tbl':
            for row in el.iter(f'{W}tr'):
                cells = [' '.join(filter(None, (para(p) for p in c.iter(f'{W}p')))) for c in row.iter(f'{W}tc')]
                out.append('\t'.join(cells))
            out.append('')
    if 'word/comments.xml' in z.namelist():
        croot = ET.fromstring(z.read('word/comments.xml'))
        comments = [f'- {c.get(f"{W}author", "?")}: ' + ' '.join(filter(None, (para(p) for p in c.iter(f'{W}p'))))
                    for c in croot.iter(f'{W}comment')]
        if comments:
            out += ['', '## Comments', *comments]
    return '\n'.join(out)


def xlsx_text(z, rows):
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(f'{S}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{S}t')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.iter(f'{S}sheet')]
    out = []
    sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    sheets.sort(key=lambda n: int(re.findall(r'\d+', n)[-1]))
    for i, sheet in enumerate(sheets):
        out.append(f'## Sheet: {names[i] if i < len(names) else sheet}')
        count = 0
        for r in ET.fromstring(z.read(sheet)).iter(f'{S}row'):
            count += 1
            if count > rows:
                continue
            cells = []
            for c in r.iter(f'{S}c'):
                v = c.find(f'{S}v')
                t = c.get('t')
                if t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(f'{S}t'))
                elif v is None:
                    val = ''
                elif t == 's':
                    val = shared[int(v.text)] if v.text and v.text.isdigit() and int(v.text) < len(shared) else ''
                else:
                    val = v.text or ''
                cells.append(val)
            out.append('\t'.join(cells))
        out.append(f'({count} rows{"; first " + str(rows) + " shown" if count > rows else ""})')
    return '\n'.join(out)


def pptx_text(z):
    slides = sorted((n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)), key=lambda n: int(re.findall(r'\d+', n)[-1]))
    out = []
    for n in slides:
        root = ET.fromstring(z.read(n))
        paras = [''.join(t.text or '' for t in p.iter(f'{A}t')) for p in root.iter(f'{A}p')]
        number = re.findall(r'\d+', n)[-1]
        out.append(f'## Slide {number}')
        out += [p for p in paras if p.strip()]
        notes = n.replace('slides/slide', 'notesSlides/notesSlide')
        if notes in z.namelist():
            nt = [''.join(t.text or '' for t in p.iter(f'{A}t')) for p in ET.fromstring(z.read(notes)).iter(f'{A}p')]
            nt = [x for x in nt if x.strip() and not x.strip().isdigit()]
            if nt:
                out.append('Notes: ' + ' '.join(nt))
    return '\n'.join(out)


def odf_text(z):
    root = ET.fromstring(z.read('content.xml'))
    out = []
    for el in root.iter():
        if el.tag.endswith('}h') or el.tag.endswith('}p'):
            t = ''.join(el.itertext()).strip()
            if t:
                out.append(('# ' if el.tag.endswith('}h') else '') + t)
    return '\n'.join(out)


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag in ('p', 'br', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_text(raw):
    p = _Text()
    p.feed(raw)
    return re.sub(r'\n\s*\n+', '\n\n', ''.join(p.parts)).strip()


def rtf_text(raw):
    raw = re.sub(r'\\par[d]?', '\n', raw)
    raw = re.sub(r"\\'[0-9a-f]{2}", '', raw)
    raw = re.sub(r'\\[a-z]+-?\d* ?', '', raw)
    return re.sub(r'[{}]', '', raw)


def ipynb_text(raw):
    nb = json.loads(raw)
    out = []
    for i, c in enumerate(nb.get('cells', []), 1):
        src = ''.join(c.get('source', []))
        out.append(f'## Cell {i} ({c.get("cell_type")})\n{src}')
        for o in c.get('outputs', []):
            text = o.get('text') or (o.get('data') or {}).get('text/plain')
            if text:
                out.append('Output:\n' + ''.join(text)[:2000])
    return '\n'.join(out)


def table_text(raw, delim, rows):
    reader = csv.reader(io.StringIO(raw), delimiter=delim)
    out, n = [], 0
    for r in reader:
        n += 1
        if n <= rows + 1:
            out.append('\t'.join(r))
    return '\n'.join(out) + f'\n({n - 1} data rows{"; first " + str(rows) + " shown" if n - 1 > rows else ""})'


def json_text(raw):
    data = json.loads(raw)

    def shape(x, depth=0):
        if depth > 3:
            return '…'
        if isinstance(x, dict):
            return '{' + ', '.join(f'{k}: {shape(v, depth + 1)}' for k, v in list(x.items())[:20]) + (', …' if len(x) > 20 else '') + '}'
        if isinstance(x, list):
            return f'[{len(x)} × {shape(x[0], depth + 1)}]' if x else '[]'
        return type(x).__name__
    return 'Structure: ' + shape(data) + '\n\n' + json.dumps(data, ensure_ascii=False, indent=1)


def pdf_text(data, path_hint):
    try:
        import fitz  # PyMuPDF, if the environment already has it
        with fitz.open(stream=data, filetype='pdf') as doc:
            return '\n'.join(f'## Page {i + 1}\n' + page.get_text() for i, page in enumerate(doc))
    except ImportError:
        pass
    if shutil.which('pdftotext'):
        r = subprocess.run(['pdftotext', '-layout', '-', '-'], input=data, capture_output=True, timeout=120)
        if r.returncode == 0:
            return r.stdout.decode('utf-8', 'replace')
    return (f'[{path_hint}: PDF text needs PyMuPDF (already used by the import step: run this script with --with pymupdf==1.26.7) '
            'or the pdftotext command; neither is available here]')


def decode(data):
    for enc in ('utf-8', 'utf-16', 'latin-1'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', 'replace')


def read_bytes(data, name, args, depth=0):
    """Text of one file given its bytes; archives list members or recurse into --member."""
    n = name_of(name)
    if depth > 3:
        return '[archive nesting too deep]'
    if n.endswith(('.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.odt', '.ods', '.odp')):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if n.endswith(('.docx', '.docm')):
                return docx_text(z)
            if n.endswith(('.xlsx', '.xlsm')):
                return xlsx_text(z, args.rows)
            if n.endswith('.pptx'):
                return pptx_text(z)
            return odf_text(z)
    if n.endswith(('.zip', '.jar')) or (zipfile.is_zipfile(io.BytesIO(data)) and not n.endswith(('.epub',))):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            if args.member and depth == 0:
                info = z.getinfo(args.member)
                if info.file_size > MAX_MEMBER:
                    return f'[{args.member}: {info.file_size} bytes, too large to read]'
                return read_bytes(z.read(info), info.filename, args, depth + 1)
            return f'Archive {name}: {len(infos)} files\n' + '\n'.join(f'{i.file_size:>12}  {i.filename}' for i in infos[:500])
    if n.endswith(('.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tar.xz')):
        with tarfile.open(fileobj=io.BytesIO(data)) as t:
            members = [m for m in t.getmembers() if m.isfile()]
            if args.member and depth == 0:
                m = t.getmember(args.member)
                if m.size > MAX_MEMBER:
                    return f'[{args.member}: {m.size} bytes, too large to read]'
                return read_bytes(t.extractfile(m).read(), m.name, args, depth + 1)
            return f'Archive {name}: {len(members)} files\n' + '\n'.join(f'{m.size:>12}  {m.name}' for m in members[:500])
    if n.endswith('.gz'):
        return read_bytes(gzip.decompress(data), name[:-3], args, depth + 1)
    if n.endswith('.pdf'):
        return pdf_text(data, name)
    raw = decode(data)
    if n.endswith('.ipynb'):
        return ipynb_text(raw)
    if n.endswith(('.csv', '.tsv')):
        return table_text(raw, '\t' if n.endswith('.tsv') else ',', args.rows)
    if n.endswith('.json'):
        return json_text(raw)
    if n.endswith(('.html', '.htm', '.xml', '.xhtml')):
        return html_text(raw)
    if n.endswith('.rtf'):
        return rtf_text(raw)
    if b'\x00' in data[:4096]:
        return f'[{name}: binary file of {len(data)} bytes; not a supported text or archive format]'
    return raw


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file')
    ap.add_argument('--member', help='path of a file inside a zip/tar archive')
    ap.add_argument('--list', action='store_true', help='for archives: list members (default when no --member)')
    ap.add_argument('--max-chars', type=int, default=20000)
    ap.add_argument('--offset', type=int, default=0)
    ap.add_argument('--rows', type=int, default=30, help='rows shown per table/sheet')
    args = ap.parse_args()
    with open(args.file, 'rb') as f:
        data = f.read()
    try:
        text = read_bytes(data, args.file, args)
    except (zipfile.BadZipFile, tarfile.TarError, KeyError, ET.ParseError, ValueError, OSError) as e:
        sys.exit(f'Cannot read {args.file}: {e}')
    chunk = text[args.offset:args.offset + args.max_chars]
    sys.stdout.write(chunk)
    rest = len(text) - args.offset - len(chunk)
    if rest > 0:
        sys.stdout.write(f'\n\n[… {rest} more characters; continue with --offset {args.offset + len(chunk)}]\n')


if __name__ == '__main__':
    main()
