/**
 * Local host for the project-mode demo: serves the built workbench and a JSON API over ProjectStore, and runs
 * agent tasks with an OpenAI-compatible model. In DSH the same tasks go to the conversation's agent instead.
 *
 * Usage: MODEL_URL=… MODEL_KEY=… MODEL=… tsx demo/server.ts --root <project dir> [--port 8790]
 * Listens on 127.0.0.1 only. Collaborators (X-Demo-Role: collaborator) may only comment.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectStore } from '../src/project/store.ts'
import type { Comment, Project, Target } from '../src/project/model.ts'
import { draftPrompt, numberTriagePrompt, personaReviewPrompt, PERSONAS, refinePrompt, resyncPrompt, skeletonPrompt } from '../src/project/prompts.ts'
import type { Persona } from '../src/project/prompts.ts'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
const ROOT = resolve(args.get('root') ?? '.')
const PORT = Number(args.get('port') ?? 8790)
const DIST = fileURLToPath(new URL('./dist/', import.meta.url))
const MODEL_URL = process.env.MODEL_URL ?? 'http://127.0.0.1:8317/v1/chat/completions'
const MODEL = process.env.MODEL ?? 'gemini-3.8-flash-high'
const store = new ProjectStore(ROOT)
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.pdf': 'application/pdf' }

/**
 * Ask the model for changes and apply them; if the store rejects them (schema or reference errors), show the
 * model the error once and apply its corrected answer, as an agent in DSH would after a failed tool call.
 */
async function modelApply(prompt: string, apply: (out: Record<string, unknown>) => Promise<string>): Promise<string> {
  const out = await model(prompt)
  try { return await apply(out) } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(new Date().toISOString(), 'retrying after rejected changes:', msg.slice(0, 300))
    return apply(await model(`${prompt}\n\nYour previous answer was rejected by the project store:\n${msg.slice(0, 4000)}\n` +
      `Previous answer:\n${JSON.stringify(out).slice(0, 30000)}\nReturn the corrected complete JSON.`))
  }
}

/** One model call that must return JSON; code fences are tolerated and an unparsable answer is asked for again once. */
async function model(prompt: string, retry = true): Promise<Record<string, unknown>> {
  const r = await fetch(MODEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_KEY ?? ''}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(600_000) })
  if (!r.ok) throw new Error(`model HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const body = await r.json() as { choices: { message: { content: string } }[] }
  const text = body.choices[0]?.message.content ?? ''
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try { return JSON.parse(json) as Record<string, unknown> } catch (err) {
    if (!retry) throw new Error(`model did not return JSON: ${text.slice(0, 200)}`)
    console.warn(new Date().toISOString(), 'unparsable model answer, asking again:', String(err).slice(0, 120))
    return model(`${prompt}\n\nReturn only one valid JSON object, with every quote inside strings escaped, and nothing else.`, false)
  }
}

const shortId = (prefix: string): string => `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`

/** Text of the registered materials (text files only, bounded), for the skeleton task. */
async function materialsText(p: Project): Promise<string> {
  const parts: string[] = []
  for (const m of p.materials) {
    let body = m.note
    if (m.path && /\.(md|txt|json|csv|tex)$/i.test(m.path)) {
      try { body += '\n' + (await readFile(join(ROOT, m.path), 'utf8')).slice(0, 30_000) } catch { body += '\n(file not readable)' }
    }
    parts.push(`## ${m.label}\n${body}`)
  }
  return parts.join('\n\n').slice(0, 150_000)
}

type Task = { kind: 'skeleton' } | { kind: 'persona', persona: Persona, focus: string } | { kind: 'refine', comments: string[] }
  | { kind: 'draft', beat: string } | { kind: 'resync', paragraphs: string[] } | { kind: 'chat', text: string, target: Target } | { kind: 'numbers' }

/** Rewrite drafts for paragraphs (never applied directly: the author accepts each with its diff). */
async function draftRewrites(ids: string[], actor: string, reason: string, comments: string[]): Promise<number> {
  const { project } = await store.load()
  const all = project.sections.flatMap(s => s.paragraphs.map(x => ({ s, x }))).filter(({ x }) => ids.includes(x.id))
  if (!all.length) return 0
  const out = await model(resyncPrompt(project, all.map(({ x }) => ({ id: x.id, text: x.text, claims: x.claims }))))
  const drafts = ((out.paragraphs as { id: string, text: string }[]) ?? []).flatMap(n => {
    const hit = all.find(a => a.x.id === n.id)
    return hit && n.text && n.text !== hit.x.text ? [{ section: hit.s.id, paragraph: hit.x.id, before: hit.x.text, after: n.text, claims: hit.x.claims, reason, actor, comments }] : []
  })
  if (drafts.length) await store.addDrafts(drafts)
  return drafts.length
}

