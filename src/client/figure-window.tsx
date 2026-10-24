/** Nonmodal artwork: a delayed peek grows into a movable window without reflowing prose. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { FigureMedia } from './figure-preview.tsx'
import type { ReadingFigure } from './reading-figures.ts'
import type { PaperReviewKey } from './locales.ts'
import { PaperIcon } from './icons.tsx'
import css from './reading.module.css'

export interface FigureWindowRect { x: number; y: number; width: number; height: number }
export interface FigureWindowBounds { width: number; height: number; top?: number }
export interface FigureAnchor { x: number; y: number; width: number; height: number }
export type FigureResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
const resizeEdges: FigureResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const edgeNames: Record<FigureResizeEdge, PaperReviewKey> = { n: 'figureEdgeTop', ne: 'figureEdgeTopRight', e: 'figureEdgeRight', se: 'figureEdgeBottomRight', s: 'figureEdgeBottom', sw: 'figureEdgeBottomLeft', w: 'figureEdgeLeft', nw: 'figureEdgeTopLeft' }
export function fitFigureWindow(rect: FigureWindowRect, bounds: FigureWindowBounds): FigureWindowRect {
  const minY = Math.max(8, Math.min(bounds.height - 16, (bounds.top ?? 0) + 8))
  const maxWidth = Math.max(1, bounds.width - 16), maxHeight = Math.max(1, bounds.height - minY - 8)
  const width = Math.min(maxWidth, Math.max(Math.min(300, maxWidth), rect.width))
  const height = Math.min(maxHeight, Math.max(Math.min(240, maxHeight), rect.height))
  return { width, height, x: Math.max(8, Math.min(bounds.width - width - 8, rect.x)), y: Math.max(minY, Math.min(bounds.height - height - 8, rect.y)) }
}
/** Resize around the opposite edge so hitting a limit never moves the whole window. */
export function resizeFigureWindow(rect: FigureWindowRect, bounds: FigureWindowBounds, edge: FigureResizeEdge, dx: number, dy: number): FigureWindowRect {
  const start = fitFigureWindow(rect, bounds), minimum = fitFigureWindow({ ...start, width: 0, height: 0 }, bounds)
  const minY = Math.max(8, Math.min(bounds.height - 16, (bounds.top ?? 0) + 8))
  const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))
  let left = start.x, right = start.x + start.width, top = start.y, bottom = start.y + start.height
  if (edge.includes('w')) left = clamp(left + dx, 8, right - minimum.width)
  if (edge.includes('e')) right = clamp(right + dx, left + minimum.width, bounds.width - 8)
  if (edge.includes('n')) top = clamp(top + dy, minY, bottom - minimum.height)
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minimum.height, bounds.height - 8)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export function initialFigureWindow(bounds: FigureWindowBounds, anchor?: FigureAnchor, preview = false, size?: Pick<FigureWindowRect, 'width' | 'height'>): FigureWindowRect {
  const width = Math.min(size?.width ?? (preview ? 430 : 660), bounds.width - 24)
  let height = Math.min(size?.height ?? (preview ? 310 : 520), bounds.height - 24)
  const beside = Boolean(anchor && anchor.x + anchor.width + width + 20 < bounds.width)
  const x = beside ? anchor!.x + anchor!.width + 10 : bounds.width - width - 12
  let y = bounds.height - height - 12
  if (anchor) {
    const below = bounds.height - anchor.y - anchor.height - 22, above = anchor.y - 22
    if (beside) y = anchor.y
    else if (Math.max(below, above) >= 240) {
      if (!size) height = Math.min(height, Math.max(below, above))
      y = below >= above ? anchor.y + anchor.height + 10 : anchor.y - height - 10
    } else y = anchor.y - height - 10
  }
  return fitFigureWindow({ x, y, width, height }, bounds)
}

