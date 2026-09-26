/** Manuscript-scoped find without changing React-owned Markdown or persisted highlights. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { BibliographyView, PaperBlock } from '../schema.ts'
import { displayCitations } from './citation-display.ts'
import { rangesForChangedSpans, renderedPlainText } from './rendered-diff.tsx'
import { scrollPaperTarget } from './reader-scroll.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

/** Rendered searchable text, with an optional always-mounted lazy-content target. */
export type SearchableBlock = { id: string; text: string; targetId?: string }
type FindHit = { blockId: string; occurrence: number }
const MAX_HITS = 2000

/** Build a rendered-text index once per manuscript revision, excluding hidden source notes.
 * @param blocks - reader-visible manuscript blocks.
 * @param bibliography - citation labels shown in the reader.
 * @returns searchable text in reading order.
 */
export function searchableBlocks(blocks: PaperBlock[], bibliography?: BibliographyView): SearchableBlock[] {
  return blocks.filter(block => !(block.kind === 'html' && /^\s*<!--/.test(block.text))).map((block) => {
    const displayed = block.kind === 'code' || block.kind === 'html'
      ? block.text : displayCitations(block.text, bibliography?.entries ?? [])
    return { id: block.id, text: renderedPlainText(displayed) ?? displayed }
  })
}

/** Locate literal, case-insensitive occurrences without parsing the document on every keystroke.
 * @param blocks - prepared reader text.
 * @param query - operator's search text.
 * @returns bounded matches in reading order.
 */
export function findPaperHits(blocks: SearchableBlock[], query: string): FindHit[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const hits: FindHit[] = []
  for (const block of blocks) {
    const text = block.text.toLocaleLowerCase()
    let occurrence = 0
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      hits.push({ blockId: block.id, occurrence: occurrence++ })
      if (hits.length >= MAX_HITS) return hits
    }
  }
  return hits
}

/** Search the fixed manuscript and paint only mounted matches with CSS Highlights.
 * @param props - manuscript, panel focus scope, viewport and localized controls.
 * @returns a temporary search bar when opened from this pane.
 */
