"""Start a paper project (project mode) from an existing manuscript, without touching the original files.

This script does not split the manuscript or extract its figures. The agent builds the project by reading the
manuscript and copying it into the project's format, and cuts figures and panels by looking at them. The script
only prepares what the agent reads from, inside a new project directory:

  <output>/project.json          empty project (title, materials, existing comments); the agent fills it in
  <output>/.review/              review state (revision 0) and its snapshot
  <output>/reading/pages/        PDF: every page as an image (pNNN.png), to read and to cut figures from
  <output>/reading/figures/      figure files (LaTeX figures, supplied files, images embedded in Word) as PNG
  <output>/reading/text/         the text layer or source text, to look up exact spelling and numbers, and for the
                                 check that nothing was dropped; never pasted into the project
  <output>/reading/outline.md    pages (or source files) in reading order, with their headings and figure captions
  <output>/assets/               empty: figure and panel crops go here (page_tools.py crop)
  <output>/materials/            copies of the supplied materials
  <output>/init.json             SHA-256 of every input, for check_project.py

Every input is only read; outputs go to a new directory that must not exist yet. On any error nothing is kept.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
MAX_PAGES = 150
PAGE_WIDTH = 1400   # px: small text stays legible when the agent views a page
FIGURE_WIDTH = 2000


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def inside(root: Path, path: Path) -> Path:
    path = path.resolve()
    if path != root and root not in path.parents:
        raise ValueError(f'{path} is outside the workspace')
    return path


def brace(text: str, at: int) -> tuple[str, int]:
    """The balanced {...} group starting at text[at] == '{'; returns (content, index after it)."""
    depth, i = 0, at
    while i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[at + 1:i], i + 1
        i += 1
    return text[at + 1:], len(text)


def tex_plain(s: str) -> str:
    """LaTeX fragment to readable text: keep command arguments, drop labels, citations and formatting commands."""
    s = re.sub(r'\\(?:label|vspace|hspace)\{[^}]*\}', '', s)
    s = re.sub(r'\\(?:ref|cref|Cref|autoref|eqref)\{[^}]*\}', '?', s)
    s = re.sub(r'\\cite[pt]?\*?(?:\[[^\]]*\])*\{[^}]*\}', '', s)
    for _ in range(4):
        s = re.sub(r'\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}', r'\1', s)
    s = re.sub(r'\\[a-zA-Z]+\*?', '', s).replace('~', ' ').replace('--', '–').replace('{', '').replace('}', '')
    return re.sub(r'\s+', ' ', s).strip()


def png_of(src: Path, dest: Path, width: int = FIGURE_WIDTH) -> Path:
    """A figure file as PNG for viewing: first page of a PDF rendered, other images converted (SVG/EPS cannot be)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower()
    if suffix == '.pdf':
        import pymupdf
        with pymupdf.open(src) as doc:
            r = doc[0].rect
            z = max(1.0, min(6.0, width / max(1.0, r.width)))
            doc[0].get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False).save(dest)
        return dest
    from PIL import Image
    with Image.open(src) as im:
        im.convert('RGB').save(dest)
    return dest


# ---- PDF ----------------------------------------------------------------------------------------------------------

CAPTION = re.compile(r'^\s*((?:Supplementary\s+|Extended\s+Data\s+)?(?:Fig(?:ure)?\.?|Table)\s*S?\d+[a-z]?)\s*[.:|]', re.I)


