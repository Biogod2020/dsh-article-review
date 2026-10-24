"""Normalize article content into a new DSH-readable project without editing sources."""
import argparse
from collections import Counter
from contextlib import redirect_stdout
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

MAX_SOURCE = 100 * 1024 * 1024
MAX_TEXT = 2_000_000
IMAGE = re.compile(r'!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["\'][^\n]*["\'])?\s*\)')
FIGURE_FILE = re.compile(r'(\*\*(?:Figure|Fig\.?)\s+[A-Za-z0-9]+\*\*\s*\(\s*`)([^`]+)(`\s*\))', re.I)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inside(root, path):
    path = Path(path).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError(f'Path escapes its source or workspace: {path}') from error
    return path


def read_text(path):
    data = path.read_bytes()
    if b'\x00' in data and not data.startswith((b'\xff\xfe', b'\xfe\xff')):
        raise ValueError('Input is binary, not readable article text')
    for encoding in (['utf-16'] if data.startswith((b'\xff\xfe', b'\xfe\xff')) else ['utf-8-sig', 'gb18030']):
        try:
            text = data.decode(encoding)
            if any(ord(c) < 9 or 13 < ord(c) < 32 for c in text):
                raise ValueError('Input contains binary control characters')
            return text
        except UnicodeDecodeError:
            pass
    raise ValueError('Could not decode article text; provide UTF-8 or UTF-16')


def prose_markdown(text):
    """Keep plain article notation visible instead of interpreting it as HTML/Markdown."""
    from html import escape
    text = re.sub(r'([\\`*_\[\]|#])', r'\\\1', escape(text, quote=False))
    text = re.sub(r'^(\s*)([-+])(?=\s|[-+])', r'\1\\\2', text, flags=re.M)
    return re.sub(r'^(\s*\d+)\.(?=\s)', r'\1\\.', text, flags=re.M)


def asset(project, source, suffix=None):
    suffix = suffix or source.suffix.lower()
    if suffix not in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.pdf'):
        raise ValueError(f'Unsupported image type: {suffix}')
    destination = project / 'figures' / (sha(source)[:20] + suffix)
    destination.parent.mkdir(exist_ok=True)
    if not destination.exists():
        shutil.copy2(source, destination)
    return destination.relative_to(project).as_posix()


def local_images(markdown, source_root, project, warnings):
    assets = []
    def replace(match):
        reference = match[2] or match[3]
        if re.match(r'^(?:https?:|data:|file:|//)', reference, re.I):
            warnings.append(f'External image retained as a reference, not downloaded: {reference[:160]}')
            return match[0]
        from urllib.parse import unquote
        path = inside(source_root, source_root / unquote(reference))
        if not path.is_file():
            warnings.append(f'Missing local image: {reference}')
            return match[0]
        copied = asset(project, path)
        assets.append({'file': copied, 'source': str(path), 'sha256': sha(path)})
        return f'![{match[1]}]({copied})'
    markdown = IMAGE.sub(replace, markdown)
    def figure_file(match):
        path = inside(source_root, source_root / match[2])
        if not path.is_file():
            warnings.append('Missing local figure: ' + match[2])
            return match[0]
        copied = asset(project, path)
        assets.append({'file': copied, 'source': str(path), 'sha256': sha(path)})
        return match[1] + copied + match[3]
    markdown = FIGURE_FILE.sub(figure_file, markdown)
    return markdown, list({item['file']: item for item in assets}.values())


def expand_tex(source, root, project, seen=None):
    seen = set() if seen is None else seen
    path = inside(root, source)
    if path in seen or len(seen) >= 64:
        raise ValueError('LaTeX includes form a cycle or exceed 64 source files')
    seen.add(path)
    text = read_text(path)
    relative = path.relative_to(root)
    copied = project / 'source' / relative
    copied.parent.mkdir(parents=True, exist_ok=True)
    if not copied.exists():
        shutil.copy2(path, copied)
    def include(match):
        included = path.parent / match[1]
        if not included.suffix:
            included = included.with_suffix('.tex')
        return expand_tex(included, root, project, seen.copy())
    text = re.sub(r'\\(?:input|include)\s*\{([^}]+)\}', include, text)
    # Resolve media to confined absolute paths before Pandoc; no TeX commands run.
    def image(match):
        target = inside(root, path.parent / match[2])
        if not target.suffix:
            target = next((target.with_suffix(s) for s in ('.pdf', '.png', '.jpg', '.svg') if target.with_suffix(s).is_file()), target)
        if not target.is_file():
            raise ValueError(f'Missing LaTeX figure: {match[2]}')
        copied_asset = asset(project, target)
        return '\\includegraphics' + (match[1] or '') + '{' + str(project / copied_asset) + '}'
    return re.sub(r'\\includegraphics(\[[^\]]*\])?\s*\{([^}]+)\}', image, text)


