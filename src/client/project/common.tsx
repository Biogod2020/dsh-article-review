/** Small shared pieces of the project workbench: labels, status marks, word diffs and the comment box. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type React from 'react'
import { diffWordsWithSpace } from 'diff'
import type { Comment, Evidence, Stage, Target } from '../../project/model.ts'
import type { ReviewStatus } from '../../project/units.ts'
import type { ProjectView } from '../../project/store.ts'
import css from './project.module.css'

export const STAGE_LABEL: Record<Stage, string> = {
  materials: '材料', skeleton: '骨架', refine: '论点与图', draft: '成文', read: '阅读审核', submit: '投稿',
}
export const STAGE_HINT: Record<Stage, string> = {
  materials: '登记数据、结果、已有的图和目标期刊',
  skeleton: 'agent 起草故事流：核心论点、各拍、分论点和论据',
  refine: '围绕故事流改论点和图，请编辑、审稿人、读者提意见',
  draft: 'agent 按骨架逐节成文，正文与骨架保持同步',
  read: '按页阅读正文和对应面板，逐段审阅',
  submit: '所有段落已审、数字有出处、意见已处理',
}
export const SOURCE_LABEL: Record<Comment['source'], string> = {
  author: '作者', collaborator: '协作者', editor: '编辑', reviewer: '审稿人', audience: '读者', chat: '对话', check: '检查',
}
export const STATUS_LABEL: Record<Comment['status'], string> = { open: '未处理', answered: '已回应', closed: '已关闭', declined: '不采纳' }
export const EV_KIND: Record<Evidence['kind'], string> = { how: '做法', support: '支持', limit: '限定', gap: '缺口' }
export const EV_STATUS: Record<Evidence['status'], string> = { sufficient: '充足', partial: '部分', missing: '缺失', risk: '风险' }
export const REVIEW_LABEL: Record<ReviewStatus, string> = { reviewed: '已审', changed: '审后有修改', new: '未审' }

export const cx = (...xs: (string | false | undefined | null)[]): string => xs.filter(Boolean).join(' ')

export function ReviewDot({ status }: { status: ReviewStatus | undefined }): ReactNode {
  const s = status ?? 'new'
  return <span className={cx(css.dot, css[`dot_${s}`])} title={REVIEW_LABEL[s]} aria-label={REVIEW_LABEL[s]} />
}

/** One bar segment per supporting/limiting item, coloured by status: how much the claim stands on. */
export function EvidenceBar({ evidence }: { evidence: Evidence[] }): ReactNode {
  const items = evidence.filter(e => e.kind !== 'how')
  if (!items.length) return <div className={css.evbar}><span className={cx(css.seg, css.seg_missing)} title="还没有论据" /></div>
  return <div className={css.evbar}>{items.map(e => (
    <span key={e.id} className={cx(css.seg, css[`seg_${e.kind === 'gap' ? 'missing' : e.status}`])} title={`${EV_KIND[e.kind]} · ${EV_STATUS[e.status]}：${e.text.slice(0, 80)}`} />
  ))}</div>
}

/** Word-level difference; whole numbers stay one token because diffWordsWithSpace splits on spaces only. */
export interface DiffPart { value: string, added?: boolean, removed?: boolean }
/**
 * A word diff that a person can read: a run of fewer than three unchanged words between two changes is taken
 * into the change, and each change is one removed piece followed by one added piece. A raw word diff of a heavily
 * edited sentence alternates single words ("itaa doesfixed notreader"), which nobody can follow.
 */
export function readableDiff(before: string, after: string): DiffPart[] {
  const raw = diffWordsWithSpace(before, after)
  const out: DiffPart[] = []
  let del = '', add = '', open = false
  const flush = (): void => {
    if (del.trim() || add.trim()) { if (del) out.push({ value: del, removed: true }); if (add) out.push({ value: add, added: true }) }
    else if (del || add) out.push({ value: add || del })
    del = ''; add = ''; open = false
  }
  raw.forEach((p, i) => {
    if (p.removed) { del += p.value; open = true; return }
    if (p.added) { add += p.value; open = true; return }
    const short = p.value.trim().split(/\s+/).filter(Boolean).length < 3 && !/[.;:!?]\s*$/.test(p.value.trim())
    const more = raw.slice(i + 1).some(x => x.added || x.removed) && (raw[i + 1]?.added || raw[i + 1]?.removed)
    if (open && short && more) { del += p.value; add += p.value; return }
    flush(); out.push({ value: p.value })
  })
  flush()
  return out
}

