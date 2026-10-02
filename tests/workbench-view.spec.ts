import { expect, it } from 'vitest'
import { parseRevision } from '../src/document.ts'
import type { PaperView } from '../src/schema.ts'
import { workbenchView, WorkbenchViewSchema } from '../src/workbench-view.ts'

it('keeps current source and review state exact while projecting only the historical index', () => {
  const revisions = Array.from({ length: 12 }, (_, index) => parseRevision(`## Result\n\nExact **source** ${index}.\n`))
  const current = revisions.at(-1)!
  const view: PaperView = { diskChanged: true, document: { schemaVersion: 1, path: 'article.md', current,
    revisions, annotations: [], highlights: [], proposals: [], baselines: [{ blockId: current.blocks[1]!.id,
      revision: revisions[0]!.id, text: 'Previously reviewed source.', locked: true, reviewedAt: '2026-10-03' }],
    history: [{ at: '2026-10-03', action: 'accepted', detail: 'P1' }], reading: { session: current.blocks[1]!.id } } }
  const before = JSON.stringify(view)
  const projected = workbenchView(view)
  expect(projected.document.current).toBe(current)
  expect(projected.document.baselines).toBe(view.document.baselines)
  expect(projected.document.revisions).toEqual(revisions.map(({ id, createdAt }) => ({ id, createdAt })))
  expect(WorkbenchViewSchema.parse(projected)).toEqual(projected)
  expect(projected.diskChanged).toBe(true)
  expect(JSON.stringify(view)).toBe(before)
  expect(JSON.stringify(projected).length).toBeLessThan(before.length / 2)
})
