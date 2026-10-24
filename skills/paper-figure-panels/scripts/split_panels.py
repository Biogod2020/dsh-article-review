"""Crop verified figure regions for DSH; run with uv --with pillow --with pymupdf."""
import hashlib
import io
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageOps


def inside(root, value):
    path = (root / value).resolve()
    if not path.is_relative_to(root) or any(part.casefold() == ".paper-review" for part in path.relative_to(root).parts):
        raise ValueError("All input and output files must remain inside the workspace")
    return path


def split(root, manifest, output_dir="figures/reader-panels"):
    root = Path(root).resolve(strict=True)
    spec = json.loads(inside(root, str(Path(manifest).resolve())).read_text())
    source = inside(root, spec["source"])
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != spec["sourceHash"]:
        raise ValueError("Source hash changed; inspect the current artwork before cropping")
    panels = spec["panels"]
    if not isinstance(panels, list) or not 1 <= len(panels) <= 52:
        raise ValueError("Provide 1 to 52 visually verified panel regions")
    output = inside(root, output_dir)
    output.mkdir(parents=True, exist_ok=True)
    output = inside(root, output_dir)
    results, labels = [], set()
    pdf = None
    image = None
    rendered_page = None
    rendered_pdf = None
    try:
        if source.suffix.lower() in (".pdf", ".svg"):
            import pymupdf
            original = pymupdf.open(stream=data, filetype=source.suffix[1:].lower())
            if source.suffix.lower() == ".svg":
                converted = original.convert_to_pdf()
                original.close()
                pdf = pymupdf.open(stream=converted, filetype="pdf")
            else:
                pdf = original
        else:
            image = Image.open(io.BytesIO(data))
            image = ImageOps.exif_transpose(image)
            image.load()
        for panel in panels:
            label, page, region = panel["label"], panel["page"], panel["region"]
            if not isinstance(label, str) or not label.strip() or len(label) > 80 or label.casefold() in labels:
                raise ValueError("Panel labels must be nonempty and unique")
            labels.add(label.casefold())
            if type(page) is not int or page < 1 or (image is not None and page != 1):
                raise ValueError("Pages are 1-based; raster images have one page")
            if not isinstance(region, list) or len(region) != 4 or any(type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1 for n in region):
                raise ValueError("Region must contain four finite fractions between 0 and 1")
            left, top, right, bottom = region
            if left >= right or top >= bottom:
                raise ValueError("Crop region must have positive area")
            if pdf is not None:
                if page > len(pdf):
                    raise ValueError("PDF page does not exist")
                # Reuse one rendered page for all its panels without caching a whole PDF.
                if rendered_page != page:
                    if rendered_pdf is not None:
                        rendered_pdf.close()
                    p = pdf[page - 1]
                    pix = p.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
                    rendered_pdf = Image.open(io.BytesIO(pix.tobytes("png")))
                    rendered_page = page
                rendered = rendered_pdf
            else:
                rendered = image
            width, height = rendered.size
            bounds = (int(left * width), int(top * height), math.ceil(right * width), math.ceil(bottom * height))
            crop = rendered.crop(bounds).convert("RGBA")
            background = Image.new("RGBA", crop.size, "white")
            crop = Image.alpha_composite(background, crop).convert("RGB")
            buffer = io.BytesIO()
            crop.save(buffer, format="PNG")
            content = buffer.getvalue()
            name = hashlib.sha256(content).hexdigest() + ".png"
            target = inside(root, str(output.relative_to(root) / name))
            try:
                with target.open("xb") as handle:
                    handle.write(content)
            except FileExistsError:
                if target.read_bytes() != content:
                    raise ValueError("Existing crop content differs from its hash")
            results.append({"label": label, "file": target.relative_to(root).as_posix(), "page": page, "region": region,
                            "width": crop.width, "height": crop.height})
    finally:
        if rendered_pdf is not None:
            rendered_pdf.close()
        if pdf is not None:
            pdf.close()
        if image is not None:
            image.close()
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    parser.add_argument("manifest")
    parser.add_argument("--output-dir", default="figures/reader-panels")
    args = parser.parse_args()
    print(json.dumps({"panels": split(args.workspace, args.manifest, args.output_dir)}, ensure_ascii=False, indent=2))
