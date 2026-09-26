/** Explicit text context placed into the normal composer and therefore into the session log. */
import type { Annotation, PaperBlock, PaperDocument } from '../schema.ts';
import { en } from './locales.ts';
/**
 * Package selected annotations with exact source and neighbors, never silently include the full manuscript.
 * @param document - reader-pinned document.
 * @param annotations - selected notes.
 * @param selected - optional selected block.
 * @param intent - user's action.
 * @param copy - localized context labels and rules.
 * @returns editable composer text.
 */
export declare function reviewContext(document: PaperDocument, annotations: Annotation[], selected?: PaperBlock, intent?: string, copy?: Pick<typeof en, 'contextPath' | 'contextRevision' | 'contextRules' | 'contextData'>): string;
//# sourceMappingURL=context.d.ts.map