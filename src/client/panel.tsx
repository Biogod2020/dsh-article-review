/** Version-pinned reader, annotation batches, proposal decisions and cumulative human-review diffs. */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { diffWordsWithSpace } from 'diff'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Annotation, BibliographyView, FileListing, PaperCommand, PaperBlock, PaperView, Proposal } from '../schema.ts'
import { reviewContext } from './context.ts'
import { attachContext } from './composer.ts'
import { ReaderText } from './reader-text.tsx'
import { RenderedDiffText, renderedChangePair } from './rendered-diff.tsx'
import { SelectionMenu } from './selection-menu.tsx'
import { authoredFigureBase, collectFigures, figureFilePath } from './figures.ts'
import type { PaperFigure } from './figures.ts'
import { FigureGallery } from './figure-gallery.tsx'
import { readingBlocks, reviewableBlocks } from '../review-blocks.ts'
import { ReviewProgress } from './review-progress.tsx'
import { PaperFind } from './paper-find.tsx'
import { PaperIcon } from './icons.tsx'
import { Versions } from './versions.tsx'
import type { TextAnchor } from './selection.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

/** Operator actions carried over the authenticated DSH connection. */
export interface PaperPanelActions {
  /** @param command - explicit operator gesture. @param signal - tab lifetime. @returns validated persisted state. */
  command: (command: PaperCommand, signal: AbortSignal, sessionId: string) => Promise<PaperView>
  /**
   * @param path - workspace-relative folder.
   * @param signal - tab lifetime.
   * @param sessionId - native conversation.
   * @returns bounded Markdown listing.
   */
  listFiles: (path: string, signal: AbortSignal, sessionId: string) => Promise<FileListing>
  /** @returns selected workspace-relative Markdown path, or null when Finder is canceled. */
  pickFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** @returns manuscript selected by the operator or agent in this conversation. */
  currentFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** Read the manuscript's bound authoritative BibTeX index and citation diagnostics. */
  bibliography: (path: string, signal: AbortSignal, sessionId: string) => Promise<BibliographyView>
  /** Replace explicit `.bib` bindings; no bibliography or manuscript source is edited. */
  bindBibliography: (path: string, files: string[], signal: AbortSignal, sessionId: string) => Promise<BibliographyView>
  /** Choose a workspace `.bib` file through Finder on a macOS DSH host. */
  pickBibliography: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** @param path - workspace-relative figure. @returns canonical path for native preview. */
  figurePath: (path: string, signal: AbortSignal, sessionId: string) => Promise<string>
  /** @param path - workspace-relative PDF. @returns bounded first-page PNG when a renderer is available. */
  figureThumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  /** @param path - workspace-relative PDF. @returns readable first-page PNG when a renderer is available. */
  figurePage: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  /** @param path - workspace-relative figure. @returns complete local bytes within DSH's file limit. */
  figureBytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>
  /** @param signal - tab lifetime. @param sessionId - idle native conversation. @returns when its normal tools have been restored. */
  leave: (signal: AbortSignal, sessionId: string) => Promise<void>
}

/** Native sidebar props and locale-owned labels. */
export type PaperPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'paperReview'> & PaperPanelActions

/** Word-level changes with unchanged surrounding text. @param props - before and after source. @returns accessible diff. */
export const WordDiff = memo(function WordDiff({ before, after, labels, markdownLabels }: {
  before: string
  after: string
  labels: { compare: string; before: string; after: string }
  markdownLabels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
}): ReactNode {
  const [sourceOpen, setSourceOpen] = useState(false)
  const comparison = useMemo(() => before === after ? undefined : renderedChangePair(before, after), [before, after])
  return <><div className={css.renderedPair}>
    <section data-rendered-before><h5>{labels.before}</h5><RenderedDiffText text={before} opposite={after} side="before" labels={markdownLabels} comparison={comparison?.before ?? null} /></section>
    <section data-rendered-after><h5>{labels.after}</h5><RenderedDiffText text={after} opposite={before} side="after" labels={markdownLabels} comparison={comparison?.after ?? null} /></section>
  </div>
  <details className={css.sourceComparison} onToggle={(event) => { setSourceOpen(event.currentTarget.open) }}>
    <summary>{labels.compare}</summary>
    {sourceOpen && <div className={css.diff}>{diffWordsWithSpace(before, after).map((part, index) => part.added
      ? <ins key={index}>{part.value}</ins>
      : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>}
  </details></>
})

/** Defer Markdown parsing until a comparison approaches the review viewport. */
function LazyWordDiff({ before, after, labels, markdownLabels }: Parameters<typeof WordDiff>[0]): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || !root.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: root.current.closest('[data-paper-scroll]'), rootMargin: '600px 0px' })
    observer.observe(root.current)
    return () => { observer.disconnect() }
  }, [visible])
  const estimatedHeight = Math.max(150, Math.ceil(Math.max(before.length, after.length) / 50) * 28 + 90)
  return <div ref={root} data-lazy-diff>{visible
    ? <WordDiff before={before} after={after} labels={labels} markdownLabels={markdownLabels} />
    : <div className={css.diffPlaceholder} aria-hidden="true" style={{ minHeight: estimatedHeight }} />}</div>
}

