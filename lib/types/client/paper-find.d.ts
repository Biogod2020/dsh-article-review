import type { ReactNode, RefObject } from 'react';
import type { BibliographyView, PaperBlock } from '../schema.ts';
import type { PaperReviewKey } from './locales.ts';
type SearchableBlock = {
    id: string;
    text: string;
};
type FindHit = {
    blockId: string;
    occurrence: number;
};
/** Build a rendered-text index once per manuscript revision, excluding hidden source notes.
 * @param blocks - reader-visible manuscript blocks.
 * @param bibliography - citation labels shown in the reader.
 * @returns searchable text in reading order.
 */
export declare function searchableBlocks(blocks: PaperBlock[], bibliography?: BibliographyView): SearchableBlock[];
/** Locate literal, case-insensitive occurrences without parsing the document on every keystroke.
 * @param blocks - prepared reader text.
 * @param query - operator's search text.
 * @returns bounded matches in reading order.
 */
export declare function findPaperHits(blocks: SearchableBlock[], query: string): FindHit[];
/** Search the fixed manuscript and paint only mounted matches with CSS Highlights.
 * @param props - manuscript, panel focus scope, viewport and localized controls.
 * @returns a temporary search bar when opened from this pane.
 */
export declare function PaperFind({ panel, content, blocks, bibliography, mode, onRead, t }: {
    panel: RefObject<HTMLElement>;
    content: RefObject<HTMLElement>;
    blocks: PaperBlock[];
    bibliography?: BibliographyView | undefined;
    mode: string;
    onRead: () => void;
    t: (key: PaperReviewKey) => string;
}): ReactNode;
export {};
//# sourceMappingURL=paper-find.d.ts.map