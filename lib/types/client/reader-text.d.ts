import type { MouseEvent, ReactNode } from 'react';
import type { Annotation, BibliographyView, PaperBlock, PaperHighlight } from '../schema.ts';
import type { TextAnchor } from './selection.ts';
/**
 * Render and paint a single block; registrations are private to this mount and removed on disposal.
 * @param props - source, attached marks, localized chrome and selection handlers.
 * @returns source-preserving reader text.
 */
export declare function ReaderText({ block, highlights, annotations, labels, bibliography, onSelect, onMenu, comparison }: {
    block: PaperBlock;
    highlights: PaperHighlight[];
    annotations: Annotation[];
    labels: {
        code: {
            copyLabel: string;
            copiedLabel: string;
        };
        footnotes: string;
    };
    bibliography?: BibliographyView | undefined;
    onSelect?: (anchor?: TextAnchor) => void;
    onMenu?: (event: MouseEvent, anchor?: TextAnchor) => void;
    comparison?: {
        opposite: string;
        side: 'before' | 'after';
    };
}): ReactNode;
//# sourceMappingURL=reader-text.d.ts.map