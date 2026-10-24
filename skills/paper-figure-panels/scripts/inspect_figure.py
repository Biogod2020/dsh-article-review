"""Render coordinate grids and candidate-crop previews; never register reader panels."""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

from split_panels import inside


def _white(image):
    rgba = image.convert("RGBA")
    return Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")


def _panels(spec):
    panels = spec.get("panels", [])
    if not isinstance(panels, list) or len(panels) > 52:
        raise ValueError("Provide at most 52 candidate panel regions")
    labels = set()
    for panel in panels:
        label, page, region = panel["label"], panel["page"], panel["region"]
        if not isinstance(label, str) or not label.strip() or len(label) > 80 or label.casefold() in labels:
            raise ValueError("Panel labels must be nonempty and unique")
        labels.add(label.casefold())
        if type(page) is not int or page < 1:
            raise ValueError("Pages are 1-based integers")
        if not isinstance(region, list) or len(region) != 4 or any(
            type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1 for n in region
        ):
            raise ValueError("Region must contain four finite fractions between 0 and 1")
        if region[0] >= region[2] or region[1] >= region[3]:
            raise ValueError("Crop region must have positive area")
    return panels


def _render(source, data, pages):
    """Match split_panels: EXIF-transposed raster, or 2x PDF/SVG rendering."""
    if source.suffix.lower() in (".pdf", ".svg"):
        import pymupdf
        with pymupdf.open(stream=data, filetype=source.suffix[1:].lower()) as original:
            if source.suffix.lower() == ".svg":
                pdf = pymupdf.open(stream=original.convert_to_pdf(), filetype="pdf")
            else:
                pdf = original
            try:
                if max(pages) > len(pdf):
                    raise ValueError("PDF/SVG page does not exist")
                return {page: Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                        for page in pages
                        for pix in [pdf[page - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)]}
            finally:
                if pdf is not original:
                    pdf.close()
    if pages != [1]:
        raise ValueError("Raster images have one page")
    with Image.open(io.BytesIO(data)) as original:
        return {1: _white(ImageOps.exif_transpose(original))}


