/** Revision-pinned pagination without truncating exact Markdown blocks needed for safe edits. */
import { z } from 'zod'
import type { PaperRevision } from './schema.ts'

/** Pagination limits; character budget is soft only for the first indivisible block. */
export const ReadPageSchema = z.object({
  startBlock: z.number().int().nonnegative().default(0),
  maxBlocks: z.number().int().min(1).max(200).default(40),
  maxCharacters: z.number().int().min(1000).max(200_000).default(32_000),
  revision: z.string().min(1).optional(),
})
/** Read whole blocks in source order. Never continue across a revision change. */
export function readManuscriptPage(revision: PaperRevision, input: z.input<typeof ReadPageSchema>) {
  const options = ReadPageSchema.parse(input)
  if (options.startBlock > 0 && options.revision === undefined) throw new Error('Continuation requires the revision returned by the first page')
  if (options.revision !== undefined && options.revision !== revision.id) throw new Error('Reader revision changed; restart pagination with the current revision')
  if (options.startBlock > revision.blocks.length) throw new RangeError('startBlock exceeds the manuscript block count')
  let end = options.startBlock, characters = 0
  while (end < revision.blocks.length && end - options.startBlock < options.maxBlocks) {
    const length = revision.blocks[end]!.text.length
    if (end > options.startBlock && characters + length > options.maxCharacters) break
    characters += length; end++
    if (characters >= options.maxCharacters) break
  }
  return { blocks: revision.blocks.slice(options.startBlock, end), page: {
    startBlock: options.startBlock, endBlockExclusive: end, totalBlocks: revision.blocks.length,
    nextStartBlock: end < revision.blocks.length ? end : null, characters,
    exceededCharacterBudget: characters > options.maxCharacters,
  } }
}
