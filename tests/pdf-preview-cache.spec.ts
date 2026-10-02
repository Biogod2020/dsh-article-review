import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PdfPreviewCache } from '../src/pdf-preview-cache.ts'

let directory = ''
const caches: PdfPreviewCache[] = []
afterEach(async () => { caches.splice(0).forEach(cache => cache.dispose()); if (directory) await rm(directory, { recursive: true, force: true }); directory = '' })
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'paper-preview-cache-'))
  const paths = [join(directory, 'first.pdf'), join(directory, 'second.pdf')]
  await Promise.all(paths.map(path => writeFile(path, 'synthetic renderer input')))
  return paths as [string, string]
}
const signal = () => new AbortController().signal

it('shares overlapping preview reads and reuses completed results until the file or size changes', async () => {
  const [path] = await fixture()
  const render = vi.fn(async () => 'data:image/png;base64,AAAA')
  const cache = new PdfPreviewCache(4096, 1, render); caches.push(cache)
  await Promise.all([cache.get(path, signal()), cache.get(path, signal()), cache.get(path, signal())])
  await cache.get(path, signal())
  expect(render).toHaveBeenCalledTimes(1)
  await cache.get(path, signal(), 'full')
  expect(render).toHaveBeenCalledTimes(2)
  await writeFile(path, 'changed synthetic renderer input')
  await cache.get(path, signal())
  expect(render).toHaveBeenCalledTimes(3)
})

it('limits converter concurrency and lets one caller cancel without canceling the shared read', async () => {
  const [path, other] = await fixture()
  const finishes: (() => void)[] = []
  const render = vi.fn(async (_path: string, _signal: AbortSignal) => new Promise<string>(resolve => finishes.push(() => resolve('data:image/png;base64,AAAA'))))
  const cache = new PdfPreviewCache(4096, 1, render); caches.push(cache)
  const first = new AbortController()
  const cancelled = cache.get(path, first.signal).catch(error => error)
  const kept = cache.get(path, signal())
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
  first.abort()
  await cancelled
  expect(render.mock.calls[0]![1].aborted).toBe(false)
  const queued = cache.get(other, signal())
  await new Promise(resolve => setImmediate(resolve))
  expect(render).toHaveBeenCalledTimes(1)
  finishes.shift()!(); await kept
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
  finishes.shift()!(); await queued
})

it('evicts old encoded previews within the byte budget and supports disabling retention', async () => {
  const [first, second] = await fixture()
  const render = vi.fn(async () => 'data:image/png;base64,' + 'A'.repeat(600))
  const cache = new PdfPreviewCache(1000, 1, render); caches.push(cache)
  await cache.get(first, signal()); await cache.get(second, signal()); await cache.get(first, signal())
  expect(render).toHaveBeenCalledTimes(3)
  const disabled = new PdfPreviewCache(0, 1, render); caches.push(disabled)
  await disabled.get(first, signal()); await disabled.get(first, signal())
  expect(render).toHaveBeenCalledTimes(5)
})

it('refuses a preview whose file changed during conversion and allows a clean retry', async () => {
  const [path] = await fixture()
  const render = vi.fn(async () => { await writeFile(path, 'new source during conversion'); return 'data:image/png;base64,AAAA' })
  const cache = new PdfPreviewCache(4096, 1, render); caches.push(cache)
  await expect(cache.get(path, signal())).rejects.toThrow('Figure changed')
  render.mockImplementationOnce(async () => 'data:image/png;base64,BBBB')
  await expect(cache.get(path, signal())).resolves.toContain('BBBB')
})

it('aborts running and queued work on disposal and rejects later reads', async () => {
  const [path, other] = await fixture()
  const render = vi.fn(async (_path: string, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  const cache = new PdfPreviewCache(4096, 1, render); caches.push(cache)
  const first = cache.get(path, signal()).catch(error => error)
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
  const second = cache.get(other, signal()).catch(error => error)
  await new Promise(resolve => setImmediate(resolve))
  cache.dispose(); await Promise.all([first, second])
  expect(render).toHaveBeenCalledTimes(1)
  expect(render.mock.calls[0]![1].aborted).toBe(true)
  await expect(cache.get(path, signal())).rejects.toThrow()
})
