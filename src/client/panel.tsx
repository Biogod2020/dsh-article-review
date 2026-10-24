/** Version-pinned reader, annotation batches, proposal decisions and cumulative human-review diffs. */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { diffWordsWithSpace } from 'diff'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Annotation, BibliographyView, FigureReplacement, FileListing, PaperCommand, PaperBlock, PaperRevision, Proposal } from '../schema.ts'
import type { WorkbenchView } from '../workbench-view.ts'
import { useRevisionPair } from './revision-pair.ts'
import { useNearViewport } from './near-viewport.ts'
import { ChangeEvidence } from './change-evidence.tsx'
import { pendingReviewQueue, filterReviewQueue, needsJudgment } from '../review-queue.ts'
import type { QueueFilter } from '../review-queue.ts'
import { reviewContext } from './context.ts'
import { attachContext } from './composer.ts'
import { ReaderText } from './reader-text.tsx'
import { RenderedDiffText, renderedChangePair, renderedPlainText } from './rendered-diff.tsx'
import { SelectionMenu } from './selection-menu.tsx'
import { authoredFigureBase, collectFigures, figureFilePath, pinnedFigure } from './figures.ts'
import type { PaperFigure } from './figures.ts'
import { FigureGallery } from './figure-gallery.tsx'
import { FigurePreview } from './figure-preview.tsx'
import { FigureCompanion } from './figure-companion.tsx'
import { FigurePeek, FigureWindow } from './figure-window.tsx'
import type { FigureAnchor } from './figure-window.tsx'
import { readingFigures, relatedReadingFigures } from './reading-figures.ts'
import { readingSections, sectionForBlock } from './reading-sections.ts'
import { readingColumnRatio, resolveFigurePlacement } from './figure-layout.ts'
import { attachedPanelTargets } from '../figure-panels.ts'
import readingCss from './reading.module.css'
import { readingBlocks, reviewableBlocks } from '../review-blocks.ts'
import { ReviewProgress } from './review-progress.tsx'
import { blockPreview, reviewNavigation } from './review-navigation.ts'
import { capturePaperPosition, restorePaperPosition, revealPaperTarget } from './reader-scroll.ts'
import type { PaperScrollPosition } from './reader-scroll.ts'
import { PaperFind, searchableBlocks } from './paper-find.tsx'
import { ArticleImport } from './article-import.tsx'
import type { ArticleInput } from '../article-input.ts'
import type { SearchableBlock } from './paper-find.tsx'
import { PaperIcon } from './icons.tsx'
import { Versions, resolveVersionSelection } from './versions.tsx'
import { References } from './references.tsx'
import { referenceEntryText } from './bib-display.ts'
import { readWorkbenchState, writeWorkbenchState, readAnnotationDrafts, writeAnnotationDrafts } from './workbench-state.ts'
import type { PanelMode, WorkbenchState, AnnotationDrafts, AnnotationDraft } from './workbench-state.ts'
import type { TextAnchor } from './selection.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

function preference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/** Operator actions carried over the authenticated DSH connection. */
export interface PaperPanelActions {
  /** Start the fixed article import skill without replacing a composer draft. */
  startProject?: (input: ArticleInput, signal: AbortSignal, sessionId: string) => Promise<void>
  /** @param command - explicit operator gesture. @param signal - tab lifetime. @returns validated persisted state. */
  command: (command: PaperCommand, signal: AbortSignal, sessionId: string) => Promise<WorkbenchView>
  /** Read one immutable historical body on explicit comparison selection. */
  readRevision: (path: string, revision: string, signal: AbortSignal, sessionId: string) => Promise<PaperRevision>
  /**
   * @param path - workspace-relative folder.
   * @param signal - tab lifetime.
   * @param sessionId - native conversation.
   * @returns bounded file listing for the selected review or preview purpose.
   */
  listFiles: (path: string, signal: AbortSignal, sessionId: string, extension?: 'md' | 'bib' | 'preview') => Promise<FileListing>
  /** @returns selected workspace-relative Markdown path, or null when Finder is canceled. */
  pickFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** @returns manuscript selected by the operator or agent in this conversation. */
  currentFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** Read the manuscript's bound authoritative BibTeX index and citation diagnostics. */
  bibliography: (path: string, signal: AbortSignal, sessionId: string) => Promise<BibliographyView>
  /** Replace explicit `.bib` bindings; no bibliography or manuscript source is edited. */
  bindBibliography: (path: string, files: string[], signal: AbortSignal, sessionId: string) => Promise<BibliographyView>
  /** Choose a workspace `.bib` file in Desktop or on a macOS Web host. */
  pickBibliography: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** Choose a replacement figure in Desktop or on a macOS Web host. */
  pickFigure: (signal: AbortSignal, sessionId: string) => Promise<string | null>
  /** Browse folders and figure files on hosts without Finder. */
  listFigureFiles: (path: string, signal: AbortSignal, sessionId: string) => Promise<FileListing>
  /** Retain old/new figure bytes and create a pending reference change, without writing Markdown. */
  replaceFigure: (path: string, input: FigureReplacement, signal: AbortSignal, sessionId: string) => Promise<WorkbenchView>
  /** @param path - workspace-relative figure. @returns canonical path for native preview. */
  figurePath: (path: string, signal: AbortSignal, sessionId: string) => Promise<string>
  /** @param path - workspace-relative PDF. @returns bounded first-page PNG when a renderer is available. */
  figureThumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  /** @param path - workspace-relative PDF. @returns readable first-page PNG when a renderer is available. */
  figurePage: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>
  /** @param path - workspace-relative figure. @returns complete local bytes within DSH's file limit. */
  figureBytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>
  /** Load the bundled panel skill and start one user-requested turn in this idle conversation. */
  preparePanels: (path: string, revision: string, intent: string, signal: AbortSignal, sessionId: string) => Promise<void>
  /** @param signal - tab lifetime. @param sessionId - idle native conversation. @returns when its normal tools have been restored. */
  leave: (signal: AbortSignal, sessionId: string) => Promise<void>
}

/** Native sidebar props and locale-owned labels. */
export type PaperPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'paperReview'> & PaperPanelActions

