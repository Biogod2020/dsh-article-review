/**
 * Comparison of the prose with an earlier revision of the project: which paragraphs were edited, rewritten, added
 * or removed since then. The 正文 view shows the differences in place; the 阅读 view marks the paragraphs. The
 * baseline defaults to the revision the author last reviewed, and any earlier revision can be chosen.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { diffWordsWithSpace } from 'diff'
import type { Project } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ProjectActions } from './actions.ts'
import { WordDiff, cx } from './common.tsx'
import css from './project.module.css'

/** Earlier project revision, cached per revision number. */
const revCache = new Map<number, Promise<Project>>()
export function useRevision(actions: ProjectActions, n: number | undefined): Project | null {
  const [p, setP] = useState<Project | null>(null)
  useEffect(() => {
    if (n === undefined) { setP(null); return }
    let live = true
    let req = revCache.get(n)
    if (!req) { req = actions.revision(n); revCache.set(n, req) }
    req.then(x => { if (live) setP(x) }, () => { revCache.delete(n) })
    return () => { live = false }
  }, [actions, n])
  return p
}

/** same: text identical; edited: most words kept; rewritten: fewer than half the words kept; new: not in the baseline. */
export type ParaChange = 'same' | 'edited' | 'rewritten' | 'new'
export interface RemovedPara { id: string, heading: string, text: string }
export interface Comparison {
  /** 'off', 'auto' (the revision the author last reviewed) or a revision number */
  choice: string
  setChoice: (v: string) => void
  /** the baseline revision in use; undefined when the comparison is off or there is nothing to compare */
  n: number | undefined
  base: Project | null
  kind: (paragraph: string) => ParaChange | undefined
  before: (paragraph: string) => string | undefined
  removed: RemovedPara[]
  /** baseline paragraphs that stood just before this current paragraph and are gone */
  removedBefore: (paragraph: string) => RemovedPara[]
  /** baseline paragraphs after the last current paragraph that are gone */
  removedEnd: RemovedPara[]
  counts: Record<ParaChange, number>
}

// v2: 'auto' now falls back to the previous revision, so an old stored choice starts again from 'auto'
const KEY = 'paper-compare-base-v2'
const stored = (): string => { try { return localStorage.getItem(KEY) ?? 'auto' } catch { return 'auto' } }

/** Share of the longer text's words that both versions keep. */
export function kept(before: string, after: string): number {
  const words = (s: string): number => s.split(/\s+/).filter(Boolean).length
  let same = 0
  for (const part of diffWordsWithSpace(before, after)) if (!part.added && !part.removed) same += words(part.value)
  return same / Math.max(1, words(before), words(after))
}

