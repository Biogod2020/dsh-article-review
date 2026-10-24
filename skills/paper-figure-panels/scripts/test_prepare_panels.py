"""Run with uv --with pillow --with pymupdf python -m unittest discover -s scripts."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw
import pymupdf

from prepare_panels import prepare, packet_blocks
from split_panels import split


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.paper = self.root / "papers/demo"
        self.paper.mkdir(parents=True)
        self.text = "Panel a: α marker, exact text.\n\nPanel b: complete second paragraph.\n"
        (self.paper / "article.md").write_text(self.text)
        image = Image.new("RGB", (220, 120), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 90, 100), fill="blue")
        draw.rectangle((130, 10, 210, 100), fill="orange")
        image.save(self.paper / "figure.png")
        self.hash = hashlib.sha256((self.paper / "figure.png").read_bytes()).hexdigest()
        self.revision = hashlib.sha256((self.paper / "article.md").read_bytes()).hexdigest()
        self.packet = {"version": 1, "workspaceRoot": str(self.root.resolve()), "path": "papers/demo/article.md", "revision": self.revision,
                       "figures": [{"blockId": "fig-opaque", "path": "figure.png", "file": "papers/demo/figure.png", "sourceHash": self.hash}],
                       "blocks": [{"id": "opaque-a", "kind": "paragraph", "text": self.text.split("\n\n")[0]},
                                  {"id": "opaque-b", "kind": "paragraph", "text": self.text.split("\n\n")[1].rstrip()}]}
        self.manifest = {"source": "papers/demo/figure.png", "sourceHash": self.hash,
                         "panels": [{"label": "a", "page": 1, "region": [0, 0, .5, 1]},
                                    {"label": "b", "page": 1, "region": [.5, 0, 1, 1]}]}
        self.write("packet.json", self.packet)
        self.write("regions.json", self.manifest)
        self.write("targets.json", {"a": ["opaque-a"], "b": ["opaque-b"]})

    def write(self, name, data):
        (self.paper / name).write_text(json.dumps(data, ensure_ascii=False))

    def run_prepare(self, output="papers/demo/work/registration.json"):
        return prepare(self.root, "papers/demo/packet.json", "papers/demo/regions.json", "papers/demo/targets.json", output)

    def test_exact_targets_nested_outputs_and_idempotence(self):
        before = (self.paper / "article.md").read_bytes(), (self.paper / "figure.png").read_bytes()
        result = self.run_prepare()
        saved = json.loads((self.root / result["manifest"]).read_text())
        self.assertEqual(saved["workspaceRoot"], str(self.root.resolve()))
        self.assertEqual(result["path"], self.packet["path"])
        self.assertEqual(saved["panels"][0]["targets"], [{"blockId": "opaque-a", "before": self.packet["blocks"][0]["text"]}])
        self.assertEqual(saved["figure"], "figure.png")
        self.assertEqual(result["panelCount"], 2)
        self.assertTrue(result["previews"]["contactSheets"])
        self.assertTrue(all(p["file"].startswith("papers/demo/figures/reader-panels/") for p in result["panels"]))
        self.assertFalse((self.root / "figures").exists())
        self.assertNotIn('"before"', json.dumps(result))
        self.assertEqual(result, self.run_prepare())
        self.assertEqual(before, ((self.paper / "article.md").read_bytes(), (self.paper / "figure.png").read_bytes()))

    def test_stale_manuscript_and_artwork_refuse_before_registration(self):
        (self.paper / "article.md").write_text(self.text + "Changed")
        with self.assertRaisesRegex(ValueError, "Manuscript changed"):
            self.run_prepare()
        (self.paper / "article.md").write_text(self.text)
        self.manifest["sourceHash"] = "0" * 64
        self.write("regions.json", self.manifest)
        with self.assertRaisesRegex(ValueError, "Source hash"):
            self.run_prepare()
        self.assertFalse((self.paper / "work/registration.json").exists())

    def test_query_returns_only_matching_whole_blocks_and_exact_ids(self):
        result = packet_blocks(self.root, "papers/demo/packet.json", r"Panel a")
        self.assertEqual(result["matches"], 1)
        self.assertEqual(result["blocks"][0], {"index": 0, **self.packet["blocks"][0]})
        self.assertFalse((self.paper / "figures").exists())

    def test_identical_workspace_copy_cannot_reuse_target_context(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory).resolve() / "copy"
            shutil.copytree(self.root, copied)
            with self.assertRaisesRegex(ValueError, "different workspace"):
                prepare(copied, "papers/demo/packet.json", "papers/demo/regions.json", "papers/demo/targets.json", "result.json")
            with self.assertRaisesRegex(ValueError, "different workspace"):
                packet_blocks(copied, "papers/demo/packet.json", "Panel")
            self.assertFalse((copied / "result.json").exists())
            self.assertFalse((copied / "papers/demo/figures").exists())

    def test_legacy_packet_still_produces_a_workspace_bound_registration(self):
        self.packet.pop("workspaceRoot")
        self.write("packet.json", self.packet)
        result = self.run_prepare()
        self.assertEqual(json.loads((self.root / result["manifest"]).read_text())["workspaceRoot"], str(self.root.resolve()))

    def test_unknown_missing_duplicate_and_malformed_targets(self):
        for selected in [{"a": ["missing"], "b": ["opaque-b"]}, {"a": ["opaque-a"]},
                         {"a": ["opaque-a", "opaque-a"], "b": ["opaque-b"]},
                         {"a": [{}], "b": ["opaque-b"]}]:
            with self.subTest(targets=selected):
                self.write("targets.json", selected)
                with self.assertRaises(ValueError):
                    self.run_prepare()
        self.assertFalse((self.paper / "work/registration.json").exists())

    def test_ambiguous_source_requires_exact_figure_block(self):
        self.packet["figures"].append(self.packet["figures"][0] | {"blockId": "other-figure"})
        self.write("packet.json", self.packet)
        with self.assertRaisesRegex(ValueError, "Choose one packet figure"):
            self.run_prepare()
        self.manifest["figureBlockId"] = "fig-opaque"
        self.write("regions.json", self.manifest)
        self.assertEqual(self.run_prepare()["figureBlockId"], "fig-opaque")

    def test_output_paths_and_overwrite_are_protected(self):
        for output in ["papers/demo/packet.json", "../outside.json", ".paper-review/new.json", ".PAPER-REVIEW/new.json", "papers/demo/figure.png"]:
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.run_prepare(output)
        self.run_prepare()
        self.write("targets.json", {"a": ["opaque-b"], "b": ["opaque-a"]})
        with self.assertRaisesRegex(ValueError, "different data"):
            self.run_prepare()

    def test_pdf_reuses_page_render_and_keeps_all_crop_pixels(self):
        pdf = pymupdf.open()
        page = pdf.new_page(width=220, height=120)
        page.draw_rect(pymupdf.Rect(10, 10, 90, 100), color=(0, 0, 1), fill=(0, 0, 1))
        pdf.save(self.paper / "figure.pdf")
        pdf.close()
        data = (self.paper / "figure.pdf").read_bytes()
        spec = {"source": "papers/demo/figure.pdf", "sourceHash": hashlib.sha256(data).hexdigest(),
                "panels": [self.manifest["panels"][0] | {"label": str(i)} for i in range(8)]}
        self.write("pdf.json", spec)
        original = pymupdf.Page.get_pixmap
        calls = []
        def render(page, *args, **kwargs):
            calls.append(page.number)
            return original(page, *args, **kwargs)
        with patch.object(pymupdf.Page, "get_pixmap", render):
            result = split(self.root, self.paper / "pdf.json", "papers/demo/pdf-crops")
        self.assertEqual(calls, [0])
        self.assertEqual(len(result), 8)
        self.assertEqual(len({p["file"] for p in result}), 1)


if __name__ == "__main__":
    unittest.main()
