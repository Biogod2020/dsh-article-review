import type { MouseEvent, ReactNode } from 'react';
import type { Annotation, BibliographyView, PaperBlock, PaperHighlight } from '../schema.ts';
import type { TextAnchor } from './selection.ts';
import type { FigureReferenceActions } from './figure-references.tsx';
/**
 * Render and paint a single block; registrations are private to this mount and removed on disposal.
 * @param props - source, attached marks, localized chrome and selection handlers.
 * @returns source-preserving reader text.
 */
export declare function ReaderText({ block, highlights, annotations, labels, bibliography, onSelect, onMenu, comparison, figureReferences }: {
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
    figureReferences?: FigureReferenceActions | undefined;
    comparison?: {
        opposite: string;
        side: 'before' | 'after';
    };
}): ReactNode;