/**
 * Keep the current manuscript fixed while fetching new proposal metadata.
 * @param props - native session input actions, sidebar lifetime and operator transport.
 * @returns manuscript workbench.
 */
export function PaperPanel({
  useTabInfo, useSession, useInput, sessionId, inputActions, t, command, listFiles,
  pickFile, currentFile, bibliography, bindBibliography, pickBibliography, figurePath, figureThumbnail, figurePage, figureBytes, leave,
}: PaperPanelProps): ReactNode {
  const tab = useTabInfo().tab
  const running = useSession(s => s.running)
  const input = useInput(s => s)
  const wasRunning = useRef(running)
  const preferenceKey = `paper-review:path:${sessionId}`
  const [path, setPath] = useState(() => localStorage.getItem(preferenceKey) ?? 'article.md')
  const [view, setView] = useState<PaperView>()
  const [incoming, setIncoming] = useState<PaperView>()
  const [mode, setMode] = useState<'read' | 'changes' | 'versions' | 'history' | 'references'>('read')
  const [bib, setBib] = useState<BibliographyView>()
  const [bibPath, setBibPath] = useState('')
  const [bibBusy, setBibBusy] = useState(false)
  const [bibError, setBibError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [quote, setQuote] = useState('')
  const [anchor, setAnchor] = useState<TextAnchor>()
  const [menu, setMenu] = useState<{ x: number; y: number; block: PaperBlock; anchor: TextAnchor }>()
  const [focusReading, setFocusReading] = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [selectedNotes, setSelectedNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState(false)
  const [listing, setListing] = useState<FileListing>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(() => localStorage.getItem('paper-review:toolbar-collapsed') === 'true')
  const [previewFigure, setPreviewFigure] = useState<PaperFigure>()
  const [pickerBusy, setPickerBusy] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const controlsId = useId()
  const closeMenu = useCallback(() => { setMenu(undefined) }, [])
  const current = useRef(view)
  current.current = view
  const generation = useRef(0)
  const pickerGeneration = useRef(0)
  const doc = view?.document
  const figures = useMemo(() => collectFigures(doc?.current.blocks ?? []), [doc?.current.blocks])
  const figureBase = useMemo(() => authoredFigureBase(doc?.current.text ?? ''), [doc?.current.text])
  const figuresByBlock = useMemo(() => {
    const grouped = new Map<string, PaperFigure[]>()
    for (const figure of figures) grouped.set(figure.blockId, [...(grouped.get(figure.blockId) ?? []), figure])
    return grouped
  }, [figures])
  const copyLabel = t('copy'), copiedLabel = t('copied'), footnotes = t('footnotes')
  const labels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const compareLabel = t('compare'), originalLabel = t('original'), revisedLabel = t('revised')
  const diffLabels = useMemo(() => ({ compare: compareLabel, before: originalLabel, after: revisedLabel }),
    [compareLabel, originalLabel, revisedLabel])

  const restore = (next: PaperView): void => {
    const blockId = next.document.reading[sessionId]
    if (blockId) requestAnimationFrame(() => content.current?.querySelector(`[data-block="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'start' }))
  }
  const run = async (request: PaperCommand, adopt = true): Promise<boolean> => {
    const seq = ++generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await command(request, tab.signal, sessionId)
      if (seq !== generation.current || tab.signal.aborted) return false
      const changesReader = adopt && (request.action === 'open' || request.action === 'refresh'
        || (request.action === 'decide' && request.accept))
      if (!changesReader && current.current && next.document.current.id !== current.current.document.current.id) setIncoming(next)
      else { setView(next); setIncoming(undefined) }
      if (request.action === 'open' && adopt) setControlsOpen(false)
      localStorage.setItem(preferenceKey, next.document.path)
      if (!current.current || request.action === 'refresh') restore(next)
      return true
    } catch (caught) {
      if (!tab.signal.aborted && seq === generation.current) setError(caught instanceof Error ? caught.message : String(caught))
      return false
    } finally { if (seq === generation.current) setBusy(false) }
  }

  const browse = async (directory: string): Promise<void> => {
    const seq = ++pickerGeneration.current
    setPickerBusy(true); setPickerError('')
    try {
      const next = await listFiles(directory, tab.signal, sessionId)
      if (seq === pickerGeneration.current && !tab.signal.aborted) setListing(next)
    } catch (caught) {
      if (seq === pickerGeneration.current && !tab.signal.aborted) setPickerError(caught instanceof Error ? caught.message : String(caught))
    } finally { if (seq === pickerGeneration.current) setPickerBusy(false) }
  }

  const chooseFile = async (): Promise<void> => {
    setPickerBusy(true); setPickerError(''); setError('')
    try {
      const selected = await pickFile(tab.signal, sessionId)
      if (!selected || tab.signal.aborted) return
      setPath(selected)
      void run({ action: 'open', path: selected })
    } catch (caught) {
      if (tab.signal.aborted) return
      const message = caught instanceof Error ? caught.message : String(caught)
      if (message.includes('requires macOS')) { setPickerOpen(true); void browse('') }
      else setError(message)
    } finally { setPickerBusy(false) }
  }

  const exitMode = async (): Promise<void> => {
    const seq = ++generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      await leave(tab.signal, sessionId)
      if (seq !== generation.current || tab.signal.aborted) return
      localStorage.removeItem(preferenceKey)
      setView(undefined); setIncoming(undefined); setSelectedId(''); setSelectedNotes([])
      setPath('article.md'); setMode('read'); setPickerOpen(false)
    } catch (caught) {
      if (seq === generation.current && !tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally { if (seq === generation.current) setBusy(false) }
  }

  useEffect(() => {
    void currentFile(tab.signal, sessionId).then((selected) => {
      const saved = selected ?? localStorage.getItem(preferenceKey)
      if (saved && !tab.signal.aborted) void run({ action: 'open', path: saved })
    }).catch((caught: unknown) => { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { generation.current += 1; pickerGeneration.current += 1 }
    // The native slot remounts for another session. Requests use the tab's own lifetime.
  }, [preferenceKey])

  useEffect(() => {
    if (wasRunning.current && !running) void currentFile(tab.signal, sessionId).then((selected) => {
      if (tab.signal.aborted) return
      if (selected && selected !== current.current?.document.path) void run({ action: 'open', path: selected })
      else if (current.current) void run({ action: 'open', path: current.current.document.path }, false)
    }).catch((caught: unknown) => { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) })
    wasRunning.current = running
    // A completed native conversation turn refreshes metadata without replacing the reader version.
  }, [running])

  useEffect(() => {
    setMenu(undefined); setAnchor(undefined); setQuote(''); setEditing(false); setFocusReading(false)
    setPreviewFigure(undefined)
  }, [doc?.path, doc?.current.id, mode])

  useEffect(() => { if (content.current) content.current.scrollTop = 0 }, [mode])

  useEffect(() => {
    setBib(undefined); setBibError('')
    if (!doc) return
    let alive = true
    void bibliography(doc.path, tab.signal, sessionId).then((result) => { if (alive && !tab.signal.aborted) setBib(result) },
      (caught: unknown) => { if (alive && !tab.signal.aborted) setBibError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { alive = false }
  }, [doc?.path, doc?.current.id])

  const updateBib = async (files: string[]): Promise<void> => {
    if (!doc) return
    setBibBusy(true); setBibError('')
    try {
      const result = await bindBibliography(doc.path, files, tab.signal, sessionId)
      if (!tab.signal.aborted) { setBib(result); setBibPath('') }
    } catch (caught) { if (!tab.signal.aborted) setBibError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBibBusy(false) }
  }

  const chooseBib = async (): Promise<void> => {
    setBibBusy(true); setBibError('')
    try {
      const selected = await pickBibliography(tab.signal, sessionId)
      if (selected && !tab.signal.aborted && !bib?.files.includes(selected)) await updateBib([...(bib?.files ?? []), selected])
    } catch (caught) { if (!tab.signal.aborted) setBibError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBibBusy(false) }
  }

  useEffect(() => { setComment('') }, [doc?.path, selectedId])

  useEffect(() => {
    setSelectedNotes([]); setSelectedId(''); setSource(false); setShowHighlights(false); setShowNotes(false)
  }, [doc?.path])

  useEffect(() => {
    if (!pickerOpen) return
    picker.current?.querySelector('button')?.focus()
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setPickerOpen(false) }
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('keydown', escape) }
  }, [pickerOpen])

  const insert = (text: string): void => {
    const result = attachContext(inputActions, input, text)
    if (result === 'inserted') { setNotice(t('sent')); setError('') }
    else { setNotice(''); setError(t(result === 'references' ? 'referenceDraft' : 'insertFailed')) }
  }
  const openNativeFigure = async (figure: PaperFigure): Promise<void> => {
    if (!doc) return
    const path = figureFilePath(doc.path, figureBase, figure.path)
    if (!path) { setError(t('figureOpenFailed')); return }
    try {
      const source = await figurePath(path, tab.signal, sessionId)
      if (!tab.signal.aborted) {
        setError('')
        tab.actions.openResource(fileAddressFor(sessionId, undefined, source), { preferNewPane: true })
      }
    } catch {
      if (!tab.signal.aborted) setError(t('figureOpenFailed'))
    }
  }
  const attach = (intent: string, annotations: Annotation[], block?: PaperBlock): void => {
    if (doc) insert(reviewContext(doc, annotations, block, intent, { contextPath: t('contextPath'), contextRevision: t('contextRevision'), contextRules: t('contextRules'), contextData: t('contextData') }))
  }
  const focusBlock = (block: PaperBlock): void => {
    setSelectedId(block.id)
    if (doc) void command({ action: 'position', path: doc.path, reader: sessionId, blockId: block.id }, tab.signal, sessionId).catch(() => { /* Position is advisory; manuscript operations report their own failures. */ })
  }
  const selectText = (block: PaperBlock): void => {
    const selection = window.getSelection()
    const raw = selection?.toString().trim() ?? ''
    focusBlock(block)
    const unambiguous = raw !== '' && block.text.split(raw).length === 2
    setQuote(unambiguous ? raw : '')
    setAnchor(undefined)
    setEditing(false)
  }
  const mark = (block: PaperBlock, locked: boolean): void => {
    if (doc) void run({ action: 'review', path: doc.path, revision: doc.current.id, blockIds: [block.id], locked })
  }
  const annotationsByBlock = useMemo(() => {
    const grouped = new Map<string, Annotation[]>()
    for (const annotation of doc?.annotations ?? []) {
      const notes = grouped.get(annotation.blockId) ?? []
      notes.push(annotation)
      grouped.set(annotation.blockId, notes)
    }
    return grouped
  }, [doc?.annotations])
  const highlightsByBlock = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof doc>['highlights']>()
    for (const highlight of doc?.highlights ?? []) {
      const marks = grouped.get(highlight.blockId) ?? []
      marks.push(highlight)
      grouped.set(highlight.blockId, marks)
    }
    return grouped
  }, [doc?.highlights])
  const baselinesByBlock = useMemo(() => new Map(doc?.baselines.map(base => [base.blockId, base]) ?? []), [doc?.baselines])
  const visibleBlocks = useMemo(() => readingBlocks(doc?.current.blocks ?? []), [doc?.current.blocks])
  const progressBlocks = useMemo(() => reviewableBlocks(doc?.current.blocks ?? []), [doc?.current.blocks])
  const notesFor = (blockId: string): Annotation[] => annotationsByBlock.get(blockId) ?? []
  const pending = doc?.proposals.filter(p => p.status === 'pending') ?? []
  const conflict = (proposal: Proposal): boolean => view?.diskChanged === true || incoming !== undefined || proposal.edits.some(edit =>
    doc?.current.blocks.find(b => b.id === edit.blockId)?.text !== edit.before
    || doc.baselines.some(b => b.blockId === edit.blockId && b.locked))
  const reviewChanges = doc?.baselines.filter(base => doc.current.blocks.find(b => b.id === base.blockId)?.text !== base.text) ?? []
  const compactHeader = Boolean(doc) && headerCollapsed

  const annotationCard = (annotation: Annotation): ReactNode => <div
    className={css.note} key={annotation.id} data-annotation={annotation.id}>
    <label className={css.noteTitle}><input type="checkbox" checked={selectedNotes.includes(annotation.id)}
      disabled={annotation.anchor !== 'attached'}
      onChange={(e) =>{  setSelectedNotes(ids => e.target.checked ? [...ids, annotation.id] : ids.filter(id => id !== annotation.id)) }} />
    <strong>{annotation.id}</strong><span>{annotation.anchor === 'needs-location' ? t('detached') : annotation.status === 'resolved' ? t('resolved') : ''}</span></label>
    {annotation.quote && <blockquote>{annotation.quote}</blockquote>}
    <p>{annotation.comment}</p>
    <button onClick={() => { if (doc) void run({ action: 'resolve', path: doc.path, annotationId: annotation.id, resolved: annotation.status !== 'resolved' }) }}>{t(annotation.status === 'resolved' ? 'reopen' : 'resolve')}</button>
  </div>

  return <section className={css.panel} data-paper-review ref={panel} tabIndex={-1}>
    <div className={`${css.top} ${compactHeader ? css.topCollapsed : ''}`} data-paper-header>
      <div className={css.topBar}>
        <div className={css.identity}><span className={css.modeBadge} title={t('reviewMode')} aria-label={t('reviewMode')}>{t('modeName')}</span>
          {doc && <strong className={css.documentName} title={doc.path}>{doc.path}</strong>}</div>
        {doc && !compactHeader && <div className={css.summary}><span>{t('notes')} {doc.annotations.filter(a => a.status === 'open').length}</span>
          <span title={doc.current.id}>{t('version')} {doc.current.id.slice(0, 7)}</span></div>}
        {doc && <div className={css.topActions}>
          {!compactHeader && <button className={`${css.refresh} ${css.iconOnly}`} aria-label={busy ? t('loading') : t('check')}
            title={busy ? t('loading') : t('check')} disabled={busy} onClick={() => { void run({ action: 'open', path: doc.path }, false) }}>
            <PaperIcon kind="refresh" />
          </button>}
          {!compactHeader && <button className={css.controlsToggle} aria-expanded={controlsOpen} aria-controls={controlsId}
            onClick={() => { setControlsOpen(!controlsOpen) }}>{t(controlsOpen ? 'hideControls' : 'showControls')}</button>
          }
          <button className={`${css.toolbarToggle} ${css.iconOnly}`} aria-label={t(compactHeader ? 'showToolbar' : 'hideToolbar')}
            title={t(compactHeader ? 'showToolbar' : 'hideToolbar')} aria-expanded={!compactHeader} onClick={() => {
              const next = !headerCollapsed
              setHeaderCollapsed(next)
              localStorage.setItem('paper-review:toolbar-collapsed', String(next))
            }}><PaperIcon kind={compactHeader ? 'down' : 'up'} /></button>
        </div>}
      </div>
      {!compactHeader && (!doc || controlsOpen) && <div id={controlsId} className={css.fileControls}>
        <form className={css.open} onSubmit={(event) => { event.preventDefault(); setSelectedId(''); setQuote(''); setAnchor(undefined); setEditing(false); void run({ action: 'open', path }) }}>
          <input aria-label={t('path')} placeholder={t('pathHint')} value={path} onChange={(event) =>{  setPath(event.target.value) }} />
          <button type="button" disabled={busy || pickerBusy} onClick={() => { void chooseFile() }}><PaperIcon kind="folder" size={15} />{t('browse')}</button>
          <button disabled={busy || !path.trim()}><PaperIcon kind="read" size={15} />{t('open')}</button>
        </form>
        {doc && <button className={css.leave} disabled={busy || running} onClick={() => { void exitMode() }}>{t('leave')}</button>}
      </div>}
      {doc && !compactHeader && <nav className={css.tabs} aria-label={t('reviewSections')}>{(['read', 'changes', 'versions', 'history', 'references'] as const).map((item) => {
        return <button key={item} aria-label={t(item)} title={t(item)} aria-pressed={mode === item} onClick={() =>{  setMode(item) }}>
          <PaperIcon kind={item} size={15} /><span className={css.tabLabel}>{t(item)}</span>
          {item === 'changes' && pending.length > 0 && <span className={css.count}>{pending.length}</span>}
        </button>
      })}
      </nav>}
    </div>
    {error && <div className={css.error} role="alert">{error}</div>}
    {notice && <div className={css.notice} role="status">{notice}</div>}
    {pickerOpen && <div className={css.pickerBackdrop} role="presentation" onClick={() => { setPickerOpen(false) }}>
      <div className={css.picker} ref={picker} role="dialog" aria-modal="true" aria-label={t('browse')}
        onClick={(event) => { event.stopPropagation() }}>
        <div className={css.pickerHeading}><strong>{t('browse')}</strong><button className={css.iconOnly} aria-label={t('close')}
          title={t('close')} onClick={() => { setPickerOpen(false) }}><PaperIcon kind="close" /></button></div>
        <div className={css.pickerCrumbs}><button disabled={pickerBusy || listing?.path === ''} onClick={() => { void browse('') }}>{t('workspace')}</button>
          {listing?.path.split('/').filter(Boolean).map((part, index, parts) => <button key={index} disabled={pickerBusy || index === parts.length - 1}
            onClick={() => { void browse(parts.slice(0, index + 1).join('/')) }}>{part}</button>)}
        </div>
        {pickerBusy && <p>{t('loading')}</p>}
        {pickerError && <p className={css.error} role="alert">{pickerError}</p>}
        {!pickerBusy && listing && <div className={css.pickerEntries}>
          {listing.entries.length === 0 && <p>{t('noMarkdown')}</p>}
          {listing.entries.map(entry => <button key={entry.name} onClick={() => {
            const selected = [listing.path, entry.name].filter(Boolean).join('/')
            if (entry.type === 'directory') void browse(selected)
            else { setPath(selected); setPickerOpen(false); void run({ action: 'open', path: selected }) }
          }}>{entry.type === 'directory' ? '▸' : '▤'} {entry.name}</button>)}
          {listing.truncated && <p>{t('truncated')}</p>}
        </div>}
      </div>
    </div>}
    {(view?.diskChanged || incoming) && <div className={css.banner} role="status"><span>{t(incoming ? 'newVersion' : 'external')}</span>
      <button disabled={busy} onClick={() => {
        if (incoming) { setView(incoming); setIncoming(undefined); restore(incoming) }
        else if (doc) void run({ action: 'refresh', path: doc.path, revision: doc.current.id })
        setSelectedId(''); setEditing(false)
      }}>{t('load')}</button></div>}
    <div className={css.content} ref={content} data-paper-scroll>
      {doc && <PaperFind key={doc.path} panel={panel} content={content} blocks={visibleBlocks} bibliography={bib}
        mode={mode} onRead={() => { setMode('read') }} t={t} />}
      {doc && mode === 'read' && <div className={css.progressAnchor}><ReviewProgress blocks={progressBlocks} baselines={doc.baselines} t={t}
        jump={(block) => {
          focusBlock(block)
          content.current?.querySelector(`[data-block="${CSS.escape(block.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }} /></div>}
      {!doc && <div className={css.welcome}><span className={css.monogram}>¶</span><h2>{t('title')}</h2><p>{t('empty')}</p><p>{t('intro')}</p></div>}
      {doc && mode === 'read' && <>
        <div className={css.readToolbar}>
          <button aria-pressed={showHighlights} onClick={() => { setShowHighlights(!showHighlights) }}><PaperIcon kind="edit" size={15} />{t('highlights')} ({doc.highlights.filter(h => !h.removed).length})</button>
          <button aria-pressed={showNotes} onClick={() =>{  setShowNotes(!showNotes) }}><PaperIcon kind="changes" size={15} />{t('allNotes')}</button>
          {focusReading && <button onClick={() => { setFocusReading(false) }}>{t('exitFocus')}</button>}
        </div>
        {showHighlights && <aside className={css.notes} aria-label={t('highlights')}>
          {doc.highlights.length === 0 && <p>{t('noHighlights')}</p>}
          {doc.highlights.map(highlight => <div className={css.note} key={highlight.id} data-highlight={highlight.id}>
            <strong>{highlight.id} · {t(highlight.color)}</strong>
            <blockquote>{highlight.quote}</blockquote>
            <span>{highlight.anchor === 'needs-location' ? t('detached') : ''} {highlight.removed ? t('removedHighlight') : ''}</span>
            <button disabled={highlight.anchor !== 'attached'} onClick={() => {
              const block = doc.current.blocks.find(b => b.id === highlight.blockId)
              if (block) { focusBlock(block); content.current?.querySelector(`[data-block="${CSS.escape(block.id)}"]`)?.scrollIntoView({ block: 'center' }) }
            }}>{t('locate')}</button>
            <button disabled={busy} onClick={() => { void run({ action: 'set-highlight', path: doc.path, highlightId: highlight.id, removed: !highlight.removed }) }}>{t(highlight.removed ? 'restoreHighlight' : 'removeHighlight')}</button>
          </div>)}
        </aside>}
        {showNotes && <aside className={css.notes}>{doc.annotations.map(annotationCard)}
          <button disabled={!selectedNotes.length} onClick={() =>{  attach(t('batchIntent'), doc.annotations.filter(a => selectedNotes.includes(a.id) && a.anchor === 'attached')) }}>{t('batch')} ({selectedNotes.length})</button>
        </aside>}
        <article className={`${css.article} ${focusReading ? css.focusReading : ''}`}>{visibleBlocks.map((block) => {
          const baseline = baselinesByBlock.get(block.id)
          const state = !baseline ? 'unread' : baseline.text === block.text ? 'reviewed' : 'changed'
          const active = block.id === selectedId
          const provenance = block.start === 0 && block.kind === 'html' && /^\s*<!--/.test(block.text)
          const blockView = <div key={block.id} data-block={provenance ? undefined : block.id} className={`${css.block} ${active ? css.selected : ''}`}>
            <div className={css.margin}><span className={css[state]} title={t(state)}>{state === 'reviewed' ? '✓' : state === 'changed' ? '↺' : '○'}</span>
              {notesFor(block.id).length > 0 && <button onClick={() => { focusBlock(block); setQuote(''); setAnchor(undefined); setEditing(true) }}>{notesFor(block.id).length}</button>}
              {baseline?.locked && <span title={t('locked')}>▣</span>}</div>
            {provenance
              ? <pre className={css.raw} onMouseUp={() => { selectText(block) }}>{block.text}</pre>
              : <ReaderText block={block} highlights={highlightsByBlock.get(block.id) ?? []}
                annotations={notesFor(block.id)} labels={labels} bibliography={bib}
                onSelect={(selection) => { focusBlock(block); setAnchor(selection); setQuote(selection?.quote ?? ''); setEditing(false) }}
                onMenu={(event, selection) => {
                  if (!selection) {
                    if (window.getSelection()?.toString().trim()) { event.preventDefault(); setError(t('oneBlockSelection')) }
                    return
                  }
                  event.preventDefault(); focusBlock(block); setAnchor(selection); setQuote(selection.quote); setError('')
                  setMenu({ x: event.clientX, y: event.clientY, block, anchor: selection })
                }} />}
            {figuresByBlock.get(block.id)?.map(figure => <button key={figure.path} className={css.figureInline}
              aria-label={`${t('openFigure')} ${figure.label}`} onClick={() => { setPreviewFigure(figure) }}>
              <PaperIcon kind="fullscreen" size={14} />{t('openFigure')} · {figure.label}
            </button>)}
            {active && <div className={css.actions}>
              <button onClick={() =>{  setEditing(!editing) }}><PaperIcon kind="edit" size={14} />{t('annotate')}</button>
              <button onClick={() =>{  attach(`${t('askIntent')} ${quote}`, [], block) }}><PaperIcon kind="sparkle" size={14} />{t('ask')}</button>
              <button onClick={() =>{  attach(`${t('suggestIntent')} ${quote}`, notesFor(block.id).filter(a => a.status === 'open'), block) }}><PaperIcon kind="changes" size={14} />{t('suggest')}</button>
              <span className={css.spacer} />
              <button className={`${css.iconOnly} ${css.markAction}`} aria-label={t('mark')} title={t('mark')}
                disabled={busy} onClick={() =>{  mark(block, false) }}><PaperIcon kind="check" size={15} /></button>
              <button className={css.iconOnly} aria-label={t(baseline?.locked ? 'unlock' : 'lock')}
                title={t(baseline?.locked ? 'unlock' : 'lock')} aria-pressed={Boolean(baseline?.locked)} disabled={busy} onClick={() => {
                  if (baseline?.locked) void run({ action: 'unlock', path: doc.path, blockId: block.id })
                  else mark(block, true)
                }}><PaperIcon kind="shield" size={15} /></button>
              <button className={css.iconOnly} aria-label={t(source ? 'close' : 'source')}
                title={t(source ? 'close' : 'source')} aria-pressed={source} onClick={() =>{  setSource(!source) }}><PaperIcon kind="code" size={15} /></button>
            </div>}
            {active && source && <pre className={css.raw} onMouseUp={() =>{  selectText(block) }}>{block.text}</pre>}
            {active && editing && <div className={css.annotationEditor}>
              {quote ? <blockquote>{quote}</blockquote> : <small>{t('wholeBlock')}</small>}
              <textarea aria-label={t('comment')} placeholder={t('comment')} value={comment} onChange={(event) =>{  setComment(event.target.value) }} />
              <button disabled={busy || !comment.trim()} onClick={() => {
                const index = block.text.indexOf(quote)
                void run({ action: 'annotate', path: doc.path, revision: doc.current.id, blockId: block.id, quote,
                  prefix: anchor?.prefix ?? (quote ? block.text.slice(Math.max(0, index - 32), index) : ''),
                  suffix: anchor?.suffix ?? (quote ? block.text.slice(index + quote.length, index + quote.length + 32) : ''),
                  ...(anchor ? { rendered: true, offset: anchor.offset } : {}), comment,
                }).then((saved) => { if (saved) setComment('') })
              }}><PaperIcon kind="check" size={15} />{t('save')}</button><button onClick={() =>{  setEditing(false); setComment('') }}><PaperIcon kind="close" size={15} />{t('cancel')}</button>
              {notesFor(block.id).map(annotationCard)}
            </div>}
          </div>
          return provenance ? <details key={block.id} data-block={block.id} className={css.provenance}>
            <summary>{t('sourceNote')}</summary>{blockView}
          </details> : blockView
        })}</article>
      </>}
      {doc && mode === 'changes' && <div className={css.review}>
        <div className={css.reviewHeading}><h3>{t('proposal')}</h3><button onClick={() => {
          const cards = [...(content.current?.querySelectorAll<HTMLElement>('[data-risk="true"]') ?? [])]
          const top = (content.current?.getBoundingClientRect().top ?? 0) + 60
          const next = cards.find(card => card.getBoundingClientRect().top > top) ?? cards[0]
          next?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}><PaperIcon kind="down" size={15} />{t('nextRisk')}</button></div>
        <p className={css.help}>{t('riskNote')}</p>
        {pending.length === 0 && <p className={css.empty}>{t('noProposals')}</p>}
        {pending.map(proposal => <section className={css.proposal} key={proposal.id} data-proposal={proposal.id} data-risk={proposal.flags.length > 0 || proposal.meaning !== 'style'}>
          <div className={css.proposalTitle}><strong>{proposal.id}</strong><span>{proposal.annotationIds.join(' · ')}</span><span>{t('modelLabel')} {t(proposal.meaning)}</span></div>
          <p>{proposal.reason}</p>
          {proposal.flags.length > 0 && <div className={css.flags}>{proposal.flags.map(flag => <span key={flag}>{t(flag)}</span>)}</div>}
          {proposal.edits.map(edit => <div key={edit.blockId}>
            <h4>{doc.current.blocks.find(b => b.id === edit.blockId)?.section}</h4>
            <LazyWordDiff before={edit.before} after={edit.after} labels={diffLabels} markdownLabels={labels} />
          </div>)}
          {conflict(proposal) && <p className={css.warning}>{t('overlap')}</p>}
          <div className={css.decisions}><button disabled={busy || conflict(proposal)} onClick={() => { void run({ action: 'decide', path: doc.path, revision: doc.current.id, proposalId: proposal.id, accept: true }) }}><PaperIcon kind="check" size={15} />{t('accept')}</button>
            <button disabled={busy} onClick={() => { void run({ action: 'decide', path: doc.path, revision: doc.current.id, proposalId: proposal.id, accept: false }) }}><PaperIcon kind="close" size={15} />{t('reject')}</button>
            <button onClick={() =>{  insert(`${proposal.id} · ${doc.path}\n${t('redoIntent')} `) }}><PaperIcon kind="edit" size={15} />{t('redo')}</button>
          </div>
        </section>)}
        <h3>{t('baseline')} ({reviewChanges.length})</h3>
        {reviewChanges.length === 0 && <p className={css.empty}>{t('noChanges')}</p>}
        {reviewChanges.map((base) => {
          const block = doc.current.blocks.find(b => b.id === base.blockId)
          return <section className={css.proposal} key={base.blockId} data-risk="true"><p>{block?.section ?? t('removed')}</p>
            <LazyWordDiff before={base.text} after={block?.text ?? ''} labels={{ ...diffLabels, before: t('before'), after: t('after') }} markdownLabels={labels} />
            {block && <button disabled={busy} onClick={() =>{  mark(block, base.locked) }}>{t('mark')}</button>}
          </section>
        })}
      </div>}
      {doc && mode === 'versions' && <Versions key={doc.path} document={doc} t={t} />}
      {doc && mode === 'references' && <div className={css.references}>
        <h3>{t('references')}</h3><p className={css.help}>{t('bibHelp')}</p>
        {bibError && <p className={css.error} role="alert">{bibError}</p>}
        {!bib && !bibError && <p>{t('loading')}</p>}
        {bib && <>
          <div className={css.bibFiles}><strong>{t('bibSources')}</strong>{bib.files.length === 0 && <p>{t('bibNone')}</p>}
            {bib.files.map(file => <div key={file}><code>{file}</code><button disabled={bibBusy}
              onClick={() => { void updateBib(bib.files.filter(item => item !== file)) }}>{t('bibUnbind')}</button></div>)}
          </div>
          <form className={css.bibBind} onSubmit={(event) => {
            event.preventDefault()
            if (bibPath.trim() && !bib.files.includes(bibPath.trim())) void updateBib([...bib.files, bibPath.trim()])
          }}>
            <input aria-label={t('bibPath')} placeholder={t('bibPathHint')} value={bibPath}
              onChange={(event) => { setBibPath(event.target.value) }} />
            <button disabled={bibBusy || !bibPath.trim() || bib.files.includes(bibPath.trim())}>{t('bibBind')}</button>
            <button type="button" disabled={bibBusy} onClick={() => { void chooseBib() }}>{t('bibChoose')}</button>
          </form>
          {(bib.missingKeys.length > 0 || bib.possibleBareKeys.length > 0) && <div className={css.bibWarnings}>
            {bib.missingKeys.length > 0 && <p><strong>{t('bibMissing')}</strong> {bib.missingKeys.join(', ')}</p>}
            {bib.possibleBareKeys.length > 0 && <p><strong>{t('bibLegacy')}</strong> {bib.possibleBareKeys.join(', ')}</p>}
          </div>}
          <h4>{t('bibEntries')} ({bib.entries.length})</h4>
          <div className={css.bibEntries}>{bib.entries.map(entry => <div key={entry.key}>
            <strong>[@{entry.key}]</strong><span>{entry.fields.author} · {entry.fields.year}</span>
            <p>{entry.fields.title}</p><small>{entry.file}</small>
          </div>)}</div>
        </>}
      </div>}
      {doc && mode === 'history' && <div className={css.history}>{doc.history.length === 0 ? t('noHistory') : [...doc.history].reverse().map((event, i) =>
        <div key={i}><time>{new Date(event.at).toLocaleString()}</time><strong>{t(historyKeys[event.action] ?? 'history')}</strong><code>{event.detail}</code></div>)}</div>}
    </div>
    {doc && mode === 'read' && figures.length > 0 && <FigureGallery figures={figures} manuscript={doc.path} base={figureBase}
      sessionId={sessionId} signal={tab.signal} thumbnail={figureThumbnail} fullPage={figurePage} bytes={figureBytes}
      selected={previewFigure} onSelect={setPreviewFigure}
      onLocate={(figure) => { content.current?.querySelector(`[data-block="${CSS.escape(figure.blockId)}"]`)?.scrollIntoView({ block: 'center' }) }}
      onNative={(figure) => { void openNativeFigure(figure) }}
      labels={{ figures: t('figureList'), pdf: t('figurePdf'), image: t('figureImage'), open: t('openFigure'), close: t('figureClose'), loading: t('loading'),
        failed: t('figureOpenFailed'), locate: t('locateFigure'), native: t('figureNative'),
        expand: t('figureExpand'), collapse: t('figureCollapse') }} />}
    {doc && menu && <SelectionMenu x={menu.x} y={menu.y} title={t('selectionMenu')} close={closeMenu} items={[
      ...(['yellow', 'green', 'blue', 'underline'] as const).map(color => ({ label: t(color), color, disabled: busy, run: () => {
        if (typeof Highlight === 'undefined') { setError(t('highlightUnsupported')); return }
        void run({ action: 'highlight', path: doc.path, revision: doc.current.id, blockId: menu.block.id, ...menu.anchor, color })
          .then((saved) => { if (saved) { window.getSelection()?.removeAllRanges(); setNotice(t('highlightSaved')) } })
      } })),
      { label: t('annotate'), run: () => {
        setEditing(true)
        requestAnimationFrame(() => content.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus())
      } },
      { label: t('copy'), run: () => {
        void navigator.clipboard.writeText(menu.anchor.quote).then(() => { setNotice(t('copied')) }, () => { setError(t('copyFailed')) })
      } },
      { label: t(focusReading ? 'exitFocus' : 'focusReading'), run: () => { setFocusReading(!focusReading) } },
      { label: t('ask'), run: () => { attach(`${t('askIntent')} ${menu.anchor.quote}`, [], menu.block) } },
      { label: t('mark'), disabled: busy, run: () => { mark(menu.block, false) } },
    ]} />}
  </section>
}

const historyKeys: Record<string, PaperReviewKey> = { imported: 'imported', annotated: 'annotated', proposed: 'proposed', revised: 'proposalRevised', resolved: 'resolved', reopened: 'reopened', reviewed: 'mark', 'reviewed-and-locked': 'lock', accepted: 'accepted', rejected: 'rejected', unlocked: 'unlocked', highlighted: 'highlightSaved', 'highlight-removed': 'removeHighlight', 'highlight-restored': 'restoreHighlight' }
