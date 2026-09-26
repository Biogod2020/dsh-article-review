import type { ReactNode } from 'react';
import type { BibliographyView, PaperBlock, PaperDocument, PaperRevision } from '../schema.ts';
import type { PaperReviewKey } from './locales.ts';
/** Saved choices use immutable revision IDs, not positions in the history array. */
export type VersionSelection = {
    leftRevisionId: string;
    rightRevisionId: string;
    layout: 'rendered' | 'split' | 'inline';
};
/**
 * Resolve unavailable selections to the preceding and latest saved revisions.
 * @param document - currently available saved revisions.
 * @param selection - previously selected IDs and display layout, when available.
 * @returns available comparison choices without mutating persisted review state.
 */
export declare function resolveVersionSelection(document: PaperDocument, selection?: VersionSelection): VersionSelection;
/**
 * Compare two saved revisions without writing the manuscript or its review state.
 * @param props - complete saved history and localized labels.
 * @returns read-only visual comparison.
 */
export declare function Versions({ document, t, figurePreview, selection, onSelectionChange, bibliography }: {
    document: PaperDocument;
    t: (key: PaperReviewKey) => string;
    figurePreview?: (revision: PaperRevision, block: PaperBlock) => ReactNode;
    selection?: VersionSelection | undefined;
    onSelectionChange?: ((selection: VersionSelection) => void) | undefined;
    bibliography?: BibliographyView | undefined;
}): ReactNode;
//# sourceMappingURL=versions.d.ts.map