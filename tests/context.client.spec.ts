/** Deterministic prompt snapshot for both interface languages; no provider request is made. */
import { expect, it } from 'vitest'
import { reviewContext } from '../src/client/context.ts'
import { en, zh } from '../src/client/locales.ts'
import type { PaperDocument } from '../src/schema.ts'

it.each([en, zh])('attaches local context and the exact reader version', (copy) => {
  const blocks = ['Excluded title', 'Prior paragraph', 'Selected paragraph', 'Next paragraph', 'Excluded ending']
    .map((text, i) => ({ id: `block-${i}`, kind: 'paragraph', section: 'Results', text, start: 0, end: text.length }))
  const current = { id: 'reader-revision', text: blocks.map(b => b.text).join('\n\n'), blocks, createdAt: '2026-01-01' }
  const document: PaperDocument = { schemaVersion: 1, path: 'article.md', current, revisions: [current],
    annotations: [], highlights: [], proposals: [], baselines: [], history: [], reading: {} }
  const text = reviewContext(document, [], blocks[2], copy.batchIntent, copy)
  expect(text).toContain(current.id)
  expect(text).toContain('Selected paragraph')
  expect(text).not.toContain('Excluded')
  expect(text).toMatchSnapshot()
})
