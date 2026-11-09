import type { ReactNode } from 'react';
import type { FigureReference, ReadingFigure } from './reading-figures.ts';
export interface FigureReferenceActions {
    items: ReadingFigure[];
    windowId: string;
    selectedKey?: string | undefined;
    onPreview: (key: string, element: HTMLElement, source?: string) => void;
    onLeave: () => void;
    onOpen: (key: string, element: HTMLElement) => void;
}
/** Build ranges over the original rendered text, excluding authored links, code and math. */
export declare function referenceRanges(root: HTMLElement, items: ReadingFigure[]): {
    reference: FigureReference;
    range: Range;
}[];
export declare function FigureReferences({ actions, children }: {
    actions: FigureReferenceActions;
    children: ReactNode;
}): ReactNode;
