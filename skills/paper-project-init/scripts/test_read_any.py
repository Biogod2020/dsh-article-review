"""Tests for read_any.py on small files built here with the standard library."""
import io, json, subprocess, sys, tarfile, tempfile, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def run(path, *extra):
    return subprocess.run([sys.executable, '-B', str(HERE / 'read_any.py'), str(path), *extra], capture_output=True, text=True, check=True).stdout


def main():
    d = Path(tempfile.mkdtemp())
    docx = d / 'a.docx'
    with zipfile.ZipFile(docx, 'w') as z:
        z.writestr('word/document.xml', f'<w:document {W}><w:body>'
                   '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>'
                   '<w:p><w:r><w:t>We found 4,321 samples.</w:t></w:r><w:del><w:r><w:delText>old</w:delText></w:r></w:del></w:p>'
                   '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
                   '</w:body></w:document>')
        z.writestr('word/comments.xml', f'<w:comments {W}><w:comment w:author="Reviewer 2"><w:p><w:r><w:t>Check this</w:t></w:r></w:p></w:comment></w:comments>')
    out = run(docx)
    assert '# Results' in out and '4,321' in out and '[-old-]' in out and 'a\t1' in out and 'Reviewer 2: Check this' in out, out
    xlsx = d / 'b.xlsx'
    S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(xlsx, 'w') as z:
        z.writestr('xl/workbook.xml', f'<workbook {S}><sheets><sheet name="counts"/></sheets></workbook>')
        z.writestr('xl/sharedStrings.xml', f'<sst {S}><si><t>organ</t></si><si><t>brain</t></si></sst>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet {S}><sheetData><row><c t="s"><v>0</v></c><c><v>2</v></c></row><row><c t="s"><v>1</v></c><c><v>3298</v></c></row></sheetData></worksheet>')
    out = run(xlsx)
    assert '## Sheet: counts' in out and 'organ\t2' in out and 'brain\t3298' in out, out
    pptx = d / 'c.pptx'
    A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    with zipfile.ZipFile(pptx, 'w') as z:
        z.writestr('ppt/slides/slide1.xml', f'<p:sld xmlns:p="x" {A}><a:p><a:r><a:t>Atlas overview</a:t></a:r></a:p></p:sld>')
    assert 'Atlas overview' in run(pptx)
    arc = d / 'bundle.zip'
    with zipfile.ZipFile(arc, 'w') as z:
        z.write(docx, 'inner/a.docx')
        z.writestr('results/summary.csv', 'organ,n\nbrain,3298\nliver,770\n')
    listing = run(arc)
    assert 'inner/a.docx' in listing and 'results/summary.csv' in listing, listing
    assert '4,321' in run(arc, '--member', 'inner/a.docx')
    assert '(2 data rows' in run(arc, '--member', 'results/summary.csv')
    tgz = d / 'r.tar.gz'
    with tarfile.open(tgz, 'w:gz') as t:
        data = json.dumps({'samples': 4321, 'organs': ['brain', 'liver']}).encode()
        info = tarfile.TarInfo('out/stats.json'); info.size = len(data); t.addfile(info, io.BytesIO(data))
    assert 'out/stats.json' in run(tgz)
    assert 'Structure: {samples: int' in run(tgz, '--member', 'out/stats.json')
    nb = d / 'n.ipynb'
    nb.write_text(json.dumps({'cells': [{'cell_type': 'code', 'source': ['print(1)'], 'outputs': [{'text': ['1\n']}]}]}))
    assert 'print(1)' in run(nb) and 'Output:' in run(nb)
    long = d / 'long.txt'
    long.write_text('x' * 50)
    assert '--offset 20' in run(long, '--max-chars', '20')
    print('read_any: all checks passed')


if __name__ == '__main__':
    main()
