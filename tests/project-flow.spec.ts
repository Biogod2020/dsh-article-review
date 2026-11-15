import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectSchema } from '../src/project/model.ts'
import type { Project } from '../src/project/model.ts'
import { applyChanges } from '../src/project/units.ts'
import { ProjectStore } from '../src/project/store.ts'
import { applyTool, draftTool, statusTool } from '../src/project/tools.ts'

/** Fictional project: a finished skeleton with one core claim and one figure. */
const skeleton = (stage: Project['stage']): Project => ProjectSchema.parse({
  title: 'Tidal marsh microbes', journal: 'Fictional Letters', audience: 'ecologists', stage,
  materials: [{ id: 'm1', label: 'results table' }],
  thesis: { title: 'Salt drives the community', statement: 'Salinity, not temperature, organises marsh microbes.' },
  beats: [{ id: 'b1', title: 'Problem', claims: ['c1'] }, { id: 'b2', title: 'Result', claims: ['c2'] }],
  claims: [
    { id: 'c1', title: 'Marshes are undersampled', statement: 'Only 412 cores exist.', role: 'support',
      evidence: [{ id: 'e1', kind: 'support', status: 'sufficient', text: 'Catalogue lists 412 cores.' }] },
    { id: 'c2', title: 'Salinity explains 38% of variance', statement: 'Salinity explains 38% of variance.', role: 'core',
      evidence: [{ id: 'e2', kind: 'support', status: 'partial', text: 'PERMANOVA.' }] },
  ],
  figures: [{ id: 'f1', label: 'Fig. 1', placement: 'unplaced' }],
  numbers: [{ id: 'n1', label: 'cores', value: '412' }, { id: 'n2', label: 'variance', value: '38%' }],
})
const newStore = async (p: Project): Promise<ProjectStore> => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), 'flow-')))
  await store.create(p)
  return store
}
const frameChanges = [
  { op: 'upsert-section', index: 0, section: { id: 'sa', heading: 'Abstract', beat: '', paragraphs: [{ id: 'pa', text: 'Salinity explains 38% of variance in 412 cores.', claims: ['c2'] }] } },
  { op: 'upsert-section', index: 1, section: { id: 'si', heading: 'Introduction', beat: '', paragraphs: [{ id: 'pi', text: 'Marshes are undersampled.', claims: ['c1'] }] } },
  { op: 'set-frame', sections: ['sa', 'si'] },
]