def read_pdf(source: Path, rd: Path) -> dict:
    """Page images, the text layer per page, and an outline (headings by font size, caption starts)."""
    import pymupdf
    pages, outline = [], []
    with pymupdf.open(source) as doc:
        if doc.needs_pass:
            raise ValueError('PDF is encrypted; supply an unlocked copy')
        if len(doc) > MAX_PAGES:
            raise ValueError(f'PDF has {len(doc)} pages; the limit is {MAX_PAGES} (split off the supplement first)')
        sizes: dict[float, int] = {}
        dicts = [pg.get_text('dict', sort=True) for pg in doc]
        for d in dicts:
            for b in d['blocks']:
                for l in b.get('lines', []):
                    for sp in l['spans']:
                        if sp['text'].strip():
                            sizes[round(sp['size'], 1)] = sizes.get(round(sp['size'], 1), 0) + len(sp['text'])
        body = max(sizes, key=sizes.get) if sizes else 10
        meta_title = (doc.metadata or {}).get('title', '').strip()
        for n, pg in enumerate(doc, 1):
            z = PAGE_WIDTH / pg.rect.width
            img = rd / 'pages' / f'p{n:03d}.png'
            img.parent.mkdir(parents=True, exist_ok=True)
            pg.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False).save(img)
            text = pg.get_text('text', sort=True)
            (rd / 'text').mkdir(parents=True, exist_ok=True)
            (rd / 'text' / f'p{n:03d}.txt').write_text(text, encoding='utf-8')
            heads, caps = [], []
            for b in dicts[n - 1]['blocks']:
                for l in b.get('lines', []):
                    t = ''.join(sp['text'] for sp in l['spans']).strip()
                    big = max((sp['size'] for sp in l['spans'] if sp['text'].strip()), default=0)
                    bold = any(sp['flags'] & 16 for sp in l['spans'] if sp['text'].strip())
                    if 3 <= len(t) <= 120 and (big >= body * 1.15 or (bold and big >= body and len(t) < 80 and not t.endswith('.'))):
                        heads.append(t)
                    if CAPTION.match(t):
                        caps.append(t[:110])
            pages.append({'page': n, 'image': img.relative_to(rd.parent).as_posix(), 'words': len(text.split())})
            outline.append(f'- p{n:03d} ({len(text.split())} words)' + (f' · headings: {" | ".join(heads[:6])}' if heads else '')
                           + (f' · captions: {" | ".join(caps[:6])}' if caps else ''))
    return {'kind': 'pdf', 'pdf': str(source), 'pages': pages, 'outline': outline, 'title': meta_title or pdf_title(dicts[0] if dicts else {})}


def pdf_title(page: dict) -> str:
    """The title on the first page: the lines set in its largest type at the top, joined, since a long title wraps."""
    lines = []
    for b in page.get('blocks', []):
        for l in b.get('lines', []):
            text = ''.join(sp['text'] for sp in l['spans']).strip()
            size = max((sp['size'] for sp in l['spans'] if sp['text'].strip()), default=0)
            if text:
                lines.append((size, text))
    if not lines:
        return ''
    top = max(size for size, _ in lines)
    start = next(i for i, (size, _) in enumerate(lines) if size >= top * 0.95)
    title = []
    for size, text in lines[start:]:
        if size < top * 0.95:
            break
        title.append(text)
    return ' '.join(title)[:300]


# ---- LaTeX --------------------------------------------------------------------------------------------------------

def tex_expand(path: Path, main_dir: Path, ws: Path, files: list[str], depth: int = 0) -> str:
    """The source with \\input/\\include inlined (TeX resolves them from the main file's folder), comments removed."""
    if depth > 8 or len(files) > 64:
        raise ValueError('LaTeX includes nest too deeply or exceed 64 files')
    path = inside(ws, path)
    files.append(path.relative_to(main_dir).as_posix() if main_dir in path.parents else str(path))
    text = re.sub(r'(?<!\\)%.*', '', path.read_text(encoding='utf-8', errors='replace'))
    def inc(m):
        for base in (main_dir, path.parent):
            cand = base / m.group(1)
            for c in (cand, cand.with_suffix('.tex')) if not cand.suffix else (cand,):
                if c.is_file():
                    return '\n' + tex_expand(c, main_dir, ws, files, depth + 1) + '\n'
        return m.group(0)
    return re.sub(r'\\(?:input|include)\s*\{([^}]+)\}', inc, text)


