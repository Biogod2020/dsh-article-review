/** Compact figure navigator and on-demand full-screen preview for the manuscript reader. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { figureFilePath } from './figures.ts'
import type { PaperFigure } from './figures.ts'
import css from './panel.module.css'

interface FigureGalleryProps {
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
  }
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

/**
 * Show one persistent small cover, expand thumbnails on hover/focus, and preview on demand.
 * @param props - pinned figure references and authenticated local media readers.
 * @returns a reader-local dock and a viewport-sized modal only while a figure is selected.
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
  const pending = useRef(new Set<string>())
  const urls = useRef(new Set<string>())
  const lifetime = useRef(new AbortController())
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    pending.current.clear()
    setThumbs({})
    setFailedThumbs(new Set())
    setFocusIndex(0)
    setHovered(false)
    setPinned(false)
    return () => {
      controller.abort()
      for (const url of urls.current) URL.revokeObjectURL(url)
      urls.current.clear()
    }
  }, [manuscript, base, sessionId, figures])

  const resolved = (figure: PaperFigure): string | undefined => figureFilePath(manuscript, base, figure.path)
  const loadThumb = (figure: PaperFigure): void => {
    const path = resolved(figure)
    if (!path || pending.current.has(path) || thumbs[path] || failedThumbs.has(path)) return
    pending.current.add(path)
    const controller = lifetime.current
    const requestSignal = AbortSignal.any([signal, controller.signal])
    void (async () => {
      try {
        let url: string | undefined
        if (mediaType(path) === 'application/pdf') url = await thumbnail(path, requestSignal, sessionId)
        else {
          const data = await bytes(path, requestSignal, sessionId)
          if (!requestSignal.aborted) {
            url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mediaType(path) }))
            urls.current.add(url)
          }
        }
        if (requestSignal.aborted) return
        if (url) setThumbs(old => ({ ...old, [path]: url }))
        else setFailedThumbs(old => new Set(old).add(path))
      } catch {
        if (!requestSignal.aborted) setFailedThumbs(old => new Set(old).add(path))
      } finally { pending.current.delete(path) }
    })()
  }

  useEffect(() => {
    const figure = figures[focusIndex]
    if (figure) loadThumb(figure)
    if (expanded) for (const item of figures) loadThumb(item)
  }, [figures, focusIndex, expanded, base, manuscript, thumbs, failedThumbs])

  useEffect(() => {
    if (!selected) { setViewer({ failed: false }); return }
    const index = figures.indexOf(selected)
    if (index >= 0) setFocusIndex(index)
    const path = resolved(selected)
    const controller = new AbortController()
    const requestSignal = AbortSignal.any([signal, controller.signal])
    let ownedUrl: string | undefined
    setViewer({ failed: false })
    if (!path) setViewer({ failed: true })
    else if (mediaType(path) === 'application/pdf') void props.fullPage(path, requestSignal, sessionId).then((url) => {
      if (!requestSignal.aborted) setViewer(url ? { url, failed: false } : { failed: true })
    }).catch(() => { if (!requestSignal.aborted) setViewer({ failed: true }) })
    else if (thumbs[path]) setViewer({ url: thumbs[path], failed: false })
    else void bytes(path, requestSignal, sessionId).then((data) => {
      if (requestSignal.aborted) return
      ownedUrl = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mediaType(path) }))
      setViewer({ url: ownedUrl, failed: false })
    }).catch(() => { if (!requestSignal.aborted) setViewer({ failed: true }) })
    return () => {
      controller.abort()
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [selected, base, manuscript, sessionId, signal])

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [selected])

  const cover = figures[Math.min(focusIndex, figures.length - 1)]
  if (!cover) return null
  const thumb = (figure: PaperFigure): ReactNode => {
    const path = resolved(figure) ?? figure.path
    return thumbs[path]
      ? <img src={thumbs[path]} alt="" loading="lazy" draggable={false} />
      : <span className={css.figureFallback}>{mediaType(path) === 'application/pdf' ? labels.pdf : labels.image}</span>
  }
  return <>
    <aside className={css.figureDock} aria-label={labels.figures}
      onMouseEnter={() => { setHovered(true) }} onMouseLeave={() => { setHovered(false) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setHovered(false); setPinned(false) } }}>
      <div className={css.figureDockHead}>
        <button className={css.figureCover} aria-label={`${labels.open} ${cover.label}`} onClick={() => { onSelect(cover) }}>
          {thumb(cover)}<span>{cover.label}</span>
        </button>
        <button className={css.figureExpand} aria-label={pinned ? labels.collapse : labels.expand}
          aria-expanded={expanded} onClick={() => { setPinned(!pinned) }}>{figures.length} ▦</button>
      </div>
      {expanded && <div className={css.figureDockBody}>
        <div className={css.figureGrid}>{figures.map((figure, index) => <button key={`${figure.blockId}:${figure.path}`}
          className={css.figureTile} title={figure.path} aria-label={`${labels.open} ${figure.label}`}
          onMouseEnter={() => { setFocusIndex(index) }} onFocus={() => { setFocusIndex(index) }}
          onClick={() => { setFocusIndex(index); onSelect(figure) }}>
          {thumb(figure)}<span>{figure.label}</span>
        </button>)}</div>
        <div className={css.figureDockActions}>
          <button onClick={() => { props.onLocate(cover) }}>{labels.locate}</button>
        </div>
      </div>}
    </aside>
    {selected && createPortal(<dialog ref={dialog} className={css.figureLightbox} aria-label={`${labels.figures}: ${selected.label}`}
      onClose={() => { onSelect(undefined) }}>
      <div className={css.figureLightboxBar}><strong>{selected.label}</strong><span title={selected.path}>{selected.path}</span>
        <button onClick={() => { props.onNative(selected) }}>{labels.native}</button>
        <button aria-label={labels.close} onClick={() => { onSelect(undefined) }}>{labels.close}</button>
      </div>
      <div className={css.figureLightboxBody}>
        {viewer.failed ? <p role="alert">{labels.failed}</p> : !viewer.url ? <p role="status">{labels.loading}</p>
          : <img key={viewer.url} src={viewer.url} alt={selected.label} />}
      </div>
    </dialog>, document.body)}
  </>
}
