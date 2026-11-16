/**
 * File-backed project store. The project lives in <root>/project.json (readable, diffable, the author's file);
 * review state (comments, reviewed hashes, history) lives in <root>/.review/state.json with one snapshot per
 * revision. Writes are atomic and serialized; the store is the only writer of both files.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Change, Claim, Comment, Draft, Project, Reviewer, ReviewState, Stage, Target } from './model.ts'
import { ChangeSchema, CommentSchema, DraftSchema, ProjectSchema, ReviewerSchema, ReviewStateSchema, STAGES, StageSchema } from './model.ts'
import type { CheckItem, NumberIssue, ReviewStatus, SyncIssue, Unit } from './units.ts'
import { applyChanges, changedUnits, claimHash, frameHash, frameStatus, resyncBasis, reviewStatus, stageChecklist, syncIssues, units, unregisteredNumbers } from './units.ts'
import type { FlowStatus } from './flow.ts'
import { flowStatus } from './flow.ts'

/** What the client renders: the project plus everything derived from it. */
export interface ProjectView {
  project: Project
  revision: number
  comments: Comment[]
  history: ReviewState['history']
  status: Record<string, ReviewStatus>
  /** unit key -> revision at which the author last confirmed it (for "changed since my review" diffs) */
  reviewed: Record<string, number>
  units: Unit[]
  sync: SyncIssue[]
  numbers: NumberIssue[]
  checklist: CheckItem[]
  /** Paragraph rewrites: pending ones wait for the author; a pending draft whose paragraph changed meanwhile is stale. */
  drafts: Draft[]
  numberHints: ReviewState['numberHints']
  /** Where the recommended workflow stands and the one next step. */
  flow: FlowStatus
  /** Role-play reviewers and their rounds; their comments are in comments with source "reviewer". */
  reviewers: Reviewer[]
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 1))
  await rename(tmp, path)
}

const now = (): string => new Date().toISOString()

function paragraphText(p: Project, id: string): string | undefined {
  for (const s of p.sections) for (const x of s.paragraphs) if (x.id === id) return x.text
  return undefined
}