def pandoc(source, project, warnings):
    import pypandoc
    suffix = source.suffix.lower()
    source_format = {'.docx': 'docx', '.tex': 'latex', '.latex': 'latex', '.html': 'html', '.htm': 'html', '.rtf': 'rtf', '.odt': 'odt'}[suffix]
    executable = pypandoc.get_pandoc_path()
    if source_format == 'docx':
        import zipfile
        import xml.etree.ElementTree as ET
        with zipfile.ZipFile(source) as archive:
            for item in archive.infolist():
                if not item.filename.endswith('.rels'):
                    continue
                if item.file_size > 1_000_000:
                    raise ValueError('Document relationships exceed the import limit')
                for relationship in ET.fromstring(archive.read(item)):
                    if relationship.get('TargetMode') == 'External' and relationship.get('Type', '').endswith('/image'):
                        raise ValueError('DOCX links an external image; embed that image locally before importing')
    media = project / 'converted-media'
    args = [executable, '--sandbox', '--from', source_format, '--to', 'gfm-raw_html+tex_math_dollars', '--wrap=none', '--extract-media', str(media)]
    if source_format == 'latex':
        text = expand_tex(source, source.parent, project)
        # Inputs were expanded under a confined root. Pandoc never executes TeX.
        result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=90, cwd=project)
    elif source_format == 'html':
        # Never let HTML fetch remote media or read arbitrary local paths.
        text = read_text(source)
        from html import escape
        from html.parser import HTMLParser
        class ImageTag(HTMLParser):
            attributes = None
            def handle_starttag(self, tag, attrs):
                if tag.lower() == 'img':
                    self.attributes = dict(attrs)
        def image(match):
            tag = ImageTag()
            tag.feed(match[0])
            attrs = tag.attributes or {}
            ref, alt = attrs.get('src') or '', attrs.get('alt') or ''
            if not ref:
                return ''
            if re.match(r'^(?:https?:|data:|file:|//)', ref, re.I):
                warnings.append('External image not downloaded: ' + ref[:160])
                return '<span>' + escape(alt) + '</span>'
            target = inside(source.parent, source.parent / ref)
            copied = asset(project, target)
            return '<img src="' + escape(str(project / copied), quote=True) + '" alt="' + escape(alt, quote=True) + '" />'
        text = re.sub(r'<img\b[^>]*>', image, text, flags=re.I)
        result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=90, cwd=project)
    else:
        result = subprocess.run(args + [str(source)], text=True, capture_output=True, timeout=90, cwd=source.parent)
    if result.returncode:
        raise ValueError('Document conversion failed: ' + result.stderr[-2000:])
    if result.stderr.strip():
        warnings.append(result.stderr.strip()[:2000])
    text = result.stdout
    assets = []
    # Pandoc emits absolute paths for extracted media; retain and rewrite only
    # paths it actually placed under this owned import directory.
    def replace(match):
        ref = match[2] or match[3]
        if re.match(r'^https?://', ref, re.I):
            warnings.append('External image not downloaded: ' + ref[:160])
            return match[0]
        path = Path(ref)
        path = inside(project, path if path.is_absolute() else project / path)
        if not path.is_file():
            warnings.append('Converted image is missing: ' + ref)
            return match[0]
        copied = asset(project, path)
        assets.append({'file': copied, 'source': str(source), 'sha256': sha(path)})
        return f'![{match[1]}]({copied})'
    text = IMAGE.sub(replace, text)
    if media.exists():
        shutil.rmtree(media)
    return text, assets


