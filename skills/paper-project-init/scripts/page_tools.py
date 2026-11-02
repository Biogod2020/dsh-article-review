"""Help the agent look at pages and cut figures by eye: a coordinate grid to read positions from, and a crop.

The agent decides what a figure or panel is by looking at the image (read_image); these commands only draw the
grid it reads coordinates from and cut the box it chose. Coordinates are per mille of the image's width and
height (0-1000 from the top-left), so they do not depend on the resolution the image was viewed at.

  grid <project> <image> [--step 50]
      Writes reading/grid/<name>.png: the image with a labelled grid (thin lines every --step, labels every 100).
  crop <project> <image> --box X0 Y0 X1 Y1 --out assets/<name>.png [--pad 6]
      Cuts the box out of <image>. When <image> is a page rendered from the PDF manuscript (reading/pages/pNNN.png),
      the box is re-rendered from the PDF at high resolution instead of cut from the preview, so text and lines stay
      sharp. Writes inside <project>/assets only. Prints the size and how much of the crop is ink: a crop that is
      almost blank, or touches an edge where ink continues, probably missed the figure.

Usage: python page_tools.py grid|crop ...   (needs pillow; crop from PDF pages needs pymupdf)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def inside(root: Path, path: Path) -> Path:
    path = path.resolve()
    if path != root and root not in path.parents:
        raise SystemExit(f'{path} is outside {root}')
    return path


def ink(img) -> tuple[float, dict[str, float]]:
    """Share of non-background pixels overall and along each edge (an edge with ink suggests a cut-off figure)."""
    g = img.convert('L')
    w, h = g.size
    px = g.load()
    bg = 245
    step = max(1, min(w, h) // 300)
    total = hits = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            total += 1
            hits += px[x, y] < bg
    def edge(points):
        pts = list(points)
        return round(sum(px[x, y] < bg for x, y in pts) / max(1, len(pts)), 3)
    edges = {'top': edge((x, 0) for x in range(0, w, step)), 'bottom': edge((x, h - 1) for x in range(0, w, step)),
             'left': edge((0, y) for y in range(0, h, step)), 'right': edge((w - 1, y) for y in range(0, h, step))}
    return round(hits / max(1, total), 4), edges


def grid(args) -> None:
    from PIL import Image, ImageDraw, ImageFont
    proj = Path(args.project).resolve()
    src = inside(proj, proj / args.image)
    img = Image.open(src).convert('RGB')
    w, h = img.size
    over = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    size = max(11, min(w, h) // 70)
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:  # older pillow
        font = ImageFont.load_default()
    for v in range(0, 1001, args.step):
        major = v % 100 == 0
        colour = (220, 30, 30, 150) if major else (30, 90, 220, 70)
        x, y = round(v / 1000 * (w - 1)), round(v / 1000 * (h - 1))
        d.line([(x, 0), (x, h)], fill=colour, width=2 if major else 1)
        d.line([(0, y), (w, y)], fill=colour, width=2 if major else 1)
        if major:
            lx = x + 2 if v < 1000 else x - 3 * size  # keep the 1000 label inside the image
            for (tx, ty) in ((lx, 2), (lx, h - size - 4)):
                d.text((tx, ty), str(v), fill=(200, 0, 0, 255), font=font, stroke_width=2, stroke_fill=(255, 255, 255, 255))
            ly = y + 2 if v < 1000 else y - size - 4
            for (tx, ty) in ((2, ly), (w - 4 * size, ly)):
                d.text((tx, ty), str(v), fill=(200, 0, 0, 255), font=font, stroke_width=2, stroke_fill=(255, 255, 255, 255))
    out = proj / 'reading' / 'grid' / (src.stem + '.png')
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(img.convert('RGBA'), over).convert('RGB').save(out)
    print(json.dumps({'grid': out.relative_to(proj).as_posix(), 'size': [w, h], 'units': 'per mille of width (x) and height (y), origin top-left'}))


def crop(args) -> None:
    from PIL import Image
    proj = Path(args.project).resolve()
    src = inside(proj, proj / args.image)
    out = inside(proj / 'assets', proj / args.out)
    if out.suffix.lower() != '.png':
        raise SystemExit('--out must be a .png inside assets/')
    x0, y0, x1, y1 = args.box
    if not (0 <= x0 < x1 <= 1000 and 0 <= y0 < y1 <= 1000):
        raise SystemExit('--box needs 0 <= X0 < X1 <= 1000 and 0 <= Y0 < Y1 <= 1000 (per mille)')
    pad = args.pad
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(1000, x1 + pad), min(1000, y1 + pad)
    init = json.loads((proj / 'init.json').read_text())
    page = re.fullmatch(r'p(\d+)', src.stem)
    pdf = init.get('reading', {}).get('pdf')
    out.parent.mkdir(parents=True, exist_ok=True)
    if page and src.parent == (proj / 'reading' / 'pages').resolve() and pdf:
        import pymupdf
        with pymupdf.open(pdf) as doc:
            pg = doc[int(page.group(1)) - 1]
            r = pg.rect
            clip = pymupdf.Rect(r.x0 + r.width * x0 / 1000, r.y0 + r.height * y0 / 1000, r.x0 + r.width * x1 / 1000, r.y0 + r.height * y1 / 1000)
            # about 2400 px across a full page width: sharp enough to zoom into small panel text
            zoom = max(2.0, 2400 / r.width)
            pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False).save(out)
        how = 're-rendered from the PDF'
        # where figures were cut: the check counts text inside them as part of the figure, not as prose to copy
        log = proj / 'reading' / 'crops.json'
        crops = json.loads(log.read_text()) if log.is_file() else []
        crops = [c for c in crops if c.get('out') != out.relative_to(proj).as_posix()]
        crops.append({'out': out.relative_to(proj).as_posix(), 'page': int(page.group(1)), 'box': [x0, y0, x1, y1]})
        log.write_text(json.dumps(crops, indent=1))
    else:
        img = Image.open(src).convert('RGB')
        w, h = img.size
        img.crop((round(w * x0 / 1000), round(h * y0 / 1000), round(w * x1 / 1000), round(h * y1 / 1000))).save(out)
        how = 'cut from the image'
    res = Image.open(out)
    share, edges = ink(res)
    warn = []
    if share < 0.01:
        warn.append('almost blank: the box probably missed the figure')
    warn += [f'ink touches the {k} edge ({v:.0%}): check that nothing is cut off there' for k, v in edges.items() if v > 0.08]
    print(json.dumps({'crop': out.relative_to(proj).as_posix(), 'size': list(res.size), 'how': how, 'ink': share, 'warnings': warn,
                      'next': 'read_image the crop and confirm it holds the whole figure or panel, with its letter and axes'}))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    g = sub.add_parser('grid')
    g.add_argument('project')
    g.add_argument('image', help='image path relative to the project, e.g. reading/pages/p003.png or assets/F2.png')
    g.add_argument('--step', type=int, default=50)
    c = sub.add_parser('crop')
    c.add_argument('project')
    c.add_argument('image')
    c.add_argument('--box', type=float, nargs=4, required=True, metavar=('X0', 'Y0', 'X1', 'Y1'))
    c.add_argument('--out', required=True, help='assets/<name>.png')
    c.add_argument('--pad', type=float, default=6, help='margin added on every side, per mille (default 6)')
    a = ap.parse_args()
    (grid if a.cmd == 'grid' else crop)(a)


if __name__ == '__main__':
    sys.exit(main())
