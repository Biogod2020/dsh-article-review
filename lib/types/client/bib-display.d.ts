/** Display-only BibTeX formatting and citation locations; saved metadata remains untouched. */
import type { BibliographyView, PaperBlock } from '../schema.ts';
type Entry = BibliographyView['entries'][number];
/** Convert common BibTeX formatting and accents to readable plain text, preserving unknown commands.
 * @param value - one original BibTeX field.
 * @returns display text without changing the authoritative field.
 */
export declare function plainBibText(value: string | undefined): string;
/** Resolve DOI and publication URLs without making non-web BibTeX values clickable.
 * @param entry - indexed authoritative metadata.
 * @returns validated external links, with duplicate URLs omitted.
 */
export declare function referenceLinks(entry: Entry): {
    doi: string | undefined;
    url: string | undefined;
};
/** Readable metadata used by both the list filter and panel-wide search.
 * @param entry - original bibliography entry.
 * @returns human-readable searchable text, including its exact citation key and source file.
 */
export declare function referenceEntryText(entry: Entry): string;
/** One canonical citation occurrence in a rendered manuscript block. */
export interface ReferenceCitationLocation {
    blockId: string;
    occurrence: number;
}
/** Index canonical citations once per block collection, excluding code and source comments.
 * @param blocks - current manuscript blocks in source order.
 * @returns locations for every cited key, including repeated occurrences in one paragraph.
 */
export declare function referenceCitationLocations(blocks: readonly PaperBlock[]): Map<string, ReferenceCitationLocation[]>;
export {};
//# sourceMappingURL=bib-display.d.ts.map