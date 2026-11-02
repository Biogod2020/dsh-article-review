/**
 * Project mode: a paper is a project that moves from materials to a story-flow skeleton, then to claims and
 * figures, then to prose, then to reading review. The skeleton stays the reference after drafting: every
 * paragraph records which claims it states and the claim text it was written from, so either side drifting
 * is visible.
 */
import { z } from 'zod'

const id = z.string().min(1).max(80)
const text = z.string().max(20_000)

/** Ordered stages; the author advances them, checklists only advise. */
export const STAGES = ['materials', 'skeleton', 'refine', 'draft', 'read', 'submit'] as const
export const StageSchema = z.enum(STAGES)
export type Stage = z.infer<typeof StageSchema>

/** A figure panel that can be attached to evidence; image is a workspace path or URL. */
/** image may be omitted in an agent's upsert; applyChanges keeps the existing image of a panel with the same label. */
export const PanelSchema = z.object({ label: z.string().max(40), image: z.string().max(2000).default(''), note: z.string().max(2000).default(''),
  /** kept on purpose without a claim (backup or reviewer-response material), so not flagged as unused */
  spare: z.boolean().default(false) })
export const FigureSchema = z.object({
  id, label: z.string().max(40), title: z.string().max(400).default(''), caption: text.default(''),
  placement: z.enum(['main', 'extended', 'unplaced']).default('unplaced'),
  file: z.string().max(2000).default(''), panels: z.array(PanelSchema).default([]),
})
export type Figure = z.infer<typeof FigureSchema>

/** A number the paper may state, with where it comes from; prose and claims are checked against this list. */
export const NumberSchema = z.object({ id, label: z.string().max(200), value: z.string().max(80), source: z.string().max(1000).default('') })
export type RegisteredNumber = z.infer<typeof NumberSchema>

