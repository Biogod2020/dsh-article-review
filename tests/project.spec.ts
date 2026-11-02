import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectSchema } from '../src/project/model.ts'
import type { Project } from '../src/project/model.ts'
import { applyChanges, stageChecklist, syncIssues, unregisteredNumbers } from '../src/project/units.ts'
import { ProjectStore } from '../src/project/store.ts'
import { personaReviewPrompt } from '../src/project/prompts.ts'
import { ReviewStateSchema } from '../src/project/model.ts'
import { copyMessage, copyState, errorLines, planBatches, referencePages } from '../src/project/init-job.ts'

/** Fictional project used across tests. */
const base = (): Project => ProjectSchema.parse({
  title: 'Tidal marsh microbes', journal: 'Fictional Letters', audience: 'ecologists',
  thesis: { title: 'Salt drives the community', statement: 'Salinity, not temperature, organises marsh microbes.' },
  beats: [{ id: 'b1', title: 'Problem', claims: ['c1'] }, { id: 'b2', title: 'Result', claims: ['c2'] }],
  claims: [
    { id: 'c1', title: 'Marshes are undersampled', statement: 'Only 412 cores exist.', role: 'support',
      evidence: [{ id: 'e1', kind: 'support', status: 'sufficient', text: 'Catalogue lists 412 cores.' }] },
    { id: 'c2', title: 'Salinity explains 38% of variance', statement: 'Salinity explains 38% of variance across 3 sites.', role: 'core',
      evidence: [{ id: 'e2', kind: 'support', status: 'partial', text: 'PERMANOVA R2 0.38.' }, { id: 'e3', kind: 'gap', status: 'missing', text: 'Second season' }] },
  ],
  numbers: [{ id: 'n1', label: 'cores', value: '412' }, { id: 'n2', label: 'variance', value: '38%' }],
  sections: [],
})

describe('project units', () => {
  it('detects prose written from an older claim', () => {
    let p = applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'Results', beat: 'b2', paragraphs: [] } },
      { op: 'upsert-paragraph', section: 's1', paragraph: { id: 'p1', text: 'Salinity explains 38% of variance.', claims: ['c2'], basis: {} } }])
    expect(syncIssues(p).filter(x => x.kind === 'claim-changed')).toHaveLength(0)
    expect(syncIssues(p).map(x => x.claim)).toEqual(['c1'])  // c1 not yet written
    const c2 = { ...p.claims[1]!, statement: 'Salinity explains 41% of variance.' }
    p = applyChanges(p, [{ op: 'upsert-claim', claim: c2 }])
    expect(syncIssues(p)).toContainEqual({ paragraph: 'p1', section: 's1', claim: 'c2', kind: 'claim-changed' })
  })

  it('flags numbers missing from the registry but not small counts, years or figure labels', () => {
    const p = applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: '', paragraphs: [
      { id: 'p1', text: 'In 2024 we took 3 cores per site (Fig. 2b); 412 cores exist and 1,250 samples were sequenced at 0.7 depth.', claims: [], basis: {} }] } }])
    expect(unregisteredNumbers(p).filter(x => x.where === 'paragraph:p1').map(x => x.value)).toEqual(['1,250', '0.7'])
    expect(unregisteredNumbers(p).find(x => x.where === 'claim:c2')?.value).toBe('0.38')
  })

  it('refine checklist wants core claims supported and gaps owned', () => {
    const items = stageChecklist(base(), ReviewStateSchema.parse({}), 'refine')
    expect(items.find(i => i.label.startsWith('核心分论点'))?.ok).toBe(false)
    expect(items.find(i => i.label.startsWith('缺口'))?.ok).toBe(false)
  })

  it('persona prompt carries the role, the stage and the project as data', () => {
    const prompt = personaReviewPrompt(base(), 'audience', '', [])
    expect(prompt).toContain('first language is not English')
    expect(prompt).toContain('stage "materials"')
    expect(prompt).toContain('<project>')
  })
})

describe('project store', () => {
  it('records changes, answers comments and tracks the author review', async () => {
    const store = new ProjectStore(await mkdtemp(join(tmpdir(), 'project-')))
    await store.create(base())
    const { comment } = await store.addComment({ target: { kind: 'claim', id: 'c2', quote: '' }, source: 'reviewer', author: 'Reviewer', text: 'Only one season.' })
    let v = await store.confirm(['claim:c2'])
    expect(v.status['claim:c2']).toBe('reviewed')
    const c2 = { ...v.project.claims[1]!, statement: 'Salinity explains 38% of variance in one season.' }
    v = await store.apply({ changes: [{ op: 'upsert-claim', claim: c2 }], actor: 'agent', reason: 'narrow claim', responses: [{ comment: comment.id, text: 'Narrowed to one season.' }] })
    expect(v.status['claim:c2']).toBe('changed')
    expect(v.comments[0]!.status).toBe('answered')
    expect(v.comments[0]!.response?.revision).toBe(1)
    expect(v.history.at(-1)!.units).toEqual(['claim:c2'])
    expect((await store.revision(0)).claims[1]!.statement).toContain('3 sites')
    await expect(store.apply({ changes: [{ op: 'upsert-paragraph', section: 'nope', paragraph: { id: 'p', text: 'x', claims: [], basis: {} } }], actor: 'a', reason: 'r' })).rejects.toThrow('unknown section')
    expect((await store.view()).revision).toBe(1)
  })
})

