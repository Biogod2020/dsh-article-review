/**
 * Initialising a project from a manuscript is long work: the agent reads every page, copies it and cuts its figures.
 * Models stop early on such work, and every page image they look at stays in the conversation. So the panel drives
 * it in rounds: one preparation turn, one turn per small batch of pages (or sections), one turn for the argument and
 * one for the check. This module plans the batches and writes each round's message; the host sends them.
 */
/** One round of copying: which part of the manuscript, in words the agent and the author both read. */
export interface Batch {
    label: string;
    part: string;
}
export type InitPhase = 'prepare' | 'copy' | 'argument' | 'check' | 'done';
/**
 * Batches in reading order. A PDF is split by pages; LaTeX, Word and Markdown by the top-level headings of the
 * outline the preparation script wrote, two sections a batch, the last running to the end.
 */
export declare function planBatches(kind: string, pageWords: number[], outline: string, skip?: boolean[]): Batch[];
/**
 * Pages of the reference list, by position: after the page with a "References" / "Bibliography" heading line, up to
 * the first page that starts the appendix or supplement, and only pages whose lines mostly look like citations.
 * Related-work pages are full of "et al." too, so a citation-density rule alone would skip them.
 * Same rule as check_project.py.
 */
export declare function referencePages(pages: string[]): boolean[];
/** Where the copy stands, so the next batch continues at the right paragraph. */
export interface CopyState {
    paragraphs: number;
    figures: number;
    lastSection?: {
        id: string;
        heading: string;
    };
    lastParagraph?: {
        id: string;
        tail: string;
    };
}
export declare function copyState(project: {
    sections?: Array<{
        id: string;
        heading: string;
        paragraphs: Array<{
            id: string;
            text: string;
        }>;
    }>;
    figures?: unknown[];
}): CopyState;
/** The message that starts the job: preparation only, so the turn is short and the panel can plan the batches. */
export declare function prepareMessage(lines: string[]): string;
export declare function copyMessage(project: string, batch: Batch, round: number, rounds: number, state: CopyState, retry: boolean): string;
export declare function argumentMessage(project: string, withRepo: boolean): string;
/**
 * The check's errors as lines for the next round, one line per kind of problem: the same guidance repeated for twenty
 * paragraphs made an 8 KB message; grouped, each kind lists its places once and its guidance once.
 */
export declare function errorLines(findings: unknown): string[];
export declare function checkMessage(project: string, errors?: string[]): string;