export interface TypeProgress { key: 'story' | 'figure' | 'paragraph', label: string, ok: number, changed: number, all: number, next: string | undefined }
/** Review progress split by what is reviewed: the story (thesis, beats, claims), the figures and the paragraphs. */
export function progressByType(view: ProjectView): TypeProgress[] {
  const groups: TypeProgress[] = [
    { key: 'story', label: '故事', ok: 0, changed: 0, all: 0, next: undefined },
    { key: 'figure', label: '图', ok: 0, changed: 0, all: 0, next: undefined },
    { key: 'paragraph', label: '段落', ok: 0, changed: 0, all: 0, next: undefined },
  ]
  const firstNew: (string | undefined)[] = [undefined, undefined, undefined]
  for (const u of view.units) {
    const i = u.kind === 'figure' ? 1 : u.kind === 'paragraph' ? 2 : 0
    const g = groups[i]!, s = view.status[u.key] ?? 'new'
    g.all++
    if (s === 'reviewed') g.ok++
    else if (s === 'changed') { g.changed++; g.next ??= u.key }
    else firstNew[i] ??= u.key
  }
  groups.forEach((g, i) => { g.next ??= firstNew[i] })
  return groups
}

/** A claim as the story view numbers it (C1, C2, …); ids such as "c-accept" are internal. */
export function claimNo(view: ProjectView, id: string): string {
  const i = view.project.claims.findIndex(c => c.id === id)
  return i < 0 ? id : `C${i + 1}`
}

export function WordDiff({ before, after }: { before: string, after: string }): ReactNode {
  if (before === after) return <span>{after}</span>
  return <span className={css.diff}>{readableDiff(before, after).map((part, i) =>
    part.added ? <ins key={i}>{part.value}</ins> : part.removed ? <del key={i}>{part.value}</del> : <span key={i}>{part.value}</span>)}</span>
}

export function SourceTag({ c }: { c: Comment }): ReactNode {
  return <span className={cx(css.src, css[`src_${c.source}`])}>{SOURCE_LABEL[c.source]}{c.source === 'author' || c.source === 'collaborator' ? ` · ${c.author}` : ''}</span>
}

/** Where a unit key or comment target lives, for jumping there; `from` is the comment the jump started at. */
export interface Focus { kind: Target['kind'], id: string, from?: string }

/** A paragraph as a person names it: section, position and opening words, not its internal id. */
export function paraLabel(view: ProjectView | undefined, id: string): string {
  for (const s of view?.project.sections ?? []) {
    const i = s.paragraphs.findIndex(x => x.id === id)
    if (i >= 0) {
      const words = s.paragraphs[i]!.text.split(/\s+/).slice(0, 5).join(' ')
      return `${s.heading.length > 28 ? s.heading.slice(0, 28) + '…' : s.heading} · 第 ${i + 1} 段「${words}…」`
    }
  }
  return `段落 ${id}`
}
export const unitFocus = (key: string): Focus => {
  const [kind, id] = key.includes(':') ? key.split(':') as [string, string] : [key, key]
  return { kind: kind as Focus['kind'], id }
}
const UNIT_LABEL: Record<string, string> = { thesis: '核心论点', beat: '拍', claim: '分论点', figure: '图', paragraph: '段落' }
export const unitLabel = (key: string, view?: ProjectView): string => {
  const f = unitFocus(key)
  if (f.kind === 'thesis') return '核心论点'
  if (f.kind === 'paragraph') return paraLabel(view, f.id)
  if (f.kind === 'figure') return view?.project.figures.find(x => x.id === f.id)?.label ?? `图 ${f.id}`
  if (f.kind === 'beat') { const i = view?.project.beats.findIndex(b => b.id === f.id) ?? -1; return i >= 0 ? `第 ${i + 1} 拍` : `拍 ${f.id}` }
  return `${UNIT_LABEL[f.kind] ?? f.kind} ${f.id}`
}

