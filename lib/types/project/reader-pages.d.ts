/**
 * Reading pages for the project reader, the same way the preprint reader of the paper frontend paginates: every
 * section starts a page, a section's text is cut into the fewest pages near a comfortable length (no short tails),
 * and a paragraph longer than a page is cut at sentence ends. Figure references in the text are found so the reader
 * can show, beside each page, the panels that page cites.
 */
import type { Project } from './model.ts';
export declare const TARGET_WORDS = 220;
export declare const MAX_WORDS = 270;
export declare const SPLIT_WORDS = 300;
/** A piece of one paragraph on a page; `part` > 0 marks a continuation of a paragraph cut at a sentence end. */
export interface Chunk {
    paragraph: string;
    text: string;
    part: number;
    front: boolean;
}
export interface ReadingPage {
    section: string;
    subsection: string;
    /** headings shown at the top of the page: the section (h2) and/or subsection (h3) that start here */
    heads: Array<{
        level: 2 | 3;
        text: string;
    }>;
    chunks: Chunk[];
}
/** "3.1. Hybrid Mode Interface", "B.2 …", "(ii) …" are subsections; "3. Results", "B. …", "Abstract" are sections. */
export declare function headingLevel(heading: string): 2 | 3;
/** Sentences of a paragraph: a cut after . ! ? followed by a capital or an opening bracket/quote. */
export declare function sentences(text: string): string[];
/** Cut a section's chunks into pages near TARGET_WORDS (dynamic programming; too long or too short is penalised). */
export declare function bestCuts(chunks: Chunk[]): Chunk[][];
export declare function paginate(project: Pick<Project, 'sections'>): ReadingPage[];
/** A figure reference in running text, resolved against the project's figures. */
export interface FigureRef {
    start: number;
    end: number;
    figure: string;
    panel: string | null;
}
/** Which kind of display item a label names: main figure, table, extended data, supplementary; plus its number. */
export declare function figureKey(label: string): string | null;
/**
 * Figure and table references in a paragraph: "Figure 2D", "Fig. 3a–c", "Figures 2 and 8", "Tables 1 and 2",
 * "Extended Data Fig. 4b", "Table S3". Each number in a list becomes its own reference; a panel letter selects the
 * panel with that label when the figure has one, otherwise the whole figure.
 */
export declare function figureRefs(text: string, figures: Project['figures']): FigureRef[];