def pdf(source, project, warnings):
    import pymupdf
    document = pymupdf.open(source)
    if document.needs_pass:
        raise ValueError('PDF is encrypted; supply an unlocked copy')
    if len(document) > 1000:
        raise ValueError('PDF exceeds the 1000-page import limit')
    pages = [page.get_text('dict', sort=True) for page in document]
    sizes = Counter(round(span['size'], 1) for page in pages for block in page['blocks'] if block['type'] == 0
                    for line in block['lines'] for span in line['spans'] if span['text'].strip())
    base = sizes.most_common(1)[0][0] if sizes else 10
    parts, mapping, figures = [], [], []
    for number, (page, data) in enumerate(zip(document, pages), 1):
        page_parts, positioned = [], []
        drawings = page.get_drawings()
        detected_tables = []
        if drawings:
            try:
                detected_tables = page.find_tables().tables
            except Exception:
                warnings.append(f'Could not classify table geometry on page {number}')
        tables = [pymupdf.Rect(table.bbox) for table in detected_tables]
        for table in detected_tables:
            # Extract inside each geometric cell. PyMuPDF's character-based
            # table.extract can reorder punctuation in scientific numbers.
            rows = [[' '.join(page.get_textbox(cell).split()).replace('\\', '\\\\').replace('|', '\\|') if cell else ''
                     for cell in row.cells] for row in table.rows]
            if rows and len(rows[0]) >= 2:
                markdown = ['| ' + ' | '.join(rows[0]) + ' |', '| ' + ' | '.join(['---'] * len(rows[0])) + ' |']
                markdown.extend('| ' + ' | '.join(row) + ' |' for row in rows[1:])
                positioned.append((table.bbox[1], table.bbox[0], '\n'.join(markdown)))
                mapping.append({'page': number, 'bbox': list(table.bbox), 'kind': 'table', 'cells': rows})
        for block in data['blocks']:
            if block['type'] != 0:
                continue
            lines = [''.join(span['text'] for span in line['spans']).strip() for line in block['lines']]
            lines = [line for line in lines if line]
            if not lines:
                continue
            text = ''
            for line in lines:
                text += ('' if not text or text.endswith(('-', '\u00ad')) else ' ') + line
            # Remove page numbers and repeated running footer metadata, never
            # prose. Their exact text remains in the provenance map.
            footer = block['bbox'][1] > page.rect.height * .93
            is_footer = footer and (text.isdigit() or ' | ' in text and len(text) < 160)
            mapping.append({'page': number, 'bbox': list(block['bbox']), 'text': text, 'excluded_footer': is_footer})
            if is_footer:
                continue
            rectangle = pymupdf.Rect(block['bbox'])
            if any((rectangle & table).get_area() >= rectangle.get_area() * .5 for table in tables):
                continue
            maximum = max(span['size'] for line in block['lines'] for span in line['spans'])
            if maximum >= base + 1 and len(text) < 300:
                text = ('# ' if maximum >= base + 4 else '## ') + text
            positioned.append((block['bbox'][1], block['bbox'][0], text))
        page_parts = [item[2] for item in sorted(positioned)]
        if not page_parts:
            warnings.append(f'Page {number} has no extractable text; OCR and visual verification are required')
        # Whole source pages are a lossless fallback for actual graphic content.
        # Table rules and thin page decorations do not create fake figures.
        image_area = sum(pymupdf.Rect(item['bbox']).get_area() for item in data['blocks'] if item['type'] == 1)
        visual = [item for item in drawings if item['rect'].width > 2 and item['rect'].height > 2
                  and not any((item['rect'] & table).get_area() >= item['rect'].get_area() * .8 for table in tables)]
        has_image = image_area > page.rect.get_area() * .015
        has_vector = len(visual) >= 12 and any(re.match(r'^(?:Fig(?:ure)?\.?\s+\w+)', text, re.I) for text in page_parts)
        if has_image or has_vector:
            destination = project / 'figures' / f'source-page-{number:04d}.png'
            destination.parent.mkdir(exist_ok=True)
            scale = min(2, 3600 / max(page.rect.width, page.rect.height))
            page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).save(destination)
            captions = [re.match(r'^(?:#+\s*)?(Figure\s+(?:S?\d+))\b', text, re.I) for text in page_parts]
            labels = list(dict.fromkeys(match[1] for match in captions if match))
            label = labels[0] if len(labels) == 1 else f'Source page {number} graphic'
            file = destination.relative_to(project).as_posix()
            page_parts.append(f'![{label}]({file})')
            figures.append({'file': file, 'page': number, 'kind': 'source-page-fallback', 'sha256': sha(destination), 'requires_visual_crop': True})
        if parts and page_parts:
            previous, following = parts[-1], page_parts[0]
            if previous.startswith('| ') and following.startswith('| ') and previous.splitlines()[:2] == following.splitlines()[:2]:
                parts[-1] += '\n' + '\n'.join(following.splitlines()[2:])
                page_parts.pop(0)
                mapping.append({'page': number, 'kind': 'continued-table-header-joined'})
            elif not previous.startswith(('#', '|', '![')) and re.match(r'^[a-z]', following) and not re.search(r'[.!?:;][\)\]"\u201d]*$', previous):
                parts[-1] += ('' if previous.endswith(('-', '\u00ad')) else ' ') + following
                page_parts.pop(0)
                mapping.append({'page': number, 'kind': 'page-boundary-paragraph-joined'})
        parts.extend(page_parts)
    document.close()
    text = '\n\n'.join(parts)
    if len(re.sub(r'\s', '', text)) < 30:
        raise ValueError('PDF contains no usable article text; OCR is required before import')
    if figures:
        warnings.append('PDF graphics retain complete source pages; inspect and crop their actual figure regions before claiming panel preparation complete')
    return text, figures, mapping


