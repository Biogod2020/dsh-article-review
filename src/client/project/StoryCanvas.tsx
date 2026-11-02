/**
 * The story flow as the paper-argument frontend draws it: a pannable, zoomable canvas. The thesis sits on top, beats
 * run down the left joined by arrows, each beat's claims sit beside it, the open claim's evidence fans out to the
 * right with its panel thumbnail, and a selected evidence item shows its full panel beside it. Details open in a
 * floating window that can be dragged and resized. Node heights are measured after render and the layout is
 * recomputed until it settles (two passes in practice).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as RMouseEvent, PointerEvent as RPointerEvent, ReactNode } from 'react'
import type { Claim, Evidence, Target } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ReviewStatus } from '../../project/units.ts'
import type { ProjectActions } from './actions.ts'
import { AssetImg, CommentBox, CommentCard, cx } from './common.tsx'
import type { Focus } from './common.tsx'
import { ClaimDetail, claimComments } from './StoryFlow.tsx'
import css from './story.module.css'

const X = { B: 0, C: 290, E: 650, F: 1100 }
const W = { T: 640, B: 230, C: 300, E: 420, F: 500 }
const GAP = 34, VG = 12
/** Evidence status as the frontend colours it. */
const ST: Record<string, [string, string]> = { sufficient: ['充足', 'var(--ok)'], partial: ['部分', 'var(--part)'], missing: ['缺口', 'var(--gap)'], risk: ['反证/风险', 'var(--neg)'] }
const RL: Record<string, string> = { support: '支持', limit: '限定', gap: '缺口' }
const stOf = (e: Evidence): string => e.kind === 'gap' ? 'missing' : e.status
const shown = (c: Claim): Evidence[] => {
  const order = { support: 0, limit: 1, gap: 2, how: 3 } as const
  return c.evidence.filter(e => e.kind !== 'how').slice().sort((a, b) => order[a.kind] - order[b.kind])
}
const counts = (c: Claim): string => (['support', 'limit', 'gap'] as const).map(r => [r, c.evidence.filter(e => e.kind === r).length] as const)
  .filter(([, n]) => n).map(([r, n]) => `${RL[r]} ${n}`).join(' · ')

interface Box { x: number, y: number, w: number }
interface Edge { d: string, stroke: string, width: number, arrow?: boolean }

/** Rounded elbow: horizontal out of (x1,y1), vertical at x=mid, horizontal into (x2,y2). */
function elbow(x1: number, y1: number, x2: number, y2: number, mid: number): string {
  if (Math.abs(y2 - y1) < 2) return `M${x1} ${y1}H${x2}`
  const s = Math.sign(y2 - y1), r = Math.min(8, Math.abs(y2 - y1) / 2)
  return `M${x1} ${y1}H${mid - r}Q${mid} ${y1} ${mid} ${y1 + s * r}V${y2 - s * r}Q${mid} ${y2} ${mid + r} ${y2}H${x2}`
}

type Sel = { kind: 'thesis' } | { kind: 'beat', id: string } | { kind: 'claim', id: string } | { kind: 'evidence', id: string, claim: string } | null