def tex_macros(tex: str) -> dict[str, str]:
    """Argument-free macros such as \\newcommand{\\ours}{HybridAgent}, so readers see the name the paper prints."""
    out = {}
    for m in re.finditer(r'\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z]+)\}?\s*\{', tex):
        body, _ = brace(tex, m.end() - 1)
        out[m.group(1)] = body
    for m in re.finditer(r'\\def\s*\\([a-zA-Z]+)\s*\{', tex):
        out[m.group(1)] = brace(tex, m.end() - 1)[0]
    return {k: tex_plain(v) for k, v in out.items() if '#' not in v and len(v) < 200}


def read_tex(source: Path, ws: Path, rd: Path) -> dict:
    files: list[str] = []
    main_dir = source.parent.resolve()
    tex = tex_expand(source, main_dir, ws, files)
    macros = tex_macros(tex)
    body = tex[tex.find('\\begin{document}'):] if '\\begin{document}' in tex else tex
    raw_body = body
    for name in sorted(macros, key=len, reverse=True):
        body = re.sub(r'\\' + name + r'(?![a-zA-Z])(?:\{\})?', lambda _m, v=macros[name]: v, body)
    outline, figures = [], []
    def figure(m):
        env = m.group(0)
        shown = []
        for g in re.finditer(r'\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}', env):
            ref = g.group(1)
            if '#' in ref:
                continue
            src = next((c for base in (main_dir,) for c in [base / ref, *[(base / ref).with_suffix(x) for x in ('.pdf', '.png', '.jpg', '.jpeg')]] if c.is_file()), None)
            if src:
                dest = rd / 'figures' / f'{len(figures) + 1:02d}_{src.stem}.png'
                try:
                    png_of(inside(ws, src), dest)
                    shown.append(dest.relative_to(rd.parent).as_posix())
                except (OSError, ValueError, RuntimeError):
                    shown.append(f'{ref} (could not render)')
        cm = re.search(r'\\caption\s*(?:\[[^\]]*\])?\s*\{', env)
        caption = tex_plain(brace(env, cm.end() - 1)[0]) if cm else ''
        figures.append({'env': m.group(1), 'images': shown, 'caption': caption})
        kind = 'table' if m.group(1).startswith('table') else 'figure'
        outline.append((m.start(), f'  - [{kind} env {len(figures)}] ' + (', '.join(shown) or 'no image file (a table or drawing: read its source)')
                        + (f' · caption: {caption[:110]}' if caption else '')))
        return '\n\n'
    fig_body = body
    body = re.sub(r'\\begin\{(figure\*?|table\*?|wrapfigure)\}.*?\\end\{\1\}', lambda m: figure(m) or '', body, flags=re.S)
    # math and bibliography carry no prose to compare against
    body = re.sub(r'\\begin\{(equation|align|gather|multline|eqnarray)\*?\}.*?\\end\{\1\*?\}', ' ', body, flags=re.S)
    body = re.sub(r'\$\$.*?\$\$|\\\[.*?\\\]', ' ', body, flags=re.S)
    body = re.sub(r'\\begin\{thebibliography\}.*?\\end\{thebibliography\}', ' ', body, flags=re.S)
    # headings are found in the text before figures are taken out, so both sort by their place in the source
    for m in re.finditer(r'\\(section|subsection|subsubsection)\*?\s*\{', fig_body):
        outline.append((m.start(), ('' if m.group(1) == 'section' else '  ') + f'- {m.group(1)}: {tex_plain(brace(fig_body, m.end() - 1)[0])}'))
    def heading(m):
        return f'\n\n# {tex_plain(brace(body, m.end() - 1)[0])}\n\n'
    parts, at = [], 0
    for m in re.finditer(r'\\(section|subsection|subsubsection|paragraph)\*?\s*\{', body):
        parts.append(body[at:m.start()])
        parts.append(heading(m))
        at = brace(body, m.end() - 1)[1]
    parts.append(body[at:])
    plain = '\n\n'.join(tex_plain(b) for b in re.split(r'\n\s*\n', ''.join(parts)) if tex_plain(b))
    (rd / 'text').mkdir(parents=True, exist_ok=True)
    (rd / 'text' / 'source.txt').write_text(plain, encoding='utf-8')
    m = re.search(r'\\title\s*(?:\[[^\]]*\])?\{', tex)
    title = brace(tex, m.end() - 1)[0] if m else ''
    for name in sorted(macros, key=len, reverse=True):
        title = re.sub(r'\\' + name + r'(?![a-zA-Z])(?:\{\})?', lambda _m, v=macros[name]: v, title)
    title = tex_plain(title)
    used = {k: v for k, v in macros.items() if re.fullmatch(r'[A-Za-z][\w\- ]{2,}', v) and re.search(r'\\' + k + r'(?![a-zA-Z])', raw_body)}
    head = [f'Source files in reading order (relative to {main_dir.name}/): ' + ', '.join(files),
            'Macros the text prints as words (write the word): ' + (', '.join(f'\\{k} = {v}' for k, v in list(used.items())[:40]) or 'none'), '']
    return {'kind': 'tex', 'title': title, 'files': files, 'figures': figures, 'outline': head + [line for _, line in sorted(outline, key=lambda x: x[0])]}


