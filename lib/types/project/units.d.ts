/**
 * Pure project logic shared by the host, the client and the demo server: review units and their status,
 * claim/prose sync, registered-number checks, stage checklists and applying changes.
 */
import type { Change, Claim, Project, ReviewState, Stage } from './model.ts';
/** Stable 53-bit content hash (cyrb53); runs the same in Node and the browser. */
export declare function contentHash(value: unknown): string;
/**
 * The claim content a paragraph is written from: what the claim says and how strong its evidence is. Rewording an
 * evidence item or a caption does not make prose stale; changed numbers are caught by the number check instead.
 */
export declare const claimHash: (claim: Claim) => string;
export interface Unit {
    key: string;
    kind: 'thesis' | 'beat' | 'claim' | 'figure' | 'paragraph';
    id: string;
    label: string;
    hash: string;
}
/** Everything the author reviews, with its current content hash. Paragraph keys include their section. */
export declare function units(p: Project): Unit[];
export type ReviewStatus = 'reviewed' | 'changed' | 'new';
/** reviewed = matches what the author confirmed; changed = confirmed once, edited since; new = never confirmed. */
export declare function reviewStatus(p: Project, st: ReviewState): Record<string, ReviewStatus>;
export interface SyncIssue {
    paragraph: string;
    section: string;
    claim: string;
    kind: 'claim-changed' | 'claim-missing' | 'unwritten';
}
/**
 * Where skeleton and prose disagree: a paragraph written from an older version of its claim, a paragraph citing
 * a removed claim, or (once drafting starts) a claim no paragraph states.
 */
export declare function syncIssues(p: Project): SyncIssue[];
export interface NumberIssue {
    where: string;
    value: string;
    quote: string;
}
/**
 * Numbers in claims, evidence and prose that the registry does not contain. Small integers (≤ 20, often counts
 * like "three stages"), years 1900–2100, citation brackets [38–42] and figure/panel references are skipped; the check is a pointer for
 * the author, not a proof.
 */
export declare function unregisteredNumbers(p: Project): NumberIssue[];
export interface CheckItem {
    label: string;
    ok: boolean;
    detail: string;
}
/** Advice for leaving a stage. The author may advance anyway; the list says what will be carried forward. */
export declare function stageChecklist(p: Project, st: ReviewState, stage?: Stage): CheckItem[];
export declare const nextStage: (s: Stage) => Stage;
/** Unit keys a change touches; used for history and "changed since review". */
export declare function changedUnits(change: Change): string[];
/**
 * Apply changes to a copy of the project. Throws on references to unknown sections so a bad agent call fails
 * whole instead of half-applying. A paragraph written without an explicit basis records the current claims.
 */
export declare function applyChanges(p: Project, changes: Change[]): Project;
/** Mark a paragraph as rewritten from the current claims (after the author accepts it as in sync). */
export declare function resyncBasis(p: Project, paragraphId: string): Project;
