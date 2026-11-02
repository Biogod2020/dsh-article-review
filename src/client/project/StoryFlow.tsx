/**
 * The story flow: the review surface for the skeleton and refine stages. Beats run down the left; each beat's
 * claims sit beside it with their evidence strength, review state, open comments and prose sync. Selecting a
 * claim opens its detail: evidence with panels, the paragraphs that state it, comments and the change since the
 * author last reviewed it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Claim, Comment, Project, Target } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ProjectActions } from './actions.ts'
import { CommentBox, CommentCard, EV_KIND, EV_STATUS, EvidenceBar, ReviewDot, WordDiff, cx, Empty } from './common.tsx'
import { AssetImg } from './common.tsx'
import css from './project.module.css'

export type { Focus } from './common.tsx'
import type { Focus } from './common.tsx'

const claimText = (c: Claim | undefined): string => c ? [c.title, c.statement, ...c.evidence.map(e => `[${EV_KIND[e.kind]}·${EV_STATUS[e.status]}] ${e.text}`)].join('\n') : ''

/** Comments that belong to a claim: on it or on one of its evidence items. */
export const claimComments = (comments: Comment[], c: Claim): Comment[] =>
  comments.filter(x => (x.target.kind === 'claim' && x.target.id === c.id) || (x.target.kind === 'evidence' && c.evidence.some(e => e.id === x.target.id)))

export function StoryFlow({ view, actions, focus, onFocus, onGo, onAskComment, onRead }: {
  view: ProjectView, actions: ProjectActions, focus: Focus | null, onFocus: (f: Focus | null) => void, onGo: (f: Focus) => void,
  onAskComment: (t: Target, text: string) => Promise<void>, onRead: (paragraph: string) => void,
}): ReactNode {
  const p = view.project
  const claims = useMemo(() => new Map(p.claims.map(c => [c.id, c])), [p.claims])
  const syncBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of view.sync) if (s.kind !== 'unwritten') m.set(s.claim, (m.get(s.claim) ?? 0) + 1)
    return m
  }, [view.sync])
  const selected = focus?.kind === 'claim' ? claims.get(focus.id) : focus?.kind === 'evidence' ? p.claims.find(c => c.evidence.some(e => e.id === focus.id)) : undefined
  const seen = new Set<string>()
  if (!p.beats.length) return <Empty>还没有骨架。在“概览”里让 agent 根据材料起草故事流，或导入已有文章。</Empty>
  return <div className={css.storyWrap}>
    <div className={css.story}>
      <ThesisCard view={view} actions={actions} />
      {p.beats.map((b, i) => {
        const bc = view.comments.filter(c => c.target.kind === 'beat' && c.target.id === b.id && c.status === 'open').length
        return <div key={b.id} className={css.beatRow}>
          <div className={css.beat}>
            <div className={css.beatHead}><span className={css.beatNo}>{i + 1}</span><ReviewDot status={view.status[`beat:${b.id}`]} />
              {bc > 0 && <span className={css.badge}>{bc} 条意见</span>}</div>
            <div className={css.beatTitle}>{b.title}</div>
            {b.summary && <div className={css.beatSummary}>{b.summary}</div>}
          </div>
          <div className={css.claimCol}>
            {b.claims.map(cid => {
              const c = claims.get(cid)
              if (!c) return <div key={cid} className={css.claimMissing}>缺少分论点 {cid}</div>
              const again = seen.has(cid)
              seen.add(cid)
              if (again) return <button key={cid} className={css.claimRef} onClick={() => onFocus({ kind: 'claim', id: cid })}>见前文 {cid} · {c.title}</button>
              const open = claimComments(view.comments, c).filter(x => x.status === 'open').length
              const answered = claimComments(view.comments, c).filter(x => x.status === 'answered').length
              const gaps = c.evidence.filter(e => e.kind === 'gap').length
              return <button key={cid} className={cx(css.claim, c.role === 'core' && css.claimCore, selected?.id === cid && css.claimSel)}
                onClick={() => onFocus(selected?.id === cid ? null : { kind: 'claim', id: cid })}>
                <div className={css.claimTop}><span className={css.cid}>{c.id}</span>
                  {c.role === 'core' && <span className={css.core}>核心</span>}
                  <span className={css.grow} /><ReviewDot status={view.status[`claim:${cid}`]} /></div>
                <div className={css.claimTitle}>{c.title}</div>
                <EvidenceBar evidence={c.evidence} />
                <div className={css.claimMeta}>
                  {open > 0 && <span className={css.badge}>{open} 未处理</span>}
                  {answered > 0 && <span className={css.badgeOk}>{answered} 待你确认</span>}
                  {gaps > 0 && <span className={css.badgeGap}>{gaps} 缺口</span>}
                  {(syncBy.get(cid) ?? 0) > 0 && <span className={css.badgeWarn} title="论点改过，正文还没跟上">正文未同步 {syncBy.get(cid)}</span>}
                </div>
              </button>
            })}
          </div>
        </div>
      })}
    </div>
    {selected && <ClaimDetail key={selected.id} claim={selected} view={view} actions={actions} focusEvidence={focus?.kind === 'evidence' ? focus.id : ''}
      onClose={() => onFocus(null)} onGo={onGo} onAskComment={onAskComment} onRead={onRead} />}
  </div>
}