# ---- other formats ------------------------------------------------------------------------------------------------

def read_other(source: Path, rd: Path) -> dict:
    sys.path.insert(0, str(HERE))
    import read_any
    suffix = source.suffix.lower()
    media = []
    if suffix in ('.docx', '.odt'):
        with zipfile.ZipFile(source) as z:
            text = read_any.docx_text(z) if suffix == '.docx' else read_any.odf_text(z)
            for name in z.namelist():
                if re.match(r'^(word/media|Pictures)/', name) and Path(name).suffix.lower() in IMAGE:
                    dest = rd / 'figures' / f'{len(media) + 1:02d}_{Path(name).stem}.png'
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    from io import BytesIO
                    from PIL import Image
                    with Image.open(BytesIO(z.read(name))) as im:
                        im.convert('RGB').save(dest)
                    media.append(dest.relative_to(rd.parent).as_posix())
    else:
        raw = source.read_text(encoding='utf-8', errors='replace')
        text = read_any.html_text(raw) if suffix in ('.html', '.htm') else read_any.rtf_text(raw) if suffix == '.rtf' else raw
    (rd / 'text').mkdir(parents=True, exist_ok=True)
    (rd / 'text' / 'source.txt').write_text(text, encoding='utf-8')
    heads = [l.lstrip('#').strip() for l in text.splitlines() if l.startswith('#')]
    outline = [f'- heading: {h[:110]}' for h in heads[:200]] + [f'- embedded image: {m}' for m in media]
    return {'kind': suffix.lstrip('.'), 'figures': [{'images': [m], 'caption': ''} for m in media], 'outline': outline}


def read_notes(path: Path) -> list[dict]:
    """Existing comments: a JSON list of {text, author?, quote?} or a Markdown/plain list, one comment per item."""
    raw = path.read_text(encoding='utf-8')
    if path.suffix.lower() == '.json':
        data = json.loads(raw)
        items = data if isinstance(data, list) else data.get('comments', [])
        return [{'text': str(x.get('text') or x.get('comment') or ''), 'author': str(x.get('author') or 'author'),
                 'quote': str(x.get('quote') or '')} for x in items if (x.get('text') or x.get('comment'))]
    lines = [re.sub(r'^\s*(?:[-*+]|\d+[.)])\s+', '', l).strip() for l in raw.splitlines()]
    return [{'text': l, 'author': 'author', 'quote': ''} for l in lines if l]


