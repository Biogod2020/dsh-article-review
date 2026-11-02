/**
 * Command-line bridge to the project tools, for agents that cannot call DSH tools (e.g. a Claude Code subagent in a
 * model comparison). Same functions, validation, warnings and next steps as project_read / project_apply / ... in DSH.
 *
 * Usage: npx tsx project-tool.ts <read|apply|comment|draft|link|number_hints> <project-dir> <args.json | ->
 *   args.json holds the tool arguments without `project`, e.g. {"changes": [...], "reason": "..."}; "-" reads stdin.
 */
import { readFileSync } from 'node:fs'
import { ProjectStore } from '../../src/project/store.ts'
import { applyTool, commentTool, draftTool, linkTool, numberHintsTool, readTool } from '../../src/project/tools.ts'

const [tool, dir, file] = process.argv.slice(2)
if (!tool || !dir || !file) { console.error('usage: project-tool.ts <tool> <project-dir> <args.json | ->'); process.exit(2) }
const args = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'))
const store = new ProjectStore(dir)
const actor = process.env.PROJECT_ACTOR ?? 'agent（命令行）'
const run = { read: () => readTool(store, args), apply: () => applyTool(store, args, actor), comment: () => commentTool(store, args),
  draft: () => draftTool(store, args, actor), link: () => linkTool(store, args, actor), number_hints: () => numberHintsTool(store, args) }[tool]
if (!run) { console.error(`unknown tool ${tool}`); process.exit(2) }
run().then(v => console.log(JSON.stringify(v, null, 1)), e => { console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })); process.exit(1) })
