/** Refuse unbuilt or nonportable release tags before registry publication. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(pkg.name, 'dsh-article-review')
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`)
assert(!JSON.stringify(pkg).includes('workspace:'), 'Publish only the prepared release tag')
assert(pkg.engines.dsh.includes('0.2.1-rc.3'))
assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-native-command'], pkg.engines.dsh)
const hashes = JSON.parse(await readFile('release-runtime-sha256.json', 'utf8'))
for (const file of ['lib/index.js', 'lib/client.js']) {
  const source = await readFile(file)
  assert.equal(createHash('sha256').update(source).digest('hex'), hashes[file], `Untested runtime file: ${file}`)
  assert(!source.toString().includes('/Users/jay/'), 'Release must not contain private builder paths')
}
assert(!/\brequire\(["']zod["']\)/.test(await readFile('lib/client.js', 'utf8')))
assert((await readdir('lib/types')).some(file => file.endsWith('.d.ts')))
for (const skill of ['paper-project-start', 'paper-figure-panels']) await readFile(`skills/${skill}/SKILL.md`)
console.log('Prepared release identity, host/client hashes, declarations and bundled skills verified')
