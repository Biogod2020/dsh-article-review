/** Source-order outline and locations shared by the review map and proposal cards. */
import type { PaperBlock } from '../schema.ts'

/** A block's zero-based source position and containing heading path. */
export interface ReviewLocation {
  index: number
  total: number
  headings: string[]
}

/** One navigable section or manuscript block in the outline tree. */
export type ReviewOutlineEntry = ReviewOutlineSection | { type: 'block'; block: PaperBlock; index: number }

/** A heading and its nested entries, covering a half-open source block interval. */
export interface ReviewOutlineSection {
  type: 'section'
  block: PaperBlock
  title: string
  level: number
  start: number
  end: number
  entries: ReviewOutlineEntry[]
}

/** @returns heading depth, including setext headings. */
function headingLevel(block: PaperBlock): number {
  const atx = /^(#{1,6})(?:\s|$)/.exec(block.text)
  if (atx) return atx[1]?.length ?? 1
  return /\n\s*=+\s*$/.test(block.text) ? 1 : 2
}

/**
 * Create a compact outline label from the original Markdown block.
 * @param block - source block to preview.
 * @param limit - maximum label length in characters.
 * @returns short, source-derived label without Markdown heading markers.
 */
export function blockPreview(block: PaperBlock, limit = 90): string {
  return block.text.replace(/^#{1,6}\s*/, '').replace(/\n\s*[=-]+\s*$/, '')
    .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

/**
 * Build title nesting and exact source-order locations without changing manuscript blocks.
 * @param blocks - manuscript blocks in their original order.
 * @returns hierarchical outline entries and locations indexed by block ID.
 */
export function reviewNavigation(blocks: PaperBlock[]): { entries: ReviewOutlineEntry[]; locations: Map<string, ReviewLocation> } {
  const entries: ReviewOutlineEntry[] = []
  const locations = new Map<string, ReviewLocation>()
  const stack: ReviewOutlineSection[] = []
  for (const [index, block] of blocks.entries()) {
    if (block.kind === 'heading') {
      const level = headingLevel(block)
      while (stack.length) {
        const current = stack.at(-1)
        if (!current || current.level < level) break
        current.end = index
        stack.pop()
      }
      const section: ReviewOutlineSection = { type: 'section', block, title: blockPreview(block), level,
        start: index, end: blocks.length, entries: [] }
      const parent = stack[stack.length - 1]
      if (parent) parent.entries.push(section)
      else entries.push(section)
      stack.push(section)
    } else {
      const leaf: ReviewOutlineEntry = { type: 'block', block, index }
      const parent = stack[stack.length - 1]
      if (parent) parent.entries.push(leaf)
      else entries.push(leaf)
    }
    locations.set(block.id, { index, total: blocks.length, headings: stack.map(section => section.title) })
  }
  return { entries, locations }
}
