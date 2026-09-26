import type { PaperBlock } from '../schema.ts';
/**
 * Pair blocks for display without changing their stored ids or annotation anchors.
 * Exact ids delimit gaps; within a bounded gap, only mutually distinctive similar blocks pair.
 * @param before - blocks from the left revision.
 * @param after - blocks from the right revision.
 * @returns left id to right id; uncertain insertions and rewrites remain unpaired.
 */
export declare function pairRevisionBlocks(before: PaperBlock[], after: PaperBlock[]): Map<string, string>;
//# sourceMappingURL=block-pairing.d.ts.map