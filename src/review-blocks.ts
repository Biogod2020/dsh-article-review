/** Reader-visible and reviewable manuscript blocks. */
import type { PaperBlock } from './schema.ts'

/**
 * Hide a top-level bibliography section without altering manuscript source.
 * @param blocks - parsed manuscript blocks.
 * @returns blocks visible in the reader.
 */
export function readingBlocks(blocks: PaperBlock[]): PaperBlock[] {
  let hiddenLevel = 0
  return blocks.filter((block) => {
    if (block.kind === 'heading') {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(block.text)
      if (match) {
        const level = (match[1] ?? '').length
        if (hiddenLevel && level <= hiddenLevel) hiddenLevel = 0
        if (level <= 2 && /^(?:references|bibliography)$/i.test(match[2] ?? '')) hiddenLevel = level
      }
    }
    return !hiddenLevel
  })
}

/**
 * Exclude provenance comments and bibliography from the human-review denominator.
 * @param blocks - parsed manuscript blocks.
 * @returns blocks that count toward review progress.
 */
export function reviewableBlocks(blocks: PaperBlock[]): PaperBlock[] {
  return readingBlocks(blocks).filter(block => !(block.kind === 'html' && /^\s*<!--/.test(block.text)))
}
