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
export function WordDiff({ before, after }: { before: string, after: string }): ReactNode {
  if (before === after) return <span>{after}</span>
  return <span className={css.diff}>{diffWordsWithSpace(before, after).map((part, i) =>
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
const unitLabel = (key: string, view?: ProjectView): string => {
  const f = unitFocus(key)
  if (f.kind === 'thesis') return '核心论点'
  if (f.kind === 'paragraph') return paraLabel(view, f.id)
  if (f.kind === 'figure') return view?.project.figures.find(x => x.id === f.id)?.label ?? `图 ${f.id}`
  if (f.kind === 'beat') { const i = view?.project.beats.findIndex(b => b.id === f.id) ?? -1; return i >= 0 ? `第 ${i + 1} 拍` : `拍 ${f.id}` }
  return `${UNIT_LABEL[f.kind] ?? f.kind} ${f.id}`
}

/**
 * A comment with its reply and the author's controls. The reply lists what the answering revision actually changed
 * (each a link to the change) and any paragraph rewrites still waiting, so a reply can be checked against the record.
 */
export function CommentCard({ c, view, onStatus, onGo, canDecide, targetLabel, onAssign }: {
  c: Comment, view?: ProjectView, onStatus?: (s: Comment['status']) => void, onGo?: (f: Focus) => void, canDecide: boolean, targetLabel?: string,
  onAssign?: (name: string) => void,
}): ReactNode {
  const people = [...new Set((view?.comments ?? []).filter(x => x.source === 'author' || x.source === 'collaborator').map(x => x.author))]
  const changed = c.response ? view?.history.find(h => h.revision === c.response!.revision)?.units : undefined
  const drafts = view?.drafts.filter(d => d.comments.includes(c.id) && d.status === 'pending') ?? []
  return <div className={cx(css.comment, css[`cm_${c.status}`])}>
    <div className={css.cmHead}>
      <SourceTag c={c} />
      {targetLabel && <button className={css.linkBtn} onClick={() => onGo?.({ kind: c.target.kind, id: c.target.id })} title="跳到位置">{targetLabel}</button>}
      <span className={css.muted}>{c.createdAt.slice(5, 16).replace('T', ' ')}</span>
      <span className={cx(css.pill, css[`pill_${c.status}`])}>{STATUS_LABEL[c.status]}</span>
      {c.assignee && <span className={css.assignee}>指派：{c.assignee}</span>}
    </div>
    {c.target.quote && <blockquote className={css.quote}>{c.target.quote}</blockquote>}
    <div className={css.cmText}>{c.text}</div>
    {c.response && <div className={css.reply}><b>Agent 回应（r{c.response.revision}）</b>：{c.response.text}
      {changed && <div className={css.changedUnits}>这次实际修改：{changed.length ? changed.map(u =>
        <button key={u} className={css.unitLink} onClick={() => onGo?.({ ...unitFocus(u), from: c.id })} title="打开并查看相对你上次审过的差异">{unitLabel(u, view)}</button>) : <span className={css.warnText}>没有修改任何内容</span>}</div>}
      {drafts.length > 0 && <div className={css.changedUnits}>正文改写草稿 {drafts.length} 段待你确认：{drafts.map(d =>
        <button key={d.id} className={css.unitLink} onClick={() => onGo?.({ kind: 'paragraph', id: d.paragraph, from: c.id })}>{paraLabel(view, d.paragraph)}</button>)}</div>}
    </div>}
    {canDecide && onStatus && <div className={css.row}>
      {c.status !== 'closed' && <button className={css.btn} onClick={() => onStatus('closed')}>{c.status === 'answered' ? '满意，关闭' : '关闭'}</button>}
      {c.status === 'open' && <button className={css.btnGhost} onClick={() => onStatus('declined')}>不采纳</button>}
      {c.status !== 'open' && <button className={css.btnGhost} onClick={() => onStatus('open')}>重新打开</button>}
      {onAssign && c.status === 'open' && <select className={css.assignSel} value={c.assignee} aria-label="指派给"
        onChange={e => { const v = e.target.value === '__other' ? (window.prompt('指派给谁？') ?? '') : e.target.value; onAssign(v) }}>
        <option value="">不指派</option>{[...new Set([...people, c.assignee].filter(Boolean))].map(n => <option key={n} value={n}>指派给 {n}</option>)}
        <option value="__other">指派给其他人…</option></select>}
    </div>}
  </div>
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
    req.then(u => { if (live) setUrl(u) }, () => undefined)
    return () => { live = false }
  }, [actions, path])
  return url ? <img src={url} {...rest} /> : <span className={css.imgLoading} aria-label="载入图片" />
}
