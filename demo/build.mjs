/** Bundle the demo client with esbuild (the repository tsconfig extends a DSH monorepo base absent here). */
import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const here = fileURLToPath(new URL('.', import.meta.url))
// node demo/build.mjs [out dir]; the default is demo/dist
const out = process.argv[2] ? resolve(process.argv[2]) : `${here}dist`
await mkdir(out, { recursive: true })
await build({
  entryPoints: [`${here}main.tsx`], bundle: true, outfile: `${out}/main.js`, format: 'esm', target: 'es2022',
  jsx: 'automatic', loader: { '.module.css': 'local-css' }, tsconfigRaw: {}, minify: true, sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
})
await copyFile(`${here}index.html`, `${out}/index.html`)
console.log(`built ${out}`)
