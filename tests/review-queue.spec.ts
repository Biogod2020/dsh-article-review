import { describe, expect, it } from 'vitest'
import { pendingReviewQueue, filterReviewQueue, needsJudgment } from '../src/review-queue.ts'
import type { Proposal } from '../src/schema.ts'
function proposal(id: string, meaning: Proposal['meaning'], status: Proposal['status'] = 'pending'): Proposal {
  return { id, meaning, status, baseRevision: 'base', annotationIds: [], flags: [], reason: 'Review.', createdAt: '2026-09-30',
    edits: [{ blockId: 'B1', before: 'Original.', after: 'Revised.' }] }
}
describe('non-mutating review routing', () => {
  it('keeps whole groups and source order while excluding settled proposals', () => {
    const proposals = [proposal('P1', 'style'), proposal('P2', 'claim'), proposal('P3', 'evidence', 'accepted')]
    const snapshot = JSON.stringify(proposals), queue = pendingReviewQueue(proposals)
    expect(queue.map(item => item.id)).toEqual(['P1', 'P2'])
    expect(filterReviewQueue(queue, 'attention').map(item => item.id)).toEqual(['P2'])
    expect(filterReviewQueue(queue, 'style').map(item => item.id)).toEqual(['P1'])
    expect(filterReviewQueue(queue, 'evidence')).toEqual([])
    expect(JSON.stringify(proposals)).toBe(snapshot)
  })
  it('does not let a model-declared style label hide changed numbers in legacy proposals', () => {
    const legacy = proposal('P1', 'style')
    legacy.edits = [{ blockId: 'B1', before: 'p < 0.05', after: 'p > 0.05' }]
    const queue = pendingReviewQueue([legacy])
    expect(queue[0]?.flags).toContain('numbers')
    expect(needsJudgment(queue[0]!)).toBe(true)
    expect(legacy.flags).toEqual([])
  })
})
