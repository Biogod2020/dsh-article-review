/** Cross-process workspace ownership with automatic release on process exit. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { z } from 'zod'

interface Identity { dev: bigint; ino: bigint }
type Release = () => Promise<void>

const OwnerSchema = z.object({ pid: z.number().int().positive(), kernel: z.literal(true).optional() })

function codeIs(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === code
}

function locked(path: string): Error {
  return new Error(`Paper review workspace is locked: ${path}. Close the other review instance and try again.`)
}

function sameFile(first: Identity, second: Identity): boolean {
  return first.dev === second.dev && first.ino === second.ino
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    if (codeIs(error, 'ESRCH')) return false
    if (codeIs(error, 'EPERM')) return true
    throw error
  }
}

async function posixLock(path: string): Promise<Release> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    try {
      try { await tryLockExclusive(handle.fd) } catch (error) {
        if (codeIs(error, 'EAGAIN') || codeIs(error, 'EWOULDBLOCK')) throw locked(path)
        throw error
      }
      const held = await handle.stat({ bigint: true })
      const current = await lstat(path, { bigint: true }).catch((error: unknown) => {
        if (codeIs(error, 'ENOENT')) return undefined
        throw error
      })
      if (current?.isFile() && sameFile(held, current)) return () => handle.close()
    } catch (error) { await handle.close(); throw error }
    await handle.close()
  }
  throw new Error(`Paper review lock path changed during acquisition: ${path}`)
}

type CreateSemaphoreW = (security: null, initial: number, maximum: number, name: string) => number
type WaitForSingleObject = (handle: number, milliseconds: number) => number
type ReleaseSemaphore = (handle: number, count: number, previous: null) => number
type CloseHandle = (handle: number) => number
type GetLastError = () => number

async function windowsLock(path: string): Promise<Release> {
  const koffi = (await import('koffi')).default
  const kernel32 = koffi.load('kernel32.dll')
  const create = kernel32.func('__stdcall', 'CreateSemaphoreW', 'intptr', ['void*', 'int', 'int', 'str16']) as CreateSemaphoreW
  const wait = kernel32.func('__stdcall', 'WaitForSingleObject', 'uint', ['intptr', 'uint']) as WaitForSingleObject
  const release = kernel32.func('__stdcall', 'ReleaseSemaphore', 'int', ['intptr', 'int', 'void*']) as ReleaseSemaphore
  const close = kernel32.func('__stdcall', 'CloseHandle', 'int', ['intptr']) as CloseHandle
  const lastError = kernel32.func('__stdcall', 'GetLastError', 'uint', []) as GetLastError
  const name = `Local\\dsh-paper-review-${createHash('sha256').update(resolve(path).toLowerCase()).digest('hex')}`
  const handle = create(null, 1, 1, name)
  if (handle === 0) throw new Error(`CreateSemaphoreW failed (${lastError()}): ${path}`)
  const result = wait(handle, 0)
  if (result !== 0) {
    const error = result === 0x102 ? locked(path) : new Error(`WaitForSingleObject failed (${lastError()}): ${path}`)
    close(handle)
    throw error
  }
  return () => {
    const released = release(handle, 1, null)
    const closed = close(handle)
    if (released === 0 || closed === 0) throw new Error(`Paper review lock release failed (${lastError()}): ${path}`)
    return Promise.resolve()
  }
}

async function readOwner(path: string): Promise<(Identity & { pid: number; kernel: boolean }) | undefined> {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)
  const handle = await open(path, flags).catch((error: unknown) => {
    if (codeIs(error, 'ENOENT')) return undefined
    throw error
  })
  if (!handle) return undefined
  try {
    const info = await handle.stat({ bigint: true })
    if (!info.isFile() || info.size > 256n) throw new Error(`Cannot verify paper review owner lock: ${path}`)
    const parsed = OwnerSchema.safeParse(JSON.parse(await handle.readFile('utf8')))
    if (!parsed.success) throw new Error(`Cannot verify paper review owner lock: ${path}`)
    return { dev: info.dev, ino: info.ino, pid: parsed.data.pid, kernel: parsed.data.kernel === true }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Cannot verify paper review owner lock: ${path}`, { cause: error })
    throw error
  } finally { await handle.close() }
}

async function createOwner(path: string): Promise<Identity> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  let identity: Identity
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, kernel: true }))
    await handle.sync()
    const info = await handle.stat({ bigint: true })
    identity = { dev: info.dev, ino: info.ino }
  } catch (error) {
    await handle.close()
    await unlink(temporary).catch((cleanupError: unknown) => {
      if (!codeIs(cleanupError, 'ENOENT')) process.emitWarning(cleanupError instanceof Error ? cleanupError : String(cleanupError))
    })
    throw error
  }
  await handle.close()
  try { await link(temporary, path); return identity } finally {
    await unlink(temporary).catch((error: unknown) => {
      // A leftover private candidate cannot grant ownership; owner.lock remains the only legacy claim.
      if (!codeIs(error, 'ENOENT')) process.emitWarning(error instanceof Error ? error : String(error))
    })
  }
}

/**
 * Hold a kernel lock while preserving the legacy owner.lock barrier for older plugin processes.
 * A dead legacy PID can be adopted under the kernel lock; a live or unverifiable owner is refused.
 * @param stateRoot - canonical private `.paper-review` directory.
 * @returns Cleanup that removes this instance's legacy barrier and releases the kernel lock.
 */
export async function acquireOwnerLock(stateRoot: string): Promise<Release> {
  const path = resolve(stateRoot, 'owner.lock')
  const kernelPath = resolve(stateRoot, 'owner.kernel.lock')
  const releaseKernel = process.platform === 'win32' ? await windowsLock(kernelPath) : await posixLock(kernelPath)
  try {
    let identity: Identity | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await readOwner(path)
      if (existing) {
        const current = await lstat(path, { bigint: true }).catch((error: unknown) => {
          if (codeIs(error, 'ENOENT')) return undefined
          throw error
        })
        if (!current || !sameFile(existing, current)) continue
        if (!existing.kernel && processAlive(existing.pid)) throw locked(path)
        identity = existing
        break
      }
      try { identity = await createOwner(path); break } catch (error) {
        if (!codeIs(error, 'EEXIST')) throw error
      }
    }
    if (!identity) throw locked(path)
    return async () => {
      try {
        const current = await lstat(path, { bigint: true }).catch((error: unknown) => {
          if (codeIs(error, 'ENOENT')) return undefined
          throw error
        })
        if (current && sameFile(identity, current)) await unlink(path)
      } finally { await releaseKernel() }
    }
  } catch (error) { await releaseKernel(); throw error }
}
