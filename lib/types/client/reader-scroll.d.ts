/** Viewport-local navigation that settles again after lazy Markdown mounts. */
/** A reader block's signed distance from the viewport top, with a pixel fallback. */
export interface PaperScrollPosition {
    top: number;
    anchor?: {
        blockId: string;
        offset: number;
    };
}
/**
 * Capture the first visible block in a vertically ordered reader, skipping nested source-note content.
 * @param viewport - reader-owned scroll container.
 * @returns block identity and offset, or only the scroll distance when layout is unavailable.
 */
export declare function capturePaperPosition(viewport: HTMLElement): PaperScrollPosition;
/**
 * Restore a saved block and intra-block offset even when lazy estimates change above it.
 * @param viewport - reader-owned scroll container.
 * @param position - saved position for this manuscript and view.
 * @returns releases pending layout correction; a missing anchor uses its pixel fallback.
 */
export declare function restorePaperPosition(viewport: HTMLElement, position: PaperScrollPosition): () => void;
/**
 * Scroll only the manuscript viewport, without a pending smooth-scroll animation.
 * @param viewport - reader-owned scroll container.
 * @param target - exact block, proposal card or text range.
 * @param offset - optional signed target distance from the viewport top.
 */
export declare function scrollPaperTarget(viewport: HTMLElement, target: Element | Range, offset?: number): void;
/**
 * Reveal an exact target, then correct its position when its lazy content mounts.
 * @param viewport - reader-owned scroll container.
 * @param target - currently mounted target wrapper.
 * @param placeholder - selector for content not yet rendered within the target.
 * @param offset - optional signed target distance from the viewport top.
 * @param holdPosition - keep correcting neighboring layout changes until released.
 * @returns releases the temporary observer and any queued scroll.
 */
export declare function revealPaperTarget(viewport: HTMLElement, target: HTMLElement, placeholder?: string, offset?: number, holdPosition?: boolean): () => void;
//# sourceMappingURL=reader-scroll.d.ts.map