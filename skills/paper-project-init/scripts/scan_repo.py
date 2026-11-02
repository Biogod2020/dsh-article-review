"""Read-only inventory of a research repository, so a paper project starts from the project's real progress.

Collects, without modifying anything: git branch, recent commits and uncommitted changes; plans, notes and result
write-ups (Markdown/text); small result tables (JSON/CSV/TSV) whose names suggest results; figure files and the
scripts that write them; TODO/FIXME markers. Secrets (.env, keys, credential folders), dependency trees, caches and
large data are skipped. Writes <out>/repo-context.json and a readable <out>/repo-context.md (bounded size).

Usage: python scan_repo.py <repo> <out-dir> [--manuscript <file>] [--figures <dir>]...
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SKIP_DIRS = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ipynb_checkpoints', 'dist',
             'build', 'lib', '.cache', '.paper-tools', '.paper-review', '.review', 'site-packages', 'credentials', 'secrets', '.ssh'}
SECRET = re.compile(r'(^\.env|\.pem$|\.key$|id_rsa|id_ed25519|credential|secret|token|password)', re.I)
DOC = {'.md', '.markdown', '.txt', '.rst', '.org', '.tex'}
TABLE = {'.json', '.csv', '.tsv'}
FIG = {'.pdf', '.png', '.svg', '.jpg', '.jpeg', '.tif', '.tiff'}
CODE = {'.py', '.r', '.R', '.ipynb', '.jl', '.m', '.sh'}
# office files and archives: listed so the agent can open them with read_any.py
PACKED = {'.docx', '.xlsx', '.pptx', '.odt', '.ods', '.zip', '.gz', '.tgz', '.rtf'}
RESULTISH = re.compile(r'(result|summary|metric|stat|score|eval|benchmark|report|finding|table|count)', re.I)
PLANISH = re.compile(r'(plan|todo|roadmap|progress|status|notes?|changelog|readme|decision|story|outline|draft|results?)', re.I)
SAVES = re.compile(r'(savefig|ggsave|save_fig|write_image|\.save\(|to_file|pdf\(|png\(|\b(?:pdf|png|svg|out|output)\s*=|export|dev\.off)', re.I)
MARK = re.compile(r'\b(TODO|FIXME|XXX|TBD|HACK)\b[:\s]*(.{0,120})')
MAX_FILES, MAX_DOC_BYTES, MAX_TABLE_BYTES = 20000, 400_000, 2_000_000


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%d %H:%M')


def git(repo: Path, *args: str) -> str:
    try:
        return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, timeout=60).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''


def first_line(path: Path) -> str:
    try:
        for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
            line = line.strip().lstrip('#').strip()
            if line and not line.startswith('---'):
                return line[:160]
    except OSError:
        pass
    return ''


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('repo', type=Path)
    ap.add_argument('out', type=Path)
    ap.add_argument('--manuscript', type=Path)
    ap.add_argument('--figures', type=Path, action='append', default=[])
    a = ap.parse_args()
    repo = a.repo.resolve(strict=True)
    a.out.mkdir(parents=True, exist_ok=True)

    docs, tables, figs, scripts, markers, skipped = [], [], [], [], [], 0
    packed = []
    n = 0
    for root, dirs, files in os.walk(repo):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.') and not SECRET.search(d))
        for name in sorted(files):
            n += 1
            if n > MAX_FILES:
                break
            p = Path(root) / name
            rel = p.relative_to(repo).as_posix()
            if SECRET.search(name) or p.is_symlink():
                skipped += 1
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            ext = p.suffix if p.suffix in CODE else p.suffix.lower()
            item = {'path': rel, 'bytes': st.st_size, 'modified': iso(st.st_mtime)}
            if ext in DOC and st.st_size <= MAX_DOC_BYTES:
                item['title'] = first_line(p)
                item['kind'] = 'plan' if PLANISH.search(name) else 'note'
                docs.append(item)
                try:
                    for m in MARK.finditer(p.read_text(encoding='utf-8', errors='replace')):
                        if len(markers) < 200:
                            markers.append({'path': rel, 'mark': m.group(1), 'text': m.group(2).strip()})
                except OSError:
                    pass
            elif ext in PACKED and st.st_size <= 500_000_000:
                packed.append(item)
            elif ext in TABLE and st.st_size <= MAX_TABLE_BYTES and RESULTISH.search(rel):
                tables.append(item)
            elif ext in FIG and st.st_size <= 200_000_000:
                figs.append(item)
            elif ext in CODE and st.st_size <= 2_000_000:
                try:
                    text = p.read_text(encoding='utf-8', errors='replace')
                except OSError:
                    continue
                # a script that names figure files and has an output call is taken as one that draws them
                writes = sorted({m for m in re.findall(r'["\']([^"\'\s]+\.(?:pdf|png|svg|jpe?g|tiff?))["\']', text)})[:30]
                if writes and SAVES.search(text):
                    item['writes'] = writes
                    scripts.append(item)
                for m in MARK.finditer(text):
                    if len(markers) < 200:
                        markers.append({'path': rel, 'mark': m.group(1), 'text': m.group(2).strip()})

    ctx = {'version': 1, 'repo': str(repo), 'scannedAt': datetime.now(timezone.utc).isoformat(),
           'git': {'branch': git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'head': git(repo, 'log', '-1', '--format=%h %ad %s', '--date=short'),
                   'recent': git(repo, 'log', '-n', '30', '--format=%h %ad %s', '--date=short').splitlines(),
                   'uncommitted': git(repo, 'status', '--porcelain').splitlines()[:200]},
           'docs': sorted(docs, key=lambda d: d['modified'], reverse=True)[:400],
           'resultTables': sorted(tables, key=lambda d: d['modified'], reverse=True)[:400],
           'figureFiles': sorted(figs, key=lambda d: d['modified'], reverse=True)[:400],
           'figureScripts': sorted(scripts, key=lambda d: d['modified'], reverse=True)[:300],
           'officeAndArchives': sorted(packed, key=lambda d: d['modified'], reverse=True)[:200],
           'markers': markers, 'skippedSecretLike': skipped, 'filesSeen': min(n, MAX_FILES)}
    (a.out / 'repo-context.json').write_text(json.dumps(ctx, ensure_ascii=False, indent=1))

    md = [f'# Repository context: {repo.name}', '', f'Scanned {ctx["scannedAt"][:16]} · branch `{ctx["git"]["branch"]}` · head {ctx["git"]["head"]}',
          f'Uncommitted changes: {len(ctx["git"]["uncommitted"])}', '', '## Recent commits', *[f'- {c}' for c in ctx['git']['recent'][:20]], '',
          '## Plans and progress notes (newest first)', *[f'- `{d["path"]}` ({d["modified"]}) {d.get("title", "")}' for d in ctx['docs'] if d['kind'] == 'plan'][:60], '',
          '## Other notes', *[f'- `{d["path"]}` ({d["modified"]}) {d.get("title", "")}' for d in ctx['docs'] if d['kind'] == 'note'][:60], '',
          '## Result tables (newest first)', *[f'- `{d["path"]}` ({d["modified"]}, {d["bytes"]} B)' for d in ctx['resultTables'][:80]], '',
          '## Office files and archives (open with read_any.py)', *[f'- `{d["path"]}` ({d["modified"]}, {d["bytes"]} B)' for d in ctx['officeAndArchives'][:60]], '',
          '## Figure-writing scripts', *[f'- `{d["path"]}` ({d["modified"]}) writes {", ".join(d["writes"][:5])}' for d in ctx['figureScripts'][:60]], '',
          '## Open markers (TODO/FIXME)', *[f'- `{m["path"]}` {m["mark"]}: {m["text"]}' for m in markers[:60]]]
    text = '\n'.join(md)
    (a.out / 'repo-context.md').write_text(text[:80_000] + ('\n…(truncated)\n' if len(text) > 80_000 else '\n'))
    print(json.dumps({'docs': len(docs), 'officeAndArchives': len(packed), 'resultTables': len(tables), 'figureFiles': len(figs), 'figureScripts': len(scripts),
                      'markers': len(markers), 'uncommitted': len(ctx['git']['uncommitted']), 'skippedSecretLike': skipped}))


if __name__ == '__main__':
    main()
