import type { Annotation, PaperBlock, PaperHighlight, PaperRevision, Proposal, ProposalInput } from './schema.ts';
/**
 * Hash exact UTF-8 source, including whitespace.
 * @param text - source.
 * @returns revision identity.
 */
export declare function revisionId(text: string): string;
/**
 * Preserve ids only for unambiguous exact blocks or explicit accepted replacements.
 * @param text - complete source.
 * @param previous - preceding parsed revision.
 * @param replacements - accepted replacements indexed by old id.
 * @returns source-offset blocks; ambiguous external rewrites get new ids.
 */
export declare function parseRevision(text: string, previous?: PaperRevision, replacements?: Map<string, string>): PaperRevision;
/**
 * Refuse ambiguous or missing quotations instead of guessing their new location.
 * @param annotations - prior anchors.
 * @param revision - current source.
 * @returns migrated anchor statuses with their original quotation and version intact.
 */
export declare function migrateAnnotations<T extends Annotation | PaperHighlight>(annotations: T[], revision: PaperRevision): T[];
/**
 * Detect lexical changes that merit review, without certifying scientific meaning.
 * @param proposal - raw edits and author-declared meaning.
 * @param blocks - source blocks for Methods context.
 * @returns independent mechanical risk labels.
 */
export declare function checkChanges(proposal: ProposalInput, blocks: PaperBlock[]): Proposal['flags'];
//# sourceMappingURL=document.d.ts.map