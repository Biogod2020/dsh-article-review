/** Source-preserving Markdown blocks, conservative anchor migration and mechanical change checks. */
import { createHash, randomUUID } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Annotation, PaperBlock, PaperHighlight, PaperRevision, Proposal, ProposalInput } from './schema.ts'
import { collectFigures } from './figures.ts'
import { auditTextChanges } from './change-audit.ts'

/**
 * Hash exact UTF-8 source, including whitespace.
 * @param text - source.
 * @returns revision identity.
 */
export function revisionId(text: string): string { return createHash('sha256').update(text).digest('hex') }

/**
 * Preserve ids only for unambiguous exact blocks or explicit accepted replacements.
 * @param text - complete source.
 * @param previous - preceding parsed revision.
 * @param replacements - accepted replacements indexed by old id.
 * @returns source-offset blocks; ambiguous external rewrites get new ids.
 */
export function parseRevision(text: string, previous?: PaperRevision, replacements = new Map<string, string>()): PaperRevision {
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  let section = ''
  const blocks: PaperBlock[] = root.children.map((node) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) throw new Error('Markdown block has no source offsets')
    const raw = text.slice(start, end)
    if (node.type === 'heading') section = raw.replace(/^#+\s*/, '')
    return { id: randomUUID(), kind: node.type, section, text: raw, start, end }
  })
  // Index once: preserve the same conservative uniqueness rule without quadratic scans.
  const key = (kind: string, source: string): string => JSON.stringify([kind, source])
  const oldByKey = new Map<string, PaperBlock | null>()
  const newCounts = new Map<string, number>()
  for (const old of previous?.blocks ?? []) {
    const identity = key(old.kind, replacements.get(old.id) ?? old.text)
    oldByKey.set(identity, oldByKey.has(identity) ? null : old)
  }
  for (const block of blocks) {
    const identity = key(block.kind, block.text)
    newCounts.set(identity, (newCounts.get(identity) ?? 0) + 1)
  }
  for (const block of blocks) {
    const identity = key(block.kind, block.text), candidate = oldByKey.get(identity)
    if (candidate && newCounts.get(identity) === 1) block.id = candidate.id
  }
  const paths = new Set(collectFigures(blocks).map(figure => figure.path))
  const figureAssets = previous?.figureAssets?.filter(asset => paths.has(asset.path))
  return { id: revisionId(text), text, blocks, createdAt: new Date().toISOString(), ...(figureAssets?.length ? { figureAssets } : {}) }
}

/**
 * Refuse ambiguous or missing quotations instead of guessing their new location.
 * @param annotations - prior anchors.
 * @param revision - current source.
 * @returns migrated anchor statuses with their original quotation and version intact.
 */
export function migrateAnnotations<T extends Annotation | PaperHighlight>(annotations: T[], revision: PaperRevision): T[] {
  const blocks = new Map(revision.blocks.map(block => [block.id, block]))
  const unique = (source: string, target: string): boolean => {
    if (!target) return false
    const first = source.indexOf(target)
    return first !== -1 && source.indexOf(target, first + 1) === -1
  }
  return annotations.map((annotation) => {
    const block = blocks.get(annotation.blockId)
    const quote = annotation.quote
    const needle = annotation.prefix + quote + annotation.suffix
    const attached = block !== undefined && (annotation.renderedSource !== undefined
      ? block.text === annotation.renderedSource
      : quote === '' || unique(block.text, needle) || unique(block.text, quote))
    return { ...annotation, anchor: attached ? 'attached' : 'needs-location' }
  })
}

/**
 * Detect lexical changes that merit review, without certifying scientific meaning.
 * @param proposal - raw edits and author-declared meaning.
 * @param blocks - source blocks for Methods context.
 * @returns independent mechanical risk labels.
 */
export function checkChanges(proposal: ProposalInput, blocks: PaperBlock[]): Proposal['flags'] {
  const flags = new Set<Proposal['flags'][number]>()
  const byId = new Map(blocks.map(block => [block.id, block]))
  const methodBlocks = new Set<string>()
  const headings: { depth: number; methods: boolean }[] = []
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const depth = block.text.match(/^ {0,3}(#{1,6})(?:\s|$)/)?.[1]?.length
        ?? (/\n {0,3}=+\s*$/.test(block.text) ? 1 : 2)
      while (headings.length && headings.at(-1)!.depth >= depth) headings.pop()
      headings.push({ depth, methods: /method|方法|experimental setup|statistical analys/i.test(block.text) })
    }
    if (headings.some(heading => heading.methods) || /method|方法/i.test(block.section)) methodBlocks.add(block.id)
  }
  for (const edit of proposal.edits) {
    for (const evidence of auditTextChanges(edit.operation ? '' : edit.before, edit.after)) flags.add(evidence.category)
    if (methodBlocks.has(edit.blockId)) flags.add('methods')
    const original = byId.get(edit.blockId)
    const resulting = edit.operation ? [] : parseRevision(edit.after).blocks
    if (proposal.meaning === 'structure' || edit.operation || resulting.length !== 1 || resulting[0]?.kind !== original?.kind) flags.add('structure')
  }
  return [...flags]
}
