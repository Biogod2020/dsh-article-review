/** Retained figure bytes stay separate from manuscript acceptance and mutable source files. */
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PaperStore } from '../src/store.ts'
import { authoredFigureBase, figureFilePath, pinnedFigure, collectFigures, replaceFigureReference } from '../src/figures.ts'

const resources: { root: string; store: PaperStore }[] = []
afterEach(async () => {
  for (const { root, store } of resources.splice(0)) { await store.close(); await rm(root, { recursive: true, force: true }) }
})

async function fixture(maxBytes = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-figure-replacement-'))
  const store = new PaperStore(root, 1_000_000, maxBytes)
  resources.push({ root, store })
  await mkdir(join(root, 'package/figures'), { recursive: true })
  const source = '<!-- Figure PDFs stay in package/; -->\n\n# Paper\n\n> **Figure [fig:results]** (`figures/old.pdf`): The caption stays unchanged.\n'
  await writeFile(join(root, 'article.md'), source)
  await writeFile(join(root, 'package/figures/old.pdf'), 'old figure bytes')
  await writeFile(join(root, 'replacement.pdf'), 'new figure bytes')
  await store.start()
  const view = await store.read('article.md')
  const figure = collectFigures(view.document.current.blocks)[0]
  if (!figure) throw new Error('Fixture figure missing')
  const input = { revision: view.document.current.id, blockId: figure.blockId, figure: figure.path,
    replacement: 'replacement.pdf', reason: 'Use the updated artwork.' }
  return { root, store, view, figure, input, source }
}

it('retains old/new bytes, accepts only the destination, and preserves historical preview bytes', async () => {
  const { root, store, input, source, figure } = await fixture()
  const pending = await store.replaceFigure('article.md', input)
  const proposal = pending.document.proposals[0]
  const change = proposal?.figureChanges?.[0]
  if (!proposal || !change) throw new Error('Figure proposal missing')
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  expect(await readFile(join(root, 'package/figures/old.pdf'), 'utf8')).toBe('old figure bytes')
  expect(proposal.edits[0]?.after).toContain('The caption stays unchanged.')
  expect(change.before.hash).not.toBe(change.after.hash)
  await writeFile(join(root, 'replacement.pdf'), 'later candidate bytes')
  await writeFile(join(root, 'package/figures/old.pdf'), 'later original bytes')
  const accepted = await store.command({ action: 'decide', path: 'article.md', revision: input.revision, proposalId: proposal.id, accept: true })
  const previous = accepted.document.revisions.find(revision => revision.id === input.revision)
  if (!previous) throw new Error('Historical version missing')
  const file = figureFilePath('article.md', authoredFigureBase(previous.text), pinnedFigure(previous, figure).path)
  expect(await readFile(join(root, file ?? ''), 'utf8')).toBe('old figure bytes')
  expect(await readFile(join(root, 'package', change.after.snapshot), 'utf8')).toBe('new figure bytes')
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source.replace('figures/old.pdf', change.after.path))
  expect(accepted.document.baselines).toHaveLength(0)
})

it('revises a pending figure proposal in place and rejects without changing the manuscript', async () => {
  const { root, store, input, source } = await fixture()
  const pending = await store.replaceFigure('article.md', input)
  const id = pending.document.proposals[0]?.id
  if (!id) throw new Error('Proposal missing')
  const edit = pending.document.proposals[0]?.edits[0]
  if (!edit) throw new Error('Edit missing')
  await store.revise('article.md', { proposalId: id, revision: input.revision,
    edits: [{ ...edit, after: edit.after.replace('The caption stays unchanged.', 'A revised caption stays here.') }] })
  await writeFile(join(root, 'third.pdf'), 'third candidate')
  const revised = await store.replaceFigure('article.md', { ...input, replacement: 'third.pdf', proposalId: id })
  expect(revised.document.proposals).toHaveLength(1)
  expect(revised.document.proposals[0]?.id).toBe(id)
  expect(revised.document.proposals[0]?.edits[0]?.after).toContain('A revised caption stays here.')
  await store.command({ action: 'decide', path: 'article.md', revision: input.revision, proposalId: id, accept: false })
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
})

it('replaces an angle-bracket image path with spaces without changing its title or neighboring reference', () => {
  const text = '![Panel](<figures/old plot.png> "Image title") and ![Other](other.png)'
  const block = { id: 'figure', kind: 'paragraph', section: '', start: 0, end: text.length, text }
  expect(replaceFigureReference(block, 'figures/old plot.png', 'figures/retained.png'))
    .toBe('![Panel](<figures/retained.png> "Image title") and ![Other](other.png)')
})

it('refuses stale anchors, locked blocks, identical bytes and oversized files', async () => {
  const { root, store, input } = await fixture(50)
  await expect(store.replaceFigure('article.md', { ...input, revision: 'stale' })).rejects.toThrow('stale')
  await expect(store.replaceFigure('article.md', { ...input, replacement: 'package/figures/old.pdf' })).rejects.toThrow('identical')
  await writeFile(join(root, 'large.pdf'), 'x'.repeat(51))
  await expect(store.replaceFigure('article.md', { ...input, replacement: 'large.pdf' })).rejects.toThrow('maxFigureBytes')
  await store.command({ action: 'review', path: 'article.md', revision: input.revision, blockIds: [input.blockId], locked: true })
  await expect(store.replaceFigure('article.md', input)).rejects.toThrow('Unlock')
})

it('refuses outside-workspace symlinks and modified retained bytes at acceptance', async () => {
  const { root, store, input } = await fixture()
  await symlink('/etc/passwd', join(root, 'outside.pdf'))
  await expect(store.replaceFigure('article.md', { ...input, replacement: 'outside.pdf' })).rejects.toThrow('workspace')
  const pending = await store.replaceFigure('article.md', input)
  const proposal = pending.document.proposals[0]
  const asset = proposal?.figureChanges?.[0]?.after
  if (!proposal || !asset) throw new Error('Retained asset missing')
  const file = join(root, 'package', asset.snapshot)
  await chmod(file, 0o600); await writeFile(file, 'modified')
  await expect(store.command({ action: 'decide', path: 'article.md', revision: input.revision, proposalId: proposal.id, accept: true })).rejects.toThrow('Retained figure bytes changed')
})
