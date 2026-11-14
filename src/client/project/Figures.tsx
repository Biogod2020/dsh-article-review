/**
 * Figure board: every figure in main / extended data / undecided, with which claims use each panel. Panels no
 * claim uses and claims without any panel are listed, because "should this be a main figure" was the most
 * frequent kind of author comment.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Figure } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ProjectActions } from './actions.ts'
import { cx, ReviewDot, REVIEW_LABEL, CommentBox, CommentCard, claimNo } from './common.tsx'
import { AssetImg } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import css from './project.module.css'

const COLS: { key: Figure['placement'], label: string }[] = [
  { key: 'main', label: '主图' }, { key: 'extended', label: '扩展数据' }, { key: 'unplaced', label: '未定' },
]

/** Attach an unused panel to a claim's evidence item, or mark it as a spare kept on purpose. */
function PanelLink({ figure, label, view, actions }: { figure: Figure, label: string, view: ProjectView, actions: ProjectActions }): ReactNode {
  const [open, setOpen] = useState(false)
  const [claim, setClaim] = useState('')
  const [ev, setEv] = useState('')
  const c = view.project.claims.find(x => x.id === claim)
  const items = c?.evidence.filter(e => e.kind !== 'how') ?? []
  const spare = figure.panels.find(p => p.label === label)?.spare ?? false
  if (!open) return <div className={css.row}><button className={css.linkBtn} onClick={() => setOpen(true)}>关联到论据…</button>
    <button className={css.linkBtn} onClick={() => void actions.apply([{ op: 'upsert-figure', figure: { ...figure, panels: figure.panels.map(p => p.label === label ? { ...p, spare: !spare } : p) } }],
      `${figure.label}${label} ${spare ? '取消备用' : '标为备用'}`)}>{spare ? '取消备用' : '标为备用'}</button></div>
  const link = async (): Promise<void> => {
    if (!c) return
    const evidence = c.evidence.map(e => e.id === ev ? { ...e, panels: [...e.panels, { figure: figure.id, label }] } : e)
    await actions.apply([{ op: 'upsert-claim', claim: { ...c, evidence } }], `${figure.label}${label} 关联到 ${c.id} 的论据`)
    setOpen(false)
  }
  return <div className={css.linkForm}>
    <select value={claim} onChange={e => { setClaim(e.target.value); setEv('') }} aria-label="分论点"><option value="">选分论点</option>
      {view.project.claims.map(x => <option key={x.id} value={x.id}>{claimNo(view, x.id)} {x.title.slice(0, 22)}</option>)}</select>
    {c && <select value={ev} onChange={e => setEv(e.target.value)} aria-label="论据"><option value="">选论据</option>
      {items.map(e => <option key={e.id} value={e.id}>{e.text.slice(0, 40)}</option>)}</select>}
    <div className={css.row}><button className={css.btn} disabled={!ev} onClick={() => void link()}>关联</button><button className={css.btnGhost} onClick={() => setOpen(false)}>取消</button></div>
  </div>
}