describe('recommended workflow', () => {
  it('walks the argument stage: one outside review, the author picks, fixes weak claims, reviews, then moves on', async () => {
    const store = await newStore(skeleton('refine'))
    let v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'agent', task: { kind: 'review', scope: 'argument' } })
    const { comment } = await store.addComment({ target: { kind: 'claim', id: 'c2', quote: '' }, source: 'reviewer', author: 'R', text: '【主要】needs a second season' })
    v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'author', go: 'inbox' })
    await store.setComment(comment.id, 'declined')
    v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'author', go: 'story', focus: 'claim:c2' })
    const c2 = { ...v.project.claims[1]!, evidence: [{ ...v.project.claims[1]!.evidence[0]!, status: 'sufficient' as const }] }
    v = await store.apply({ changes: [{ op: 'upsert-claim', claim: c2 }, { op: 'upsert-figure', figure: { ...v.project.figures[0]!, placement: 'main' } }], actor: '作者', reason: 'fix' })
    expect(v.flow.next).toMatchObject({ who: 'author', go: 'story' })
    v = await store.confirm(v.units.map(u => u.key))
    expect(v.flow.next).toMatchObject({ who: 'author', action: 'advance', stage: 'frame' })
  })

  it('writes the abstract and introduction first, locks them, and keeps agents out afterwards', async () => {
    const store = await newStore(skeleton('frame'))
    let v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'agent', task: { kind: 'frame' } })
    await applyTool(store, { changes: frameChanges, reason: 'frame' }, 'agent（对话 x）')
    v = await store.view()
    expect(v.flow.frame).toMatchObject({ sections: ['sa', 'si'], paragraphs: ['pa', 'pi'], rounds: 1, locked: false })
    expect(v.flow.next).toMatchObject({ who: 'author', go: 'read', focus: 'paragraph:pa' })
    // leaving the stage unlocked needs a reason
    await expect(store.setStage('draft', '作者')).rejects.toThrow('锁定')
    v = await store.confirm(['paragraph:pa', 'paragraph:pi'])
    expect(v.flow.next).toMatchObject({ who: 'author', action: 'lock-frame' })
    v = await store.lockFrame(true, '作者')
    expect(v.flow.frame.locked).toBe(true)
    expect(v.flow.next).toMatchObject({ who: 'author', action: 'advance', stage: 'draft' })
    // an agent cannot write locked text, only propose drafts; accepting one keeps it locked
    const r = await applyTool(store, { changes: [{ op: 'upsert-paragraph', section: 'si', paragraph: { id: 'pi', text: 'Changed.', claims: ['c1'] } }], reason: 'x' }, 'agent（对话 x）') as { written: number }
    expect(r.written).toBe(0)
    await draftTool(store, { drafts: [{ paragraph: 'pi', text: 'Tidal marshes are undersampled.', reason: 'clearer' }] }, 'agent')
    v = await store.view()
    v = await store.decideDraft(v.drafts.at(-1)!.id, true, '作者')
    expect(v.flow.frame.locked).toBe(true)
    v = await store.setStage('draft', '作者')
    expect(v.flow.next).toMatchObject({ who: 'agent', task: { kind: 'draft-all' } })
  })

  it('advises locking after three rounds on the frame', async () => {
    const store = await newStore(skeleton('frame'))
    await applyTool(store, { changes: frameChanges, reason: 'frame' }, 'agent')
    await store.addComment({ target: { kind: 'paragraph', id: 'pa', quote: '' }, source: 'author', author: 'A', text: 'shorter' })
    let v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'agent', task: { kind: 'frame' } })
    await store.noteFlow('frame-round'); v = await store.noteFlow('frame-round')
    expect(v.flow.frame.rounds).toBe(3)
    expect(v.flow.next).toMatchObject({ who: 'author', action: 'lock-frame' })
  })

  it('starts where the author is: skipped stages are listed, not forced', async () => {
    const p = applyChanges(skeleton('read'), frameChanges.slice(0, 2) as never)
    const store = await newStore(p)
    const v = await store.view()
    expect(v.flow.skipped.map(m => m.stage)).toEqual(['refine', 'frame', 'draft'])
    expect(v.flow.next.stage).toBe('read')
    expect(v.flow.detected).toBe('refine')
  })

  it('puts the author\'s pending decisions first, and the status tool hands agent steps over with instructions', async () => {
    const store = await newStore(skeleton('frame'))
    await applyTool(store, { changes: frameChanges, reason: 'frame' }, 'agent')
    await draftTool(store, { drafts: [{ paragraph: 'pa', text: 'Shorter abstract with 38% and 412.', reason: 'r' }] }, 'agent')
    let s = await statusTool(store, 'paper') as { next: { who: string, title: string }, tellAuthor?: string }
    expect(s.next.who).toBe('author')
    expect(s.tellAuthor).toContain('改写')
    const v = await store.view()
    await store.decideDraft(v.drafts.at(-1)!.id, false, '作者')
    const empty = await newStore(skeleton('refine'))
    s = await statusTool(empty, 'paper') as never
    expect((s as unknown as { instructions: string }).instructions).toContain('project_comment')
  })

  it('polishes once before submit', async () => {
    const p = applyChanges(skeleton('read'), [...frameChanges.slice(0, 2), { op: 'upsert-section', section: { id: 'sr', heading: 'Results', beat: 'b2', paragraphs: [] } },
      { op: 'upsert-paragraph', section: 'sr', paragraph: { id: 'pr', text: 'Salinity explains 38% of variance.', claims: ['c2'], basis: {} } }] as never)
    const store = await newStore(p)
    await store.addComment({ target: { kind: 'project', id: '', quote: '' }, source: 'editor', author: 'E', text: 'fine' }).then(r => store.setComment(r.comment.id, 'closed'))
    let v = await store.confirm((await store.view()).units.map(u => u.key))
    expect(v.flow.next).toMatchObject({ who: 'agent', task: { kind: 'polish' } })
    await draftTool(store, { drafts: [], polish: true }, 'agent')
    v = await store.view()
    expect(v.flow.next).toMatchObject({ who: 'author', action: 'advance', stage: 'submit' })
  })
})
