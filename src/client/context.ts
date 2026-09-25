/** Explicit text context placed into the normal composer and therefore into the session log. */
import type { Annotation, PaperBlock, PaperDocument } from '../schema.ts'
import { en } from './locales.ts'

/**
 * Package selected annotations with exact source and neighbors, never silently include the full manuscript.
 * @param document - reader-pinned document.
 * @param annotations - selected notes.
 * @param selected - optional selected block.
 * @param intent - user's action.
 * @param copy - localized context labels and rules.
 * @returns editable composer text.
 */
export function reviewContext(document: PaperDocument, annotations: Annotation[], selected?: PaperBlock, intent = en.batchIntent, copy: Pick<typeof en, 'contextPath' | 'contextRevision' | 'contextRules' | 'contextData'> = en): string {
  const ids = new Set(annotations.map(a => a.blockId))
  if (selected) ids.add(selected.id)
  const blocks = document.current.blocks.filter(b => ids.has(b.id)).map((block) => {
    const index = document.current.blocks.indexOf(block)
    return { id: block.id, section: block.section, text: block.text, beforeContext: document.current.blocks[index - 1]?.text ?? '', afterContext: document.current.blocks[index + 1]?.text ?? '' }
  })
  return `\n${intent}\n${copy.contextPath} ${document.path}\n${copy.contextRevision} ${document.current.id}\n${copy.contextRules}\n\n${copy.contextData}\n${JSON.stringify({ blocks, annotations }, null, 2)}\n`
}