export function StoryCanvas({ view, actions, focus, onGo, onAskComment, onRead }: {
  view: ProjectView, actions: ProjectActions, focus: Focus | null, onGo: (f: Focus) => void,
  onAskComment: (t: Target, text: string) => Promise<void>, onRead: (paragraph: string) => void,
}): ReactNode {
  const p = view.project
  const claims = useMemo(() => new Map(p.claims.map(c => [c.id, c])), [p.claims])
  const figs = useMemo(() => new Map(p.figures.map(f => [f.id, f])), [p.figures])
  const [open, setOpen] = useState<string>(() => localStorage.getItem('paper-project:open') ?? '')
  const [sel, setSel] = useState<Sel>(null)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [t, setT] = useState({ k: 1, tx: 40, ty: 20 })
  const [zoom, setZoom] = useState<{ src: string, cap: string } | null>(null)
  const vp = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLDivElement>())
  const fitted = useRef(false)
  const gest = useRef<{ x: number, y: number, tx: number, ty: number, pan: boolean } | null>(null)
  const suppress = useRef(false)

  // jumps from elsewhere (comment links, history) select and open the claim
  useEffect(() => {
    if (!focus) return
    if (focus.kind === 'claim' && claims.has(focus.id)) { setOpen(focus.id); setSel({ kind: 'claim', id: focus.id }) }
    if (focus.kind === 'evidence') {
      const c = p.claims.find(x => x.evidence.some(e => e.id === focus.id))
      if (c) { setOpen(c.id); setSel({ kind: 'evidence', id: focus.id, claim: c.id }) }
    }
    if (focus.kind === 'beat') setSel({ kind: 'beat', id: focus.id })
    if (focus.kind === 'thesis') setSel({ kind: 'thesis' })
  }, [focus, claims, p.claims])
  useEffect(() => { localStorage.setItem('paper-project:open', open) }, [open])

  const h = (id: string, dflt: number): number => heights[id] ?? dflt
  const syncBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of view.sync) if (s.kind !== 'unwritten') m.set(s.claim, (m.get(s.claim) ?? 0) + 1)
    return m
  }, [view.sync])

  /** Positions and connectors, ported from the frontend's renderFlow. */
  const layout = useMemo(() => {
    const pos: Record<string, Box> = {}, edges: Edge[] = []
    pos.T = { x: 0, y: 0, w: W.T }
    let y = h('T', 90) + 44
    const seen = new Set<string>(), beatYs: [number, number][] = []
    const nodes: { key: string, kind: 'beat' | 'claim' | 'ref' | 'ev' | 'fig', id: string, beat?: number }[] = []
    let figRight = 0
    p.beats.forEach((b, i) => {
      const bk = `B:${b.id}`
      pos[bk] = { x: X.B, y, w: W.B }; nodes.push({ key: bk, kind: 'beat', id: b.id })
      let cy = y
      const cl: string[] = []
      for (const id of b.claims) {
        const ck = seen.has(id) ? `R:${i}:${id}` : `C:${id}`
        nodes.push({ key: ck, kind: seen.has(id) ? 'ref' : 'claim', id, beat: i })
        seen.add(id)
        pos[ck] = { x: X.C, y: cy, w: W.C }
        cl.push(ck)
        cy += h(ck, ck.startsWith('R') ? 34 : 120) + VG
      }
      let bottom = Math.max(y + h(bk, 120), cy - VG)
      const by = y + 24
      for (const ck of cl) edges.push({ d: elbow(X.B + W.B, by, X.C, pos[ck]!.y + Math.min(24, h(ck, 120) / 2), X.C - 28), stroke: 'var(--edge)', width: 1.5 })
      const ok = cl.find(k => k === `C:${open}`)
      const c = ok ? claims.get(open) : undefined
      if (ok && c) {
        let ey = pos[ok]!.y
        const sy = ey + 24
        let prev = ''
        for (const e of shown(c)) {
          if (prev && e.kind !== prev) ey += 16
          prev = e.kind
          const ek = `E:${e.id}`
          nodes.push({ key: ek, kind: 'ev', id: e.id })
          pos[ek] = { x: X.E, y: ey, w: W.E }
          edges.push({ d: elbow(X.C + W.C, sy, X.E, ey + 22, X.E - 26), stroke: ST[stOf(e)]![1], width: 1.6 })
          ey += h(ek, 90) + 8
        }
        bottom = Math.max(bottom, ey - 8)
        if (sel?.kind === 'evidence' && sel.claim === c.id && pos[`E:${sel.id}`]) {
          const fy = pos[`E:${sel.id}`]!.y
          nodes.push({ key: 'FIG', kind: 'fig', id: sel.id })
          pos.FIG = { x: X.F, y: fy, w: W.F }
          edges.push({ d: elbow(X.E + W.E, fy + 22, X.F, fy + 22, X.F - 20), stroke: 'var(--accent)', width: 1.6 })
          figRight = X.F + W.F
          bottom = Math.max(bottom, fy + h('FIG', 360))
        }
      }
      beatYs.push([y, y + h(bk, 120)])
      y = bottom + GAP
    })
    if (beatYs.length) {
      edges.push({ d: `M115 ${h('T', 90)}V${beatYs[0]![0] - 3}`, stroke: 'var(--ink)', width: 2, arrow: true })
      beatYs.forEach(([top], i) => { if (i) edges.push({ d: `M115 ${beatYs[i - 1]![1]}V${top - 3}`, stroke: 'var(--ink)', width: 2.5, arrow: true }) })
    }
    return { pos, edges, nodes, box: { w: Math.max(W.T, open ? X.E + W.E : X.C + W.C, figRight), h: y } }
  }, [p.beats, claims, open, sel, heights])  // h() reads heights

  // measure rendered heights; re-layout until they stop changing
  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    let changed = false
    for (const [k, el] of els.current) {
      const v = el.offsetHeight
      next[k] = v
      if (Math.abs((heights[k] ?? -1) - v) > 1) changed = true
    }
    if (changed) setHeights(hs => ({ ...hs, ...next }))
  })
  const fit = useCallback(() => {
    const r = vp.current?.getBoundingClientRect()
    if (!r) return
    const k = Math.min(1, (r.width - 60) / layout.box.w)
    setT({ k, tx: Math.max(30, (r.width - layout.box.w * k) / 2), ty: 30 })
  }, [layout.box.w])
  useEffect(() => { if (!fitted.current && Object.keys(heights).length) { fitted.current = true; fit() } }, [heights, fit])

  /**
   * After a selection, pan so the selected claim with its open evidence (and the panel beside a selected evidence
   * item) is on screen and, where possible, left of the floating window.
   */
  const revealKey = sel ? `${sel.kind}:${'id' in sel ? sel.id : ''}:${open}` : ''
  const lastReveal = useRef('')
  useEffect(() => {
    if (!revealKey || revealKey === lastReveal.current) return
    const r = vp.current?.getBoundingClientRect()
    if (!r) return
    const keys = sel?.kind === 'claim' || sel?.kind === 'evidence' ? Object.keys(layout.pos).filter(k => k === `C:${open}` || k.startsWith('E:') || k === 'FIG') : []
    if (!keys.length) return
    lastReveal.current = revealKey
    const boxes = keys.map(k => ({ ...layout.pos[k]!, h: heights[k] ?? 100 }))
    const target = sel?.kind === 'evidence' ? boxes.filter((_, i) => keys[i] === `E:${sel.id}` || keys[i] === 'FIG') : boxes
    const x0 = Math.min(...target.map(b => b.x)), x1 = Math.max(...target.map(b => b.x + b.w))
    const y0 = Math.min(...target.map(b => b.y)), y1 = Math.max(...target.map(b => b.y + b.h))
    const floatEl = vp.current?.parentElement?.querySelector<HTMLElement>(`.${css.float}`)
    const clear = floatEl ? Math.max(r.width * 0.35, floatEl.getBoundingClientRect().left - r.left) : r.width
    setT(s => {
      const m = 20
      let { tx, ty } = s
      const top = ty + y0 * s.k, bot = ty + y1 * s.k
      if (top < m || bot - top > r.height - 2 * m) ty += m - top; else if (bot > r.height - m) ty -= bot - (r.height - m)
      const left = tx + x0 * s.k
      if (left < m) tx += m - left
      const over = tx + x1 * s.k - (clear - m)
      if (over > 0) tx -= Math.min(over, tx + x0 * s.k - m)
      return { ...s, tx, ty }
    })
  }, [revealKey, layout.pos, heights, sel, open])

  const zoomAt = (f: number, cx: number, cy: number): void => setT(s => {
    const k = Math.min(2, Math.max(0.25, s.k * f))
    return { k, tx: cx - (cx - s.tx) * k / s.k, ty: cy - (cy - s.ty) * k / s.k }
  })
  useEffect(() => {
    const el = vp.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
      else setT(s => ({ ...s, tx: s.tx - e.deltaX, ty: s.ty - e.deltaY }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  // one gesture = press, optional move, release; a move over 4 px pans and swallows the closing click
  const onPointerDown = (e: RPointerEvent): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button,textarea,input,select,a')) return
    gest.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, pan: false }
    suppress.current = false
  }
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const g = gest.current
      if (!g) return
      const dx = e.clientX - g.x, dy = e.clientY - g.y
      if (!g.pan && Math.hypot(dx, dy) > 4) { g.pan = true; vp.current?.classList.add(css.drag!) }
      if (g.pan) setT(s => ({ ...s, tx: g.tx + dx, ty: g.ty + dy }))
    }
    const up = (): void => { if (gest.current?.pan) suppress.current = true; gest.current = null; vp.current?.classList.remove(css.drag!) }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
  }, [])
  const click = (fn: () => void) => (e: RMouseEvent): void => {
    if (suppress.current) { suppress.current = false; return }
    e.stopPropagation(); fn()
  }
  const reg = (k: string) => (el: HTMLDivElement | null): void => { if (el) els.current.set(k, el); else els.current.delete(k) }
  const at = (k: string): CSSProperties => { const b = layout.pos[k]; return b ? { left: b.x, top: b.y, width: b.w } : { display: 'none' } }
  const dot = (s: ReviewStatus | undefined): ReactNode => <i className={cx(css.rvdot, css[`rv_${s ?? 'new'}`])} title={s === 'reviewed' ? '已审' : s === 'changed' ? '审后有修改' : '未审'} />

  const selClaim = sel?.kind === 'claim' ? claims.get(sel.id) : sel?.kind === 'evidence' ? claims.get(sel.claim) : undefined
  const thesis = p.thesis
  if (!p.beats.length) return <div className={css.empty}>还没有骨架。在“概览”里让 agent 根据材料起草故事流，或导入已有文章。</div>
  return <div className={css.main}>
    <div ref={vp} className={css.vp} onPointerDown={onPointerDown} onClick={click(() => setSel(null))}>
      <div className={css.world} style={{ transform: `translate(${t.tx}px,${t.ty}px) scale(${t.k})` }}>
        <svg className={css.edges} width={layout.box.w + 200} height={layout.box.h + 200}>
          <defs><marker id="pp-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M1 1L9 5L1 9" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
          {layout.edges.map((e, i) => <path key={i} d={e.d} fill="none" stroke={e.stroke} strokeWidth={e.width} {...(e.arrow ? { markerEnd: 'url(#pp-ah)' } : {})} />)}
        </svg>
        <div ref={reg('T')} className={cx(css.n, css.thesis, sel?.kind === 'thesis' && css.sel)} style={at('T')} onClick={click(() => setSel({ kind: 'thesis' }))}>
          {dot(view.status.thesis)}
          <div className={css.eyebrow}>核心论点 · 点击查看</div>
          <div className={css.tt}>{thesis.title}：{thesis.statement}</div>
        </div>
        {layout.nodes.map(nd => {
          if (nd.kind === 'beat') {
            const b = p.beats.find(x => x.id === nd.id)!, i = p.beats.indexOf(b)
            const bc = view.comments.filter(c => c.target.kind === 'beat' && c.target.id === b.id && c.status === 'open').length
            return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.beat, sel?.kind === 'beat' && sel.id === b.id && css.sel)} style={at(nd.key)}
              onClick={click(() => setSel({ kind: 'beat', id: b.id }))}>
              {dot(view.status[`beat:${b.id}`])}
              <div className={css.tt}><span className={css.num}>{i + 1}</span>{b.title}</div>
              {b.summary && <div className={css.sub}>{b.summary}</div>}
              {bc > 0 && <span className={css.badge}>{bc} 条意见</span>}
            </div>
          }
          if (nd.kind === 'ref') {
            const c = claims.get(nd.id)
            return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.ref)} style={at(nd.key)} onClick={click(() => { setOpen(nd.id); setSel({ kind: 'claim', id: nd.id }) })}>
              ↺ {nd.id} {c?.title ?? '（缺少）'}（见前文）</div>
          }
          if (nd.kind === 'claim') {
            const c = claims.get(nd.id)
            if (!c) return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.claim, css.missingClaim)} style={at(nd.key)}>缺少分论点 {nd.id}</div>
            const cm = claimComments(view.comments, c)
            const openN = cm.filter(x => x.status === 'open').length, answered = cm.filter(x => x.status === 'answered').length
            const isOpen = open === c.id
            return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.claim, c.role === 'core' ? css.core : css.supp, selClaim?.id === c.id && css.sel)} style={at(nd.key)}
              onClick={click(() => { setOpen(isOpen && selClaim?.id === c.id ? '' : c.id); setSel({ kind: 'claim', id: c.id }) })}>
              {dot(view.status[`claim:${c.id}`])}
              <span className={css.role}>{c.role === 'core' ? '核心' : '支撑'}</span>
              <div className={css.eyebrow}>{c.id}</div>
              <div className={css.tt}>{c.title}</div>
              <div className={css.sbar}>{shown(c).map(e => <i key={e.id} style={{ background: ST[stOf(e)]![1], opacity: e.panels.length ? 1 : 0.45 }} />)}</div>
              <div className={css.badges}>
                {openN > 0 && <span className={css.badge}>{openN} 未处理</span>}
                {answered > 0 && <span className={css.badgeOk}>{answered} 待你确认</span>}
                {(syncBy.get(c.id) ?? 0) > 0 && <span className={css.badgeWarn}>正文未同步 {syncBy.get(c.id)}</span>}
              </div>
              <div className={css.exp}>{isOpen ? '收起论据 ▾' : `展开论据 ▸ ${counts(c)}`}</div>
            </div>
          }
          if (nd.kind === 'ev') {
            const c = selClaim && selClaim.id === open ? selClaim : claims.get(open)
            const e = c?.evidence.find(x => x.id === nd.id)
            if (!c || !e) return null
            const idx = shown(c).filter(x => x.kind === e.kind).indexOf(e) + 1
            const pn = e.panels[0], f = pn ? figs.get(pn.figure) : undefined, panel = f?.panels.find(x => x.label === pn!.label)
            const hasNote = view.comments.some(x => x.target.kind === 'evidence' && x.target.id === e.id && x.status === 'open')
            return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.ev, css[`ev_${e.kind}`], !panel && css.todoEv,
              sel?.kind === 'evidence' && sel.id === e.id && css.sel)} style={at(nd.key)} onClick={click(() => setSel({ kind: 'evidence', id: e.id, claim: c.id }))}>
              <div className={css.txt}>
                <div className={css.lab}><span className={cx(css.rl, css[`rl_${e.kind}`])}>{RL[e.kind]} {idx}</span> <span style={{ color: ST[stOf(e)]![1] }}>{ST[stOf(e)]![0]}</span>
                  {hasNote && <span className={css.badge}>有意见</span>}</div>
                {e.text}
              </div>
              {panel ? <AssetImg actions={actions} path={panel.image} alt="" draggable={false} title="点击查看完整面板"
                onClick={click(() => setSel({ kind: 'evidence', id: e.id, claim: c.id }))} />
                : <div className={css.todo}>待做面板{pn ? <><br />{f?.label ?? pn.figure}{pn.label}</> : null}</div>}
            </div>
          }
          // the selected evidence's panel, drawn beside it
          const c = claims.get(open), e = c?.evidence.find(x => x.id === nd.id)
          const pn = e?.panels[0], f = pn ? figs.get(pn.figure) : undefined, panel = f?.panels.find(x => x.label === pn!.label)
          return <div key={nd.key} ref={reg(nd.key)} className={cx(css.n, css.fig)} style={at(nd.key)}>
            {panel ? <><AssetImg actions={actions} path={panel.image} alt="" draggable={false} title="点击全屏查看"
              onClick={click(() => setZoom({ src: panel.image, cap: `${f!.label}${pn!.label} ${panel.note}` }))} />
              <div className={css.cap}><b>{f!.label}{pn!.label}</b> {panel.note}</div></>
              : <div className={css.todo2}><b>待做面板</b><div className={css.sub}>{e?.text}</div></div>}
          </div>
        })}
      </div>
      <div className={css.legend}>论据 <i style={{ background: 'var(--ok)' }} />充足<i style={{ background: 'var(--part)' }} />部分<i style={{ background: 'var(--gap)' }} />缺口
        <i style={{ background: 'var(--neg)' }} />反证/风险 <i className={css.lgTodo} />待做面板 <b className={css.lgCore}>蓝框</b> = 核心分论点
        <span className={css.lgSep} /> <i className={css.lgDot} style={{ background: 'var(--ok)' }} />已审<i className={css.lgDot} style={{ background: 'var(--part)' }} />审后有修改<i className={css.lgDot} style={{ background: '#c9c7bf' }} />未审</div>
      <div className={css.zoomui}><button className={css.btn} onClick={click(() => { const r = vp.current!.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2) })}>−</button>
        <button className={css.btn} onClick={click(() => { const r = vp.current!.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2) })}>＋</button>
        <button className={css.btn} onClick={click(fit)}>适配</button></div>
      <div className={css.canvasHint}>滚轮上下移动 · 拖动平移 · Ctrl/⌘+滚轮缩放</div>
    </div>
    {sel && <FloatWindow title={sel.kind === 'thesis' ? '核心论点' : sel.kind === 'beat' ? `第 ${p.beats.findIndex(b => b.id === sel.id) + 1} 拍` : selClaim ? `${selClaim.id} · ${selClaim.title}` : ''}
      onClose={() => setSel(null)}>
      {selClaim ? <ClaimDetail key={selClaim.id} claim={selClaim} view={view} actions={actions} embedded focusEvidence={sel.kind === 'evidence' ? sel.id : ''}
        onClose={() => setSel(null)} onGo={onGo} onAskComment={onAskComment} onRead={onRead} />
        : sel.kind === 'beat' ? <BeatDetail id={sel.id} view={view} actions={actions} onGo={onGo} onAskComment={onAskComment} />
          : <ThesisDetail view={view} actions={actions} onGo={onGo} onAskComment={onAskComment} />}
    </FloatWindow>}
    {zoom && <div className={css.lb} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom.src} alt="" /><div className={css.lbcap}>{zoom.cap}</div></div>}
  </div>
}

