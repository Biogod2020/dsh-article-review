import type { ReactNode } from 'react';
import type { BibliographyView, PaperBlock, PaperRevision } from '../schema.ts';
import type { PaperReviewKey } from './locales.ts';
import type { WorkbenchDocument } from '../workbench-view.ts';
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
export declare function resolveVersionSelection(document: WorkbenchDocument, selection?: VersionSelection): VersionSelection;
/**
 * Compare two saved revisions without writing the manuscript or its review state.
 * @param props - complete saved history and localized labels.
 * @returns read-only visual comparison.
 */
export declare function Versions({ document, revisions, loading, error, onRetry, t, figurePreview, selection, onSelectionChange, bibliography }: {
    document: WorkbenchDocument;
    revisions?: PaperRevision[] | undefined;
    loading?: boolean | undefined;
    error?: string | undefined;
    onRetry?: (() => void) | undefined;
    t: (key: PaperReviewKey) => string;
    figurePreview?: (revision: PaperRevision, block: PaperBlock) => ReactNode;
    selection?: VersionSelection | undefined;
    onSelectionChange?: ((selection: VersionSelection) => void) | undefined;
    bibliography?: BibliographyView | undefined;
}): ReactNode;
