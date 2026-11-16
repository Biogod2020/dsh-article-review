/** Create an isolated integration dependency manifest for one supported DSH release. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const version = process.argv[2], target = process.argv[3] && resolve(process.argv[3])
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (!target || !source.engines.dsh.split(' || ').includes(version)) throw new Error('usage: prepare-test-runtime.mjs <supported-dsh-version> <new-directory>')
const pkg = JSON.parse(await readFile(new URL('../validation/harness/package.json', import.meta.url), 'utf8'))
for (const key of Object.keys(pkg.dependencies)) if (key.startsWith('@deepseek-ai/dsh')) pkg.dependencies[key] = version
pkg.dependencies['@deepseek-ai/dsh-util-workspace-path'] = version
// Match the framework versions in the alpha.2 source fixture. Later framework
// prereleases satisfy npm's ~ ranges but break DSH's own preset creation, even
// in a clean profile with no third-party plugin installed.
if (version === '0.2.2-alpha.2') pkg.overrides = {
  '@deepseek-ai/cordis': '4.0.6-alpha.1',
  '@deepseek-ai/cordis-plugin-loader': '1.0.7-alpha.1',
  '@deepseek-ai/cordis-plugin-include': '1.0.11-alpha.1',
  '@deepseek-ai/cordis-plugin-timer': '1.1.8-alpha.1',
  '@deepseek-ai/schemastery': '3.18.6-alpha.1',
}
await mkdir(target, { recursive: true })
await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', { flag: 'wx' })