/**
 * What the answering revision changed. The unit the comment was written on is the one link that matters; the rest of
 * the revision (often every figure and claim it re-saved) stays folded.
 */
function ChangedUnits({ units, own, label, onPick }: { units: string[], own: string, label: (u: string) => string, onPick: (u: string) => void }): ReactNode {
  const [all, setAll] = useState(false)
  const rest = units.filter(u => u !== own)
  if (!units.length) return <div className={css.changedUnits}><span className={css.warnText}>这一版没有修改任何内容</span></div>
  return <div className={css.changedUnits}>
    {units.includes(own) && <button className={css.unitLink} onClick={() => onPick(own)} title="打开并查看相对你上次审过的差异">查看这处的修改 ›</button>}
    {rest.length > 0 && <button className={css.linkBtn} onClick={() => setAll(!all)}>{all ? '收起' : `同一版还改了 ${rest.length} 处`}</button>}
    {all && <div className={css.unitMore}>{rest.map(u => <button key={u} className={css.chip} onClick={() => onPick(u)}>{label(u)}</button>)}</div>}
  </div>
}

const MODEL_SOURCE = new Set<Comment['source']>(['editor', 'reviewer', 'audience'])
const when = (iso: string): string => iso.slice(5, 16).replace('T', ' ')

/**
 * A comment as a short thread: the comment, the agent's reply under it, then the author's controls. The reply lists
 * what the answering revision changed and any paragraph rewrites still waiting, so it can be checked against the record.
 */
export function CommentCard({ c, view, onStatus, onGo, canDecide, targetLabel, onAssign }: {
  c: Comment, view?: ProjectView, onStatus?: (s: Comment['status']) => void, onGo?: (f: Focus) => void, canDecide: boolean, targetLabel?: string,
  onAssign?: (name: string) => void,
}): ReactNode {
  const people = [...new Set((view?.comments ?? []).filter(x => x.source === 'author' || x.source === 'collaborator').map(x => x.author))]
  const changed = c.response ? view?.history.find(h => h.revision === c.response!.revision)?.units : undefined
  const drafts = view?.drafts.filter(d => d.comments.includes(c.id) && d.status === 'pending') ?? []
  const model = MODEL_SOURCE.has(c.source)
  const name = model ? SOURCE_LABEL[c.source] : c.author || SOURCE_LABEL[c.source]
  return <article className={cx(css.comment, css[`cm_${c.status}`])}>
    <div className={css.thMsg}>
      <span className={cx(css.avatar, css[`src_${c.source}`])} aria-hidden>{name.trim().slice(0, 1).toUpperCase()}</span>
      <div className={css.thBody}>
        <div className={css.cmHead}>
          <b>{name}</b><span className={css.thRole}>{model ? '模拟审阅' : SOURCE_LABEL[c.source]}</span>
          <span className={css.thTime}>{when(c.createdAt)}</span>
          {targetLabel && <button className={css.thWhere} onClick={() => onGo?.({ kind: c.target.kind, id: c.target.id })} title="跳到这个位置">{targetLabel}</button>}
          <span className={css.grow} />
          {c.assignee && <span className={css.assignee}>指派：{c.assignee}</span>}
          <span className={cx(css.pill, css[`pill_${c.status}`])}>{STATUS_LABEL[c.status]}</span>
        </div>
        {c.target.quote && <blockquote className={css.quote}>{c.target.quote}</blockquote>}
        <div className={css.cmText}>{c.text}</div>
      </div>
    </div>
    {c.response && <div className={cx(css.thMsg, css.thReply)}>
      <span className={cx(css.avatar, css.avatarAgent)} aria-hidden>✦</span>
      <div className={css.thBody}>
        <div className={css.cmHead}><b>Agent</b><span className={css.thRole}>回应</span><span className={css.thRev}>r{c.response.revision}</span></div>
        <div className={css.cmText}>{c.response.text}</div>
        {changed && <ChangedUnits units={changed} own={`${c.target.kind}:${c.target.id}`} label={u => unitLabel(u, view)} onPick={u => onGo?.({ ...unitFocus(u), from: c.id })} />}
        {drafts.length > 0 && <div className={css.changedUnits}>正文改写草稿 {drafts.length} 段待你确认：{drafts.map(d =>
          <button key={d.id} className={css.unitLink} onClick={() => onGo?.({ kind: 'paragraph', id: d.paragraph, from: c.id })}>{paraLabel(view, d.paragraph)}</button>)}</div>}
      </div>
    </div>}
    {canDecide && onStatus && <div className={css.thActs}>
      {c.status !== 'closed' && <button className={c.status === 'answered' ? css.btnOk : css.btn} onClick={() => onStatus('closed')}>{c.status === 'answered' ? '✓ 满意，关闭' : '关闭'}</button>}
      {c.status === 'open' && <button className={css.btnGhost} onClick={() => onStatus('declined')}>不采纳</button>}
      {c.status !== 'open' && <button className={css.btnGhost} onClick={() => onStatus('open')}>{c.status === 'answered' ? '不满意，重新打开' : '重新打开'}</button>}
      {onAssign && c.status === 'open' && <select className={css.assignSel} value={c.assignee} aria-label="指派给"
        onChange={e => { const v = e.target.value === '__other' ? (window.prompt('指派给谁？') ?? '') : e.target.value; onAssign(v) }}>
        <option value="">不指派</option>{[...new Set([...people, c.assignee].filter(Boolean))].map(n => <option key={n} value={n}>指派给 {n}</option>)}
        <option value="__other">指派给其他人…</option></select>}
    </div>}
  </article>
}

