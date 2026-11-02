/**
 * Figure board: every figure in main / extended data / undecided, with which claims use each panel. Panels no
 * claim uses and claims without any panel are listed, because "should this be a main figure" was the most
 * frequent kind of author comment.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Figure } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ProjectActions } from './actions.ts'
import { cx } from './common.tsx'
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
      {view.project.claims.map(x => <option key={x.id} value={x.id}>{x.id} {x.title.slice(0, 22)}</option>)}</select>
    {c && <select value={ev} onChange={e => setEv(e.target.value)} aria-label="论据"><option value="">选论据</option>
      {items.map(e => <option key={e.id} value={e.id}>{e.text.slice(0, 40)}</option>)}</select>}
    <div className={css.row}><button className={css.btn} disabled={!ev} onClick={() => void link()}>关联</button><button className={css.btnGhost} onClick={() => setOpen(false)}>取消</button></div>
  </div>
}

export function Figures({ view, actions, onFocus }: { view: ProjectView, actions: ProjectActions, onFocus: (f: Focus) => void }): ReactNode {
  const p = view.project
  const [zoom, setZoom] = useState<string | null>(null)
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
  return <div className={css.figBoard}>
    {bare.length > 0 && <div className={css.notice}>没有任何面板的分论点：{bare.map(c =>
      <button key={c.id} className={css.linkBtn} onClick={() => onFocus({ kind: 'claim', id: c.id })}>{c.id} {c.title}</button>)}</div>}
    <div className={css.figCols}>
      {COLS.map(col => <div key={col.key} className={css.figCol}>
        <div className={css.figColHead}>{col.label}<span className={css.muted}>{p.figures.filter(f => f.placement === col.key).length}</span></div>
        {p.figures.filter(f => f.placement === col.key).map(f => <div key={f.id} className={css.figCard}>
          <div className={css.figHead}><b>{f.label}</b><span className={css.figTitle}>{f.title}</span></div>
          <div className={css.panelGrid}>{f.panels.map(pn => {
            const used = users.get(`${f.id}/${pn.label}`) ?? []
            return <div key={pn.label} className={cx(css.panelCell, !used.length && !pn.spare && css.panelUnused)}>
              <button className={css.panelImg} onClick={() => setZoom(pn.image)} title={`${pn.note}（点击放大）`}><AssetImg actions={actions} path={pn.image} alt={`${f.label}${pn.label}`} loading="lazy" /></button>
              <div className={css.panelMeta}><b>{pn.label}</b> {used.length
                ? used.map(id => <button key={id} className={css.linkBtn} onClick={() => onFocus({ kind: 'claim', id })}>{id}</button>)
                : pn.spare ? <span className={css.muted}>备用</span> : <span className={css.warnText}>无论据引用</span>}</div>
              {!used.length && author && <PanelLink figure={f} label={pn.label} view={view} actions={actions} />}
            </div>
          })}</div>
          {author && <div className={css.row}>{COLS.filter(c => c.key !== f.placement).map(c =>
            <button key={c.key} className={css.btnGhost} onClick={() => void move(f, c.key)}>移到{c.label}</button>)}</div>}
        </div>)}
      </div>)}
    </div>
    {zoom && <div className={css.lightbox} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom} alt="" /></div>}
  </div>
}
