/** Import staging preserves exact prose and never follows an output symlink. */
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ArticleInputSchema, prepareArticleInput } from '../src/article-input.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'article-input-')); roots.push(root); return root }
it('stages exact UTF-8 prose once and accepts an explicitly supplied outside source', async () => {
  const root = await workspace(), outside = await workspace(), text = '标题\n\nExact prose, α = 0.05.\n'
  const source = await prepareArticleInput(root, { text })
  expect(await readFile(source, 'utf8')).toBe(text)
  expect(await prepareArticleInput(root, { text })).toBe(source)
  await writeFile(join(outside, 'paper.txt'), text)
  expect(await prepareArticleInput(root, { source: join(outside, 'paper.txt') })).toContain('/paper.txt')
  expect(ArticleInputSchema.safeParse({ source: 'paper.txt', text }).success).toBe(false)
})
it('rejects a staging directory that points outside the workspace', async () => {
  const root = await workspace(), outside = await workspace()
  await symlink(outside, join(root, '.paper-import-inputs'), 'dir')
  await expect(prepareArticleInput(root, { text: 'Article' })).rejects.toThrow('escapes')
})
