/** Compact review minimap; expanding never changes manuscript layout. */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PaperBlock, PaperDocument } from '../schema.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

/** Floating navigation for every reviewable block, grouped by manuscript section. */
export function ReviewProgress({ blocks, baselines, jump, t }: {
  blocks: PaperBlock[]
  baselines: PaperDocument['baselines']
  jump: (block: PaperBlock) => void
  t: (key: PaperReviewKey) => string
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const items = useMemo(() => {
    const byId = new Map(baselines.map(base => [base.blockId, base]))
    return blocks.map(block => ({ block, status: !byId.has(block.id) ? 'unread' as const
      : byId.get(block.id)?.text === block.text ? 'reviewed' as const : 'changed' as const }))
  }, [blocks, baselines])
  const reviewed = items.filter(item => item.status === 'reviewed').length
  const percent = items.length ? Math.round(reviewed / items.length * 100) : 0
  let section = ''
  return <aside className={`${css.progressDock} ${expanded ? css.progressExpanded : ''}`} aria-label={t('progressTitle')}>
    <button className={css.progressToggle} aria-expanded={expanded} aria-label={t(expanded ? 'progressCollapse' : 'progressExpand')} title={t(expanded ? 'progressCollapse' : 'progressExpand')}
      onClick={() => { setExpanded(open => !open) }}>
      <span className={css.progressPercent}>{percent}%</span><span aria-hidden="true">{expanded ? '›' : '‹'}</span>
    </button>
    {!expanded && <div className={css.progressTrack} aria-hidden="true">{items.map(({ block, status }) =>
      <span key={block.id} className={css[`progress-${status}`]} />)}</div>}
    {expanded && <div className={css.progressDetails}>
      <div className={css.progressHeading}><strong>{t('progressTitle')}</strong><span>{reviewed} / {items.length}</span></div>
      <p className={css.progressHint}>{t('progressHint')}</p>
      <div className={css.progressItems}>{items.map(({ block, status }, index) => {
        const showSection = block.section !== section
        section = block.section
        const preview = block.text.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 76)
        return <div key={block.id}>
          {showSection && <div className={css.progressSection}>{block.section || t('progressStart')}</div>}
          <button className={css.progressItem} title={`${t(status)} · ${preview}`} onClick={() => { jump(block); setExpanded(false) }}>
            <span className={`${css.progressDot} ${css[`progress-${status}`]}`} aria-hidden="true" />
            <span className={css.progressIndex}>{index + 1}</span><span className={css.progressPreview}>{preview || t('progressBlank')}</span>
            <span className={css.progressState}>{t(status)}</span>
          </button>
        </div>
      })}</div>
    </div>}
  </aside>
}