async function runTask(task: Task, user: string): Promise<{ summary: string }> {
  const { project, state } = await store.load()
  const actor = `agent（${MODEL}，${user} 请求）`
  if (task.kind === 'persona') {
    const out = await model(personaReviewPrompt(project, task.persona, task.focus, state.comments))
    const list = (out.comments as { target: Target, text: string, severity?: string }[] | undefined) ?? []
    for (const c of list) {
      await store.addComment({ target: { kind: c.target?.kind ?? 'project', id: c.target?.id ?? '', quote: c.target?.quote ?? '' },
        source: task.persona, author: `${PERSONAS[task.persona].name}（${MODEL}）`, text: `${c.severity === 'major' ? '【主要】' : ''}${c.text}` })
    }
    return { summary: `${PERSONAS[task.persona].name}提出 ${list.length} 条意见` }
  }
  if (task.kind === 'refine') {
    const comments = state.comments.filter((c: Comment) => task.comments.includes(c.id))
    const summary = await modelApply(refinePrompt(project, comments), async out => {
      const v = await store.apply({ changes: (out.changes as unknown[]) ?? [], actor, reason: String(out.reason ?? '处理意见'),
        responses: (out.responses as { comment: string, text: string }[]) ?? [] })
      return `修改 ${v.history.at(-1)?.units.length ?? 0} 处，回应 ${v.history.at(-1)?.comments.length ?? 0} 条意见`
    })
    // follow through: paragraphs the changed claims made stale get rewrite drafts, linked to the same comments
    const after = await store.view()
    const changedClaims = new Set((after.history.at(-1)?.units ?? []).filter(u => u.startsWith('claim:')).map(u => u.slice(6)))
    const stale = [...new Set(after.sync.filter(x => x.kind === 'claim-changed' && changedClaims.has(x.claim)).map(x => x.paragraph))]
    if (!stale.length) return { summary }
    const n = await draftRewrites(stale, actor, `跟进意见：${comments.map(c => c.text.slice(0, 30)).join('；')}`, task.comments)
    return { summary: `${summary}；起草 ${n} 段正文改写，待你确认` }
  }
  if (task.kind === 'skeleton') {
    const summary = await modelApply(skeletonPrompt(project, await materialsText(project)), async out => {
      const v = await store.apply({ changes: (out.changes as unknown[]) ?? [], actor, reason: String(out.reason ?? '起草故事流') })
      return `骨架：${v.project.beats.length} 拍、${v.project.claims.length} 个分论点`
    })
    return { summary }
  }
  if (task.kind === 'draft') {
    const beatIndex = project.beats.findIndex(b => b.id === task.beat)
    if (beatIndex < 0) throw new Error('unknown beat')
    const sid = `s-${task.beat}`
    const prevSec = project.sections.at(-1)
    const out = await model(draftPrompt(project, { id: sid, heading: '', beat: task.beat, paragraphs: [] }, prevSec?.paragraphs.at(-1)?.text ?? ''))
    const paras = ((out.paragraphs as { text: string, claims: string[] }[]) ?? []).map(x => ({ id: shortId('p'), text: x.text, claims: x.claims ?? [], basis: {} }))
    const index = project.sections.filter(s => project.beats.findIndex(b => b.id === s.beat) < beatIndex).length
    await store.apply({ changes: [{ op: 'upsert-section', section: { id: sid, heading: String(out.heading ?? project.beats[beatIndex]!.title), beat: task.beat, paragraphs: [] }, index },
      ...paras.map(paragraph => ({ op: 'upsert-paragraph', section: sid, paragraph }))], actor, reason: `按骨架写第 ${beatIndex + 1} 拍` })
    return { summary: `写了 ${paras.length} 段` }
  }
  if (task.kind === 'resync') {
    const n = await draftRewrites(task.paragraphs, actor, '按更新后的论点重写', [])
    return { summary: `起草 ${n} 段改写，待你确认` }
  }
  if (task.kind === 'numbers') {
    const v = await store.view()
    const items = v.numbers.filter(n => !v.numberHints[`${n.where}|${n.value}`]).map(n => ({ key: `${n.where}|${n.value}`, value: n.value, quote: n.quote }))
    const hints: Record<string, { kind: 'result' | 'parameter' | 'citation' | 'other', note: string }> = {}
    for (let i = 0; i < items.length; i += 40) {
      const out = await model(numberTriagePrompt(project, items.slice(i, i + 40)))
      for (const h of (out.items as { key: string, kind: string, note: string }[]) ?? []) {
        if (['result', 'parameter', 'citation', 'other'].includes(h.kind)) hints[h.key] = { kind: h.kind as 'result', note: String(h.note ?? '').slice(0, 400) }
      }
    }
    await store.setNumberHints(hints)
    const n = (k: string): number => Object.values(hints).filter(h => h.kind === k).length
    return { summary: `分类 ${Object.keys(hints).length} 个数字：结果 ${n('result')}、参数 ${n('parameter')}、引用编号 ${n('citation')}、其他 ${n('other')}` }
  }
  throw new Error(`unsupported task ${task.kind}`)
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) { n += (c as Buffer).length; if (n > 4_000_000) throw new Error('body too large'); chunks.push(c as Buffer) }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
}