function ThesisCard({ view, actions }: { view: ProjectView, actions: ProjectActions }): ReactNode {
  const t = view.project.thesis
  return <div className={css.thesis}>
    <div className={css.thesisHead}>核心论点 <ReviewDot status={view.status.thesis} />
      {view.status.thesis !== 'reviewed' && actions.user.role === 'author' && <button className={css.linkBtnLight} onClick={() => void actions.confirm(['thesis'])}>确认已审</button>}</div>
    <div className={css.thesisTitle}>{t.title}</div>
    <div className={css.thesisText}>{t.statement}</div>
  </div>
}

/** Earlier project revision for the "since my review" diff, cached per revision number. */
const revCache = new Map<number, Promise<Project>>()
function useRevision(actions: ProjectActions, n: number | undefined): Project | null {
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

/** Claim detail; `embedded` drops the side-panel frame when it lives in the floating window of the story canvas. */
export function ClaimDetail({ claim, view, actions, focusEvidence, onClose, onGo, onAskComment, onRead, embedded = false }: {
  claim: Claim, view: ProjectView, actions: ProjectActions, focusEvidence: string, onClose: () => void, onGo: (f: Focus) => void,
  onAskComment: (t: Target, text: string) => Promise<void>, onRead: (paragraph: string) => void, embedded?: boolean,
}): ReactNode {
  const key = `claim:${claim.id}`
  const status = view.status[key]
  const old = useRevision(actions, status === 'changed' ? view.reviewed[key] : undefined)
  const before = old?.claims.find(c => c.id === claim.id)
  const comments = claimComments(view.comments, claim)
  const author = actions.user.role === 'author'
  const figs = new Map(view.project.figures.map(f => [f.id, f]))
  const paras = view.project.sections.flatMap(s => s.paragraphs.filter(x => x.claims.includes(claim.id)).map(x => ({ s, x })))
  const stale = new Set(view.sync.filter(x => x.claim === claim.id && x.kind === 'claim-changed').map(x => x.paragraph))
  const [zoom, setZoom] = useState<string | null>(null)
  const save = async (t: Target, text: string): Promise<void> => { await actions.comment(t, text) }
  useEffect(() => { if (focusEvidence) document.getElementById(`ev-${focusEvidence}`)?.scrollIntoView({ block: 'center' }) }, [focusEvidence])
  return <aside className={embedded ? css.detailEmbedded : css.detail} aria-label={`分论点 ${claim.id}`}>
    <div className={css.detailHead}>
      <span className={css.cid}>{claim.id}</span>{claim.role === 'core' && <span className={css.core}>核心</span>}
      <ReviewDot status={status} /><span className={css.muted}>{status === 'changed' ? '你审过之后有修改' : status === 'reviewed' ? '已审' : '未审'}</span>
      <span className={css.grow} />
      {author && status !== 'reviewed' && <button className={css.btn} onClick={() => void actions.confirm([key])}>确认已审</button>}
      {!embedded && <button className={css.close} onClick={onClose} aria-label="关闭">×</button>}
    </div>
    <div className={css.detailBody}>
      <h2 className={css.detailTitle}>{claim.title}</h2>
      {status === 'changed' && before
        ? <div className={css.changed}><div className={css.k}>相对你上次审过的版本（r{view.reviewed[key]}）</div><pre className={css.pre}><WordDiff before={claimText(before)} after={claimText(claim)} /></pre></div>
        : <div className={css.stmt}>{claim.statement}</div>}
      {claim.reviewerQuestion && <div className={css.askBox}><b>审稿人会问：</b>{claim.reviewerQuestion}</div>}
      {(['how', 'support', 'limit', 'gap'] as const).map(kind => {
        const items = claim.evidence.filter(e => e.kind === kind)
        if (!items.length) return null
        return <section key={kind}><div className={css.k}>{EV_KIND[kind]}</div>
          {items.map(e => <div key={e.id} id={`ev-${e.id}`} className={cx(css.ev, focusEvidence === e.id && css.evFocus)}>
            <div className={css.evHead}>
              {kind !== 'how' && <span className={cx(css.pill, css[`ev_${kind === 'gap' ? 'missing' : e.status}`])}>{kind === 'gap' ? '缺口' : EV_STATUS[e.status]}</span>}
              {kind === 'gap' && <span className={css.muted}>{e.owner ? `负责：${e.owner}` : '无人负责'}{e.due ? ` · 截止 ${e.due}` : ''}</span>}
              <span className={css.grow} />
              {comments.filter(c => c.target.kind === 'evidence' && c.target.id === e.id && c.status === 'open').length > 0 && <span className={css.badge}>有意见</span>}
            </div>
            <div className={css.evText}>{e.text}</div>
            {e.source && <div className={css.evSrc}>出处：{e.source}</div>}
            {e.panels.length > 0 && <div className={css.thumbs}>{e.panels.map(pn => {
              const f = figs.get(pn.figure)
              const panel = f?.panels.find(x => x.label === pn.label)
              return panel ? <button key={pn.figure + pn.label} className={css.thumb} onClick={() => setZoom(panel.image)} title={`${f!.label}${pn.label} ${panel.note}`}>
                <AssetImg actions={actions} path={panel.image} alt={`${f!.label}${pn.label}`} loading="lazy" /><span>{f!.label}{pn.label}</span></button>
                : <span key={pn.figure + pn.label} className={css.todoPanel}>待做面板 {f?.label ?? pn.figure}{pn.label}</span>
            })}</div>}
          </div>)}
        </section>
      })}
      <section><div className={css.k}>正文中陈述它的段落</div>
        {paras.length ? paras.map(({ s, x }) => <button key={x.id} className={cx(css.paraRef, stale.has(x.id) && css.paraStale)} onClick={() => onRead(x.id)}>
          <span className={css.muted}>{s.heading}</span>{stale.has(x.id) && <span className={css.badgeWarn}>论点已改，段落未同步</span>}
          <span className={css.paraSnip}>{x.text.slice(0, 160)}…</span></button>)
          : <div className={css.muted}>{view.project.sections.length ? '还没有段落陈述这个分论点。' : '成文阶段会在这里列出对应段落。'}</div>}
      </section>
      <section><div className={css.k}>意见（{comments.length}）</div>
        {comments.map(c => <CommentCard key={c.id} c={c} {...(author ? { onAssign: (a: string) => void actions.assign(c.id, a) } : {})} view={view} onGo={onGo} canDecide={author} onStatus={s => void actions.setComment(c.id, s)} />)}
        <CommentBox target={{ kind: 'claim', id: claim.id, quote: '' }} author={actions.user.name} onSave={save}
          {...(author ? { onSaveAndAsk: onAskComment } : {})} />
      </section>
    </div>
    {zoom && <div className={css.lightbox} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom} alt="" /></div>}
  </aside>
}