export function FigureWindow({ id, preview, anchor, bounds, saved, onChange, onClose, onDock, onOpen, onEnter, onLeave, label, t, children }: {
  id: string; preview: boolean; anchor?: FigureAnchor | undefined; bounds: FigureWindowBounds; saved?: FigureWindowRect | undefined
  onChange: (rect: FigureWindowRect) => void; onClose: () => void; onDock: () => void; onOpen: () => void
  onEnter: () => void; onLeave: () => void; label: string; t: (key: PaperReviewKey) => string; children: ReactNode
}): ReactNode {
  const [rect, setRect] = useState(() => preview ? initialFigureWindow(bounds, anchor, true, saved) : fitFigureWindow(saved ?? initialFigureWindow(bounds, anchor), bounds))
  const node = useRef<HTMLElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; rect: FigureWindowRect; edge?: FigureResizeEdge | undefined }>()
  const current = useRef(rect); current.current = rect
  const commit = useRef(onChange); commit.current = onChange
  useLayoutEffect(() => {
    const next = preview ? initialFigureWindow(bounds, anchor, true, saved) : fitFigureWindow(current.current, bounds)
    setRect(next)
  }, [bounds.width, bounds.height, bounds.top, preview, anchor?.x, anchor?.y])
  useEffect(() => {
    if (preview) return
    if (!drag.current) node.current?.querySelector<HTMLElement>('[data-window-move]')?.focus({ preventScroll: true })
    return () => { commit.current(current.current) }
  }, [preview])
  useEffect(() => {
    if (preview) return
    const timer = setTimeout(() => { commit.current(current.current) }, 180)
    return () => { clearTimeout(timer) }
  }, [rect, preview])
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return
      event.preventDefault(); event.stopPropagation(); onClose()
    }
    const outside = (event: PointerEvent): void => {
      if (preview && event.target instanceof Node && !node.current?.contains(event.target)) onClose()
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside) }
  }, [preview, onClose])
  const pointer = (edge?: FigureResizeEdge) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      if (event.button !== 0 || drag.current) return
      event.preventDefault(); drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: current.current, edge }
      event.currentTarget.setPointerCapture(event.pointerId)
      // The same component and pointer-capture target survive promotion from a peek.
      if (preview) onOpen()
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
      const start = drag.current
      if (!start || start.id !== event.pointerId) return
      const dx = event.clientX - start.x, dy = event.clientY - start.y
      setRect(start.edge ? resizeFigureWindow(start.rect, bounds, start.edge, dx, dy)
        : fitFigureWindow({ ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }, bounds))
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
      if (drag.current?.id !== event.pointerId) return
      drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      commit.current(current.current)
    },
    onPointerCancel: (): void => { if (drag.current) commit.current(current.current); drag.current = undefined },
    onLostPointerCapture: (): void => { if (drag.current) commit.current(current.current); drag.current = undefined },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>): void => {
      const step = event.shiftKey ? 5 : 20
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      if (!dx && !dy) return
      event.preventDefault()
      if (preview) onOpen()
      setRect(edge ? resizeFigureWindow(rect, bounds, edge, dx, dy) : fitFigureWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds))
    },
  })
  return <section ref={node} id={id} className={css.figureWindow} data-figure-window={preview ? 'preview' : 'floating'}
    role="dialog" aria-modal="false" aria-label={`${t(preview ? 'figurePreview' : 'figureFloating')} · ${label}`}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerEnter={onEnter} onPointerLeave={onLeave}
    onFocusCapture={onEnter} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLeave() }}>
    <header className={css.windowHeading}>
      <div className={css.windowTitle} data-window-move tabIndex={0} role="button"
        aria-label={t('moveFigureWindow')} title={t('figureWindowHint')} {...pointer()}>
        <PaperIcon kind="image" size={14} /><strong>{label}</strong><span>{t(preview ? 'figurePreview' : 'figureFloating')}</span>
      </div>
      {preview && <button aria-label={t('openFloatingFigure')} title={t('openFloatingFigure')} onClick={onOpen}><PaperIcon kind="float" size={14} /></button>}
      <button aria-label={t('dockFigure')} title={t('dockFigure')} onClick={onDock}><PaperIcon kind="dock" size={14} /></button>
      <button aria-label={t('closeFloatingFigure')} title={t('closeFloatingFigure')} onClick={onClose}><PaperIcon kind="close" size={14} /></button>
    </header>
    {children}
    {resizeEdges.map(edge => <button key={edge} className={css.windowResize} data-window-resize={edge} tabIndex={edge === 'se' ? 0 : -1}
      aria-label={edge === 'se' ? t('resizeFigureWindow') : `${t('resizeFigureWindow')} · ${t(edgeNames[edge])}`}
      title={t('figureWindowHint')} {...pointer(edge)}>{edge === 'se' && <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 10 10 3M7 10l3-3" stroke="currentColor" fill="none" /></svg>}</button>)}
  </section>
}

/** Peeks fetch only the selected artwork and never mount a modal or take keyboard focus. */
export function FigurePeek({ item, media, fullPage, onOpen, t }: { item: ReadingFigure; media: FigureMedia; fullPage: FigureMedia['thumbnail']; onOpen: () => void; t: (key: PaperReviewKey) => string }): ReactNode {
  const [result, setResult] = useState<{ file: string; url?: string; failed?: boolean }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, media.signal])
    let owned: string | undefined
    void (async () => {
      try {
        let url: string | undefined
        if (/\.pdf$/i.test(item.file)) url = await fullPage(item.file, signal, media.sessionId)
        else {
          const bytes = await media.bytes(item.file, signal, media.sessionId)
          if (signal.aborted) return
          const suffix = item.file.split('.').at(-1)?.toLowerCase()
          url = owned = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: suffix === 'svg' ? 'image/svg+xml' : suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : `image/${suffix}` }))
        }
        if (!signal.aborted) setResult({ file: item.file, ...(url ? { url } : { failed: true }) })
      } catch { if (!signal.aborted) setResult({ file: item.file, failed: true }) }
    })()
    return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned) }
  }, [item.file, media, fullPage, attempt])
  const shown = result?.file === item.file ? result : undefined
  return <>
    {shown?.url ? <button className={css.peekImage} aria-label={t('openFloatingFigure')} onClick={onOpen}><img src={shown.url} alt={item.figure.label} draggable={false} /></button>
      : <div className={css.peekLoading} role="status">{t(shown?.failed ? 'figureOpenFailed' : 'loading')}{shown?.failed && <button onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>}</div>}
    <div className={css.peekFooter}>{t('figurePeekHint')}<button onClick={onOpen}>{t('openFloatingFigure')} <span aria-hidden="true">↗</span></button></div>
  </>
}
