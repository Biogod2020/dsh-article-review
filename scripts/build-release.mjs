/** Build outside the DSH monorepo, against the same published SDK used by integration tests. */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const repo = fileURLToPath(new URL('..', import.meta.url))
const runtime = await realpath(process.env.DSH_HARNESS_RUNTIME ?? join(repo, 'validation/harness/node_modules'))
await mkdir(join(repo, '.artifacts'), { recursive: true })
const build = await mkdtemp(join(repo, '.artifacts/build-'))
for (const entry of ['src','scripts','package.json','tsdown.config.ts']) await cp(join(repo,entry),join(build,entry),{recursive:true})
const modules=join(build,'node_modules'), seen=new Set()
for(const root of [join(repo,'validation/node_modules'),runtime]) {
  for(const entry of await readdir(root)) {
    if(entry.startsWith('.'))continue
    const names=entry.startsWith('@')?(await readdir(join(root,entry))).map(name=>`${entry}/${name}`):[entry]
    for(const name of names) { if(seen.has(name))continue; await mkdir(dirname(join(modules,name)),{recursive:true}); await symlink(await realpath(join(root,name)),join(modules,name),process.platform==='win32'?'junction':'dir');seen.add(name) }
  }
}
const paths={}
for(const name of await readdir(join(modules,'@deepseek-ai'))) {
  const base=join(modules,'@deepseek-ai',name),pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'))
  for(const [key,value] of Object.entries(pkg.exports??{}))if(typeof value?.types==='string') paths[`@deepseek-ai/${name}${key==='.'?'':key.slice(1)}`]=[join(base,value.types)]
  if(pkg.types&&!paths[`@deepseek-ai/${name}`])paths[`@deepseek-ai/${name}`]=[join(base,pkg.types)]
}
const compilerOptions={target:'ES2024',module:'ESNext',moduleResolution:'Bundler',strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,skipLibCheck:true,jsx:'react-jsx',esModuleInterop:true,allowImportingTsExtensions:true,declaration:true,emitDeclarationOnly:true,outDir:'lib/types',rootDir:'src',types:['node','react'],typeRoots:['./node_modules/@types'],paths}
function run(tool,args) {
  const result=spawnSync(process.execPath,[join(modules,tool),...args],{cwd:build,stdio:'inherit'})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status??1)
}
for(const [face,include] of [['host',['src/*.ts']],['client',['src/client']]]) {
  await writeFile(join(build,'tsconfig.json'),JSON.stringify({compilerOptions,include}))
  run('typescript/bin/tsc',['-p','tsconfig.json'])
}
// SDK declaration aliases are for tsc only; runtime bundles resolve published JS.
await writeFile(join(build,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2024',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx'}}))
run('tsdown/dist/run.mjs',[])
await cp(join(build,'lib'),join(repo,'lib'),{recursive:true})
console.log('Built host, browser, declarations and independent update worker')