export function useComparison(view: ProjectView, actions: ProjectActions): Comparison {
  const [choice, set] = useState(stored)
  const setChoice = (v: string): void => { set(v); try { localStorage.setItem(KEY, v) } catch { /* private mode */ } }
  // auto: the earliest revision at which the author reviewed a paragraph that has changed since
  const auto = useMemo(() => {
    const revs = view.project.sections.flatMap(s => s.paragraphs).map(x => `paragraph:${x.id}`)
      .filter(k => view.status[k] === 'changed').map(k => view.reviewed[k]).filter((r): r is number => r !== undefined)
    return revs.length ? Math.min(...revs) : undefined
  }, [view])
  // nothing reviewed has changed: fall back to the latest earlier revision whose prose differs, so the last edit of the text shows
  const prose = (p: Project): string => p.sections.flatMap(s => s.paragraphs).map(x => `${x.id}\u0000${x.text}`).join('\u0001')
  const now = useMemo(() => prose(view.project), [view.project])
  const [last, setLast] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (choice !== 'auto' || auto !== undefined) return
    let live = true
    void (async () => {
      for (let r = view.revision - 1; r >= 0; r--) {
        let req = revCache.get(r)
        if (!req) { req = actions.revision(r); revCache.set(r, req) }
        try { if (prose(await req) !== now) { if (live) setLast(r); return } } catch { revCache.delete(r); return }
        if (!live) return
      }
      if (live) setLast(undefined)
    })()
    return () => { live = false }
  }, [actions, choice, auto, now, view.revision])
  const picked = choice === 'off' ? undefined : choice === 'auto' ? auto ?? last : Number(choice)
  const n = picked !== undefined && Number.isInteger(picked) && picked >= 0 && picked < view.revision ? picked : undefined
  const base = useRevision(actions, n)
  return useMemo(() => {
    const kinds = new Map<string, ParaChange>(), before = new Map<string, string>(), gone = new Map<string, RemovedPara[]>()
    const counts: Record<ParaChange, number> = { same: 0, edited: 0, rewritten: 0, new: 0 }
    let removed: RemovedPara[] = [], removedEnd: RemovedPara[] = []
    if (base && n !== undefined) {
      const old = base.sections.flatMap(s => s.paragraphs.map(x => ({ id: x.id, heading: s.heading, text: x.text })))
      const cur = view.project.sections.flatMap(s => s.paragraphs)
      const a = align(old, cur)
      let pending: RemovedPara[] = []
      for (const step of a) {
        if (step.cur === undefined) { pending.push(old[step.old!]!); continue }
        const x = cur[step.cur]!, b = step.old === undefined ? undefined : old[step.old]!
        const k: ParaChange = !b ? 'new' : b.text === x.text ? 'same' : kept(b.text, x.text) >= 0.5 ? 'edited' : 'rewritten'
        kinds.set(x.id, k); counts[k]++
        if (b) before.set(x.id, b.text)
        if (pending.length) { gone.set(x.id, pending); removed = removed.concat(pending); pending = [] }
      }
      removedEnd = pending; removed = removed.concat(pending)
    }
    return {
      choice, setChoice, n: base ? n : undefined, base,
      kind: id => kinds.get(id), before: id => before.get(id),
      removed, removedBefore: id => gone.get(id) ?? NONE, removedEnd, counts,
    }
  }, [view, base, n, choice])
}

const NONE: RemovedPara[] = []
const bag = (s: string): Map<string, number> => {
  const m = new Map<string, number>()
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}.%]+/u)) if (w) m.set(w, (m.get(w) ?? 0) + 1)
  return m
}
/** Share of the longer paragraph's words that the two paragraphs have in common, whatever their order. */
function overlap(a: Map<string, number>, b: Map<string, number>, na: number, nb: number): number {
  let same = 0
  for (const [w, c] of a) same += Math.min(c, b.get(w) ?? 0)
  return same / Math.max(1, na, nb)
}

/**
 * Line up the paragraphs of the baseline with the current ones by what they say, in order, the way a text diff lines
 * up lines. Paragraph ids are not used: an id may name a position, so inserting one paragraph would pair every later
 * paragraph with its neighbour. A step has both sides (kept or changed), only `cur` (added) or only `old` (removed).
 */
export function align(old: Array<{ text: string }>, cur: Array<{ text: string }>): Array<{ old?: number, cur?: number }> {
  const n = old.length, m = cur.length
  const ob = old.map(x => bag(x.text)), cb = cur.map(x => bag(x.text))
  const size = (b: Map<string, number>): number => { let k = 0; for (const c of b.values()) k += c; return k }
  const on = ob.map(size), cn = cb.map(size)
  // score of pairing old i with current j; below 0.4 of shared words they are not the same paragraph
  const score = new Float64Array(n * m).fill(-1)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    if (old[i]!.text === cur[j]!.text) { score[i * m + j] = 2; continue }
    const s = overlap(ob[i]!, cb[j]!, on[i]!, cn[j]!)
    if (s >= 0.4) score[i * m + j] = s
  }
  const w = m + 1, best = new Float64Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    const s = score[i * m + j]!
    best[i * w + j] = Math.max(best[(i + 1) * w + j]!, best[i * w + j + 1]!, s > 0 ? s + best[(i + 1) * w + j + 1]! : 0)
  }
  const out: Array<{ old?: number, cur?: number }> = []
  let i = 0, j = 0
  while (i < n || j < m) {
    const s = i < n && j < m ? score[i * m + j]! : -1
    if (s > 0 && best[i * w + j] === s + best[(i + 1) * w + j + 1]!) { out.push({ old: i, cur: j }); i++; j++ }
    else if (i < n && (j === m || best[i * w + j] === best[(i + 1) * w + j]!)) { out.push({ old: i }); i++ }
    else { out.push({ cur: j }); j++ }
  }
  return out
}

