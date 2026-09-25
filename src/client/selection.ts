/** Rendered-text anchors do not mistake Markdown punctuation or repeated phrases for selection offsets. */

/** A selection inside exactly one rendered manuscript block. */
export interface TextAnchor {
  quote: string
  prefix: string
  suffix: string
  offset: number
}

/**
 * Capture the selected occurrence without interpreting Markdown source punctuation.
 * @param root - rendered block only, excluding reader controls.
 * @returns its live selection, or nothing for an empty or cross-block selection.
 */
export function captureSelection(root: HTMLElement): TextAnchor | undefined {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const raw = range.toString()
  const quote = raw.trim()
  if (!quote) return undefined
  const before = range.cloneRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const offset = before.toString().length + raw.indexOf(quote)
  const text = root.textContent
  return { quote, offset, prefix: text.slice(Math.max(0, offset - 64), offset),
    suffix: text.slice(offset + quote.length, offset + quote.length + 64) }
}

/**
 * Require a saved occurrence or one unique context match; never choose the first duplicate.
 * @param text - unchanged rendered block.
 * @param anchor - saved quote and surrounding text.
 * @returns exact offset, or undefined when no reliable match exists.
 */
export function locateQuote(text: string, anchor: Omit<TextAnchor, 'offset'> & { offset?: number | undefined }): number | undefined {
  if (!anchor.quote) return undefined
  const matches = (at: number): boolean => text.slice(at, at + anchor.quote.length) === anchor.quote
    && text.slice(Math.max(0, at - anchor.prefix.length), at) === anchor.prefix
    && text.slice(at + anchor.quote.length, at + anchor.quote.length + anchor.suffix.length) === anchor.suffix
  if (anchor.offset !== undefined && matches(anchor.offset)) return anchor.offset
  const candidates: number[] = []
  for (let at = text.indexOf(anchor.quote); at >= 0; at = text.indexOf(anchor.quote, at + 1)) {
    if (matches(at)) candidates.push(at)
  }
  return candidates.length === 1 ? candidates[0] : undefined
}

/**
 * Reconstruct a selection across inline text nodes without modifying React-owned nodes.
 * @param root - rendered block.
 * @param anchor - persisted quote.
 * @returns its DOM range, or undefined when the quote cannot be located.
 */
export function anchorRange(root: HTMLElement, anchor: Omit<TextAnchor, 'offset'> & { offset?: number | undefined }): Range | undefined {
  const at = locateQuote(root.textContent, anchor)
  if (at === undefined) return undefined
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let count = 0
  let started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (!started && count + length > at) { range.setStart(node, at - count); started = true }
    if (started && count + length >= at + anchor.quote.length) {
      range.setEnd(node, at + anchor.quote.length - count)
      return range
    }
    count += length
  }
  return undefined
}