def _save(root, output, kind, image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    content = buffer.getvalue()
    name = f"{kind}-{hashlib.sha256(content).hexdigest()}.png"
    target = inside(root, str(output / name))
    try:
        with target.open("xb") as handle:
            handle.write(content)
    except FileExistsError:
        if target.read_bytes() != content:
            raise ValueError("Existing preview content differs from its hash")
    return target.relative_to(root).as_posix()


def _font(size):
    return ImageFont.load_default(size=size)


def _text(draw, xy, value, size=18, fill="#172b39"):
    draw.text(xy, value, fill=fill, font=_font(size))


def _grid(rendered, page, candidates):
    preview = rendered.copy()
    preview.thumbnail((1400, 1400))
    w, h = preview.size
    x, y = 70, 108
    canvas = Image.new("RGB", (max(w + 110, 1000), h + 160), "white")
    canvas.paste(preview, (x, y))
    draw = ImageDraw.Draw(canvas)
    _text(draw, (12, 10), f"PAGE {page} | rendered source: {rendered.width} x {rendered.height} px", 21)
    _text(draw, (12, 39), f"Normalized ruler: left/top = 0; right/bottom = 1 | artwork preview: {w} x {h} px", 17)
    _text(draw, (12, 65), "Use normalized coordinates, not pixels from this preview. Rectangles are candidates for review.", 16)
    for i in range(11):
        fraction = i / 10
        px, py = x + round(w * fraction), y + round(h * fraction)
        draw.line((px, y, px, y + h), fill="#9dd2d0", width=1)
        draw.line((x, py, x + w, py), fill="#9dd2d0", width=1)
        _text(draw, (px - 13, y - 26), f"{fraction:.1f}", 15)
        _text(draw, (17, py - 8), f"{fraction:.1f}", 15)
    colors = ("#bd1648", "#1460bd", "#8b3dba", "#ad5b00")
    for index, panel in enumerate(candidates):
        left, top, right, bottom = panel["region"]
        bounds = (x + round(left * w), y + round(top * h), x + round(right * w), y + round(bottom * h))
        color = colors[index % len(colors)]
        draw.rectangle(bounds, outline=color, width=3)
        label = f'{index + 1}: {panel["label"]}'
        box = draw.textbbox((bounds[0] + 3, bounds[1] + 3), label, font=_font(18))
        draw.rectangle((box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2), fill="white", outline=color)
        _text(draw, (bounds[0] + 3, bounds[1] + 3), label, 18, color)
    return canvas


def _edge_review(crop):
    """Flag visible edge content for inspection, never infer a bad crop."""
    width, height = crop.size
    strip = min(3, width, height)
    boxes = {"left": (0, 0, strip, height), "top": (0, 0, width, strip),
             "right": (width - strip, 0, width, height), "bottom": (0, height - strip, width, height)}
    fractions = {}
    for edge, box in boxes.items():
        band = crop.crop(box)
        # A pixel visibly differs from white if any RGB channel is below 235.
        channels = band.split()
        minimum = ImageChops.darker(ImageChops.darker(channels[0], channels[1]), channels[2])
        histogram = minimum.histogram()
        fraction = sum(histogram[:235]) / (band.width * band.height)
        if fraction >= 0.01:
            fractions[edge] = round(fraction, 4)
    return {"nonwhiteEdgeFractions": fractions,
            "hint": (f"Visible nonwhite content touches {', '.join(fractions)} edge(s); inspect labels, axes and legends. "
                     "This is a review hint, not proof of clipping." if fractions else
                     "No edge exceeded the content threshold; this does not prove the crop is complete.")}


def _sheet(entries, number):
    width, tile_w, tile_h = 1220, 600, 660
    rows = math.ceil(len(entries) / 2)
    canvas = Image.new("RGB", (width, 70 + rows * tile_h), "#eef1f4")
    draw = ImageDraw.Draw(canvas)
    _text(draw, (12, 10), f"CANDIDATE CROPS | sheet {number} | inspect labels, axes, legends and shared keys", 19)
    _text(draw, (12, 38), "Resized previews. Pixel bounds below refer to the rendered source; right/bottom are exclusive.", 15)
    for index, (record, crop) in enumerate(entries):
        x, y = 10 + index % 2 * (tile_w + 10), 70 + index // 2 * tile_h
        draw.rectangle((x, y, x + tile_w, y + tile_h - 10), fill="white")
        _text(draw, (x + 10, y + 8), f'{record["label"]} | page {record["page"]} | {crop.width} x {crop.height} px', 18)
        short_region = ", ".join(f"{n:.4f}" for n in record["region"])
        _text(draw, (x + 10, y + 35), f"normalized: [{short_region}]", 14)
        _text(draw, (x + 10, y + 56), f'source bounds: {record["pixelBounds"]}', 14)
        edges = record["edgeReview"]["nonwhiteEdgeFractions"]
        nearby = record["nearbySourceReview"]["nonwhiteFractions"]
        _text(draw, (x + 10, y + 77), "Edges: " + (", ".join(edges) or "none") + "; nearby source: " + (", ".join(nearby) or "none"), 12)
        preview = crop.copy()
        preview.thumbnail((tile_w - 20, tile_h - 115))
        canvas.paste(preview, (x + (tile_w - preview.width) // 2, y + 105))
    return canvas


def _nearby_review(image, bounds):
    """Flag annotations just beyond a blank crop edge without changing its bounds."""
    left, top, right, bottom = bounds
    margin = max(8, min(32, round(min(image.size) * .01)))
    boxes = {"left": (max(0, left - margin), top, left, bottom),
             "right": (right, top, min(image.width, right + margin), bottom),
             "top": (left, max(0, top - margin), right, top),
             "bottom": (left, bottom, right, min(image.height, bottom + margin))}
    fractions = {}
    for edge, box in boxes.items():
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        band = image.crop(box).convert("RGB")
        channels = band.split()
        minimum = ImageChops.darker(ImageChops.darker(channels[0], channels[1]), channels[2])
        fraction = sum(minimum.histogram()[:235]) / (band.width * band.height)
        if fraction >= .005:
            fractions[edge] = round(fraction, 4)
    return {"marginPixels": margin, "nonwhiteFractions": fractions,
            "hint": "Inspect nearby source ink for cut-off arrows, scale bars or labels; it may belong to another panel. No automatic expansion is applied."}


def inspect(root, manifest, page=1, output_dir=None):
    root = Path(root).resolve(strict=True)
    if type(page) is not int or page < 1:
        raise ValueError("Pages are 1-based integers")
    manifest_path = inside(root, str(manifest))
    spec = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = inside(root, spec["source"])
    data = source.read_bytes()
    source_hash = hashlib.sha256(data).hexdigest()
    if source_hash != spec["sourceHash"]:
        raise ValueError("Source hash changed; inspect the current artwork before previewing")
    candidates = _panels(spec)
    pages = sorted({page, *(panel["page"] for panel in candidates)})
    rendered = _render(source, data, pages)
    output_dir = str(manifest_path.parent / "previews") if output_dir is None else output_dir
    output = inside(root, output_dir)
    if output == root:
        raise ValueError("Use an output subdirectory, not the workspace root")
    # Validate source, all regions and pages before creating output files.
    output.mkdir(parents=True, exist_ok=True)
    output = inside(root, output_dir)
    result = {"source": source.relative_to(root).as_posix(), "sourceHash": source_hash,
              "coordinates": "normalized [left, top, right, bottom] from top-left of rendered source; PDF/SVG at 2x; raster EXIF-transposed",
              "legendReview": "Confirm shared legends/color bars remain in each relevant crop, or offer the whole figure alongside it. This helper cannot identify shared legends.",
              "pages": [], "panels": [], "contactSheets": []}
    entries = []
    for p, image in rendered.items():
        panels = [panel for panel in candidates if panel["page"] == p]
        result["pages"].append({"page": p, "width": image.width, "height": image.height,
                                "grid": _save(root, output, f"page-{p}-grid", _grid(image, p, []))})
        if panels:
            result["pages"][-1]["overlay"] = _save(root, output, f"page-{p}-overlay", _grid(image, p, panels))
        for panel in panels:
            left, top, right, bottom = panel["region"]
            bounds = [int(left * image.width), int(top * image.height),
                      math.ceil(right * image.width), math.ceil(bottom * image.height)]
            crop = image.crop(bounds)
            record = {"label": panel["label"], "page": p, "region": panel["region"],
                      "pixelBounds": bounds, "width": crop.width, "height": crop.height,
                      "edgeReview": _edge_review(crop),
                      "nearbySourceReview": _nearby_review(image, bounds),
                      "legendReview": ("Check the excluded area for any shared legend/color bar required by this panel; "
                                       "if one is outside this region, the AI must confirm how to preserve it."),
                      "preview": _save(root, output, "candidate", crop)}
            result["panels"].append(record)
            entries.append((record, crop))
    for index in range(0, len(entries), 4):
        result["contactSheets"].append(_save(root, output, "contact-sheet", _sheet(entries[index:index + 4], index // 4 + 1)))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", help="Confine all inputs and outputs to this directory")
    parser.add_argument("manifest", help="Workspace-relative or absolute JSON with source/sourceHash; panels are optional")
    parser.add_argument("--page", type=int, default=1, help="Include this 1-based page plus all candidate pages (default: 1)")
    parser.add_argument("--output-dir", help="Preview subdirectory inside the workspace (default: previews/ beside manifest)")
    args = parser.parse_args()
    try:
        result = inspect(args.workspace, args.manifest, args.page, args.output_dir)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f"inspect_figure: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