/** Write a comment; the author can also hand it straight to the agent (the usual way of working). */
export function CommentBox({ target, onSave, onSaveAndAsk, placeholder, author }: {
  target: Target, onSave: (t: Target, text: string) => Promise<void>, onSaveAndAsk?: (t: Target, text: string) => Promise<void>,
  placeholder?: string, author: string,
}): ReactNode {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: (t: Target, s: string) => Promise<void>): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    try { await fn(target, text.trim()); setText('') } finally { setBusy(false) }
  }
  return <div className={css.box}>
    <textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder ?? `以 ${author} 的身份写意见`}
      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run(onSaveAndAsk ?? onSave) }} />
    <div className={css.row}>
      {onSaveAndAsk && <button className={css.btnPrimary} disabled={busy || !text.trim()} onClick={() => void run(onSaveAndAsk)} title="⌘/Ctrl+Enter">交给 agent 修改</button>}
      <button className={onSaveAndAsk ? css.btn : css.btnPrimary} disabled={busy || !text.trim()} onClick={() => void run(onSave)}>{onSaveAndAsk ? '只记下意见' : '提交意见'}</button>
    </div>
  </div>
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <div className={css.empty}>{children}</div>
}

const assetCache = new Map<string, Promise<string>>()
/** A project image: linked directly when the host serves files, otherwise loaded once and cached. */
export function AssetImg({ actions, path, ...rest }: { actions: { asset(p: string): string, loadAsset?(p: string): Promise<string> }, path: string }
  & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>): ReactNode {
  const direct = actions.loadAsset ? '' : actions.asset(path)
  const [url, setUrl] = useState(direct)
  useEffect(() => {
    if (!actions.loadAsset) return
    let live = true
    let req = assetCache.get(path)
    if (!req) { req = actions.loadAsset(path); assetCache.set(path, req); req.catch(() => assetCache.delete(path)) }
    setUrl('')  // the same element can be given another path: never keep showing the old image
    req.then(u => { if (live) setUrl(u) }, () => undefined)
    return () => { live = false }
  }, [actions, path])
  const src = actions.loadAsset ? url : direct
  return src ? <img src={src} {...rest} /> : <span className={css.imgLoading} aria-label="载入图片" />
}
