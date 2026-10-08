import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { selectedWorkspaceFile } from '../src/selected-file.ts'

let root: string
let workspace: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'paper-selected-'))
  workspace = join(root, 'workspace'); await mkdir(join(workspace, '文档'), { recursive: true })
  await writeFile(join(workspace, '文档', '论文.md'), '# Paper')
  await writeFile(join(workspace, 'refs.bib'), '@article{example}')
  await writeFile(join(workspace, 'figure.PNG'), 'test image')
  await writeFile(join(root, 'outside.bib'), '@article{outside}')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('returns workspace paths for native Markdown, BibTeX and figure selections', async () => {
  expect(await selectedWorkspaceFile(workspace, join(workspace, '文档', '论文.md'), 'md')).toBe('文档/论文.md')
  expect(await selectedWorkspaceFile(workspace, join(workspace, 'refs.bib'), 'bib')).toBe('refs.bib')
  expect(await selectedWorkspaceFile(workspace, join(workspace, 'figure.PNG'), 'figure')).toBe('figure.PNG')
})

it('refuses outside paths, relative paths and incorrect extensions', async () => {
  await expect(selectedWorkspaceFile(workspace, join(root, 'outside.bib'), 'bib')).rejects.toThrow('inside')
  await expect(selectedWorkspaceFile(workspace, 'refs.bib', 'bib')).rejects.toThrow('absolute')
  await expect(selectedWorkspaceFile(workspace, join(workspace, 'refs.bib'), 'md')).rejects.toThrow('.md')
  await mkdir(join(workspace, 'directory.bib'))
  await expect(selectedWorkspaceFile(workspace, join(workspace, 'directory.bib'), 'bib')).rejects.toThrow('directory')
})

it.skipIf(process.platform === 'win32')('refuses a workspace symlink pointing outside', async () => {
  await symlink(join(root, 'outside.bib'), join(workspace, 'escape.bib'))
  await expect(selectedWorkspaceFile(workspace, join(workspace, 'escape.bib'), 'bib')).rejects.toThrow('inside')
})
