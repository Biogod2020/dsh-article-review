/** Reader-only labels for canonical citations; BibTeX remains the source of metadata. */
import type { BibliographyView } from '../schema.ts';
type BibEntry = BibliographyView['entries'][number];
/**
 * Show `[@key]` groups as author-year citations without changing the saved Markdown.
 * Unknown or incomplete entries stay visible as keys rather than suggesting verification.
 * @param source - one Markdown block from the manuscript.
 * @param entries - entries in its bound BibTeX files.
 * @returns display-only Markdown with resolvable citation groups formatted.
 */
export declare function displayCitations(source: string, entries: readonly BibEntry[]): string;
export {};
//# sourceMappingURL=citation-display.d.ts.map