function send(res: ServerResponse, code: number, value: unknown, type = 'application/json; charset=utf-8'): void {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
  res.end(buf)
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname.replace(/^.*?\/(api\/|asset$)/, '/$1')
  const user = decodeURIComponent(String(req.headers['x-demo-user'] ?? 'author'))
  const author = req.headers['x-demo-role'] !== 'collaborator'
  try {
    if (path === '/api/view') return send(res, 200, await store.view())
    if (path === '/api/revision') return send(res, 200, await store.revision(Number(url.searchParams.get('n'))))
    if (path === '/api/claim-at') return send(res, 200, { claim: await store.claimAt(url.searchParams.get('claim') ?? '', url.searchParams.get('hash') ?? '') })
    if (path === '/asset') {
      const file = resolve(ROOT, url.searchParams.get('path') ?? '')
      if (relative(ROOT, file).startsWith('..')) return send(res, 403, { error: 'outside project' })
      return send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
    }
    if (path.startsWith('/api/') && req.method === 'POST') {
      const b = await body(req)
      const op = path.slice(5)
      if (op === 'comment') return send(res, 200, (await store.addComment({ target: b.target as Target, source: author ? 'author' : 'collaborator', author: user, text: String(b.text) })).view)
      if (!author) return send(res, 403, { error: 'collaborators can only comment' })
      if (op === 'apply') return send(res, 200, await store.apply({ changes: b.changes as unknown[], actor: user, reason: String(b.reason ?? '') }))
      if (op === 'set-comment') return send(res, 200, await store.setComment(String(b.id), b.status as Comment['status']))
      if (op === 'confirm') return send(res, 200, await store.confirm(b.keys as string[]))
      if (op === 'stage') return send(res, 200, await store.setStage(b.stage as Project['stage'], user, String(b.reason ?? '')))
      if (op === 'assign') return send(res, 200, await store.setAssignee(String(b.id), String(b.assignee ?? '')))
      if (op === 'in-sync') return send(res, 200, await store.markInSync(String(b.paragraph), user))
      if (op === 'draft') return send(res, 200, await store.decideDraft(String(b.id), b.accept === true, user, typeof b.text === 'string' ? b.text : undefined))
      if (op === 'ask') {
        const r = await runTask(b.task as Task, user)
        return send(res, 200, { ...r, view: await store.view() })
      }
    }
    if (req.method === 'GET') {
      const rel = path === '/' ? 'index.html' : path.slice(1)
      const file = resolve(DIST, rel)
      if (!relative(DIST, file).startsWith('..') && (await stat(file).catch(() => null))?.isFile()) return send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
    }
    send(res, 404, { error: 'not found' })
  } catch (err) {
    console.error(new Date().toISOString(), path, err)
    send(res, 400, { error: err instanceof Error ? err.message : String(err) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`project demo on http://127.0.0.1:${PORT}/  root=${ROOT}  model=${MODEL}`))