export class ProjectStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly root: string) {}

  private get projectPath(): string { return join(this.root, 'project.json') }
  private get statePath(): string { return join(this.root, '.review', 'state.json') }

  /** Run one operation at a time so read-modify-write never interleaves. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  async load(): Promise<{ project: Project, state: ReviewState }> {
    const project = ProjectSchema.parse(JSON.parse(await readFile(this.projectPath, 'utf8')))
    let state: ReviewState
    try { state = ReviewStateSchema.parse(JSON.parse(await readFile(this.statePath, 'utf8'))) } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      state = ReviewStateSchema.parse({})
    }
    return { project, state }
  }

  /** Create a project; refuses to overwrite an existing one. */
  async create(project: Project): Promise<ProjectView> {
    return this.serial(async () => {
      await mkdir(join(this.root, '.review', 'history'), { recursive: true })
      try { await readFile(this.projectPath); throw new Error('project already exists') } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      const p = ProjectSchema.parse(project)
      const state = ReviewStateSchema.parse({ history: [{ revision: 0, at: now(), actor: 'system', reason: '创建项目', comments: [], units: [] }] })
      await writeAtomic(join(this.root, '.review', 'history', 'r0.json'), p)
      await writeAtomic(this.projectPath, p)
      await writeAtomic(this.statePath, state)
      return this.derive(p, state)
    })
  }

  derive(project: Project, state: ReviewState): ProjectView {
    return {
      project, revision: state.revision, comments: state.comments, history: state.history,
      status: reviewStatus(project, state), units: units(project),
      reviewed: Object.fromEntries(Object.entries(state.reviewed).map(([k, v]) => [k, v.revision])), sync: syncIssues(project),
      numbers: unregisteredNumbers(project), checklist: stageChecklist(project, state),
      numberHints: state.numberHints, flow: flowStatus(project, state),
      reviewers: state.reviewers,
      drafts: state.drafts.map(d => d.status === 'pending' && paragraphText(project, d.paragraph) !== d.before ? { ...d, status: 'stale' as const } : d),
    }
  }

  async view(): Promise<ProjectView> {
    const { project, state } = await this.load()
    return this.derive(project, state)
  }

  /** A past revision of the project, for comparisons. */
  async revision(n: number): Promise<Project> {
    return ProjectSchema.parse(JSON.parse(await readFile(join(this.root, '.review', 'history', `r${n}.json`), 'utf8')))
  }

  /**
   * Apply changes directly and record them: they show as "changed since review" until the author confirms them.
   * Responses mark the answered comments; the reason and actor go into history.
   */
  async apply(input: { changes: unknown[], actor: string, reason: string, responses?: { comment: string, text: string }[] }): Promise<ProjectView> {
    return this.serial(async () => {
      const changes: Change[] = input.changes.map(c => ChangeSchema.parse(c))
      if (!input.reason.trim()) throw new Error('a reason is required')
      const { project, state } = await this.load()
      const next = ProjectSchema.parse(applyChanges(project, changes))
      const revision = state.revision + 1
      const answered = new Set<string>()
      for (const r of input.responses ?? []) {
        const c = state.comments.find(x => x.id === r.comment)
        if (!c) continue
        c.response = { text: r.text, revision, at: now() }
        if (c.status === 'open') c.status = 'answered'
        answered.add(c.id)
      }
      state.revision = revision
      // an author's own edit of locked text is the author's decision: the lock follows it (agents cannot write there)
      if (state.flow.frameLock && !input.actor.startsWith('agent') && state.flow.frameLock.hash === frameHash(project) && frameHash(next) !== frameHash(project))
        state.flow.frameLock = { hash: frameHash(next), revision, at: now() }
      state.history.push({ revision, at: now(), actor: input.actor, reason: input.reason, comments: [...answered],
        units: [...new Set(changes.flatMap(changedUnits))] })
      await writeAtomic(join(this.root, '.review', 'history', `r${revision}.json`), next)
      await writeAtomic(this.projectPath, next)
      await writeAtomic(this.statePath, state)
      return this.derive(next, state)
    })
  }

  async addComment(input: { target: Target, source: Comment['source'], author: string, text: string }): Promise<{ view: ProjectView, comment: Comment }> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const comment = CommentSchema.parse({ id: `c${Date.now().toString(36)}${randomUUID().slice(0, 4)}`, ...input,
        status: 'open', createdAt: now(), stage: project.stage })
      state.comments.push(comment)
      await writeAtomic(this.statePath, state)
      return { view: this.derive(project, state), comment }
    })
  }

  /** Add or edit a role-play reviewer (name, brief, concerns, original score); rounds are kept. */
  async upsertReviewer(input: { id?: string | undefined, name: string, brief?: string, concerns?: string, originalScore?: number | null }): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const id = input.id || `r${Date.now().toString(36)}${randomUUID().slice(0, 3)}`
      const old = state.reviewers.find(r => r.id === id)
      const next = ReviewerSchema.parse({ ...old, ...input, id, rounds: old?.rounds ?? [] })
      state.reviewers = old ? state.reviewers.map(r => r.id === id ? next : r) : [...state.reviewers, next]
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  async removeReviewer(id: string): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      state.reviewers = state.reviewers.filter(r => r.id !== id)
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /**
   * Record one review round of a reviewer: score, summary, what would raise the score, and its comments (source
   * "reviewer", tagged with the reviewer and round). Returns the round number.
   */
  async addReviewRound(reviewer: string, input: { score: number | null, summary: string, raise: string, model: string, round?: number,
    comments: { target: Target, text: string, severity?: Comment['severity'] }[] }): Promise<{ view: ProjectView, round: number }> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const r = state.reviewers.find(x => x.id === reviewer)
      if (!r) throw new Error(`unknown reviewer ${reviewer}`)
      const round = input.round ?? (Math.max(0, ...r.rounds.map(x => x.round)) + 1)
      r.rounds = [...r.rounds.filter(x => x.round !== round), { round, at: now(), model: input.model, score: input.score, summary: input.summary,
        raise: input.raise, revision: state.revision }].sort((a, b) => a.round - b.round)
      for (const c of input.comments) {
        state.comments.push(CommentSchema.parse({ id: `c${Date.now().toString(36)}${randomUUID().slice(0, 4)}`, target: c.target, source: 'reviewer',
          author: r.name, text: c.text, status: 'open', createdAt: now(), stage: project.stage, reviewer, round, severity: c.severity }))
      }
      await writeAtomic(this.statePath, state)
      return { view: this.derive(project, state), round }
    })
  }

  /** The author's response to a comment, with how it was handled; the comment counts as answered. */
  async respond(id: string, text: string, disposition: Comment['disposition']): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const c = state.comments.find(x => x.id === id)
      if (!c) throw new Error(`unknown comment ${id}`)
      c.response = { text, revision: state.revision, at: now() }
      c.disposition = disposition
      if (c.status === 'open') c.status = 'answered'
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /** Close, decline or reopen a comment. Only the author decides; the agent answers through apply(). */
  async setComment(id: string, status: Comment['status']): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const c = state.comments.find(x => x.id === id)
      if (!c) throw new Error(`unknown comment ${id}`)
      c.status = status
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  async setAssignee(id: string, assignee: string): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const c = state.comments.find(x => x.id === id)
      if (!c) throw new Error(`unknown comment ${id}`)
      c.assignee = assignee.trim().slice(0, 80)
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /** Store the agent's sort of unregistered numbers (hints only). */
  async setNumberHints(hints: ReviewState['numberHints']): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      state.numberHints = { ...state.numberHints, ...hints }
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /** Mark units as reviewed at their current content. */
  async confirm(keys: string[]): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const byKey = new Map(units(project).map(u => [u.key, u]))
      for (const k of keys) {
        const u = byKey.get(k)
        if (u) state.reviewed[k] = { hash: u.hash, revision: state.revision, at: now() }
      }
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /**
   * Move to a stage. Entering "submit" with unmet checklist items, or leaving the abstract-and-introduction stage
   * with them unlocked, needs a written reason, kept in history: the checklist advises elsewhere, but these are
   * where skipping it must be a recorded decision. Jumping over stages from earlier on is free.
   */
  async setStage(stage: Stage, actor: string, reason = ''): Promise<ProjectView> {
    const s = StageSchema.parse(stage)
    return this.serial(async () => {
      const { project, state } = await this.load()
      // leaving the abstract-and-introduction stage forward with them unlocked is a recorded decision too
      const leavingFrame = project.stage === 'frame' && STAGES.indexOf(s) > STAGES.indexOf('frame') && !frameStatus(project, state).locked
      const unmet = s === 'submit' ? stageChecklist(project, state, 'read').filter(i => !i.ok)
        : leavingFrame ? [{ label: '摘要与引言已锁定', ok: false, detail: '' }] : []
      if (unmet.length && reason.trim().length < 10) throw new Error(s === 'submit' ? `进入投稿前有 ${unmet.length} 项未完成，需要写明理由` : '摘要与引言还没锁定；不锁定就往下写，需要写明理由')
      const next = { ...project, stage: s }
      state.revision += 1
      state.history.push({ revision: state.revision, at: now(), actor,
        reason: unmet.length ? `进入阶段：${s}（未完成：${unmet.map(i => i.label).join('、')}；理由：${reason.trim()}）` : `进入阶段：${s}`, comments: [], units: [] })
      await writeAtomic(join(this.root, '.review', 'history', `r${state.revision}.json`), next)
      await writeAtomic(this.projectPath, next)
      await writeAtomic(this.statePath, state)
      return this.derive(next, state)
    })
  }

  /** Record proposed paragraph rewrites; an earlier pending draft for the same paragraph is replaced. */
  async addDrafts(drafts: Omit<Draft, 'id' | 'createdAt' | 'status'>[]): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      for (const d of drafts) {
        for (const old of state.drafts) if (old.paragraph === d.paragraph && old.status === 'pending') old.status = 'discarded'
        state.drafts.push(DraftSchema.parse({ ...d, id: `d${Date.now().toString(36)}${randomUUID().slice(0, 4)}`, createdAt: now(), status: 'pending' }))
      }
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /**
   * Accept or discard a draft. Accepting replaces the paragraph only if it still reads as the draft's `before`,
   * and records the paragraph as written from the current claims.
   */
  async decideDraft(id: string, accept: boolean, actor: string, edited?: string): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const d = state.drafts.find(x => x.id === id)
      if (!d || d.status !== 'pending') throw new Error('draft is not pending')
      if (!accept) {
        d.status = 'discarded'
        await writeAtomic(this.statePath, state)
        return this.derive(project, state)
      }
      if (paragraphText(project, d.paragraph) !== d.before) throw new Error('the paragraph changed after this draft was made; ask for a new draft')
      const sec = project.sections.find(s => s.paragraphs.some(x => x.id === d.paragraph))!
      const para = sec.paragraphs.find(x => x.id === d.paragraph)!
      const text = edited?.trim() || d.after
      const next = ProjectSchema.parse(applyChanges(project, [{ op: 'upsert-paragraph', section: sec.id, paragraph: { ...para, text, basis: {} } }]))
      const byAuthor = text !== d.after
      d.status = 'accepted'
      d.after = text
      state.revision += 1
      // accepting a rewrite of locked text is the author's decision: the lock moves with it
      if (state.flow.frameLock && state.flow.frameLock.hash === frameHash(project) && frameHash(next) !== frameHash(project))
        state.flow.frameLock = { hash: frameHash(next), revision: state.revision, at: now() }
      state.history.push({ revision: state.revision, at: now(), actor, reason: `${byAuthor ? '修改后接受' : '接受'}段落改写：${d.reason}`, comments: d.comments, units: [`paragraph:${d.paragraph}`] })
      await writeAtomic(join(this.root, '.review', 'history', `r${state.revision}.json`), next)
      await writeAtomic(this.projectPath, next)
      await writeAtomic(this.statePath, state)
      return this.derive(next, state)
    })
  }

  /**
   * Lock the abstract and introduction at their current text, or unlock them with a reason. Once locked, agents can
   * only propose rewrites there, and the rest of the prose is written against them.
   */
  async lockFrame(lock: boolean, actor: string, reason = ''): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      if (lock && !frameStatus(project, state).paragraphs.length) throw new Error('还没有摘要与引言，无法锁定')
      if (!lock && reason.trim().length < 4) throw new Error('解锁需要写明理由')
      state.revision += 1
      state.flow.frameLock = lock ? { hash: frameHash(project), revision: state.revision, at: now() } : null
      state.history.push({ revision: state.revision, at: now(), actor, reason: lock ? '锁定摘要与引言' : `解锁摘要与引言：${reason.trim()}`, comments: [], units: [] })
      await writeAtomic(join(this.root, '.review', 'history', `r${state.revision}.json`), project)
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /** Record workflow progress the content cannot show: an agent round on the frame, the final language pass. */
  async noteFlow(event: 'frame-round' | 'polished'): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      if (event === 'frame-round') state.flow.frameRounds += 1
      else state.flow.polished = state.revision
      await writeAtomic(this.statePath, state)
      return this.derive(project, state)
    })
  }

  /** The claim as it was when a paragraph recorded `hash` (latest matching revision), for "still consistent?" checks. */
  async claimAt(claimId: string, hash: string): Promise<Claim | null> {
    const { state } = await this.load()
    for (let n = state.revision; n >= 0; n--) {
      let p: Project
      try { p = await this.revision(n) } catch { continue }
      const c = p.claims.find(x => x.id === claimId)
      if (c && claimHash(c) === hash) return c
    }
    return null
  }

  /**
   * Record which claims paragraphs state, without touching their text; the basis becomes the current claims.
   * Used when a project is initialised from an existing manuscript.
   */
  async linkParagraphs(links: Record<string, string[]>, actor: string, reason: string): Promise<{ view: ProjectView, unknownParagraphs: string[], unknownClaims: string[] }> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const next = structuredClone(project)
      const claims = new Map(next.claims.map(c => [c.id, c]))
      const known = new Set(next.sections.flatMap(s => s.paragraphs.map(x => x.id)))
      const unknownParagraphs = Object.keys(links).filter(id => !known.has(id))
      const unknownClaims = [...new Set(Object.values(links).flat().filter(id => !claims.has(id)))]
      const units: string[] = []
      for (const s of next.sections) for (const x of s.paragraphs) {
        const ids = links[x.id]
        if (!ids) continue
        x.claims = [...new Set(ids.filter(id => claims.has(id)))]
        x.basis = Object.fromEntries(x.claims.map(id => [id, claimHash(claims.get(id)!)]))
        units.push(`paragraph:${x.id}`)
      }
      if (units.length) {
        state.revision += 1
        // claims a paragraph states are part of its review unit only through the claim list, so prose stays reviewed
        state.history.push({ revision: state.revision, at: now(), actor, reason, comments: [], units: [] })
        await writeAtomic(join(this.root, '.review', 'history', `r${state.revision}.json`), next)
        await writeAtomic(this.projectPath, next)
        await writeAtomic(this.statePath, state)
      }
      return { view: this.derive(next, state), unknownParagraphs, unknownClaims }
    })
  }

  /** The author accepts a paragraph as matching its current claims without rewriting it. */
  async markInSync(paragraphId: string, actor: string): Promise<ProjectView> {
    return this.serial(async () => {
      const { project, state } = await this.load()
      const next = resyncBasis(project, paragraphId)
      state.revision += 1
      state.history.push({ revision: state.revision, at: now(), actor, reason: `确认段落 ${paragraphId} 与论点一致`, comments: [], units: [] })
      await writeAtomic(join(this.root, '.review', 'history', `r${state.revision}.json`), next)
      await writeAtomic(this.projectPath, next)
      await writeAtomic(this.statePath, state)
      return this.derive(next, state)
    })
  }
}