/** Word-level changes with unchanged surrounding text. @param props - before and after source. @returns accessible diff. */
export const WordDiff = memo(function WordDiff({ before, after, labels, markdownLabels, findId }: {
  before: string
  after: string
  labels: { compare: string; before: string; after: string; deleted?: string }
  findId?: string | undefined
  markdownLabels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
}): ReactNode {
  const [sourceOpen, setSourceOpen] = useState(false)
  const comparison = useMemo(() => before === after ? undefined : renderedChangePair(before, after), [before, after])
  return <><div className={`${css.renderedPair} ${before === '' ? css.insertedPair : ''}`}>
    {before !== '' && <section data-rendered-before data-find-id={findId ? `${findId}:before` : undefined}><h5>{labels.before}</h5><div data-find-text><RenderedDiffText text={before} opposite={after} side="before" labels={markdownLabels} comparison={comparison?.before ?? null} /></div></section>}
    <section data-rendered-after data-find-id={findId ? `${findId}:after` : undefined}><h5>{labels.after}</h5><div data-find-text>{after === '' && labels.deleted
      ? <p className={css.warning}>{labels.deleted}</p>
      : <RenderedDiffText text={after} opposite={before} side="after" labels={markdownLabels} comparison={comparison?.after ?? null} />}</div></section>
  </div>
  <details className={css.sourceComparison} onToggle={(event) => { setSourceOpen(event.currentTarget.open) }}>
    <summary>{labels.compare}</summary>
    {sourceOpen && <div className={css.diff}>{diffWordsWithSpace(before, after).map((part, index) => part.added
      ? <ins key={index}>{part.value}</ins>
      : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>}
  </details></>
})

/** Defer Markdown parsing until a comparison approaches the review viewport. */
function LazyWordDiff({ before, after, labels, markdownLabels, findId }: Parameters<typeof WordDiff>[0]): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const visible = useNearViewport(root)
  const estimatedHeight = Math.max(150, Math.ceil(Math.max(before.length, after.length) / 50) * 28 + 90)
  return <div ref={root} data-lazy-diff data-find-id={findId}>{visible
    ? <WordDiff before={before} after={after} labels={labels} markdownLabels={markdownLabels} findId={findId} />
    : <div className={css.diffPlaceholder} data-diff-placeholder aria-hidden="true" style={{ minHeight: estimatedHeight }} />}</div>
}

/**
 * Keep the current manuscript fixed while fetching new proposal metadata.
 * @param props - native session input actions, sidebar lifetime and operator transport.
 * @returns manuscript workbench.
 */
export function PaperPanel({
  useTabInfo, useSession, useInput, sessionId, inputActions, t, command, readRevision, listFiles,
  pickFile, currentFile, bibliography, bindBibliography, pickBibliography, pickFigure, listFigureFiles, replaceFigure,
  figurePath, figureThumbnail, figurePage, figureBytes, preparePanels, startProject, leave,
}: PaperPanelProps): ReactNode {
  const tab = useTabInfo().tab
  const running = useSession(s => s.running)
  const input = useInput(s => s)
  const wasRunning = useRef(running)
  const preferenceKey = `paper-review:path:${sessionId}`
  const [path, setPath] = useState(() => preference(preferenceKey) ?? 'article.md')
  const [view, setView] = useState<WorkbenchView>()
  const [incoming, setIncoming] = useState<WorkbenchView>()
  const [workbench, setWorkbench] = useState(() => readWorkbenchState(sessionId, path))
  const workbenchRef = useRef(workbench)
  const [mode, setMode] = useState<PanelMode>(workbench.mode)
  const [drafts, setDrafts] = useState<AnnotationDrafts>({})
  const draftsRef = useRef(drafts)
  const [showDrafts, setShowDrafts] = useState(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const [focusedReference, setFocusedReference] = useState<string>()
  const [recoveringBaseline, setRecoveringBaseline] = useState<string>()
  const [baselineTarget, setBaselineTarget] = useState('')
  const [bib, setBib] = useState<BibliographyView>()
  const [bibPath, setBibPath] = useState('')
  const [bibBusy, setBibBusy] = useState(false)
  const [bibError, setBibError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
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
  const [failedRequest, setFailedRequest] = useState<{ request: PaperCommand; adopt: boolean; uncertain: boolean }>()
  const [notice, setNotice] = useState('')
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  useEffect(() => { setQueueFilter('all') }, [view?.document.path])
  const [source, setSource] = useState(false)
  const [listing, setListing] = useState<FileListing>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const filePickController = useRef<AbortController>()
  const [pickerKind, setPickerKind] = useState<'md' | 'bib' | 'preview'>('md')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [readingToolsOpen, setReadingToolsOpen] = useState(false)
  const readingTools = useRef<HTMLDivElement>(null)
  const readingToolsButton = useRef<HTMLButtonElement>(null)
  const readingToolsMenu = useRef<HTMLDivElement>(null)
  const [readingToolsPosition, setReadingToolsPosition] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number }>()
  const readingToolsId = useId()
  const [headerCollapsed, setHeaderCollapsed] = useState(() => preference('paper-review:toolbar-collapsed') === 'true')
  const [previewFigure, setPreviewFigure] = useState<PaperFigure>()
  const [figureReplacement, setFigureReplacement] = useState<{ figure: PaperFigure; path: string; reason: string }>()
  const [figureListing, setFigureListing] = useState<FileListing>()
  const [figureBusy, setFigureBusy] = useState(false)
  const [preparingPanels, setPreparingPanels] = useState(false)
  const figureDialog = useRef<HTMLDialogElement>(null)
  const baselineDialog = useRef<HTMLDialogElement>(null)
  const figurePickController = useRef<AbortController>()
  const [locatedEdit, setLocatedEdit] = useState<{ blockId: string; proposalId?: string; operation?: 'insert-before' | 'insert-after'; returnTo?: 'references' }>()
  const [pickerBusy, setPickerBusy] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const readingArea = useRef<HTMLDivElement>(null)
  const [readingSize, setReadingSize] = useState({ width: 0, height: 0 })
  const [figurePeek, setFigurePeek] = useState<{ key: string; anchor: FigureAnchor }>()
  const peekTimer = useRef<ReturnType<typeof setTimeout>>()
  const peekTrigger = useRef<HTMLElement>()
  const suppressPeekFocus = useRef(false)
  const figureWindowId = useId()
  const [figureLaunchAnchor, setFigureLaunchAnchor] = useState<FigureAnchor>()
  const [figureAspects, setFigureAspects] = useState<Record<string, number>>({})
  const scrollPositions = useRef(new Map<string, PaperScrollPosition>())
  const releaseNavigation = useRef<() => void>(() => {})
  const pendingReaderRestore = useRef<PaperScrollPosition>()
  const panel = useRef<HTMLElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const controlsId = useId()
  const closeMenu = useCallback(() => { setMenu(undefined) }, [])
  const current = useRef(view)
  current.current = view
  const generation = useRef(0)
  const pickerGeneration = useRef(0)
  const doc = view?.document
  useLayoutEffect(() => {
    const node = readingArea.current
    if (!node) return
    const measure = (): void => { setReadingSize({ width: node.clientWidth, height: node.clientHeight }) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node); window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useEffect(() => {
    if (!readingToolsOpen) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !readingTools.current?.contains(event.target) && !readingToolsMenu.current?.contains(event.target)) setReadingToolsOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setReadingToolsOpen(false); readingToolsButton.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [readingToolsOpen])
  useEffect(() => { setReadingToolsOpen(false) }, [mode, doc?.path])
  const readerLayout = workbench.reader?.layout ?? 'text'
  const readerPaging = workbench.reader?.paging ?? 'continuous'
  const readerPinned = workbench.reader?.pinned ?? false
  const figurePresentation = workbench.reader?.figurePresentation ?? 'peek'
  const figuresDocked = figurePresentation === 'docked'
  const readerFigureWidth = workbench.reader?.figureWidth ?? 'balanced'
  const readerFiguresCollapsed = workbench.reader?.figuresCollapsed ?? false
  useLayoutEffect(() => {
    if (!readingToolsOpen) return
    const place = (): void => {
      const root = panel.current?.getBoundingClientRect(), button = readingToolsButton.current?.getBoundingClientRect()
      if (!root || !button) return
      const below = root.bottom - button.bottom - 12, above = button.top - root.top - 12
      const opensBelow = below >= 220 || below >= above
      setReadingToolsPosition({ right: Math.max(10, root.right - button.right), maxHeight: Math.max(100, Math.min(340, opensBelow ? below : above)),
        ...(opensBelow ? { top: button.bottom - root.top + 6 } : { bottom: root.bottom - button.top + 6 }) })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place) }
  }, [readingToolsOpen, readerLayout, readerFigureWidth, readerFiguresCollapsed])
  const [readingBlockId, setReadingBlockId] = useState<string>()
  const visibleBlocks = useMemo(() => readingBlocks(doc?.current.blocks ?? []), [doc?.current.blocks])
  const sections = useMemo(() => readingSections(visibleBlocks), [visibleBlocks])
  const pageIndex = sectionForBlock(sections, workbench.reader?.sectionBlockId ?? workbench.positions.read?.anchor?.blockId)
  const pageBlocks = readerPaging === 'sections' ? sections[pageIndex]?.blocks ?? [] : visibleBlocks
  const saveWorkbench = (patch: Partial<WorkbenchState> = {}, renderState = true): void => {
    const target = current.current?.document.path
    if (!target) return
    const positions = Object.fromEntries([...scrollPositions.current].filter(([key]) => key.startsWith(`${target}\0`))
      .map(([key, value]) => [key.slice(target.length + 1), value]))
    const next = { ...workbenchRef.current, positions, ...patch }
    workbenchRef.current = next
    if (renderState) setWorkbench(next)
    if (!writeWorkbenchState(sessionId, target, next)) setStorageFailed(true)
  }
  const rememberPosition = (): void => {
    const target = current.current?.document.path, viewport = content.current
    if (target && viewport) {
      const position = mode === 'read' ? capturePaperPosition(viewport) : { top: viewport.scrollTop }
      scrollPositions.current.set(`${target}\0${mode}`, position)
      if (mode === 'read' && position.anchor) setReadingBlockId(position.anchor.blockId)
    }
  }
  const saveDraft = (blockId: string, draft?: AnnotationDraft): void => {
    if (!doc) return
    const next = Object.fromEntries(Object.entries(draftsRef.current).filter(([id]) => id !== blockId))
    if (draft?.comment) next[blockId] = draft
    draftsRef.current = next; setDrafts(next)
    if (!writeAnnotationDrafts(sessionId, doc.path, next)) setStorageFailed(true)
  }
  const figures = useMemo(() => collectFigures(doc?.current.blocks ?? []), [doc?.current.blocks])
  const figureBase = useMemo(() => authoredFigureBase(doc?.current.text ?? ''), [doc?.current.text])
  const figureMedia = useMemo(() => ({ thumbnail: figureThumbnail, bytes: figureBytes, signal: tab.signal, sessionId }),
    [figureThumbnail, figureBytes, tab.signal, sessionId])
  const galleryFigures = useMemo(() => doc ? figures.map(figure => pinnedFigure(doc.current, figure)) : [], [doc?.current, figures])
  const readingItems = useMemo(() => doc ? readingFigures(doc.path, figureBase, doc.current, figures, doc.figurePanels ?? []) : [],
    [doc?.path, doc?.current, doc?.figurePanels, figureBase, figures])
  const activeReadingId = readingBlockId ?? workbench.positions.read?.anchor?.blockId ?? pageBlocks[0]?.id
  const activeReadingBlock = doc?.current.blocks.find(block => block.id === activeReadingId)
  const paragraphFigures = relatedReadingFigures(activeReadingBlock, readingItems)
  const relatedFigures = paragraphFigures.length || readerPaging !== 'sections' ? paragraphFigures
    : [...new Map(pageBlocks.flatMap(block => relatedReadingFigures(block, readingItems)).map(item => [item.key, item])).values()]
  const manualFigure = workbench.reader?.figureSelection === 'manual'
  const lastFigure = readingItems.find(item => item.key === workbench.reader?.figureKey) ?? readingItems[0]
  const companionFigure = readerPinned || manualFigure || figurePresentation === 'floating' ? lastFigure
    : relatedFigures.find(item => item.key === workbench.reader?.figureKey) ?? relatedFigures[0]
  const figureRelation = !readingItems.length ? 'none' : readerPinned ? 'pinned' : companionFigure && relatedFigures.some(item => item.key === companionFigure.key) ? 'linked'
    : manualFigure && companionFigure ? 'manual' : 'none'
  const placementPreference = workbench.reader?.figurePlacement ?? 'auto'
  const figureAspect = figureAspects[companionFigure?.file ?? '']
  const imagePlacement = resolveFigurePlacement(readingSize.width, figureAspect, placementPreference)
  const figurePlacement = !figuresDocked ? 'ambient' : figureRelation === 'none' ? 'empty' : readerFiguresCollapsed ? 'top' : imagePlacement
  const columnRatio = readingColumnRatio(workbench.reader?.columnRatio ?? (readerFigureWidth === 'compact' ? .64 : readerFigureWidth === 'wide' ? .42 : 1.3 / 2.3), readingSize.width)
  const stalePanels = Boolean(doc?.figurePanels?.some(panel => attachedPanelTargets(panel, doc.current).length !== panel.targets.length))
  const saveReader = (patch: Partial<NonNullable<WorkbenchState['reader']>>): void => {
    saveWorkbench({ reader: { layout: 'text', paging: 'continuous', ...workbenchRef.current.reader, ...patch } })
  }
  const selectReadingFigure = (figureKey: string): void => {
    saveReader({ figureKey, figureSelection: 'manual', ...(activeReadingId ? { manualBlockId: activeReadingId } : {}) })
  }
  const peekFigure = readingItems.find(item => item.key === figurePeek?.key)
  const previewing = Boolean(figurePeek && peekFigure && figurePresentation === 'peek')
  const floatingFigure = figurePresentation === 'floating' ? companionFigure : peekFigure
  const keepFigurePeek = (): void => { clearTimeout(peekTimer.current) }
  const closeFigurePeek = (): void => { clearTimeout(peekTimer.current); setFigurePeek(undefined) }
  const leaveFigurePeek = (): void => { clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => { const focus = document.activeElement; if (focus && (peekTrigger.current === focus || document.getElementById(figureWindowId)?.contains(focus))) return; setFigurePeek(undefined) }, 500) }
  const showFigurePeek = (key: string, trigger: HTMLElement, source = 'mouse'): void => {
    clearTimeout(peekTimer.current)
    if (source === 'touch' || (source === 'focus' && suppressPeekFocus.current)) return
    if (source !== 'focus') suppressPeekFocus.current = false
    if (figurePresentation !== 'peek') return
    const area = readingArea.current?.getBoundingClientRect(), rect = trigger.getBoundingClientRect()
    if (!area) return
    peekTrigger.current = trigger
    const anchor = { x: rect.left - area.left, y: rect.top - area.top, width: rect.width, height: rect.height }
    peekTimer.current = setTimeout(() => { setFigurePeek({ key, anchor }) }, 350)
  }
  const openReadingFigure = (figureKey: string, dock = figuresDocked): void => {
    const area = readingArea.current?.getBoundingClientRect(), trigger = peekTrigger.current?.getBoundingClientRect()
    if (area && trigger && figurePresentation !== 'floating') setFigureLaunchAnchor({ x: trigger.left - area.left, y: trigger.top - area.top, width: trigger.width, height: trigger.height })
    closeFigurePeek()
    saveReader({ figureKey, figureSelection: 'manual', figurePresentation: dock ? 'docked' : 'floating', figuresCollapsed: false, ...(activeReadingId ? { manualBlockId: activeReadingId } : {}) })
  }
  useEffect(() => { closeFigurePeek(); return () => { clearTimeout(peekTimer.current) } }, [mode, doc?.path, readerLayout, pageIndex])
  useEffect(() => {
    const node = content.current
    const scroll = (): void => { closeFigurePeek() }
    node?.addEventListener('scroll', scroll, { passive: true })
    return () => { node?.removeEventListener('scroll', scroll) }
  }, [doc?.path])
  const changeReading = (patch: Partial<NonNullable<WorkbenchState['reader']>>): void => {
    rememberPosition()
    const position = doc && scrollPositions.current.get(`${doc.path}\0read`)
    const blockId = position?.anchor?.blockId ?? pageBlocks[0]?.id
    if (doc && blockId && !position?.anchor) scrollPositions.current.set(`${doc.path}\0read`, { top: 0, anchor: { blockId, offset: 140 } })
    if (doc) pendingReaderRestore.current = scrollPositions.current.get(`${doc.path}\0read`)
    releaseNavigation.current()
    saveReader({ ...patch, ...(blockId ? { sectionBlockId: blockId } : {}) })
  }
  const ensureReadingBlock = (blockId: string): void => {
    setReadingBlockId(blockId)
    if (readerPaging !== 'sections' || sections[pageIndex]?.blocks.some(block => block.id === blockId)) return
    if (doc) scrollPositions.current.set(`${doc.path}\0read`, { top: 0, anchor: { blockId, offset: 140 } })
    if (doc) pendingReaderRestore.current = scrollPositions.current.get(`${doc.path}\0read`)
    saveReader({ sectionBlockId: blockId })
  }
  const turnSection = (index: number): void => {
    const first = sections[index]?.blocks[0]
    if (!doc || !first) return
    releaseNavigation.current()
    scrollPositions.current.set(`${doc.path}\0read`, { top: 0, anchor: { blockId: first.id, offset: 140 } })
    pendingReaderRestore.current = scrollPositions.current.get(`${doc.path}\0read`)
    saveReader({ sectionBlockId: first.id, figureSelection: 'follow' })
    setReadingBlockId(first.id)
  }
  useEffect(() => {
    if (mode !== 'read' || readerLayout !== 'figures' || readerPinned || figurePresentation === 'floating') return
    if (manualFigure) {
      if (workbench.reader?.manualBlockId && activeReadingId && workbench.reader.manualBlockId !== activeReadingId
        && relatedFigures.length > 0 && !relatedFigures.some(item => item.key === workbench.reader?.figureKey)) saveReader({ figureSelection: 'follow' })
      return
    }
    const related = relatedFigures.find(item => item.key === workbenchRef.current.reader?.figureKey) ?? relatedFigures[0]
    if (related && related.key !== workbenchRef.current.reader?.figureKey) saveReader({ figureKey: related.key })
  }, [mode, readerLayout, readerPinned, activeReadingId, manualFigure, readingItems, pageIndex, figurePresentation])
  const figuresByBlock = useMemo(() => {
    const grouped = new Map<string, PaperFigure[]>()
    for (const figure of figures) grouped.set(figure.blockId, [...(grouped.get(figure.blockId) ?? []), figure])
    return grouped
  }, [figures])
  const copyLabel = t('copy'), copiedLabel = t('copied'), footnotes = t('footnotes')
  const labels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const compareLabel = t('compare'), originalLabel = t('original'), revisedLabel = t('revised')
  const deletedLabel = t('deleteBlock')
  const diffLabels = useMemo(() => ({ compare: compareLabel, before: originalLabel, after: revisedLabel, deleted: deletedLabel }),
    [compareLabel, originalLabel, revisedLabel, deletedLabel])
  const cancelNavigation = useCallback(() => { releaseNavigation.current() }, [])

  const changeMode = (next: PanelMode, keepLocation = false): void => {
    if (next === mode) return
    rememberPosition()
    saveWorkbench({ mode: next }, false)
    releaseNavigation.current()
    if (!keepLocation) setLocatedEdit(undefined)
    setNotice('')
    setMode(next)
  }

  useLayoutEffect(() => {
    if (!doc) return
    const saved = readWorkbenchState(sessionId, doc.path)
    // Fresh illustrated articles start with unobtrusive inline previews; an
    // existing reader choice always wins, including an explicit text-only view.
    if (!saved.reader && collectFigures(doc.current.blocks).length)
      saved.reader = { layout: 'figures', paging: 'continuous', figurePresentation: 'peek' }
    workbenchRef.current = saved; setWorkbench(saved); setMode(saved.mode)
    for (const [item, position] of Object.entries(saved.positions)) scrollPositions.current.set(`${doc.path}\0${item}`,
      { top: position.top, ...(position.anchor ? { anchor: position.anchor } : {}) })
    const storedDrafts = readAnnotationDrafts(sessionId, doc.path)
    draftsRef.current = storedDrafts; setDrafts(storedDrafts)
    const selected = saved.selectedBlockId ?? ''
    selectedRef.current = selected
    setSelectedId(selected); setComment(storedDrafts[selected]?.comment ?? '')
    setQuote(storedDrafts[selected]?.quote ?? ''); setAnchor(storedDrafts[selected]?.anchor)
  }, [doc?.path, sessionId])

  useEffect(() => {
    if (!doc || !content.current) return
    const viewport = content.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const targetPath = doc.path
    const flush = (): void => { clearTimeout(timer); if (current.current?.document.path === targetPath) saveWorkbench({}, false) }
    const scroll = (): void => { rememberPosition(); clearTimeout(timer); timer = setTimeout(flush, 200) }
    const pagehide = (): void => {
      // Lazy blocks may change the visible anchor without a final scroll event.
      if (current.current?.document.path === targetPath) rememberPosition()
      flush()
    }
    viewport.addEventListener('scroll', scroll, { passive: true })
    window.addEventListener('pagehide', pagehide)
    return () => { viewport.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', pagehide); flush() }
  }, [doc?.path, mode, sessionId])

  useLayoutEffect(() => { releaseNavigation.current() }, [doc?.path, doc?.current.id])

  useLayoutEffect(() => {
    const viewport = content.current
    if (!doc || !viewport || (!pendingReaderRestore.current && locatedEdit && (mode === 'read' || mode === 'changes'))) return
    releaseNavigation.current()
    const position = (mode === 'read' && pendingReaderRestore.current) || scrollPositions.current.get(`${doc.path}\0${mode}`) || { top: 0 }
    pendingReaderRestore.current = undefined
    releaseNavigation.current = restorePaperPosition(viewport, position)
    return () => { releaseNavigation.current() }
  }, [mode, doc?.path, doc?.current.id, locatedEdit, readerLayout, readerPaging, pageIndex, readerFigureWidth, readerFiguresCollapsed, figurePlacement, columnRatio, readingSize.width])

  const revealTarget = useCallback((selector: string, placeholder?: string): void => {
    releaseNavigation.current()
    // Selection adds actions and removes the previous block's actions; measure after that commit.
    const frame = requestAnimationFrame(() => {
      const viewport = content.current
      const target = viewport?.querySelector<HTMLElement>(selector)
      releaseNavigation.current = viewport && target ? revealPaperTarget(viewport, target, placeholder) : () => {}
    })
    releaseNavigation.current = () => { cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => () => { releaseNavigation.current() }, [])
  useEffect(() => () => { figurePickController.current?.abort() }, [])
  useEffect(() => {
    if (figureReplacement && figureDialog.current && !figureDialog.current.open) figureDialog.current.showModal()
  }, [figureReplacement])
  useEffect(() => {
    if (recoveringBaseline && baselineDialog.current && !baselineDialog.current.open) baselineDialog.current.showModal()
  }, [recoveringBaseline])
  useEffect(() => {
    if (!locatedEdit || (mode !== 'read' && mode !== 'changes')) return
    const frame = requestAnimationFrame(() => {
      const selector = mode === 'read' ? `[data-block="${CSS.escape(locatedEdit.blockId)}"]`
        : locatedEdit.proposalId ? `[data-proposal="${CSS.escape(locatedEdit.proposalId)}"]`
          : `[data-review-baseline="${CSS.escape(locatedEdit.blockId)}"]`
      revealTarget(selector, mode === 'read' ? '[data-reader-placeholder]' : '[data-diff-placeholder]')
    })
    return () => { cancelAnimationFrame(frame) }
  }, [mode, locatedEdit, doc?.current.id, revealTarget])

  const restore = (next: WorkbenchView): void => {
    if (readWorkbenchState(sessionId, next.document.path).positions.read || mode !== 'read') return
    const blockId = next.document.reading[sessionId]
    if (blockId) requestAnimationFrame(() => content.current?.querySelector(`[data-block="${CSS.escape(blockId)}"]`)?.scrollIntoView({ block: 'start' }))
  }
  const run = async (request: PaperCommand, adopt = true): Promise<boolean> => {
    if (request.action === 'open' && current.current?.document.path !== request.path) { rememberPosition(); saveWorkbench({}, false) }
    const seq = ++generation.current
    setBusy(true); setError(''); setNotice(''); setFailedRequest(undefined)
    try {
      const next = await command(request, tab.signal, sessionId)
      if (seq !== generation.current || tab.signal.aborted) return false
      const changesReader = adopt && (request.action === 'open' || request.action === 'refresh'
        || (request.action === 'decide' && request.accept))
      if (!changesReader && current.current && next.document.current.id !== current.current.document.current.id) setIncoming(next)
      else { setView(next); setIncoming(undefined) }
      if (request.action === 'open' && adopt) setControlsOpen(false)
      try { localStorage.setItem(preferenceKey, next.document.path) } catch { setStorageFailed(true) }
      if (!current.current || request.action === 'refresh') restore(next)
      return true
    } catch (caught) {
      if (!tab.signal.aborted && seq === generation.current) {
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(request.action === 'open' && /ENOENT/.test(message) ? `${t('fileMissing')} ${request.path}` : message)
        setFailedRequest({ request, adopt, uncertain: request.action !== 'open'
          && /fetch|network|connection|disconnect|timeout|timed out/i.test(message) })
      }
      return false
    } finally { if (seq === generation.current) setBusy(false) }
  }

  const recoverFailure = async (): Promise<void> => {
    if (!failedRequest) return
    setBusy(true)
    try {
      const next = await command({ action: 'open', path: failedRequest.request.path }, tab.signal, sessionId)
      if (tab.signal.aborted) return
      if (current.current && next.document.current.id !== current.current.document.current.id) {
        setIncoming(next)
        setView({ ...next, document: { ...next.document, current: current.current.document.current } })
      } else setView(next)
      const request = failedRequest.request
      const decided = request.action === 'decide' && next.document.proposals.find(p => p.id === request.proposalId)?.status
      if (decided && decided !== 'pending') { setFailedRequest(undefined); setError(''); setNotice(t('operationSettled')) }
      else {
        const safeRetry = !next.diskChanged && (!('revision' in request) || request.revision === next.document.current.id)
          && (request.action === 'decide' || request.action === 'open' || request.action === 'review'
            || request.action === 'resolve' || request.action === 'set-highlight' || request.action === 'unlock')
        setFailedRequest({ ...failedRequest, uncertain: !safeRetry })
        setNotice(t('statusChecked'))
      }
    } catch (caught) { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { if (!tab.signal.aborted) setBusy(false) }
  }

  const browse = async (directory: string, kind = pickerKind): Promise<void> => {
    const seq = ++pickerGeneration.current
    setPickerBusy(true); setPickerError('')
    try {
      const next = await listFiles(directory, tab.signal, sessionId, kind)
      if (seq === pickerGeneration.current && !tab.signal.aborted) setListing(next)
    } catch (caught) {
      if (seq === pickerGeneration.current && !tab.signal.aborted) setPickerError(caught instanceof Error ? caught.message : String(caught))
    } finally { if (seq === pickerGeneration.current) setPickerBusy(false) }
  }

  const chooseFile = async (): Promise<void> => {
    filePickController.current?.abort()
    const controller = new AbortController()
    filePickController.current = controller
    const signal = AbortSignal.any([tab.signal, controller.signal])
    setPickerBusy(true); setPickerError(''); setError('')
    try {
      const selected = await pickFile(signal, sessionId)
      if (!selected || signal.aborted) return
      setPath(selected); setPickerOpen(false)
      void run({ action: 'open', path: selected })
    } catch (caught) {
      if (signal.aborted) return
      const message = caught instanceof Error ? caught.message : String(caught)
      setPickerError(message)
    } finally { if (filePickController.current === controller) { filePickController.current = undefined; setPickerBusy(false) } }
  }

  const exitMode = async (): Promise<void> => {
    const seq = ++generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      await leave(tab.signal, sessionId)
      if (seq !== generation.current || tab.signal.aborted) return
      try { localStorage.removeItem(preferenceKey) } catch { setStorageFailed(true) }
      setView(undefined); setIncoming(undefined); setSelectedId(''); setSelectedNotes([])
      setPath('article.md'); changeMode('read'); setPickerOpen(false)
    } catch (caught) {
      if (seq === generation.current && !tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally { if (seq === generation.current) setBusy(false) }
  }

  useEffect(() => {
    void currentFile(tab.signal, sessionId).then((selected) => {
      const saved = selected ?? preference(preferenceKey)
      if (saved && !tab.signal.aborted) void run({ action: 'open', path: saved })
    }).catch((caught: unknown) => { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) })
    return () => { generation.current += 1; pickerGeneration.current += 1 }
    // The native slot remounts for another session. Requests use the tab's own lifetime.
  }, [preferenceKey])

  useEffect(() => {
    const requested = tab.navigation?.params?.paperPath
    if (typeof requested === 'string' && requested && requested !== current.current?.document.path && !tab.signal.aborted)
      void run({ action: 'open', path: requested })
    // Explicit agent opens switch documents using each document's saved reading state.
  }, [tab.navigation?.revision])

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
    setMenu(undefined)
    const draft = draftsRef.current[selectedRef.current]
    setAnchor(draft?.anchor); setQuote(draft?.quote ?? '')
    setEditing(mode === 'read' && Boolean(draft?.comment))
    setPreviewFigure(undefined)
  }, [doc?.path, doc?.current.id, mode])
  useEffect(() => {
    figurePickController.current?.abort()
    setLocatedEdit(undefined); setFigureReplacement(undefined); setFigureListing(undefined)
  }, [doc?.path, doc?.current.id])

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
    filePickController.current?.abort()
    const controller = new AbortController()
    filePickController.current = controller
    const signal = AbortSignal.any([tab.signal, controller.signal])
    setBibBusy(true); setBibError(''); setPickerError('')
    try {
      const selected = await pickBibliography(signal, sessionId)
      if (selected && !signal.aborted && !bib?.files.includes(selected)) {
        setPickerOpen(false); await updateBib([...(bib?.files ?? []), selected])
      }
    } catch (caught) { if (!signal.aborted) setPickerError(caught instanceof Error ? caught.message : String(caught)) }
    finally { if (filePickController.current === controller) { filePickController.current = undefined; setBibBusy(false) } }
  }

  useEffect(() => {
    setSelectedNotes([]); setSource(false); setShowHighlights(false); setShowNotes(false); setShowDrafts(false); setFocusReading(false)
    setRecoveringBaseline(undefined); setBaselineTarget(''); setFocusedReference(undefined)
  }, [doc?.path])

  useEffect(() => {
    if (!pickerOpen) filePickController.current?.abort()
    return () => { filePickController.current?.abort() }
  }, [pickerOpen])

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
    const path = figure.file ?? figureFilePath(doc.path, figureBase, figure.path)
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
  const startPanelPreparation = async (): Promise<void> => {
    if (!doc || running || preparingPanels) return
    setPreparingPanels(true); setError(''); setNotice('')
    try {
      await preparePanels(doc.path, doc.current.id, t('preparePanelsIntent'), tab.signal, sessionId)
      if (!tab.signal.aborted) setNotice(t('panelTaskStarted'))
    } catch (error) { if (!tab.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (!tab.signal.aborted) setPreparingPanels(false) }
  }
  const focusBlock = (block: PaperBlock): void => {
    releaseNavigation.current()
    ensureReadingBlock(block.id)
    setSelectedId(block.id)
    if (block.id !== selectedId) {
      const draft = draftsRef.current[block.id]
      setComment(draft?.comment ?? ''); setQuote(draft?.quote ?? ''); setAnchor(draft?.anchor)
      setEditing(Boolean(draft?.comment)); setSource(false)
    }
    saveWorkbench({ selectedBlockId: block.id }, false)
    setLocatedEdit(undefined)
    if (doc) void command({ action: 'position', path: doc.path, reader: sessionId, blockId: block.id }, tab.signal, sessionId).catch(() => { /* Position is advisory; manuscript operations report their own failures. */ })
  }
  const locateProposalEdit = (proposalId: string, edit: Proposal['edits'][number]): void => {
    const block = doc?.current.blocks.find(candidate => candidate.id === edit.blockId && candidate.text === edit.before)
    if (!block) return
    focusBlock(block)
    setLocatedEdit({ blockId: block.id, proposalId, ...(edit.operation ? { operation: edit.operation } : {}) })
    changeMode('read', true)
  }
  const browseFigures = async (directory: string): Promise<void> => {
    setFigureBusy(true)
    try { setFigureListing(await listFigureFiles(directory, tab.signal, sessionId)) }
    catch (caught) { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setFigureBusy(false) }
  }
  const chooseReplacement = async (): Promise<void> => {
    const controller = new AbortController()
    figurePickController.current = controller
    const signal = AbortSignal.any([tab.signal, controller.signal])
    setFigureBusy(true); setError('')
    try {
      const selected = await pickFigure(signal, sessionId)
      if (selected && !signal.aborted) setFigureReplacement(current => current && { ...current, path: selected })
    } catch (caught) {
      if (!signal.aborted) {
        const message = caught instanceof Error ? caught.message : String(caught)
        if (message.includes('requires macOS')) await browseFigures('')
        else setError(message)
      }
    } finally {
      if (figurePickController.current === controller) { figurePickController.current = undefined; setFigureBusy(false) }
    }
  }
  const submitFigure = async (): Promise<void> => {
    if (!doc || !figureReplacement) return
    const targetPath = doc.path, targetRevision = doc.current.id
    setFigureBusy(true); setError('')
    try {
      const next = await replaceFigure(targetPath, { revision: targetRevision, blockId: figureReplacement.figure.blockId,
        figure: figureReplacement.figure.path, replacement: figureReplacement.path, reason: figureReplacement.reason,
      }, tab.signal, sessionId)
      if (!tab.signal.aborted && current.current?.document.path === targetPath && current.current.document.current.id === targetRevision) {
        setView(next); setFigureReplacement(undefined); setFigureListing(undefined); changeMode('changes')
      }
    } catch (caught) { if (!tab.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setFigureBusy(false) }
  }
  const selectText = (block: PaperBlock): void => {
    const selection = window.getSelection()
    const raw = selection?.toString().trim() ?? ''
    focusBlock(block)
    if (!raw) return
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
  const activeBaselines = useMemo(() => doc?.baselines.filter(base => !base.archivedAt) ?? [], [doc?.baselines])
  const baselinesByBlock = useMemo(() => new Map(activeBaselines.map(base => [base.blockId, base])), [activeBaselines])
  const progressBlocks = useMemo(() => reviewableBlocks(doc?.current.blocks ?? []), [doc?.current.blocks])
  const locations = useMemo(() => reviewNavigation(progressBlocks).locations, [progressBlocks])
  const notesFor = (blockId: string): Annotation[] => annotationsByBlock.get(blockId) ?? []
  const pending = useMemo(() => pendingReviewQueue(doc?.proposals ?? []), [doc?.proposals])
  const visiblePending = useMemo(() => filterReviewQueue(pending, queueFilter), [pending, queueFilter])
  const conflict = (proposal: Proposal): boolean => view?.diskChanged === true || incoming !== undefined
    || proposal.edits.some(edit =>
      doc?.current.blocks.find(b => b.id === edit.blockId)?.text !== edit.before
    || doc.baselines.some(b => !b.archivedAt && b.blockId === edit.blockId && b.locked))
  const reviewChanges = activeBaselines.filter(base => doc?.current.blocks.find(b => b.id === base.blockId)?.text !== base.text)
  const versionSelection = doc ? resolveVersionSelection(doc, workbench.versions) : undefined
  const versionPair = useRevisionPair(doc, versionSelection, mode === 'versions', readRevision, tab.signal, sessionId)
  const findEntries = useCallback((): SearchableBlock[] => {
    if (!doc) return []
    const plain = (text: string): string => renderedPlainText(text) ?? text
    if (mode === 'read') return searchableBlocks(visibleBlocks, bib)
    if (mode === 'references') return bib?.entries.map(entry => ({ id: `bib:${entry.key}`, text: referenceEntryText(entry) })) ?? []
    if (mode === 'history') return [...doc.history].reverse().map((event, index) => ({ id: `history:${index}`,
      text: `${new Date(event.at).toLocaleString()} ${t(historyKeys[event.action] ?? 'history')} ${event.detail}` }))
    if (mode === 'versions' && versionSelection) {
      const before = versionPair.revisions.find(revision => revision.id === versionSelection.leftRevisionId)
      const after = versionPair.revisions.find(revision => revision.id === versionSelection.rightRevisionId)
      if (!before || !after) return []
      if (versionSelection.layout === 'inline') return [{ id: 'version:inline:source', text: diffWordsWithSpace(before.text, after.text).map(part => part.value).join('') }]
      if (versionSelection.layout === 'split') return [{ id: 'version:left:source', text: before.text }, { id: 'version:right:source', text: after.text }]
      return [...searchableBlocks(before.blocks, bib).map(block => ({ ...block, id: `version:left:${block.id}` })),
        ...searchableBlocks(after.blocks, bib).map(block => ({ ...block, id: `version:right:${block.id}` }))]
    }
    return [...visiblePending.flatMap(proposal => [{ id: `proposal:${proposal.id}`, text: `${proposal.id} ${proposal.reason}` },
      ...proposal.edits.flatMap((edit, index) => {
        const targetId = `proposal:${proposal.id}:${index}`
        return [{ id: `${targetId}:before`, targetId, text: edit.operation ? '' : plain(edit.before) },
          { id: `${targetId}:after`, targetId, text: edit.after ? plain(edit.after) : t('deleteBlock') }]
      })]), ...reviewChanges.flatMap((base) => {
      const targetId = `baseline:${base.blockId}`
      const currentBlock = doc.current.blocks.find(block => block.id === base.blockId)
      return [{ id: `${targetId}:before`, targetId, text: plain(base.text) },
        { id: `${targetId}:after`, targetId, text: currentBlock ? plain(currentBlock.text) : t('baselineMissing') }]
    })]
  }, [doc, mode, bib, visibleBlocks, visiblePending, workbench.versions, versionPair.revisions, t])
  const findTarget = useCallback((id: string): void => {
    if (id.startsWith('bib:')) setFocusedReference(id.slice(4))
    else if (mode === 'read') ensureReadingBlock(id)
  }, [mode, readerPaging, pageIndex, sections])
  const compactHeader = Boolean(doc) && headerCollapsed
  const pickerTitle = pickerKind === 'preview' ? 'previewDocuments' : pickerKind === 'md' ? 'browse' : 'bibChoose'

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
        <div className={css.identity}><span className={css.modeBadge} title={t('reviewMode')} aria-label={t('reviewMode')}><PaperIcon kind="read" size={17} /></span>
          {doc && <strong className={css.documentName} title={doc.path}>{doc.path}</strong>}</div>
        {doc && <div className={css.topActions}>
          {!compactHeader && <button className={css.iconOnly} aria-label={t('nativePreview')} title={t('nativePreviewHelp')} onClick={() => {
            tab.actions.openResource(fileAddressFor(sessionId, undefined, doc.path), { preferNewPane: true })
          }}><PaperIcon kind="preview" /></button>}
          {!compactHeader && <button className={`${css.refresh} ${css.iconOnly}`} aria-label={busy ? t('loading') : t('check')}
            title={busy ? t('loading') : t('check')} disabled={busy} onClick={() => { void run({ action: 'open', path: doc.path }, false) }}>
            <PaperIcon kind="refresh" />
          </button>}
          {!compactHeader && <button className={css.iconOnly} aria-expanded={controlsOpen} aria-controls={controlsId}
            aria-label={t(controlsOpen ? 'hideControls' : 'showControls')} title={t(controlsOpen ? 'hideControls' : 'showControls')}
            onClick={() => { setControlsOpen(!controlsOpen) }}><PaperIcon kind="folder" /></button>
          }
          <button className={`${css.toolbarToggle} ${css.iconOnly}`} aria-label={t(compactHeader ? 'showToolbar' : 'hideToolbar')}
            title={t(compactHeader ? 'showToolbar' : 'hideToolbar')} aria-expanded={!compactHeader} onClick={() => {
              const next = !headerCollapsed
              setHeaderCollapsed(next)
              try { localStorage.setItem('paper-review:toolbar-collapsed', String(next)) } catch { setStorageFailed(true) }
            }}><PaperIcon kind={compactHeader ? 'down' : 'up'} /></button>
        </div>}
      </div>
      {!compactHeader && (!doc || controlsOpen) && <div id={controlsId} className={css.fileControls}>
        {startProject && <ArticleImport running={running} t={t} start={(input, signal) => startProject(input, signal, sessionId)} onStarted={() => { setControlsOpen(false) }} />}
        <form className={css.open} onSubmit={(event) => { event.preventDefault(); setSelectedId(''); setQuote(''); setAnchor(undefined); setEditing(false); void run({ action: 'open', path }) }}>
          <input aria-label={t('path')} placeholder={t('pathHint')} value={path} onChange={(event) =>{  setPath(event.target.value) }} />
          <button type="button" disabled={busy || pickerBusy} onClick={() => { setPickerKind('md'); setPickerOpen(true); void browse('', 'md') }}><PaperIcon kind="folder" size={15} />{t('browse')}</button>
          <button disabled={busy || !path.trim()}><PaperIcon kind="read" size={15} />{t('open')}</button>
          <button type="button" disabled={pickerBusy} title={t('nativePreviewHelp')} onClick={() => {
            setPickerKind('preview'); setPickerOpen(true); void browse('', 'preview')
          }}>{t('previewDocuments')}</button>
        </form>
        {doc && <div className={css.summary}><span>{t('notes')} {doc.annotations.filter(a => a.status === 'open').length}</span>
          <span title={doc.current.id}>{t('version')} {doc.current.id.slice(0, 7)}</span></div>}
        {doc && <button className={css.leave} disabled={busy || running} onClick={() => { void exitMode() }}>{t('leave')}</button>}
      </div>}
      {doc && !compactHeader && <nav className={css.tabs} aria-label={t('reviewSections')}>{(['read', 'changes', 'versions', 'history', 'references'] as const).map((item) => {
        return <button key={item} aria-label={t(item)} title={t(item)} aria-pressed={mode === item} onClick={() => { changeMode(item) }}>
          <PaperIcon kind={item} size={15} /><span className={css.tabLabel}>{t(`tab${item}`)}</span>
          {item === 'changes' && pending.length > 0 && <span className={css.count}>{pending.length}</span>}
        </button>
      })}
      </nav>}
    </div>
    {storageFailed && <div className={css.warning} role="status">{t('storageFailed')}</div>}
    {error && <div className={css.error} role="alert"><span>{error}</span>
      {failedRequest?.uncertain && <p>{t('operationUncertain')}</p>}
      {failedRequest && <button disabled={busy} onClick={() => { void recoverFailure() }}>{t('checkOperation')}</button>}
      {failedRequest && !failedRequest.uncertain && <button disabled={busy} onClick={() => { void run(failedRequest.request, failedRequest.adopt) }}>{t('retry')}</button>}
      <button aria-label={t('dismissError')} onClick={() => { setError(''); setFailedRequest(undefined) }}>×</button>
    </div>}
    {notice && <div className={css.notice} role="status">{notice}</div>}
    {pickerOpen && <div className={css.pickerBackdrop} role="presentation" onClick={() => { setPickerOpen(false) }}>
      <div className={css.picker} ref={picker} role="dialog" aria-modal="true" aria-label={t(pickerTitle)}
        onClick={(event) => { event.stopPropagation() }}>
        <div className={css.pickerHeading}><strong>{t(pickerTitle)}</strong><button className={css.iconOnly} aria-label={t('close')}
          title={t('close')} onClick={() => { setPickerOpen(false) }}><PaperIcon kind="close" /></button></div>
        <div className={css.pickerCrumbs}><button disabled={pickerBusy || listing?.path === ''} onClick={() => { void browse('') }}>{t('workspace')}</button>
          {listing?.path.split('/').filter(Boolean).map((part, index, parts) => <button key={index} disabled={pickerBusy || index === parts.length - 1}
            onClick={() => { void browse(parts.slice(0, index + 1).join('/')) }}>{part}</button>)}
        </div>
        {pickerBusy && <p>{t('loading')}</p>}
        {pickerError && <p className={css.error} role="alert">{pickerError}</p>}
        {pickerKind === 'preview' && <p>{t('nativePreviewHelp')}</p>}
        {!pickerBusy && listing && <div className={css.pickerEntries}>
          {listing.entries.length === 0 && <p>{t(pickerKind === 'preview' ? 'noPreviewFiles' : pickerKind === 'bib' ? 'noBibFiles' : 'noMarkdown')}</p>}
          {listing.entries.map(entry => <button key={entry.name} onClick={() => {
            const selected = [listing.path, entry.name].filter(Boolean).join('/')
            if (entry.type === 'directory') void browse(selected)
            else if (pickerKind === 'preview') { setPickerOpen(false); tab.actions.openResource(fileAddressFor(sessionId, undefined, selected), { preferNewPane: true }) }
            else if (pickerKind === 'bib') { setPickerOpen(false); void updateBib([...new Set([...(bib?.files ?? []), selected])]) }
            else { setPath(selected); setPickerOpen(false); void run({ action: 'open', path: selected }) }
          }}>{entry.type === 'directory' ? '▸' : '▤'} {entry.name}</button>)}
          {listing.truncated && <p>{t('truncated')}</p>}
        </div>}
        {pickerKind !== 'preview' && <button disabled={pickerBusy || bibBusy} onClick={() => { void (pickerKind === 'md' ? chooseFile() : chooseBib()) }}>{t('hostPicker')}</button>}
      </div>
    </div>}
    {(view?.diskChanged || incoming) && <div className={css.banner} role="status"><span>{t(incoming ? 'newVersion' : 'external')}</span>
      <button disabled={busy} onClick={() => {
        if (incoming) { setView(incoming); setIncoming(undefined); restore(incoming) }
        else if (doc) void run({ action: 'refresh', path: doc.path, revision: doc.current.id })
        setSelectedId(''); setEditing(false)
      }}>{t('load')}</button></div>}
    <div className={readingCss.workarea} ref={readingArea} data-reader-layout={mode === 'read' ? readerLayout : 'text'}
      data-figure-placement={figurePlacement} data-figure-width={readerFigureWidth}
      style={{ '--reader-text-width': `${columnRatio * 100}%`, '--figure-top-height': `${Math.max(220, Math.min(readingSize.height * .55 || 420, (readingSize.width - 24) / (figureAspect || 3) + 148))}px` } as CSSProperties}>
    <div className={css.content} ref={content} data-paper-scroll data-section-pages={mode === 'read' && readerPaging === 'sections'}>
      {doc && <PaperFind key={`find:${doc.path}`} panel={panel} content={content} blocks={visibleBlocks} bibliography={bib}
        mode={mode} entries={findEntries} onTarget={findTarget} onRead={() => { changeMode('read') }} onNavigate={cancelNavigation} t={t} />}
      {!doc && <div className={css.welcome}><span className={css.monogram}>¶</span><h2>{t('title')}</h2><p>{t('empty')}</p><p>{t('intro')}</p></div>}
      {doc && mode === 'read' && <>
        <div className={css.readToolbar} data-read-toolbar data-paged={readerPaging === 'sections'}>
          <div className={readingCss.readingOptions}>
            <label><span className={css.srOnly}>{t('readingLayout')}</span><select aria-label={t('readingLayout')} title={t('readingLayout')} value={readerLayout}
              onChange={event => { changeReading({ layout: event.target.value === 'figures' ? 'figures' : 'text' }) }}>
              <option value="text">{t('textOnly')}</option><option value="figures">{t('textFigures')}</option>
            </select></label>
            <label><span className={css.srOnly}>{t('readingPaging')}</span><select aria-label={t('readingPaging')} title={t('readingPaging')} value={readerPaging}
              onChange={event => { changeReading({ paging: event.target.value === 'sections' ? 'sections' : 'continuous' }) }}>
              <option value="continuous">{t('continuousReading')}</option><option value="sections">{t('sectionReading')}</option>
            </select></label>
          </div>
          {readerPaging === 'sections' && <nav className={readingCss.sectionSwitch} aria-label={t('sectionReading')}>
            <button aria-label={t('previousSection')} title={t('previousSection')} disabled={pageIndex === 0} onClick={() => { turnSection(pageIndex - 1) }}>‹</button>
            <select aria-label={t('readingSection')} value={pageIndex} onChange={event => { turnSection(Number(event.target.value)) }}>
              {sections.map((section, index) => <option key={section.id} value={index}>{`${'\u2003'.repeat(Math.min(3, Math.max(0, section.level - 2)))}${section.title || t('sectionPreamble')}`}</option>)}
            </select><output aria-live="polite">{pageIndex + 1}/{sections.length}</output>
            <button aria-label={t('nextSection')} title={t('nextSection')} disabled={pageIndex >= sections.length - 1} onClick={() => { turnSection(pageIndex + 1) }}>›</button>
          </nav>}
          {readerLayout === 'figures' && readingItems.length > 0 && <button className={readingCss.figureLauncher}
            aria-label={t('figureList')} title={t('figurePeekHint')} aria-haspopup="dialog" aria-controls={figureWindowId}
            aria-expanded={figurePresentation === 'floating' || previewing}
            onPointerEnter={event => { const item = relatedFigures[0] ?? lastFigure; if (item) showFigurePeek(item.key, event.currentTarget, event.pointerType) }}
            onPointerLeave={leaveFigurePeek} onFocus={event => { const item = relatedFigures[0] ?? lastFigure; if (item) showFigurePeek(item.key, event.currentTarget, 'focus') }} onBlur={leaveFigurePeek}
            onClick={event => { peekTrigger.current = event.currentTarget; const item = companionFigure ?? lastFigure; if (item) openReadingFigure(item.key, false) }}>
            <PaperIcon kind="image" size={14} /><span>{t('figureList')}</span><small>{figures.length}</small>
          </button>}
          {doc && mode === 'read' && <div className={css.progressAnchor}><ReviewProgress key={`progress:${doc.path}`} blocks={progressBlocks} baselines={activeBaselines} t={t}
        jump={(block) => {
          focusBlock(block)
          revealTarget(`[data-block="${CSS.escape(block.id)}"]`)
        }} /></div>}
          <div className={css.readTools} ref={readingTools}>
          <button ref={readingToolsButton} className={css.readToolsToggle} aria-label={t('readingTools')} title={t('readingToolsHelp')}
            aria-expanded={readingToolsOpen} aria-controls={readingToolsId} onClick={() => { setReadingToolsOpen(!readingToolsOpen) }}>
            <PaperIcon kind="options" size={15} /><span>{t('readingTools')}</span>
          </button>
          {readingToolsOpen && panel.current && createPortal(<div className={css.readToolsMenu} id={readingToolsId} ref={readingToolsMenu}
            style={readingToolsPosition} role="group" aria-label={t('readingTools')}>
          {readerLayout === 'figures' && <label className={css.balanceOption}>{t('figureDisplay')}<select aria-label={t('figureDisplay')} value={figurePresentation}
            onChange={event => { const next = event.target.value as 'peek' | 'floating' | 'docked'; const selected = companionFigure ?? lastFigure; closeFigurePeek(); changeReading({ figurePresentation: next, figuresCollapsed: false, ...(next !== 'peek' && selected ? { figureKey: selected.key, figureSelection: 'manual', ...(activeReadingId ? { manualBlockId: activeReadingId } : {}) } : {}) }) }}>
            <option value="peek">{t('figurePeek')}</option><option value="floating">{t('figureFloating')}</option><option value="docked">{t('figureDocked')}</option>
          </select></label>}
          {readerLayout === 'figures' && figuresDocked && <label className={css.balanceOption}>{t('figureWidth')}<select aria-label={t('figureWidth')} value={readerFigureWidth}
            onChange={event => { const value = event.target.value as 'compact' | 'balanced' | 'wide'; changeReading({ figureWidth: value, columnRatio: value === 'compact' ? .64 : value === 'wide' ? .42 : 1.3 / 2.3 }) }}>
            <option value="compact">{t('figureCompact')}</option><option value="balanced">{t('figureBalanced')}</option><option value="wide">{t('figureWide')}</option>
          </select></label>}
          {readerLayout === 'figures' && figuresDocked && <label className={css.balanceOption}>{t('figurePlacement')}<select aria-label={t('figurePlacement')} value={placementPreference}
            onChange={event => { changeReading({ figurePlacement: event.target.value as 'auto' | 'side' | 'top' }) }}>
            <option value="auto">{t('figureAuto')}</option><option value="side">{t('figureSide')}</option><option value="top">{t('figureTop')}</option>
          </select></label>}
          <button aria-pressed={showHighlights} onClick={() => { setShowHighlights(!showHighlights) }}><PaperIcon kind="edit" size={15} />{t('highlights')} ({doc.highlights.filter(h => !h.removed).length})</button>
          <button aria-pressed={showNotes} onClick={() =>{  setShowNotes(!showNotes) }}><PaperIcon kind="changes" size={15} />{t('allNotes')}</button>
          {Object.keys(drafts).length > 0 && <button aria-pressed={showDrafts} onClick={() => { setShowDrafts(!showDrafts) }}>{t('drafts')} ({Object.keys(drafts).length})</button>}
          <button disabled={!progressBlocks.some(block => baselinesByBlock.get(block.id)?.text !== block.text)} onClick={() => {
            const start = progressBlocks.findIndex(block => block.id === selectedRef.current)
            const order = [...progressBlocks.slice(start + 1), ...progressBlocks.slice(0, start + 1)]
            const next = order.find(block => baselinesByBlock.get(block.id)?.text !== block.text)
            if (next) { focusBlock(next); revealTarget(`[data-block="${CSS.escape(next.id)}"]`) }
          }}><PaperIcon kind="down" size={15} />{t('nextReview')}</button>
          <button aria-pressed={focusReading} onClick={() => {
            if (!focusReading && !selectedRef.current) {
              const at = content.current ? capturePaperPosition(content.current).anchor?.blockId : undefined
              const target = progressBlocks.find(block => block.id === at) ?? progressBlocks.find(block => block.kind === 'paragraph') ?? progressBlocks[0]
              if (target) focusBlock(target)
            }
            setFocusReading(!focusReading)
          }}>
            <PaperIcon kind="read" size={15} />{t(focusReading ? 'exitFocus' : 'focusReading')}</button>
          <button className={css.preparePanelsOption} disabled={running || busy || preparingPanels || view?.diskChanged || Boolean(incoming) || !figures.length}
            title={t('preparePanelsHelp')} onClick={() => { setReadingToolsOpen(false); void startPanelPreparation() }}>
            <PaperIcon kind="sparkle" size={15} />{t(preparingPanels ? 'loading' : 'preparePanels')}</button>
          </div>, panel.current)}
          </div>
        </div>
        {showDrafts && <aside className={css.notes} aria-label={t('drafts')}>
          {Object.entries(drafts).map(([blockId, draft]) => <div className={css.note} key={blockId}>
            <strong>{t('draftLocal')}</strong><blockquote>{draft.quote || draft.source.slice(0, 180)}</blockquote><p>{draft.comment}</p>
            <button disabled={!doc.current.blocks.some(block => block.id === blockId)} onClick={() => {
              const block = doc.current.blocks.find(block => block.id === blockId)
              if (block) { focusBlock(block); setEditing(true); revealTarget(`[data-block="${CSS.escape(blockId)}"]`) }
            }}>{t('locate')}</button>
            <button onClick={() => { void navigator.clipboard.writeText(draft.comment).catch(() => { setError(t('copyFailed')) }) }}>{t('copy')}</button>
          </div>)}
        </aside>}
        {showHighlights && <aside className={css.notes} aria-label={t('highlights')}>
          {doc.highlights.length === 0 && <p>{t('noHighlights')}</p>}
          {doc.highlights.map(highlight => <div className={css.note} key={highlight.id} data-highlight={highlight.id}>
            <strong>{highlight.id} · {t(highlight.color)}</strong>
            <blockquote>{highlight.quote}</blockquote>
            <span>{highlight.anchor === 'needs-location' ? t('detached') : ''} {highlight.removed ? t('removedHighlight') : ''}</span>
            <button disabled={highlight.anchor !== 'attached'} onClick={() => {
              const block = doc.current.blocks.find(b => b.id === highlight.blockId)
              if (block) { focusBlock(block); revealTarget(`[data-block="${CSS.escape(block.id)}"]`) }
            }}>{t('locate')}</button>
            <button disabled={busy} onClick={() => { void run({ action: 'set-highlight', path: doc.path, highlightId: highlight.id, removed: !highlight.removed }) }}>{t(highlight.removed ? 'restoreHighlight' : 'removeHighlight')}</button>
          </div>)}
        </aside>}
        {showNotes && <aside className={css.notes}>{doc.annotations.map(annotationCard)}
          <button disabled={!selectedNotes.length} onClick={() =>{  attach(t('batchIntent'), doc.annotations.filter(a => selectedNotes.includes(a.id) && a.anchor === 'attached')) }}>{t('batch')} ({selectedNotes.length})</button>
        </aside>}
        <article className={`${css.article} ${focusReading ? css.focusReading : ''}`}>{pageBlocks.map((block) => {
          const baseline = baselinesByBlock.get(block.id)
          const state = !baseline ? 'unread' : baseline.text === block.text ? 'reviewed' : 'changed'
          const active = block.id === selectedId
          const provenance = block.start === 0 && block.kind === 'html' && /^\s*<!--/.test(block.text)
          const positioned = locatedEdit?.blockId === block.id ? locatedEdit : undefined
          const blockView = <div key={block.id} data-block={provenance ? undefined : block.id} aria-current={active ? 'true' : undefined} className={`${css.block} ${active ? css.selected : ''}`}>
            <div className={css.margin}><span className={css[state]} title={t(state)}>{state === 'reviewed' ? '✓' : state === 'changed' ? '↺' : '○'}</span>
              {notesFor(block.id).length > 0 && <button onClick={() => { focusBlock(block); setQuote(''); setAnchor(undefined); setEditing(true) }}>{notesFor(block.id).length}</button>}
              {baseline?.locked && <span title={t('locked')}>▣</span>}</div>
            {positioned && positioned.operation !== 'insert-after' && <div className={css.locationMarker} data-location-marker={positioned.operation ?? 'replace'}>
              <span>{positioned.returnTo === 'references' ? t('citationLocated') : `${positioned.proposalId ?? t('baseline')} · ${t(positioned.operation === 'insert-before' ? 'locationBeforeHere' : 'locationReplaceHere')}`}</span>
              <button onClick={() => { changeMode(positioned.returnTo ?? 'changes', true) }}><PaperIcon kind={positioned.returnTo ?? 'changes'} size={13} />{t(positioned.returnTo === 'references' ? 'backToReferences' : positioned.proposalId ? 'backToProposal' : 'backToReview')}</button>
            </div>}
            {provenance
              ? <pre className={css.raw} onMouseUp={() => { selectText(block) }}>{block.text}</pre>
              : <ReaderText block={block} figureReferences={readerLayout === 'figures' ? { items: readingItems, windowId: figureWindowId, selectedKey: previewing || figurePresentation === 'floating' ? floatingFigure?.key : undefined,
                onPreview: showFigurePeek, onLeave: leaveFigurePeek, onOpen: (key, trigger) => { peekTrigger.current = trigger; openReadingFigure(key) } } : undefined} highlights={highlightsByBlock.get(block.id) ?? []}
                annotations={notesFor(block.id)} labels={labels} bibliography={bib}
                onSelect={(selection) => {
                  focusBlock(block)
                  const draft = draftsRef.current[block.id]
                  if (selection || !draft?.comment) {
                    setAnchor(selection); setQuote(selection?.quote ?? ''); setEditing(false)
                    if (draft?.comment && selection) saveDraft(block.id, { ...draft, source: block.text,
                      revision: doc.current.id, quote: selection.quote, anchor: selection })
                  }
                }}
                onMenu={(event, selection) => {
                  if (!selection) {
                    if (window.getSelection()?.toString().trim()) { event.preventDefault(); setError(t('oneBlockSelection')) }
                    return
                  }
                  event.preventDefault(); focusBlock(block); setAnchor(selection); setQuote(selection.quote); setError('')
                  setMenu({ x: event.clientX, y: event.clientY, block, anchor: selection })
                }} />}
            {readerLayout === 'text' && figuresByBlock.get(block.id)?.map((figure) => {
              const pinned = pinnedFigure(doc.current, figure)
              const file = figureFilePath(doc.path, figureBase, pinned.path)
              return file && <FigurePreview key={figure.path} figure={pinned} file={file} media={figureMedia} t={t}
                onOpen={setPreviewFigure} onReplace={() => {
                  setFigureReplacement({ figure, path: '', reason: t('figureReplacementDefault') }); setFigureListing(undefined)
                }} />
            })}
            {readerLayout === 'figures' && figuresByBlock.get(block.id)?.map(figure => <button key={`replace:${figure.path}`}
              onClick={() => { setFigureReplacement({ figure, path: '', reason: t('figureReplacementDefault') }); setFigureListing(undefined) }}>{t('replaceFigure')}</button>)}
            {positioned?.operation === 'insert-after' && <div className={css.locationMarker} data-location-marker="insert-after">
              <span>{positioned.proposalId ?? t('baseline')} · {t('locationAfterHere')}</span>
              <button onClick={() => { changeMode(positioned.returnTo ?? 'changes', true) }}><PaperIcon kind={positioned.returnTo ?? 'changes'} size={13} />{t(positioned.returnTo === 'references' ? 'backToReferences' : positioned.proposalId ? 'backToProposal' : 'backToReview')}</button>
            </div>}
            {active && <div className={css.actions}>
              <button aria-label={t('annotate')} title={t('annotate')} onClick={() =>{  setEditing(!editing) }}><PaperIcon kind="edit" size={14} /><span>{t('annotate')}</span></button>
              <button aria-label={t('ask')} title={t('ask')} onClick={() =>{  attach(`${t('askIntent')} ${quote}`, [], block) }}><PaperIcon kind="sparkle" size={14} /><span>{t('ask')}</span></button>
              <button aria-label={t('suggest')} title={t('suggest')} onClick={() =>{  attach(`${t('suggestIntent')} ${quote}`, notesFor(block.id).filter(a => a.status === 'open'), block) }}><PaperIcon kind="changes" size={14} /><span>{t('suggest')}</span></button>
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
              {drafts[block.id]?.source !== undefined && drafts[block.id]?.source !== block.text && <div className={css.warning} role="status">{t('draftStale')}
                <button onClick={() => { setQuote(''); setAnchor(undefined); saveDraft(block.id, { source: block.text, revision: doc.current.id, quote: '', comment }) }}>{t('draftUseCurrent')}</button></div>}
              <small>{t('draftLocal')}</small>
              <textarea aria-label={t('comment')} placeholder={t('comment')} maxLength={4000} value={comment} onChange={(event) => {
                const value = event.target.value
                setComment(value)
                const previous = draftsRef.current[block.id]
                saveDraft(block.id, { source: previous?.source ?? block.text, revision: previous?.revision ?? doc.current.id,
                  quote: previous?.quote ?? quote, comment: value,
                  ...(previous?.anchor ? { anchor: previous.anchor } : anchor ? { anchor } : {}) })
              }} />
              <button disabled={busy || !comment.trim() || (drafts[block.id] !== undefined && drafts[block.id]?.source !== block.text)}
                onClick={() => {
                  const index = block.text.indexOf(quote)
                  void run({ action: 'annotate', path: doc.path, revision: doc.current.id, blockId: block.id, quote,
                    prefix: anchor?.prefix ?? (quote ? block.text.slice(Math.max(0, index - 32), index) : ''),
                    suffix: anchor?.suffix ?? (quote ? block.text.slice(index + quote.length, index + quote.length + 32) : ''),
                    ...(anchor ? { rendered: true, offset: anchor.offset } : {}), comment,
                  }).then((saved) => { if (saved && draftsRef.current[block.id]?.comment === comment
                  && current.current?.document.path === doc.path) {
                    saveDraft(block.id); if (selectedRef.current === block.id) setComment('')
                  } })
                }}><PaperIcon kind="check" size={15} />{t('save')}</button>
              <button onClick={() => { setEditing(false) }}>{t('keepDraft')}</button>
              <button onClick={() => { setEditing(false); setComment(''); saveDraft(block.id) }}>{t('discardDraft')}</button>
              {notesFor(block.id).map(annotationCard)}
            </div>}
          </div>
          return provenance ? <details key={block.id} data-block={block.id} className={css.provenance}>
            <summary>{t('sourceNote')}</summary>{blockView}
          </details> : blockView
        })}</article>
        {readerPaging === 'sections' && pageIndex < sections.length - 1 && <nav className={readingCss.sectionEnd} aria-label={t('sectionNavigation')}>
          <button onClick={() => { turnSection(pageIndex + 1) }}>{t('nextSection')} → <span>{sections[pageIndex + 1]?.title || t('sectionPreamble')}</span></button>
        </nav>}
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
        {pending.length > 0 && <div className={css.queueControls}>
          <label>{t('queueFilter')} <select value={queueFilter} onChange={event => { setQueueFilter(event.target.value as QueueFilter) }}>
            {(['all', 'attention', 'style', 'structure', 'claim', 'evidence'] as const).map(filter =>
              <option key={filter} value={filter}>{t(filter === 'all' ? 'allProposals' : filter === 'attention' ? 'needsJudgment' : filter)} ({filterReviewQueue(pending, filter).length})</option>)}
          </select></label>
          <span role="status">{t('showing')} {visiblePending.length}/{pending.length}</span>
          {queueFilter !== 'all' && <button onClick={() => { setQueueFilter('all') }}>{t('clearFilter')}</button>}
        </div>}
        {pending.length > 0 && visiblePending.length === 0 && <p>{t('queueEmpty')}</p>}
        {visiblePending.map(proposal => <section className={css.proposal} key={proposal.id} data-proposal={proposal.id} data-risk={needsJudgment(proposal)}>
          <div data-find-id={`proposal:${proposal.id}`} data-find-text><div className={css.proposalTitle}><strong>{proposal.id}</strong><span>{proposal.annotationIds.join(' · ')}</span><span>{t('modelLabel')} {t(proposal.meaning)}</span></div>
            <p>{proposal.reason}</p></div>
          {proposal.flags.length > 0 && <div className={css.flags}>{proposal.flags.map(flag => <span key={flag}>{t(flag)}</span>)}</div>}
          {proposal.edits.map((edit, editIndex) => {
            const target = doc.current.blocks.find(block => block.id === edit.blockId && block.text === edit.before)
            const location = target ? locations.get(target.id) : undefined
            return <div key={`${edit.blockId}:${edit.operation ?? 'replace'}:${editIndex}`}>
              <div className={css.proposalLocation}>
                <div className={css.locationTrail}><span>{location ? location.headings.join(' › ') || t('progressStart') : '—'}</span>
                  <span>{location ? `${t('locationPosition')} ${location.index + 1}/${location.total} · ${Math.round((location.index + 1) / location.total * 100)}%`
                    : t('locationUnavailable')}</span></div>
                <div className={css.locationRow}><span><strong>{t(edit.operation === 'insert-before' ? 'insertBefore'
                  : edit.operation === 'insert-after' ? 'insertAfter' : 'replaceBlock')}</strong>
                {target && <span className={css.locationPreview} title={target.text}>{blockPreview(target, 110)}</span>}</span>
                <button disabled={!location} onClick={() => { locateProposalEdit(proposal.id, edit) }}>
                  <PaperIcon kind="read" size={14} />{t('viewInArticle')}</button></div>
              </div>
              <ChangeEvidence before={edit.operation ? '' : edit.before} after={edit.after} t={t} />
              <LazyWordDiff before={edit.operation ? '' : edit.before} after={edit.after} labels={diffLabels} markdownLabels={labels} findId={`proposal:${proposal.id}:${editIndex}`} />
              {(() => {
                const retained = proposal.figureChanges?.filter(change => change.blockId === edit.blockId) ?? []
                const previewBlock = { id: edit.blockId, kind: 'paragraph', section: '', start: 0, end: 0 }
                const oldFigures = collectFigures([{ ...previewBlock, text: edit.before }])
                const newFigures = collectFigures([{ ...previewBlock, text: edit.after }])
                if (!retained.length && !oldFigures.length && !newFigures.length) return null
                const previews = (side: 'before' | 'after'): ReactNode => (side === 'before' ? oldFigures : newFigures).map((figure) => {
                  const asset = retained.find(change => change[side].path === figure.path)?.[side]
                  const shown = asset ? { ...figure, path: asset.snapshot } : side === 'before' ? pinnedFigure(doc.current, figure) : figure
                  const file = figureFilePath(doc.path, figureBase, shown.path)
                  return file && <FigurePreview key={figure.path} figure={shown} file={file}
                    media={figureMedia} t={t} onOpen={setPreviewFigure} />
                })
                return <div className={css.figureComparison} data-figure-comparison><p>{t('figureCaptionCheck')}</p>
                  <div className={css.figureComparisonPair}><section><h5>{t('figureOld')}</h5>{previews('before')}</section>
                    <section><h5>{t('figureNew')}</h5>{previews('after')}</section></div></div>
              })()}
            </div>
          })}
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
          const location = block ? locations.get(block.id) : undefined
          return <section className={css.proposal} key={base.blockId} data-risk="true" data-review-baseline={base.blockId} data-find-id={`baseline:${base.blockId}`}>
            <div className={css.proposalLocation}><div className={css.locationTrail}><span>{location ? location.headings.join(' › ') || t('progressStart') : '—'}</span>
              <span>{location ? `${t('locationPosition')} ${location.index + 1}/${location.total}` : t('locationUnavailable')}</span></div>
            {block && <div className={css.locationRow}><span className={css.locationPreview}>{blockPreview(block, 110)}</span>
              <button disabled={!location} onClick={() => { focusBlock(block); setLocatedEdit({ blockId: block.id }); changeMode('read', true) }}>
                <PaperIcon kind="read" size={14} />{t('viewInArticle')}</button></div>}
            </div>
            {block ? <LazyWordDiff before={base.text} after={block.text} labels={{ ...diffLabels, before: t('before'), after: t('after') }} markdownLabels={labels} findId={`baseline:${base.blockId}`} />
              : <>
                <section data-find-id={`baseline:${base.blockId}:before`}><h5>{t('before')}</h5><div data-find-text>
                  <ReaderText block={{ id: base.blockId, text: base.text, kind: 'paragraph', section: '', start: 0, end: base.text.length }} highlights={[]} annotations={[]} labels={labels} />
                </div></section>
                <p className={css.warning} data-find-id={`baseline:${base.blockId}:after`} data-find-text>{t('baselineMissing')}</p>
                <button disabled={busy} onClick={() => { setRecoveringBaseline(base.blockId); setBaselineTarget('') }}>{t('recoverBaseline')}</button>
              </>}
            {block && <button disabled={busy} onClick={() =>{  mark(block, base.locked) }}>{t('mark')}</button>}
          </section>
        })}
        {doc.baselines.some(base => base.archivedAt) && <details className={css.sourceComparison}>
          <summary>{t('archivedBaselines')} ({doc.baselines.filter(base => base.archivedAt).length})</summary>
          {doc.baselines.filter(base => base.archivedAt).map(base => <div className={css.note} key={`${base.blockId}:${base.archivedAt}`}>
            <p>{base.text}</p><small>{new Date(base.reviewedAt).toLocaleString()}</small>
            <button disabled={busy || activeBaselines.some(active => active.blockId === base.blockId)} onClick={() => {
              if (base.archivedAt) void run({ action: 'restore-baseline', path: doc.path, revision: doc.current.id, blockId: base.blockId, archivedAt: base.archivedAt })
            }}>{t('restoreBaseline')}</button>
          </div>)}
        </details>}
      </div>}
      {doc && mode === 'versions' && <Versions key={`versions:${doc.path}`} document={doc} revisions={versionPair.revisions} loading={versionPair.loading} error={versionPair.error} onRetry={versionPair.retry}
        t={t} selection={versionSelection} bibliography={bib}
        onSelectionChange={(versions) => { saveWorkbench({ versions }) }} figurePreview={(revision, block) =>
          collectFigures([block]).map((figure) => {
            const shown = pinnedFigure(revision, figure)
            const file = figureFilePath(doc.path, authoredFigureBase(revision.text), shown.path)
            return file && <FigurePreview key={figure.path} figure={shown} file={file} media={figureMedia} t={t}
              onOpen={setPreviewFigure} />
          })} />}
      {doc && mode === 'references' && <References bibliography={bib} blocks={visibleBlocks} busy={bibBusy} error={bibError}
        path={bibPath} onPathChange={setBibPath} onBind={(files) => { void updateBib(files) }} onChoose={() => { setPickerKind('bib'); setPickerOpen(true); void browse('', 'bib') }}
        onRetry={() => { setBibBusy(true); setBibError('')
          const targetPath = doc.path
          const live = (): boolean => !tab.signal.aborted && current.current?.document.path === targetPath
          void bibliography(targetPath, tab.signal, sessionId).then((next) => { if (live()) setBib(next) },
            (caught: unknown) => { if (live()) setBibError(caught instanceof Error ? caught.message : String(caught)) })
            .finally(() => { if (live()) setBibBusy(false) }) }}
        onLocate={(blockId, key) => {
          const block = doc.current.blocks.find(candidate => candidate.id === blockId)
          if (block) { focusBlock(block); setLocatedEdit({ blockId, returnTo: 'references' }); changeMode('read', true); setNotice(`${t('citationLocated')} [@${key}]`) }
        }} state={workbench.references ?? { query: '', page: 0, nextCitation: {} }}
        onStateChange={(references) => { saveWorkbench({ references }) }} focusedKey={focusedReference}
        labels={{ title: t('references'), help: t('bibHelp'), sources: t('bibSources'), none: t('bibNone'), unbind: t('bibUnbind'),
          path: t('bibPath'), pathHint: t('bibPathHint'), bind: t('bibBind'), choose: t('bibChoose'), missing: t('bibMissing'), legacy: t('bibLegacy'),
          entries: t('bibEntries'), loading: t('loading'), retry: t('retry'), search: t('bibSearch'), searchHint: t('bibSearchHint'),
          noEntries: t('bibNoEntries'), noResults: t('findNone'), clear: t('clearFilter'), previous: t('previousPage'), next: t('nextPage'),
          page: t('page'), showing: t('showing'), citationCount: t('citationCount'), locate: t('locateCitation'), nextCitation: t('nextCitation'),
          unused: t('citationUnused'), doi: t('doi'), url: t('publicationLink') }} />}
      {doc && mode === 'history' && <div className={css.history}>{doc.history.length === 0 ? t('noHistory') : [...doc.history].reverse().map((event, i) =>
        <div key={i} data-find-id={`history:${i}`} data-find-text><time>{new Date(event.at).toLocaleString()}</time><strong>{t(historyKeys[event.action] ?? 'history')}</strong><code>{event.detail}</code></div>)}</div>}
    </div>
    {doc && mode === 'read' && readerLayout === 'figures' && figurePlacement === 'side' && <div className={readingCss.splitter} role="separator" tabIndex={0}
      aria-label={t('resizeColumns')} aria-orientation="vertical" aria-valuemin={35} aria-valuemax={72} aria-valuenow={Math.round(columnRatio * 100)}
      onDoubleClick={() => { changeReading({ columnRatio: 1.3 / 2.3 }) }}
      onKeyDown={event => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); changeReading({ columnRatio: readingColumnRatio(columnRatio + (event.key === 'ArrowLeft' ? -.03 : .03), readingSize.width) }) }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = readingArea.current?.getBoundingClientRect(); if (rect?.width) changeReading({ columnRatio: readingColumnRatio((event.clientX - rect.left) / rect.width, rect.width) }) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />}
    {doc && mode === 'read' && readerLayout === 'figures' && figuresDocked && <FigureCompanion key={doc.path} items={readingItems} selected={companionFigure}
      defaultFit={imagePlacement === 'top' ? 'window' : 'width'} onFloat={() => { changeReading({ figurePresentation: 'floating', figuresCollapsed: false }) }}
      pinned={readerPinned} relation={figureRelation} section={readerPaging === 'sections'} onBrowse={() => { if (lastFigure) selectReadingFigure(lastFigure.key) }}
      onSelect={selectReadingFigure} onPin={() => { saveReader({ pinned: !readerPinned, figureSelection: 'follow' }) }}
      views={workbench.reader?.figureViews} onViewChange={(file, value) => { if (current.current?.document.path !== doc.path) return; saveReader({ figureViews: { ...workbenchRef.current.reader?.figureViews, [file]: value } }) }}
      onDimensions={(file, width, height) => { if (figureAspects[file] === width / height) return; rememberPosition(); setFigureAspects(previous => ({ ...previous, [file]: width / height })) }}
      collapsed={readerFiguresCollapsed} onCollapse={() => { changeReading({ figuresCollapsed: !readerFiguresCollapsed }) }}
      caption={renderedPlainText((doc.current.blocks.find(block => block.id === companionFigure?.figure.blockId)?.text ?? '')
        .replace(/^>\s*/, '').replace(/^\*\*Figure\s+(?:\[[^\]]+\]|[\w.-]+)\*\*\s*\(\s*`[^`]+`\s*\)\s*:?\s*/i, '')) ?? ''}
      onOpen={setPreviewFigure} media={figureMedia} fullPage={figurePage} stale={stalePanels} t={t}
      onLocate={blockId => {
        const block = doc.current.blocks.find(block => block.id === blockId)
        if (block) { focusBlock(block); revealTarget(`[data-block="${CSS.escape(blockId)}"]`) }
      }} />}
    {doc && mode === 'read' && readerLayout === 'figures' && (previewing || figurePresentation === 'floating') && floatingFigure && <FigureWindow
      key={doc.path} id={figureWindowId} preview={previewing} bounds={{ ...readingSize, top: content.current?.querySelector<HTMLElement>('[data-read-toolbar]')?.clientHeight ?? 0 }} anchor={previewing ? figurePeek?.anchor : figureLaunchAnchor}
      saved={workbench.reader?.figureWindow} label={floatingFigure.figure.label} t={t}
      onChange={rect => { if (current.current?.document.path === doc.path) saveReader({ figureWindow: rect }) }} onEnter={keepFigurePeek} onLeave={leaveFigurePeek}
      onClose={() => { const returnFocus = document.getElementById(figureWindowId)?.contains(document.activeElement); suppressPeekFocus.current = true; closeFigurePeek(); if (!previewing) changeReading({ figurePresentation: 'peek' }); if (!previewing || returnFocus) peekTrigger.current?.focus({ preventScroll: true }); queueMicrotask(() => { suppressPeekFocus.current = false }) }}
      onOpen={() => { openReadingFigure(floatingFigure.key, false) }}
      onDock={() => { closeFigurePeek(); changeReading({ figurePresentation: 'docked', figureKey: floatingFigure.key, figureSelection: 'manual', figuresCollapsed: false, ...(activeReadingId ? { manualBlockId: activeReadingId } : {}) }) }}>
      {previewing ? <FigurePeek item={floatingFigure} media={figureMedia} fullPage={figurePage} onOpen={() => { openReadingFigure(floatingFigure.key, false) }} t={t} />
        : <FigureCompanion items={readingItems} selected={floatingFigure} defaultFit="window" pinned={readerPinned} relation={figureRelation === 'none' ? 'manual' : figureRelation}
          collapsed={false} onCollapse={() => { changeReading({ figurePresentation: 'peek' }) }} onSelect={selectReadingFigure}
          onPin={() => { saveReader({ pinned: !readerPinned }) }} caption={renderedPlainText((doc.current.blocks.find(block => block.id === floatingFigure.figure.blockId)?.text ?? '')
            .replace(/^>\s*/, '').replace(/^\*\*Figure\s+(?:\[[^\]]+\]|[\w.-]+)\*\*\s*\(\s*`[^`]+`\s*\)\s*:?\s*/i, '')) ?? ''}
          views={workbench.reader?.figureViews} onViewChange={(file, value) => { if (current.current?.document.path !== doc.path) return; saveReader({ figureViews: { ...workbenchRef.current.reader?.figureViews, [file]: value } }) }}
          onOpen={setPreviewFigure} media={figureMedia} fullPage={figurePage} stale={stalePanels} t={t}
          onLocate={blockId => { const block = doc.current.blocks.find(block => block.id === blockId); if (block) { focusBlock(block); revealTarget(`[data-block="${CSS.escape(blockId)}"]`) } }} />}
    </FigureWindow>}
    </div>
    {doc && (mode === 'read' || previewFigure) && (galleryFigures.length > 0 || previewFigure) && <FigureGallery
      figures={previewFigure?.file && !galleryFigures.some(figure => (figure.file ?? figureFilePath(doc.path, figureBase, figure.path)) === previewFigure.file) ? [...galleryFigures, previewFigure] : galleryFigures.length ? galleryFigures : previewFigure ? [previewFigure] : []} showDock={mode === 'read' && readerLayout === 'text'} manuscript={doc.path} base={figureBase}
      sessionId={sessionId} signal={tab.signal} thumbnail={figureThumbnail} fullPage={figurePage} bytes={figureBytes}
      selected={previewFigure} onSelect={setPreviewFigure}
      onLocate={(figure) => {
        const block = doc.current.blocks.find(block => block.id === figure.blockId)
        if (block) { focusBlock(block); revealTarget(`[data-block="${CSS.escape(block.id)}"]`) }
      }}
      onNative={(figure) => { void openNativeFigure(figure) }}
      labels={{ figures: t('figureList'), pdf: t('figurePdf'), image: t('figureImage'), open: t('openFigure'), close: t('figureClose'), loading: t('loading'),
        failed: t('figureOpenFailed'), locate: t('locateFigure'), native: t('figureNative'),
        zoomIn: t('figureZoomIn'), zoomOut: t('figureZoomOut'), fit: t('figureFit'), actualSize: t('figureActualSize'),
        previous: t('previousFigure'), next: t('nextFigure'), retry: t('retry'), pdfPreview: t('figurePdfPreview'), panHint: t('figurePanHint'),
        expand: t('figureExpand'), collapse: t('figureCollapse') }} />}
    {doc && recoveringBaseline && <dialog ref={baselineDialog} className={css.figureReplaceDialog} aria-label={t('recoverBaseline')}
      onClose={() => { setRecoveringBaseline(undefined); setBaselineTarget('') }}>
      <h3>{t('recoverBaseline')}</h3><p>{t('baselineRecoveryHelp')}</p>
      <label>{t('baselineTarget')}<select aria-label={t('baselineTarget')} value={baselineTarget} onChange={(event) => { setBaselineTarget(event.target.value) }}>
        <option value="">{t('chooseParagraph')}</option>
        {progressBlocks.filter(block => !baselinesByBlock.has(block.id)).map(block => <option key={block.id} value={block.id}>
          {locations.get(block.id)?.headings.join(' › ')} · {blockPreview(block, 100)}</option>)}
      </select></label>
      <p className={css.warning}>{t('baselineRelinkHelp')}</p>
      <button disabled={busy || !baselineTarget} onClick={() => {
        void run({ action: 'relink-baseline', path: doc.path, revision: doc.current.id, blockId: recoveringBaseline, targetBlockId: baselineTarget })
          .then((saved) => { if (saved) setRecoveringBaseline(undefined) })
      }}>{t('relinkBaseline')}</button>
      <button disabled={busy} onClick={() => {
        void run({ action: 'archive-baseline', path: doc.path, revision: doc.current.id, blockId: recoveringBaseline })
          .then((saved) => { if (saved) setRecoveringBaseline(undefined) })
      }}>{t('archiveBaseline')}</button>
      <button onClick={() => { setRecoveringBaseline(undefined) }}>{t('cancel')}</button>
    </dialog>}
    {doc && figureReplacement && <dialog ref={figureDialog} className={css.figureReplaceDialog}
      aria-label={t('replaceFigure')} onClose={() => {
        figurePickController.current?.abort(); setFigureBusy(false); setFigureReplacement(undefined)
      }}>
      <h3>{t('replaceFigure')} · {figureReplacement.figure.label}</h3><p>{t('figureCaptionCheck')}</p>
      <label>{t('figureReplacementPath')}<input value={figureReplacement.path} placeholder={t('figureReplacementPath')}
        onChange={(event) => { setFigureReplacement({ ...figureReplacement, path: event.target.value }) }} /></label>
      <button disabled={figureBusy} onClick={() => { void browseFigures('') }}><PaperIcon kind="folder" />{t('figureBrowseWorkspace')}</button>
      <button disabled={figureBusy} onClick={() => { void chooseReplacement() }}>{t('hostPicker')}</button>
      {figureListing && <div className={css.figureFileList}><code>{figureListing.path || t('workspace')}</code>
        {figureListing.path && <button onClick={() => { void browseFigures(figureListing.path.split('/').slice(0, -1).join('/')) }}>{t('progressStart')}</button>}
        {figureListing.entries.map(entry => <button key={entry.name} disabled={figureBusy} onClick={() => {
          const path = [figureListing.path, entry.name].filter(Boolean).join('/')
          if (entry.type === 'directory') void browseFigures(path)
          else { setFigureReplacement({ ...figureReplacement, path }); setFigureListing(undefined) }
        }}>{entry.type === 'directory' ? '▸ ' : ''}{entry.name}</button>)}
        {figureListing.truncated && <p>{t('truncated')}</p>}</div>}
      <label>{t('figureReplacementReason')}<textarea value={figureReplacement.reason}
        onChange={(event) => { setFigureReplacement({ ...figureReplacement, reason: event.target.value }) }} /></label>
      {error && <p role="alert">{error}</p>}<div className={css.figureReplaceActions}>
        <button onClick={() => {
          figurePickController.current?.abort(); setFigureBusy(false); setFigureReplacement(undefined)
        }}>{t('cancel')}</button>
        <button disabled={figureBusy || !figureReplacement.path.trim() || !figureReplacement.reason.trim()}
          onClick={() => { void submitFigure() }}>{figureBusy ? t('loading') : t('figureReplacementSubmit')}</button>
      </div>
    </dialog>}
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

const historyKeys: Record<string, PaperReviewKey> = { imported: 'imported', annotated: 'annotated', proposed: 'proposed', revised: 'proposalRevised', resolved: 'resolved', reopened: 'reopened', reviewed: 'mark', 'reviewed-and-locked': 'lock', accepted: 'accepted', rejected: 'rejected', unlocked: 'unlocked', highlighted: 'highlightSaved', 'highlight-removed': 'removeHighlight', 'highlight-restored': 'restoreHighlight', 'archive-baseline': 'baselineArchived', 'restore-baseline': 'baselineRestored', 'relink-baseline': 'baselineRelinked' }
