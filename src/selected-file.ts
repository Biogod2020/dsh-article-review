/** Resolve a picked host path without allowing an outside file or escaping symlink. */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

/** Native and Desktop selections have the same workspace boundary and portable return path. */
export async function selectedWorkspaceFile(root: string, selected: string, kind: 'md' | 'bib' | 'figure'): Promise<string> {
  if (!isAbsolute(selected)) throw new Error('Selected file must have an absolute host path')
  const source = await realpath(selected)
  const path = relative(await realpath(root), source)
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('Chosen file must be inside the conversation workspace')
  }
  const extensions = kind === 'figure' ? /\.(pdf|png|jpg|jpeg|webp|gif|svg)$/i : kind === 'bib' ? /\.bib$/i : /\.md$/i
  if (!extensions.test(path)) throw new Error(`Choose a ${kind === 'figure' ? 'PDF or image' : `.${kind}`} file`)
  if (!(await stat(source)).isFile()) throw new Error('Choose a file, not a directory')
  return path.split(sep).join('/')
}
