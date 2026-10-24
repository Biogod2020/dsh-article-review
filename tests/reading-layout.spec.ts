/** Page boundaries and figure associations follow authored evidence. */
import { expect, it } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { collectFigures } from '../src/figures.ts'
import { readingSections, sectionForBlock } from '../src/client/reading-sections.ts'
import { readingFigures, relatedReadingFigures } from '../src/client/reading-figures.ts'
import type { FigurePanel } from '../src/figure-panels.ts'
import { readingColumnRatio, resolveFigurePlacement } from '../src/client/figure-layout.ts'

it('gives wide diagrams the full reading width while respecting manual placement and usable columns', () => {
  expect(resolveFigurePlacement(1200, 4, 'auto')).toBe('top')
  expect(resolveFigurePlacement(1200, .8, 'auto')).toBe('side')
  expect(resolveFigurePlacement(680, .8, 'auto')).toBe('top')
  expect(resolveFigurePlacement(1200, 4, 'side')).toBe('side')
  expect(resolveFigurePlacement(1200, .8, 'top')).toBe('top')
  expect(readingColumnRatio(.1, 1000) * 1000).toBeGreaterThanOrEqual(320)
  expect((1 - readingColumnRatio(.95, 1000)) * 1000).toBeGreaterThanOrEqual(260)
})

it('keeps blocks whole across nested headings and restores the page containing an exact block', () => {
  const revision = parseRevision('# Paper\n\nOpening.\n\n## Results\n\nA full paragraph.\n\n### Analysis\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n## Discussion\n\nLast.\n')
  const sections = readingSections(revision.blocks)
  expect(sections.map(section => section.title)).toEqual(['Paper', 'Results', 'Analysis', 'Discussion'])
  expect(sections.flatMap(section => section.blocks)).toEqual(revision.blocks)
  expect(sectionForBlock(sections, revision.blocks.at(-1)?.id)).toBe(3)
  expect(sectionForBlock(sections, 'removed')).toBe(0)
  expect(readingSections(parseRevision('One paragraph.\n\nAnother.').blocks)).toHaveLength(1)
  expect(readingSections(parseRevision('Title\n=====\n\nIntroduction\n------------\n\nText.').blocks).map(section => section.title)).toEqual(['Title', 'Introduction'])
})

it('offers whole figures and exact panels, rejects stale targets and avoids Fig 1 / Fig 10 confusion', () => {
  const revision = parseRevision('# Paper\n\nAs shown in Fig. 1a, the values differ.\n\nSee Figure 10.\n\n> **Figure 1** (`one.png`): A caption.\n')
  const figures = collectFigures(revision.blocks)
  const figure = figures[0]!, block = revision.blocks[1]!
  const panel: FigurePanel = { id: 'one:a', figureBlockId: figure.blockId, figure: figure.path, label: 'a',
    sourceHash: 'a'.repeat(64), sourceFile: 'one.png', file: 'figures/panel.png', hash: 'b'.repeat(64),
    page: 1, region: [0, 0, .5, 1], targets: [{ blockId: block.id, before: block.text }] }
  const items = readingFigures('article.md', '', revision, figures, [panel])
  expect(items.map(item => item.file)).toEqual(['one.png', 'figures/panel.png'])
  expect(relatedReadingFigures(block, items).map(item => item.key)).toEqual(['panel:one:a', `${figure.blockId}:one.png`])
  expect(relatedReadingFigures(revision.blocks[2], items)).toEqual([])
  expect(readingFigures('article.md', '', revision, figures, [{ ...panel, stale: true }])).toHaveLength(1)
  const changed = { ...revision, blocks: revision.blocks.map(candidate => candidate.id === block.id ? { ...candidate, text: 'Changed.' } : candidate) }
  expect(readingFigures('article.md', '', changed, figures, [panel])).toHaveLength(1)
})
