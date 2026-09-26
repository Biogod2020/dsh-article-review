/** Browser-local workbench preferences and unsent drafts; never part of model context. */
import { z } from 'zod';
/** Workbench views whose positions are saved separately. */
export declare const PanelModeSchema: z.ZodEnum<{
    history: "history";
    read: "read";
    changes: "changes";
    references: "references";
    versions: "versions";
}>;
/** Current workbench view. */
export type PanelMode = z.infer<typeof PanelModeSchema>;
declare const stateSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<{
        history: "history";
        read: "read";
        changes: "changes";
        references: "references";
        versions: "versions";
    }>>;
    selectedBlockId: z.ZodOptional<z.ZodString>;
    positions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        top: z.ZodNumber;
        anchor: z.ZodOptional<z.ZodObject<{
            blockId: z.ZodString;
            offset: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    versions: z.ZodOptional<z.ZodObject<{
        leftRevisionId: z.ZodString;
        rightRevisionId: z.ZodString;
        layout: z.ZodEnum<{
            rendered: "rendered";
            split: "split";
            inline: "inline";
        }>;
    }, z.core.$strip>>;
    references: z.ZodOptional<z.ZodObject<{
        query: z.ZodString;
        page: z.ZodNumber;
        nextCitation: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Browser-local state keyed by session and manuscript, including revision-id based choices. */
export type WorkbenchState = z.infer<typeof stateSchema>;
declare const draftSchema: z.ZodObject<{
    source: z.ZodString;
    revision: z.ZodString;
    comment: z.ZodString;
    quote: z.ZodString;
    anchor: z.ZodOptional<z.ZodObject<{
        quote: z.ZodString;
        prefix: z.ZodString;
        suffix: z.ZodString;
        offset: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** An unsent comment retains the exact source used to select its quotation. */
export type AnnotationDraft = z.infer<typeof draftSchema>;
/** Drafts are retained even when their source block disappears. */
export type AnnotationDrafts = Record<string, AnnotationDraft>;
/** Read preferences; unavailable or malformed browser storage starts with default UI state.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @returns validated UI state.
 */
export declare function readWorkbenchState(session: string, path: string): WorkbenchState;
/** Persist preferences without turning a browser quota failure into a manuscript error.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @param state - UI state.
 * @returns false when storage is unavailable or full; the mounted UI still retains its state.
 */
export declare function writeWorkbenchState(session: string, path: string, state: WorkbenchState): boolean;
/** Read unsent drafts without associating them with a changed source.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @returns validated drafts.
 */
export declare function readAnnotationDrafts(session: string, path: string): AnnotationDrafts;
/** Save unsent drafts locally; callers must expose failure so users can copy their text.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @param drafts - complete draft map.
 * @returns false when the browser refuses persistence.
 */
export declare function writeAnnotationDrafts(session: string, path: string, drafts: AnnotationDrafts): boolean;
export {};
//# sourceMappingURL=workbench-state.d.ts.map