def git_status(repo: Path, out: Path) -> list[str]:
    """git status --porcelain, without the new project directory (it may live inside the repository)."""
    import subprocess
    try:
        lines = subprocess.run(['git', '-C', str(repo), 'status', '--porcelain'], capture_output=True, text=True, timeout=120).stdout.splitlines()
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        inner = out.resolve().relative_to(repo).as_posix()
    except ValueError:
        inner = None
    def ours(line: str) -> bool:
        path = line[3:].strip('"').rstrip('/')
        return bool(inner) and (path.startswith(inner) or inner.startswith(path + '/'))
    return sorted(l for l in lines if not ours(l))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('workspace', type=Path)
    ap.add_argument('--source', type=Path, required=True, help='manuscript file (PDF, DOCX, ODT, .tex, .md, .txt, .html, .rtf)')
    ap.add_argument('--output', required=True, help='new workspace-relative project directory')
    ap.add_argument('--figures', type=Path, action='append', default=[], help='figure file or directory (repeatable)')
    ap.add_argument('--materials', type=Path, action='append', default=[], help='supporting file (repeatable)')
    ap.add_argument('--notes', type=Path, help='existing comments: JSON list or Markdown list')
    ap.add_argument('--repo', type=Path, help='research repository whose progress the project should reflect (read only)')
    ap.add_argument('--journal', default='')
    ap.add_argument('--audience', default='')
    args = ap.parse_args()

    ws = args.workspace.resolve(strict=True)
    out = inside(ws, ws / args.output)
    if out.exists():
        ap.exit(1, f'{args.output} already exists; choose a new output directory (nothing was changed)\n')
    resolve = lambda p: inside(ws, (ws / p if not p.is_absolute() else p).resolve(strict=True))
    source = resolve(args.source)
    fig_inputs: list[Path] = []
    for f in args.figures:
        f = resolve(f)
        fig_inputs += sorted(x for x in f.iterdir() if x.suffix.lower() in IMAGE | {'.pdf'}) if f.is_dir() else [f]
    materials = [resolve(m) for m in args.materials]
    notes = resolve(args.notes) if args.notes else None
    repo = resolve(args.repo) if args.repo else None
    repo_status_before = git_status(repo, out) if repo else []
    inputs = [source, *fig_inputs, *materials, *([notes] if notes else [])]
    before = {str(p): sha(p) for p in inputs}

    out.mkdir(parents=True)
    try:
        rd = out / 'reading'
        suffix = source.suffix.lower()
        if suffix == '.pdf':
            reading = read_pdf(source, rd)
        elif suffix in ('.tex', '.latex'):
            reading = read_tex(source, ws, rd)
        elif suffix in ('.docx', '.odt', '.md', '.markdown', '.txt', '.html', '.htm', '.rtf'):
            reading = read_other(source, rd)
        else:
            raise ValueError(f'Unsupported manuscript type: {suffix} (use PDF, DOCX, ODT, LaTeX, Markdown, TXT, HTML or RTF)')
        supplied = []
        for k, f in enumerate(fig_inputs, 1):
            try:
                supplied.append(png_of(f, rd / 'figures' / f'supplied_{k:02d}_{f.stem}.png').relative_to(out).as_posix())
            except (OSError, ValueError, RuntimeError) as e:
                supplied.append(f'{f.name} (could not render: {e})')
        reading['supplied'] = supplied
        lines = [f'# Reading outline: {source.name}', '',
                 'Read the manuscript from the page images (PDF) or the source files (LaTeX), in this order. reading/text/ holds the text',
                 'layer only to look up exact spelling and numbers; do not paste it into the project.', '', *reading['outline']]
        if supplied:
            lines += ['', '## Supplied figure files', *[f'- {s}' for s in supplied]]
        (rd / 'outline.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        (out / 'assets').mkdir()

        (out / 'materials').mkdir()
        shutil.copy2(source, out / 'materials' / source.name)
        mats = [{'id': 'm0', 'label': f'Manuscript ({source.name})', 'path': f'materials/{source.name}', 'note': 'copy of the original manuscript'}]
        for k, m in enumerate(materials, 1):
            dest = out / 'materials' / m.name
            shutil.copy2(m, dest)
            mats.append({'id': f'm{k}', 'label': m.name, 'path': dest.relative_to(out).as_posix(), 'note': ''})

        repo_summary = None
        if repo:
            # inventory of the repository's progress; the agent reads it, check_project.py re-checks the repo is untouched
            import subprocess
            r = subprocess.run([sys.executable, '-B', str(HERE / 'scan_repo.py'), str(repo), str(out / 'repo')], capture_output=True, text=True, timeout=900)
            if r.returncode != 0:
                raise ValueError(f'repository scan failed: {r.stderr[-400:]}')
            repo_summary = json.loads(r.stdout.strip().splitlines()[-1])
            mats.append({'id': 'repo', 'label': f'Repository progress ({repo.name})', 'path': 'repo/repo-context.md',
                         'note': f'read-only inventory of {repo}: plans, notes, result tables, figure scripts, git history, TODOs'})
        title = reading.get('title') or source.stem
        project = {'schemaVersion': 1, 'title': title, 'journal': args.journal, 'audience': args.audience, 'style': '',
                   'stage': 'draft', 'materials': mats, 'thesis': {'title': '', 'statement': ''}, 'beats': [], 'claims': [],
                   'figures': [], 'numbers': [], 'sections': [], 'links': [], 'numberIgnores': []}
        comments = []
        for k, c in enumerate(read_notes(notes) if notes else [], 1):
            comments.append({'id': f'n{k}', 'target': {'kind': 'project', 'id': '', 'quote': c['quote'][:2000]},
                             'source': 'author' if c['author'] in ('author', '作者') else 'collaborator', 'author': c['author'][:80],
                             'text': c['text'][:20000], 'status': 'open', 'createdAt': now(), 'stage': 'draft', 'assignee': ''})
        state = {'revision': 0, 'comments': comments, 'reviewed': {}, 'drafts': [], 'numberHints': {},
                 'history': [{'revision': 0, 'at': now(), 'actor': 'paper-project-init', 'reason': f'从 {source.name} 建立空项目，等待逐页抄录', 'comments': [], 'units': []}]}
        (out / '.review' / 'history').mkdir(parents=True)
        (out / 'project.json').write_text(json.dumps(project, ensure_ascii=False, indent=1))
        (out / '.review' / 'history' / 'r0.json').write_text(json.dumps(project, ensure_ascii=False, indent=1))
        (out / '.review' / 'state.json').write_text(json.dumps(state, ensure_ascii=False, indent=1))

        after = {p: sha(Path(p)) for p in before}
        if after != before:
            raise ValueError('An input changed while the project was being created')
        if repo and git_status(repo, out) != repo_status_before:
            raise ValueError('The repository changed while the project was being created')
        texts = sorted((rd / 'text').glob('*.txt')) if (rd / 'text').exists() else []
        (out / 'init.json').write_text(json.dumps({'version': 2, 'createdAt': now(), 'inputs': before, 'source': str(source),
            'reading': {'kind': reading['kind'], 'pdf': reading.get('pdf'), 'pages': len(reading.get('pages', [])),
                        'text': {t.relative_to(out).as_posix(): sha(t) for t in texts}, 'figures': reading.get('figures', []), 'supplied': supplied},
            'repo': {'path': str(repo), 'status': repo_status_before, 'figureInputs': [str(f) for f in fig_inputs]} if repo else None},
            ensure_ascii=False, indent=1))
        print(json.dumps({'project': out.relative_to(ws).as_posix(), 'kind': reading['kind'], 'title': title,
                          'pages': len(reading.get('pages', [])), 'figureImages': sum(len(f.get('images', [])) for f in reading.get('figures', [])) + len(supplied),
                          'outline': 'reading/outline.md', 'materials': len(mats), 'comments': len(comments), 'repo': repo_summary,
                          'next': 'read reading/outline.md, then read and copy the manuscript page by page (see the skill)'}, ensure_ascii=False))
    except BaseException as error:
        shutil.rmtree(out, ignore_errors=True)
        if isinstance(error, (ValueError, OSError, zipfile.BadZipFile)):
            ap.exit(1, f'{error}\n(nothing was kept; the original files were only read)\n')
        raise


if __name__ == '__main__':
    main()
