/** Source-order outline and locations shared by the review map and proposal cards. */
import type { PaperBlock } from '../schema.ts';
/** A block's zero-based source position and containing heading path. */
export interface ReviewLocation {
    index: number;
    total: number;
    headings: string[];
}
/** One navigable section or manuscript block in the outline tree. */
export type ReviewOutlineEntry = ReviewOutlineSection | {
    type: 'block';
    block: PaperBlock;
    index: number;
};
/** A heading and its nested entries, covering a half-open source block interval. */
export interface ReviewOutlineSection {
    type: 'section';
    block: PaperBlock;
    title: string;
    level: number;
    start: number;
    end: number;
    entries: ReviewOutlineEntry[];
}
/**
 * Create a compact outline label from the original Markdown block.
 * @param block - source block to preview.
 * @param limit - maximum label length in characters.
 * @returns short, source-derived label without Markdown heading markers.
 */
export declare function blockPreview(block: PaperBlock, limit?: number): string;
/**
 * Build title nesting and exact source-order locations without changing manuscript blocks.
 * @param blocks - manuscript blocks in their original order.
 * @returns hierarchical outline entries and locations indexed by block ID.
 */
export declare function reviewNavigation(blocks: PaperBlock[]): {
    entries: ReviewOutlineEntry[];
    locations: Map<string, ReviewLocation>;
};
//# sourceMappingURL=review-navigation.d.ts.map