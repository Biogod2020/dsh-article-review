/** Lazy caption-local thumbnails shared by the reader and proposal comparison. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PaperFigure } from '../figures.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

/** Authenticated readers supplied by the native sidebar. */
export interface FigureMedia {
  thumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  bytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>
  signal: AbortSignal
  sessionId: string
}

/**
 * Show a small on-demand preview without mounting full-resolution figures in the reader.
 * @param props - exact file, local media readers and localized actions.
 * @returns bounded thumbnail with open/replace actions and a collapsible body.
 */
export function FigurePreview({ figure, file, media, t, onOpen, onReplace }: {
  figure: PaperFigure
  file: string
  media: FigureMedia
  t: (key: PaperReviewKey) => string
  onOpen: (figure: PaperFigure) => void
  onReplace?: (figure: PaperFigure) => void
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(true)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [result, setResult] = useState<{ url?: string; failed?: boolean }>({})
  useEffect(() => {
    if (visible || !expanded || !root.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: root.current.closest('[data-paper-scroll]'), rootMargin: '200px 0px' })
    observer.observe(root.current)
    return () => { observer.disconnect() }
  }, [visible, expanded])
  useEffect(() => {
    if (!visible || !expanded) return
    const controller = new AbortController()
    const signal = AbortSignal.any([media.signal, controller.signal])
    let owned: string | undefined
    setResult({})
    void (async () => {
      try {
        let url: string | undefined
        if (/\.pdf$/i.test(file)) url = await media.thumbnail(file, signal, media.sessionId)
        else {
          const data = await media.bytes(file, signal, media.sessionId)
          if (signal.aborted) return
          const suffix = file.split('.').at(-1)?.toLowerCase()
          const type = suffix === 'svg' ? 'image/svg+xml' : suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : `image/${suffix}`
          owned = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }))
          url = owned
        }
        if (!signal.aborted) setResult(url ? { url } : { failed: true })
      } catch {
        if (!signal.aborted) setResult({ failed: true })
      }
    })()
    return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned) }
  }, [file, media.thumbnail, media.bytes, media.sessionId, media.signal, visible, expanded])
  return <div ref={root} className={css.inlineFigurePreview} data-figure-preview={file}>
    <div className={css.figurePreviewHeader}><button aria-expanded={expanded} onClick={() => { setExpanded(!expanded) }}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {t('figurePreview')} · {figure.label}</button>
    {onReplace && <button onClick={() => { onReplace(figure) }}>{t('replaceFigure')}</button>}</div>
    {expanded && <button className={css.figurePreviewBody} aria-label={`${t('openFigure')} ${figure.label}`}
      onClick={() => { onOpen({ ...figure, file }) }}>
      {result.url ? <img src={result.url} alt={figure.label} onError={() => { setResult({ failed: true }) }} />
        : <span>{t(result.failed ? 'figureOpenFailed' : 'loading')}</span>}
      <span><strong>{figure.label}</strong><code title={file}>{file}</code><small>{t('figurePreviewHint')}</small></span>
    </button>}
  </div>
}
