/** Pure review queue projection: filtering never settles a proposal or changes author baselines. */
import type { Proposal } from './schema.ts'
import { auditTextChanges } from './change-audit.ts'

/** Recompute lexical hints for legacy proposals while preserving their recorded structural flags. */
export function pendingReviewQueue(proposals: readonly Proposal[]): Proposal[] {
  return proposals.filter(proposal => proposal.status === 'pending').map(proposal => ({ ...proposal,
    flags: [...new Set([...proposal.flags, ...proposal.edits.flatMap(edit =>
      auditTextChanges(edit.operation ? '' : edit.before, edit.after).map(change => change.category))])],
  }))
}
/** A routing hint, deliberately not a scientific safety score. */
export function needsJudgment(proposal: Proposal): boolean {
  return proposal.meaning !== 'style' || proposal.flags.length > 0
}
/** Visible category filter for pending proposal groups. */
export type QueueFilter = 'all' | 'attention' | 'style' | 'structure' | 'claim' | 'evidence'
/** Keep original order and complete dependent edit groups. */
export function filterReviewQueue(proposals: readonly Proposal[], filter: QueueFilter): Proposal[] {
  return proposals.filter(proposal => filter === 'all' || (filter === 'attention' ? needsJudgment(proposal) : proposal.meaning === filter))
}
