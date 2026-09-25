import type { ReactNode } from 'react';
import type { PaperDocument } from '../schema.ts';
import type { PaperReviewKey } from './locales.ts';
/**
 * Compare two saved revisions without writing the manuscript or its review state.
 * @param props - complete saved history and localized labels.
 * @returns read-only visual comparison.
 */
export declare function Versions({ document, t }: {
    document: PaperDocument;
    t: (key: PaperReviewKey) => string;
}): ReactNode;
//# sourceMappingURL=versions.d.ts.map