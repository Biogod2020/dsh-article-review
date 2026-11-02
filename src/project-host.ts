/**
 * Project mode in DSH: one ProjectStore per project directory, model tools for the conversation's agent, and the
 * authenticated operator RPC the project panel uses. Agent work requested from the panel becomes a follow-up
 * message in the same conversation; its results land in the store through the tools below.
 */
import type { Context } from '@deepseek-ai/cordis'
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ProjectStore } from './project/store.ts'
import { ChangeSchema, CommentSchema, StageSchema, TargetSchema } from './project/model.ts'
import { agentTaskMessage } from './project/prompts.ts'
import { applyTool, commentTool, draftTool, linkTool, numberHintsTool, readTool } from './project/tools.ts'
import type { ProjectTask } from './project/prompts.ts'
import { argumentMessage, checkMessage, copyMessage, errorLines, copyState, planBatches, referencePages, prepareMessage } from './project/init-job.ts'
import type { Batch, CopyState, InitPhase } from './project/init-job.ts'

/** Model tools of project mode; available in every conversation, each names its project directory. */
export const PROJECT_TOOLS = ['project_read', 'project_apply', 'project_comment', 'project_draft', 'project_number_hints', 'project_link_paragraphs'] as const

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
const MAX_ASSET_BYTES = 8_000_000

const TaskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skeleton') }),
  z.object({ kind: z.literal('persona'), persona: z.enum(['editor', 'reviewer', 'audience']), focus: z.string().max(2000).default('') }),
  z.object({ kind: z.literal('refine'), comments: z.array(z.string()).min(1).max(20) }),
  z.object({ kind: z.literal('draft'), beat: z.string() }),
  z.object({ kind: z.literal('resync'), paragraphs: z.array(z.string()).min(1).max(40) }),
  z.object({ kind: z.literal('numbers') }),
])

/** Fields of the panel's initialisation form, as workspace-relative paths. */
const InitFormSchema = z.object({ source: z.string().max(1000).default(''), figures: z.string().max(1000).default(''), notes: z.string().max(1000).default(''),
  repo: z.string().max(1000).default(''), output: z.string().max(300).default('') })
type InitForm = z.infer<typeof InitFormSchema>
interface InitProblem { field: keyof InitForm, level: 'error' | 'warn', message: string }

/** Real location of a path that may not exist yet: the real path of its nearest existing ancestor, plus the rest. */
async function realTarget(path: string): Promise<string> {
  let head = path
  const tail: string[] = []
  for (;;) {
    try { return resolve(await realpath(head), ...tail.reverse()) } catch { /* not there yet: go up */ }
    const up = dirname(head)
    if (up === head) return path
    tail.push(head.slice(up.length).replace(/^[\\/]/, '')); head = up
  }
}

const within = (root: string, p: string): boolean => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }

/**
 * Checks the initialisation form before anything is handed to the agent, so the author sees a wrong path in the panel
 * instead of in a failed agent turn. Symlinks are followed: a path that resolves outside the workspace is refused.
 */
