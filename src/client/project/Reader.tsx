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
import { AssetImg, CommentBox, CommentCard, Empty, claimNo, cx, readableDiff } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import { CHANGE_LABEL, useComparison, RemovedHere } from './compare.tsx'
import type { ParaChange } from './compare.tsx'
import css from './project.module.css'

interface Sel { paragraph: string, quote: string, x: number, y: number }
/** A private highlight of this reader, kept in this browser only. Text written on a highlight is a comment (sent to the
 * server); `note` only holds text from the earlier private notes until it has been handed in as a comment. */
interface Note { id: string, paragraph: string, quote: string, color: string, note: string }
interface Menu { x: number, y: number, paragraph: string, quote: string, note: string | null }
const HL: Record<string, string> = { yellow: 'rgba(255, 214, 51, .5)', green: 'rgba(110, 214, 140, .45)', pink: 'rgba(255, 140, 180, .45)', blue: 'rgba(110, 175, 255, .45)' }
const HL_NAME: Record<string, string> = { yellow: '黄', green: '绿', pink: '粉', blue: '蓝' }
interface Card { key: string, figure: string, panel: string | null, cited: boolean }

/** Where the current text differs from the baseline: added ranges of the current text, and removed text with the place it stood. */
interface ParaDiff { adds: Array<[number, number]>, dels: Array<{ at: number, text: string }> }
function paraDiff(before: string, after: string): ParaDiff {
  const d: ParaDiff = { adds: [], dels: [] }
  let i = 0
  for (const part of readableDiff(before, after)) {
    if (part.removed) { if (part.value.trim()) d.dels.push({ at: i, text: part.value }); continue }
    if (part.added && part.value.trim()) d.adds.push([i, i + part.value.length])
    i += part.value.length
  }
  return d
}

