/** Read-only, independently selected historical revisions with exact source-level visual differences. */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { diffWordsWithSpace } from 'diff'
import type { BibliographyView, PaperBlock, PaperRevision } from '../schema.ts'
import type { PaperReviewKey } from './locales.ts'
import type { WorkbenchDocument } from '../workbench-view.ts'
import { useNearViewport } from './near-viewport.ts'
import { ReaderText } from './reader-text.tsx'
import { pairRevisionBlocks } from './block-pairing.ts'
import css from './panel.module.css'

/** Saved choices use immutable revision IDs, not positions in the history array. */
export type VersionSelection = {
  leftRevisionId: string
  rightRevisionId: string
  layout: 'rendered' | 'split' | 'inline'
}

/**
 * Resolve unavailable selections to the preceding and latest saved revisions.
 * @param document - currently available saved revisions.
 * @param selection - previously selected IDs and display layout, when available.
 * @returns available comparison choices without mutating persisted review state.
 */
export function resolveVersionSelection(document: WorkbenchDocument, selection?: VersionSelection): VersionSelection {
  const latest = document.revisions.at(-1) ?? document.current
  const preceding = document.revisions.at(-2) ?? latest
  return {
    leftRevisionId: selection && document.revisions.some(revision => revision.id === selection.leftRevisionId)
      ? selection.leftRevisionId : preceding.id,
    rightRevisionId: selection && document.revisions.some(revision => revision.id === selection.rightRevisionId)
      ? selection.rightRevisionId : latest.id,
    layout: selection?.layout ?? 'rendered',
  }
}

