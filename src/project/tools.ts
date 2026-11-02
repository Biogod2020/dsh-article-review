/**
 * The model-facing project tools, independent of DSH: each takes the project's store, the tool arguments and the
 * actor name, and returns the JSON the model reads. The DSH host registers them as tools; tests and other harnesses
 * (a command-line bridge for other agents) call the same functions, so every model sees the same validation,
 * warnings and next steps.
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { ProjectStore, ProjectView } from './store.ts'
import { ChangeSchema, CommentSchema, TargetSchema } from './model.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>
/** What a tool returns to the model: plain JSON (DSH's JsonValue has the same shape). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** The parts of a project view a model asks for; the whole view of a real paper is too large for one tool result. */
export function modelView(v: ProjectView, include: string[], ids: string[]): object {
  const want = (k: string): boolean => include.includes(k)
  const p = v.project
  const pick = <T extends { id: string }>(xs: T[]): T[] => ids.length ? xs.filter(x => ids.includes(x.id)) : xs
  return {
    title: p.title, journal: p.journal, audience: p.audience, stage: p.stage, thesis: p.thesis, revision: v.revision,
    beats: p.beats,
    claims: pick(p.claims),
    ...(want('figures') ? { figures: p.figures.map(f => ({ id: f.id, label: f.label, title: f.title, placement: f.placement, caption: f.caption.slice(0, 1500),
      panels: f.panels.map(x => ({ label: x.label, note: x.note, spare: x.spare })) })) } : {}),
    ...(want('sections') ? { sections: p.sections.map(s => ({ id: s.id, heading: s.heading, beat: s.beat,
      paragraphs: s.paragraphs.filter(x => !ids.length || ids.includes(x.id) || x.claims.some(c => ids.includes(c))).map(x => ({ id: x.id, claims: x.claims, text: x.text })) })) } : {}),
    ...(want('comments') ? { comments: v.comments.filter(c => c.status === 'open' || c.status === 'answered').map(c => ({ id: c.id, source: c.source, author: c.author,
      target: c.target, text: c.text, status: c.status })) } : {}),
    ...(want('numbers') ? { registry: p.numbers, unregistered: v.numbers } : {}),
    ...(want('sync') ? { sync: v.sync, drafts: v.drafts.filter(d => d.status === 'pending').map(d => ({ id: d.id, paragraph: d.paragraph })) } : {}),
    ...(want('materials') ? { materials: p.materials } : {}),
  }
}

/** Repository the project was initialised from (init.json), with the result files its scan found. */
interface RepoInfo { root: string, candidates: string[], manuscripts: string[] }
async function repoInfo(projectRoot: string): Promise<RepoInfo | null> {
  try {
    const init = JSON.parse(await readFile(resolve(projectRoot, 'init.json'), 'utf8')) as { repo?: { path?: string } | null, inputs?: Record<string, string> }
    if (!init.repo?.path) return null
    const ctx = JSON.parse(await readFile(resolve(projectRoot, 'repo', 'repo-context.json'), 'utf8')) as { resultTables?: { path: string }[], docs?: { path: string, kind: string }[] }
    // the manuscript itself is not a repository source of results: citing it would only silence the check
    const manuscripts = Object.keys(init.inputs ?? {}).filter(k => /\.(tex|md|docx|pdf|txt|html?)$/i.test(k))
    return { root: init.repo.path, manuscripts, candidates: [...(ctx.resultTables ?? []).map(t => t.path), ...(ctx.docs ?? []).filter(d => d.kind === 'plan').map(d => d.path)].slice(0, 12) }
  } catch {
    return null
  }
}

