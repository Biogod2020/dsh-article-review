"""Focused rendering/parity and confinement checks; run with uv + Pillow/PyMuPDF."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageChops, ImageDraw
import pymupdf

from inspect_figure import inspect
from split_panels import split


class InspectFigureTests(unittest.TestCase):
    def test_flags_an_annotation_beyond_an_otherwise_blank_edge(self):
        source = self.root / "figures/annotation.png"
        image = Image.new("RGB", (400, 300), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((60, 60, 300, 120), fill="blue")
        draw.line((60, 154, 300, 154), fill="orange", width=2)
        image.save(source)
        original = source.read_bytes()
        self.spec(source, [{"label": "a", "page": 1, "region": [.1, .1, .9, .5]}])
        panel = inspect(self.root, self.manifest)["panels"][0]
        self.assertEqual(panel["edgeReview"]["nonwhiteEdgeFractions"], {})
        self.assertIn("bottom", panel["nearbySourceReview"]["nonwhiteFractions"])
        self.assertEqual(panel["pixelBounds"], [40, 30, 360, 150])
        self.assertEqual(source.read_bytes(), original)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="paper-panel-preview-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "figures").mkdir()
        (self.root / "jobs").mkdir()
        self.manifest = self.root / "jobs/request.json"

    def spec(self, source, panels=None):
        self.request = {"source": source.relative_to(self.root).as_posix(),
                        "sourceHash": hashlib.sha256(source.read_bytes()).hexdigest()}
        if panels is not None:
            self.request["panels"] = panels
        self.write_request()
        return self.request

    def write_request(self):
        self.manifest.write_text(json.dumps(self.request), encoding="utf-8")

    def png(self):
        path = self.root / "figures/source.png"
        image = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 30, 180, 130), fill="#2467ad")
        draw.rectangle((200, 150, 399, 299), fill="#d54a68")
        image.save(path)
        return path

    def assert_parity(self, result):
        actual = split(self.root, self.manifest)
        for preview, crop in zip(result["panels"], actual):
            with Image.open(self.root / preview["preview"]) as a, Image.open(self.root / crop["file"]) as b:
                self.assertEqual(a.size, b.size)
                self.assertIsNone(ImageChops.difference(a.convert("RGB"), b.convert("RGB")).getbbox())

    def test_png_grid_overlay_contact_sheet_idempotent_and_source_preserved(self):
        source = self.png()
        before = source.read_bytes()
        self.spec(source, [{"label": "a", "page": 1, "region": [0.05, 0.1, 0.5, 0.5]},
                           {"label": "b", "page": 1, "region": [0.5, 0.5, 1, 1]}])
        confirmed = self.root / "figures/reader-panels/confirmed.png"
        confirmed.parent.mkdir()
        confirmed.write_bytes(b"existing confirmed crop remains untouched")
        root_entries = set(self.root.iterdir())
        result = inspect(self.root, "jobs/request.json")
        self.assertEqual((result["pages"][0]["width"], result["pages"][0]["height"]), (400, 300))
        self.assertEqual(result["panels"][0]["pixelBounds"], [20, 30, 200, 150])
        self.assertEqual(result, inspect(self.root, self.manifest))
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(confirmed.read_bytes(), b"existing confirmed crop remains untouched")
        self.assertEqual(set(self.root.iterdir()), root_entries)
        self.assertFalse((self.root / ".paper-review").exists())
        self.assertEqual(len(result["contactSheets"]), 1)
        self.assertIn("right", result["panels"][1]["edgeReview"]["nonwhiteEdgeFractions"])
        for path in [result["pages"][0]["grid"], result["pages"][0]["overlay"], *result["contactSheets"]]:
            self.assertTrue(path.startswith("jobs/previews/"))
            with Image.open(self.root / path) as image:
                self.assertGreater(image.width, 100)
        self.assert_parity(result)

    def test_exif_orientation_matches_splitter(self):
        source = self.root / "figures/rotated.jpg"
        image = Image.new("RGB", (60, 40), "white")
        ImageDraw.Draw(image).rectangle((0, 0, 20, 20), fill="black")
        exif = image.getexif()
        exif[274] = 6
        image.save(source, exif=exif)
        self.spec(source, [{"label": "a", "page": 1, "region": [0, 0, 0.5, 1]}])
        result = inspect(self.root, self.manifest)
        self.assertEqual((result["pages"][0]["width"], result["pages"][0]["height"]), (40, 60))
        self.assert_parity(result)

    def test_pdf_two_pages_matches_splitter(self):
        source = self.root / "figures/multipage.pdf"
        with pymupdf.open() as pdf:
            for width, height in [(200, 120), (150, 250)]:
                page = pdf.new_page(width=width, height=height)
                page.insert_text((10, 30), "Panel a; axes and shared legend")
                page.draw_rect(pymupdf.Rect(20, 40, 100, 90), color=(1, 0, 0), fill=(0, 0.4, 1))
            pdf.save(source)
        self.spec(source, [{"label": "a", "page": 2, "region": [0, 0, 0.8, 0.5]}])
        result = inspect(self.root, self.manifest)
        self.assertEqual([(p["page"], p["width"], p["height"]) for p in result["pages"]], [(1, 400, 240), (2, 300, 500)])
        self.assert_parity(result)
        self.assertEqual([p["page"] for p in inspect(self.root, self.manifest, page=2)["pages"]], [2])
        with self.assertRaises(ValueError):
            inspect(self.root, self.manifest, page=3)

    def test_svg_matches_splitter(self):
        source = self.root / "figures/vector.svg"
        source.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect x="10" y="10" width="100" height="80" fill="teal"/><text x="20" y="120">a: shared legend</text></svg>')
        self.spec(source, [{"label": "a", "page": 1, "region": [0, 0, 0.8, 0.9]}])
        result = inspect(self.root, self.manifest)
        self.assertEqual((result["pages"][0]["width"], result["pages"][0]["height"]), (480, 320))
        self.assert_parity(result)

    def test_initial_grid_and_explicit_output_subdirectory(self):
        self.spec(self.png())
        result = inspect(self.root, self.manifest, output_dir="jobs/previews")
        self.assertEqual(result["panels"], [])
        self.assertEqual(result["contactSheets"], [])
        self.assertNotIn("overlay", result["pages"][0])
        self.assertTrue(result["pages"][0]["grid"].startswith("jobs/previews/"))

    def test_existing_different_preview_is_never_overwritten(self):
        self.spec(self.png())
        result = inspect(self.root, self.manifest)
        target = self.root / result["pages"][0]["grid"]
        target.write_bytes(b"user content")
        with self.assertRaisesRegex(ValueError, "Existing preview content differs"):
            inspect(self.root, self.manifest)
        self.assertEqual(target.read_bytes(), b"user content")

    def test_bad_hash_labels_regions_and_pages_do_not_write_outputs(self):
        self.spec(self.png(), [{"label": "a", "page": 1, "region": [0, 0, 1, 1]}])
        valid = json.loads(json.dumps(self.request))
        variants = [dict(valid, sourceHash="0" * 64)]
        invalid_panels = [
            [{"label": "", "page": 1, "region": [0, 0, 1, 1]}],
            [{"label": "a", "page": 1, "region": [0, 0, 1, 1]}, {"label": "A", "page": 1, "region": [0, 0, 1, 1]}],
            [{"label": "a", "page": 1, "region": [0, 0, 0, 1]}],
            [{"label": "a", "page": 1, "region": [-0.1, 0, 1, 1]}],
            [{"label": "a", "page": 1, "region": [0, 0, float("nan"), 1]}],
            [{"label": "a", "page": 1, "region": [False, 0, 1, 1]}],
            [{"label": "a", "page": 0, "region": [0, 0, 1, 1]}],
            [{"label": "a", "page": True, "region": [0, 0, 1, 1]}],
            [{"label": "a", "page": 2, "region": [0, 0, 1, 1]}],
        ]
        variants.extend(dict(valid, panels=panels) for panels in invalid_panels)
        for request in variants:
            with self.subTest(request=request):
                self.request = request
                self.write_request()
                with self.assertRaises(ValueError):
                    inspect(self.root, self.manifest)
                self.assertFalse((self.root / "jobs/previews").exists())

    def test_path_and_symlink_confinement(self):
        source = self.png()
        self.spec(source)
        with tempfile.TemporaryDirectory(prefix="outside-preview-") as outside:
            outside = Path(outside)
            external = outside / "source.png"
            external.write_bytes(source.read_bytes())
            linked = self.root / "figures/linked.png"
            linked.symlink_to(external)
            for escaped in [str(external), "figures/linked.png"]:
                with self.subTest(source=escaped):
                    self.request["source"] = escaped
                    self.write_request()
                    with self.assertRaises(ValueError):
                        inspect(self.root, self.manifest)
            self.spec(source)
            (self.root / "jobs/linked").symlink_to(outside, target_is_directory=True)
            for escaped in [str(outside), "jobs/linked", "../outside", ".paper-review/previews", "."]:
                with self.subTest(output=escaped), self.assertRaises(ValueError):
                    inspect(self.root, self.manifest, output_dir=escaped)
            external_manifest = outside / "request.json"
            external_manifest.write_text(self.manifest.read_text())
            with self.assertRaises(ValueError):
                inspect(self.root, external_manifest)
            self.assertEqual(set(outside.iterdir()), {external, external_manifest})


if __name__ == "__main__":
    unittest.main()
