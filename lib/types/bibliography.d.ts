export { readingBlocks, reviewableBlocks } from './review-blocks.ts';
/** One exact BibTeX entry and its fields; field values are not claims of source verification. */
export interface BibEntry {
    key: string;
    type: string;
    raw: string;
    hash: string;
    fields: Record<string, string>;
    file: string;
}
/** A canonical `[@key]` or `[@first; @second]` manuscript citation. */
export interface Citation {
    keys: string[];
    raw: string;
    start: number;
    end: number;
}
/**
 * Find likely unmarked citation keys in prose, ignoring code, math, and canonical citations.
 * @param text - manuscript Markdown to inspect.
 * @param boundKeys - keys available in the bound BibTeX files.
 * @returns possible bare keys for author review, not verified citations.
 */
export declare function possibleBareCitationKeys(text: string, boundKeys: Iterable<string>): string[];
/**
 * Index entries without rewriting BibTeX syntax or expanding macros.
 * @param text - exact source file.
 * @param file - workspace-relative source identity.
 * @returns entries with exact raw ranges for conflict-checked replacement.
 */
export declare function parseBibtex(text: string, file: string): BibEntry[];
/**
 * Find canonical citations outside inline code while retaining source offsets.
 * @param text - Markdown source block.
 * @returns recognized canonical citations.
 */
export declare function citationsIn(text: string): Citation[];
/**
 * Reject newly introduced unresolved or unmarked citations without blocking unchanged legacy prose.
 * @param before - exact source block before a proposal.
 * @param after - proposed replacement.
 * @param keys - keys in the bound `.bib` files, or null when no files are bound.
 */
export declare function assertNewCitations(before: string, after: string, keys: ReadonlySet<string> | null): void;
/**
 * Format a compact author-year label without claiming bibliographic verification.
 * @param entry - indexed BibTeX metadata.
 * @returns author-year display label.
 */
export declare function citationLabel(entry: BibEntry): string;
//# sourceMappingURL=bibliography.d.ts.map