async function checkInit(root: string, form: InitForm): Promise<InitProblem[]> {
  const problems: InitProblem[] = []
  const kind = async (p: string): Promise<'file' | 'dir' | null> => { try { const s = await stat(p); return s.isDirectory() ? 'dir' : 'file' } catch { return null } }
  const real: Partial<Record<keyof InitForm, string>> = {}
  for (const field of ['source', 'figures', 'notes', 'repo', 'output'] as const) {
    if (!form[field].trim()) continue
    const p = await realTarget(resolve(root, form[field].trim()))
    if (!within(root, p)) { problems.push({ field, level: 'error', message: '不在当前工作区内' }); continue }
    real[field] = p
  }
  if (!form.source.trim()) problems.push({ field: 'source', level: 'error', message: '请填写稿件路径' })
  const want: Array<[keyof InitForm, 'file' | 'dir', string]> = [['source', 'file', '稿件'], ['figures', 'dir', '图文件夹'], ['notes', 'file', '意见文件'], ['repo', 'dir', '研究仓库']]
  for (const [field, expected, name] of want) {
    const p = real[field]
    if (!p) continue
    const k = await kind(p)
    if (!k) problems.push({ field, level: 'error', message: `找不到这个${name}` })
    else if (k !== expected) problems.push({ field, level: 'error', message: expected === 'dir' ? '这是文件，需要一个文件夹' : '这是文件夹，需要一个文件' })
  }
  const out = real.output
  if (form.output.trim() && out) {
    if (out === root) problems.push({ field: 'output', level: 'error', message: '不能直接用工作区根目录，请填一个新的子文件夹' })
    else if (await kind(out)) {
      const isProject = await kind(resolve(out, 'project.json')) === 'file'
      problems.push({ field: 'output', level: 'error', message: isProject ? '这里已经是一个项目，可在上方直接打开；要重新初始化请换一个文件夹名' : '这个文件夹已经存在；新项目需要一个还不存在的文件夹' })
    } else {
      for (const [field, name] of [['figures', '图文件夹'], ['notes', '意见文件'], ['source', '稿件']] as const) {
        const p = real[field]
        if (p && (within(p, out) || within(out, p))) problems.push({ field: 'output', level: 'warn', message: `和${name}的位置重叠；建议放到别处，免得新文件混进原始材料` })
      }
    }
  } else if (!form.output.trim()) problems.push({ field: 'output', level: 'error', message: '请填写新项目文件夹' })
  return problems
}

