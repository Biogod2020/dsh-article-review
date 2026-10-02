/** Reader-visible and reviewable manuscript blocks. */
import type { PaperBlock } from './schema.ts';
/**
 * Hide a top-level bibliography section without altering manuscript source.
 * @param blocks - parsed manuscript blocks.
 * @returns blocks visible in the reader.
 */
export declare function readingBlocks(blocks: PaperBlock[]): PaperBlock[];
/**
 * Exclude provenance comments and bibliography from the human-review denominator.
 * @param blocks - parsed manuscript blocks.
 * @returns blocks that count toward review progress.
 */
export declare function reviewableBlocks(blocks: PaperBlock[]): PaperBlock[];
//# sourceMappingURL=review-blocks.d.ts.map