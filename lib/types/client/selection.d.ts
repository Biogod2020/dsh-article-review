/** Rendered-text anchors do not mistake Markdown punctuation or repeated phrases for selection offsets. */
/** A selection inside exactly one rendered manuscript block. */
export interface TextAnchor {
    quote: string;
    prefix: string;
    suffix: string;
    offset: number;
}
/**
 * Capture the selected occurrence without interpreting Markdown source punctuation.
 * @param root - rendered block only, excluding reader controls.
 * @returns its live selection, or nothing for an empty or cross-block selection.
 */
export declare function captureSelection(root: HTMLElement): TextAnchor | undefined;
/**
 * Require a saved occurrence or one unique context match; never choose the first duplicate.
 * @param text - unchanged rendered block.
 * @param anchor - saved quote and surrounding text.
 * @returns exact offset, or undefined when no reliable match exists.
 */
export declare function locateQuote(text: string, anchor: Omit<TextAnchor, 'offset'> & {
    offset?: number | undefined;
}): number | undefined;
/**
 * Reconstruct a selection across inline text nodes without modifying React-owned nodes.
 * @param root - rendered block.
 * @param anchor - persisted quote.
 * @returns its DOM range, or undefined when the quote cannot be located.
 */
export declare function anchorRange(root: HTMLElement, anchor: Omit<TextAnchor, 'offset'> & {
    offset?: number | undefined;
}): Range | undefined;
//# sourceMappingURL=selection.d.ts.map