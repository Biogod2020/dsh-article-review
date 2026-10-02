/** The browser receives the current manuscript and a historical version index, never every saved body. */
import { z } from 'zod'
import { DocumentSchema, RevisionSchema } from './schema.ts'
import type { PaperView } from './schema.ts'

/** Immutable IDs and dates are enough for version choices. */
export const RevisionSummarySchema = RevisionSchema.pick({ id: true, createdAt: true })
/** Browser projection; the full durable document stays on the host. */
export const WorkbenchViewSchema = z.object({
  document: DocumentSchema.omit({ revisions: true }).extend({ revisions: z.array(RevisionSummarySchema) }),
  diskChanged: z.boolean(),
})
export type WorkbenchView = z.infer<typeof WorkbenchViewSchema>
export type WorkbenchDocument = WorkbenchView['document']

/** Project an already validated store read without cloning its current manuscript or altering history. */
export function workbenchView(view: PaperView): WorkbenchView {
  return { ...view, document: { ...view.document,
    revisions: view.document.revisions.map(({ id, createdAt }) => ({ id, createdAt })),
  } }
}