/** Pre-computed matches of manuscript numbers in repository files (match_numbers.py), compacted for the model. */
async function numberMatches(projectRoot: string): Promise<unknown> {
  try {
    const m = JSON.parse(await readFile(resolve(projectRoot, 'repo', 'number-matches.json'), 'utf8')) as
      { matched: { value: string, paragraphs: string[], quote: string, candidates: { file: string, kind: string, context: string }[] }[], notFound: { value: string }[] }
    return { matched: m.matched.map(x => ({ value: x.value, paragraphs: x.paragraphs.slice(0, 4), quote: x.quote, candidates: x.candidates.slice(0, 3) })),
      notFoundInRepository: m.notFound.map(x => x.value) }
  } catch {
    return 'No number-matches.json: the project was not initialised with a repository.'
  }
}

/**
 * Evidence and numbers whose source names no file in the repository. A tool-result warning is what makes agents
 * cite the repository (the skill text alone did not: 1 of 22 numbers and no evidence in a live run).
 */
async function uncitedRepoSources(projectRoot: string, p: ProjectView['project']): Promise<string | null> {
  const repo = await repoInfo(projectRoot)
  if (!repo) return null
  const exists = async (src: string): Promise<boolean> => {
    for (const cand of src.match(/[\w./-]+\.(?:json|csv|tsv|md|txt|tex|py|r|R|ipynb|xlsx?)/g) ?? []) {
      // relative to the repository, or to the workspace that contains it (lab-repo/results/x.json)
      for (const full of [resolve(repo.root, cand), resolve(repo.root, '..', cand)]) {
        if (repo.manuscripts.includes(full)) continue
        try { if ((await stat(full)).isFile()) return true } catch { /* not this one */ }
      }
    }
    return false
  }
  const ev = p.claims.flatMap(c => c.evidence.filter(e => e.kind === 'support').map(e => ({ c: c.id, e })))
  let evMissing = 0
  for (const { e } of ev) if (!await exists(e.source)) evMissing += 1
  let numMissing = 0
  for (const n of p.numbers) if (!await exists(n.source)) numMissing += 1
  if (!evMissing && !numMissing) return null
  // name the matching files for the uncited numbers when the pre-match found them
  let hint = ''
  try {
    const m = JSON.parse(await readFile(resolve(projectRoot, 'repo', 'number-matches.json'), 'utf8')) as { matched: { value: string, candidates: { file: string }[] }[] }
    const byValue = new Map(m.matched.map(x => [x.value.replace(/,/g, ''), x.candidates[0]?.file]))
    const pairs: string[] = []
    for (const n of p.numbers) if (!await exists(n.source)) { const f = byValue.get(n.value.replace(/,/g, '')); if (f) pairs.push(`${n.value} → ${f}`) }
    if (pairs.length) hint = ` Matches found by the pre-match (confirm before using): ${pairs.slice(0, 15).join('; ')}.`
  } catch { /* no pre-match */ }
  return `${evMissing} of ${ev.length} support evidence items and ${numMissing} of ${p.numbers.length} registered numbers do not cite a repository file.${hint} ` +
    'Where the result lives in the repository, set source to that file path relative to the repository (e.g. results/coverage.json), so the check can verify the value there; ' +
    `keep the manuscript section only when no repository file holds it. Result files and plans found: ${repo.candidates.join(', ') || 'none'}.`
}


export async function readTool(store: ProjectStore, args: Args): Promise<Json> {
  // a plain JSON copy: tool results must be JSON values
  const view = modelView(await store.view(), args.include ?? [], args.ids ?? []) as Record<string, unknown>
  if ((args.include ?? []).includes('numberMatches')) view.numberMatches = await numberMatches(store.root)
  return JSON.parse(JSON.stringify(view))
}