export function Figures({ view, actions, onFocus, focus }: { view: ProjectView, actions: ProjectActions, onFocus: (f: Focus) => void, focus?: Focus | null }): ReactNode {
  const p = view.project
  const [board, setBoard] = useState(() => { try { return localStorage.getItem('paper-fig-mode') === 'board' } catch { return false } })
  const ordered = COLS.flatMap(col => p.figures.filter(f => f.placement === col.key))
  const [curId, setCurId] = useState(() => (focus?.kind === 'figure' ? focus.id : undefined) ?? ordered.find(f => view.status[`figure:${f.id}`] !== 'reviewed')?.id ?? ordered[0]?.id ?? '')
  useEffect(() => { if (focus?.kind === 'figure' && ordered.some(f => f.id === focus.id)) setCurId(focus.id) }, [focus])
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    const f = (e: KeyboardEvent): void => keyRef.current(e)
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const [zoom, setZoom] = useState<string | null>(null)
  const [openCm, setOpenCm] = useState<string[]>([])
  const users = new Map<string, string[]>()
  for (const c of p.claims) for (const e of c.evidence) for (const pn of e.panels) {
    const k = `${pn.figure}/${pn.label}`
    users.set(k, [...new Set([...(users.get(k) ?? []), c.id])])
  }
  const bare = p.claims.filter(c => !c.evidence.some(e => e.panels.length))
  const move = async (f: Figure, placement: Figure['placement']): Promise<void> => {
    await actions.apply([{ op: 'upsert-figure', figure: { ...f, placement } }], `${f.label} 移到${COLS.find(x => x.key === placement)!.label}`)
  }
  const author = actions.user.role === 'author'
  const setMode = (b: boolean): void => { setBoard(b); try { localStorage.setItem('paper-fig-mode', b ? 'board' : 'review') } catch { /* private mode */ } }
  const at = ordered.findIndex(f => f.id === curId), cur = ordered[at]
  const step = (d: number): void => { const n = ordered[at + d]; if (n) setCurId(n.id) }
  const confirmCur = (): void => {
    if (!author || !cur) return
    if (view.status[`figure:${cur.id}`] !== 'reviewed') void actions.confirm([`figure:${cur.id}`])
    const next = ordered.slice(at + 1).find(f => view.status[`figure:${f.id}`] !== 'reviewed') ?? ordered[at + 1]
    if (next) setCurId(next.id)
  }
  keyRef.current = (e: KeyboardEvent): void => {
    if (board || (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') setZoom(null)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'c' || e.key === 'C') confirmCur()
  }
  const nOk = ordered.filter(f => view.status[`figure:${f.id}`] === 'reviewed').length
  if (!board) {
    const cms = cur ? view.comments.filter(c => c.target.kind === 'figure' && c.target.id === cur.id) : []
    const st = cur ? view.status[`figure:${cur.id}`] ?? 'new' : 'new'
    const whole = cur ? cur.file || cur.panels[0]?.image || '' : ''
    return <div className={css.fgWrap}>
      <nav className={css.fgList}>
        <div className={css.fgListHead}>已审 {nOk}/{ordered.length}<button className={css.linkBtn} onClick={() => setMode(true)} title="三栏看板：把图在主图、扩展数据、未定之间移动，把没人引用的面板关联到论据">整理图的位置</button></div>
        {COLS.map(col => { const fs = ordered.filter(f => f.placement === col.key); return fs.length > 0 && <div key={col.key}>
          <div className={css.fgGroup}>{col.label}</div>
          {fs.map(f => <button key={f.id} className={cx(css.fgItem, f.id === curId && css.fgItemOn)} onClick={() => setCurId(f.id)}>
            <ReviewDot status={view.status[`figure:${f.id}`]} /><b>{f.label}</b><span>{f.title}</span></button>)}
        </div> })}
      </nav>
      {!cur ? <div className={css.muted}>还没有图。</div> : <div className={css.fgMain} key={cur.id}>
        <div className={css.fgHead}>
          <h2>{cur.label}</h2><span className={css.muted}>{REVIEW_LABEL[st]}</span><span className={css.grow} />
          <button className={css.btn} disabled={at <= 0} onClick={() => step(-1)} title="上一张（←）">‹</button>
          <span className={css.muted}>{at + 1} / {ordered.length}</span>
          <button className={css.btn} disabled={at >= ordered.length - 1} onClick={() => step(1)} title="下一张（→）">›</button>
          {author && (st !== 'reviewed'
            ? <button className={cx(css.btn, css.rdConfirm)} onClick={confirmCur} title="把这张图记为已审，并看下一张未审的图（快捷键 C）">✓ 确认已审，下一张 <kbd>C</kbd></button>
            : <span className={css.fgDone}>✓ 已审</span>)}
        </div>
        {whole && <button className={css.fgImg} onClick={() => setZoom(whole)} title="点击放大"><AssetImg actions={actions} path={whole} alt={cur.label} /></button>}
        <p className={css.fgCap}><b>{cur.label}.</b> {cur.caption || cur.title}</p>
        {cur.panels.some(pn => pn.label) && <div className={css.fgPanels}>{cur.panels.filter(pn => pn.label).map(pn => {
          const used = users.get(`${cur.id}/${pn.label}`) ?? []
          return <div key={pn.label} className={css.fgPanel}>
            <button className={css.panelImg} onClick={() => setZoom(pn.image)} title="点击放大这个面板"><AssetImg actions={actions} path={pn.image} alt={`${cur.label}${pn.label}`} loading="lazy" /></button>
            <div className={css.panelMeta}><b>{pn.label}</b> {used.length
              ? used.map(id => <button key={id} className={css.linkBtn} title={p.claims.find(c => c.id === id)?.title ?? id} onClick={() => onFocus({ kind: 'claim', id })}>{claimNo(view, id)}</button>)
              : pn.spare ? <span className={css.muted}>备用</span> : <span className={css.warnText}>无论据引用</span>}</div>
          </div> })}</div>}
        <div className={css.k}>对这张图的意见（{cms.length}）</div>
        {cms.map(c => <CommentCard key={c.id} c={c} view={view} onGo={onFocus} canDecide={author} onStatus={s => void actions.setComment(c.id, s)} />)}
        <CommentBox target={{ kind: 'figure', id: cur.id, quote: '' }} author={actions.user.name} placeholder={`对 ${cur.label} 的意见（可写明是哪个面板）`}
          onSave={async (t, s) => { await actions.comment(t, s) }} />
        {zoom && <div className={css.lightbox} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom} alt="" /></div>}
      </div>}
    </div>
  }
  return <div className={css.figBoard}>
    <div className={css.row} style={{ marginBottom: 10 }}><button className={css.btn} onClick={() => setMode(false)}>‹ 回到逐张审图</button><span className={css.muted}>这里整理图的位置和面板的归属。</span></div>
    {bare.length > 0 && <div className={css.notice}>没有任何面板的分论点：{bare.map(c =>
      <button key={c.id} className={css.linkBtn} onClick={() => onFocus({ kind: 'claim', id: c.id })}>{claimNo(view, c.id)} {c.title}</button>)}</div>}
    <div className={css.figCols}>
      {COLS.map(col => <div key={col.key} className={css.figCol}>
        <div className={css.figColHead}>{col.label}<span className={css.muted}>{p.figures.filter(f => f.placement === col.key).length}</span></div>
        {p.figures.filter(f => f.placement === col.key).map(f => { const cms = view.comments.filter(c => c.target.kind === 'figure' && c.target.id === f.id)
          const showCm = openCm.includes(f.id) || cms.some(c => c.status === 'open' || c.status === 'answered')
          return <div key={f.id} className={css.figCard}>
          <div className={css.figHead}><ReviewDot status={view.status[`figure:${f.id}`]} /><b>{f.label}</b><span className={css.figTitle}>{f.title}</span></div>
          <div className={css.row}><span className={css.muted}>{REVIEW_LABEL[view.status[`figure:${f.id}`] ?? 'new']}</span>
            {author && view.status[`figure:${f.id}`] !== 'reviewed' && <button className={css.btn} onClick={() => void actions.confirm([`figure:${f.id}`])}>确认已审</button>}
            <button className={css.btnGhost} onClick={() => setOpenCm(x => x.includes(f.id) ? x.filter(i => i !== f.id) : [...x, f.id])}>{showCm && openCm.includes(f.id) ? '收起意见' : `写意见${cms.length ? `（已有 ${cms.length} 条）` : ''}`}</button></div>
          <div className={css.panelGrid}>{f.panels.map(pn => {
            const used = users.get(`${f.id}/${pn.label}`) ?? []
            return <div key={pn.label} className={cx(css.panelCell, !used.length && !pn.spare && css.panelUnused)}>
              <button className={css.panelImg} onClick={() => setZoom(pn.image)} title={`${pn.note}（点击放大）`}><AssetImg actions={actions} path={pn.image} alt={`${f.label}${pn.label}`} loading="lazy" /></button>
              <div className={css.panelMeta}><b>{pn.label}</b> {used.length
                ? used.map(id => <button key={id} className={css.linkBtn} title={view.project.claims.find(c => c.id === id)?.title ?? id} onClick={() => onFocus({ kind: 'claim', id })}>{claimNo(view, id)}</button>)
                : pn.spare ? <span className={css.muted}>备用</span> : <span className={css.warnText}>无论据引用</span>}</div>
              {!used.length && author && <PanelLink figure={f} label={pn.label} view={view} actions={actions} />}
            </div>
          })}</div>
          {author && <div className={css.row}>{COLS.filter(c => c.key !== f.placement).map(c =>
            <button key={c.key} className={css.btnGhost} onClick={() => void move(f, c.key)}>移到{c.label}</button>)}</div>}
          {showCm && <div>
            {(openCm.includes(f.id) ? cms : cms.filter(c => c.status === 'open' || c.status === 'answered')).map(c =>
              <CommentCard key={c.id} c={c} view={view} onGo={onFocus} canDecide={author} onStatus={s => void actions.setComment(c.id, s)} />)}
            {openCm.includes(f.id) && <CommentBox target={{ kind: 'figure', id: f.id, quote: '' }} author={actions.user.name} placeholder={`对 ${f.label} 的意见（可写明是哪个面板）`}
              onSave={async (t, s) => { await actions.comment(t, s) }} />}
          </div>}
        </div> })}
      </div>)}
    </div>
    {zoom && <div className={css.lightbox} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom} alt="" /></div>}
  </div>
}
