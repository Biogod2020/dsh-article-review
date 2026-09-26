/** Compact figure navigator and zoomable, on-demand full-screen manuscript preview. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { figureFilePath } from './figures.ts'
import type { PaperFigure } from './figures.ts'
import css from './panel.module.css'
import viewerCss from './figure-gallery.module.css'

interface FigureGalleryProps {
  readonly showDock?: boolean
  readonly figures: PaperFigure[]
  readonly manuscript: string
  readonly base: string
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly thumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  readonly fullPage: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  readonly bytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>
  readonly selected: PaperFigure | undefined
  readonly onSelect: (figure?: PaperFigure) => void
  readonly onLocate: (figure: PaperFigure) => void
  readonly onNative: (figure: PaperFigure) => void
  readonly labels: {
    readonly figures: string
    readonly pdf: string
    readonly image: string
    readonly open: string
    readonly close: string
    readonly loading: string
    readonly failed: string
    readonly locate: string
    readonly native: string
    readonly expand: string
    readonly collapse: string
    readonly zoomIn: string
    readonly zoomOut: string
    readonly fit: string
    readonly actualSize: string
    readonly previous: string
    readonly next: string
    readonly retry: string
    readonly pdfPreview: string
    readonly panHint: string
  }
}

interface MediaCache {
  controller: AbortController
  thumbs: Map<string, string>
  pending: Map<string, Promise<string | undefined>>
  urls: Set<string>
  full?: { path: string; url: string }
}

function mediaType(path: string): string {
  const suffix = path.split('.').at(-1)?.toLowerCase()
  if (suffix === 'pdf') return 'application/pdf'
  if (suffix === 'svg') return 'image/svg+xml'
  if (suffix === 'jpg' || suffix === 'jpeg') return 'image/jpeg'
  if (suffix === 'gif') return 'image/gif'
  if (suffix === 'webp') return 'image/webp'
  return 'image/png'
}

function newCache(): MediaCache {
  return { controller: new AbortController(), thumbs: new Map(), pending: new Map(), urls: new Set() }
}

/**
 * Show an exact-file thumbnail dock and zoomable full-screen preview with cancellable reads.
 * @param props - Pinned figure references, localized controls and authenticated media readers.
 * @returns A reader-local dock and modal; PDF previews show page one with a native full-PDF action.
 */
