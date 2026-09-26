/** Browser-local workbench preferences and unsent drafts; never part of model context. */
import { z } from 'zod'

/** Workbench views whose positions are saved separately. */
export const PanelModeSchema = z.enum(['read', 'changes', 'versions', 'history', 'references'])
/** Current workbench view. */
export type PanelMode = z.infer<typeof PanelModeSchema>
const position = z.object({ top: z.number().nonnegative(),
  anchor: z.object({ blockId: z.string(), offset: z.number() }).optional() })
const stateSchema = z.object({
  mode: PanelModeSchema.default('read'),
  selectedBlockId: z.string().optional(),
  positions: z.record(z.string(), position).default({}),
  versions: z.object({ leftRevisionId: z.string(), rightRevisionId: z.string(),
    layout: z.enum(['rendered', 'split', 'inline']) }).optional(),
  references: z.object({ query: z.string(), page: z.number().int().nonnegative(),
    nextCitation: z.record(z.string(), z.number().int().nonnegative()) }).optional(),
})
/** Browser-local state keyed by session and manuscript, including revision-id based choices. */
export type WorkbenchState = z.infer<typeof stateSchema>
const draftSchema = z.object({ source: z.string(), revision: z.string(), comment: z.string(), quote: z.string(),
  anchor: z.object({ quote: z.string(), prefix: z.string(), suffix: z.string(), offset: z.number().int().nonnegative() }).optional() })
/** An unsent comment retains the exact source used to select its quotation. */
export type AnnotationDraft = z.infer<typeof draftSchema>
/** Drafts are retained even when their source block disappears. */
export type AnnotationDrafts = Record<string, AnnotationDraft>

function key(kind: string, session: string, path: string): string {
  return `paper-review:${kind}:${JSON.stringify([session, path])}`
}

/** Read preferences; unavailable or malformed browser storage starts with default UI state.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @returns validated UI state.
 */
export function readWorkbenchState(session: string, path: string): WorkbenchState {
  try {
    const raw = localStorage.getItem(key('workbench', session, path))
    return stateSchema.parse(raw ? JSON.parse(raw) : {})
  } catch { return { mode: 'read', positions: {} } }
}

/** Persist preferences without turning a browser quota failure into a manuscript error.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @param state - UI state.
 * @returns false when storage is unavailable or full; the mounted UI still retains its state.
 */
export function writeWorkbenchState(session: string, path: string, state: WorkbenchState): boolean {
  try { localStorage.setItem(key('workbench', session, path), JSON.stringify(state)); return true }
  catch { return false }
}

/** Read unsent drafts without associating them with a changed source.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @returns validated drafts.
 */
export function readAnnotationDrafts(session: string, path: string): AnnotationDrafts {
  try {
    const raw = localStorage.getItem(key('drafts', session, path))
    return raw ? z.record(z.string(), draftSchema).parse(JSON.parse(raw)) : {}
  } catch { return {} }
}

/** Save unsent drafts locally; callers must expose failure so users can copy their text.
 * @param session - native conversation.
 * @param path - manuscript path.
 * @param drafts - complete draft map.
 * @returns false when the browser refuses persistence.
 */
export function writeAnnotationDrafts(session: string, path: string, drafts: AnnotationDrafts): boolean {
  try { localStorage.setItem(key('drafts', session, path), JSON.stringify(drafts)); return true }
  catch { return false }
}
