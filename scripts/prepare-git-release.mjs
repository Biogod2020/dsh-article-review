/** Copy the built plugin into a Git worktree with registry-resolvable runtime dependencies. */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('..', import.meta.url))
const target = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (target === undefined || target === source) throw new Error('Provide a separate release worktree path')

const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const releaseManifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
if (releaseManifest.name !== sourceManifest.name || releaseManifest.version !== sourceManifest.version) {
  throw new Error('Release worktree must match the source package name and version')
}

async function copyArtifact(path) {
  const destination = join(target, path)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(join(source, path), destination)
}

async function copyDeclarations(directory) {
  let count = 0
  for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += await copyDeclarations(path)
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) { await copyArtifact(path); count += 1 }
  }
  return count
}

await copyArtifact('lib/index.js')
await copyArtifact('lib/client.js')
const clientPath = join(target, 'lib/client.js')
// CSS module labels keep relative paths; the release does not ship the client sourcemap.
await writeFile(clientPath, (await readFile(clientPath, 'utf8'))
  .replace(/[ \t]+$/gm, '')
  .replace(/^([ \t]*\/\/#region \\0dsh-css:).*[/\\]src[/\\]/gm, '$1src/')
  .replace(/^\/\/# sourceMappingURL=client\.js\.map\r?\n?/gm, '').trimEnd() + '\n')
if (await copyDeclarations('lib/types') === 0) throw new Error('Build the declaration files before preparing a release')

const dependencies = { ...releaseManifest.dependencies }
for (const [name, version] of Object.entries({
  '@deepseek-ai/node-addon-system': '^0.1.2',
  '@deepseek-ai/dsh-native-command': '0.0.1-rc.1',
  '@deepseek-ai/schemastery': '^3.18.3',
})) {
  if (dependencies[name] !== 'workspace:^' && dependencies[name] !== version) {
    throw new Error(`Unexpected source dependency: ${name}`)
  }
  dependencies[name] = version
}
if (dependencies.koffi !== '^3.1.0' && !(dependencies.koffi === undefined && releaseManifest.peerDependencies?.koffi === '^3.1.0')) {
  throw new Error('Unexpected koffi source dependency')
}
delete dependencies.koffi
releaseManifest.dependencies = dependencies
releaseManifest.peerDependencies = { '@deepseek-ai/cordis': '^4.0.3', koffi: '^3.1.0' }
releaseManifest.peerDependenciesMeta = { koffi: { optional: true } }
releaseManifest.engines = { node: '^22.19.0 || >=24' }
delete releaseManifest.devDependencies
delete releaseManifest.scripts
delete releaseManifest.exports['./src/*']
if (JSON.stringify(releaseManifest).includes('workspace:')) throw new Error('Release manifest still has workspace dependencies')
await writeFile(join(target, 'package.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`)