export const EVIDENCE_KINDS = ['how', 'support', 'limit', 'gap'] as const
export const EVIDENCE_STATUS = ['sufficient', 'partial', 'missing', 'risk'] as const
export const EvidenceSchema = z.object({
  id, kind: z.enum(EVIDENCE_KINDS).default('support'), status: z.enum(EVIDENCE_STATUS).default('partial'),
  text, source: z.string().max(1000).default(''),
  panels: z.array(z.object({ figure: id, label: z.string().max(40) })).default([]),
  /** Gap evidence is a to-do: who closes it and by when. */
  owner: z.string().max(80).default(''), due: z.string().max(40).default(''),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const ClaimSchema = z.object({
  id, title: z.string().max(400), statement: text, role: z.enum(['core', 'support']).default('support'),
  /** What a reviewer will ask; drafting must answer it. */
  reviewerQuestion: text.default(''),
  evidence: z.array(EvidenceSchema).default([]),
})
export type Claim = z.infer<typeof ClaimSchema>

/** One step of the story; claims carry it. */
export const BeatSchema = z.object({ id, title: z.string().max(400), summary: text.default(''), claims: z.array(id).default([]) })
export type Beat = z.infer<typeof BeatSchema>

/** A paragraph of the draft. basis = claim id -> hash of that claim when the paragraph was written or synced. */
export const ParagraphSchema = z.object({
  id, text, claims: z.array(id).default([]), basis: z.record(z.string(), z.string()).default({}),
})
export type Paragraph = z.infer<typeof ParagraphSchema>
export const SectionSchema = z.object({ id, heading: z.string().max(400), beat: z.string().max(80).default(''), paragraphs: z.array(ParagraphSchema).default([]) })
export type Section = z.infer<typeof SectionSchema>

/** Who said it. Personas are model reviewers with fixed roles; chat is a request made in the conversation. */
/** check = a problem found by checks (initialisation, repository); it reaches the author like a person's comment. */
export const COMMENT_SOURCES = ['author', 'collaborator', 'editor', 'reviewer', 'audience', 'chat', 'check'] as const
export type CommentSource = typeof COMMENT_SOURCES[number]
export const TargetSchema = z.object({
  kind: z.enum(['project', 'thesis', 'beat', 'claim', 'evidence', 'figure', 'paragraph']),
  id: z.string().max(80).default(''), quote: z.string().max(2000).default(''),
})
export type Target = z.infer<typeof TargetSchema>
export const CommentSchema = z.object({
  id, target: TargetSchema, source: z.enum(COMMENT_SOURCES), author: z.string().max(80), text,
  status: z.enum(['open', 'answered', 'closed', 'declined']).default('open'),
  /** The agent's reply: what it changed, and in which revision. */
  response: z.object({ text, revision: z.number().int(), at: z.string() }).optional(),
  createdAt: z.string(), stage: StageSchema,
  /** Person asked to handle it (a co-author, a student); empty = the author. */
  assignee: z.string().max(80).default(''),
})
export type Comment = z.infer<typeof CommentSchema>

/** A dependency between claims; only shown in the optional network view. */
export const LinkSchema = z.object({ from: id, to: id, label: z.string().max(200).default('') })

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  title: z.string().max(400), journal: z.string().max(200).default(''),
  /** Who must understand the paper; personas and drafting read this. */
  audience: z.string().max(1000).default(''),
  /** House style for drafting, e.g. plain expert English for non-native readers. */
  style: z.string().max(4000).default(''),
  stage: StageSchema.default('materials'),
  materials: z.array(z.object({ id, label: z.string().max(400), path: z.string().max(2000).default(''), note: z.string().max(2000).default('') })).default([]),
  thesis: z.object({ title: z.string().max(400).default(''), statement: text.default('') }).default({ title: '', statement: '' }),
  beats: z.array(BeatSchema).default([]),
  claims: z.array(ClaimSchema).default([]),
  figures: z.array(FigureSchema).default([]),
  numbers: z.array(NumberSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  links: z.array(LinkSchema).default([]),
  /** Numbers the author checked and keeps unregistered (method parameters etc.): "value" for everywhere, "where|value" for one place. */
  numberIgnores: z.array(z.string().max(200)).default([]),
})
export type Project = z.infer<typeof ProjectSchema>

/** One recorded change; reason and the comments it answers make the history explain itself. */
export const HistoryEntrySchema = z.object({
  revision: z.number().int(), at: z.string(), actor: z.string(), reason: z.string(),
  comments: z.array(id).default([]), units: z.array(z.string()).default([]),
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

/** Private review state beside the project: comments, the author's reviewed hashes, history. */
/**
 * A proposed rewrite of one paragraph, waiting for the author. Prose is never replaced silently: the author sees the
 * word diff and accepts or discards it. Accepting checks that the paragraph still reads as `before`.
 */
export const DraftSchema = z.object({
  id, section: id, paragraph: id, before: text, after: text, claims: z.array(id).default([]),
  reason: z.string().max(2000), actor: z.string().max(200), comments: z.array(id).default([]),
  createdAt: z.string(), status: z.enum(['pending', 'accepted', 'discarded', 'stale']).default('pending'),
})
export type Draft = z.infer<typeof DraftSchema>

export const ReviewStateSchema = z.object({
  revision: z.number().int().default(0),
  comments: z.array(CommentSchema).default([]),
  /** unit key -> hash of the content the author last marked reviewed */
  reviewed: z.record(z.string(), z.object({ hash: z.string(), revision: z.number().int(), at: z.string() })).default({}),
  history: z.array(HistoryEntrySchema).default([]),
  drafts: z.array(DraftSchema).default([]),
  /** Agent's first sort of unregistered numbers ("where|value" -> kind + why); a hint for the author, never a decision. */
  numberHints: z.record(z.string(), z.object({ kind: z.enum(['result', 'parameter', 'citation', 'other']), note: z.string().max(400) })).default({}),
})
export type ReviewState = z.infer<typeof ReviewStateSchema>

/**
 * A change the agent or the author applies. Units are replaced whole (upsert) or removed; the store records the
 * changed unit keys so the author sees them as "changed since review".
 */
export const ChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set-meta'), fields: ProjectSchema.pick({ title: true, journal: true, audience: true, style: true }).partial() }),
  z.object({ op: z.literal('set-thesis'), thesis: z.object({ title: z.string().max(400), statement: text }) }),
  z.object({ op: z.literal('upsert-beat'), beat: BeatSchema, index: z.number().int().optional() }),
  z.object({ op: z.literal('upsert-claim'), claim: ClaimSchema }),
  z.object({ op: z.literal('upsert-figure'), figure: FigureSchema }),
  z.object({ op: z.literal('upsert-number'), number: NumberSchema }),
  z.object({ op: z.literal('upsert-section'), section: SectionSchema, index: z.number().int().optional() }),
  z.object({ op: z.literal('upsert-paragraph'), section: id, paragraph: ParagraphSchema, after: z.string().max(80).optional() }),
  z.object({ op: z.literal('remove'), unit: z.enum(['beat', 'claim', 'figure', 'number', 'section', 'paragraph']), id }),
  z.object({ op: z.literal('set-links'), links: z.array(LinkSchema) }),
  z.object({ op: z.literal('ignore-number'), value: z.string().max(80), where: z.string().max(120).default('') }),
])
export type Change = z.infer<typeof ChangeSchema>
