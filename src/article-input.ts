/** Stage exact pasted prose, or resolve the file explicitly selected for import. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

export const ArticleInputSchema = z.object({
  source: z.string().min(1).max(4000).optional(),
  text: z.string().min(1).max(2_000_000).optional(),
}).refine(input => Boolean(input.source) !== Boolean(input.text), 'Provide one article file or pasted text')
export type ArticleInput = z.infer<typeof ArticleInputSchema>

/** Return a real input path; generated Markdown will still be confined to the workspace. */
export async function prepareArticleInput(workspace: string, input: ArticleInput): Promise<string> {
  const root = await realpath(workspace)
  if (input.source !== undefined) {
    if (input.source.includes('\0')) throw new Error('Invalid article path')
    const source = await realpath(isAbsolute(input.source) ? input.source : resolve(root, input.source))
    const info = await stat(source)
    if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Choose an article file no larger than 100 MiB')
    return source
  }
  const text = input.text ?? ''
  if (!text.trim() || Buffer.byteLength(text) > 2_000_000) throw new Error('Paste nonempty article text no larger than 2 MB')
  const directory = resolve(root, '.paper-import-inputs')
  await mkdir(directory, { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const actual = await realpath(directory)
  const distance = relative(root, actual)
  if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) throw new Error('Article input directory escapes the workspace')
  const source = resolve(actual, `article-${createHash('sha256').update(text).digest('hex').slice(0, 20)}.txt`)
  const handle = await open(source, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    .catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(source)
      if (!info.isFile() || info.isSymbolicLink() || await readFile(source, 'utf8') !== text) throw new Error('Staged article source no longer matches pasted text')
      return undefined
    })
  if (handle) {
    try { await handle.writeFile(text, 'utf8'); await handle.sync() } finally { await handle.close() }
  }
  return source
}
