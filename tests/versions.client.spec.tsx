/** Historical comparison renders full source without advancing the author-confirmed baseline. */
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { Versions } from '../src/client/versions.tsx'
import { en, zh } from '../src/client/locales.ts'
import { DocumentSchema } from '../src/schema.ts'
import { parseRevision } from '../src/document.ts'

it.each([en, zh])('renders readable Markdown by default and retains source comparison controls', (copy) => {
  const date = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026-09-22 12:00')
  try {
    const revisions = ['Original **claim**.', 'Revised **claim**.', 'Qualified **claim**.'].map((body, index) => {
      const parsed = parseRevision(`## Finding\n\n${body}`)
      return { ...parsed, id: `revision-${index}`, blocks: parsed.blocks.map((block, blockIndex) => ({ ...block, id: `block-${blockIndex}` })), createdAt: '2026-09-22T04:00:00Z' }
    })
    const document = DocumentSchema.parse({ schemaVersion: 1, path: 'paper.md', revisions, current: revisions[2],
      annotations: [], proposals: [], baselines: [], history: [], reading: {} })
    const before = JSON.stringify(document)
    const html = renderToStaticMarkup(<Versions document={document} t={key => copy[key]} />)
    expect(html).toContain('<h2>Finding</h2>')
    expect(html).toContain('<strong>claim</strong>')
    expect(html).toContain(copy.renderedPages)
    expect(html).toContain(copy.sideBySide)
    expect(html).toContain('value="2" selected=""')
    expect(JSON.stringify(document)).toBe(before)
    expect(html.replace(/ class="[^"]*"/g, '')).toMatchSnapshot()
  } finally { date.mockRestore() }
})
