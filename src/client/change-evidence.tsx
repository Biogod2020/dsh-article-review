/** Collapsible exact evidence; does not replace the full source diff or author judgment. */
import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { auditTextChanges } from '../change-audit.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

/** Show bounded changed tokens on both sides, rendering manuscript data only as escaped text. */
export const ChangeEvidence = memo(function ChangeEvidence({ before, after, t }: {
  before: string; after: string; t: (key: PaperReviewKey) => string
}): ReactNode {
  const changes = useMemo(() => auditTextChanges(before, after), [before, after])
  if (!changes.length) return null
  return <details className={css.sourceComparison} data-change-evidence>
    <summary>{t('changeEvidence')} ({changes.length})</summary>
    {changes.map(change => <section key={change.category} className={css.evidenceRow}>
      <strong>{t(change.category)}</strong>
      <div><span>{t('original')}: </span>{change.before.length ? change.before.map(token =>
        <code key={token.start} title={`${token.start}–${token.end}`}>{token.text}</code>) : '—'}</div>
      <div><span>{t('revised')}: </span>{change.after.length ? change.after.map(token =>
        <code key={token.start} title={`${token.start}–${token.end}`}>{token.text}</code>) : '—'}</div>
      {change.truncated && <p>{t('evidenceTruncated')} ({change.beforeCount} → {change.afterCount})</p>}
    </section>)}
  </details>
})
