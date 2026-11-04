/** Pure review queue projection: filtering never settles a proposal or changes author baselines. */
import type { Proposal } from './schema.ts';
/** Recompute lexical hints for legacy proposals while preserving their recorded structural flags. */
export declare function pendingReviewQueue(proposals: readonly Proposal[]): Proposal[];
/** A routing hint, deliberately not a scientific safety score. */
export declare function needsJudgment(proposal: Proposal): boolean;
/** Visible category filter for pending proposal groups. */
export type QueueFilter = 'all' | 'attention' | 'style' | 'structure' | 'claim' | 'evidence';
/** Keep original order and complete dependent edit groups. */
export declare function filterReviewQueue(proposals: readonly Proposal[], filter: QueueFilter): Proposal[];
