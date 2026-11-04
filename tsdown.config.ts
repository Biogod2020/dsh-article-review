import { clientBundle } from './scripts/tsdown.client.ts'
export default clientBundle('dsh-article-review', ['src/index.ts'], {
  libExternal: [/^@deepseek-ai\//, 'koffi', 'semver'],
  companions: [{ entry: ['src/update-worker.ts'], outDir: 'lib', format: 'esm', platform: 'node', target: 'node22',
    clean: false, noExternal: ['semver'], dts: false, outputOptions: { entryFileNames: 'update-worker.js' } }],
})
