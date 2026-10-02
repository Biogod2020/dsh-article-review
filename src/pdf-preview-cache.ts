/** Bounded reuse and a shared converter queue for authenticated PDF previews. */
import { stat } from 'node:fs/promises'
import { pdfThumbnail } from './figure-thumbnail.ts'

type Size = 'thumb' | 'full'
type Flight = { controller: AbortController; promise: Promise<string | undefined>; readers: Set<symbol> }

async function fingerprint(path: string): Promise<string> {
  const file = await stat(path, { bigint: true })
  return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`
}

/** Plugin-lifetime memory and converter limits; callers independently own cancellation. */
export class PdfPreviewCache {
  private readonly lifetime = new AbortController()
  private readonly cached = new Map<string, { url: string; bytes: number }>()
  private readonly pending = new Map<string, Flight>()
  private readonly queue: (() => void)[] = []
  private bytes = 0
  private active = 0

  constructor(private readonly maxBytes: number, private readonly concurrency: number,
    private readonly render: typeof pdfThumbnail = pdfThumbnail) {}

  private slot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.active < this.concurrency) { this.active++; return Promise.resolve() }
    return new Promise((resolve, reject) => {
      const start = (): void => { signal.removeEventListener('abort', abort); this.active++; resolve() }
      const abort = (): void => {
        const at = this.queue.indexOf(start)
        if (at >= 0) this.queue.splice(at, 1)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true }); this.queue.push(start)
    })
  }

  private async convert(path: string, size: Size, identity: string, key: string, signal: AbortSignal): Promise<string | undefined> {
    await this.slot(signal)
    try {
      signal.throwIfAborted()
      const url = await this.render(path, signal, size)
      signal.throwIfAborted()
      if (await fingerprint(path) !== identity) throw new Error('Figure changed while creating preview; retry')
      if (url) {
        const bytes = Buffer.byteLength(url) + Buffer.byteLength(key)
        if (bytes <= this.maxBytes) {
          while (this.bytes + bytes > this.maxBytes) {
            const oldest = this.cached.keys().next().value
            if (oldest === undefined) break
            this.bytes -= this.cached.get(oldest)!.bytes; this.cached.delete(oldest)
          }
          this.cached.set(key, { url, bytes }); this.bytes += bytes
        }
      }
      return url
    } finally { this.active--; this.queue.shift()?.() }
  }

  /** Resolve only an already workspace-validated path; file identity prevents reuse after replacement. */
  async get(path: string, signal: AbortSignal, size: Size = 'thumb'): Promise<string | undefined> {
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    const identity = await fingerprint(path)
    signal.throwIfAborted(); this.lifetime.signal.throwIfAborted()
    const key = `${path}\0${size}\0${identity}`
    const cached = this.cached.get(key)
    if (cached) { this.cached.delete(key); this.cached.set(key, cached); return cached.url }
    let flight = this.pending.get(key)
    if (!flight || flight.controller.signal.aborted) {
      const controller = new AbortController()
      const owned: Flight = { controller, readers: new Set(), promise: Promise.resolve(undefined) }
      owned.promise = this.convert(path, size, identity, key, AbortSignal.any([controller.signal, this.lifetime.signal]))
        .finally(() => { if (this.pending.get(key) === owned) this.pending.delete(key) })
      flight = owned; this.pending.set(key, flight)
    }
    const owned = flight, reader = Symbol()
    owned.readers.add(reader)
    return new Promise((resolve, reject) => {
      const release = (): void => {
        signal.removeEventListener('abort', abort); owned.readers.delete(reader)
        if (owned.readers.size === 0) owned.controller.abort()
      }
      const abort = (): void => { release(); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      owned.promise.then(value => { release(); resolve(value) }, error => { release(); reject(error) })
    })
  }

  /** Abort queued/running converters and release all retained preview data on plugin disposal. */
  dispose(): void { this.lifetime.abort(); this.cached.clear(); this.bytes = 0; this.pending.clear() }
}