describe('round 2: drafts, number ignores', () => {
  it('drafts replace prose only when accepted and only if the paragraph is unchanged', async () => {
    const store = new ProjectStore(await mkdtemp(join(tmpdir(), 'project-')))
    await store.create(applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: 'b2', paragraphs: [
      { id: 'p1', text: 'Salinity explains 38% of variance.', claims: ['c2'], basis: {} }] } }]))
    let v = await store.apply({ changes: [{ op: 'upsert-claim', claim: { ...base().claims[1]!, statement: 'Salinity explains 38% of variance in one season.' } }], actor: 'agent', reason: 'narrow' })
    expect(v.sync.some(x => x.paragraph === 'p1')).toBe(true)
    const oldClaim = await store.claimAt('c2', v.project.sections[0]!.paragraphs[0]!.basis['c2']!)
    expect(oldClaim?.statement).toContain('3 sites')
    v = await store.addDrafts([{ section: 's1', paragraph: 'p1', before: 'Salinity explains 38% of variance.', after: 'In one season, salinity explains 38% of variance.', claims: ['c2'], reason: 'r', actor: 'agent', comments: [] }])
    expect(v.project.sections[0]!.paragraphs[0]!.text).toBe('Salinity explains 38% of variance.')
    v = await store.decideDraft(v.drafts[0]!.id, true, 'author')
    expect(v.project.sections[0]!.paragraphs[0]!.text).toBe('In one season, salinity explains 38% of variance.')
    expect(v.sync.some(x => x.paragraph === 'p1')).toBe(false)
    v = await store.addDrafts([{ section: 's1', paragraph: 'p1', before: 'stale text', after: 'x', claims: ['c2'], reason: 'r', actor: 'agent', comments: [] }])
    expect(v.drafts.at(-1)!.status).toBe('stale')
    await expect(store.decideDraft(v.drafts.at(-1)!.id, true, 'author')).rejects.toThrow('changed after this draft')
  })

  it('ignored numbers leave the report, here or everywhere', () => {
    let p = applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: '', paragraphs: [
      { id: 'p1', text: 'We used 50 components and 1,250 samples.', claims: [], basis: {} }, { id: 'p2', text: 'Again 50 components.', claims: [], basis: {} }] } }])
    p = applyChanges(p, [{ op: 'ignore-number', value: '50', where: 'paragraph:p1' }])
    expect(unregisteredNumbers(p).filter(n => n.where.startsWith('paragraph')).map(n => `${n.where}|${n.value}`)).toEqual(['paragraph:p1|1,250', 'paragraph:p2|50'])
    p = applyChanges(p, [{ op: 'ignore-number', value: '50', where: '' }])
    expect(unregisteredNumbers(p).filter(n => n.value === '50')).toHaveLength(0)
  })
})

it('does not split "2,411" after a word ending in s', () => {
  const p = applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: '', paragraphs: [
    { id: 'p1', text: 'The index identifies 2,411 series (Figure S8A) and Figures 2 and 3.', claims: [], basis: {} }] } }])
  expect(unregisteredNumbers(p).filter(n => n.where === 'paragraph:p1').map(n => n.value)).toEqual(['2,411'])
})

describe('round 3: submit gate, assignees, edited rewrites', () => {
  it('needs a reason to submit with unmet items, records it, and keeps assignees', async () => {
    const store = new ProjectStore(await mkdtemp(join(tmpdir(), 'project-')))
    await store.create(applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: 'b2', paragraphs: [
      { id: 'p1', text: 'Salinity explains 38% of variance across 1,250 cores.', claims: ['c2'], basis: {} }] } }]))
    await expect(store.setStage('submit', 'author')).rejects.toThrow('需要写明理由')
    let v = await store.setStage('submit', 'author', '剩下的数字是方法参数，已逐个核对过')
    expect(v.project.stage).toBe('submit')
    expect(v.history.at(-1)!.reason).toContain('理由：剩下的数字')
    const { comment } = await store.addComment({ target: { kind: 'paragraph', id: 'p1', quote: '' }, source: 'author', author: 'A', text: 'check' })
    v = await store.setAssignee(comment.id, 'alex')
    expect(v.comments[0]!.assignee).toBe('alex')
    v = await store.addDrafts([{ section: 's1', paragraph: 'p1', before: v.project.sections[0]!.paragraphs[0]!.text, after: 'Agent text.', claims: ['c2'], reason: 'r', actor: 'agent', comments: [] }])
    v = await store.decideDraft(v.drafts[0]!.id, true, 'author', 'Author text.')
    expect(v.project.sections[0]!.paragraphs[0]!.text).toBe('Author text.')
    expect(v.history.at(-1)!.reason).toContain('修改后接受')
  })
})