/** One level of a workspace directory for the panel's path browser; hidden entries are left out. */
async function browse(root: string, path: string): Promise<{ path: string, entries: Array<{ name: string, dir: boolean }> }> {
  const dir = await realTarget(resolve(root, path || '.'))
  if (!within(root, dir)) throw new Error(`${path} is outside the conversation workspace`)
  const entries = (await readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.'))
  const list = await Promise.all(entries.map(async e => ({ name: e.name, dir: e.isDirectory() || (e.isSymbolicLink() && await stat(resolve(dir, e.name)).then(s => s.isDirectory(), () => false)) })))
  list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
  return { path: relative(root, dir) || '.', entries: list.slice(0, 500) }
}

/**
 * Register project mode.
 * @param ctx - host plugin context (connection, tools, agents).
 * @param rootFor - the conversation's workspace root, shared with manuscript review.
 */
export function applyProject(ctx: Context, rootFor: (sessionId: SessionId) => Promise<string>): void {
  const stores = new Map<string, ProjectStore>()
  /** Session -> project directory last opened in the panel, the default for model tools. */
  const current = new Map<SessionId, string>()
  const launches = new Map<SessionId, string>()
  /** Initialisation jobs the panel drives, one per conversation: the next round is sent when the agent goes idle. */
  interface InitJob {
    sessionId: SessionId, root: string, output: string, withRepo: boolean, phase: InitPhase, batches: Batch[], index: number,
    retried: boolean, checkRounds: number, before: CopyState | null, sent: string, lastText: string, completed: boolean, paused: string, note: string,
  }
  const jobs = new Map<SessionId, InitJob>()
  // the job also lives in the project folder, so it can be resumed after DSH restarts
  const SAVED = ['output', 'withRepo', 'phase', 'batches', 'index', 'retried', 'checkRounds', 'before', 'lastText', 'note'] as const
  async function saveJob(job: InitJob): Promise<void> {
    const file = resolve(job.root, job.output, 'reading', 'job.json')
    try { await stat(dirname(file)) } catch { return }
    await writeFile(file, JSON.stringify(Object.fromEntries(SAVED.map(k => [k, job[k]])), null, 1))
  }
  async function loadJob(sessionId: SessionId, root: string, project: string): Promise<InitJob | null> {
    const saved = await readJson(resolve(root, project, 'reading', 'job.json'))
    if (!saved || saved.phase === 'done') return null
    return { ...saved, output: project, sessionId, root, sent: '', completed: false, paused: '初始化没有做完（DSH 重启过）', } as InitJob
  }
  const readJson = async (path: string): Promise<any> => { try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null } }
  function send(job: InitJob, text: string): void {
    const agent = ctx.agents.get(job.sessionId)
    if (!agent) { job.paused = '对话已关闭'; return }
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
    job.sent = message.id; job.lastText = text; job.completed = false
    agent.followup(message)
    void saveJob(job).catch(() => { /* resumable state is best effort */ })
  }
  /** One round finished: check what it produced and send the next one. */
  async function advance(job: InitJob): Promise<void> {
    const dir = resolve(job.root, job.output)
    if (job.phase === 'prepare') {
      const init = await readJson(resolve(dir, 'init.json'))
      if (!init) { job.phase = 'done'; job.note = '准备步骤没有完成，原因见对话'; return }
      const texts = Object.keys(init.reading?.text ?? {}).sort()
      const pages = await Promise.all(texts.filter(t => /\/p\d+\.txt$/.test(t)).map(t => readFile(resolve(dir, t), 'utf8').catch(() => '')))
      const outline = await readFile(resolve(dir, 'reading/outline.md'), 'utf8').catch(() => '')
      job.batches = planBatches(String(init.reading?.kind ?? ''), pages.map(t => t.split(/\s+/).filter(Boolean).length), outline, referencePages(pages))
      job.withRepo = Boolean(init.repo)
      job.phase = 'copy'; job.index = 0; job.retried = false
    } else if (job.phase === 'copy') {
      const state = copyState(await readJson(resolve(dir, 'project.json')) ?? {})
      const before = job.before
      if (before && state.paragraphs + state.figures <= before.paragraphs + before.figures) {
        if (job.retried) { job.paused = `${job.batches[job.index]!.label}没有抄进任何内容，初始化已暂停`; return }
        job.retried = true
        send(job, copyMessage(job.output, job.batches[job.index]!, job.index + 1, job.batches.length, before, true))
        return
      }
      job.index += 1; job.retried = false
      if (job.index >= job.batches.length) { job.phase = 'argument'; send(job, argumentMessage(job.output, job.withRepo)); return }
    } else if (job.phase === 'argument') {
      job.phase = 'check'; send(job, checkMessage(job.output)); return
    } else if (job.phase === 'check') {
      const findings = await readJson(resolve(dir, 'init-findings.json'))
      const list = errorLines(findings)
      const errors = Array.isArray(findings) ? list.length : 1
      // name each remaining error in the message: "the check still fails" alone gets reported back, not fixed
      if (errors && job.checkRounds < 2) {
        job.checkRounds += 1
        send(job, checkMessage(job.output, list))
        return
      }
      job.phase = 'done'; job.note = errors ? '检查仍有错误，见意见和初始化报告' : ''
      await saveJob(job)
      return
    } else return
    job.before = copyState(await readJson(resolve(dir, 'project.json')) ?? {})
    send(job, copyMessage(job.output, job.batches[job.index]!, job.index + 1, job.batches.length, job.before, false))
  }
  ctx.on('agent/turn-stopping', ({ agent }) => { const job = jobs.get(SessionId(agent.id)); if (job) job.completed = true })
  // a message the author types while the job runs takes over: pause, and let them resume from the panel
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    const job = jobs.get(SessionId(agent.id))
    // only a person's message: subagent reports and notices also arrive in the inbox
    if (job && job.phase !== 'done' && message.source?.kind === 'user' && message.id !== job.sent && !job.paused) job.paused = '你在对话里发了新消息，初始化已暂停'
  })
  ctx.on('agent/status', ({ agent, status }) => {
    const job = jobs.get(SessionId(agent.id))
    if (!job || status !== 'idle' || job.paused || job.phase === 'done') return
    if (!job.completed) { job.paused = '这一轮被中止，初始化已暂停'; return }
    advance(job).catch(error => { job.paused = `初始化出错：${error instanceof Error ? error.message : String(error)}` })
  })

  /** Resolve a workspace-relative project directory inside the workspace and return its store. */
  const storeAt = async (sessionId: SessionId, path: string | undefined): Promise<{ store: ProjectStore, path: string }> => {
    const root = await realpath(await rootFor(sessionId))
    const rel = path ?? current.get(sessionId)
    if (!rel) throw new Error('No project selected: pass the workspace-relative project directory (the folder holding project.json)')
    const dir = resolve(root, rel)
    if (relative(root, dir).startsWith('..')) throw new Error('The project must be inside the conversation workspace')
    await stat(resolve(dir, 'project.json')).catch(() => { throw new Error(`No project.json in ${JSON.stringify(rel)}`) })
    let store = stores.get(dir)
    if (!store) { store = new ProjectStore(dir); stores.set(dir, store) }
    return { store, path: relative(root, dir) || '.' }
  }
  const agentOf = (exec: { agent?: { id: SessionId } | undefined }): SessionId => {
    if (!exec.agent) throw new Error('A conversation is required')
    return exec.agent.id
  }
  const output = { schema: { type: 'json' }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] } as const
  const projectParam = { type: 'string', description: 'Workspace-relative project directory (holding project.json); omit for the project open in the panel.' } as const
  const actor = (exec: { agent?: { id: SessionId } | undefined }): string => `agent（对话 ${String(exec.agent?.id ?? '').replace(/^session-/, '').slice(0, 8)}）`

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_read',
    description: 'Read a paper project: thesis, beats and claims always; add figures, sections, comments, numbers, sync or materials with include. ids narrows claims and paragraphs (a claim id also selects the paragraphs stating it). numberMatches (projects initialised with a repository) lists the manuscript numbers with the repository files that contain them, to confirm as sources.',
    parameters: { project: projectParam, include: { type: 'array', items: { type: 'string' }, description: 'Any of figures, sections, comments, numbers, sync, materials, numberMatches.' },
      ids: { type: 'array', items: { type: 'string' }, description: 'Claim or paragraph ids to keep.' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return readTool(store, args)
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Read project' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_apply',
    description: 'Apply changes to the project (claims, evidence, beats, figures, numbers, sections). They are written at once, recorded with your reason and shown to the author as changed since review. Answer the comments you handled in responses. Do not use it to rewrite existing paragraphs: use project_draft. Exception: while initialising a project (paper-project-init) you write the sections and paragraphs you copy from the manuscript with upsert-section/upsert-paragraph, and may correct your own copy (same id).\n' +
      'Shapes: {op:"set-thesis",thesis:{title,statement}} | {op:"upsert-beat",beat:{id,title,summary,claims:[ids]}} | ' +
      '{op:"upsert-claim",claim:{id,title,statement,role:"core"|"support",reviewerQuestion,evidence:[{id,kind:"how"|"support"|"limit"|"gap",status:"sufficient"|"partial"|"missing"|"risk",text,source,panels:[{figure,label}],owner,due}]}} | ' +
      '{op:"upsert-figure",figure:{id,label,title,caption,placement:"main"|"extended"|"unplaced",panels:[{label,note}]}} | {op:"upsert-number",number:{id,label,value,source}} | ' +
      '{op:"upsert-section",section:{id,heading,beat,paragraphs:[]}} | {op:"upsert-paragraph",section,paragraph:{id,text,claims:[ids]}} | {op:"remove",unit,id} | {op:"ignore-number",value,where}. ' +
      'Rules: upserts replace the whole unit; each evidence item is one thing (the method is a "how" item, each result a "support" item, each caveat a "limit" item, each missing analysis a "gap" item); ' +
      'a registered number holds exactly one value as the text writes it (e.g. "0.794", "4,321", "71%") with its source; mark a claim "core" when the thesis fails without it.',
    parameters: { project: projectParam,
      changes: { type: 'array', required: true, items: { type: 'json' }, description: 'Change objects: set-thesis, upsert-beat, upsert-claim (whole claim), upsert-figure, upsert-number, upsert-section, upsert-paragraph (new paragraphs), remove, ignore-number.' },
      reason: { type: 'string', required: true, description: 'One sentence: why.' },
      responses: { type: 'array', items: { type: 'json' }, description: '[{comment, text}] — what this call changed for each comment.' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return applyTool(store, args, actor(exec))
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Update project' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_comment',
    description: 'Record comments on the project: review comments in the role you were asked to take (editor, reviewer or audience), or with source "check" a problem found while checking the project against its manuscript and repository - state the problem, then what the author should do.',
    parameters: { project: projectParam,
      comments: { type: 'array', required: true, items: { type: 'json' }, description: '[{source: editor|reviewer|audience|check, target: {kind, id, quote}, text}]' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return commentTool(store, args)
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Record review comments' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_draft',
    description: 'Propose rewrites of existing paragraphs. Nothing is replaced: the author sees each word diff and accepts or discards it.',
    parameters: { project: projectParam,
      drafts: { type: 'array', required: true, items: { type: 'json' }, description: '[{paragraph, text, reason, comments?}]' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return draftTool(store, args, actor(exec))
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Propose paragraph rewrites' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_link_paragraphs',
    description: 'Record which claims each existing paragraph states, without changing its text (used after initialising a project from a manuscript). Map every paragraph id to the claim ids it states; use [] for paragraphs that state none (methods detail, acknowledgements, references).',
    parameters: { project: projectParam, links: { type: 'json', required: true, description: '{"<paragraph id>": ["<claim id>", ...], ...}' },
      reason: { type: 'string', description: 'One sentence.' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return linkTool(store, args, actor(exec))
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Link paragraphs to claims' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'project_number_hints',
    description: 'Record your sort of unregistered numbers: key "<where>|<value>" from project_read numbers, kind result|parameter|citation|other, short note.',
    parameters: { project: projectParam, hints: { type: 'array', required: true, items: { type: 'json' }, description: '[{key, kind, note}]' } }, output,
    async execute(args, exec) {
      const { store } = await storeAt(agentOf(exec), args.project)
      return numberHintsTool(store, args)
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Sort numbers' }),
  })))

  // Operator RPC for the panel: the same envelope as manuscript review, under paper-project/*.
  const methods = ['paper-project/open', 'paper-project/view', 'paper-project/revision', 'paper-project/apply', 'paper-project/comment', 'paper-project/set-comment',
    'paper-project/confirm', 'paper-project/stage', 'paper-project/in-sync', 'paper-project/draft', 'paper-project/claim-at', 'paper-project/assign',
    'paper-project/ask', 'paper-project/asset'] as const
  const envelope = z.object({ type: z.literal('client-request'), rpcId: z.string(), method: z.enum(methods), payload: z.unknown() })

  // Initialise a project from an existing manuscript: check the form, browse the workspace for its paths, then hand the
  // paper-project-init skill to this conversation's agent. These need no open project, so they have their own route.
  const initMethods = ['paper-project/init', 'paper-project/check-init', 'paper-project/browse', 'paper-project/init-status', 'paper-project/init-control'] as const
  for (const method of initMethods) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const parsed = z.object({ type: z.literal('client-request'), rpcId: z.string(), method: z.literal(method), payload: z.unknown() })
        .safeParse(await request.json().catch(() => undefined))
      if (!parsed.success) return new Response('Invalid project request', { status: 400 })
      let result
      try {
        const sessionId = SessionId(z.object({ sessionId: z.string().min(1) }).parse(parsed.data.payload).sessionId)
        const root = await realpath(await rootFor(sessionId))
        if (method === 'paper-project/browse') {
          result = { ok: true, value: { workspace: root, ...await browse(root, z.object({ path: z.string().max(1000).default('') }).parse(parsed.data.payload).path) } }
        } else if (method === 'paper-project/init-status') {
          const { project } = z.object({ project: z.string().max(300).default('') }).parse(parsed.data.payload)
          const job = jobs.get(sessionId) ?? (project ? await loadJob(sessionId, root, project) : null)
          result = { ok: true, value: job ? { output: job.output, phase: job.phase, paused: job.paused, note: job.note, round: job.phase === 'copy' ? job.index + 1 : 0,
            rounds: job.batches.length, label: job.phase === 'copy' ? job.batches[job.index]?.label ?? '' : '' } : null }
        } else if (method === 'paper-project/init-control') {
          const { action } = z.object({ action: z.enum(['pause', 'resume', 'stop']) }).parse(parsed.data.payload)
          const { project } = z.object({ project: z.string().max(300).default('') }).parse(parsed.data.payload)
          let job = jobs.get(sessionId)
          if (!job && project) {
            const loaded = await loadJob(sessionId, root, project)
            if (loaded) { job = loaded; jobs.set(sessionId, loaded) }
          }
          if (!job) throw new Error('No initialisation is running in this conversation')
          if (action === 'stop') { jobs.delete(sessionId); job.phase = 'done'; job.note = '已停止'; await saveJob(job) }
          else if (action === 'pause') job.paused = '已暂停'
          else {
            if (ctx.agents.get(sessionId)?.status === 'running') throw new Error('Wait for the current response to finish, then resume')
            job.paused = ''
            // the interrupted round again, told where the copy stands now; what it recorded so far stays
            if (job.phase === 'copy' && job.batches[job.index]) {
              job.before = copyState(await readJson(resolve(root, job.output, 'project.json')) ?? {})
              send(job, copyMessage(job.output, job.batches[job.index]!, job.index + 1, job.batches.length, job.before, false))
            } else if (job.phase === 'check') {
              send(job, checkMessage(job.output, errorLines(await readJson(resolve(root, job.output, 'init-findings.json')))))
            } else send(job, job.lastText)
          }
          result = { ok: true, value: null }
        } else if (method === 'paper-project/check-init') {
          result = { ok: true, value: { workspace: root, problems: await checkInit(root, InitFormSchema.parse(parsed.data.payload)) } }
        } else {
          const input = InitFormSchema.extend({ source: z.string().min(1).max(1000), output: z.string().min(1).max(300), requestId: z.string().uuid() }).parse(parsed.data.payload)
          const errors = (await checkInit(root, input)).filter(p => p.level === 'error')
          if (errors.length) throw new Error(errors.map(e => `${e.field}: ${e.message}`).join('; '))
          if (launches.get(sessionId) === input.requestId) { result = { ok: true, value: null } } else {
            const agent = ctx.agents.get(sessionId)
            if (!agent || agent.status === 'running') throw new Error('Wait for the current response to finish, then try again')
            launches.set(sessionId, input.requestId)
            const lines = [`Workspace: ${JSON.stringify(root)}`, `Manuscript: ${JSON.stringify(input.source)}`,
              ...(input.figures ? [`Figures: ${JSON.stringify(input.figures)}`] : []), ...(input.notes ? [`Existing comments: ${JSON.stringify(input.notes)}`] : []),
              ...(input.repo ? [`Research repository (read only; use --repo): ${JSON.stringify(input.repo)}`] : []),
              `New project directory: ${JSON.stringify(input.output)}`, 'The original files are only read.']
            const prompt = prepareMessage(lines)
            const nativeSkill = ctx.get('skills') && ctx.tools.schemas(agent).some(tool => tool.name === 'skill')
            const skillPath = fileURLToPath(new URL('../skills/paper-project-init/', import.meta.url))
            const skill = (await readFile(new URL('../skills/paper-project-init/SKILL.md', import.meta.url), 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
            const text = nativeSkill ? `/paper-project-init\n${prompt}` : `${prompt}\n\n<skill_content name="paper-project-init">\nBase directory for this skill: ${skillPath}\n\n${skill}\n</skill_content>`
            const job: InitJob = { sessionId, root, output: relative(root, resolve(root, input.output)), withRepo: Boolean(input.repo), phase: 'prepare', batches: [], index: 0,
              retried: false, checkRounds: 0, before: null, sent: '', lastText: '', completed: false, paused: '', note: '' }
            jobs.set(sessionId, job)
            send(job, text)
            current.set(sessionId, relative(root, resolve(root, input.output)))
            result = { ok: true, value: null }
          }
        }
      } catch (error) {
        result = { ok: false, error: { code: 'paper-project/refused', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
    },
  }))
  for (const method of methods) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') return new Response('Expected application/json', { status: 415 })
      const parsed = envelope.safeParse(await request.json().catch(() => undefined))
      if (!parsed.success || parsed.data.method !== method) return new Response('Invalid project request', { status: 400 })
      let result
      try {
        request.signal.throwIfAborted()
        const base = z.object({ sessionId: z.string().min(1), project: z.string().min(1) }).parse(parsed.data.payload)
        const sessionId = SessionId(base.sessionId)
        const { store, path } = await storeAt(sessionId, base.project)
        const body = parsed.data.payload as Record<string, unknown>
        const author = '作者'
        let value: unknown
        switch (method) {
          case 'paper-project/open': current.set(sessionId, path); value = await store.view(); break
          case 'paper-project/view': value = await store.view(); break
          case 'paper-project/revision': value = await store.revision(z.number().int().min(0).parse(body.n)); break
          case 'paper-project/apply': value = await store.apply({ changes: z.array(ChangeSchema).parse(body.changes), actor: author, reason: z.string().min(1).parse(body.reason) }); break
          case 'paper-project/comment': value = (await store.addComment({ target: TargetSchema.parse(body.target), source: 'author', author, text: z.string().min(1).parse(body.text) })).view; break
          case 'paper-project/set-comment': value = await store.setComment(z.string().parse(body.id), CommentSchema.shape.status.parse(body.status)); break
          case 'paper-project/confirm': value = await store.confirm(z.array(z.string()).parse(body.keys)); break
          case 'paper-project/stage': value = await store.setStage(StageSchema.parse(body.stage), author, z.string().default('').parse(body.reason)); break
          case 'paper-project/in-sync': value = await store.markInSync(z.string().parse(body.paragraph), author); break
          case 'paper-project/draft': value = await store.decideDraft(z.string().parse(body.id), body.accept === true, author, typeof body.text === 'string' ? body.text : undefined); break
          case 'paper-project/claim-at': value = { claim: await store.claimAt(z.string().parse(body.claim), z.string().parse(body.hash)) }; break
          case 'paper-project/assign': value = await store.setAssignee(z.string().parse(body.id), z.string().default('').parse(body.assignee)); break
          case 'paper-project/asset': {
            // Panel images as data URLs, confined to the project directory.
            const file = resolve(store.root, z.string().parse(body.path))
            if (relative(store.root, file).startsWith('..')) throw new Error('The image must be inside the project')
            const type = IMAGE_TYPES[extname(file).toLowerCase()]
            if (!type) throw new Error('Unsupported image type')
            if ((await stat(file)).size > MAX_ASSET_BYTES) throw new Error('Image too large')
            value = { url: `data:${type};base64,${(await readFile(file)).toString('base64')}` }
            break
          }
          case 'paper-project/ask': {
            const input = z.object({ task: TaskSchema, requestId: z.string().uuid() }).parse(body)
            if (launches.get(sessionId) === input.requestId) { value = { summary: '已提交' }; break }
            const agent = ctx.agents.get(sessionId)
            if (!agent || agent.status === 'running') throw new Error('Wait for the current response to finish, then ask again')
            launches.set(sessionId, input.requestId)
            current.set(sessionId, path)
            const { project } = await store.load()
            agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: agentTaskMessage(input.task as ProjectTask, path, project.style) }] }))
            value = { summary: '已交给当前对话中的 agent；完成后面板会自动刷新' }
            break
          }
        }
        result = { ok: true, value }
      } catch (error) {
        result = { ok: false, error: { code: 'paper-project/refused', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
    },
  }))
}
