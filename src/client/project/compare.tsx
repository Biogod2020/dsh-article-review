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
    const old = new Map<string, RemovedPara>()
    if (base && n !== undefined) for (const s of base.sections) for (const x of s.paragraphs) old.set(x.id, { id: x.id, heading: s.heading, text: x.text })
    const kinds = new Map<string, ParaChange>()
    const counts: Record<ParaChange, number> = { same: 0, edited: 0, rewritten: 0, new: 0 }
    const now = new Set<string>()
    if (base && n !== undefined) for (const s of view.project.sections) for (const x of s.paragraphs) {
      now.add(x.id)
      const b = old.get(x.id)
      const k: ParaChange = !b ? 'new' : b.text === x.text ? 'same' : kept(b.text, x.text) >= 0.5 ? 'edited' : 'rewritten'
      kinds.set(x.id, k); counts[k]++
    }
    return {
      choice, setChoice, n: base ? n : undefined, base,
      kind: id => kinds.get(id), before: id => old.get(id)?.text,
      removed: [...old.values()].filter(x => !now.has(x.id)), counts,
    }
  }, [view, base, n, choice])
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
      {c.rewritten + c.edited + c.new > 0 && <button className={css.btn} onClick={jump}>下一处修改</button>}
      {cmp.removed.length > 0 && <button className={css.btn} onClick={() => document.getElementById('cmp-removed')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>看删除的段落</button>}
    </>}
  </div>
}

/** One paragraph against the baseline: a word diff when most words are kept, the two versions one above the other otherwise. */
export function ParaCompare({ kind, before, after }: { kind: ParaChange, before: string | undefined, after: string }): ReactNode {
  if (kind === 'edited' && before !== undefined) return <p><WordDiff before={before} after={after} /></p>
  if (kind === 'rewritten' && before !== undefined) return <div className={css.cmpPair}>
    <div className={css.cmpOld}><span className={css.k}>对照版本</span><p>{before}</p></div>
    <div className={css.cmpNew}><span className={css.k}>现在</span><p>{after}</p></div>
  </div>
  return <p>{after}</p>
}

/** Paragraphs of the baseline that the current text no longer has, grouped under their old headings. */
export function RemovedParas({ cmp }: { cmp: Comparison }): ReactNode {
  if (cmp.n === undefined || !cmp.removed.length) return null
  const groups: Array<{ heading: string, items: RemovedPara[] }> = []
  for (const x of cmp.removed) { const g = groups.at(-1); if (g && g.heading === x.heading) g.items.push(x); else groups.push({ heading: x.heading, items: [x] }) }
  return <section id="cmp-removed" className={css.cmpRemoved}>
    <h3>r{cmp.n} 里有、现在已删除的段落（{cmp.removed.length}）</h3>
    <div className={css.muted}>按对照版本的章节排列。这些段落在现在的正文里没有对应段落。</div>
    {groups.map((g, i) => <details key={i} open>
      <summary>{g.heading || '（无标题）'} · {g.items.length} 段</summary>
      {g.items.map(x => <p key={x.id}>{x.text}</p>)}
    </details>)}
  </section>
}
