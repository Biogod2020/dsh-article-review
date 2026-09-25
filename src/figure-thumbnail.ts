/** Render the first page of a local PDF into a bounded gallery image. */
import { execFile } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Render a PDF cover or readable page without exposing manuscript bytes to a converter's environment.
 * @param path - already validated local PDF path.
 * @param signal - authenticated request lifetime.
 * @param size - short thumbnail or viewport-sized page.
 * @returns a bounded PNG data URL, or undefined if no renderer can read this PDF.
 */
export async function pdfThumbnail(path: string, signal: AbortSignal, size: 'thumb' | 'full' = 'thumb'): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-paper-figure-'))
  const output = join(directory, 'page.png')
  const pixels = size === 'thumb' ? '256' : '2200'
  const limit = size === 'thumb' ? 2 * 1024 * 1024 : 16 * 1024 * 1024
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(key)))
  const options = { signal, timeout: 15_000, maxBuffer: 64 * 1024, env }
  try {
    const attempts: readonly [string, string[]][] = process.platform === 'darwin'
      ? [
        ['sips', ['-s', 'format', 'png', '-Z', pixels, path, '--out', output]],
        ['pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', pixels, '-png', path, join(directory, 'page')]],
      ]
      : [['pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', pixels, '-png', path, join(directory, 'page')]]]
    for (const [command, args] of attempts) {
      signal.throwIfAborted()
      try {
        await runFile(command, args, options)
        const bytes = await readFile(output)
        if (bytes.length > 0 && bytes.length <= limit && bytes.subarray(0, 8).equals(PNG_HEADER))
          return `data:image/png;base64,${bytes.toString('base64')}`
      } catch (error) {
        if (signal.aborted) throw error
      }
    }
    return undefined
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
