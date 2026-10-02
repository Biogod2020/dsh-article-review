/** Run from the repository root so jsdom and node lanes resolve the same test URLs. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const executable = fileURLToPath(new URL('./node_modules/vitest/vitest.mjs', import.meta.url))
const result = spawnSync(process.execPath, [executable, 'run', '--config', 'validation/vitest.config.ts', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