it('links paragraphs to claims without touching their text', async () => {
  const store = new ProjectStore(await mkdtemp(join(tmpdir(), 'project-')))
  await store.create(applyChanges(base(), [{ op: 'upsert-section', section: { id: 's1', heading: 'R', beat: '', paragraphs: [
    { id: 'p1', text: 'Original text one.', claims: [], basis: {} }, { id: 'p2', text: 'Original text two.', claims: [], basis: {} }] } }]))
  const r = await store.linkParagraphs({ p1: ['c2', 'nope'], p2: [], zz: ['c1'] }, 'agent', 'link')
  const ps = r.view.project.sections[0]!.paragraphs
  expect(ps.map(x => x.text)).toEqual(['Original text one.', 'Original text two.'])
  expect(ps[0]!.claims).toEqual(['c2'])
  expect(r.view.sync.filter(s => s.kind === 'claim-changed')).toHaveLength(0)
  expect(r.unknownParagraphs).toEqual(['zz'])
  expect(r.unknownClaims).toEqual(['nope'])
})

describe('initialisation rounds', () => {
  it('splits a PDF into small page batches and sections into pairs', () => {
    const pdf = planBatches('pdf', [400, 500, 300, 900, 200, 100, 50], '')
    expect(pdf.map(b => b.label)).toEqual(['第 1–4 页', '第 5–7 页'])
    expect(pdf[0]!.part).toContain('reading/pages/p001.png')
    const dense = planBatches('pdf', [1000, 900, 100], '')
    expect(dense.map(b => b.label)).toEqual(['第 1–2 页', '第 3 页'])
    const tex = planBatches('tex', [], '- section: Introduction\n  - subsection: x\n- section: Methods\n- section: Results\n')
    expect(tex).toHaveLength(2)
    expect(tex[0]!.part).toContain('abstract')
    expect(tex[0]!.part).toContain('up to (not including) the section "Results"')
    expect(tex[1]!.part).toContain('to the end of the manuscript')
    // the reference list is never sent: batches stop before it and start again after it
    const refs = planBatches('pdf', [300, 300, 300, 300, 300, 300], '', [false, false, true, true, false, false])
    expect(refs.map(b => b.label)).toEqual(['第 1–2 页', '第 5–6 页'])
    const cite = 'Smith, J. et al. Spatial atlas. Nature (2024).\nLee, K. et al. In Proceedings of ICML, 2023.\nZhu, Y. arXiv preprint arXiv:2401.1'
    const related = 'Related Work\nLatent reasoning (Chen et al., 2025) and agents (Lee et al., 2024) differ.\nOthers (Zhu et al., 2025) study tools.'
    expect(referencePages([related, 'Conclusion\nWe end.\nReferences\n' + cite, cite, cite, 'Appendix\nA. Proofs\nWe prove it.', cite]))
      .toEqual([false, false, true, true, false, false])
    expect(planBatches('docx', [], '')).toEqual([{ label: '全文', part: 'the whole manuscript' }])
  })
  it('tells the next batch where the copy stopped', () => {
    const state = copyState({ sections: [{ id: 's2', heading: 'Introduction', paragraphs: [{ id: 's2-p1', text: 'Agents act through text and' }] }], figures: [{}] })
    expect(state).toMatchObject({ paragraphs: 1, figures: 1, lastParagraph: { id: 's2-p1' } })
    const msg = copyMessage('papers/x', { label: '第 5–8 页', part: 'pages 5–8' }, 2, 9, state, false)
    expect(msg).toContain('round 2 of 9')
    expect(msg).toContain('s2-p1')
    expect(msg).toContain('never paste extracted text')
    // a last section with figures only must not read as "nothing copied"
    const figOnly = copyState({ sections: [{ id: 's1', heading: 'Intro', paragraphs: [{ id: 's1-p1', text: 'Text.' }] }, { id: 's2', heading: 'Case study', paragraphs: [] }], figures: [{}] })
    expect(figOnly.lastParagraph?.id).toBe('s1-p1')
    const next = copyMessage('papers/x', { label: '第 9 页', part: 'page 9' }, 3, 3, figOnly, false)
    expect(next).not.toContain('Nothing is copied yet')
    expect(next).toContain('section s2 "Case study"')
  })
})

describe('check errors in the fix round', () => {
  it('lists each kind of problem once with all its places', () => {
    const fix = '写成读者看到的文字'
    const lines = errorLines([
      { severity: 'error', title: '格式：s5-p1 有 LaTeX 标记', detail: '“e_{t+1}”', guidance: fix },
      { severity: 'error', title: '格式：s9-p3 有 LaTeX 标记', detail: '“∏_{t}”', guidance: fix },
      { severity: 'error', title: 'Figure 5 面板 8B 的左边切到了内容', detail: '边缘', guidance: '重裁' },
      { severity: 'warn', title: '格式：s1-p1 有多余空格', guidance: 'x' },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('格式：有 LaTeX 标记 — s5-p1 “e_{t+1}”; s9-p3 “∏_{t}” — 写成读者看到的文字')
    expect(lines[1]).toContain('Figure 5 面板 8B')
  })
})
