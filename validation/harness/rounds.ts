/**
 * Plays the Paper panel's part for agents outside DSH: decides the next initialisation round from the project's state,
 * with the same planning and messages as the plugin (init-job.ts), and keeps the job in <project>/reading/job.json.
 *
 * Usage: npx tsx rounds.ts <workspace> <project> <prepare|next>   (prints the next message, or DONE / PAUSED: why)
 *   prepare takes the manuscript path from $SOURCE.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { argumentMessage, checkMessage, copyMessage, errorLines, copyState, planBatches, prepareMessage, referencePages } from '../../src/project/init-job.ts'
import type { Batch, CopyState, InitPhase } from '../../src/project/init-job.ts'

const [ws, output, cmd] = process.argv.slice(2) as [string, string, string]
const dir = resolve(ws, output)
const jobFile = resolve(dir, 'reading', 'job.json')
const jsonOr = <T>(p: string, d: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) as T } catch { return d } }
interface Job { phase: InitPhase, batches: Batch[], index: number, retried: boolean, checkRounds: number, before: CopyState | null, withRepo: boolean }
const save = (j: Job): void => { if (existsSync(resolve(dir, 'reading'))) writeFileSync(jobFile, JSON.stringify(j, null, 1)) }
const errors = (): string[] => errorLines(jsonOr(resolve(dir, 'init-findings.json'), []))

if (cmd === 'prepare') {
  console.log(prepareMessage([`Workspace: ${JSON.stringify(ws)}`, `Manuscript: ${JSON.stringify(process.env.SOURCE)}`, `New project directory: ${JSON.stringify(output)}`, 'The original files are only read.']))
  process.exit(0)
}
let job = jsonOr<Job | null>(jobFile, null)
const project = () => jsonOr(resolve(dir, 'project.json'), {})
if (!job) {
  const init = jsonOr<{ reading?: { kind?: string, text?: Record<string, string> }, repo?: unknown } | null>(resolve(dir, 'init.json'), null)
  if (!init) { console.log('PAUSED: preparation did not finish'); process.exit(0) }
  const pages = Object.keys(init.reading?.text ?? {}).sort().filter(t => /\/p\d+\.txt$/.test(t)).map(t => readFileSync(resolve(dir, t), 'utf8'))
  const outline = existsSync(resolve(dir, 'reading/outline.md')) ? readFileSync(resolve(dir, 'reading/outline.md'), 'utf8') : ''
  job = { phase: 'copy', batches: planBatches(String(init.reading?.kind ?? ''), pages.map(t => t.split(/\s+/).filter(Boolean).length), outline, referencePages(pages)),
    index: -1, retried: false, checkRounds: 0, before: null, withRepo: Boolean(init.repo) }
}
const out = (j: Job, text: string): void => { save(j); console.log(text) }
if (job.phase === 'copy') {
  if (job.index >= 0) {
    const state = copyState(project())
    if (job.before && state.paragraphs + state.figures <= job.before.paragraphs + job.before.figures) {
      if (job.retried) { console.log(`PAUSED: ${job.batches[job.index]!.label} recorded nothing twice`); process.exit(0) }
      job.retried = true
      out(job, copyMessage(output, job.batches[job.index]!, job.index + 1, job.batches.length, job.before, true)); process.exit(0)
    }
  }
  job.index += 1; job.retried = false
  if (job.index < job.batches.length) {
    job.before = copyState(project())
    out(job, copyMessage(output, job.batches[job.index]!, job.index + 1, job.batches.length, job.before, false))
  } else { job.phase = 'argument'; out(job, argumentMessage(output, job.withRepo)) }
} else if (job.phase === 'argument') { job.phase = 'check'; out(job, checkMessage(output)) }
else if (job.phase === 'check') {
  const list = errors()
  if (list.length && job.checkRounds < 2) { job.checkRounds += 1; out(job, checkMessage(output, list)) }
  else { job.phase = 'done'; save(job); console.log(list.length ? `DONE with ${list.length} errors left` : 'DONE') }
} else console.log('DONE')
