/** Paint changed visible words without changing the Markdown renderer's DOM. */
import { useEffect, useId, useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { diffWordsWithSpace } from 'diff'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Nodes } from 'mdast'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { normalizeLegacyTableDividers } from './legacy-tables.ts'

type Side = 'before' | 'after'
type Span = { offset: number; length: number }
export type RenderedChange = { text: string; spans: Span[] }
export type RenderedChangePair = { before: RenderedChange; after: RenderedChange }
type Labels = { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
const markdownOptions = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }
const showTextNodes = 4 // NodeFilter.SHOW_TEXT without a global document.

/** Return plain text only when the block has a predictable rendered text order.
 * @param source - one Markdown block.
 * @returns displayed text, or undefined when its text order is ambiguous.
 */
export function renderedPlainText(source: string): string | undefined {
  const blocks = fromMarkdown(normalizeLegacyTableDividers(source), markdownOptions).children
  const block = blocks[0]
  if (blocks.length !== 1 || !block || block.type === 'table') return undefined
  const walk = (node: Nodes): string | undefined => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'html') return node.value
    if (node.type === 'image' || node.type === 'break' || node.type === 'thematicBreak') return ''
    if ('children' in node) {
      const parts = node.children.map(walk)
      return parts.every((part): part is string => part !== undefined) ? parts.join('') : undefined
    }
    return undefined
  }
  return walk(block)
}

/** Parse each source once and locate changed visible words on both sides; return nothing when Markdown text order is ambiguous. */
export function renderedChangePair(before: string, after: string): RenderedChangePair | undefined {
  const oldText = renderedPlainText(before)
  const newText = renderedPlainText(after)
  if (oldText === undefined || newText === undefined) return undefined
  const removed: Span[] = []
  const added: Span[] = []
  let oldOffset = 0
  let newOffset = 0
  for (const part of diffWordsWithSpace(oldText, newText)) {
    const target = part.removed ? oldOffset : part.added ? newOffset : undefined
    if (target !== undefined) {
      const leading = part.value.match(/^\s*/u)?.[0].length ?? 0
      const trailing = part.value.match(/\s*$/u)?.[0].length ?? 0
      const length = part.value.length - leading - trailing
      if (length > 0) (part.removed ? removed : added).push({ offset: target + leading, length })
    }
    if (!part.added) oldOffset += part.value.length
    if (!part.removed) newOffset += part.value.length
  }
  return { before: { text: oldText, spans: removed }, after: { text: newText, spans: added } }
}

/** Locate changed visible words on one side of a rendered block. */
export function renderedChangeSpans(before: string, after: string, side: Side): RenderedChange | undefined {
  return renderedChangePair(before, after)?.[side]
}

/**
 * Map ordered changed offsets through inline Markdown nodes with one text-node walk.
 * @param root - rendered Markdown whose textContent matches the compared text.
 * @param spans - ascending offsets in that text.
 * @returns DOM ranges for in-bounds spans; malformed spans are omitted.
 */
export function rangesForChangedSpans(root: HTMLElement, spans: Span[]): Range[] {
  const walker = root.ownerDocument.createTreeWalker(root, showTextNodes)
  const nodes: { node: Node; start: number; end: number }[] = []
  let offset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (length > 0) nodes.push({ node, start: offset, end: offset + length })
    offset += length
  }
  const ranges: Range[] = []
  let startIndex = 0
  for (const span of spans) {
    const end = span.offset + span.length
    if (span.length <= 0 || end > offset) continue
    while ((nodes[startIndex]?.end ?? Infinity) <= span.offset) startIndex++
    let endIndex = startIndex
    while ((nodes[endIndex]?.end ?? Infinity) < end) endIndex++
    const startNode = nodes[startIndex]
    const endNode = nodes[endIndex]
    if (!startNode || !endNode) continue
    const range = root.ownerDocument.createRange()
    range.setStart(startNode.node, span.offset - startNode.start)
    range.setEnd(endNode.node, end - endNode.start)
    ranges.push(range)
  }
  return ranges
}

/** Register CSS ranges only when the parsed plain text exactly matches the displayed Markdown. */
export function useRenderedChange(root: RefObject<HTMLElement>, source: string, opposite: string | undefined,
  side: Side, enabled: boolean, prepared?: RenderedChange | null): string | undefined {
  const name = `paper-diff-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const comparison = useMemo(() => !enabled || opposite === undefined || source === opposite ? undefined
    : prepared === null ? undefined : prepared ?? renderedChangeSpans(side === 'before' ? source : opposite, side === 'after' ? source : opposite, side),
  [source, opposite, side, enabled, prepared])
  useEffect(() => {
    const element = root.current
    if (!enabled || !comparison || !element || element.textContent !== comparison.text
      || typeof Highlight === 'undefined' || typeof CSS === 'undefined') return
    const ranges = rangesForChangedSpans(element, comparison.spans)
    if (ranges.length === 0) return
    CSS.highlights.set(name, new Highlight(...ranges))
    return () => { CSS.highlights.delete(name) }
  }, [comparison, enabled, name, root])
  if (!enabled || !comparison) return undefined
  const color = side === 'before' ? 'removed' : 'added'
  return `::highlight(${name}){background:var(--paper-${color}-bg);color:var(--paper-${color});text-decoration:underline 1px var(--paper-${color})}`
}

/** Render a proposal side with word-level paint and unchanged Markdown structure. */
export function RenderedDiffText({ text, opposite, side, labels, comparison }: {
  text: string
  opposite: string
  side: Side
  labels: Labels
  comparison?: RenderedChange | null
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const style = useRenderedChange(root, text, opposite, side, true, comparison)
  return <>{style && <style>{style}</style>}<div ref={root} data-rendered-diff={side}>
    <MarkdownText text={normalizeLegacyTableDividers(text)} labels={labels} />
  </div></>
}