def normalize(workspace, source, destination=None):
    workspace = Path(workspace).resolve(strict=True)
    source = Path(source)
    source = (workspace / source if not source.is_absolute() else source).resolve(strict=True)
    if not source.is_file() or source.stat().st_size > MAX_SOURCE:
        raise ValueError('Source must be a regular file no larger than 100 MiB')
    identity = sha(source)
    stem = re.sub(r'[^a-z0-9-]+', '-', unicodedata.normalize('NFKD', source.stem).encode('ascii', 'ignore').decode().lower()).strip('-')[:60] or 'article'
    destination = inside(workspace, workspace / (destination or f'papers/{stem}-{identity[:10]}'))
    if destination == workspace or destination == source.parent:
        raise ValueError('Import requires its own new project directory')
    if destination.exists():
        previous = destination / 'import.json'
        if previous.is_file():
            saved = json.loads(previous.read_text())
            retained = [saved.get('source', {}), *saved.get('figures', [])]
            intact = all(item.get('file') and inside(destination, destination / item['file']).is_file()
                         and sha(destination / item['file']) == item.get('sha256') for item in retained)
            if intact and saved.get('source', {}).get('sha256') == identity and (destination / 'article.md').is_file() and sha(destination / 'article.md') == saved.get('manuscript_sha256'):
                return {**saved['result'], 'reused': True}
        raise ValueError('Destination already exists or was edited; choose a new output directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # An exclusive sibling lock prevents competing imports from publishing to
    # the same path, without ever replacing an existing user directory.
    lock = destination.parent / ('.' + destination.name + '.import-lock')
    lock.mkdir()
    temporary = None
    try:
        temporary = Path(tempfile.mkdtemp(prefix='.article-import-', dir=destination.parent))
        source_copy = temporary / 'source' / source.name
        source_copy.parent.mkdir()
        shutil.copy2(source, source_copy)
        warnings, mapping = [], []
        suffix = source.suffix.lower()
        if suffix == '.pdf':
            with redirect_stdout(sys.stderr):
                text, figures, mapping = pdf(source, temporary, warnings)
        elif suffix in ('.docx', '.tex', '.latex', '.html', '.htm', '.rtf', '.odt'):
            text, figures = pandoc(source, temporary, warnings)
        else:
            text = read_text(source)
            if not text.strip():
                raise ValueError('Article text is empty')
            # TXT and unfamiliar text extensions are prose, not Markdown media syntax.
            if suffix in ('.md', '.markdown', '.mdown'):
                text, figures = local_images(text, source.parent, temporary, warnings)
            else:
                figures = []
                text = prose_markdown(text)
        if not text.strip() or len(text.encode('utf-8')) > MAX_TEXT:
            raise ValueError('Converted article is empty or exceeds the 2 MB reader limit')
        # Absolute temporary paths must not leak into a moved project.
        if str(temporary) in text:
            raise ValueError('Conversion retained an unresolved temporary asset path')
        article = '<!-- Imported article. Source provenance is recorded in import.json; original files are preserved. -->\n\n' + text.strip() + '\n'
        (temporary / 'article.md').write_text(article, encoding='utf-8')
        manuscript = (destination / 'article.md').relative_to(workspace).as_posix()
        result = {'workspaceRoot': str(workspace), 'manuscript': manuscript, 'sourceHash': identity,
                  'figureCount': len(figures), 'textCharacters': len(text), 'warnings': warnings, 'reused': False,
                  'layoutRepairs': {'paragraphJoins': sum(item.get('kind') == 'page-boundary-paragraph-joined' for item in mapping),
                                    'continuedTables': sum(item.get('kind') == 'continued-table-header-joined' for item in mapping)}}
        record = {'version': 1, 'source': {'original': str(source), 'file': 'source/' + source.name,
                  'sha256': identity, 'bytes': source.stat().st_size}, 'manuscript_sha256': sha(temporary / 'article.md'),
                  'figures': figures, 'page_blocks': mapping, 'result': result}
        (temporary / 'import.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        assert sha(source) == identity and sha(source_copy) == identity, 'Source changed during import'
        # A competing importer cannot replace an existing destination.
        if destination.exists():
            raise ValueError('Destination was created concurrently; retry to reuse the completed import')
        os.rename(temporary, destination)
        return result
    except BaseException:
        if temporary:
            shutil.rmtree(temporary, ignore_errors=True)
        raise
    finally:
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', help='New workspace-relative project directory')
    args = parser.parse_args()
    try:
        print(json.dumps(normalize(args.workspace, args.source, args.output), ensure_ascii=False))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
