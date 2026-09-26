/** Source-preserving Markdown blocks, conservative anchor migration and mechanical change checks. */
import { createHash, randomUUID } from 'node:crypto'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Annotation, PaperBlock, PaperHighlight, PaperRevision, Proposal, ProposalInput } from './schema.ts'

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
  for (const block of blocks) {
    const candidates = previous?.blocks.filter(old =>
      (replacements.get(old.id) ?? old.text) === block.text && old.kind === block.kind) ?? []
    const candidate = candidates[0]
    if (candidate && candidates.length === 1 && blocks.filter(b => b.text === block.text && b.kind === block.kind).length === 1) {
      block.id = candidate.id
    }
  }
  return { id: revisionId(text), text, blocks, createdAt: new Date().toISOString() }
}

/**
 * Refuse ambiguous or missing quotations instead of guessing their new location.
 * @param annotations - prior anchors.
 * @param revision - current source.
 * @returns migrated anchor statuses with their original quotation and version intact.
 */
export function migrateAnnotations<T extends Annotation | PaperHighlight>(annotations: T[], revision: PaperRevision): T[] {
  return annotations.map((annotation) => {
    const block = revision.blocks.find(b => b.id === annotation.blockId)
    const quote = annotation.quote
    const needle = annotation.prefix + quote + annotation.suffix
    const occurrences = (source: string, target: string): number => target ? source.split(target).length - 1 : 0
    const attached = block !== undefined && (annotation.renderedSource !== undefined
      ? block.text === annotation.renderedSource
      : quote === '' || occurrences(block.text, needle) === 1 || occurrences(block.text, quote) === 1)
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
  const patterns: [Proposal['flags'][number], RegExp][] = [
    ['numbers', /(?:\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\s*(?:%|mg|kg|mm|cm|mL|μm|µm|s\b)?)/gi],
    ['citations', /\[@[^\]]+\]|\[cite:\s*[^\]]+\]|\\cite\w*\{[^}]+\}|\[\d+(?:[-,–]\s*\d+)*\]|\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g],
    ['figures', /\b(?:fig(?:ure)?\.?|table|supplement(?:ary)?|extended data)\s*[\da-z.()-]+/gi],
    ['claim-language', /\b(?:all|always|consistently|significant(?:ly)?|robust(?:ly)?|generali[sz]\w*|caus\w*|prove\w*|superior|outperform\w*|novel|first|only|may|might|not|no)\b|所有|显著|因果|证明|泛化|优于|首次|可能|未|不/g],
  ]
  for (const edit of proposal.edits) {
    for (const [flag, pattern] of patterns) {
      const before = edit.operation ? '' : edit.before
      if (JSON.stringify(before.match(pattern) ?? []) !== JSON.stringify(edit.after.match(pattern) ?? [])) flags.add(flag)
    }
    if (/method|方法/i.test(blocks.find(b => b.id === edit.blockId)?.section ?? '')) flags.add('methods')
    const original = blocks.find(block => block.id === edit.blockId)
    const resulting = edit.operation ? [] : parseRevision(edit.after).blocks
    if (proposal.meaning === 'structure' || edit.operation || resulting.length !== 1 || resulting[0]?.kind !== original?.kind) flags.add('structure')
  }
  return [...flags]
}
