/** Exercise the exact package in a private DSH home with a fictional manuscript and no model calls. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const dsh = process.argv[2], requested = process.argv[3]
assert(dsh && requested, 'usage: node scripts/runtime-smoke.mjs <dsh> <archive-or-package>')
// The installer runs inside a different profile directory; bare relative paths can be Git shorthands.
const source = existsSync(requested) ? resolve(requested) : requested
const root = await mkdtemp(join(tmpdir(), 'article-review-runtime-'))
const home = join(root, 'home'), workspace = join(root, 'manuscript')
await mkdir(home, { mode: 0o700 }); await mkdir(workspace)
const manuscript = '# Compatibility fixture\n\nThis fictional manuscript checks annotation and review recovery.\n'
await writeFile(join(workspace, 'article.md'), manuscript)
const env = { ...process.env, HOME: home, DSH_HOME: join(home, '.dsh') }
const registry = process.env.DSH_SMOKE_REGISTRY ? [`--registry=${process.env.DSH_SMOKE_REGISTRY}`] : []
if (process.env.DSH_SMOKE_ALLOW_RECENT_PACKAGE === '1') {
  // Let DSH create its own profile; opt in only this package, retaining every other pnpm setting.
  await promisify(execFile)(dsh, ['plugin', '--profile', 'web', 'list'], { env, timeout: 120000 })
  const settings = join(env.DSH_HOME, 'profiles/web/pnpm-workspace.yaml')
  const previous = await readFile(settings, 'utf8')
  assert(!/^minimumReleaseAgeExclude:/m.test(previous), 'Fresh fixture unexpectedly has release-age exclusions')
  await writeFile(settings, previous.trimEnd() + '\n\nminimumReleaseAgeExclude:\n  - dsh-article-review\n', { mode: 0o600 })
  console.log('Fixture policy: allow a recent dsh-article-review release; retain pnpm age checks for other packages')
}
await promisify(execFile)(dsh, ['plugin', '--profile', 'web', 'add', source, ...registry], { env, timeout: 120000 })
if (process.env.DSH_SMOKE_EXPECT_VERSION) {
  const installed = JSON.parse(await readFile(join(env.DSH_HOME, 'profiles/web/node_modules/dsh-article-review/package.json'), 'utf8'))
  assert.equal(installed.name, 'dsh-article-review')
  assert.equal(installed.version, process.env.DSH_SMOKE_EXPECT_VERSION, 'Bare-name installation resolved an unexpected version')
  console.log(`Installed ${source}: verified dsh-article-review@${installed.version}`)
}
await writeFile(join(env.DSH_HOME, 'profiles/web/cordis.patch.yml'), '- id: product-analytics\n  disabled: true\n- id: desktop-product-telemetry\n  disabled: true\n', { mode: 0o600 })
let child
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(timer) }
}
async function start(round) {
  const logPath = join(root, `server-${round}.log`), log = await open(logPath, 'wx', 0o600)
  child = spawn(dsh, ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, stdio: ['ignore', log.fd, log.fd] })
  await log.close()
  let login
  for (let i = 0; i < 450; i++) {
    assert.equal(child.exitCode, null, `DSH exited; private diagnostics: ${root}`)
    const match = (await readFile(logPath, 'utf8')).match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)
    if (match) { login = new URL(match[0]); break }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert(login, `DSH startup timed out; private diagnostics: ${root}`)
  const auth = await fetch(login, { redirect: 'manual' })
  assert.equal(auth.status, 303)
  const cookie = auth.headers.getSetCookie().map(row => row.split(';')[0]).join('; ')
  const headers = { Cookie: cookie, Origin: login.origin, 'content-type': 'application/json' }
  const request = (method, payload, customHeaders = headers) => fetch(login.origin + '/api/' + method, {
    method: 'POST', headers: customHeaders,
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }), signal: AbortSignal.timeout(15000),
  })
  const rpc = async (method, payload) => {
    const response = await request(method, payload)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.result?.ok, true, `${method}: ${JSON.stringify(body.result?.error)}`)
    return body.result.value
  }
  if (round === 1) {
    const payload = { sessionId: 'fixture', command: { action: 'open', path: 'article.md' } }
    assert.equal((await request('paper-review/command', payload, { 'content-type': 'application/json' })).status, 401)
    assert.equal((await request('paper-review/command', payload, { ...headers, Origin: 'https://untrusted.invalid' })).status, 403)
    const html = await (await fetch(login.origin, { headers })).text()
    const bundlePath = html.match(/"id":"dsh-article-review","url":"([^"]+)"/)?.[1]
    assert(bundlePath, 'Article Review must be included in the browser module manifest')
    const bundle = await fetch(new URL(bundlePath, login.origin), { headers })
    assert.equal(bundle.status, 200)
    assert((await bundle.text()).includes('dsh-article-review'))
  }
  return rpc
}
try {
  let rpc = await start(1)
  const { sessionId } = await rpc('session/create', { args: { request: { cwd: workspace } } })
  const command = value => rpc('paper-review/command', { sessionId, command: value })
  let view = await command({ action: 'open', path: 'article.md' })
  const block = view.document.current.blocks.find(row => row.kind === 'paragraph')
  assert(block, 'Fictional paragraph must be parsed')
  const revision = view.document.current.id
  view = await command({ action: 'annotate', path: 'article.md', revision, blockId: block.id,
    quote: 'fictional manuscript', prefix: '', suffix: '', comment: 'Generated compatibility note' })
  assert.equal(view.document.annotations.length, 1)
  view = await command({ action: 'review', path: 'article.md', revision, blockIds: [block.id], locked: false })
  assert.equal(view.document.baselines.length, 1)
  assert.equal(view.document.baselines[0].blockId, block.id)
  const saved = JSON.stringify({ annotations: view.document.annotations, baselines: view.document.baselines })
  await stop()
  rpc = await start(2)
  const current = await rpc('paper-review/current', { sessionId })
  assert.equal(current.path, 'article.md')
  const restored = await rpc('paper-review/command', { sessionId, command: { action: 'open', path: 'article.md' } })
  assert.equal(JSON.stringify({ annotations: restored.document.annotations, baselines: restored.document.baselines }), saved)
  assert.equal(await readFile(join(workspace, 'article.md'), 'utf8'), manuscript)
  console.log('Article Review runtime passed: authenticated API, same-origin fence, client bundle, manuscript open, annotation, review baseline and restart recovery. No model called.')
} finally { await stop() }
