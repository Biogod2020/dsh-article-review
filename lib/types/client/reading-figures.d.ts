/** Resolve explicit figure callouts and verified panel targets in the displayed revision. */
import type { PaperBlock, PaperRevision } from '../schema.ts';
import type { PaperFigure } from '../figures.ts';
import type { FigurePanel } from '../figure-panels.ts';
export interface ReadingFigure {
    key: string;
    figure: PaperFigure;
    file: string;
    targets: string[];
    panel?: FigurePanel;
}
/** Whole figures remain selectable even when no panel map has been created. */
export declare function readingFigures(manuscript: string, base: string, revision: PaperRevision, figures: PaperFigure[], panels: FigurePanel[]): ReadingFigure[];
/** Match authored figure numbers or ids; caption proximity alone never implies an association. */
export declare function relatedReadingFigures(block: PaperBlock | undefined, items: ReadingFigure[]): ReadingFigure[];
export interface FigureReference {
    start: number;
    end: number;
    label: string;
    item: ReadingFigure;
}
/** Resolve printed callouts, including shorthand lists, without inventing missing panels. */
export declare function figureReferences(text: string, items: ReadingFigure[]): FigureReference[];