/** Thesis and beats in the floating window: their text, review state and comments. */
function UnitDetail({ unit, target, title, body, view, actions, onGo, onAskComment }: {
  unit: string, target: Target, title: string, body: string, view: ProjectView, actions: ProjectActions,
  onGo: (f: Focus) => void, onAskComment: (t: Target, text: string) => Promise<void>,
}): ReactNode {
  const author = actions.user.role === 'author'
  const status = view.status[unit]
  const comments = view.comments.filter(c => c.target.kind === target.kind && c.target.id === target.id)
  return <div className={css.unit}>
    <div className={css.row}><span className={css.muted}>{status === 'reviewed' ? '已审' : status === 'changed' ? '你审过之后有修改' : '未审'}</span>
      {author && status !== 'reviewed' && <button className={css.btn} onClick={() => void actions.confirm([unit])}>确认已审</button>}</div>
    <h2>{title}</h2>
    <div className={css.stmt}>{body}</div>
    <div className={css.k}>意见（{comments.length}）</div>
    {comments.map(c => <CommentCard key={c.id} c={c} view={view} onGo={onGo} canDecide={author} onStatus={s => void actions.setComment(c.id, s)} />)}
    <CommentBox target={target} author={actions.user.name} onSave={async (t, s) => { await actions.comment(t, s) }} {...(author ? { onSaveAndAsk: onAskComment } : {})} />
  </div>
}
function ThesisDetail(props: { view: ProjectView, actions: ProjectActions, onGo: (f: Focus) => void, onAskComment: (t: Target, text: string) => Promise<void> }): ReactNode {
  const th = props.view.project.thesis
  return <UnitDetail unit="thesis" target={{ kind: 'thesis', id: 'thesis', quote: '' }} title={th.title} body={th.statement} {...props} />
}
function BeatDetail({ id, ...props }: { id: string, view: ProjectView, actions: ProjectActions, onGo: (f: Focus) => void, onAskComment: (t: Target, text: string) => Promise<void> }): ReactNode {
  const b = props.view.project.beats.find(x => x.id === id)
  if (!b) return null
  return <UnitDetail unit={`beat:${id}`} target={{ kind: 'beat', id, quote: '' }} title={b.title} body={b.summary} {...props} />
}