export const CHANGE_LABEL: Record<ParaChange, string> = { same: '未改', edited: '有修改', rewritten: '重写', new: '新增' }

/** The baseline chooser with the counts, for the top of the 正文 view. */
export function CompareBar({ view, cmp }: { view: ProjectView, cmp: Comparison }): ReactNode {
  if (view.revision === 0) return null
  const jump = (): void => {
    const marks = [...document.querySelectorAll<HTMLElement>('[data-change]')]
    if (!marks.length) return
    const y = window.innerHeight * 0.3
    const next = marks.find(m => m.getBoundingClientRect().top > y + 4) ?? marks[0]!
    next.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const c = cmp.counts
  return <div className={css.cmpBar}>
    <label>对照版本
      <select value={cmp.choice} onChange={e => cmp.setChoice(e.target.value)}>
        <option value="auto">上次审过的版本（没有则上一次改动前）</option>
        {view.history.filter(h => h.revision < view.revision).map(h => h.revision).filter((r, i, a) => a.indexOf(r) === i)
          .map(r => <option key={r} value={String(r)}>r{r}{r === 0 ? '（最初版本）' : ''}</option>)}
        <option value="off">不对照</option>
      </select></label>
    {cmp.n === undefined ? <span className={css.muted}>{cmp.choice === 'off' ? '没有显示修改。' : cmp.choice === 'auto' && view.revision === 0 ? '还没有更早的版本。' : '正在读取对照版本…'}</span> : <>
      <span>相对 r{cmp.n}：</span>
      <span className={cx(css.cmpTag, css.cmp_rewritten)}>重写 {c.rewritten} 段</span>
      <span className={cx(css.cmpTag, css.cmp_edited)}>有修改 {c.edited} 段</span>
      <span className={cx(css.cmpTag, css.cmp_new)}>新增 {c.new} 段</span>
      <span className={cx(css.cmpTag, css.cmp_removed)}>删除 {cmp.removed.length} 段</span>
      <span className={css.muted}>未改 {c.same} 段</span>
      {c.rewritten + c.edited + c.new + cmp.removed.length > 0 && <button className={css.btn} onClick={jump}>下一处修改</button>}
    </>}
  </div>
}

/** One paragraph against the baseline: a word diff when most words are kept; otherwise the old paragraph as a removed block above the new one, like a text diff. */
export function ParaCompare({ kind, before, after }: { kind: ParaChange, before: string | undefined, after: string }): ReactNode {
  if (kind === 'edited' && before !== undefined) return <p><WordDiff before={before} after={after} /></p>
  if (kind === 'rewritten' && before !== undefined) return <><div className={css.dfDel}><p>{before}</p></div><div className={css.dfAdd}><p>{after}</p></div></>
  if (kind === 'new') return <div className={css.dfAdd}><p>{after}</p></div>
  return <p>{after}</p>
}

/** Baseline paragraphs that are gone, shown where they stood, like the removed lines of a text diff. */
export function RemovedHere({ items, n }: { items: RemovedPara[], n: number | undefined }): ReactNode {
  if (n === undefined || !items.length) return null
  return <>{items.map(x => <div key={x.id} className={css.dfDel} data-change="removed" title={`r${n} 里有、现在已删除的段落`}><p>{x.text}</p></div>)}</>
}
