/** Two-process review ownership, crash recovery, and legacy owner protection. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PaperStore } from '../src/store.ts'

const HOLDER = fileURLToPath(new URL('./fixtures/owner-holder.mjs', import.meta.url))
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-paper-owner-'))
  roots.push(root)
  await writeFile(join(root, 'article.md'), '# Manuscript\n')
  return root
}

describe('review workspace ownership', () => {
  it('refuses a live legacy owner even when no kernel lock is held', async () => {
    const root = await workspace()
    const state = join(root, '.paper-review')
    await mkdir(state)
    await writeFile(join(state, 'owner.lock'), JSON.stringify({ pid: process.pid }))
    await expect(new PaperStore(root, 1_000_000).start()).rejects.toThrow('locked')
  })

  it('takes over a kernel owner record even when its old PID has been reused', async () => {
    const root = await workspace()
    const state = join(root, '.paper-review')
    await mkdir(state)
    await writeFile(join(state, 'owner.lock'), JSON.stringify({ pid: process.pid, kernel: true }))
    const store = new PaperStore(root, 1_000_000)
    await store.start()
    await store.close()
    await expect(readFile(join(state, 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('admits exactly one successor after a holder crashes with owner.lock present', { timeout: 30_000 }, async () => {
    const root = await workspace()
    const child = spawn(process.execPath, ['--import', 'tsx/esm', HOLDER, root], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const ready = new Promise<void>((resolve, reject) => {
      child.stdout?.once('data', () => { resolve() })
      child.once('error', reject)
      child.once('exit', (code) => { reject(new Error(`Review holder exited before acquisition: ${code}`)) })
    })
    let winner: PaperStore | undefined
    try {
      await ready
      expect(JSON.parse(await readFile(join(root, '.paper-review', 'owner.lock'), 'utf8'))).toEqual({ pid: child.pid, kernel: true })
      await expect(new PaperStore(root, 1_000_000).start()).rejects.toThrow('locked')
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited

      const contenders = [new PaperStore(root, 1_000_000), new PaperStore(root, 1_000_000)]
      const results = await Promise.allSettled(contenders.map(store => store.start()))
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      winner = contenders[results.findIndex(result => result.status === 'fulfilled')]
      expect((await winner!.read('article.md')).document.current.text).toBe('# Manuscript\n')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
      await winner?.close()
    }
    await expect(readFile(join(root, '.paper-review', 'owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
