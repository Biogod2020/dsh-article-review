/** Panel metadata is durable, exact-source checked and isolated from manuscript acceptance. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PaperStore } from '../src/store.ts'
import { attachedPanelTargets, panelAcknowledgement, PanelInputSchema } from '../src/figure-panels.ts'
import type { PanelInput } from '../src/figure-panels.ts'

const resources: { root: string; store: PaperStore }[] = []
afterEach(async () => { for (const entry of resources.splice(0)) { await entry.store.close(); await rm(entry.root, { recursive: true, force: true }) } })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'paper-panels-'))
  const store = new PaperStore(root, 1_000_000)
  const resource = { root, store }; resources.push(resource)
  const source = '# Paper\n\n## Results\n\nPanel a shows the first example (Fig. 1a).\n\n> **Figure 1** (`whole.png`): Shared legend.\n'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=', 'base64')
  await writeFile(join(root, 'article.md'), source)
  await writeFile(join(root, 'whole.png'), png)
  await writeFile(join(root, 'crop.png'), png)
  await store.start()
  const view = await store.read('article.md')
  const figure = (await store.listFigures('article.md')).figures[0]!
  const block = view.document.current.blocks[2]!
  const input: PanelInput = { revision: view.document.current.id, figureBlockId: figure.blockId,
    figure: figure.path, sourceHash: figure.sourceHash!, panels: [{ label: 'a', file: 'crop.png', page: 1,
      region: [0, 0, .5, 1], targets: [{ blockId: block.id, before: block.text }] }] }
  return { root, store, resource, source, png, input, block }
}

it('retains crop bytes and associations across restart without changing prose or review baselines', async () => {
  const { root, store, resource, source, png, input } = await fixture()
  const saved = await store.setPanels('article.md', input)
  const panel = saved.document.figurePanels![0]!
  expect(await readFile(join(root, panel.file))).toEqual(png)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  expect(saved.document.baselines).toEqual([])
  await writeFile(join(root, 'crop.png'), 'later external crop')
  await store.close()
  resource.store = new PaperStore(root, 1_000_000)
  await resource.store.start()
  const restored = await resource.store.read('article.md')
  expect(restored.document.figurePanels?.[0]).toMatchObject({ label: 'a', stale: false })
  expect(attachedPanelTargets(restored.document.figurePanels![0]!, restored.document.current)).toHaveLength(1)
  expect(await readFile(join(root, panel.file))).toEqual(png)
  await resource.store.setPanels('article.md', { ...input, panels: [] })
  expect((await resource.store.read('article.md')).document.figurePanels).toEqual([])
})

it('refuses changed paragraphs, source hashes, invalid crop paths and stale reader revisions', async () => {
  const { root, store, source, input } = await fixture()
  await expect(store.setPanels('article.md', { ...input, revision: 'old' })).rejects.toThrow('stale')
  await expect(store.setPanels('article.md', { ...input, sourceHash: 'f'.repeat(64) })).rejects.toThrow('figure changed')
  const panel = input.panels[0]!
  await expect(store.setPanels('article.md', { ...input, panels: [{ ...panel, targets: [{ blockId: 'missing', before: 'Missing.' }] }] })).rejects.toThrow('target changed')
  await expect(store.setPanels('article.md', { ...input, panels: [{ ...panel, file: '../outside.png' }] })).rejects.toThrow('workspace')
  await writeFile(join(root, 'bad.png'), 'not an image')
  await expect(store.setPanels('article.md', { ...input, panels: [{ ...panel, file: 'bad.png' }] })).rejects.toThrow('PNG')
  expect(PanelInputSchema.safeParse({ ...input, panels: [{ ...panel, region: [.8, 0, .2, 1] }] }).success).toBe(false)
  expect(PanelInputSchema.safeParse({ ...input, panels: [panel, panel] }).success).toBe(false)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
})

it('flags overwritten artwork and detaches edited target text while retaining the saved map', async () => {
  const { root, store, input } = await fixture()
  await store.setPanels('article.md', input)
  await writeFile(join(root, 'whole.png'), 'changed artwork')
  const stale = await store.read('article.md')
  expect(stale.document.figurePanels?.[0]?.stale).toBe(true)
  expect(attachedPanelTargets(stale.document.figurePanels![0]!, stale.document.current)).toEqual([])
  expect(createHash('sha256').update(await readFile(join(root, 'whole.png'))).digest('hex')).not.toBe(input.sourceHash)
  await store.setPanels('article.md', { ...input, panels: [] })
  expect((await store.read('article.md')).document.figurePanels).toEqual([])
})

it('imports prepared arguments without retyping anchors and confirms only the selected figure', async () => {
  const { root, store, source, png, input, block } = await fixture()
  await writeFile(join(root, 'panels.json'), JSON.stringify({ path: 'article.md', ...input }))
  const prepared = await store.readPanelManifest('./article.md', 'panels.json')
  expect(prepared).toEqual(input)
  const saved = await store.setPanels('article.md', prepared)
  const panel = saved.document.figurePanels![0]!
  const other = { ...panel, id: 'other', figureBlockId: 'other-figure', figure: 'other.png' }
  const acknowledgement = panelAcknowledgement([other, panel], input)
  expect(acknowledgement).toMatchObject({ figureBlockId: input.figureBlockId, figure: 'whole.png', panelCount: 1, totalPanels: 2,
    manuscriptWritten: false, originalFilesWritten: false, panels: [{ label: 'a', targetBlockIds: [block.id] }] })
  expect(JSON.stringify(acknowledgement)).not.toContain(block.text)
  expect(JSON.stringify(acknowledgement)).not.toContain('before')
  expect(acknowledgement.panels).toHaveLength(1)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  expect(await readFile(join(root, 'whole.png'))).toEqual(png)
  await writeFile(join(root, 'remove.json'), JSON.stringify({ ...input, panels: [] }))
  const removed = await store.setPanels('article.md', await store.readPanelManifest('article.md', 'remove.json'))
  expect(panelAcknowledgement(removed.document.figurePanels ?? [], input)).toMatchObject({ panelCount: 0, totalPanels: 0, panels: [] })
})

it.each(['revision', 'sourceHash', 'paragraph', 'manuscript', 'disk'] as const)('keeps saved metadata intact when a prepared manifest has a stale %s', async (fault) => {
  const { root, store, source, input } = await fixture()
  await store.setPanels('article.md', input)
  const state = join(root, '.paper-review', `${createHash('sha256').update('article.md').digest('hex')}.json`)
  const previous = await readFile(state)
  const prepared = structuredClone({ path: 'article.md', ...input })
  if (fault === 'revision') prepared.revision = 'old'
  if (fault === 'sourceHash') prepared.sourceHash = 'f'.repeat(64)
  if (fault === 'paragraph') prepared.panels[0]!.targets[0]!.before += 'changed'
  if (fault === 'manuscript') { await writeFile(join(root, 'other.md'), source); prepared.path = 'other.md' }
  if (fault === 'disk') await writeFile(join(root, 'article.md'), source + '\nExternal change.\n')
  await writeFile(join(root, 'panels.json'), JSON.stringify(prepared))
  await expect((async () => store.setPanels('article.md', await store.readPanelManifest('article.md', 'panels.json')))()).rejects.toThrow()
  expect(await readFile(state)).toEqual(previous)
})

it('rejects unsafe, oversized and malformed JSON manifests without changing metadata', async () => {
  const { root, store, input } = await fixture()
  await store.setPanels('article.md', input)
  const state = join(root, '.paper-review', `${createHash('sha256').update('article.md').digest('hex')}.json`)
  const previous = await readFile(state)
  await writeFile(join(root, 'valid.json'), JSON.stringify(input))
  await writeFile(join(root, 'broken.json'), '{')
  await writeFile(join(root, 'invalid-utf8.json'), Buffer.from([0xff]))
  await writeFile(join(root, 'huge.json'), Buffer.alloc(1_048_577, 32))
  await mkdir(join(root, 'directory.json'))
  await symlink(join(root, 'valid.json'), join(root, 'link.json'))
  await symlink(root, join(root, 'linked-directory'), 'dir')
  const outside = await mkdtemp(join(tmpdir(), 'paper-panels-outside-'))
  try {
    await writeFile(join(outside, 'panels.json'), JSON.stringify(input))
    await symlink(outside, join(root, 'outside'), 'dir')
    for (const file of ['../escape.json', join(root, 'valid.json'), '.paper-review/secret.json', '.PAPER-REVIEW/secret.json', 'valid.txt',
      'directory.json', 'link.json', 'linked-directory/valid.json', 'outside/panels.json', 'broken.json', 'invalid-utf8.json', 'huge.json']) {
      await expect(store.readPanelManifest('article.md', file)).rejects.toThrow()
      expect(await readFile(state)).toEqual(previous)
    }
  } finally { await rm(outside, { recursive: true, force: true }) }
})

it('exports a minimal context packet once and reuses identical content without overwriting a different file', async () => {
  const { root, store, source, input, block } = await fixture()
  const listed = await store.listFigures('article.md', 'manifests/context.json')
  expect(listed.packet).toBe('manifests/context.json')
  expect(listed).not.toHaveProperty('blocks')
  const bytes = await readFile(join(root, listed.packet!))
  const packet = JSON.parse(bytes.toString())
  expect(Object.keys(packet).sort()).toEqual(['blocks', 'figures', 'path', 'revision', 'version', 'workspaceRoot'])
  expect(packet).toMatchObject({ version: 1, workspaceRoot: await realpath(root), path: 'article.md', revision: input.revision,
    figures: [{ blockId: input.figureBlockId, path: 'whole.png', sourceHash: input.sourceHash }] })
  expect(packet.blocks).toContainEqual({ id: block.id, kind: block.kind, text: block.text })
  expect(packet.blocks.every((entry: object) => Object.keys(entry).sort().join(',') === 'id,kind,text')).toBe(true)
  expect(await store.listFigures('article.md', 'manifests/context.json')).toEqual(listed)
  expect(await readFile(join(root, listed.packet!))).toEqual(bytes)
  await writeFile(join(root, 'user.json'), '{"owned":"by user"}')
  await expect(store.listFigures('article.md', 'user.json')).rejects.toThrow('different content')
  expect(await readFile(join(root, 'user.json'), 'utf8')).toBe('{"owned":"by user"}')
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
})

it('reports compact saved-panel states when source images or paragraph anchors become stale', async () => {
  const { root, store, source, png, input, block } = await fixture()
  expect((await store.listFigures('article.md')).figures[0]!.savedPanels).toEqual([])
  await store.setPanels('article.md', input)
  expect((await store.listFigures('article.md')).figures[0]!.savedPanels).toEqual([{ label: 'a', stale: false, targetCount: 1 }])
  await writeFile(join(root, 'whole.png'), 'external image change')
  expect((await store.listFigures('article.md')).figures[0]!.savedPanels).toEqual([{ label: 'a', stale: true, targetCount: 1 }])
  await writeFile(join(root, 'whole.png'), png)
  await writeFile(join(root, 'article.md'), source.replace(block.text, 'The paragraph has been rewritten.'))
  await store.command({ action: 'refresh', path: 'article.md' })
  const listed = await store.listFigures('article.md', 'new-context.json')
  expect(listed.figures[0]!.savedPanels).toEqual([{ label: 'a', stale: true, targetCount: 1 }])
  const packet = JSON.parse(await readFile(join(root, 'new-context.json'), 'utf8'))
  expect(packet.figures[0].savedPanels).toEqual([{ label: 'a', stale: true, targetCount: 1 }])
  expect(packet.figures[0].savedPanels[0]).not.toHaveProperty('targets')
})

it('rejects a manifest copied from another workspace even when manuscript bytes and paths match', async () => {
  const { root, store, source, input } = await fixture()
  const other = await mkdtemp(join(tmpdir(), 'paper-panels-copy-'))
  try {
    await writeFile(join(other, 'article.md'), source)
    await writeFile(join(root, 'copied.json'), JSON.stringify({ workspaceRoot: other, path: 'article.md', ...input }))
    await expect(store.readPanelManifest('article.md', 'copied.json')).rejects.toThrow('different workspace')
    expect((await store.read('article.md')).document.figurePanels ?? []).toEqual([])
    await writeFile(join(root, 'current.json'), JSON.stringify({ workspaceRoot: root, path: 'article.md', ...input }))
    await store.setPanels('article.md', await store.readPanelManifest('article.md', 'current.json'))
    expect(await store.listFigures('article.md')).toMatchObject({ workspaceRoot: await realpath(root), path: 'article.md',
      revision: input.revision, diskChanged: false, panelCount: 1, validPanelCount: 1, associationCount: 1 })
    await writeFile(join(root, 'whole.png'), 'changed source')
    expect(await store.listFigures('article.md')).toMatchObject({ panelCount: 1, validPanelCount: 0, associationCount: 0 })
  } finally { await rm(other, { recursive: true, force: true }) }
})

it.each(['deleted', 'tampered'] as const)('does not resume a saved panel whose retained crop was %s', async (fault) => {
  const { root, store, input } = await fixture()
  const saved = await store.setPanels('article.md', input)
  const crop = join(root, saved.document.figurePanels![0]!.file)
  expect((await store.listFigures('article.md')).figures[0]!.savedPanels).toEqual([{ label: 'a', stale: false, targetCount: 1 }])
  await rm(crop)
  if (fault === 'tampered') await writeFile(crop, 'different retained crop bytes')
  expect((await store.listFigures('article.md')).figures[0]!.savedPanels).toEqual([{ label: 'a', stale: true, targetCount: 1 }])
})

it('caps exported packet bytes before creating the destination', async () => {
  const { root, store } = await fixture()
  // This remains below the source cap but expands beyond the JSON packet cap.
  await writeFile(join(root, 'article.md'), '# Paper\n\n' + '\u0001'.repeat(400_000))
  await store.command({ action: 'refresh', path: 'article.md' })
  await expect(store.listFigures('article.md', 'large-context.json')).rejects.toThrow('exceeds 2097152 bytes')
  await expect(readFile(join(root, 'large-context.json'))).rejects.toThrow()
})

it('refuses unsafe packet destinations and exports no packet when manuscript bytes changed', async () => {
  const { root, store, source } = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'paper-packet-outside-'))
  try {
    await symlink(outside, join(root, 'linked'), 'dir')
    for (const file of ['../escape.json', '.paper-review/context.json', 'article.md', 'linked/context.json'])
      await expect(store.listFigures('article.md', file)).rejects.toThrow()
    await expect(readFile(join(outside, 'context.json'))).rejects.toThrow()
    await writeFile(join(root, 'article.md'), source + '\nExternal change.\n')
    await expect(store.listFigures('article.md', 'context.json')).rejects.toThrow('external manuscript changes')
    await expect(readFile(join(root, 'context.json'))).rejects.toThrow()
  } finally { await rm(outside, { recursive: true, force: true }) }
})