export async function applyTool(store: ProjectStore, args: Args, actor: string): Promise<Json> {
  // Validate each change on its own: valid ones are written, invalid ones come back with a short reason, so one bad
  // field does not discard a whole skeleton (seen in a live run, where the agent then resent only part of it).
  const raw = Array.isArray(args.changes) ? args.changes : []
  const rejected: { index: number, op: string, id: string, error: string }[] = []
  const changes = raw.flatMap((c, index) => {
    const r = ChangeSchema.safeParse(c)
    if (r.success) return [r.data]
    const o = (c ?? {}) as Record<string, Record<string, unknown> | string>
    const unit = Object.values(o).find(x => typeof x === 'object' && x !== null && 'id' in x) as { id?: unknown } | undefined
    rejected.push({ index, op: String(o.op ?? '?'), id: String(unit?.id ?? ''), error: r.error.issues.slice(0, 4).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
    return []
  })
  if (!changes.length) return { written: 0, rejected, nextStep: 'Nothing was written. Fix the rejected changes and send them again.' }
  const v = await store.apply({ changes, actor: actor, reason: String(args.reason),
    responses: z.array(z.object({ comment: z.string(), text: z.string().max(4000) })).default([]).parse(args.responses) })
  const h = v.history.at(-1)!
  // Quality checks on what this call wrote: the tool result is where an agent reliably reads corrections.
  const warnings: string[] = []
  const touched = new Set(h.units.filter(u => u.startsWith('claim:')).map(u => u.slice(6)))
  const multi = changes.flatMap(c => c.op === 'upsert-number' && (c.number.value.match(/\d[\d,.]*/g) ?? []).length > 1 && !/^[\d,.]+%?\s*[–-]\s*[\d,.]+%?$/.test(c.number.value.trim()) ? [c.number.id] : [])
  if (multi.length) warnings.push(`Numbers ${multi.join(', ')} hold several values; register one value per entry so prose can be checked against it.`)
  const thin = v.project.claims.filter(c => touched.has(c.id) && c.evidence.filter(e => e.kind === 'support').length < 2)
  if (thin.length) warnings.push(`Claims ${thin.map(c => c.id).join(', ')} have fewer than two support items; give each result the claim rests on its own support item (with its panel), and keep method (how), caveats (limit) and missing analyses (gap) separate.`)
  const loose = v.numbers.filter(n => !n.where.startsWith('paragraph:') && touched.has(n.where.replace(/^claim:/, '')))
  if (loose.length) warnings.push(`${loose.length} numbers in these claims and their evidence are not registered (e.g. ${[...new Set(loose.map(n => n.value))].slice(0, 8).join(', ')}); register each with its source.`)
  if (v.project.claims.length >= 3 && !v.project.claims.some(c => c.role === 'core')) warnings.push('No claim is marked core; mark the claims the thesis cannot stand without.')
  const uncited = await uncitedRepoSources(store.root, v.project)
  if (uncited) warnings.push(uncited)
  // Paragraphs this call made stale: the tool result tells the agent to follow through, which a prompt alone did not.
  const changedClaims = new Set(h.units.filter(u => u.startsWith('claim:')).map(u => u.slice(6)))
  const stale = [...new Set(v.sync.filter(s => s.kind === 'claim-changed' && changedClaims.has(s.claim)).map(s => s.paragraph))]
    .filter(id => !v.drafts.some(d => d.paragraph === id && d.status === 'pending'))
  return { revision: v.revision, changed: h.units, answered: h.comments, outOfSync: stale,
    ...(warnings.length ? { warnings } : {}),
    ...(rejected.length ? { rejected, fix: `${rejected.length} changes were rejected and not written; the others were. Fix and resend only the rejected ones.` } : {}),
    ...(stale.length ? { nextStep: `These ${stale.length} paragraphs still state the old claims: ${stale.join(', ')}. Before finishing, read them (project_read include sections, ids) and call project_draft with minimal rewrites that state the current claims, comments: ${JSON.stringify(h.comments)}.` } : {}) }
}

export async function commentTool(store: ProjectStore, args: Args): Promise<Json> {
  const list = z.array(z.object({ source: z.enum(['editor', 'reviewer', 'audience', 'check']), target: TargetSchema, text: CommentSchema.shape.text })).max(30).parse(args.comments)
  const names = { editor: '期刊编辑', reviewer: '领域审稿人', audience: '目标读者', check: '初始化检查' } as const
  // the same finding recorded twice (an agent re-running its last step) is kept once
  const existing = new Set((await store.view()).comments.map(c => `${c.source}|${c.target.kind}|${c.target.id}|${c.text.slice(0, 80)}`))
  let recorded = 0
  for (const c of list) {
    const key = `${c.source}|${c.target.kind}|${c.target.id}|${c.text.slice(0, 80)}`
    if (existing.has(key)) continue
    existing.add(key)
    await store.addComment({ target: c.target, source: c.source, author: `${names[c.source]}（agent）`, text: c.text })
    recorded += 1
  }
  return { recorded, skippedDuplicates: list.length - recorded }
}

export async function draftTool(store: ProjectStore, args: Args, actor: string): Promise<Json> {
  const list = z.array(z.object({ paragraph: z.string(), text: z.string().min(1).max(20_000), reason: z.string().max(2000), comments: z.array(z.string()).default([]) })).max(40).parse(args.drafts)
  const v = await store.view()
  const drafts = list.map(d => {
    const s = v.project.sections.find(x => x.paragraphs.some(p => p.id === d.paragraph))
    if (!s) throw new Error(`unknown paragraph ${d.paragraph}`)
    const para = s.paragraphs.find(p => p.id === d.paragraph)!
    return { section: s.id, paragraph: para.id, before: para.text, after: d.text, claims: para.claims, reason: d.reason, actor: actor, comments: d.comments }
  })
  await store.addDrafts(drafts)
  return { proposed: drafts.length }
}

export async function linkTool(store: ProjectStore, args: Args, actor: string): Promise<Json> {
  const links = z.record(z.string(), z.array(z.string())).parse(args.links)
  const r = await store.linkParagraphs(links, actor, String(args.reason ?? '把段落对应到分论点'))
  const paras = r.view.project.sections.flatMap(s => s.paragraphs)
  const stated = new Set(paras.flatMap(x => x.claims))
  // Coverage warnings: an argument reconstructed too coarsely shows up here, when the whole text has been linked.
  const pj = r.view.project, warnings: string[] = []
  const linked = paras.filter(x => x.claims.length)
  const emptyBeats = pj.beats.filter(b => !b.claims.length).map(b => b.id)
  if (emptyBeats.length) warnings.push(`Beats ${emptyBeats.join(', ')} have no claim; every beat needs at least one.`)
  if (pj.claims.length && linked.length / pj.claims.length > 6) warnings.push(`${linked.length} paragraphs state only ${pj.claims.length} claims; findings were probably merged. Split claims to the grain of a results subsection or figure.`)
  if (pj.claims.length >= 3 && pj.claims.every(c => c.role === 'core')) warnings.push('Every claim is core; keep core for the claims the thesis cannot stand without.')
  const resultNumbers = r.view.numbers.filter(n => n.where.startsWith('paragraph:') && linked.some(x => `paragraph:${x.id}` === n.where))
  if (resultNumbers.length > pj.numbers.length) warnings.push(`${resultNumbers.length} numbers in paragraphs that state claims are not registered (e.g. ${resultNumbers.slice(0, 8).map(n => n.value).join(', ')}); register the findings among them (one value per entry) with project_apply.`)
  const uncited = await uncitedRepoSources(store.root, pj)
  if (uncited) warnings.push(uncited)
  return { linked: Object.keys(links).length - r.unknownParagraphs.length, unknownParagraphs: r.unknownParagraphs, unknownClaims: r.unknownClaims,
    paragraphsWithoutClaims: paras.filter(x => !x.claims.length).length, claimsStatedByNoParagraph: pj.claims.filter(c => !stated.has(c.id)).map(c => c.id),
    ...(warnings.length ? { warnings } : {}) }
}

export async function numberHintsTool(store: ProjectStore, args: Args): Promise<Json> {
  const list = z.array(z.object({ key: z.string(), kind: z.enum(['result', 'parameter', 'citation', 'other']), note: z.string().max(400).default('') })).parse(args.hints)
  await store.setNumberHints(Object.fromEntries(list.map(h => [h.key, { kind: h.kind, note: h.note }])))
  return { recorded: list.length }
}
