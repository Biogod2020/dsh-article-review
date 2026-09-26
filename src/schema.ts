/** Validated on-disk and RPC records. Review baselines change only on an explicit human action. */
import { z } from 'zod'

const id = z.string().min(1).max(160)
const text = z.string().max(2_000_000)

/** A source block, with a durable identity independent of its position and content hash. */
export const BlockSchema = z.object({
  id, kind: z.string(), section: z.string(), text,
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
})
/** One immutable imported or accepted manuscript version. */
export const RevisionSchema = z.object({ id, text, blocks: z.array(BlockSchema), createdAt: z.string() })
/** A quotation anchored to the block and the exact version the reader saw. */
export const AnnotationSchema = z.object({
  id, blockId: id, revision: id, quote: text, prefix: text, suffix: text, comment: text,
  renderedSource: text.optional(), offset: z.number().int().nonnegative().optional(),
  status: z.enum(['open', 'resolved']), anchor: z.enum(['attached', 'needs-location']),
})
/** Reader marks retain their source snapshot; removal is reversible and never edits the manuscript. */
export const HighlightSchema = z.object({
  id, blockId: id, revision: id, quote: z.string().min(1).max(100_000), prefix: text, suffix: text,
  renderedSource: text, offset: z.number().int().nonnegative(), color: z.enum(['yellow', 'green', 'blue', 'underline']),
  anchor: z.enum(['attached', 'needs-location']), removed: z.boolean(),
})
/** Replace or delete an exact block, or insert Markdown beside it; source writes still need acceptance. */
export const EditSchema = z.object({
  blockId: id, before: text, after: text,
  operation: z.enum(['insert-before', 'insert-after']).optional(),
})
/** A model proposal is never itself a write authorization. */
export const ProposalInputSchema = z.object({
  baseRevision: id, annotationIds: z.array(id), reason: z.string().min(1).max(4000),
  meaning: z.enum(['style', 'structure', 'claim', 'evidence']), edits: z.array(EditSchema).min(1).max(30),
})
/** Update selected fields of a pending proposal against the current reader version. */
export const ProposalRevisionInputSchema = z.object({
  proposalId: id, revision: id,
  baseRevision: id.optional(),
  ...ProposalInputSchema.omit({ baseRevision: true }).partial().shape,
}).refine(input => input.baseRevision !== undefined || input.annotationIds !== undefined || input.reason !== undefined
  || input.meaning !== undefined || input.edits !== undefined, 'Provide at least one proposal field to revise')
/** A proposal and the deterministic checks recorded when it was submitted. */
export const ProposalSchema = ProposalInputSchema.extend({
  id, status: z.enum(['pending', 'accepted', 'rejected']), createdAt: z.string(),
  flags: z.array(z.enum(['numbers', 'citations', 'figures', 'claim-language', 'methods', 'structure'])),
})
/** Per-block human review state; accepting a proposal does not advance it. */
export const BaselineSchema = z.object({ blockId: id, revision: id, text, locked: z.boolean(), reviewedAt: z.string() })
/** Project-persisted state for one manuscript. No browser storage is authoritative. */
export const DocumentSchema = z.object({
  schemaVersion: z.literal(1), path: z.string().min(1), current: RevisionSchema,
  revisions: z.array(RevisionSchema), annotations: z.array(AnnotationSchema), proposals: z.array(ProposalSchema),
  highlights: z.array(HighlightSchema).default([]),
  baselines: z.array(BaselineSchema), history: z.array(z.object({ at: z.string(), action: z.string(), detail: z.string() })),
  reading: z.record(z.string(), z.string()),
})
/** Model and browser input accepted by the operator RPC dispatcher. */
export const CommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), path: z.string().min(1) }),
  z.object({ action: z.literal('refresh'), path: z.string().min(1), revision: id }),
  z.object({ action: z.literal('annotate'), path: z.string(), revision: id, blockId: id, quote: text, prefix: text, suffix: text, rendered: z.boolean().optional(), offset: z.number().int().nonnegative().optional(), comment: z.string().min(1).max(4000) }),
  z.object({ action: z.literal('highlight'), path: z.string(), revision: id, blockId: id, quote: z.string().min(1).max(100_000), prefix: text, suffix: text, offset: z.number().int().nonnegative(), color: HighlightSchema.shape.color }),
  z.object({ action: z.literal('set-highlight'), path: z.string(), highlightId: id, removed: z.boolean() }),
  z.object({ action: z.literal('resolve'), path: z.string(), annotationId: id, resolved: z.boolean() }),
  z.object({ action: z.literal('review'), path: z.string(), revision: id, blockIds: z.array(id).min(1), locked: z.boolean() }),
  z.object({ action: z.literal('unlock'), path: z.string(), blockId: id }),
  z.object({ action: z.literal('decide'), path: z.string(), revision: id, proposalId: id, accept: z.boolean() }),
  z.object({ action: z.literal('position'), path: z.string(), reader: id, blockId: id }),
])
/** Wire response, also validates browser reads before rendering. */
export const ViewSchema = z.object({ document: DocumentSchema, diskChanged: z.boolean() })
/** One bounded directory level of Markdown files and folders. */
export const FileListingSchema = z.object({ path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(['directory', 'file']) })), truncated: z.boolean() })
/** BibTeX remains on disk; this read-only projection keeps the bibliography outside the manuscript body. */
export const BibliographyViewSchema = z.object({
  files: z.array(z.string()),
  entries: z.array(z.object({ key: z.string(), type: z.string(), file: z.string(), hash: z.string(),
    fields: z.record(z.string(), z.string()) })),
  missingKeys: z.array(z.string()), possibleBareKeys: z.array(z.string()),
  canonicalCitationCount: z.number().int().nonnegative(),
  citationStatus: z.enum(['unbound', 'missing-keys', 'possible-legacy-keys', 'resolved', 'no-citations']),
})
/** Successful Connection envelope for operator clients. */
export const ViewResponseSchema = z.object({ result: z.object({ ok: z.literal(true), value: ViewSchema }) })
/** Validated manuscript state. */
export type PaperDocument = z.infer<typeof DocumentSchema>
/** One block in a revision. */
export type PaperBlock = z.infer<typeof BlockSchema>
/** Immutable manuscript revision. */
export type PaperRevision = z.infer<typeof RevisionSchema>
/** Stored reader annotation. */
export type Annotation = z.infer<typeof AnnotationSchema>
/** Persisted reader highlight or underline. */
export type PaperHighlight = z.infer<typeof HighlightSchema>
/** Pending or settled modification. */
export type Proposal = z.infer<typeof ProposalSchema>
/** Proposal submitted by the model. */
export type ProposalInput = z.infer<typeof ProposalInputSchema>
/** Partial in-place update of a pending proposal. */
export type ProposalRevisionInput = z.infer<typeof ProposalRevisionInputSchema>
/** Validated operator action. */
export type PaperCommand = z.infer<typeof CommandSchema>
/** Version-pinned reader response. */
export type PaperView = z.infer<typeof ViewSchema>
/** Operator file-picker listing. */
export type FileListing = z.infer<typeof FileListingSchema>
/** Indexed authoritative `.bib` files and manuscript citation diagnostics. */
export type BibliographyView = z.infer<typeof BibliographyViewSchema>
