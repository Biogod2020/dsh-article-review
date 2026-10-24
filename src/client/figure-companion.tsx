/** Artwork keeps its own view while the manuscript scrolls independently. */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { FigureMedia } from './figure-preview.tsx'
import type { ReadingFigure } from './reading-figures.ts'
import type { PaperFigure } from '../figures.ts'
import type { PaperReviewKey } from './locales.ts'
import type { FigureViewState } from './workbench-state.ts'
import { PaperIcon } from './icons.tsx'
import css from './reading.module.css'

export type FigureRelation = 'linked' | 'manual' | 'pinned' | 'none'
const defaultView = (): FigureViewState => ({ fit: 'width', zoom: 1, left: 0, top: 0 })
export function FigureCompanion({ items, selected, pinned, collapsed, onCollapse, caption, onSelect, onPin, onOpen, onLocate,
  media, fullPage, stale, t, relation = pinned ? 'pinned' : 'linked', onBrowse, section = false,
  views, onViewChange, onDimensions, defaultFit = 'width', onFloat }: {
  items: ReadingFigure[]; selected: ReadingFigure | undefined; pinned: boolean
  collapsed: boolean; onCollapse: () => void; caption: string
  onSelect: (key: string) => void; onPin: () => void; onOpen: (figure: PaperFigure) => void
  onLocate: (blockId: string) => void; media: FigureMedia; fullPage: FigureMedia['thumbnail']; stale: boolean
  t: (key: PaperReviewKey) => string; relation?: FigureRelation; section?: boolean; onBrowse?: () => void
  views?: Record<string, FigureViewState> | undefined; onViewChange?: (file: string, view: FigureViewState) => void
  onDimensions?: (file: string, width: number, height: number) => void
  defaultFit?: 'width' | 'window'; onFloat?: () => void
}): ReactNode {
  const file = selected?.file
  const initial = views?.[file ?? ''] ?? { ...defaultView(), fit: defaultFit }
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' })
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(initial.zoom)
  const [fit, setFit] = useState<FigureViewState['fit']>(initial.fit)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [image, setImage] = useState({ file: '', width: 0, height: 0 })
  const [targetIndex, setTargetIndex] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const localViews = useRef({ ...views })
  const activeFile = useRef(file)
  const currentView = useRef(initial)
  const viewChange = useRef(onViewChange); viewChange.current = onViewChange
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>()
  const panRestore = useRef<{ file: string; left: number; top: number }>()
  const center = useRef<{ x: number; y: number }>()
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number }>()
  currentView.current = { ...currentView.current, fit, zoom }
  const saveView = (): void => {
    const key = activeFile.current
    if (!key) return
    const next = { ...currentView.current, left: Math.max(0, viewport.current?.scrollLeft ?? currentView.current.left), top: Math.max(0, viewport.current?.scrollTop ?? currentView.current.top) }
    currentView.current = next; localViews.current[key] = next
    viewChange.current?.(key, next)
  }
  const select = (key: string): void => { clearTimeout(scrollTimer.current); saveView(); onSelect(key) }
  const bodyId = useId()
  const wholes = items.filter(item => !item.panel)
  const groupIndex = wholes.findIndex(item => item.figure.blockId === selected?.figure.blockId && item.figure.path === selected.figure.path)
  const parent = wholes[groupIndex]
  const siblings = parent ? items.filter(item => item.figure.blockId === parent.figure.blockId && item.figure.path === parent.figure.path) : []
  useLayoutEffect(() => {
    clearTimeout(scrollTimer.current)
    activeFile.current = file
    const next = localViews.current[file ?? ''] ?? views?.[file ?? ''] ?? { ...defaultView(), fit: defaultFit }
    currentView.current = next; setFit(next.fit); setZoom(next.zoom); setTargetIndex(0)
    center.current = undefined; drag.current = undefined
    panRestore.current = file ? { file, left: next.left, top: next.top } : undefined
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 }
  }, [file])
  useLayoutEffect(() => {
    if (!file || localViews.current[file] || views?.[file] || fit === defaultFit) return
    center.current = undefined; setFit(defaultFit); setZoom(1)
    panRestore.current = { file, left: 0, top: 0 }
  }, [file, defaultFit])
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const measure = (): void => { setSize({ width: node.clientWidth, height: node.clientHeight }) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [Boolean(selected), collapsed])
  const availableWidth = Math.max(0, size.width - 24), availableHeight = Math.max(0, size.height - 24)
  const baseWidth = image.file === file && image.height
    ? fit === 'actual' ? image.width : fit === 'window' ? Math.min(availableWidth, availableHeight * image.width / image.height) : availableWidth : 0
  const imageWidth = baseWidth ? baseWidth * zoom : undefined
  const pannable = Boolean(imageWidth && (imageWidth > availableWidth + 1 || imageWidth * image.height / image.width > availableHeight + 1))
  useLayoutEffect(() => {
    const next = panRestore.current, node = viewport.current
    if (!next || next.file !== file || !node || !imageWidth || image.file !== file) return
    node.scrollLeft = next.left; node.scrollTop = next.top; panRestore.current = undefined
  }, [file, image.file, imageWidth])
  useLayoutEffect(() => {
    const node = viewport.current, img = imageRef.current, point = center.current
    if (!node || !img || !point) return
    const view = node.getBoundingClientRect(), rect = img.getBoundingClientRect()
    node.scrollLeft += rect.left + point.x * rect.width - view.left - node.clientWidth / 2
    node.scrollTop += rect.top + point.y * rect.height - view.top - node.clientHeight / 2
  }, [zoom, size.width, size.height])
  useLayoutEffect(() => { if (!panRestore.current) saveView() }, [fit, zoom])
  useEffect(() => {
    const flush = (): void => { clearTimeout(scrollTimer.current); saveView() }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])
  const changeZoom = (next: number): void => {
    const node = viewport.current, img = imageRef.current
    if (node && img) {
      const view = node.getBoundingClientRect(), rect = img.getBoundingClientRect()
      if (rect.width && rect.height) center.current = {
        x: (view.left + node.clientWidth / 2 - rect.left) / rect.width,
        y: (view.top + node.clientHeight / 2 - rect.top) / rect.height,
      }
    }
    panRestore.current = undefined; setZoom(next)
  }
  const changeFit = (next: FigureViewState['fit']): void => {
    center.current = undefined; setFit(next); setZoom(1)
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 }
    if (file) { const state = { ...defaultView(), fit: next }; localViews.current[file] = state; currentView.current = state; viewChange.current?.(file, state) }
  }
  useEffect(() => {
    const controller = new AbortController(), signal = AbortSignal.any([media.signal, controller.signal])
    let owned: string | undefined
    if (file) void (async () => {
      try {
        let url: string | undefined
        if (/\.pdf$/i.test(file)) url = await fullPage(file, signal, media.sessionId)
        else {
          const data = await media.bytes(file, signal, media.sessionId)
          if (signal.aborted) return
          const suffix = file.split('.').at(-1)?.toLowerCase()
          const type = suffix === 'svg' ? 'image/svg+xml' : suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : `image/${suffix}`
          url = owned = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }))
        }
        if (!signal.aborted) setResult(url ? { key: file, url } : { key: file, failed: true })
      } catch { if (!signal.aborted) setResult({ key: file, failed: true }) }
    })()
    return () => { controller.abort(); if (owned) URL.revokeObjectURL(owned) }
  }, [file, media.signal, media.sessionId, media.bytes, fullPage, attempt])
  const shown = result.key === file ? result : undefined
  const scaleLabel = zoom === 1 && fit !== 'actual' ? t(fit === 'width' ? 'figureFitWidth' : 'figureFit')
    : `${Math.round(imageWidth && image.width ? imageWidth / image.width * 100 : zoom * 100)}%`
  if (relation === 'none') return <aside className={css.companionEmpty} data-figure-companion data-no-related="true" aria-label={t('textFigures')}>
    <span role="status">{t(items.length ? section ? 'noSectionFigure' : 'noParagraphFigure' : 'noReadingFigures')}</span>
    {items.length > 0 && <button onClick={onBrowse}>{t('browseFigures')}</button>}
  </aside>
  return <aside className={css.companion} aria-label={t('textFigures')} data-figure-companion data-collapsed={collapsed}>
    <div className={css.figureHeading}>
      <button disabled={groupIndex <= 0} aria-label={t('previousFigure')} title={t('previousFigure')}
        onClick={() => { const item = wholes[groupIndex - 1]; if (item) select(item.key) }}>‹</button>
      <select aria-label={t('readingFigure')} value={parent?.key ?? ''} onChange={event => { select(event.target.value) }}>
        {!items.length && <option value="">{t('noReadingFigures')}</option>}
        {wholes.map(whole => <option value={whole.key} key={whole.key}>{whole.figure.label}</option>)}
      </select>
      <button disabled={groupIndex < 0 || groupIndex >= wholes.length - 1} aria-label={t('nextFigure')} title={t('nextFigure')}
        onClick={() => { const item = wholes[groupIndex + 1]; if (item) select(item.key) }}>›</button>
      {parent && <nav className={css.panelChoices} aria-label={t('figurePanels')}>
        {siblings.map(item => <button key={item.key} aria-pressed={selected?.key === item.key}
          aria-label={item.panel ? `${t('showPanel')} ${item.panel.label}` : t('showWholeFigure')}
          onClick={() => { select(item.key) }}>{item.panel?.label ?? t('wholeFigure')}</button>)}
      </nav>}
      {onFloat && <button aria-label={t('floatFigure')} title={t('floatFigure')} onClick={onFloat}><PaperIcon kind="float" size={14} /></button>}
      <button className={css.pin} aria-pressed={pinned} aria-label={t(pinned ? 'unpinFigure' : 'pinFigure')} title={t('pinFigureHelp')} onClick={onPin}><PaperIcon kind="pin" size={14} /></button>
      <button className={css.collapseFigures} aria-label={t(collapsed ? 'expandFigures' : 'collapseFigures')} aria-expanded={!collapsed} aria-controls={bodyId} onClick={onCollapse}><PaperIcon kind={collapsed ? 'down' : 'up'} size={14} /></button>
    </div>
    <div className={css.figureBody} id={bodyId}>
      <div className={css.figureControls}>
        <span className={css.relation} data-figure-relation={relation}>{t(relation === 'pinned' ? 'figurePinned' : relation === 'manual' ? 'manualFigure' : 'linkedFigure')}</span>
        <button disabled={zoom <= .25} aria-label={t('figureZoomOut')} onClick={() => { changeZoom(Math.max(.25, zoom - .25)) }}>−</button>
        <output aria-label={t('figureScale')} hidden={zoom === 1 && fit !== 'actual'}>{scaleLabel}</output>
        <button disabled={zoom >= 8} aria-label={t('figureZoomIn')} onClick={() => { changeZoom(Math.min(8, zoom + .5)) }}>+</button>
        <select aria-label={t('figureFitMode')} value={fit} onChange={event => { changeFit(event.target.value as FigureViewState['fit']) }}>
          <option value="width">{t('figureFitWidth')}</option><option value="window">{t('figureFit')}</option><option value="actual">{t('figureActualSize')}</option>
        </select>
        <button aria-label={t('openFigure')} title={t('openFigure')} onClick={() => { if (selected) onOpen(selected.figure) }}><PaperIcon kind="fullscreen" size={14} /></button>
      </div>
      <div className={css.figureViewport} ref={viewport} data-companion-file={file} data-zoomed={pannable}
        role="region" aria-label={t('figureImageArea')} tabIndex={selected ? 0 : -1}
        onScroll={() => { if (panRestore.current) return; clearTimeout(scrollTimer.current); if (activeFile.current) localViews.current[activeFile.current] = { fit, zoom, left: Math.max(0, viewport.current?.scrollLeft ?? 0), top: Math.max(0, viewport.current?.scrollTop ?? 0) }; scrollTimer.current = setTimeout(saveView, 150) }}
        onWheel={() => { center.current = undefined }} onKeyDown={() => { center.current = undefined }} onPointerDown={event => {
          center.current = undefined
          if (!pannable || event.button !== 0) return
          const node = event.currentTarget
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }
          node.setPointerCapture(event.pointerId)
        }} onPointerMove={event => {
          const start = drag.current
          if (!start || start.id !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left - event.clientX + start.x
          event.currentTarget.scrollTop = start.top - event.clientY + start.y
        }} onPointerUp={() => { drag.current = undefined; saveView() }} onPointerCancel={() => { drag.current = undefined }}>
        <div className={css.figureStage} style={{ minWidth: imageWidth ? imageWidth + 24 : undefined }}>
          {selected ? shown?.url ? <img ref={imageRef} src={shown.url} alt={selected.figure.label} draggable={false}
            style={{ width: imageWidth ? `${imageWidth}px` : '100%' }}
            onLoad={event => { const img = event.currentTarget; setImage({ file: file ?? '', width: img.naturalWidth, height: img.naturalHeight }); if (file && img.naturalWidth && img.naturalHeight) onDimensions?.(file, img.naturalWidth, img.naturalHeight) }}
            onError={() => { if (file) setResult({ key: file, failed: true }) }} />
            : <p role="status">{t(shown?.failed ? 'figureOpenFailed' : 'loading')}{shown?.failed && <button onClick={() => { setResult({ key: '' }); setAttempt(value => value + 1) }}>{t('retry')}</button>}</p>
            : <p>{t('noReadingFigures')}</p>}
        </div>
      </div>
      <div className={css.figureFooter}>
        {selected && <button aria-label={t(selected.panel ? 'locatePanelText' : 'locateFigure')} onClick={() => {
          onLocate(selected.targets[targetIndex] ?? selected.figure.blockId)
          setTargetIndex(value => (value + 1) % Math.max(1, selected.targets.length))
        }}>{t(selected.panel ? 'locatePanelText' : 'locateFigure')}{selected.targets.length > 1 && ` · ${targetIndex + 1}/${selected.targets.length}`}</button>}
        {caption && <details className={css.figureCaption} key={parent?.key}><summary>{t('figureCaption')}</summary><p>{caption}</p>{selected?.panel && <small>{t('panelSource')} · {t('page')} {selected.panel.page}</small>}</details>}
        {siblings.length === 1 && <span className={css.panelStatus}>{t('noFigurePanels')}</span>}
        {stale && <span role="status">{t('stalePanels')}</span>}
      </div>
    </div>
  </aside>
}
