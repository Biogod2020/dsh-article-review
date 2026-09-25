/** Rendered differences stay local to changed words, including inside inline Markdown. */
import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { normalizeLegacyTableDividers } from '../src/client/legacy-tables.ts'
import { ReaderText } from '../src/client/reader-text.tsx'
import { rangesForChangedSpans, renderedChangePair, renderedChangeSpans, RenderedDiffText } from '../src/client/rendered-diff.tsx'
import { parseRevision } from '../src/document.ts'

const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

it('renders an em-dash manuscript table as a semantic table without changing source records', () => {
  const source = '| Class | Ground truth $n$ | Precision (%) |\n| — | — | — |\n| **Class A** | 150 | 93.2% |\n| **Overall** | 400 | — |'
  const block = parseRevision(source).blocks[0]!
  const dom = new JSDOM('')
  vi.stubGlobal('DOMParser', dom.window.DOMParser)
  vi.stubGlobal('Node', dom.window.Node)
  let html: string
  try { html = renderToStaticMarkup(<ReaderText block={block} highlights={[]} annotations={[]} labels={labels} />) }
  finally { vi.unstubAllGlobals() }
  const document = new JSDOM(html).window.document
  expect(document.querySelectorAll('table thead th')).toHaveLength(3)
  expect(document.querySelectorAll('table tbody tr')).toHaveLength(2)
  expect(document.querySelector('table tbody tr:last-child td:last-child')?.textContent).toBe('—')
  expect(block.text).toBe(source)
  expect(renderedChangeSpans(source.replace('93.2%', '92.2%'), source, 'after')).toBeUndefined()
})

it('renders legacy tables in proposal comparisons while leaving prose and fenced code unchanged', () => {
  const before = '| Class | F1 |\n| — | — |\n| A | 0.919 |'
  const after = before.replace('0.919', '0.920')
  const html = renderToStaticMarkup(<RenderedDiffText text={after} opposite={before} side="after" labels={labels} />)
  const table = new JSDOM(html).window.document.querySelector('table')
  expect(table?.querySelectorAll('tbody td')).toHaveLength(2)
  expect(table?.outerHTML).toMatchSnapshot('legacy em-dash table')
  expect(normalizeLegacyTableDividers('A — B\n\n```md\n| A | B |\n| — | — |\n| x | y |\n```'))
    .toBe('A — B\n\n```md\n| A | B |\n| — | — |\n| x | y |\n```')
})

it('marks only replaced words in a long rendered block', () => {
  const shared = 'The screening reference stays fixed across all datasets. '.repeat(30)
  const before = `${shared}The fixed human-review reference covers 400 studies. ${shared}`
  const after = `${shared}The historical human-review reference covers 400 studies. ${shared}`
  const old = renderedChangeSpans(before, after, 'before')!
  const revised = renderedChangeSpans(before, after, 'after')!
  expect(old.spans.map(span => old.text.slice(span.offset, span.offset + span.length))).toEqual(['fixed'])
  expect(revised.spans.map(span => revised.text.slice(span.offset, span.offset + span.length))).toEqual(['historical'])
})

it('compares visible words across Markdown formatting without coloring the entire paragraph', () => {
  const before = 'Performance was **higher** in three datasets.'
  const after = 'Performance improved in three datasets.'
  const old = renderedChangeSpans(before, after, 'before')!
  const revised = renderedChangeSpans(before, after, 'after')!
  expect(old.spans.map(span => old.text.slice(span.offset, span.offset + span.length))).toEqual(['was', 'higher'])
  expect(revised.spans.map(span => revised.text.slice(span.offset, span.offset + span.length))).toEqual(['improved'])
  expect(renderedChangeSpans('The **same** claim.', 'The same claim.', 'after')?.spans).toEqual([])
})

it('maps a long pipe-delimited manuscript paragraph to its rendered text', () => {
  const before = 'Population | | — | | Operational screening | | Fixed screening reference | | Reconstruction experiment | | Fixed human-review reference | | Public HESRT resource (release 2026-09-17–v1) |'
  const after = before.replace('Fixed human-review reference', 'Historical human-review reference')
  const comparison = renderedChangeSpans(before, after, 'before')!
  const html = renderToStaticMarkup(<MarkdownText text={before}
    labels={{ code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }} />)
  expect(new JSDOM(html).window.document.body.textContent).toBe(comparison.text)
  expect(comparison.spans.map(span => comparison.text.slice(span.offset, span.offset + span.length))).toEqual(['Fixed'])
})

it('can mark literal HTML comments without executing them', () => {
  const before = '<!-- Source: package-v1. Do not edit this manuscript by hand. -->'
  const after = '<!-- Source: package-v2. Do not edit this manuscript by hand. -->'
  const comparison = renderedChangeSpans(before, after, 'before')!
  const html = renderToStaticMarkup(<MarkdownText text={before}
    labels={{ code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }} />)
  expect(new JSDOM(html).window.document.body.textContent).toBe(comparison.text)
  expect(comparison.spans.map(span => comparison.text.slice(span.offset, span.offset + span.length))).toContain('v1')
})

it('maps repeated changed words across inline nodes without selecting an earlier occurrence', () => {
  const before = 'A **bold** and **bold** claim.'
  const after = 'A **bold** and **clear** claim.'
  const comparison = renderedChangePair(before, after)!
  const html = renderToStaticMarkup(<MarkdownText text={before}
    labels={{ code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }} />)
  const root = new JSDOM(html).window.document.body
  expect(root.textContent).toBe(comparison.before.text)
  const ranges = rangesForChangedSpans(root, comparison.before.spans)
  expect(ranges.map(range => range.toString())).toEqual(['bold'])
  expect(ranges[0]?.startContainer.parentElement).toBe(root.querySelectorAll('strong')[1])
})
