/** Compact review minimap with a progressively disclosed manuscript outline. */
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PaperBlock, PaperDocument } from '../schema.ts'
import type { PaperReviewKey } from './locales.ts'
import { blockPreview, reviewNavigation } from './review-navigation.ts'
import type { ReviewOutlineEntry, ReviewOutlineSection } from './review-navigation.ts'
import css from './panel.module.css'

/** Floating navigation for headings and their reviewable blocks. */
export function ReviewProgress({ blocks, baselines, jump, t }: {
  blocks: PaperBlock[]
  baselines: PaperDocument['baselines']
  jump: (block: PaperBlock) => void
  t: (key: PaperReviewKey) => string
}): ReactNode {
  const detailsId = useId()
  const [expanded, setExpanded] = useState(false)
  const items = useMemo(() => {
    const byId = new Map(baselines.filter(base => !base.archivedAt).map(base => [base.blockId, base]))
    return blocks.map(block => ({ block, status: !byId.has(block.id) ? 'unread' as const
      : byId.get(block.id)?.text === block.text ? 'reviewed' as const : 'changed' as const }))
  }, [blocks, baselines])
  const outline = useMemo(() => reviewNavigation(blocks).entries, [blocks])
  const initialSection = outline.length === 1 && outline[0]?.type === 'section' && outline[0].level === 1
    ? outline[0].block.id : undefined
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(initialSection ? [initialSection] : []))
  const reviewedBefore = [0]
  for (const item of items) reviewedBefore.push((reviewedBefore.at(-1) ?? 0) + Number(item.status === 'reviewed'))
  const reviewed = reviewedBefore.at(-1) ?? 0
  const percent = items.length ? Math.round(reviewed / items.length * 100) : 0
  const sections: ReviewOutlineSection[] = []
  const collectSections = (entries: ReviewOutlineEntry[]): void => {
    for (const entry of entries) if (entry.type === 'section') { sections.push(entry); collectSections(entry.entries) }
  }
  collectSections(outline)
  const toggleSection = (id: string): void => {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const renderEntries = (entries: ReviewOutlineEntry[], depth: number): ReactNode => entries.map((entry) => {
    if (entry.type === 'block') {
      const status = items[entry.index]?.status ?? 'unread'
      const preview = blockPreview(entry.block, 76)
      return <button key={entry.block.id} className={css.progressItem} style={{ paddingLeft: `${8 + depth * 13}px` }}
        title={`${t(status)} · ${preview}`} onClick={() => { jump(entry.block); setExpanded(false) }}>
        <span className={`${css.progressDot} ${css[`progress-${status}`]}`} aria-hidden="true" />
        <span className={css.progressIndex}>{entry.index + 1}</span><span className={css.progressPreview}>{preview || t('progressBlank')}</span>
      </button>
    }
    const count = entry.end - entry.start
    const done = (reviewedBefore[entry.end] ?? 0) - (reviewedBefore[entry.start] ?? 0)
    const open = openSections.has(entry.block.id)
    return <div key={entry.block.id} className={css.progressBranch}>
      <div className={css.progressSectionRow} style={{ paddingLeft: `${4 + depth * 13}px` }}>
        {entry.entries.length > 0 && <button className={css.progressDisclosure} aria-expanded={open}
          aria-label={`${t(open ? 'progressFoldSection' : 'progressUnfoldSection')} ${entry.title}`}
          onClick={() => { toggleSection(entry.block.id) }}><span aria-hidden="true">{open ? '▾' : '▸'}</span></button>}
        <button className={css.progressSectionJump} onClick={() => { jump(entry.block); setExpanded(false) }}
          title={`${entry.title} · ${done}/${count}`}>
          <span className={css.progressPreview}>{entry.title || t('progressBlank')}</span>
          <span className={css.progressSectionCount}>{done}/{count}</span>
        </button>
      </div>
      {open && entry.entries.length > 0 && <div className={css.progressChildren}>{renderEntries(entry.entries, depth + 1)}</div>}
    </div>
  })
  return <aside className={`${css.progressDock} ${expanded ? css.progressExpanded : ''}`} aria-label={t('progressTitle')}>
    {!expanded && <button className={css.progressToggle} aria-expanded={false} aria-controls={detailsId}
      aria-label={t('progressExpand')} title={t('progressExpand')} onClick={() => { setExpanded(true) }}>
      <span className={css.progressPercent}>{percent}%</span>
      <span className={css.progressTrack} data-progress-track aria-hidden="true">{items.map(({ block, status }) =>
        <span key={block.id} className={css[`progress-${status}`]} />)}</span>
    </button>}
    {expanded && <div id={detailsId} className={css.progressDetails}>
      <div className={css.progressHeading}><strong>{t('progressTitle')}</strong><span>{reviewed} / {items.length}</span>
        <button className={css.progressClose} aria-label={t('progressCollapse')} title={t('progressCollapse')}
          onClick={() => { setExpanded(false) }}>×</button></div>
      <p className={css.progressHint}>{t('progressHint')}</p>
      {sections.length > 0 && <div className={css.progressOutlineTools}>
        <button onClick={() => { setOpenSections(new Set(sections.map(section => section.block.id))) }}>{t('progressExpandAll')}</button>
        <button onClick={() => { setOpenSections(new Set()) }}>{t('progressCollapseAll')}</button>
      </div>}
      <nav className={css.progressItems} aria-label={t('progressOutline')}>{renderEntries(outline, 0)}</nav>
    </div>}
  </aside>
}
