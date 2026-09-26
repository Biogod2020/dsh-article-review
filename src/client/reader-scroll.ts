/** Viewport-local navigation that settles again after lazy Markdown mounts. */

/** A reader block's signed distance from the viewport top, with a pixel fallback. */
export interface PaperScrollPosition {
  top: number
  anchor?: { blockId: string; offset: number }
}

/**
 * Capture the first visible block in a vertically ordered reader, skipping nested source-note content.
 * @param viewport - reader-owned scroll container.
 * @returns block identity and offset, or only the scroll distance when layout is unavailable.
 */
export function capturePaperPosition(viewport: HTMLElement): PaperScrollPosition {
  const position: PaperScrollPosition = { top: viewport.scrollTop }
  const view = viewport.getBoundingClientRect()
  if (!view.height || !position.top) return position
  const blocks = [...viewport.querySelectorAll<HTMLElement>('[data-block]')]
    .filter(block => !block.parentElement?.closest('[data-block]'))
  let low = 0, high = blocks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const block = blocks[middle]
    if (block && block.getBoundingClientRect().bottom <= view.top) low = middle + 1
    else high = middle
  }
  for (const block of blocks.slice(low)) {
    const rect = block.getBoundingClientRect()
    if (rect.top >= view.bottom) break
    const blockId = block.dataset.block
    if (blockId && rect.height && rect.bottom > view.top && rect.top < view.bottom) {
      position.anchor = { blockId, offset: rect.top - view.top }
      break
    }
  }
  return position
}

/**
 * Restore a saved block and intra-block offset even when lazy estimates change above it.
 * @param viewport - reader-owned scroll container.
 * @param position - saved position for this manuscript and view.
 * @returns releases pending layout correction; a missing anchor uses its pixel fallback.
 */
export function restorePaperPosition(viewport: HTMLElement, position: PaperScrollPosition): () => void {
  const target = position.anchor && viewport.querySelector<HTMLElement>(`[data-block="${CSS.escape(position.anchor.blockId)}"]`)
  if (target && position.anchor) {
    const release = revealPaperTarget(viewport, target, '[data-reader-placeholder]', position.anchor.offset, true)
    const cancel = (): void => {
      release()
      viewport.removeEventListener('wheel', cancel)
      viewport.removeEventListener('touchstart', cancel)
      viewport.removeEventListener('pointerdown', cancel)
      viewport.removeEventListener('keydown', cancel)
    }
    viewport.addEventListener('wheel', cancel, { passive: true })
    viewport.addEventListener('touchstart', cancel, { passive: true })
    viewport.addEventListener('pointerdown', cancel)
    viewport.addEventListener('keydown', cancel)
    return cancel
  }
  if (viewport.scrollTop !== position.top) viewport.scrollTo({ top: position.top, behavior: 'instant' as ScrollBehavior })
  return () => {}
}

/**
 * Scroll only the manuscript viewport, without a pending smooth-scroll animation.
 * @param viewport - reader-owned scroll container.
 * @param target - exact block, proposal card or text range.
 * @param offset - optional signed target distance from the viewport top.
 */
export function scrollPaperTarget(viewport: HTMLElement, target: Element | Range, offset?: number): void {
  const rect = target.getBoundingClientRect()
  const view = viewport.getBoundingClientRect()
  if (!rect.height || !view.height) {
    if (target instanceof Element && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
    return
  }
  const top = Math.max(0, viewport.scrollTop + rect.top - view.top - (offset ?? Math.min(view.height / 3, 120)))
  viewport.scrollTo({ top, behavior: 'instant' as ScrollBehavior })
}

/**
 * Reveal an exact target, then correct its position when its lazy content mounts.
 * @param viewport - reader-owned scroll container.
 * @param target - currently mounted target wrapper.
 * @param placeholder - selector for content not yet rendered within the target.
 * @param offset - optional signed target distance from the viewport top.
 * @param holdPosition - keep correcting neighboring layout changes until released.
 * @returns releases the temporary observer and any queued scroll.
 */
export function revealPaperTarget(viewport: HTMLElement, target: HTMLElement,
  placeholder = '[data-reader-placeholder]', offset?: number, holdPosition = false): () => void {
  scrollPaperTarget(viewport, target, offset)
  if (!holdPosition && !target.querySelector(placeholder)) return () => {}
  let frame = 0
  const schedule = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      scrollPaperTarget(viewport, target, offset)
      if (!holdPosition && !target.querySelector(placeholder)) observer.disconnect()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(viewport, { childList: true, subtree: true, attributes: holdPosition })
  const resize = holdPosition && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined
  resize?.observe(target.parentElement ?? viewport)
  return () => { observer.disconnect(); resize?.disconnect(); cancelAnimationFrame(frame) }
}