/** The detail window floating over the canvas: drag its title bar, resize from the lower-right corner; kept per browser. */
function FloatWindow({ title, onClose, children }: { title: string, onClose: () => void, children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number, y: number, l: number, t: number } | null>(null)
  useLayoutEffect(() => {
    const f = ref.current, host = f?.parentElement
    if (!f || !host) return
    const m = host.getBoundingClientRect()
    let b: { x?: number, y?: number, w: number, h: number } | null = null
    try { b = JSON.parse(localStorage.getItem('paper-project:float') ?? 'null') } catch { b = null }
    if (!b) b = { w: 460, h: m.height - 32 }
    const w = Math.min(Math.max(300, b.w), m.width - 20), h = Math.min(Math.max(180, b.h), m.height - 16)
    const x = Math.min(Math.max(0, b.x ?? m.width - w - 16), m.width - 120), y = Math.min(Math.max(0, b.y ?? 16), Math.max(0, m.height - h))
    Object.assign(f.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
  }, [])
  useEffect(() => {
    const f = ref.current
    if (!f) return
    const save = (): void => localStorage.setItem('paper-project:float', JSON.stringify({ x: f.offsetLeft, y: f.offsetTop, w: f.offsetWidth, h: f.offsetHeight }))
    const ro = new ResizeObserver(save); ro.observe(f)
    const move = (e: PointerEvent): void => { const d = drag.current; if (!d) return; f.style.left = `${d.l + e.clientX - d.x}px`; f.style.top = `${Math.max(0, d.t + e.clientY - d.y)}px` }
    const up = (): void => { if (drag.current) { drag.current = null; save() } }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('textarea,input')) onClose() }
    addEventListener('keydown', esc)
    return () => { ro.disconnect(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', esc) }
  }, [onClose])
  return <div ref={ref} className={css.float} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <div className={css.fhead} onPointerDown={e => { if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return; const f = ref.current!; drag.current = { x: e.clientX, y: e.clientY, l: f.offsetLeft, t: f.offsetTop } }}>
      <span className={css.ftitle}>{title}</span><button className={css.btn} onClick={onClose} title="关闭（Esc）">×</button></div>
    <div className={css.side}>{children}</div>
  </div>
}