function VersionBlock({ block, revision, compared, side, labels, figurePreview, bibliography }: {
  block: PaperBlock
  revision: PaperRevision
  compared: string | undefined
  side: 'before' | 'after'
  labels: Parameters<typeof ReaderText>[0]['labels']
  figurePreview: ((revision: PaperRevision, block: PaperBlock) => ReactNode) | undefined
  bibliography: BibliographyView | undefined
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const visible = useNearViewport(root)
  return <div ref={root} data-find-id={`version:${side === 'before' ? 'left' : 'right'}:${block.id}`}
    className={`${css.versionRenderedBlock} ${compared === block.text ? '' : side === 'before' ? css.versionRemoved : css.versionAdded}`}>
    {visible ? <><ReaderText block={block} highlights={[]} annotations={[]} labels={labels} bibliography={bibliography}
      {...(compared === undefined ? {} : { comparison: { opposite: compared, side } })} />
    {figurePreview?.(revision, block)}</>
      : <div data-reader-placeholder aria-hidden="true" className={css.readerPlaceholder}
        style={{ minHeight: Math.max(36, Math.ceil(block.text.length / 42) * 29) }} />}
  </div>
}

/**
 * Compare two saved revisions without writing the manuscript or its review state.
 * @param props - complete saved history and localized labels.
 * @returns read-only visual comparison.
 */
export function Versions({ document, revisions, loading = false, error = '', onRetry, t, figurePreview, selection, onSelectionChange, bibliography }: {
  document: WorkbenchDocument
  revisions?: PaperRevision[] | undefined
  loading?: boolean | undefined
  error?: string | undefined
  onRetry?: (() => void) | undefined
  t: (key: PaperReviewKey) => string
  figurePreview?: (revision: PaperRevision, block: PaperBlock) => ReactNode
  selection?: VersionSelection | undefined
  onSelectionChange?: ((selection: VersionSelection) => void) | undefined
  bibliography?: BibliographyView | undefined
}): ReactNode {
  const [localSelection, setLocalSelection] = useState(() => resolveVersionSelection(document))
  const selected = resolveVersionSelection(document, selection ?? localSelection)
  const { leftRevisionId, rightRevisionId, layout } = selected
  const bodies = revisions ?? document.revisions.filter((revision): revision is PaperRevision => 'text' in revision && 'blocks' in revision)
  const before = bodies.find(revision => revision.id === leftRevisionId) ?? document.current
  const after = bodies.find(revision => revision.id === rightRevisionId) ?? document.current
  const ready = !loading && !error && [leftRevisionId, rightRevisionId].every(id => id === document.current.id || bodies.some(revision => revision.id === id))
  const select = (update: Partial<VersionSelection>): void => {
    const next = { ...selected, ...update }
    setLocalSelection(next)
    onSelectionChange?.(next)
  }
  const leftToRight = useMemo(() => layout === 'rendered' ? pairRevisionBlocks(before.blocks, after.blocks) : new Map<string, string>(),
    [before.blocks, after.blocks, layout])
  const rightToLeft = useMemo(() => new Map([...leftToRight].map(([old, next]) => [next, old])), [leftToRight])
  const parts = useMemo(() => layout === 'rendered' ? [] : diffWordsWithSpace(before.text, after.text), [before.text, after.text, layout])
  const copyLabel = t('copy'), copiedLabel = t('copied'), footnotes = t('footnotes')
  const markdownLabels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const versionLabel = t('version')
  const versionLabels = useMemo(() => new Map(document.revisions.map((revision, index) =>
    [revision.id, `${versionLabel} ${index + 1} · ${new Date(revision.createdAt).toLocaleString()} · ${revision.id.slice(0, 7)}`])),
  [document.revisions, versionLabel])
  const renderRevision = (revision: PaperRevision, opposite: PaperRevision, side: 'before' | 'after', pairs: Map<string, string>): ReactNode => {
    const oppositeText = new Map(opposite.blocks.map(block => [block.id, block.text]))
    return <section data-version-rendered={side}><h4>{label(revision.id)}</h4>
      {revision.blocks.map((block) => {
        const match = pairs.get(block.id)
        const compared = match === undefined ? undefined : oppositeText.get(match)
        return <VersionBlock key={`${revision.id}:${block.id}`} block={block} revision={revision} compared={compared}
          side={side} labels={markdownLabels} figurePreview={figurePreview} bibliography={bibliography} />})}
    </section>
  }
  const label = (revisionId: string): string => versionLabels.get(revisionId) ?? ''
  return <div className={css.versions} data-version-comparison>
    <h3>{t('versions')}</h3><p className={css.help}>{t('versionHelp')}</p>
    <div className={css.versionPickers}>
      <label>{t('leftVersion')}<select aria-label={t('leftVersion')} value={leftRevisionId} onChange={(event) => { select({ leftRevisionId: event.target.value }) }}>
        {document.revisions.map(revision => <option key={revision.id} value={revision.id}>{label(revision.id)}</option>)}
      </select></label>
      <button onClick={() => { select({ leftRevisionId: rightRevisionId, rightRevisionId: leftRevisionId }) }}>{t('swap')}</button>
      <label>{t('rightVersion')}<select aria-label={t('rightVersion')} value={rightRevisionId} onChange={(event) => { select({ rightRevisionId: event.target.value }) }}>
        {document.revisions.map(revision => <option key={revision.id} value={revision.id}>{label(revision.id)}</option>)}
      </select></label>
    </div>
    <div className={css.versionTools}>
      <button aria-pressed={layout === 'rendered'} onClick={() => { select({ layout: 'rendered' }) }}>{t('renderedPages')}</button>
      <button aria-pressed={layout === 'split'} onClick={() => { select({ layout: 'split' }) }}>{t('sideBySide')}</button>
      <button aria-pressed={layout === 'inline'} onClick={() => { select({ layout: 'inline' }) }}>{t('inlineDiff')}</button>
      <span>{t(layout === 'rendered' ? 'renderedHelp' : 'diffLegend')}</span>
    </div>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={onRetry}>{t('retry')}</button></div>}
    {ready && before.text === after.text && <p role="status">{t('identicalVersions')}</p>}
    {ready && (layout === 'rendered' ? <div className={css.versionRendered}>{renderRevision(before, after, 'before', leftToRight)}{renderRevision(after, before, 'after', rightToLeft)}</div>
      : layout === 'inline' ? <div className={css.diff} data-version-inline data-find-id="version:inline:source">{parts.map((part, index) => part.added
        ? <ins key={index}>{part.value}</ins>
        : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>
        : <div className={css.versionSplit}>
          <section><h4>{label(before.id)}</h4><div className={css.diff} data-version-before data-find-id="version:left:source">{parts.map((part, index) => part.added ? null
            : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div></section>
          <section><h4>{label(after.id)}</h4><div className={css.diff} data-version-after data-find-id="version:right:source">{parts.map((part, index) => part.removed ? null
            : part.added ? <ins key={index}>{part.value}</ins> : <span key={index}>{part.value}</span>)}</div></section>
        </div>)}
  </div>
}
