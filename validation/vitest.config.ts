/** Portable core lane: no DSH installation, credentials, model API, or native addon. */
import { defineConfig } from 'vitest/config'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const packages = ['vitest', 'fast-check', 'zod', 'mdast-util-from-markdown', 'mdast-util-gfm',
  'micromark-extension-gfm', 'diff', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
  'react-dom', 'react-dom/client', 'react-dom/test-utils', '@testing-library/react', '@testing-library/dom']
export default defineConfig({
  root: realpathSync(fileURLToPath(new URL('..', import.meta.url))),
  resolve: { alias: packages.map(name => ({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: fileURLToPath(import.meta.resolve(name)) })) },
  oxc: { tsconfig: false, jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/document.spec.ts', 'tests/change-audit.spec.ts', 'tests/document-properties.spec.ts',
      'tests/manuscript-read.spec.ts', 'tests/review-queue.spec.ts', 'tests/change-evidence.client.spec.tsx',
      'tests/bibliography.spec.ts', 'tests/block-pairing.client.spec.ts', 'tests/citation-display.client.spec.ts',
      'tests/context.client.spec.ts', 'tests/figures.client.spec.ts', 'tests/selection.client.spec.ts'],
    pool: 'forks', maxWorkers: 2,
    execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
  },
})
