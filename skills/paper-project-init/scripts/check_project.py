"""Check an initialised paper project and write init-report.md beside it.

Verifies, in this order: the original inputs are byte-identical to when init_project.py read them; project.json
has the fields project mode needs and every reference resolves (beats -> claims, paragraphs -> claims, evidence ->
figure panels). Then the transcription the agent made by reading the manuscript:
  - coverage: the manuscript's prose (text layer per PDF page, or the LaTeX/Word source text) must be in the
    project's paragraphs and captions; pages or passages left out are listed with their first words;
  - wording: a paragraph that does not match the manuscript's wording was paraphrased instead of copied;
  - format: the project shows plain text, so pasted extraction artifacts are errors - words broken at line ends,
    line breaks, ligatures, LaTeX or Markdown markup, running heads and page stamps, captions left in the body,
    paragraphs cut at a page or column break;
  - figures: every figure and panel image exists in assets/, is not blank, panels differ from the whole figure;
    every figure caption in the manuscript has a figure in the project.
Then lists what needs the author's attention (paragraphs linked to no claim, claims no paragraph states, figures
no evidence uses, claims without support) and, with --repo at init, checks the repository (figures older than
their scripts, registered numbers missing from their source file, newer results, TODOs, uncommitted changes).
Every problem becomes a finding with a severity and guidance, written to init-findings.json and to the report.
Exit status 1 when a hard check fails; the agent fixes the project and runs it again.

Usage: python check_project.py <workspace> <project-dir>     (pillow enables the image checks)
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def unsupported_ids(claims: dict) -> list:
    return [c['id'] for c in claims.values() if not any(e.get('kind') == 'support' for e in c.get('evidence', []))]


def norm(s: str) -> str:
    return re.sub(r'\s+', ' ', s).strip()


def finding(sev: str, title: str, detail: str, guidance: str, where: str = '') -> dict:
    return {'severity': sev, 'title': title, 'detail': detail, 'guidance': guidance, 'where': where}


def num_norm(s: str) -> str:
    return re.sub(r'[\s,]', '', s)


# ---- transcription ------------------------------------------------------------------------------------------------

def words(text: str) -> list[str]:
    """Comparable tokens: NFKC, lower case, letters and digits only; words broken at a line end are joined first."""
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'([A-Za-z])-\s*\n\s*([a-z])', r'\1\2', text)
    return re.findall(r'[a-z0-9]+', text.lower())


def prose_words(text: str) -> list[str]:
    """Words of three or more letters: the prose of a paragraph without its formula symbols, indices and numbers."""
    return [w for w in words(text) if len(w) >= 3 and w.isalpha()]


def shingles(tokens: list[str], n: int) -> set[tuple]:
    return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def prose_blocks(text: str) -> list[str]:
    """Runs of prose lines from a text layer; short lines (figure labels, table cells, headers) break a run."""
    blocks, cur = [], []
    for line in text.splitlines():
        if len(line.split()) >= 6:
            cur.append(line)
        elif cur:
            blocks.append('\n'.join(cur)); cur = []
    if cur:
        blocks.append('\n'.join(cur))
    return blocks


REFERENCE_LINE = re.compile(r'(et al\.|arXiv preprint|In Proceedings|Proceedings of|Conference on|Journal of|doi:|https?://|\(\d{4}\)|, \d{4}[a-z]?\.)')


def reference_pages(pages: list[str]) -> list[bool]:
    """Reference-list pages by position: after the "References" heading, before the appendix, mostly citations.
    Related-work pages are full of "et al." too, so citation density alone would excuse them. Same rule as the panel."""
    out = [False] * len(pages)
    start = next((i for i, t in enumerate(pages) if re.search(r'^\s*(References|Bibliography|Literature Cited|参考文献)\s*$', t, re.M)), -1)
    if start < 0:
        return out
    for i in range(start + 1, len(pages)):
        head = '\n'.join(pages[i].splitlines()[:12])
        if re.search(r'^\s*(Appendix|Appendices|Supplementary (Information|Material|Methods)|Table of Contents|A\.?\s+[A-Z][a-z])', head, re.M):
            break
        lines = [l for l in pages[i].splitlines() if l.strip()]
        out[i] = bool(lines) and sum(bool(REFERENCE_LINE.search(l)) for l in lines) / len(lines) > 0.25
    return out


def running_lines(pages: list[str]) -> set[str]:
    """Header/footer lines: the same short line on three or more pages."""
    count = Counter(l.strip() for t in pages for l in set(t.splitlines()) if 2 <= len(l.split()) <= 12)
    return {l for l, c in count.items() if c >= 3}


ARTIFACTS = [
    (re.compile(r'\n'), '段内有换行', '把段落写成一行连续文字'),
    (re.compile(r'[\ufb00-\ufb06\u00ad\u200b\u200c\u200d\ufffd]'), '有连字/软连字符/乱码字符（ﬁ、ﬂ、\\u00ad 等）', '换成普通字母'),
    # $…$ only when it holds TeX (a command, sub/superscript or braces): "$359 → $98" is money, not math
    (re.compile(r'\\[a-zA-Z]+|\$[^$\n]{0,80}[\\^_{}][^$\n]{0,80}\$|[_^]\{|(?<![\w])~\\?(?:ref|cite)'), '有 LaTeX 标记', '写成读者看到的文字：宏写成它打印出的词，公式用 Unicode 线性写法（α、≤、R² = 0.81），上下标用 Unicode（hₜ、eₜ₊₁、x²）或括号 h(t+1)，不用 _{…} / ^{…}'),
    (re.compile(r'\*\*|__|^#{1,6}\s|!\[|\]\('), '有 Markdown 标记', '去掉标记，只留文字；标题放到小节标题里'),
    (re.compile(r'arXiv:\d{4}\.\d{4,5}(?:v\d)?'), '有 arXiv 页边印记', '删掉页边印记'),
    (re.compile(r'\s[,.;:)](?!\d)|\(\s|  +'), '有多余空格', '去掉标点前和括号内侧的空格、连续空格'),
]
BROKEN = re.compile(r'\b([A-Za-z]{2,})- ([a-z]{2,})\b')
KEEP_HYPHEN = {'and', 'or', 'to', 'vs', 'versus', 'nor'}


def format_problems(text: str, heads: set[str], known: set[str]) -> list[tuple[str, str, str]]:
    """Paste artifacts in one paragraph or caption: (problem, excerpt, fix)."""
    out = []
    for rx, what, fix in ARTIFACTS:
        m = rx.search(text)
        if m:
            out.append((what, text[max(0, m.start() - 25):m.end() + 25].replace('\n', '⏎'), fix))
    for m in BROKEN.finditer(text):
        if m.group(2) not in KEEP_HYPHEN and (m.group(1) + m.group(2)).lower() in known:
            out.append(('单词在行尾被断开', m.group(0), f'写成 {m.group(1) + m.group(2)}'))
            break
    for h in heads:
        if len(h) > 12 and h in text:
            out.append(('页眉/页脚被抄进正文', h[:60], '删掉页眉页脚'))
            break
    if re.match(r'\s*(?:Supplementary\s+|Extended\s+Data\s+)?(?:Fig(?:ure)?\.?|Table)\s*S?\d+[a-z]?\s*[|.:]', text):
        out.append(('正文里放了图注', text[:50], '图注放到对应图的 caption，正文里删掉'))
    return out


def figure_free_pages(out: Path, rd: dict) -> dict[int, str]:
    """PDF page text without the blocks inside figures the agent cut out (reading/crops.json): that text is shown
    in the figure, not copied as prose. Needs pymupdf; without it every page counts in full."""
    log = out / 'reading' / 'crops.json'
    if rd.get('kind') != 'pdf' or not rd.get('pdf') or not log.is_file():
        return {}
    try:
        import pymupdf
    except ImportError:
        return {}
    boxes: dict[int, list] = {}
    for c in json.loads(log.read_text()):
        boxes.setdefault(int(c['page']), []).append(c['box'])
    pages = {}
    with pymupdf.open(rd['pdf']) as doc:
        for n, bs in boxes.items():
            if not 1 <= n <= len(doc):
                continue
            pg = doc[n - 1]
            w, h = pg.rect.width, pg.rect.height
            keep = []
            for b in pg.get_text('blocks', sort=True):
                cx, cy = (b[0] + b[2]) / 2 / w * 1000, (b[1] + b[3]) / 2 / h * 1000
                if not any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in bs):
                    keep.append(b[4])
            pages[n] = '\n'.join(keep)
    return pages


def transcription(out: Path, init: dict, p: dict) -> tuple[list[str], list[dict], dict]:
    """Hard problems, findings and coverage numbers for the agent's transcription."""
    hard, found = [], []
    rd = init.get('reading') or {}
    for rel, digest in (rd.get('text') or {}).items():
        if not (out / rel).is_file() or sha(out / rel) != digest:
            hard.append(f'{rel} 在初始化后被改动或删除（这是核对用的原文，不能改）')
    texts = {rel: (out / rel).read_text(encoding='utf-8', errors='replace') for rel in sorted(rd.get('text') or {}) if (out / rel).is_file()}
    paras = [(s, x) for s in p.get('sections', []) for x in s.get('paragraphs', [])]
    captions = [f.get('caption', '') for f in p.get('figures', [])]
    project_text = '\n'.join([p.get('title', '')] + [s.get('heading', '') for s in p.get('sections', [])] + [x['text'] for _, x in paras] + captions)
    proj6 = shingles(words(project_text), 6)
    ref_all = '\n'.join(texts.values())
    # wording is compared on prose words only: formulas written in Unicode never match the PDF text layer's glyphs
    ref4 = shingles(prose_words(ref_all), 4)
    known = set(words(ref_all)) | set(words(project_text))
    # a running head that is the paper's title also appears legitimately in the title block and abstract
    title_key = re.sub(r'\W+', ' ', p.get('title', '')).strip().lower()
    heads = {h for h in running_lines(list(texts.values())) if re.sub(r'\W+', ' ', h).strip().lower() != title_key} if rd.get('kind') == 'pdf' else set()

    # coverage: each unit of the manuscript's prose (a page, or a source paragraph) against the project
    units = []
    figure_text = figure_free_pages(out, rd)
    if rd.get('kind') == 'pdf':
        refs = reference_pages(list(texts.values()))
        for (rel, t), is_ref in zip(texts.items(), refs):
            if is_ref:
                continue
            page = int(re.sub(r'\D', '', Path(rel).stem))
            body = [b for b in prose_blocks(figure_text.get(page, t)) if not REFERENCE_LINE.search(b) or len(b.split()) > 40]
            units.append((f'第 {page} 页', body))
    else:
        for rel, t in texts.items():
            blocks = [b for b in re.split(r'\n\s*\n', t) if len(b.split()) >= 12 and not b.lstrip().startswith('#')]
            units.append((rel, blocks))
    total = hit = 0
    gaps = []
    for name, blocks in units:
        u_total = u_hit = 0
        first_missing = ''
        for b in blocks:
            sh = shingles(words(b), 6)
            got = len(sh & proj6)
            u_total += len(sh); u_hit += got
            if sh and got / len(sh) < 0.5 and not first_missing and len(b.split()) >= 12:
                first_missing = re.sub(r'\s+', ' ', b)[:90]
        total += u_total; hit += u_hit
        if u_total >= 60 and u_hit / u_total < 0.6:
            gaps.append((name, u_hit / u_total, first_missing))
    coverage = hit / total if total else 1.0
    if not paras:
        hard.append('项目里还没有段落：先逐页阅读稿件并抄录正文')
    elif coverage < 0.8:
        hard.append(f'抄录不完整：稿件正文只有 {coverage:.0%} 出现在项目里（缺漏见下方“漏抄”）')
    for name, cov, first in gaps[:30]:
        found.append(finding('warn' if coverage >= 0.8 else 'error', f'漏抄：{name}只有 {cov:.0%} 的正文在项目里', f'例如“{first}…”' if first else '',
                             '回到这一页（或这段源文件），看着原文把漏掉的段落和图注补抄进去；参考文献和表格内容不用抄。', name))

    # wording: paragraphs that do not match the manuscript were paraphrased, not copied
    reworded = []
    for s, x in paras:
        toks = prose_words(x['text'])
        sh = shingles(toks, 4)
        if len(toks) >= 12 and sh and len(sh & ref4) / len(sh) < 0.5:
            reworded.append(x['id'])
    if reworded:
        found.append(finding('error', f'{len(reworded)} 个段落和原文措辞对不上', '、'.join(reworded[:12]),
                             '这些段落像是改写或概括的。初始化只抄录：按原文逐句抄，只改格式（断词、换行、公式写法），不改措辞。'))
        hard.append(f'{len(reworded)} 个段落不是照原文抄录的：{reworded[:8]}')

    # format: what a raw paste leaves behind
    bad = []
    for i, (s, x) in enumerate(paras):
        for what, ex, fix in format_problems(x['text'], heads, known):
            bad.append((x['id'], what, ex, fix))
        nxt = paras[i + 1][1] if i + 1 < len(paras) and paras[i + 1][0] is s else None
        if nxt and not re.search(r'[.!?:;。！？：；)"”’\]]\s*$', x['text']) and re.match(r'\s*[a-z]', nxt['text']):
            bad.append((x['id'], '段落在换页或分栏处被截断', x['text'][-40:], f'与下一段 {nxt["id"]} 合成一段'))
    for f in p.get('figures', []):
        for what, ex, fix in format_problems(f.get('caption', ''), heads, known):
            if what != '正文里放了图注':
                bad.append((f['id'], '图注' + what, ex, fix))
    for unit, what, ex, fix in bad[:40]:
        found.append(finding('error', f'格式：{unit} {what}', f'“{ex}”', fix + '（用 project_apply 改正这一段，id 不变）', unit))
    if bad:
        hard.append(f'{len(bad)} 处抄录格式问题（直接粘贴提取文字留下的痕迹），逐条改正')
    return hard, found, {'coverage': round(coverage, 3), 'gaps': len(gaps), 'reworded': len(reworded), 'formatProblems': len(bad)}


