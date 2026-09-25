/** Figure references stay lightweight and resolve only within the review workspace. */
import { expect, it } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { authoredFigureBase, collectFigures, figureFilePath } from '../src/client/figures.ts'

it('lists captioned PDFs and Markdown images without embedding them', () => {
  const revision = parseRevision('# Paper\n\n> **Figure [fig:overview]** (`figures/fig1.pdf`): Overview.\n\n![Microscopy](figures/case.png)\n')
  expect(collectFigures(revision.blocks)).toEqual([
    { blockId: revision.blocks[1]?.id, label: 'Figure [fig:overview]', path: 'figures/fig1.pdf' },
    { blockId: revision.blocks[2]?.id, label: 'Microscopy', path: 'figures/case.png' },
  ])
})

it('resolves an authored base and ignores remote or traversing destinations', () => {
  const revision = parseRevision('![Remote](https://example.org/a.png)\n\n![Outside](../secret.pdf)\n\n![Good](figures/a.svg)')
  expect(collectFigures(revision.blocks)).toMatchObject([{ label: 'Good', path: 'figures/a.svg' }])
  expect(figureFilePath('drafts/article.md', '', 'figures/a.svg')).toBe('drafts/figures/a.svg')
  expect(figureFilePath('drafts/article.md', 'tmp/md-convert-055', 'figures/a.svg')).toBe('tmp/md-convert-055/figures/a.svg')
  expect(figureFilePath('drafts/article.md', '', '../secret.pdf')).toBeUndefined()
})

it('uses only the unique figure root explicitly declared in the opening Markdown provenance', () => {
  const source = '<!--\nFigure PDFs stay in iclr2027-v0.5.5-20260924/; captions are inline.\n-->\n\n# Paper'
  expect(authoredFigureBase(source)).toBe('iclr2027-v0.5.5-20260924')
  expect(figureFilePath('article.md', authoredFigureBase(source), 'figures/fig1.pdf'))
    .toBe('iclr2027-v0.5.5-20260924/figures/fig1.pdf')
  expect(authoredFigureBase('<!-- Figure PDFs stay in ../other/; -->')).toBe('')
  expect(authoredFigureBase('<!-- Figure PDFs stay in a/; Figure PDFs stay in b/; -->')).toBe('')
  expect(authoredFigureBase('# No provenance\n\nFigure PDFs stay in a/;')).toBe('')
})
