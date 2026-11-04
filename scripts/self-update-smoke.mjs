/** Real package-manager and Host restart acceptance, entirely in a generated HOME. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const [dsh, archiveArgument] = process.argv.slice(2)
const archive = archiveArgument && resolve(archiveArgument)
const normalize = (command, args) => {
  if (command === 'npm' && process.platform === 'win32') return [process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args]]
  if (/\.js$/.test(command)) return [process.execPath, [command, ...args]]
  return [command, args]
}
const exec = (command, args, options) => { const [bin, argv] = normalize(command, args); return promisify(execFile)(bin, argv, { windowsHide: true, ...options }) }
const start = (command, args, options) => { const [bin, argv] = normalize(command, args); return spawn(bin, argv, { windowsHide: true, ...options }) }
assert(dsh && archive, 'usage: self-update-smoke.mjs <DSH executable> <verified archive>')
const root = await mkdtemp(join(tmpdir(), 'dsh-self-update-smoke-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
const manuscript = '# Update fixture\n\nThis fictional manuscript retains review data through updates.\n'
await writeFile(join(workspace, 'article.md'), manuscript)
const home = join(root, 'home'), extracted = join(root, 'artifact')
await mkdir(home, { mode: 0o700 }); await mkdir(extracted)
await exec('tar', ['-xzf', archive, '-C', extracted])
const pkgDir = join(extracted, 'package'), manifest = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'))
const baseVersion = manifest.version, version = baseVersion.includes('-') ? baseVersion + '.smoke' : baseVersion.replace(/(\d+)$/, value => String(Number(value) + 1)) + '-smoke.0'
manifest.version = version
await writeFile(join(pkgDir, 'package.json'), JSON.stringify(manifest))
await exec('npm', ['pack', '--ignore-scripts', '--pack-destination', root], { cwd: pkgDir, timeout: 60000 })
const packed = await readFile(join(root, `dsh-article-review-${version}.tgz`))
const integrity = 'sha512-' + createHash('sha512').update(packed).digest('base64')
const env = { ...process.env, HOME: home, ...(process.platform === 'win32' ? { USERPROFILE: home } : {}), DSH_HOME: join(home, '.dsh') }
await exec(dsh, ['plugin', '--profile', 'web', 'add', archive, '--registry=https://registry.npmjs.org'], { env, timeout: 90000 })
const profile = join(env.DSH_HOME, 'profiles/web'), state = join(profile, '.dsh-article-review-updates')
// The tarball stands in for the npm release awaiting publication.
const originalProfile = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
originalProfile.dependencies['dsh-article-review'] = baseVersion
originalProfile.fixture = 'keep unrelated profile fields'
await writeFile(join(profile, 'package.json'), JSON.stringify(originalProfile))
const fixtureConfig = join(env.DSH_HOME, 'article-data-fixture.json')
await writeFile(fixtureConfig, JSON.stringify({ version: 1, hosts: [] }), { mode: 0o600 })
const originalConfig = await readFile(fixtureConfig)
let host, helper, registry, stopRegistry
const children = []
process.once('SIGTERM', () => { void (async () => {
  try { if (host?.child.exitCode === null) await host.setEnabled(false) } catch {}
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  stopRegistry?.(); process.exit(143)
})() })
async function wait(check, milliseconds = 120000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) { if (await check().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Self-update smoke exceeded a deadline; private diagnostics: ${root}`)
}
async function startHost(label) {
  let output = ''
  const child = start(dsh, ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child)
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  let login
  await wait(async () => { const raw = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]; if (raw) login = new URL(raw); return !!login })
  const response = await fetch(login, { redirect: 'manual' })
  const headers = { Cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), Origin: login.origin }
  const call = async payload => {
    const response = await fetch(login.origin + '/api/paper-review/update', { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type:'client-request',rpcId:'update-smoke',method:'paper-review/update',payload }), signal: AbortSignal.timeout(45000) })
    assert.equal(response.status, 200, label + ' updater carrier')
    const envelope = await response.json(); assert.equal(envelope.result.ok,true,JSON.stringify(envelope.result)); return envelope.result.value
  }
  const unauth = await fetch(login.origin + '/api/paper-review/update', { method:'POST',headers:{'Content-Type':'application/json'},body:'{}' })
  assert.equal(unauth.status,401)
  const crossSite = await fetch(login.origin + '/api/paper-review/update', { method:'POST',headers:{...headers,Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:'{}' })
  assert.equal(crossSite.status,403)
  const view = () => call({})
  const setEnabled = enabled => call({ enabled })
  const rpc = async (method, payload) => {
    const response = await fetch(login.origin + '/api/' + method, {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'fixture',method,payload})})
    const body = await response.json(); assert.equal(body.result.ok,true,JSON.stringify(body.result)); return body.result.value
  }
  return { child, view, setEnabled, login, rpc }
}
try {
  host = await startHost('before')
  const initial = await host.view()
  assert.equal(initial.enabled, false); assert.equal(initial.supported, true); assert.equal(initial.runningVersion, baseVersion)
  const { sessionId } = await host.rpc('session/create', {args:{request:{cwd:workspace}}})
  const command = value => host.rpc('paper-review/command', {sessionId,command:value})
  let document = (await command({action:'open',path:'article.md'})).document
  const block = document.current.blocks.find(row=>row.kind==='paragraph')
  assert(block)
  document = (await command({action:'annotate',path:'article.md',revision:document.current.id,blockId:block.id,quote:'fictional manuscript',prefix:'',suffix:'',comment:'Preserve this review note'})).document
  document = (await command({action:'review',path:'article.md',revision:document.current.id,blockIds:[block.id],locked:false})).document
  const savedReview = JSON.stringify({annotations:document.annotations,baselines:document.baselines})
  if (process.env.DSH_UPDATE_BROWSER_SMOKE === '1') {
    await host.rpc('workspace/create', { args: { request: { path: workspace } } })
    await writeFile(join(root, 'browser.json'), JSON.stringify({ login: host.login.href, profile, root }), { mode: 0o600 })
    console.log(JSON.stringify({ browserFixture: root }))
    await wait(async () => { await readFile(join(root, 'browser-complete')); return true }, 180000)
  }
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0])
    if (path === '/dsh-article-review') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ name: 'dsh-article-review', 'dist-tags': { latest: version }, versions: {
        [version]: { ...manifest, dist: { tarball: registry + `/dsh-article-review/-/dsh-article-review-${version}.tgz`, integrity } },
      } })); return
    }
    if (path === `/dsh-article-review/-/dsh-article-review-${version}.tgz`) { res.end(packed); return }
    try {
      const upstream = await fetch('https://registry.npmjs.org' + req.url, { signal: AbortSignal.timeout(30000) })
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { res.writeHead(502); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  registry = 'http://127.0.0.1:' + server.address().port
  stopRegistry = () => { server.closeAllConnections(); server.close() }
  // A real UI opt-out can leave the already-started one-shot helper finishing.
  await wait(async () => { try { await readFile(join(state, 'worker.lock')); return false } catch { return true } })
  const configFile = join(state, 'config.json')
  const config = JSON.parse(await readFile(configFile, 'utf8')); config.enabled = true
  const wrapper = join(root, 'package-manager.cjs')
  await writeFile(wrapper, `const fs=require('fs'),cp=require('child_process');const out=fs.openSync(${JSON.stringify(join(root, 'package-manager.log'))},'a',0o600);const child=cp.spawn(process.argv[2],process.argv.slice(3),{stdio:['ignore',out,out]});process.on('SIGTERM',()=>{child.kill('SIGTERM');process.exit(143)});child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));`)
  config.packageManager = { command: process.execPath, args: [wrapper, config.packageManager.command, ...config.packageManager.args], env: config.packageManager.env }
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
  const worker = join(pkgDir, 'lib/update-worker.js')
  let diagnostics = ''
  helper = spawn(config.executable, [...config.executableArgs, '--input-type=module', '-e', 'import(process.argv[1]).then(m=>m.runUpdate(process.argv[2],{registry:process.argv[3],onError:e=>console.error(e)}))', pathToFileURL(worker).href, configFile, registry],
    { env: { ...env, PATH: process.platform === 'win32' ? process.env.SystemRoot + '\\System32;' + process.env.SystemRoot : '/usr/bin:/bin:/usr/sbin:/sbin', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] }); children.push(helper)
  helper.stderr.on('data', bytes => { diagnostics += bytes })
  const phase = async () => JSON.parse(await readFile(join(state, 'status.json'), 'utf8')).phase
  try { await wait(async () => await phase() === 'waiting') }
  catch (error) { await writeFile(join(root, 'helper.log'), diagnostics, { mode: 0o600 }); console.error(diagnostics); console.error(await readFile(join(root, 'package-manager.log'), 'utf8').catch(() => 'Package manager was not started')); throw error }
  assert.equal((await host.view()).runningVersion, baseVersion, 'the running Host must not be replaced')
  host.child.kill('SIGTERM'); await new Promise(resolve => host.child.once('exit', resolve))
  await wait(async () => helper.exitCode !== null)
  await writeFile(join(root, 'helper.log'), diagnostics, { mode: 0o600 })
  assert.equal(await phase(), 'installed', 'the independent helper must finish after Host exit')
  assert.deepEqual(await readFile(fixtureConfig), originalConfig)
  const updatedProfile = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.equal(updatedProfile.fixture, originalProfile.fixture)
  assert.equal(updatedProfile.dependencies['dsh-article-review'], version)
  host = await startHost('after')
  assert.equal((await host.view()).runningVersion, version, 'the next Host must execute the prepared package')
  const restored = (await command({action:'open',path:'article.md'})).document
  assert.equal(JSON.stringify({annotations:restored.annotations,baselines:restored.baselines}),savedReview)
  assert.equal(await readFile(join(workspace,'article.md'),'utf8'),manuscript)
  await host.setEnabled(false)
  host.child.kill('SIGTERM'); await new Promise(resolve => host.child.once('exit', resolve))
  await exec(config.packageManager.command, [...config.packageManager.args, 'install', '--frozen-lockfile', '--offline', '--ignore-scripts', '--ignore-pnpmfile', '--registry=' + registry],
    { cwd: profile, env: { ...env, ...config.packageManager.env }, timeout: 120000 })
  assert.equal(JSON.parse(await readFile(join(profile, 'node_modules/dsh-article-review/package.json'), 'utf8')).version, version)
  console.log('Self-update acceptance passed: real pnpm, verified archive, active Host protection, exit installation, retained article data, and new version after restart')
} finally {
  if (host?.child.exitCode === null) { try { await host.setEnabled(false) } catch {} }
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  stopRegistry?.()
}
