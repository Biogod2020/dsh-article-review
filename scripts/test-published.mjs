/** Check the plugin against shipped DSH packages and matching upstream test fixtures. */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = fileURLToPath(new URL('..', import.meta.url))
const source = process.env.DSH_HARNESS_SOURCE
if (!source) throw new Error('Set DSH_HARNESS_SOURCE to the matching DSH release source checkout')
const harness = await realpath(source)
const manifest = JSON.parse(await readFile(join(harness, 'package.json'), 'utf8'))
const runtime = process.env.DSH_HARNESS_RUNTIME ? await realpath(process.env.DSH_HARNESS_RUNTIME) : resolve(repo, 'validation/harness/node_modules')
const runtimeManifest = JSON.parse(await readFile(join(runtime, '@deepseek-ai/dsh/package.json'), 'utf8'))
if (!['0.2.0-rc.2', '0.2.1-alpha.4', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.2-alpha.2'].includes(runtimeManifest.version)) throw new Error('Choose a supported DSH runtime with declaration files')
const legacyFixtures = manifest.version === '0.2.1-alpha.4' && ['0.2.0-rc.2', '0.2.1-alpha.4', '0.2.1-rc.2', '0.2.1-rc.3'].includes(runtimeManifest.version)
if (manifest.version !== runtimeManifest.version && !legacyFixtures) throw new Error('Use fixtures from the same release as the DSH runtime')
const args = process.argv.slice(2)
if (args.some(arg => arg === '-u' || arg.startsWith('--update'))) throw new Error('Review snapshot changes in the source checkout; this runner never updates snapshots')
const temporary = await mkdtemp(join(tmpdir(), 'paper-review-published-'))
try {
  for (const entry of ['src', 'tests', 'skills', 'package.json', 'cordis.patch.yml', 'review.overlay.yml']) await cp(join(repo, entry), join(temporary, entry), { recursive: true })
  const modules = join(temporary, 'node_modules')
  const seen = new Set()
  for (const root of [join(repo, 'validation/node_modules'), runtime]) {
    for (const entry of await readdir(root)) {
      if (entry.startsWith('.')) continue
      const names = entry.startsWith('@') ? (await readdir(join(root, entry))).map(name => `${entry}/${name}`) : [entry]
      for (const name of names) {
        if (seen.has(name)) continue
        await mkdir(dirname(join(modules, name)), { recursive: true })
        await symlink(await realpath(join(root, name)), join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
        seen.add(name)
      }
    }
  }
  const paths = {}
  for (const name of await readdir(join(modules, '@deepseek-ai'))) {
    const base = join(modules, '@deepseek-ai', name)
    const pkg = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'))
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      if (typeof value?.types === 'string') paths[`@deepseek-ai/${name}${key === '.' ? '' : key.slice(1)}`] = [join(base, value.types)]
    }
    if (pkg.types && !paths[`@deepseek-ai/${name}`]) paths[`@deepseek-ai/${name}`] = [join(base, pkg.types)]
  }
  const compilerOptions = { target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noUnusedLocals: true, noUnusedParameters: true, noEmit: true, allowImportingTsExtensions: true,
    skipLibCheck: true, jsx: 'react-jsx', esModuleInterop: true, types: ['node', 'react'], typeRoots: ['./node_modules/@types'], paths }
  for (const [face, include] of [['host', ['src/*.ts']], ['client', ['src/client', 'src/schema.ts', 'src/figures.ts', 'src/change-audit.ts', 'src/review-queue.ts', 'src/review-blocks.ts', 'src/workbench-view.ts']]]) {
    const config = `tsconfig.${face}.json`
    await writeFile(join(temporary, config), JSON.stringify({ compilerOptions, include }))
    console.log(`Checking ${face} against published DSH ${runtimeManifest.version}`)
    const result = spawnSync(process.execPath, [join(modules, 'typescript/bin/tsc'), '-p', config], { cwd: temporary, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
  if (!process.exitCode) {
    const config = `import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'
export default defineConfig({root: ${JSON.stringify(temporary)},
  plugins: [{name:'published-dependencies',enforce:'pre',resolveId(id){
    if(id==='vitest'||id.startsWith('vitest/')||id.startsWith('.')||id.startsWith('/')||id.startsWith('\\0')||id.startsWith('node:'))return null
    try{return fileURLToPath(import.meta.resolve(id))}catch{return null}
  }}],
  resolve:{dedupe:['react','react-dom'],alias:[
    {find:'../../../core/agent-loop/tests/mock-adapter.ts',replacement:${JSON.stringify(join(harness, 'packages/core/agent-loop/tests/mock-adapter.ts'))}},
    {find:'../../../client/ui-conversation/src/client/input/facade.ts',replacement:${JSON.stringify(join(harness, 'packages/client/ui-conversation/src/client/input/facade.ts'))}},
  ]},
  oxc:{tsconfig:false,jsx:{runtime:'automatic'}},
  test:{include:['tests/**/*.spec.{ts,tsx}'],pool:'forks',maxWorkers:3,testTimeout:20000,hookTimeout:20000,
    server:{deps:{inline:[/@deepseek-ai\\/dsh-client-ui-primitives/,/@testing-library/,/react-dom/]}},
    execArgv:process.allowedNodeEnvironmentFlags.has('--webstorage')?['--no-webstorage']:[]},
})`
    await writeFile(join(temporary, 'vitest.config.mjs'), config)
    console.log(`Running integration tests against published DSH ${runtimeManifest.version}`)
    const result = spawnSync(process.execPath, [join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs', ...args], { cwd: temporary, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  }
} finally { await rm(temporary, { recursive: true, force: true }) }