def figure_checks(out: Path, init: dict, p: dict) -> tuple[list[str], list[dict]]:
    """Every figure and panel image exists, is not blank, and panels are real cuts; captions in the manuscript have figures."""
    hard, found = [], []
    try:
        from PIL import Image
    except ImportError:
        Image = None
        found.append(finding('info', '没有检查图片内容', '缺少 pillow', '用 --with pillow==12.3.0 运行检查脚本可以检查裁图是否为空白。'))
    def look(rel: str):
        fp = (out / rel).resolve() if rel else None
        if not fp or not fp.is_file() or (out / 'assets').resolve() not in fp.parents:
            return None
        if Image is None:
            return (0, 0, 1.0, {})
        with Image.open(fp) as im:
            g = im.convert('L')
            w0, h0 = g.size
            # edges at full resolution: a cut through text or a plot shows as ink along the border row or column
            px = g.load()
            step = max(1, min(w0, h0) // 400)
            def edge(points):
                pts = list(points)
                return sum(px[x, y] < 200 for x, y in pts) / max(1, len(pts))
            edges = {'上': edge((x, 0) for x in range(0, w0, step)), '下': edge((x, h0 - 1) for x in range(0, w0, step)),
                     '左': edge((0, y) for y in range(0, h0, step)), '右': edge((w0 - 1, y) for y in range(0, h0, step))}
            g.thumbnail((400, 400))
            dark = sum(g.histogram()[:245]) / max(1, g.width * g.height)
            return (im.width, im.height, dark, edges)
    for f in p.get('figures', []):
        info = look(f.get('file', ''))
        if info is None:
            hard.append(f'{f["id"]}（{f.get("label")}）的图片不存在或不在 assets/ 里：用 page_tools.py crop 从页面裁出整张图')
            continue
        w, h, dark, edges = info
        if Image is not None and (w < 300 or h < 120 or dark < 0.01):
            found.append(finding('error', f'{f.get("label")} 的裁图可能不对', f'{w}×{h} 像素，有内容的像素 {dark:.1%}', '看一眼这张裁图（read_image），框没对准就在网格页上重新定框再裁。', f['id']))
        cut = [k for k, v in edges.items() if v > 0.06]
        if cut:
            found.append(finding('error', f'{f.get("label")} 的裁图{"、".join(cut)}边切到了内容', '边缘一整行像素上有文字或线条：要么图被切掉一部分，要么图注或正文混了进来',
                                 '看一眼这张裁图，在网格页上把这一边往外放（图被切）或往里收（混进图注/正文），重新裁；面板也一样重裁。', f['id']))
        panels = f.get('panels', [])
        if not f.get('caption', '').strip():
            found.append(finding('warn', f'{f.get("label")} 没有图注', '', '看着原文把图注抄进 caption。', f['id']))
        for pn in panels:
            if len(panels) > 1 and pn.get('image') == f.get('file'):
                found.append(finding('error', f'{f.get("label")}{pn["label"]} 用的是整张图', '', '把这个面板单独裁出来（在整图的网格上定框）。', f['id']))
                continue
            pi = look(pn.get('image', ''))
            if pi is None:
                hard.append(f'{f["id"]} 面板 {pn["label"]} 的图片不存在或不在 assets/ 里')
            elif Image is not None and (pi[2] < 0.01 or (pi[0] >= w and pi[1] >= h and len(panels) > 1)):  # blank, or no smaller than the figure
                found.append(finding('error', f'{f.get("label")}{pn["label"]} 的裁图可能不对', f'{pi[0]}×{pi[1]} 像素，有内容的像素 {pi[2]:.1%}', '看一眼这个面板，重新定框再裁。', f['id']))
            elif Image is not None and len(panels) > 1 and [k for k, v in pi[3].items() if v > 0.06]:
                # a strip of the neighbouring panel (its tick labels, curve or legend) along an edge
                sides = '、'.join(k for k, v in pi[3].items() if v > 0.06)
                found.append(finding('error', f'{f.get("label")} 面板 {pn["label"]} 的{sides}边切到了内容', '边缘一整行像素上有文字或线条：多半混进了相邻面板，或面板被切掉一部分',
                                     '看一眼这个面板，在整图网格上把这一边收到两个面板之间的空白处（或放出被切的部分），重新裁。', f['id']))
    # captions in the manuscript that have no figure in the project
    rd = init.get('reading') or {}
    labels_ref = set()
    for rel in (rd.get('text') or {}):
        if (out / rel).is_file():
            for m in re.finditer(r'^\s*((?:Supplementary\s+|Extended\s+Data\s+)?(?:Fig(?:ure)?\.?|Table))\s*(S?\d+)\s*[|.:]', (out / rel).read_text(encoding='utf-8', errors='replace'), re.M | re.I):
                kind = 'Table' if 'table' in m.group(1).lower() else 'Extended' if 'extended' in m.group(1).lower() else 'Supplementary' if 'supp' in m.group(1).lower() else 'Fig'
                labels_ref.add((kind, m.group(2).upper()))
    labels_proj = set()
    for f in p.get('figures', []):
        m = re.search(r'((?:Supplementary|Extended|Table|Fig))\w*\.?\s*(?:Data\s+)?(?:Fig(?:ure)?\.?\s*)?(S?\d+)', f.get('label', ''), re.I)
        if m:
            k = m.group(1).capitalize()
            labels_proj.add(('Fig' if k.startswith('Fig') else k, m.group(2).upper()))
    missing = sorted(labels_ref - labels_proj)
    if missing:
        found.append(finding('warn', f'稿件里有 {len(missing)} 个图/表在项目中没有对应', '、'.join(f'{k} {n}' for k, n in missing[:15]),
                             '找到它们所在的页，裁出整图（表格也按图裁），抄图注；有字母的图再逐个裁面板。', 'figures'))
    mentioned = ' '.join(x['text'] for s in p.get('sections', []) for x in s.get('paragraphs', []))
    for f in p.get('figures', []):
        num = re.search(r'(S?\d+)', f.get('label', ''))
        if num and not re.search(r'(?:Fig(?:ure)?s?\.?|Table)\s*' + re.escape(num.group(1)) + r'(?!\d)', mentioned, re.I):
            found.append(finding('info', f'{f.get("label")} 在正文中没有被提到', '', '确认图号；正文漏抄了引用它的段落时补上。', f['id']))
    return hard, found


def repo_findings(ws: Path, out: Path, init: dict, p: dict, article: str) -> list[dict]:
    """Problems in how the manuscript relates to the repository's current state."""
    import subprocess
    r = init.get('repo') or {}
    repo = Path(r['path'])
    ctx = json.loads((out / 'repo' / 'repo-context.json').read_text())
    found: list[dict] = []
    # figures older than the scripts that write them
    scripts = ctx.get('figureScripts', [])
    for f in r.get('figureInputs', []):
        fp = Path(f)
        if not fp.is_file():
            continue
        for sc in scripts:
            if any(Path(w).name == fp.name or Path(w).stem == fp.stem for w in sc.get('writes', [])):
                spath = repo / sc['path']
                if spath.is_file() and spath.stat().st_mtime > fp.stat().st_mtime + 60:
                    found.append(finding('warn', f'{fp.name} 比生成它的脚本旧', f'{sc["path"]} 修改于 {sc["modified"]}，图文件更早',
                                         f'先重跑 {sc["path"]} 生成新图，再在项目里替换这张图；否则图可能不是最新结果。', fp.name))
    # registered numbers whose source names a repository file that does not contain them
    for n in p.get('numbers', []):
        for cand in re.findall(r'[\w./-]+\.(?:json|csv|tsv|md|txt|tex|py)', n.get('source', '')):
            # relative to the repository, or to the workspace that contains it
            fp = next((c for c in (repo / cand, repo.parent / cand) if c.is_file()), repo / cand)
            if fp.is_file() and fp.stat().st_size < 5_000_000:
                text = num_norm(fp.read_text(encoding='utf-8', errors='replace'))
                # ratios such as 59/82 are stored as separate values in result files: check each part
                parts = [x.rstrip('%') for x in re.findall(r'\d[\d.]*%?', num_norm(n['value']))]
                if parts and not all(x in text for x in parts):
                    found.append(finding('warn', f'数字 {n["value"]} 在出处文件中找不到', f'登记出处 {cand}（找不到 {", ".join(x for x in parts if x not in text)}）',
                                         f'打开 {cand} 核对这个数字；如果结果已更新，请在稿件和项目里同时改正，或把出处改成实际的文件。', n['id']))
                break
    # manuscript numbers that no repository file contains (pre-match): possibly stale, or results kept elsewhere
    try:
        nm = json.loads((out / 'repo' / 'number-matches.json').read_text())
        lost = [x for x in nm.get('notFound', []) if '.' in x['value'] or '%' in x['value'] or len(x['value'].replace(',', '')) >= 4]
        if lost:
            found.append(finding('info', f'{len(lost)} 个稿件数字在仓库文件中找不到', '例如 ' + '、'.join(x['value'] for x in lost[:10]),
                                 '这些数字可能来自仓库外的结果，或者已经过时。核对它们的来源；结果在仓库外的，在项目里写明出处，过时的同时改稿件和项目。'))
    except (OSError, ValueError):
        pass
    # results newer than the manuscript
    src = next((Path(k) for k in init['inputs'] if Path(k).suffix.lower() in ('.tex', '.md', '.docx', '.pdf') and Path(k).is_file()), None)
    if src:
        mt = src.stat().st_mtime
        newer = [t for t in ctx.get('resultTables', []) if (repo / t['path']).is_file() and (repo / t['path']).stat().st_mtime > mt + 86400]
        if newer:
            found.append(finding('info', f'{len(newer)} 个结果文件比稿件新', '; '.join(t['path'] for t in newer[:6]),
                                 '确认这些新结果是否应进入论文；需要的话在对应分论点下补一条论据或缺口，并更新正文。'))
    # manuscript markers
    for m in [x for x in ctx.get('markers', []) if src and Path(x['path']).name == src.name][:10]:
        found.append(finding('info', f'稿件里有 {m["mark"]}', m['text'], '处理或删除这条标记后再定稿。', m['path']))
    unresolved = len(re.findall(r'\?\?|\[\?\]', article))
    if unresolved:
        found.append(finding('warn', f'稿件中有 {unresolved} 处未解析的引用（??）', '交叉引用或文献引用没有编译出来',
                             '在原稿里编译一次（LaTeX 需跑两遍并生成 .bbl），确认没有 ?? 后再重新初始化或手动修正。'))
    # uncommitted changes
    now_status = subprocess.run(['git', '-C', str(repo), 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
    if r.get('status'):
        found.append(finding('info', f'初始化时仓库有 {len(r["status"])} 个未提交的改动', '; '.join(x[3:] for x in r['status'][:6]),
                             '项目基于工作区当前文件，而不是最近一次提交；需要留存这一版时先提交。'))
    if len(now_status) > len(r.get('status', [])) + 1:
        found.append(finding('info', '初始化之后仓库又有改动', f'未提交改动从 {len(r.get("status", []))} 个变为 {len(now_status)} 个',
                             '如果改动影响稿件或结果，用“处理意见”或重新初始化把项目同步到新状态。'))
    return found


def main() -> int:
    ws, rel = Path(sys.argv[1]).resolve(), sys.argv[2]
    out = (ws / rel).resolve()
    init = json.loads((out / 'init.json').read_text())
    p = json.loads((out / 'project.json').read_text())
    hard, notes = [], []

    changed = [k for k, v in init['inputs'].items() if not Path(k).is_file() or sha(Path(k)) != v]
    if changed:
        hard.append(f'原始文件被改动或缺失：{changed}')
    for key in ['title', 'thesis', 'beats', 'claims', 'figures', 'numbers', 'sections']:
        if key not in p:
            hard.append(f'project.json 缺少 {key}')
    claims = {c['id']: c for c in p.get('claims', [])}
    if len(claims) != len(p.get('claims', [])):
        hard.append('分论点 id 重复')
    for b in p.get('beats', []):
        for cid in b.get('claims', []):
            if cid not in claims:
                hard.append(f'拍 {b["id"]} 引用不存在的分论点 {cid}')
    panels = {(f['id'], pn['label']) for f in p.get('figures', []) for pn in f.get('panels', [])}
    used_figs = set()
    for c in claims.values():
        for e in c.get('evidence', []):
            for pn in e.get('panels', []):
                used_figs.add(pn['figure'])
                if (pn['figure'], pn['label']) not in panels:
                    notes.append(f'{c["id"]} 的论据 {e["id"]} 引用了不存在的面板 {pn["figure"]}/{pn["label"]}（显示为待做面板）')
    paras = [x for s in p.get('sections', []) for x in s.get('paragraphs', [])]
    for x in paras:
        for cid in x.get('claims', []):
            if cid not in claims:
                hard.append(f'段落 {x["id"]} 引用不存在的分论点 {cid}')

    t_hard, t_found, stats = transcription(out, init, p)
    f_hard, f_found = figure_checks(out, init, p)
    hard += t_hard + f_hard
    article = '\n'.join((out / rel).read_text(encoding='utf-8', errors='replace') for rel in (init.get('reading') or {}).get('text', {}) if (out / rel).is_file())

    findings = [finding('error', h, '', '修正后重新运行检查。') for h in hard] + t_found + f_found
    if init.get('repo'):
        findings += repo_findings(ws, out, init, p, article)
    # argument-level gaps, as findings too, so they reach the author through the same channel
    for b in p.get('beats', []):
        if not b.get('claims'):
            findings.append(finding('warn', f'第 {p["beats"].index(b) + 1} 拍没有分论点', b.get('title', ''), '给这一拍补上它要论证的分论点，或与相邻的拍合并。', b['id']))
    unlinked = [x['id'] for x in paras if not x.get('claims')]
    stated = {cid for x in paras for cid in x.get('claims', [])}
    unstated = [c for c in claims if c not in stated]
    unused = [f['label'] for f in p.get('figures', []) if f['id'] not in used_figs]
    unsupported = [c['id'] for c in claims.values() if not any(e.get('kind') == 'support' for e in c.get('evidence', []))]
    for c in unsupported_ids(claims):
        findings.append(finding('warn', f'分论点 {c} 没有支持论据', claims[c].get('title', ''), '补上支撑它的结果和对应的图；没有结果的话把它标为缺口或删去。', c))
    (out / 'init-findings.json').write_text(json.dumps(findings, ensure_ascii=False, indent=1))
    summary = {'ok': not hard and not any(f['severity'] == 'error' for f in findings), 'findings': {s: sum(f['severity'] == s for f in findings) for s in ('error', 'warn', 'info')}, 'paragraphs': len(paras), 'linkedParagraphs': len(paras) - len(unlinked), 'claims': len(claims),
               'beats': len(p.get('beats', [])), 'figures': len(p.get('figures', [])), 'numbers': len(p.get('numbers', [])),
               'transcription': stats, 'hard': hard, 'unstatedClaims': unstated, 'unusedFigures': unused, 'claimsWithoutSupport': unsupported}

    lines = [f'# 初始化报告：{p.get("title", "")}', '',
             f'- 原始文件：{"未改动" if not changed else "有改动！"}（{len(init["inputs"])} 个，按 SHA-256 核对）',
             f'- 段落：{len(paras)}，其中 {len(paras) - len(unlinked)} 段已对应到分论点；稿件正文有 {stats["coverage"]:.0%} 抄进了项目，'
             f'措辞不符 {stats["reworded"]} 段，格式问题 {stats["formatProblems"]} 处',
             f'- 骨架：{len(p.get("beats", []))} 拍、{len(claims)} 个分论点、{len(p.get("numbers", []))} 个登记数字、{len(p.get("figures", []))} 张图', '']
    if hard:
        lines += ['## 必须修正', *[f'- {h}' for h in hard], '']
    order = {'error': 0, 'warn': 1, 'info': 2}
    label = {'error': '必须处理', 'warn': '建议处理', 'info': '供参考'}
    if findings:
        lines += ['## 检查发现的问题与建议', *[f'- **{label[f["severity"]]}** · {f["title"]}' + (f'（{f["detail"]}）' if f['detail'] else '') + f'\n  - 建议：{f["guidance"]}'
                                          for f in sorted(findings, key=lambda f: order[f['severity']])], '']
    lines += ['## 需要作者看一下',
              f'- 没有段落陈述的分论点：{", ".join(unstated) or "无"}',
              f'- 没有论据引用的图：{", ".join(unused) or "无"}',
              f'- 没有支持论据的分论点：{", ".join(unsupported) or "无"}',
              f'- 未对应分论点的段落：{len(unlinked)} 段（方法细节、致谢、参考文献等可以不对应）', *[f'- {n}' for n in notes[:20]], '',
              '在侧栏“论文项目”中输入这个文件夹即可打开。原始文件只被读取，没有被修改。']
    (out / 'init-report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))
    # any error-level finding (bad crops too) means the project is not done yet
    return 0 if not hard and not any(f['severity'] == 'error' for f in findings) else 1


if __name__ == '__main__':
    sys.exit(main())
