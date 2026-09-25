/** Read-only, independently selected historical revisions with exact source-level visual differences. */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { diffWordsWithSpace } from 'diff'
import type { PaperDocument, PaperRevision } from '../schema.ts'
import type { PaperReviewKey } from './locales.ts'
import { ReaderText } from './reader-text.tsx'
import { pairRevisionBlocks } from './block-pairing.ts'
import css from './panel.module.css'

/**
 * Compare two saved revisions without writing the manuscript or its review state.
 * @param props - complete saved history and localized labels.
 * @returns read-only visual comparison.
 */
export function Versions({ document, t }: { document: PaperDocument; t: (key: PaperReviewKey) => string }): ReactNode {
  const [left, setLeft] = useState(0)
  const [right, setRight] = useState(document.revisions.length - 1)
  const [layout, setLayout] = useState<'rendered' | 'split' | 'inline'>('rendered')
  const before = document.revisions[left] ?? document.current
  const after = document.revisions[right] ?? document.current
  const leftToRight = useMemo(() => pairRevisionBlocks(before.blocks, after.blocks), [before.blocks, after.blocks])
  const rightToLeft = useMemo(() => new Map([...leftToRight].map(([old, next]) => [next, old])), [leftToRight])
  const parts = useMemo(() => layout === 'rendered' ? [] : diffWordsWithSpace(before.text, after.text), [before.text, after.text, layout])
  const copyLabel = t('copy'), copiedLabel = t('copied'), footnotes = t('footnotes')
  const markdownLabels = useMemo(() => ({ code: { copyLabel, copiedLabel }, footnotes }), [copyLabel, copiedLabel, footnotes])
  const renderRevision = (revision: PaperRevision, opposite: PaperRevision, side: 'before' | 'after', pairs: Map<string, string>): ReactNode => {
    const oppositeText = new Map(opposite.blocks.map(block => [block.id, block.text]))
    return <section data-version-rendered={side}><h4>{label(side === 'before' ? left : right)}</h4>
      {revision.blocks.map((block) => {
        const match = pairs.get(block.id)
        const compared = match === undefined ? undefined : oppositeText.get(match)
        return <div key={block.id} className={`${css.versionRenderedBlock} ${compared === block.text ? '' : side === 'before' ? css.versionRemoved : css.versionAdded}`}>
          <ReaderText block={block} highlights={[]} annotations={[]} labels={markdownLabels}
            {...(compared === undefined ? {} : { comparison: { opposite: compared, side } })} />
        </div>})}
    </section>
  }
  const label = (index: number): string => {
    const revision = document.revisions[index]
    return revision ? `${t('version')} ${index + 1} · ${new Date(revision.createdAt).toLocaleString()} · ${revision.id.slice(0, 7)}` : ''
  }
  return <div className={css.versions} data-version-comparison>
    <h3>{t('versions')}</h3><p className={css.help}>{t('versionHelp')}</p>
    <div className={css.versionPickers}>
      <label>{t('leftVersion')}<select aria-label={t('leftVersion')} value={left} onChange={(event) => { setLeft(Number(event.target.value)) }}>
        {document.revisions.map((revision, index) => <option key={`${revision.id}-${index}`} value={index}>{label(index)}</option>)}
      </select></label>
      <button onClick={() => { setLeft(right); setRight(left) }}>{t('swap')}</button>
      <label>{t('rightVersion')}<select aria-label={t('rightVersion')} value={right} onChange={(event) => { setRight(Number(event.target.value)) }}>
        {document.revisions.map((revision, index) => <option key={`${revision.id}-${index}`} value={index}>{label(index)}</option>)}
      </select></label>
    </div>
    <div className={css.versionTools}>
      <button aria-pressed={layout === 'rendered'} onClick={() => { setLayout('rendered') }}>{t('renderedPages')}</button>
      <button aria-pressed={layout === 'split'} onClick={() => { setLayout('split') }}>{t('sideBySide')}</button>
      <button aria-pressed={layout === 'inline'} onClick={() => { setLayout('inline') }}>{t('inlineDiff')}</button>
      <span>{t(layout === 'rendered' ? 'renderedHelp' : 'diffLegend')}</span>
    </div>
    {before.text === after.text && <p role="status">{t('identicalVersions')}</p>}
    {layout === 'rendered' ? <div className={css.versionRendered}>{renderRevision(before, after, 'before', leftToRight)}{renderRevision(after, before, 'after', rightToLeft)}</div>
      : layout === 'inline' ? <div className={css.diff} data-version-inline>{parts.map((part, index) => part.added
        ? <ins key={index}>{part.value}</ins>
        : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div>
        : <div className={css.versionSplit}>
          <section><h4>{label(left)}</h4><div className={css.diff} data-version-before>{parts.map((part, index) => part.added ? null
            : part.removed ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>)}</div></section>
          <section><h4>{label(right)}</h4><div className={css.diff} data-version-after>{parts.map((part, index) => part.removed ? null
            : part.added ? <ins key={index}>{part.value}</ins> : <span key={index}>{part.value}</span>)}</div></section>
        </div>}
  </div>
}
