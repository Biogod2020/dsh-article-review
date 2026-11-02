"""End-to-end test of init_project.py, page_tools.py and check_project.py on a two-page PDF built here.

A raw paste of the text layer must fail the check; a clean copy with a cut figure must pass it.
Run with pymupdf and pillow: uv run --with pymupdf==1.26.7 --with pillow==12.3.0 python -B test_init_check.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

PARAS = [
    'Coral reef surveys record fish counts by hand, but each survey team stores its counts in a different format that blocks comparison across '
    'regions and decades. We built a tool that converts every published survey into one table and checks each record before release.',
    'Across 642 surveys the tool recovered locations for 5,317 transects, and field experts accepted 88.6% of them. The remaining failures trace to '
    'missing coordinates in the original reports rather than to the conversion itself, which we document transect by transect.',
]
CAPTION = 'Figure 1 | Overview of the workflow. Surveys are found, converted and reviewed before release.'


def run(*args):
    return subprocess.run([sys.executable, '-B', *map(str, args)], capture_output=True, text=True)


def build_pdf(path: Path) -> None:
    import pymupdf
    doc = pymupdf.open()
    for n in range(2):
        pg = doc.new_page(width=595, height=842)
        pg.insert_text((60, 40), 'Reef survey archive', fontsize=8)  # running head on every page
        if n == 0:
            pg.insert_textbox(pymupdf.Rect(60, 70, 535, 330), PARAS[0], fontsize=11)
            pg.draw_rect(pymupdf.Rect(120, 350, 470, 560), color=(0, 0, 0), fill=(0.6, 0.75, 0.9))
            pg.insert_text((130, 380), 'a', fontsize=14)
            pg.insert_text((300, 380), 'b', fontsize=14)
            pg.insert_textbox(pymupdf.Rect(60, 575, 535, 640), CAPTION, fontsize=10)
        else:
            pg.insert_textbox(pymupdf.Rect(60, 70, 535, 330), PARAS[1], fontsize=11)
        pg.insert_text((290, 820), str(n + 1), fontsize=8)
    doc.save(path)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        build_pdf(ws / 'paper.pdf')
        r = run(HERE / 'init_project.py', ws, '--source', 'paper.pdf', '--output', 'proj')
        assert r.returncode == 0, r.stderr
        proj = ws / 'proj'
        info = json.loads(r.stdout)
        assert info['pages'] == 2 and (proj / 'reading/pages/p001.png').is_file() and json.loads((proj / 'project.json').read_text())['sections'] == []

        # a raw paste of the text layer: line breaks, running head, caption in the body
        p = json.loads((proj / 'project.json').read_text())
        raw = [(proj / f'reading/text/p00{n}.txt').read_text() for n in (1, 2)]
        p['sections'] = [{'id': 's1', 'heading': 'Body', 'beat': '', 'paragraphs': [{'id': f's1-p{k}', 'text': t, 'claims': [], 'basis': {}} for k, t in enumerate(raw, 1)]}]
        (proj / 'project.json').write_text(json.dumps(p))
        r = run(HERE / 'check_project.py', ws, 'proj')
        out = json.loads(r.stdout)
        assert r.returncode == 1 and out['transcription']['formatProblems'] >= 2, out

        # a clean copy, the figure cut from the page and its two panels from the figure
        r = run(HERE / 'page_tools.py', 'crop', proj, 'reading/pages/p001.png', '--box', '195', '410', '795', '668', '--out', 'assets/F1.png')
        assert r.returncode == 0 and json.loads(r.stdout)['ink'] > 0.3, r.stdout + r.stderr
        for label, box in (('a', ('0', '0', '500', '1000')), ('b', ('500', '0', '1000', '1000'))):
            r = run(HERE / 'page_tools.py', 'crop', proj, 'assets/F1.png', '--box', *box, '--pad', '0', '--out', f'assets/F1{label}.png')
            assert r.returncode == 0, r.stderr
        r = run(HERE / 'page_tools.py', 'grid', proj, 'reading/pages/p001.png')
        assert r.returncode == 0 and (proj / 'reading/grid/p001.png').is_file(), r.stderr
        p['sections'] = [{'id': 's1', 'heading': 'Body', 'beat': '', 'paragraphs': [{'id': f's1-p{k}', 'text': t, 'claims': [], 'basis': {}} for k, t in enumerate(PARAS, 1)]}]
        p['figures'] = [{'id': 'F1', 'label': 'Fig. 1', 'title': 'Overview of the workflow', 'caption': CAPTION.split('| ')[1], 'placement': 'main', 'file': 'assets/F1.png',
                         'panels': [{'label': x, 'image': f'assets/F1{x}.png', 'note': '', 'spare': True} for x in 'ab']}]
        (proj / 'project.json').write_text(json.dumps(p))
        r = run(HERE / 'check_project.py', ws, 'proj')
        out = json.loads(r.stdout)
        t = out['transcription']
        assert t['formatProblems'] == 0 and t['reworded'] == 0 and t['coverage'] > 0.9, out
        assert not any('格式' in h or '抄录' in h or '图片' in h for h in out['hard']), out['hard']

        # a paraphrase is caught
        p['sections'][0]['paragraphs'][1]['text'] = 'Our tool handled several hundred reports and most of its output was approved by people who looked at it carefully, which is encouraging.'
        (proj / 'project.json').write_text(json.dumps(p))
        out = json.loads(run(HERE / 'check_project.py', ws, 'proj').stdout)
        assert out['transcription']['reworded'] == 1, out
    print('init/check: all checks passed')


if __name__ == '__main__':
    main()
