/** Bundle the demo client with esbuild (the repository tsconfig extends a DSH monorepo base absent here). */
import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const here = fileURLToPath(new URL('.', import.meta.url))
await mkdir(`${here}dist`, { recursive: true })
await build({
  entryPoints: [`${here}main.tsx`], bundle: true, outfile: `${here}dist/main.js`, format: 'esm', target: 'es2022',
  jsx: 'automatic', loader: { '.module.css': 'local-css' }, tsconfigRaw: {}, minify: true, sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
})
await copyFile(`${here}index.html`, `${here}dist/index.html`)
console.log('built demo/dist')
