/** Reading pages follow Markdown headings and never split an authored block. */
import type { PaperBlock } from '../schema.ts'

export interface ReadingSection { id: string; title: string; level: number; blocks: PaperBlock[] }

/** Split at section headings below the document title, including Setext headings. */
export function readingSections(blocks: PaperBlock[]): ReadingSection[] {
  const sections: ReadingSection[] = []
  let current: ReadingSection | undefined
  const levels = blocks.filter(block => block.kind === 'heading').map(headingLevel)
  const minimum = Math.min(...levels)
  const titleOnly = levels.filter(level => level === minimum).length === 1 && minimum === 1
  for (const block of blocks) {
    const level = headingLevel(block)
    const starts = block.kind === 'heading' && (!titleOnly || level > 1)
    if (!current || starts) {
      current = { id: block.id, title: block.kind === 'heading' ? headingText(block.text) : '', level, blocks: [] }
      sections.push(current)
    }
    current.blocks.push(block)
  }
  return sections
}

function headingLevel(block: PaperBlock): number {
  if (block.kind !== 'heading') return 0
  return /^\s*(#{1,6})\s/.exec(block.text)?.[1]?.length ?? (/\n\s*=+\s*$/.test(block.text) ? 1 : 2)
}
function headingText(text: string): string {
  return text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').replace(/\n\s*[=-]+\s*$/, '').trim()
}

/** Resolve a saved block after a mode change or revision; a deleted anchor starts at page one. */
export function sectionForBlock(sections: ReadingSection[], blockId?: string): number {
  const index = sections.findIndex(section => section.blocks.some(block => block.id === blockId))
  return Math.max(0, index)
}