const stored = (k: string, d: string): string => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const store = (k: string, v: string): void => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function Reader({ view, actions, start, onFocus, onAskComment }: {
  view: ProjectView, actions: ProjectActions, start: string, onFocus: (f: Focus) => void,
  onAskComment: (t: Target, text: string) => Promise<void>,
}): ReactNode {
  const p = view.project
  const pages = useMemo(() => paginate(p), [p])
  const cmp = useComparison(view, actions)
  const pageKey = `paper-read-page:${p.title}`
  const [at, setAt] = useState(() => Math.min(Number(stored(pageKey, '0')) || 0, Math.max(0, pages.length - 1)))
  const [fs, setFs] = useState(() => Number(stored('paper-read-fs', '18')) || 18)
  const [toc, setToc] = useState(false)
  const [marks, setMarks] = useState(() => stored('paper-read-diff', '1') === '1')
  const [side, setSide] = useState<'figs' | 'para'>('figs')
  const [cur, setCur] = useState('')
  const [sel, setSel] = useState<Sel | null>(null)
  const [draftTarget, setDraftTarget] = useState<Target | null>(null)
  const [hover, setHover] = useState('')
  const [flash, setFlash] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [inline, setInline] = useState<Set<string>>(new Set())
  const notesKey = `paper-read-notes:${p.title}`
  const [notes, setNotes] = useState<Note[]>(() => { try { return JSON.parse(stored(notesKey, '[]')) as Note[] } catch { return [] } })
  const [menu, setMenu] = useState<Menu | null>(null)
  const saveNotes = (next: Note[]): void => { setNotes(next); store(notesKey, JSON.stringify(next)) }
  // notes and comments are one thing: text of the earlier private notes is handed in as comments, once
  const migrating = useRef(false)
  useEffect(() => {
    const old = notes.filter(n => n.note.trim())
    if (!old.length || migrating.current) return
    migrating.current = true
    saveNotes(notes.map(n => ({ ...n, note: '' })))
    void (async () => {
      const failed: Note[] = []
      for (const n of old) { try { await actions.comment({ kind: 'paragraph', id: n.paragraph, quote: n.quote }, n.note.trim()) } catch { failed.push(n) } }
      if (failed.length) { const cur = JSON.parse(stored(notesKey, '[]')) as Note[]; saveNotes(cur.map(x => failed.find(f => f.id === x.id) ?? x)); migrating.current = false }
    })()
  }, [])
  const [zoom, setZoom] = useState<{ src: string, cap: string, whole?: string } | null>(null)
  const textCol = useRef<HTMLDivElement>(null)
  const confirmPage = useRef<() => void>(() => undefined)
  const cardEls = useRef(new Map<string, HTMLElement>())
  const figs = useMemo(() => new Map(p.figures.map(f => [f.id, f])), [p.figures])
  const paraText = useMemo(() => new Map(p.sections.flatMap(s => s.paragraphs).map(x => [x.id, x.text])), [p.sections])
  const diffs = useMemo(() => new Map<string, ParaDiff>(), [cmp])

  const go = (i: number): void => {
    const n = Math.max(0, Math.min(pages.length - 1, i))
    setAt(n); store(pageKey, String(n)); setSel(null); setMore(false); setMenu(null)
    if (n !== at) { setCur(''); setDraftTarget(null) }
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
      else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) confirmPage.current()
      else if (e.key === 'Escape') { setToc(false); setZoom(null); setMenu(null) }
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
  // a page that cites nothing shows whole figures, main-text figures first, not single panels
  const whole: Card[] = []
  if (!cited.length) for (const main of [true, false]) for (const c of behind) {
    const f = figs.get(c.figure)
    if (!f || (f.placement === 'main') !== main || whole.some(x => x.figure === c.figure)) continue
    whole.push({ key: `${c.figure}/`, figure: c.figure, panel: null, cited: false })
  }
  const shown = more ? cards : cited.length ? cited : whole.slice(0, 4)
  const hidden = more ? 0 : cited.length ? cards.length - shown.length : cards.filter(c => !shown.some(x => x.key === c.key)).length
  // a paragraph the author approved at this revision shows no marks under the automatic baseline; an explicit baseline shows everything
  const approved = (id: string): boolean => cmp.choice === 'auto' && view.status[`paragraph:${id}`] === 'reviewed'
  const changeOf = (id: string): ParaChange | undefined => { const k = cmp.kind(id); return k && k !== 'same' && !approved(id) ? k : undefined }
  const pageChanges = (pg: typeof pages[number]): number => new Set(pg.chunks.map(c => c.paragraph).filter(id => changeOf(id))).size
  const liveOf = (id: string): typeof view.comments => view.comments.filter(c => c.target.kind === 'paragraph' && c.target.id === id && (c.status === 'open' || c.status === 'answered'))
  const openCount = (id: string): number => liveOf(id).length
  const pageLive = [...new Set(page.chunks.map(c => c.paragraph))].flatMap(id => liveOf(id))
  // a heavily rewritten paragraph shows the old text above the clean new text; inline marks on request
  const showOld = (id: string): boolean => marks && changeOf(id) === 'rewritten' && cmp.before(id) !== undefined && !inline.has(id)
  const notesOf = (id: string): Note[] => notes.filter(n => n.paragraph === id)
  const pageNotes = [...new Set(page.chunks.map(c => c.paragraph))].flatMap(id => notesOf(id))
  const place = (x: number, y: number, w: number, h: number): { left: number, top: number } => ({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) })
  const addNote = (paragraph: string, quote: string, color: string): void => {
    const n: Note = { id: `n${Date.now().toString(36)}`, paragraph, quote, color, note: '' }
    saveNotes([...notes.filter(x => !(x.paragraph === paragraph && x.quote === quote)), n])
    window.getSelection()?.removeAllRanges(); setSel(null); setMenu(null)
  }
  const patchNote = (id: string, patch: Partial<Note>): void => saveNotes(notes.map(n => n.id === id ? { ...n, ...patch } : n))
  const selectionIn = (): { paragraph: string, quote: string } | null => {
    const s = window.getSelection(), q = s?.toString().trim() ?? ''
    if (!s || !q || s.rangeCount === 0) return null
    const host = (s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement)?.closest('[data-para]')
    const end = (s.focusNode instanceof Element ? s.focusNode : s.focusNode?.parentElement)?.closest('[data-para]')
    return host && host === end ? { paragraph: host.getAttribute('data-para')!, quote: q.slice(0, 600) } : null
  }
  /** Right click in the text: on a selection, highlight / note / comment; on a highlight, change or remove it; on a paragraph, comment on it. */
  const onContext = (e: { target: EventTarget, clientX: number, clientY: number, preventDefault: () => void }): void => {
    const el = e.target as HTMLElement
    const paragraph = el.closest('[data-para]')?.getAttribute('data-para')
    if (!paragraph) return
    const s = selectionIn(), hl = el.closest('[data-note]')?.getAttribute('data-note') ?? null
    e.preventDefault(); setSel(null)
    setMenu({ x: e.clientX, y: e.clientY, paragraph: s?.paragraph ?? paragraph, quote: s?.quote ?? '', note: s ? null : hl })
  }
  const annotate = (id: string, quote = ''): void => { setCur(id); setSide('para'); setDraftTarget({ kind: 'paragraph', id, quote }) }
  // review state of the page: the reader confirms a whole page with one click or key, then moves on
  const author = actions.user.role === 'author'
  const keysOf = (pg: typeof pages[number]): string[] => [...new Set(pg.chunks.map(c => `paragraph:${c.paragraph}`))]
  const todoOf = (pg: typeof pages[number]): string[] => keysOf(pg).filter(k => view.status[k] !== 'reviewed')
  const pageKeys = keysOf(page), pageTodo = todoOf(page)
  confirmPage.current = (): void => {
    if (!author) return
    if (pageTodo.length) void actions.confirm(pageTodo)
    if (at < pages.length - 1) go(at + 1)
  }
  const curPara = p.sections.flatMap(s => s.paragraphs).find(x => x.id === cur)
  const curComments = view.comments.filter(c => c.target.kind === 'paragraph' && c.target.id === cur)

  const jump = (key: string): void => {
    setSide('figs')
    requestAnimationFrame(() => {
      cardEls.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFlash(key); setTimeout(() => setFlash(''), 1100)
    })
  }
  /** The added ranges and removed pieces of the baseline that fall inside this chunk, in the chunk's own offsets. */
  const diffOf = (c: Chunk): ParaDiff | undefined => {
    const k = marks && !approved(c.paragraph) && !showOld(c.paragraph) ? cmp.kind(c.paragraph) : undefined
    const before = cmp.before(c.paragraph), full = paraText.get(c.paragraph)
    if ((k !== 'edited' && k !== 'rewritten') || before === undefined || full === undefined) return undefined
    const off = c.part === 0 ? 0 : full.indexOf(c.text)
    if (off < 0) return undefined
    let d = diffs.get(c.paragraph)
    if (!d) { d = paraDiff(before, full); diffs.set(c.paragraph, d) }
    const end = off + c.text.length, last = end >= full.trimEnd().length
    return {
      adds: d.adds.filter(([a, b]) => b > off && a < end).map(([a, b]) => [Math.max(a, off) - off, Math.min(b, end) - off]),
      dels: d.dels.filter(x => x.at >= off && (x.at < end || last)).map(x => ({ at: Math.min(x.at, end) - off, text: x.text })),
    }
  }
  const render = (c: Chunk): ReactNode => {
    const refs = refsOf(c), d = diffOf(c)
    // the sentences that open comments quote are highlighted in the text
    const quotes = liveOf(c.paragraph).flatMap(cm => { const q = cm.target.quote, s = q ? c.text.indexOf(q) : -1; return s >= 0 ? [[s, s + q.length] as [number, number]] : [] })
    const hls = notesOf(c.paragraph).flatMap(n => { const s = c.text.indexOf(n.quote); return s >= 0 ? [{ s, e: s + n.quote.length, n }] : [] })
    if (!refs.length && !d && !quotes.length && !hls.length) return c.text
    const cuts = [...new Set([0, c.text.length, ...refs.flatMap(r => [r.start, r.end]), ...quotes.flat(), ...hls.flatMap(h => [h.s, h.e]), ...(d?.adds.flat() ?? []), ...(d?.dels.map(x => x.at) ?? [])])]
      .filter(x => x >= 0 && x <= c.text.length).sort((a, b) => a - b)
    const out: ReactNode[] = []
    const gone = (at: number): void => { d?.dels.forEach((x, k) => { if (x.at === at) out.push(<del key={`d${at}-${k}`}>{x.text}</del>) }) }
    for (let n = 0; n + 1 < cuts.length; n++) {
      const a = cuts[n]!, b = cuts[n + 1]!
      gone(a)
      let node: ReactNode = c.text.slice(a, b)
      const r = refs.find(x => x.start <= a && b <= x.end)
      if (r) {
        const key = `${r.figure}/${r.panel ?? ''}`
        node = <a className={cx(css.rdRef, hover === key && css.rdRefOn)} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover('')}
          onClick={e => { e.stopPropagation(); jump(key) }}>{node}</a>
      }
      if (quotes.some(([s, e]) => s <= a && b <= e)) node = <mark className={css.rdQuote} title="这句话有批注：点击查看" onClick={e => { e.stopPropagation(); setCur(c.paragraph); setSide('para') }}>{node}</mark>
      const h = hls.find(x => x.s <= a && b <= x.e)
      if (h) node = <mark data-note={h.n.id} className={cx(css.rdHl, h.n.note && css.rdHlNote)} style={{ background: HL[h.n.color] ?? HL.yellow }} title="右键：换颜色、写意见、删除">{node}</mark>
      out.push(d?.adds.some(([s, e]) => s <= a && b <= e) ? <ins key={n}>{node}</ins> : <Fragment key={n}>{node}</Fragment>)
    }
    gone(c.text.length)
    return d ? <span className={css.diff}>{out}</span> : out
  }
  const onMouseUp = (): void => {
    const s = selectionIn()
    if (!s) { setSel(null); return }
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    setSel({ ...s, x: r.left + r.width / 2, y: r.top })
  }
  const noteCard = (n: Note): ReactNode => <div key={n.id} className={css.noteCard} style={{ borderLeftColor: HL[n.color] ?? HL.yellow }} onClick={() => setCur(n.paragraph)}>
    <q>{n.quote.length > 140 ? `${n.quote.slice(0, 140)}…` : n.quote}</q>
    <div className={css.row}><button className={css.linkBtn} onClick={() => annotate(n.paragraph, n.quote)}>写意见</button>
      <button className={css.linkBtn} onClick={() => saveNotes(notes.filter(x => x.id !== n.id))}>删除高亮</button></div>
  </div>
  const fontSize = (d: number): void => { const v = Math.max(14, Math.min(24, fs + d)); setFs(v); store('paper-read-fs', String(v)) }
  const crumb = [page.section, page.subsection].filter(Boolean).join(' · ')
  const title = (i: number): string => { const pg = pages[i]!; return pg.subsection || pg.section || (pg.chunks[0]?.text.slice(0, 40) ?? '') }

  return <div className={css.rd}>
    <div className={css.rdBar}>
      <button className={css.btn} onClick={() => setToc(v => !v)} title="目录（T）">目录</button>
      <span className={css.rdCrumb}>{crumb}</span>
      {view.revision > 0 && <span className={css.rdCmp} title="左侧色条标出相对对照版本改过的段落；绿底是新增的字，红底划线是删去的字。“自动”下，你批准过的段落不再显示增删；想再看，选一个具体版本">对照
        <select value={cmp.choice} onChange={e => cmp.setChoice(e.target.value)}>
          <option value="auto">自动：上次审过 / 上次改动前</option>
          {view.history.filter(h => h.revision < view.revision).map(h => h.revision).filter((r, i, a) => a.indexOf(r) === i).sort((x, y) => y - x)
            .map(r => <option key={r} value={String(r)}>r{r}{r === 0 ? '（原投稿）' : r === view.revision - 1 ? '（上一版）' : ''}</option>)}
          <option value="off">不对照</option>
        </select></span>}
      {cmp.n !== undefined && <span className={css.rdCmp}>相对 r{cmp.n}：本页 {pageChanges(page)} 段{cmp.choice === 'auto' ? '改动待批准' : '有改动'}
        {pageChanges(page) > 0 && <><i className={css.rdChange_rewritten} />重写 <i className={css.rdChange_edited} />有修改 <i className={css.rdChange_new} />新增</>}
        <button className={css.btn} onClick={() => { store('paper-read-diff', marks ? '0' : '1'); setMarks(!marks) }} title="在正文里显示或隐藏增删的字">{marks ? '隐藏增删' : '显示增删'}</button></span>}
      <span className={css.grow} />
      {author && <span className={cx(css.rdRev, !pageTodo.length && css.rdRevDone)} title="本页段落里你确认已审的数目">{pageTodo.length ? `本页已审 ${pageKeys.length - pageTodo.length}/${pageKeys.length}` : '✓ 本页已审'}</span>}
      <button className={css.btn} disabled={at === 0} onClick={() => go(at - 1)} title="上一页（← / PageUp）">‹</button>
      <span className={css.rdPg}>{at + 1} / {pages.length}</span>
      <button className={css.btn} disabled={at === pages.length - 1} onClick={() => go(at + 1)} title="下一页（→ / PageDown）">›</button>
      <button className={css.btn} onClick={() => fontSize(-1)} title="字号小一点">A−</button>
      <button className={css.btn} onClick={() => fontSize(1)} title="字号大一点">A＋</button>
      <i className={css.rdProgress} style={{ width: `${((at + 1) / pages.length) * 100}%` }} />
    </div>
    <div className={css.rdMain}>
      <div className={css.rdTextCol} ref={textCol} onMouseUp={onMouseUp} onContextMenu={onContext} onScroll={() => { if (menu) setMenu(null) }}>
        <article key={at} className={css.rdText} style={{ fontSize: fs }}>
          {at === 0 && <h1 className={css.rdTitle}>{p.title}</h1>}
          {at > 0 && !page.heads.length && crumb && <div className={css.rdSec}>{crumb}</div>}
          {page.heads.map((h, i) => h.level === 2 ? <h2 key={i}>{h.text}</h2> : <h3 key={i}>{h.text}</h3>)}
          {page.chunks.map((c, i) => <Fragment key={`${c.paragraph}~${c.part}`}>
            {c.heads?.map((h, j) => h.level === 2 ? <h2 key={`h${j}`}>{h.text}</h2> : <h3 key={`h${j}`}>{h.text}</h3>)}
            {marks && c.part === 0 && <RemovedHere items={cmp.removedBefore(c.paragraph)} n={cmp.n} />}
            {showOld(c.paragraph) && page.chunks[i - 1]?.paragraph !== c.paragraph && <div className={css.dfDel} title={`r${cmp.n} 的这一段${c.part > 0 ? '（整段）' : ''}`}><p>{cmp.before(c.paragraph)}</p></div>}
            <p data-para={c.paragraph} className={cx(c.front ? css.rdFront : css.rdP, c.part > 0 && css.rdCont, cur === c.paragraph && css.rdPCur, changeOf(c.paragraph) && css[`rdChange_${changeOf(c.paragraph) === 'rewritten' && !showOld(c.paragraph) ? 'edited' : changeOf(c.paragraph)}`])}
              {...(changeOf(c.paragraph) ? { title: `${CHANGE_LABEL[changeOf(c.paragraph)!]}（相对 r${cmp.n}）` } : {})}
              onClick={() => setCur(c.paragraph)}>
              {render(c)}
              {c.part === 0 && openCount(c.paragraph) > 0 && <span className={css.rdBadge} title="这段有批注：点击查看" onClick={e => { e.stopPropagation(); setCur(c.paragraph); setSide('para') }}>{openCount(c.paragraph)}</span>}
            </p>
            {changeOf(c.paragraph) && page.chunks[i + 1]?.paragraph !== c.paragraph && <div className={cx(css.rdActs, css.rdActsOn)}>
              {marks && changeOf(c.paragraph) === 'rewritten' && cmp.before(c.paragraph) !== undefined && <button className={css.btnGhost} title="这段改动很大：默认像 diff 那样上面是删掉的旧段、下面是新段；也可以改成在行内标出增删"
                onClick={() => setInline(s => { const n = new Set(s); if (n.has(c.paragraph)) n.delete(c.paragraph); else n.add(c.paragraph); return n })}>{inline.has(c.paragraph) ? '整段对照' : '行内标记'}</button>}
              {author && changeOf(c.paragraph) && <button className={cx(css.btn, css.rdOk)} onClick={() => void actions.confirm([`paragraph:${c.paragraph}`])} title="把这一段记为已审；之后不再显示这段的增删，直到它再被修改">✓ 批准这段修改</button>}</div>}
          </Fragment>)}
          {marks && at === pages.length - 1 && <RemovedHere items={cmp.removedEnd} n={cmp.n} />}
        </article>
        <nav className={css.rdNav}>
          {at > 0 ? <button className={css.btn} onClick={() => go(at - 1)}>‹ {title(at - 1)}</button> : <span />}
          {author && pageTodo.length > 0
            ? <button className={cx(css.btn, css.rdConfirm)} onClick={() => confirmPage.current()} title="把本页的段落记为已审，并翻到下一页（快捷键 C）">✓ 本页已审，下一页 <kbd>C</kbd></button>
            : at < pages.length - 1 && <button className={css.btn} onClick={() => go(at + 1)}>{title(at + 1)} ›</button>}
        </nav>
      </div>
      <aside className={css.rdFigCol}>
        <div className={css.rdTabs}>
          <button className={cx(side === 'figs' && css.rdTabOn)} onClick={() => setSide('figs')}>本页的图（{cards.length}）</button>
          <button className={cx(side === 'para' && css.rdTabOn)} onClick={() => setSide('para')}>意见（{pageLive.length}）</button>
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
          {!curPara && <>
            <div className={css.rdEmpty}>在正文里选中文字，用浮出的工具条或右键：高亮、写意见。右键一段话可以对整段写意见。意见会交给 agent；高亮只是你自己的标记，存在这个浏览器里。</div>
            {pageLive.length > 0 && <div className={css.k}>本页的意见（{pageLive.length}）</div>}
            {pageLive.map(c => <div key={c.id} onClick={() => setCur(c.target.id)}><CommentCard c={c} view={view} onGo={onFocus} canDecide={author} onStatus={s => void actions.setComment(c.id, s)} /></div>)}
            {pageNotes.length > 0 && <div className={css.k}>本页我的高亮（{pageNotes.length}）</div>}
            {pageNotes.map(noteCard)}
          </>}
          {curPara && <>
            <div className={css.rdCurHead}><span>{curPara.text.slice(0, 46)}…</span><button className={css.linkBtn} onClick={() => { setCur(''); setDraftTarget(null) }}>看本页全部</button></div>
            {draftTarget?.id === cur && draftTarget.quote && <blockquote className={css.rdQ}>{draftTarget.quote}</blockquote>}
            {<CommentBox target={draftTarget?.id === cur ? draftTarget : { kind: 'paragraph', id: cur, quote: '' }} author={actions.user.name}
              placeholder={draftTarget?.id === cur && draftTarget.quote ? '针对上面选中的这句话写意见' : '对这一段写意见（想针对某句话，先在正文里选中它）'}
              onSave={async (t, text) => { await actions.comment(t, text); setDraftTarget(null) }}
              {...(actions.user.role === 'author' ? { onSaveAndAsk: async (t: Target, text: string) => { await onAskComment(t, text); setDraftTarget(null) } } : {})} />}
            <div className={css.k}>这段陈述的分论点</div>
            <div className={css.row}>{curPara.claims.length ? curPara.claims.map(cid => <button key={cid} className={css.chip} onClick={() => onFocus({ kind: 'claim', id: cid })}>
              {claimNo(view, cid)} {p.claims.find(c => c.id === cid)?.title.slice(0, 18)}</button>) : <span className={css.muted}>没有（方法细节、背景等）</span>}</div>
            <div className={css.k}>这段的意见（{curComments.length}）</div>
            {curComments.map(c => <CommentCard key={c.id} c={c} {...(actions.user.role === 'author' ? { onAssign: (a: string) => void actions.assign(c.id, a) } : {})} view={view} onGo={onFocus} canDecide={actions.user.role === 'author'} onStatus={s => void actions.setComment(c.id, s)} />)}
            {notesOf(cur).length > 0 && <div className={css.k}>这段我的高亮（{notesOf(cur).length}）</div>}
            {notesOf(cur).map(noteCard)}
          </>}
        </div>}
      </aside>
    </div>
    {toc && <div className={css.rdToc} role="dialog">
      <h2>目录</h2>
      {pages.map((pg, i) => <Fragment key={i}>
        {pg.heads.some(h => h.level === 2) && <div className={css.rdTocSec}>{pg.heads.find(h => h.level === 2)!.text}</div>}
        <button className={cx(css.rdTocItem, i === at && css.rdTocCur)} onClick={() => { go(i); setToc(false) }}>
          <span>{i + 1}</span>{author && <i className={cx(css.rdTocDot, !todoOf(pg).length && css.rdTocDotOk)} title={todoOf(pg).length ? `${todoOf(pg).length} 段未审或审后有修改` : '已审'} />}{pg.heads.length ? (pg.subsection || pg.chunks[0]?.text.slice(0, 48) || pg.section) : `${pg.subsection || pg.section}（续）`}</button>
      </Fragment>)}
    </div>}
    {sel && !menu && <div className={css.selBar} style={{ left: sel.x, top: sel.y - 40 }} onMouseDown={e => e.preventDefault()}>
      {Object.keys(HL).map(k => <button key={k} className={css.hlDot} style={{ background: HL[k] }} title={`${HL_NAME[k]}色高亮`} onClick={() => addNote(sel.paragraph, sel.quote, k)} />)}
      <button onClick={() => { annotate(sel.paragraph, sel.quote); setSel(null); window.getSelection()?.removeAllRanges() }} title="针对这句话写意见，可以交给 agent 修改">意见</button>
    </div>}
    {menu && <div className={css.ctxBack} onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }}>
      <div className={css.ctx} style={place(menu.x, menu.y, 220, 250)} onClick={e => e.stopPropagation()} role="menu">
        {menu.quote && <>
          <div className={css.ctxRow}><span>高亮</span>{Object.keys(HL).map(k => <button key={k} className={css.hlDot} style={{ background: HL[k] }} title={`${HL_NAME[k]}色`} onClick={() => addNote(menu.paragraph, menu.quote, k)} />)}</div>
          <button onClick={() => { annotate(menu.paragraph, menu.quote); setMenu(null); window.getSelection()?.removeAllRanges() }}>针对这句话写意见</button>
          <button onClick={() => { void navigator.clipboard?.writeText(menu.quote); setMenu(null) }}>复制</button>
        </>}
        {!menu.quote && menu.note && <>
          <div className={css.ctxRow}><span>换颜色</span>{Object.keys(HL).map(k => <button key={k} className={css.hlDot} style={{ background: HL[k] }} title={`${HL_NAME[k]}色`} onClick={() => { patchNote(menu.note!, { color: k }); setMenu(null) }} />)}</div>
          <button onClick={() => { annotate(menu.paragraph, notes.find(n => n.id === menu.note)?.quote ?? ''); setMenu(null) }}>针对这句话写意见</button>
          <button className={css.ctxDanger} onClick={() => { saveNotes(notes.filter(n => n.id !== menu.note)); setMenu(null) }}>删除高亮</button>
        </>}
        {!menu.quote && !menu.note && <>
          <button onClick={() => { annotate(menu.paragraph); setMenu(null) }}>对这一段写意见</button>
          <button onClick={() => { setCur(menu.paragraph); setSide('para'); setMenu(null) }}>看这一段的意见</button>
          <div className={css.ctxHint}>先选中文字再右键，可以高亮或针对这句话写意见</div>
        </>}
      </div></div>}
    {zoom && <div className={css.rdLb} onClick={() => setZoom(null)} role="dialog">
      {zoom.whole && <div className={css.rdLbTools}><button className={css.btn} onClick={e => { e.stopPropagation(); setZoom({ src: zoom.whole!, cap: zoom.cap }) }}>看整张图</button></div>}
      <AssetImg actions={actions} path={zoom.src} alt="" />
      <div className={css.rdLbCap}>{zoom.cap}</div>
    </div>}
  </div>
}
