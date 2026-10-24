"""Meaningful source, format, media and no-overwrite checks; run in helper uv env."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from import_article import normalize, sha


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_text_idempotence_and_edited_project(self):
        source = self.root / 'draft.txt'
        source.write_text('标题\n\nExact α = 0.05. This is an article.\n')
        before = sha(source)
        result = normalize(self.root, source)
        article = self.root / result['manuscript']
        self.assertIn('Exact α = 0.05.', article.read_text())
        self.assertEqual(result['figureCount'], 0)
        self.assertTrue(normalize(self.root, source)['reused'])
        article.write_text(article.read_text() + '\nAuthor edit.\n')
        with self.assertRaisesRegex(ValueError, 'already exists or was edited'):
            normalize(self.root, source)
        self.assertEqual(sha(source), before)

    def test_media_and_escape(self):
        from PIL import Image
        source = self.root / 'draft.md'
        Image.new('RGB', (40, 30), 'blue').save(self.root / 'whole.png')
        source.write_text('# Draft\n\nPanel a shows a result (Figure 1a).\n\n![Figure 1](whole.png)\n')
        result = normalize(self.root, source)
        self.assertEqual(result['figureCount'], 1)
        article = self.root / result['manuscript']
        record = json.loads((article.parent / 'import.json').read_text())
        self.assertTrue((article.parent / record['figures'][0]['file']).is_file())
        (article.parent / record['figures'][0]['file']).write_bytes(b'changed image')
        with self.assertRaisesRegex(ValueError, 'already exists or was edited'):
            normalize(self.root, source)
        source.write_text('> **Figure 1** (`whole.png`): Original caption.\n')
        self.assertEqual(normalize(self.root, source)['figureCount'], 1)
        source.write_text('![Figure](../outside.png)\n')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            normalize(self.root, source)

    def test_docx_tex_html_and_unicode(self):
        import pypandoc
        from PIL import Image
        Image.new('RGB', (40, 30), 'blue').save(self.root / 'figure.png')
        text = '# Results\n\nMeasured $x = 2$.\n\n![Figure 1](figure.png)\n\n| Arm | Count |\n| --- | --- |\n| A | 12 |\n'
        (self.root / 'fixture.md').write_text(text)
        subprocess.run([pypandoc.get_pandoc_path(), 'fixture.md', '-o', 'fixture.docx'], cwd=self.root, check=True)
        (self.root / 'part.tex').write_text(r'\section{Results} Measured $x = 2$. \includegraphics[width=4cm]{figure.png}')
        (self.root / 'main.tex').write_text(r'\documentclass{article}\begin{document}\input{part}\end{document}')
        (self.root / 'paper.html').write_text('<h1>Results</h1><p>Measured x = 2.</p><img src="figure.png" />')
        for name in ['fixture.docx', 'main.tex', 'paper.html']:
            with self.subTest(name=name):
                result = normalize(self.root, self.root / name)
                article = (self.root / result['manuscript']).read_text()
                self.assertIn('Measured', article)
                self.assertEqual(result['figureCount'], 1)
                self.assertNotIn('.article-import-', article)
        (self.root / 'unicode.txt').write_bytes('中文段落\n\nMore text.'.encode('utf-16'))
        result = normalize(self.root, self.root / 'unicode.txt')
        self.assertIn('中文段落', (self.root / result['manuscript']).read_text())

    def test_tex_include_escape(self):
        source = self.root / 'bad.tex'
        source.write_text(r'\input{../private}')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            normalize(self.root, source)

    def test_html_external_image_is_not_fetched(self):
        source = self.root / 'external.html'
        source.write_text('<h1>Article</h1><p>Local article text.</p><img alt="Figure 1" src=http://127.0.0.1:1/private>')
        result = normalize(self.root, source)
        self.assertEqual(result['figureCount'], 0)
        self.assertTrue(any('External image not downloaded' in warning for warning in result['warnings']))

    def test_plain_notation_stays_literal(self):
        source = self.root / 'notation.txt'
        source.write_text('Gene <TP53> & *literal notation*.\n\n![Figure 1](absent.png)\n')
        result = normalize(self.root, source)
        article = (self.root / result['manuscript']).read_text()
        self.assertIn('&lt;TP53&gt;', article)
        self.assertIn('\\*literal notation\\*', article)
        self.assertIn('!\\[Figure 1\\]', article)
        self.assertEqual(result['figureCount'], 0)


if __name__ == '__main__':
    unittest.main()
