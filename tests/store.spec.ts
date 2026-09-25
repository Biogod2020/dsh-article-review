/** Real filesystem acceptance checks, including author baselines and external edits. */
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaperStore, reviewSessions } from '../src/store.ts'
import { checkChanges, parseRevision, revisionId } from '../src/document.ts'
import type { PaperView, ProposalInput } from '../src/schema.ts'
import { DocumentSchema } from '../src/schema.ts'

const roots: string[] = []
const stores: PaperStore[] = []
const original = '# Example study\n\n## Results\n\nPerformance was higher in three datasets (n = 42; p = 0.03). See Fig. 2 [@smith].\n\nThe evaluation was retrospective.\n'

async function setup(text = original): Promise<{ root: string; store: PaperStore; view: PaperView }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paper-review-'))
  roots.push(root)
  await writeFile(join(root, 'article.md'), text)
  const store = new PaperStore(root, 1_000_000)
  await store.start(); stores.push(store)
  return { root, store, view: await store.read('article.md') }
}
function proposal(view: PaperView, before: string, after: string): ProposalInput {
  const block = view.document.current.blocks.find(b => b.text === before)!
  return { baseRevision: view.document.current.id, annotationIds: [], reason: 'Shorten the sentence.', meaning: 'style', edits: [{ blockId: block.id, before, after }] }
}
async function accept(store: PaperStore, id: string): Promise<PaperView> {
  const view = await store.read('article.md')
  return store.command({ action: 'decide', path: 'article.md', revision: view.document.current.id, proposalId: id, accept: true })
}
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('manuscript review workflow', () => {
  it('distinguishes unbound, missing, and resolved canonical citations', async () => {
    const { root, store } = await setup('# Study\n\nSee [@smith].\n')
    expect((await store.bibliography('article.md')).citationStatus).toBe('unbound')
    await mkdir(join(root, 'references'))
    await writeFile(join(root, 'references', 'main.bib'),
      '@article{other, author={Jones, Bea}, title={Other study}, year={2025}}\n')
    const missing = await store.configureBibliography('article.md', ['references/main.bib'])
    expect(missing.citationStatus).toBe('missing-keys')
    expect(missing.missingKeys).toEqual(['smith'])
    const resolved = await store.addBibliographyEntry('article.md', 'references/main.bib',
      '@article{smith, author={Smith, Ada}, title={Study}, year={2024}}')
    expect(resolved.citationStatus).toBe('resolved')
    expect(resolved.canonicalCitationCount).toBe(1)
  })

  it('keeps .bib authoritative without editing the manuscript or creating a citation proposal', async () => {
    const text = '# Study\n\nThe study cites [@smith] and an old stahl2016 key.\n\n## References\n\n- Old display-only bibliography.\n'
    const { root, store, view } = await setup(text)
    await mkdir(join(root, 'references'))
    const file = join(root, 'references', 'main.bib')
    await writeFile(file, '@article{smith, author={Smith, Ada}, title={Study}, year={2024}}\n')
    expect((await store.listFiles('references', 'bib')).entries.map(entry => entry.name)).toEqual(['main.bib'])
    const bound = await store.configureBibliography('article.md', ['references/main.bib'])
    expect(bound.files).toEqual(['references/main.bib'])
    expect(bound.entries.map(entry => entry.key)).toEqual(['smith'])
    expect(bound.missingKeys).toEqual([])
    expect(bound.possibleBareKeys).toContain('stahl2016')
    expect(bound.canonicalCitationCount).toBe(1)
    expect(bound.citationStatus).toBe('possible-legacy-keys')
    const paragraph = view.document.current.blocks.find(block => block.text.startsWith('The study'))!
    const candidate = proposal(view, paragraph.text, `${paragraph.text} Another result [@newkey].`)
    await expect(store.propose('article.md', candidate)).rejects.toThrow('no entry')
    const added = await store.addBibliographyEntry('article.md', 'references/main.bib',
      '@article{newkey, author={Jones, Bea}, title={Another study}, year={2025}}')
    expect(added.entries.map(entry => entry.key)).toEqual(['smith', 'newkey'])
    const entry = await store.bibliographyEntry('article.md', 'newkey')
    await expect(store.replaceBibliographyEntry('article.md', 'newkey', 'wrong', entry.raw)).rejects.toThrow('changed')
    await store.replaceBibliographyEntry('article.md', 'newkey', entry.hash,
      '@article{newkey, author={Jones, Bea}, title={Another study, corrected}, year={2025}}')
    const proposed = await store.propose('article.md', candidate)
    expect(proposed.document.proposals).toHaveLength(1)
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(text)
    expect((await readFile(file, 'utf8')).includes('corrected')).toBe(true)
  })

  it('lists only workspace Markdown files and persists an explicit exit without changing the manuscript', async () => {
    const { root, store, view } = await setup()
    await mkdir(join(root, 'drafts'))
    await writeFile(join(root, 'drafts', 'next.md'), '# Next\n')
    await writeFile(join(root, 'notes.txt'), 'Private notes\n')
    await symlink('/etc', join(root, 'outside'))
    expect(await store.listFiles('')).toMatchObject({ path: '', truncated: false, entries: [
      { name: 'drafts', type: 'directory' }, { name: 'article.md', type: 'file' },
    ] })
    expect(await store.listFiles('drafts')).toMatchObject({ path: 'drafts', entries: [{ name: 'next.md', type: 'file' }] })
    await expect(store.listFiles('../')).rejects.toThrow('inside')
    await expect(store.listFiles('/etc')).rejects.toThrow('inside')
    await expect(store.listFiles('outside')).rejects.toThrow('inside')
    await store.enableSession('review-session')
    await store.disableSession('review-session')
    expect(await reviewSessions(root)).toEqual([])
    expect((await store.read('article.md')).document.current.id).toBe(view.document.current.id)
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
  })

  it('opens only existing local figure files and rejects symlink escapes', async () => {
    const { root, store } = await setup()
    await mkdir(join(root, 'figures'))
    await writeFile(join(root, 'figures', 'overview.pdf'), '%PDF-1.4\n')
    await symlink('/etc/passwd', join(root, 'figures', 'outside.pdf'))
    expect(await store.figurePath('figures/overview.pdf')).toBe(await realpath(join(root, 'figures', 'overview.pdf')))
    await expect(store.figurePath('figures/missing.pdf')).rejects.toThrow()
    await expect(store.figurePath('figures/outside.pdf')).rejects.toThrow('workspace')
    await expect(store.figurePath('../elsewhere.pdf')).rejects.toThrow()
    await expect(store.figurePath('.paper-review/state.pdf')).rejects.toThrow()
  })

  it('reads pre-highlight state without losing annotations or historical revisions', async () => {
    const { view } = await setup()
    const legacy = { ...view.document, highlights: undefined }
    const migrated = DocumentSchema.parse(JSON.parse(JSON.stringify(legacy)))
    expect(migrated.highlights).toEqual([])
    expect(migrated.revisions).toEqual(view.document.revisions)
    expect(migrated.annotations).toEqual(view.document.annotations)
  })

  it('persists rendered selections across restart, removes reversibly, and never writes source', async () => {
    const source = '# Study\n\nFirst **evidence** and second evidence.\n'
    const { root, store, view } = await setup(source)
    const block = view.document.current.blocks[1]!
    const selection = { path: 'article.md', revision: view.document.current.id, blockId: block.id,
      quote: 'evidence', prefix: 'First evidence and second ', suffix: '.', offset: 26 }
    await store.command({ action: 'highlight', ...selection, color: 'yellow' })
    await store.command({ action: 'highlight', ...selection, color: 'blue' })
    await store.command({ action: 'annotate', ...selection, rendered: true, comment: 'Check the second occurrence.' })
    const marked = await store.read('article.md')
    expect(marked.document.highlights).toHaveLength(1)
    expect(marked.document.highlights[0]).toMatchObject({ color: 'blue', offset: 26, renderedSource: block.text })
    await store.command({ action: 'set-highlight', path: 'article.md', highlightId: 'H1', removed: true })
    await store.command({ action: 'set-highlight', path: 'article.md', highlightId: 'H1', removed: false })
    await expect(store.command({ action: 'highlight', ...selection, revision: 'stale', color: 'green' })).rejects.toThrow('stale')
    await store.close()
    const reopened = new PaperStore(root, 1_000_000); await reopened.start(); stores.push(reopened)
    const restored = await reopened.read('article.md')
    expect(restored.document.highlights[0]).toMatchObject({ removed: false, anchor: 'attached', offset: 26 })
    expect(restored.document.annotations[0]).toMatchObject({ quote: 'evidence', renderedSource: block.text })
    expect(restored.document.revisions).toHaveLength(1)
    expect(restored.document.baselines).toHaveLength(0)
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  })

  it('keeps marks on unchanged blocks and detaches rendered anchors when their source changes', async () => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[3]!
    const selection = { path: 'article.md', revision: view.document.current.id, blockId: block.id,
      quote: 'evaluation', prefix: 'The ', suffix: ' was retrospective.', offset: 4 }
    await store.command({ action: 'highlight', ...selection, color: 'underline' })
    await store.command({ action: 'annotate', ...selection, rendered: true, comment: 'Check study design.' })
    await writeFile(join(root, 'article.md'), '# Preface\n\n' + original)
    const imported = await store.command({ action: 'refresh', path: 'article.md', revision: view.document.current.id })
    expect(imported.document.highlights[0]?.anchor).toBe('attached')
    await store.propose('article.md', proposal(imported, block.text, 'The evaluation was prospective.'))
    const updated = await accept(store, 'P1')
    expect(updated.document.highlights[0]?.anchor).toBe('needs-location')
    expect(updated.document.annotations[0]?.anchor).toBe('needs-location')
    expect(updated.document.revisions[0]?.text).toBe(original)
    expect(updated.document.highlights[0]?.quote).toBe('evaluation')
  })

  it('preserves a quotation and its block identity when a paragraph is inserted before it', async () => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[2]!
    await store.command({ action: 'annotate', path: 'article.md', revision: view.document.current.id, blockId: block.id, quote: 'three datasets', prefix: 'higher in ', suffix: ' (n = 42', comment: 'Keep the evidence scope.' })
    await writeFile(join(root, 'article.md'), '# A new preface\n\nInserted paragraph.\n\n' + original)
    const pinned = await store.read('article.md')
    expect(pinned.diskChanged).toBe(true)
    expect(pinned.document.current.text).toBe(original)
    const refreshed = await store.command({ action: 'refresh', path: 'article.md', revision: view.document.current.id })
    expect(refreshed.document.current.blocks.find(b => b.id === block.id)?.text).toBe(block.text)
    expect(refreshed.document.annotations[0]?.anchor).toBe('attached')
  })

  it('flags ambiguous duplicate paragraphs instead of moving a note to the wrong sentence', async () => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[3]!
    await store.command({ action: 'annotate', path: 'article.md', revision: view.document.current.id, blockId: block.id, quote: block.text, prefix: '', suffix: '', comment: 'Check cohort.' })
    await writeFile(join(root, 'article.md'), original + '\n' + block.text + '\n')
    const changed = await store.command({ action: 'refresh', path: 'article.md', revision: view.document.current.id })
    expect(changed.document.annotations[0]?.anchor).toBe('needs-location')
  })

  it('writes nothing for proposals or rejection and retains state after restart', async () => {
    const { root, store, view } = await setup()
    const before = view.document.current.blocks[3]!.text
    await store.propose('article.md', proposal(view, before, 'We evaluated retrospectively.'))
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
    await store.command({ action: 'decide', path: 'article.md', revision: view.document.current.id, proposalId: 'P1', accept: false })
    await store.close()
    const second = new PaperStore(root, 1_000_000); await second.start(); stores.push(second)
    expect((await second.read('article.md')).document.proposals[0]?.status).toBe('rejected')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
  })

  it('inserts a reviewable paragraph before or after an exact anchor only after acceptance', async () => {
    const { root, store, view } = await setup()
    const anchor = view.document.current.blocks[3]!
    const inserted = 'A separate interpretation needs author review.'
    const input: ProposalInput = { baseRevision: view.document.current.id, annotationIds: [],
      reason: 'Add an interpretation paragraph.', meaning: 'structure',
      edits: [{ blockId: anchor.id, before: anchor.text, after: inserted, operation: 'insert-before' }] }
    const proposed = await store.propose('article.md', input)
    expect(proposed.document.proposals[0]?.flags).toContain('structure')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
    const accepted = await accept(store, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original.replace(anchor.text, `${inserted}\n\n${anchor.text}`))
    expect(accepted.document.current.blocks.find(block => block.id === anchor.id)?.text).toBe(anchor.text)
    expect(accepted.document.current.blocks.find(block => block.text === inserted)?.kind).toBe('paragraph')
    expect(accepted.document.baselines.some(base => base.text === inserted)).toBe(false)
    const after: ProposalInput = { ...input, baseRevision: accepted.document.current.id,
      edits: [{ blockId: anchor.id, before: anchor.text, after: 'A second added paragraph.', operation: 'insert-after' }] }
    await store.propose('article.md', after)
    const second = await accept(store, 'P2')
    expect(second.document.current.blocks.map(block => block.text)).toContain('A second added paragraph.')
    expect(second.document.current.blocks.find(block => block.id === anchor.id)?.text).toBe(anchor.text)
  })

  it('rejects malformed, locked, stale and unbound-citation insertions without changing source', async () => {
    const { root, store, view } = await setup()
    const anchor = view.document.current.blocks[3]!
    const input: ProposalInput = { baseRevision: view.document.current.id, annotationIds: [], reason: 'Add context.', meaning: 'style',
      edits: [{ blockId: anchor.id, before: anchor.text, after: 'New context.', operation: 'insert-after' }] }
    await expect(store.propose('article.md', { ...input, edits: [{ ...input.edits[0]!, after: 'One.\n\nTwo.' }] })).rejects.toThrow('one complete Markdown paragraph')
    await expect(store.propose('article.md', { ...input, edits: [{ ...input.edits[0]!, after: 'New citation [@missing].' }] })).rejects.toThrow()
    await store.propose('article.md', input)
    await store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [anchor.id], locked: true })
    await expect(accept(store, 'P1')).rejects.toThrow('Unlock')
    await store.command({ action: 'unlock', path: 'article.md', blockId: anchor.id })
    await writeFile(join(root, 'article.md'), original + '\nExternal paragraph.\n')
    await expect(accept(store, 'P1')).rejects.toThrow('Source changed')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original + '\nExternal paragraph.\n')
  })

  it('combines an insertion with a replacement at the same anchor without swallowing either change', async () => {
    const { root, store, view } = await setup('# Title\r\n\r\nFirst sentence.\r\n\r\nSecond sentence.\r\n')
    const anchor = view.document.current.blocks[1]!
    const input: ProposalInput = { baseRevision: view.document.current.id, annotationIds: [], reason: 'Clarify the introduction.', meaning: 'structure',
      edits: [{ blockId: anchor.id, before: anchor.text, after: 'Revised first sentence.' },
        { blockId: anchor.id, before: anchor.text, after: 'Added context.', operation: 'insert-before' }] }
    await store.propose('article.md', input)
    await accept(store, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe('# Title\r\n\r\nAdded context.\r\n\r\nRevised first sentence.\r\n\r\nSecond sentence.\r\n')
  })

  it('revises a pending replacement into an insertion and requires rebasing after another acceptance', async () => {
    const { root, store, view } = await setup()
    const anchor = view.document.current.blocks[3]!
    await store.propose('article.md', proposal(view, anchor.text, 'Evaluation used existing records.'))
    const revised = await store.revise('article.md', { proposalId: 'P1', revision: view.document.current.id,
      edits: [{ blockId: anchor.id, before: anchor.text, after: 'Additional context.', operation: 'insert-after' }] })
    expect(revised.document.proposals[0]?.edits[0]?.operation).toBe('insert-after')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
    const other = view.document.current.blocks[2]!
    await store.propose('article.md', proposal(view, other.text, other.text.replace('higher', 'lower')))
    await accept(store, 'P2')
    await expect(accept(store, 'P1')).rejects.toThrow('stale')
    const current = await store.read('article.md')
    await store.revise('article.md', { proposalId: 'P1', revision: current.document.current.id,
      baseRevision: current.document.current.id, edits: [{ blockId: anchor.id, before: anchor.text,
        after: 'Additional context.', operation: 'insert-after' }] })
    await accept(store, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('Additional context.')
  })

  it('revises a pending proposal in place, recalculates flags, and persists the same id without writing source', async () => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[2]!
    const submitted = await store.propose('article.md', proposal(view, block.text, block.text.replace('higher', 'better')))
    const createdAt = submitted.document.proposals[0]!.createdAt
    const revised = await store.revise('article.md', { proposalId: 'P1', revision: view.document.current.id,
      reason: 'Correct the count and phrasing.', meaning: 'claim',
      edits: [{ blockId: block.id, before: block.text, after: block.text.replace('higher', 'improved').replace('42', '43') }] })
    expect(revised.document.proposals).toHaveLength(1)
    expect(revised.document.proposals[0]).toMatchObject({ id: 'P1', status: 'pending', createdAt,
      reason: 'Correct the count and phrasing.', meaning: 'claim', flags: ['numbers'] })
    expect(revised.document.history.at(-1)).toMatchObject({ action: 'revised', detail: 'P1' })
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original)
    await store.close()
    const reopened = new PaperStore(root, 1_000_000); await reopened.start(); stores.push(reopened)
    expect((await reopened.read('article.md')).document.proposals[0]?.edits[0]?.after).toContain('n = 43')
    await accept(reopened, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('n = 43')
  })

  it('rebases a pending proposal onto an imported source revision without changing the manuscript', async () => {
    const { root, store, view } = await setup()
    const oldBlock = view.document.current.blocks[3]!
    await store.propose('article.md', proposal(view, oldBlock.text, 'The evaluation was retrospective and source-grounded.'))
    const imported = original.replace(oldBlock.text, 'The evaluation used retrospective records.')
    await writeFile(join(root, 'article.md'), imported)
    const current = await store.command({ action: 'refresh', path: 'article.md', revision: view.document.current.id })
    const newBlock = current.document.current.blocks.find(block => block.text === 'The evaluation used retrospective records.')!
    await expect(store.revise('article.md', { proposalId: 'P1', revision: current.document.current.id,
      baseRevision: current.document.current.id, edits: [{ blockId: oldBlock.id, before: oldBlock.text,
        after: 'The evaluation was retrospective and source-grounded.' }] })).rejects.toThrow('unchanged base block')
    const revised = await store.revise('article.md', { proposalId: 'P1', revision: current.document.current.id,
      baseRevision: current.document.current.id, edits: [{ blockId: newBlock.id, before: newBlock.text,
        after: 'The evaluation used retrospective, source-grounded records.' }] })
    expect(revised.document.proposals[0]).toMatchObject({ id: 'P1', status: 'pending', baseRevision: current.document.current.id,
      edits: [{ blockId: newBlock.id, before: newBlock.text, after: 'The evaluation used retrospective, source-grounded records.' }] })
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(imported)
    await accept(store, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('The evaluation used retrospective, source-grounded records.')
  })

  it('refuses unsafe or settled in-place revisions without changing the proposal or source', async () => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[3]!
    await store.propose('article.md', proposal(view, block.text, 'Evaluation was retrospective.'))
    const state = (await store.read('article.md')).document.proposals[0]
    const change = { proposalId: 'P1', revision: view.document.current.id, reason: 'A clearer explanation.' }
    await expect(store.revise('article.md', { proposalId: 'P1', revision: view.document.current.id })).rejects.toThrow('Provide at least one')
    await expect(store.revise('article.md', { ...change, reason: state!.reason })).rejects.toThrow('no changes')
    await expect(store.revise('article.md', { ...change, revision: 'stale' })).rejects.toThrow('reader version is stale')
    await expect(store.revise('article.md', { ...change, proposalId: 'P99' })).rejects.toThrow('no longer pending')
    await expect(store.revise('article.md', { ...change, edits: [{ blockId: block.id, before: block.text, after: '# Wrong block type' }] })).rejects.toThrow('block type')
    await expect(store.revise('article.md', { ...change, annotationIds: ['missing'] })).rejects.toThrow('annotation')
    await store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [block.id], locked: true })
    await expect(store.revise('article.md', change)).rejects.toThrow('locked')
    await store.command({ action: 'unlock', path: 'article.md', blockId: block.id })
    const external = original.replace(block.text, 'External author correction.')
    await writeFile(join(root, 'article.md'), external)
    await expect(store.revise('article.md', change)).rejects.toThrow('External changes')
    expect((await store.read('article.md')).document.proposals[0]).toEqual(state)
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(external)
    await writeFile(join(root, 'article.md'), original)
    await store.command({ action: 'decide', path: 'article.md', revision: view.document.current.id, proposalId: 'P1', accept: false })
    await expect(store.revise('article.md', change)).rejects.toThrow('no longer pending')
  })

  it('blocks acceptance after an external edit without overwriting the edit', async () => {
    const { root, store, view } = await setup()
    const before = view.document.current.blocks[3]!.text
    await store.propose('article.md', proposal(view, before, 'We evaluated retrospectively.'))
    const external = original.replace(before, 'External author correction.')
    await writeFile(join(root, 'article.md'), external)
    await expect(accept(store, 'P1')).rejects.toThrow('Source changed')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(external)
  })

  it('compares multiple accepted rounds to the last human-reviewed text', async () => {
    const { store, view } = await setup()
    const block = view.document.current.blocks[3]!
    await store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [block.id], locked: false })
    await store.propose('article.md', proposal(view, block.text, 'We evaluated retrospectively.'))
    const first = await accept(store, 'P1')
    await store.propose('article.md', proposal(first, 'We evaluated retrospectively.', 'The study used retrospective evaluation.'))
    const second = await accept(store, 'P2')
    expect(second.document.baselines[0]?.text).toBe(block.text)
    expect(second.document.current.blocks.find(b => b.id === block.id)?.text).toBe('The study used retrospective evaluation.')
    expect(second.document.revisions).toHaveLength(3)
  })

  it('rejects overlapping proposals while allowing independent proposals from the same base', async () => {
    const { store, view } = await setup()
    const one = view.document.current.blocks[2]!.text
    const two = view.document.current.blocks[3]!.text
    await store.propose('article.md', proposal(view, one, one.replace('was higher', 'improved')))
    await store.propose('article.md', proposal(view, one, one.replace('was higher', 'increased')))
    await store.propose('article.md', proposal(view, two, 'Evaluation was retrospective.'))
    await accept(store, 'P1')
    await expect(accept(store, 'P2')).rejects.toThrow('overlaps')
    const result = await accept(store, 'P3')
    expect(result.document.proposals.map(p => p.status)).toEqual(['accepted', 'pending', 'accepted'])
  })

  it('enforces locks at proposal creation and again at acceptance', async () => {
    const { store, view } = await setup()
    const block = view.document.current.blocks[3]!
    const input = proposal(view, block.text, 'Evaluation was retrospective.')
    await store.propose('article.md', input)
    await store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [block.id], locked: true })
    const reviewedAgain = await store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [block.id], locked: false })
    expect(reviewedAgain.document.baselines.find(b => b.blockId === block.id)?.locked).toBe(true)
    await expect(store.propose('article.md', input)).rejects.toThrow('locked')
    await expect(accept(store, 'P1')).rejects.toThrow('Unlock')
    await store.command({ action: 'unlock', path: 'article.md', blockId: block.id })
    const result = await accept(store, 'P1')
    expect(result.document.baselines[0]?.text).toBe(block.text)
  })

  it('accepts related replacements atomically and preserves all separators', async () => {
    const { root, store, view } = await setup(original.replaceAll('\n', '\r\n'))
    const one = view.document.current.blocks[2]!
    const two = view.document.current.blocks[3]!
    const input = proposal(view, one.text, one.text.replace('42', '43'))
    input.edits.push({ blockId: two.id, before: two.text, after: 'A retrospective cohort was evaluated.' })
    await store.propose('article.md', input)
    await accept(store, 'P1')
    expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(original.replace('42', '43').replace(two.text, input.edits[1]!.after).replaceAll('\n', '\r\n'))
  })

  it('independently detects numbers, citations and claim qualifiers in writer-labelled style edits', () => {
    const before = 'Performance was higher in three datasets (n = 42; p = 0.03). See Fig. 2 [@smith].'
    const revision = parseRevision('## Methods\n\n' + before)
    const view = { document: { current: revision } } as PaperView
    const input = proposal(view, before, 'The model consistently outperformed all datasets (n = 45; p = 0.01). See Fig. 3 [@jones].')
    expect(checkChanges(input, revision.blocks)).toEqual(['numbers', 'citations', 'figures', 'claim-language', 'methods'])
  })

  it('confines reads and refuses concurrent workspace owners', async () => {
    const { root, store } = await setup()
    await symlink('/etc/hosts', join(root, 'outside.md'))
    await expect(store.read('outside.md')).rejects.toThrow('inside')
    await expect(store.read('/etc/hosts')).rejects.toThrow('relative')
    const other = new PaperStore(root, 1_000_000)
    await expect(other.start()).rejects.toThrow('locked')
  })

  it.each(['before', 'after', 'conflict'] as const)('recovers an interrupted acceptance with %s source without guessing', async (stage) => {
    const { root, store, view } = await setup()
    const block = view.document.current.blocks[3]!
    const pending = await store.propose('article.md', proposal(view, block.text, 'Evaluation was retrospective.'))
    const accepted = await accept(store, 'P1')
    await store.close()
    const statePath = join(root, '.paper-review', `${revisionId('article.md')}.json`)
    await writeFile(statePath, JSON.stringify(pending.document))
    const journal = { before: view.document.current.id, after: accepted.document.current.id, next: accepted.document }
    await writeFile(`${statePath}.pending`, JSON.stringify(journal))
    if (stage === 'before') await writeFile(join(root, 'article.md'), original)
    if (stage === 'conflict') await writeFile(join(root, 'article.md'), 'An external correction.\n')
    const restarted = new PaperStore(root, 1_000_000)
    await restarted.start(); stores.push(restarted)
    if (stage === 'conflict') {
      await expect(restarted.read('article.md')).rejects.toThrow('interrupted acceptance conflicts')
      expect(JSON.parse(await readFile(`${statePath}.pending`, 'utf8'))).toEqual(journal)
      expect(await readFile(join(root, 'article.md'), 'utf8')).toBe('An external correction.\n')
    } else {
      const recovered = await restarted.read('article.md')
      expect(recovered.document.proposals[0]?.status).toBe(stage === 'after' ? 'accepted' : 'pending')
      expect(recovered.diskChanged).toBe(false)
      await expect(readFile(`${statePath}.pending`)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses stale reader decisions and preserves a quoted annotation as needing location after its quotation changes', async () => {
    const { store, view } = await setup()
    const block = view.document.current.blocks[3]!
    await store.command({ action: 'annotate', path: 'article.md', revision: view.document.current.id, blockId: block.id, quote: 'retrospective', prefix: '', suffix: '', comment: 'Preserve the design.' })
    await store.propose('article.md', proposal(view, block.text, 'Evaluation used existing records.'))
    const changed = await accept(store, 'P1')
    expect(changed.document.annotations[0]?.anchor).toBe('needs-location')
    await expect(store.command({ action: 'review', path: 'article.md', revision: view.document.current.id, blockIds: [block.id], locked: false })).rejects.toThrow('reader version is stale')
    expect(changed.document.baselines).toEqual([])
  })
})