export function PaperFind({ panel, content, blocks, bibliography, mode, onRead, onNavigate, entries, onTarget, t }: {
  panel: RefObject<HTMLElement>
  content: RefObject<HTMLElement>
  blocks: PaperBlock[]
  bibliography?: BibliographyView | undefined
  mode: string
  onRead: () => void
  /** Release a pending reader-position correction before search takes over scrolling. */
  onNavigate?: (() => void) | undefined
  /** Current view's text; supplied entries keep search in that view instead of opening Read. */
  entries?: SearchableBlock[] | (() => SearchableBlock[]) | undefined
  /** Reveal a paginated entry before its DOM is present. */
  onTarget?: ((id: string) => void) | undefined
  t: (key: PaperReviewKey) => string
}): ReactNode {
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const name = `paper-find-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const indexed = useMemo(() => open ? typeof entries === 'function' ? entries()
    : entries ?? searchableBlocks(blocks, bibliography) : [], [blocks, bibliography, entries, open])
  const hits = useMemo(() => findPaperHits(indexed, query), [indexed, query])
  const current = hits[Math.min(active, hits.length - 1)]
  const pendingScroll = useRef(false)

  useEffect(() => {
    let pointerInside = false
    const pointer = (event: PointerEvent): void => { pointerInside = Boolean(panel.current?.contains(event.target as Node)) }
    const key = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'f' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const root = panel.current
      const focused = document.activeElement
      if (!root || root.getClientRects().length === 0 || !(root.contains(focused) || (focused === document.body && pointerInside))) return
      if (focused instanceof HTMLElement && focused !== input.current
        && (focused.matches('input, textarea, select, [contenteditable="true"]') || focused.closest('[contenteditable="true"]'))) return
      event.preventDefault(); event.stopPropagation()
      if (!entries && mode !== 'read') onRead()
      setOpen(true)
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
    }
    window.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', key, true) }
  }, [panel, mode, onRead, entries])

  useEffect(() => { setActive(0) }, [mode])

  useEffect(() => {
    if (!open || (!entries && mode !== 'read') || !current) return
    pendingScroll.current = true
    onTarget?.(current.blockId)
    const frame = requestAnimationFrame(() => {
      if (!pendingScroll.current) return
      onNavigate?.()
      const viewport = content.current
      const targetId = indexed.find(entry => entry.id === current.blockId)?.targetId ?? current.blockId
      const block = viewport?.querySelector<HTMLElement>(`[data-find-id="${CSS.escape(targetId)}"], [data-block="${CSS.escape(targetId)}"]`)
      if (viewport && block) scrollPaperTarget(viewport, block)
    })
    return () => { cancelAnimationFrame(frame) }
  }, [active, content, current, indexed, mode, open, onNavigate, onTarget, entries])

  useEffect(() => {
    const viewport = content.current
    if (!open || (!entries && mode !== 'read') || !query.trim() || !viewport || typeof Highlight === 'undefined') return
    const allName = `${name}-all`, activeName = `${name}-active`
    const byBlock = new Map<string, number[]>()
    hits.forEach((hit, index) => byBlock.set(hit.blockId, [...(byBlock.get(hit.blockId) ?? []), index]))
    let frame = 0
    const paint = (): void => {
      CSS.highlights.delete(allName); CSS.highlights.delete(activeName)
      const all: Range[] = [], selected: Range[] = []
      const needle = query.trim().toLocaleLowerCase()
      for (const [blockId, indexes] of byBlock) {
        const target = viewport.querySelector<HTMLElement>(`[data-find-id="${CSS.escape(blockId)}"], [data-block="${CSS.escape(blockId)}"]`)
        const root = target?.querySelector<HTMLElement>('[data-rendered-diff], [data-reader-text], [data-find-text]') ?? target
        if (!root || root.querySelector('[data-reader-placeholder], [data-diff-placeholder]')) continue
        const text = root.textContent.toLocaleLowerCase()
        const spans: { offset: number; length: number }[] = []
        for (let at = text.indexOf(needle); at >= 0 && spans.length < indexes.length;
          at = text.indexOf(needle, at + needle.length)) spans.push({ offset: at, length: needle.length })
        const ranges = rangesForChangedSpans(root, spans)
        ranges.forEach((range, occurrence) => {
          all.push(range)
          if (indexes[occurrence] === active) selected.push(range)
        })
      }
      if (all.length) CSS.highlights.set(allName, new Highlight(...all))
      if (selected.length) {
        const highlight = new Highlight(...selected)
        highlight.priority = 2
        CSS.highlights.set(activeName, highlight)
        if (pendingScroll.current) {
          onNavigate?.()
          if (selected[0] && typeof selected[0].getBoundingClientRect === 'function') scrollPaperTarget(viewport, selected[0])
          pendingScroll.current = false
        }
      }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint() }) }
    const observer = new MutationObserver(schedule)
    observer.observe(viewport, { childList: true, subtree: true })
    paint()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      CSS.highlights.delete(allName); CSS.highlights.delete(activeName)
    }
  }, [active, content, hits, mode, name, open, query, onNavigate, entries])

  if (!open || (!entries && mode !== 'read')) return null
  const move = (step: number): void => { if (hits.length) setActive(index => (index + step + hits.length) % hits.length) }
  const close = (): void => { setOpen(false); panel.current?.focus() }
  const highlightCSS = [
    `::highlight(${name}-all){background:var(--paper-find-bg);color:var(--paper-find-text)}`,
    `::highlight(${name}-active){background:var(--paper-find-active-bg);color:var(--paper-find-active-text)}`,
  ].join('')
  return <div className={css.findAnchor}><style>{highlightCSS}</style><div className={css.findBar} role="search" aria-label={t('find')}>
    <input ref={input} type="search" aria-label={t('find')} placeholder={t('findHint')} value={query}
      onChange={(event) => { setQuery(event.target.value); setActive(0) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1) }
        if (event.key === 'Escape') { event.preventDefault(); close() }
      }} />
    <span className={css.findCount} role="status">{query.trim() ? hits.length
      ? `${Math.min(active, hits.length - 1) + 1}/${hits.length}${hits.length === MAX_HITS ? '+' : ''}` : t('findNone') : ''}</span>
    <button type="button" aria-label={t('findPrevious')} title={t('findPrevious')} disabled={!hits.length} onClick={() => { move(-1) }}>↑</button>
    <button type="button" aria-label={t('findNext')} title={t('findNext')} disabled={!hits.length} onClick={() => { move(1) }}>↓</button>
    {entries && mode !== 'read' && <button type="button" title={t('findInArticle')} aria-label={t('findInArticle')} onClick={onRead}>¶</button>}
    <button type="button" aria-label={t('findClose')} title={t('findClose')} onClick={close}>×</button>
  </div></div>
}
