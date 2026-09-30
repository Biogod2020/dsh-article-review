/** Full native integration lane in a disposable copy; never edits the supplied harness. */
import { cp, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.env.DSH_HARNESS_ROOT
if (!requested) throw new Error('Set DSH_HARNESS_ROOT to an installed DeepSeek Harness checkout. For portable tests use npm run test:setup && npm test.')
const harness = await realpath(requested)
for (const relative of ['node_modules/vitest/vitest.mjs', 'vitest.shared.ts', 'tsconfig.base.json', 'packages/experimental/paper-review/node_modules']) {
  if (!existsSync(join(harness, relative))) throw new Error(`Harness prerequisite missing: ${relative}. Install workspace dependencies and build its native addons first.`)
}
const args = process.argv.slice(2)
if (args.some(arg => arg === '-u' || arg.startsWith('--update'))) throw new Error('Snapshot updates are disabled in the disposable runner; update and review snapshots in your development checkout.')
const temporary = await mkdtemp(join(tmpdir(), 'paper-review-integration-'))
try {
  const stage = join(temporary, 'paper-review')
  await mkdir(stage)
  for (const entry of ['src', 'tests', 'package.json', 'cordis.patch.yml', 'review.overlay.yml']) await cp(join(repo, entry), join(stage, entry), { recursive: true })
  const modules = join(stage, 'node_modules')
  await mkdir(modules)
  const linked = new Set()
  for (const source of [join(harness, 'packages/experimental/paper-review/node_modules'), join(harness, 'node_modules')]) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const names = entry.name.startsWith('@')
        ? (await readdir(join(source, entry.name))).map(name => `${entry.name}/${name}`) : [entry.name]
      for (const name of names) {
        if (linked.has(name)) continue
        await mkdir(dirname(join(modules, name)), { recursive: true })
        await symlink(await realpath(join(source, name)), join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
        linked.add(name)
      }
    }
  }
  await writeFile(join(stage, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', skipLibCheck: true,
  } }))
  const compilerOptions = { target: 'ES2024', module: 'ESNext', moduleResolution: 'Bundler',
    strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noUnusedLocals: true, noUnusedParameters: true, noEmit: true, allowImportingTsExtensions: true,
    skipLibCheck: true, jsx: 'react-jsx', esModuleInterop: true, types: ['node', 'react'], typeRoots: ['./node_modules/@types'] }
  // Host and browser augment different DSH transport contracts; check them separately.
  for (const [name, include] of [
    ['host', ['src/*.ts']],
    ['client', ['src/client/**/*.ts', 'src/client/**/*.tsx', 'src/schema.ts', 'src/change-audit.ts',
      'src/review-queue.ts', 'src/review-blocks.ts', 'src/figures.ts']],
  ]) {
    const filename = `tsconfig.${name}.json`
    await writeFile(join(stage, filename), JSON.stringify({ compilerOptions, include }))
    console.log(`Type-checking ${name} source`)
    execFileSync(process.execPath, [join(modules, 'typescript/bin/tsc'), '-p', filename], { cwd: stage, stdio: 'inherit' })
  }
  const config = `import { defineConfig } from 'vitest/config'
import ts from 'typescript'
import { resolve } from 'node:path'
import { standardDecoratorPlugin, vitestExecArgv } from ${JSON.stringify(join(harness, 'vitest.shared.ts'))}
const h = ${JSON.stringify(harness)}
const paths = ts.readConfigFile(h + '/tsconfig.base.json', ts.sys.readFile).config.compilerOptions.paths
const aliases = Object.entries(paths).sort(([a], [b]) => b.length - a.length).map(([key, [value]]) => ({
  find: new RegExp('^' + key.replace(/[.*+?^\u0024{}()|[\\]\\\\]/g, '\\\\$&').replace('\\\\*', '(.*)') + '$'),
  replacement: resolve(h, value).replace('*', '$1'),
}))
export default defineConfig({ root: process.cwd(), plugins: [standardDecoratorPlugin()],
  resolve: { alias: [
    { find: /^@deepseek-ai\\/dsh-experimental-paper-review$/, replacement: process.cwd() + '/src/index.ts' },
    { find: /^@deepseek-ai\\/dsh-experimental-paper-review\\/client$/, replacement: process.cwd() + '/src/client/index.ts' },
    { find: /^\\.\\.\\/\\.\\.\\/\\.\\.\\/(client|core)\\/(.*)$/, replacement: h + '/packages/$1/$2' }, ...aliases,
  ] },
  oxc: { tsconfig: false, jsx: { runtime: 'automatic' } },
  test: { include: ['tests/**/*.spec.{ts,tsx}'], pool: 'forks', maxWorkers: 3,
    execArgv: vitestExecArgv, testTimeout: 20000, hookTimeout: 20000,
    env: { TSX_TSCONFIG_PATH: process.cwd() + '/tsconfig.json' } },
})`
  await writeFile(join(stage, 'vitest.config.mjs'), config)
  console.log(`Testing current repository source against harness ${execFileSync('git', ['-C', harness, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`)
  const status = await new Promise((resolveStatus, reject) => {
    const child = spawn(process.execPath, [join(modules, 'vitest/vitest.mjs'), 'run', '--config', 'vitest.config.mjs', ...args], { cwd: stage, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => resolveStatus(code ?? 1))
  })
  process.exitCode = status
} finally { await rm(temporary, { recursive: true, force: true }) }