export function FigureGallery(props: FigureGalleryProps): ReactNode {
  const { figures, manuscript, base, sessionId, signal, thumbnail, bytes, selected, onSelect, labels } = props
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const expanded = hovered || pinned
  const [focusIndex, setFocusIndex] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [failedThumbs, setFailedThumbs] = useState<ReadonlySet<string>>(new Set())
  const [viewer, setViewer] = useState<{ url?: string; failed: boolean }>({ failed: false })
  const [attempt, setAttempt] = useState(0)
  const [scale, setScale] = useState<number>()
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const media = useRef<MediaCache>(newCache())
  const dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; pan: { x: number; y: number } }>()
  const resolved = (figure: PaperFigure): string | undefined => figure.file ?? figureFilePath(manuscript, base, figure.path)
  const mediaKey = JSON.stringify([manuscript, base, sessionId, figures.map(figure => resolved(figure))])
  const selectedPath = selected && resolved(selected)

  useEffect(() => {
    const cache = newCache()
    media.current = cache
    setThumbs({})
    setFailedThumbs(new Set())
    setFocusIndex(0)
    setHovered(false)
    setPinned(false)
    return () => {
      cache.controller.abort()
      for (const url of cache.urls) URL.revokeObjectURL(url)
      cache.urls.clear()
    }
  }, [mediaKey, signal])

  const loadThumb = (figure: PaperFigure): Promise<string | undefined> => {
    const path = resolved(figure)
    if (!path) return Promise.resolve(undefined)
    const cache = media.current
    const cached = cache.thumbs.get(path)
    if (cached) return Promise.resolve(cached)
    const pending = cache.pending.get(path)
    if (pending) return pending
    const requestSignal = AbortSignal.any([signal, cache.controller.signal])
    const request = Promise.resolve().then(async () => {
      try {
        let url: string | undefined
        if (mediaType(path) === 'application/pdf') url = await thumbnail(path, requestSignal, sessionId)
        else {
          const data = await bytes(path, requestSignal, sessionId)
          if (!requestSignal.aborted) {
            url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mediaType(path) }))
            cache.urls.add(url)
          }
        }
        if (requestSignal.aborted) return undefined
        if (url) {
          cache.thumbs.set(path, url)
          setThumbs(old => ({ ...old, [path]: url }))
          setFailedThumbs((old) => {
            if (!old.has(path)) return old
            const next = new Set(old); next.delete(path); return next
          })
        } else setFailedThumbs(old => new Set(old).add(path))
        return url
      } catch (_error) {
        // A failed media read stays visible until an explicit retry; cancellation stays silent.
        if (!requestSignal.aborted) setFailedThumbs(old => new Set(old).add(path))
        return undefined
      } finally { cache.pending.delete(path) }
    })
    cache.pending.set(path, request)
    return request
  }

  const retryThumb = (figure: PaperFigure): void => {
    const path = resolved(figure)
    if (!path) return
    setFailedThumbs((old) => { const next = new Set(old); next.delete(path); return next })
    void loadThumb(figure)
  }

  const failImage = (path: string): void => {
    const cache = media.current
    const url = cache.thumbs.get(path)
    if (url && cache.urls.delete(url)) URL.revokeObjectURL(url)
    cache.thumbs.delete(path)
    setThumbs(old => Object.fromEntries(Object.entries(old).filter(([key]) => key !== path)))
    setFailedThumbs(old => new Set(old).add(path))
  }

  useEffect(() => {
    if (props.showDock === false) return
    const load = (figure: PaperFigure): void => {
      const path = resolved(figure)
      if (path && !failedThumbs.has(path)) void loadThumb(figure)
    }
    const figure = figures[focusIndex]
    if (figure) load(figure)
    if (expanded) for (const item of figures) load(item)
  }, [mediaKey, figures, focusIndex, expanded, failedThumbs, signal, props.showDock])

  useEffect(() => {
    setScale(undefined)
    setPan({ x: 0, y: 0 })
    setImageSize({ width: 0, height: 0 })
    drag.current = undefined
  }, [selectedPath])

  useEffect(() => {
    if (!selected) { setViewer({ failed: false }); return }
    const index = figures.findIndex(figure => resolved(figure) === selectedPath)
    if (index >= 0) setFocusIndex(index)
    const cache = media.current
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([signal, cache.controller.signal, controller.signal])
    setViewer({ failed: false })
    if (!selectedPath) setViewer({ failed: true })
    else void (async () => {
      try {
        let url: string | undefined
        if (mediaType(selectedPath) === 'application/pdf') {
          url = cache.full?.path === selectedPath ? cache.full.url : await props.fullPage(selectedPath, requestSignal, sessionId)
          if (url && !requestSignal.aborted) cache.full = { path: selectedPath, url }
        } else url = await loadThumb(selected)
        if (!requestSignal.aborted) setViewer(url ? { url, failed: false } : { failed: true })
      } catch (_error) {
        // The modal owns failure display; an obsolete selection must not replace its successor.
        if (!requestSignal.aborted) setViewer({ failed: true })
      }
    })()
    return () => { controller.abort() }
  }, [selectedPath, !!selected, mediaKey, sessionId, signal, attempt])

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal()
    const node = viewport.current
    if (!selected || !node) return
    const measure = (): void => { setViewportSize({ width: node.clientWidth, height: node.clientHeight }) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [!!selected])

  const fit = imageSize.width && viewportSize.width && viewportSize.height
    ? Math.min(viewportSize.width / imageSize.width, viewportSize.height / imageSize.height, 1) : 1
  const currentScale = scale ?? fit
  const clampPan = (x: number, y: number, nextScale = currentScale): { x: number; y: number } => {
    const maxX = Math.max(0, (imageSize.width * nextScale - viewportSize.width) / 2)
    const maxY = Math.max(0, (imageSize.height * nextScale - viewportSize.height) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }
  const zoom = (next: number | undefined): void => {
    setScale(next)
    setPan(old => next === undefined ? { x: 0, y: 0 } : clampPan(old.x, old.y, next))
  }
  const zoomBy = (factor: number): void => { zoom(Math.min(16, Math.max(Math.min(fit, 0.1), currentScale * factor))) }
  useEffect(() => {
    setPan(old => clampPan(old.x, old.y))
  }, [currentScale, imageSize.width, imageSize.height, viewportSize.width, viewportSize.height])
  const selectedIndex = figures.findIndex(figure => resolved(figure) === selectedPath)
  const navigate = (step: number): void => {
    const next = figures[selectedIndex + step]
    if (selectedIndex >= 0 && next) onSelect(next)
  }
  const retryViewer = (): void => {
    if (!selectedPath) return
    delete media.current.full
    if (mediaType(selectedPath) !== 'application/pdf') failImage(selectedPath)
    setAttempt(old => old + 1)
  }

  const cover = figures[Math.min(focusIndex, figures.length - 1)] ?? selected
  if (!cover) return null
  const thumb = (figure: PaperFigure): ReactNode => {
    const path = resolved(figure) ?? figure.path
    return thumbs[path]
      ? <img src={thumbs[path]} alt="" loading="lazy" draggable={false} onError={() => { failImage(path) }} />
      : <span className={css.figureFallback}>
        {failedThumbs.has(path) ? labels.failed : mediaType(path) === 'application/pdf' ? labels.pdf : labels.image}
      </span>
  }
  return <>
    <aside className={css.figureDock} aria-label={labels.figures} style={props.showDock === false ? { display: 'none' } : undefined}
      onMouseEnter={() => { setHovered(true) }} onMouseLeave={() => { setHovered(false) }}
      onFocusCapture={() => { setHovered(true) }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setHovered(false); setPinned(false) } }}>
      <div className={css.figureDockHead}>
        <button className={css.figureCover} aria-label={`${labels.open} ${cover.label}`} onClick={() => { onSelect(cover) }}>
          {thumb(cover)}<span>{cover.label}</span>
        </button>
        <button className={css.figureExpand} aria-label={pinned ? labels.collapse : labels.expand}
          aria-expanded={expanded} onClick={() => { setPinned(!pinned) }}>{figures.length} ▦</button>
      </div>
      {failedThumbs.has(resolved(cover) ?? cover.path) && <button aria-label={`${labels.retry} ${cover.label}`}
        onClick={() => { retryThumb(cover) }}>{labels.retry}</button>}
      {expanded && <div className={css.figureDockBody}>
        <div className={css.figureGrid}>{figures.map((figure, index) => <div key={`${figure.blockId}:${figure.path}`}>
          <button className={`${css.figureTile} ${viewerCss.tile}`} title={figure.path} aria-label={`${labels.open} ${figure.label}`}
            onMouseEnter={() => { setFocusIndex(index) }} onFocus={() => { setFocusIndex(index) }}
            onClick={() => { setFocusIndex(index); onSelect(figure) }}>
            {thumb(figure)}<span>{figure.label}</span>
          </button>
          {failedThumbs.has(resolved(figure) ?? figure.path) && <button aria-label={`${labels.retry} ${figure.label}`}
            onClick={() => { retryThumb(figure) }}>{labels.retry}</button>}
        </div>)}</div>
        <div className={css.figureDockActions}>
          <button onClick={() => { props.onLocate(cover) }}>{labels.locate}</button>
        </div>
      </div>}
    </aside>
    {selected && createPortal(<dialog ref={dialog} className={viewerCss.lightbox} aria-label={`${labels.figures}: ${selected.label}`}
      onCancel={(event) => { event.preventDefault(); onSelect(undefined) }} onClose={() => { onSelect(undefined) }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1) }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.5) }
        else if (event.key === '-') { event.preventDefault(); zoomBy(1 / 1.5) }
        else if (event.key === '0') { event.preventDefault(); zoom(undefined) }
        else if (event.key === '1') { event.preventDefault(); zoom(1) }
      }}>
      <div className={viewerCss.bar}><strong>{selected.label}</strong><span title={selected.path}>{selected.path}</span>
        <button onClick={() => { props.onNative(selected) }}>{labels.native}</button>
        <button aria-label={labels.close} onClick={() => { onSelect(undefined) }}><span aria-hidden="true">×</span></button>
      </div>
      <div className={viewerCss.controls}>
        <button aria-label={labels.previous} title={labels.previous} disabled={selectedIndex <= 0}
          onClick={() => { navigate(-1) }}>‹</button>
        <span>{selectedIndex >= 0 ? `${selectedIndex + 1} / ${figures.length}` : selected.label}</span>
        <button aria-label={labels.next} title={labels.next} disabled={selectedIndex < 0 || selectedIndex >= figures.length - 1}
          onClick={() => { navigate(1) }}>›</button>
        <span className={viewerCss.separator} />
        <button aria-label={labels.zoomOut} title={labels.zoomOut} disabled={!viewer.url} onClick={() => { zoomBy(1 / 1.5) }}>−</button>
        <output aria-live="polite">{Math.round(currentScale * 100)}%</output>
        <button aria-label={labels.zoomIn} title={labels.zoomIn} disabled={!viewer.url} onClick={() => { zoomBy(1.5) }}>+</button>
        <button disabled={!viewer.url} onClick={() => { zoom(undefined) }}>{labels.fit}</button>
        <button disabled={!viewer.url} onClick={() => { zoom(1) }}>{labels.actualSize}</button>
      </div>
      <div ref={viewport} className={viewerCss.viewport} data-figure-viewport data-pannable={currentScale > fit}
        onDoubleClick={() => { if (viewer.url) zoom(currentScale > fit ? undefined : Math.max(1, fit * 2)) }}
        onPointerDown={(event) => {
          if (!viewer.url || currentScale <= fit || event.button !== 0) return
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (start && event.pointerId === start.id) {
            setPan(clampPan(start.pan.x + event.clientX - start.x, start.pan.y + event.clientY - start.y))
          }
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return
          drag.current = undefined
          event.currentTarget.releasePointerCapture(event.pointerId)
        }} onLostPointerCapture={() => { drag.current = undefined }}>
        {viewer.failed ? <div className={viewerCss.message}><p role="alert">{labels.failed}</p><button onClick={retryViewer}>{labels.retry}</button></div>
          : !viewer.url ? <p role="status">{labels.loading}</p>
            : <img key={viewer.url} src={viewer.url} alt={selected.label} draggable={false}
              onLoad={(event) => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }) }}
              onError={() => { setViewer({ failed: true }); if (selectedPath) delete media.current.full }}
              style={{ width: imageSize.width || undefined, height: imageSize.height || undefined,
                transform: `translate(-50%, -50%) translate3d(${pan.x}px, ${pan.y}px, 0) scale(${currentScale})` }} />}
      </div>
      <div className={viewerCss.footer}>{selectedPath && mediaType(selectedPath) === 'application/pdf' ? labels.pdfPreview : labels.panHint}</div>
    </dialog>, document.body)}
  </>
}
