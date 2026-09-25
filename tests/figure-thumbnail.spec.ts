/** PDF cover rendering uses a small generated file, never a private manuscript figure. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { pdfThumbnail } from '../src/figure-thumbnail.ts'
import { samplePdf } from './pdf-fixture.ts'

it('renders a bounded PNG cover from a local PDF when a system renderer is available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-paper-thumbnail-test-'))
  try {
    const path = join(directory, 'sample.pdf')
    await writeFile(path, samplePdf())
    const result = await pdfThumbnail(path, new AbortController().signal)
    if (process.platform === 'darwin') expect(result).toMatch(/^data:image\/png;base64,/i)
    else expect(result === undefined || result.startsWith('data:image/png;base64,')).toBe(true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('does not return a thumbnail for a corrupt PDF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-paper-thumbnail-test-'))
  try {
    const path = join(directory, 'bad.pdf')
    await writeFile(path, 'not a PDF')
    expect(await pdfThumbnail(path, new AbortController().signal)).toBeUndefined()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
