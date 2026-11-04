/** Reading pages follow Markdown headings and never split an authored block. */
import type { PaperBlock } from '../schema.ts';
export interface ReadingSection {
    id: string;
    title: string;
    level: number;
    blocks: PaperBlock[];
}
/** Split at section headings below the document title, including Setext headings. */
export declare function readingSections(blocks: PaperBlock[]): ReadingSection[];
/** Resolve a saved block after a mode change or revision; a deleted anchor starts at page one. */
export declare function sectionForBlock(sections: ReadingSection[], blockId?: string): number;
