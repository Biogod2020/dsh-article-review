"""Find where the manuscript's numbers live in the repository, so the agent confirms sources instead of guessing.

Reads the numbers stated in the project's paragraphs (counts with thousands separators, decimals, percentages;
small integers, years and figure/table labels are skipped), then searches the repository's result tables (JSON,
CSV, TSV, Excel) and notes (Markdown/text) found by scan_repo.py. A file number matches a manuscript number when
it is equal after removing separators, or rounds to it at the manuscript's precision (0.79412 -> 0.794), or is
the same percentage written as a fraction (0.71 -> 71%). Result tables rank above notes. Writes
<project>/repo/number-matches.json: for each number its paragraphs, a quote, and up to five candidate files with
context; numbers found nowhere are listed too. Read only; standard library only.

Usage: python match_numbers.py <project-dir>
"""
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import read_any  # noqa: E402  (xlsx text without dependencies)

NUM = re.compile(r'(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)(\s?%)?(?![\w])')
LABELS = re.compile(r'\b(?:Fig(?:ure)?s?\.?|Table|Supplementary|Extended Data|ED)\s*S?\d+[A-Za-z]?\b|\[[\d,\s–-]+\]', re.I)
MAX_BYTES = 5_000_000


def manuscript_numbers(project):
    """value -> {paragraphs, quote}; one entry per distinct value as written."""
    out = {}
    for s in project.get('sections', []):
        for p in s.get('paragraphs', []):
            text = LABELS.sub(' ', p['text'])
            for m in NUM.finditer(text):
                raw = (m.group(1) + (m.group(2) or '')).replace(' ', '')
                bare = m.group(1).replace(',', '')
                if not m.group(2) and '.' not in bare and (int(bare) <= 20 or 1900 <= int(bare) <= 2100):
                    continue
                e = out.setdefault(raw, {'value': raw, 'paragraphs': [], 'quote': text[max(0, m.start() - 50):m.end() + 50].strip()})
                if p['id'] not in e['paragraphs']:
                    e['paragraphs'].append(p['id'])
    return out


def file_text(path):
    suffix = path.suffix.lower()
    if suffix in ('.xlsx', '.xlsm', '.ods'):
        with zipfile.ZipFile(path) as z:
            return read_any.xlsx_text(z, 100000) if suffix != '.ods' else read_any.odf_text(z)
    text = path.read_text(encoding='utf-8', errors='replace')
    if suffix == '.json':
        try:  # readable context: no \u escapes, one key per line
            return json.dumps(json.loads(text), ensure_ascii=False, indent=1)
        except ValueError:
            pass
    return text


def file_numbers(text):
    """All numeric tokens in a file with their positions (separators removed)."""
    return [(m.group(0), m.start()) for m in re.finditer(r'-?\d[\d,]*\.?\d*(?:[eE]-?\d+)?', text)]


def matches(value, token, after=''):
    """Does a file token stand for the manuscript value? `after` is the text right after the token."""
    pct = value.endswith('%')
    if pct and not after.lstrip().startswith('%'):
        # a percentage matches only a percentage or a fraction, not the bare integer (71% is not "71 images")
        try:
            ft = float(token.replace(',', ''))
        except ValueError:
            return False
        decimals = len(value.rstrip('%').split('.')[1]) if '.' in value else 0
        return 0 < ft <= 1 and '.' in token and round(ft * 100, decimals) == float(value.rstrip('%').replace(',', ''))
    v = value.rstrip('%').replace(',', '')
    t = token.replace(',', '').rstrip('.')
    try:
        fv, ft = float(v), float(t)
    except ValueError:
        return False
    decimals = len(v.split('.')[1]) if '.' in v else 0
    if t == v or (decimals and round(ft, decimals) == fv and abs(ft) >= 10 ** -decimals):
        return True
    if pct:  # 71% written as 0.71 or 0.7134
        return round(ft * 100, decimals) == fv and 0 < ft <= 1
    return decimals == 0 and '.' not in t and ft == fv


def main():
    out = Path(sys.argv[1]).resolve()
    project = json.loads((out / 'project.json').read_text())
    init = json.loads((out / 'init.json').read_text())
    repo = Path(init['repo']['path'])
    ctx = json.loads((out / 'repo' / 'repo-context.json').read_text())
    sources = [('result', t['path']) for t in ctx.get('resultTables', [])]
    sources += [('result', t['path']) for t in ctx.get('officeAndArchives', []) if t['path'].lower().endswith(('.xlsx', '.xlsm', '.ods'))]
    manuscripts = {str(Path(k)) for k in init.get('inputs', {})}
    sources += [('note', d['path']) for d in ctx.get('docs', []) if str((repo / d['path']).resolve()) not in manuscripts]

    texts = []
    for kind, rel in sources:
        path = repo / rel
        try:
            if path.stat().st_size > MAX_BYTES:
                continue
            text = file_text(path)
        except (OSError, zipfile.BadZipFile, KeyError, ValueError):
            continue
        texts.append((kind, rel, text, file_numbers(text)))

    found, missing = [], []
    for value, e in manuscript_numbers(project).items():
        cands = []
        for kind, rel, text, nums in texts:
            hit = next((pos for tok, pos in nums if matches(value, tok, text[pos + len(tok):pos + len(tok) + 2])), None)
            if hit is not None:
                line_start = text.rfind('\n', 0, hit) + 1
                line_end = text.find('\n', hit)
                context = text[max(line_start, hit - 80):(line_end if line_end > 0 else hit + 80)][:160].strip()
                cands.append({'file': rel, 'kind': kind, 'context': context})
        cands.sort(key=lambda c: c['kind'] != 'result')
        if cands:
            found.append({**e, 'candidates': cands[:5]})
        else:
            missing.append(e)
    result = {'repo': str(repo), 'filesSearched': len(texts), 'matched': found, 'notFound': missing}
    (out / 'repo' / 'number-matches.json').write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps({'numbers': len(found) + len(missing), 'matched': len(found),
                      'matchedInResultFiles': sum(1 for f in found if f['candidates'][0]['kind'] == 'result'),
                      'notFound': len(missing), 'filesSearched': len(texts)}))


if __name__ == '__main__':
    main()
