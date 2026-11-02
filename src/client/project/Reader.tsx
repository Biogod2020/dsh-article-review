/**
 * The 阅读 view, modelled on the preprint reader of the paper frontend: the text in pages of a comfortable length
 * (every section starts a page), and beside each page the figure panels its text cites. Figure references in the text
 * are links: hovering one highlights its panel, clicking scrolls to it. Select text to comment on it; the 这段 tab
 * shows the claims and comments of the paragraph last clicked.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Target } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import { figureRefs, paginate } from '../../project/reader-pages.ts'
import type { Chunk, FigureRef } from '../../project/reader-pages.ts'
import type { ProjectActions } from './actions.ts'
import { AssetImg, CommentBox, CommentCard, Empty, cx } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import css from './project.module.css'

interface Sel { paragraph: string, quote: string, x: number, y: number }
interface Card { key: string, figure: string, panel: string | null, cited: boolean }

const stored = (k: string, d: string): string => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const store = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function Reader({ view, actions, start, onFocus, onAskComment }: {
  view: ProjectView, actions: ProjectActions, start: string, onFocus: (f: Focus) => void,
  onAskComment: (t: Target, text: string) => Promise<void>,
}): ReactNode {
  const p = view.project
  const pages = useMemo(() => paginate(p), [p])
  const pageKey = `paper-read-page:${p.title}`
  const [at, setAt] = useState(() => Math.min(Number(stored(pageKey, '0')) || 0, Math.max(0, pages.length - 1)))
  const [fs, setFs] = useState(() => Number(stored('paper-read-fs', '18')) || 18)
  const [toc, setToc] = useState(false)
  const [side, setSide] = useState<'figs' | 'para'>('figs')
  const [cur, setCur] = useState('')
  const [sel, setSel] = useState<Sel | null>(null)
  const [draftTarget, setDraftTarget] = useState<Target | null>(null)
  const [hover, setHover] = useState('')
  const [flash, setFlash] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [zoom, setZoom] = useState<{ src: string, cap: string, whole?: string } | null>(null)
  const textCol = useRef<HTMLDivElement>(null)
  const cardEls = useRef(new Map<string, HTMLElement>())
  const figs = useMemo(() => new Map(p.figures.map(f => [f.id, f])), [p.figures])

  const go = (i: number): void => {
    const n = Math.max(0, Math.min(pages.length - 1, i))
    setAt(n); store(pageKey, String(n)); setSel(null); setMore(false)
    textCol.current?.scrollTo({ top: 0 })
  }
  // a jump from elsewhere (a comment, the 正文 view) opens the page holding that paragraph
  useEffect(() => {
    if (!start) return
    const i = pages.findIndex(pg => pg.chunks.some(c => c.paragraph === start))
    if (i >= 0) { go(i); setCur(start); setSide('para') }
  }, [start])  // pages are stable for one project view
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, [contenteditable=true]'))) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(at + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1) }
      else if (e.key === 't' || e.key === 'T') setToc(v => !v)
      else if (e.key === 'Escape') { setToc(false); setZoom(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!pages.length || !pages.some(pg => pg.chunks.length)) return <Empty>还没有正文可读。</Empty>
  const page = pages[at]!
  const refsOf = (c: Chunk): FigureRef[] => figureRefs(c.text, p.figures)
  // panels this page cites, in reading order; then panels that the page's claims rest on
  const cards: Card[] = []
  const seen = new Set<string>()
  for (const c of page.chunks) for (const r of refsOf(c)) {
    const key = `${r.figure}/${r.panel ?? ''}`
    if (!seen.has(key)) { seen.add(key); cards.push({ key, figure: r.figure, panel: r.panel, cited: true }) }
  }
  const claimIds = new Set(page.chunks.flatMap(c => p.sections.flatMap(s => s.paragraphs).find(x => x.id === c.paragraph)?.claims ?? []))
  for (const cl of p.claims) if (claimIds.has(cl.id)) for (const e of cl.evidence) for (const pn of e.panels) {
    const key = `${pn.figure}/${pn.label === 'all' ? '' : pn.label}`
    if (!seen.has(key) && figs.has(pn.figure)) { seen.add(key); cards.push({ key, figure: pn.figure, panel: pn.label === 'all' ? null : pn.label, cited: false }) }
  }
  // the panels the page cites come first; panels behind its claims stay collapsed beside them (a page that cites
  // nothing, such as the abstract, shows a few of them), since an abstract that states every claim would list them all
  const cited = cards.filter(c => c.cited), behind = cards.filter(c => !c.cited)
  const shown = more ? cards : cited.length ? cited : behind.slice(0, 6)
  const hidden = cards.length - shown.length
  const openCount = (id: string): number => view.comments.filter(c => c.target.kind === 'paragraph' && c.target.id === id && c.status === 'open').length
  const curPara = p.sections.flatMap(s => s.paragraphs).find(x => x.id === cur)
  const curComments = view.comments.filter(c => c.target.kind === 'paragraph' && c.target.id === cur)

  const jump = (key: string): void => {
    setSide('figs')
    requestAnimationFrame(() => {
      cardEls.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFlash(key); setTimeout(() => setFlash(''), 1100)
    })
  }
  const render = (c: Chunk): ReactNode => {
    const refs = refsOf(c)
    if (!refs.length) return c.text
    const out: ReactNode[] = []
    let i = 0
    refs.forEach((r, k) => {
      const key = `${r.figure}/${r.panel ?? ''}`
      out.push(c.text.slice(i, r.start),
        <a key={k} className={cx(css.rdRef, hover === key && css.rdRefOn)} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover('')}
          onClick={e => { e.stopPropagation(); jump(key) }}>{c.text.slice(r.start, r.end)}</a>)
      i = r.end
    })
    out.push(c.text.slice(i))
    return out
  }
  const onMouseUp = (): void => {
    const s = window.getSelection()
    const q = s?.toString().trim() ?? ''
    if (!s || !q || s.rangeCount === 0) { setSel(null); return }
    const host = (s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement)?.closest('[data-para]')
    const end = (s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement)?.closest('[data-para]')
    if (!host || host !== end) { setSel(null); return }
    const r = s.getRangeAt(0).getBoundingClientRect()
    setSel({ paragraph: host.getAttribute('data-para')!, quote: q.slice(0, 600), x: r.left + r.width / 2, y: r.top })
  }
  const fontSize = (d: number): void => { const v = Math.max(14, Math.min(24, fs + d)); setFs(v); store('paper-read-fs', String(v)) }
  const crumb = [page.section, page.subsection].filter(Boolean).join(' · ')
  const title = (i: number): string => { const pg = pages[i]!; return pg.subsection || pg.section || (pg.chunks[0]?.text.slice(0, 40) ?? '') }

  return <div className={css.rd}>
    <div className={css.rdBar}>
      <button className={css.btn} onClick={() => setToc(v => !v)} title="目录（T）">目录</button>
      <span className={css.rdCrumb}>{crumb}</span>
      <span className={css.grow} />
      <button className={css.btn} disabled={at === 0} onClick={() => go(at - 1)} title="上一页（← / PageUp）">‹</button>
      <span className={css.rdPg}>{at + 1} / {pages.length}</span>
      <button className={css.btn} disabled={at === pages.length - 1} onClick={() => go(at + 1)} title="下一页（→ / PageDown）">›</button>
      <button className={css.btn} onClick={() => fontSize(-1)} title="字号小一点">A−</button>
      <button className={css.btn} onClick={() => fontSize(1)} title="字号大一点">A＋</button>
      <i className={css.rdProgress} style={{ width: `${((at + 1) / pages.length) * 100}%` }} />
    </div>
    <div className={css.rdMain}>
      <div className={css.rdTextCol} ref={textCol} onMouseUp={onMouseUp}>
        <article key={at} className={css.rdText} style={{ fontSize: fs }}>
          {at === 0 && <h1 className={css.rdTitle}>{p.title}</h1>}
          {at > 0 && !page.heads.length && crumb && <div className={css.rdSec}>{crumb}</div>}
          {page.heads.map((h, i) => h.level === 2 ? <h2 key={i}>{h.text}</h2> : <h3 key={i}>{h.text}</h3>)}
          {page.chunks.map(c => <Fragment key={`${c.paragraph}~${c.part}`}>
            <p data-para={c.paragraph} className={cx(c.front ? css.rdFront : css.rdP, c.part > 0 && css.rdCont, cur === c.paragraph && css.rdPCur)}
              onClick={() => setCur(c.paragraph)}>
              {render(c)}
              {c.part === 0 && openCount(c.paragraph) > 0 && <span className={css.rdBadge} title="未处理意见：点击查看" onClick={e => { e.stopPropagation(); setCur(c.paragraph); setSide('para') }}>{openCount(c.paragraph)}</span>}
            </p>
          </Fragment>)}
        </article>
        <nav className={css.rdNav}>
          {at > 0 ? <button className={css.btn} onClick={() => go(at - 1)}>‹ {title(at - 1)}</button> : <span />}
          {at < pages.length - 1 && <button className={css.btn} onClick={() => go(at + 1)}>{title(at + 1)} ›</button>}
        </nav>
      </div>
      <aside className={css.rdFigCol}>
        <div className={css.rdTabs}>
          <button className={cx(side === 'figs' && css.rdTabOn)} onClick={() => setSide('figs')}>本页的图（{cards.length}）</button>
          <button className={cx(side === 'para' && css.rdTabOn)} onClick={() => setSide('para')}>这段{cur ? '' : '（先点一段）'}</button>
        </div>
        {side === 'figs' && <>
          {!cards.length && <div className={css.rdEmpty}>这一页没有引用图表。</div>}
          {shown.map(cd => {
            const f = figs.get(cd.figure)
            if (!f) return null
            const panel = cd.panel ? f.panels.find(x => x.label === cd.panel) : undefined
            const src = panel?.image || f.file || f.panels[0]?.image || ''
            const label = `${f.label}${panel && panel.label !== 'all' ? ` ${panel.label}` : ''}`
            const isOpen = open.has(cd.key)
            return <section key={cd.key} ref={el => { if (el) cardEls.current.set(cd.key, el); else cardEls.current.delete(cd.key) }}
              className={cx(css.rdCard, hover === cd.key && css.rdCardOn, flash === cd.key && css.rdCardFlash)}>
              <header><b>{label}</b><span>{f.title}</span>{!cd.cited && <em className={css.rdTag} title="正文这一页没有直接引用；它支撑本页段落陈述的分论点">论据</em>}</header>
              {src && <button className={css.rdImg} onClick={() => setZoom({ src, cap: `${label}  ${f.caption}`, ...(panel && f.file && f.file !== src ? { whole: f.file } : {}) })} title="点击放大">
                <AssetImg actions={actions} path={src} alt={label} loading="lazy" /></button>}
              {panel?.note && <div className={css.rdNote}>{panel.note}</div>}
              {f.caption && <div className={cx(css.rdCap, !isOpen && css.rdCapClamp)} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(cd.key)) n.delete(cd.key); else n.add(cd.key); return n })}>{f.caption}</div>}
            </section>
          })}
          {/* panels behind the page's claims but not cited in its text: collapsed when the page cites figures itself */}
          {hidden > 0 && <button className={css.rdMore} onClick={() => setMore(true)}>另有 {hidden} 个面板支撑本页陈述的分论点 ▸</button>}
          {more && cards.some(x => !x.cited) && <button className={css.rdMore} onClick={() => setMore(false)}>收起</button>}
        </>}
        {side === 'para' && <div className={css.rdParaSide}>
          {!curPara && <div className={css.rdEmpty}>点一下左边的段落，这里显示它陈述的分论点和意见；选中文字可以写意见。</div>}
          {curPara && <>
            {draftTarget && draftTarget.id === cur && <CommentBox target={draftTarget} author={actions.user.name}
              placeholder={`针对“${draftTarget.quote.slice(0, 30)}…”`}
              onSave={async (t, text) => { await actions.comment(t, text); setDraftTarget(null) }}
              {...(actions.user.role === 'author' ? { onSaveAndAsk: async (t: Target, text: string) => { await onAskComment(t, text); setDraftTarget(null) } } : {})} />}
            <div className={css.k}>这段陈述的分论点</div>
            <div className={css.row}>{curPara.claims.length ? curPara.claims.map(cid => <button key={cid} className={css.chip} onClick={() => onFocus({ kind: 'claim', id: cid })}>
              {cid} {p.claims.find(c => c.id === cid)?.title.slice(0, 18)}</button>) : <span className={css.muted}>没有（方法细节、背景等）</span>}</div>
            <div className={css.k}>这段的意见（{curComments.length}）</div>
            {curComments.map(c => <CommentCard key={c.id} c={c} {...(actions.user.role === 'author' ? { onAssign: (a: string) => void actions.assign(c.id, a) } : {})} view={view} onGo={onFocus} canDecide={actions.user.role === 'author'} onStatus={s => void actions.setComment(c.id, s)} />)}
            {!draftTarget && <div className={css.muted}>在正文中选中文字，可以针对那句话写意见。</div>}
          </>}
        </div>}
      </aside>
    </div>
    {toc && <div className={css.rdToc} role="dialog">
      <h2>目录</h2>
      {pages.map((pg, i) => <Fragment key={i}>
        {pg.heads.some(h => h.level === 2) && <div className={css.rdTocSec}>{pg.heads.find(h => h.level === 2)!.text}</div>}
        <button className={cx(css.rdTocItem, i === at && css.rdTocCur)} onClick={() => { go(i); setToc(false) }}>
          <span>{i + 1}</span>{pg.heads.length ? (pg.subsection || pg.chunks[0]?.text.slice(0, 48) || pg.section) : `${pg.subsection || pg.section}（续）`}</button>
      </Fragment>)}
    </div>}
    {sel && <button className={css.selBtn} style={{ left: sel.x, top: sel.y - 36 }} onMouseDown={e => e.preventDefault()}
      onClick={() => { setCur(sel.paragraph); setSide('para'); setDraftTarget({ kind: 'paragraph', id: sel.paragraph, quote: sel.quote }); setSel(null); window.getSelection()?.removeAllRanges() }}>✎ 写意见</button>}
    {zoom && <div className={css.rdLb} onClick={() => setZoom(null)} role="dialog">
      {zoom.whole && <div className={css.rdLbTools}><button className={css.btn} onClick={e => { e.stopPropagation(); setZoom({ src: zoom.whole!, cap: zoom.cap }) }}>看整张图</button></div>}
      <AssetImg actions={actions} path={zoom.src} alt="" />
      <div className={css.rdLbCap}>{zoom.cap}</div>
    </div>}
  </div>
}
