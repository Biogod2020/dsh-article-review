import type { ReactNode, RefObject } from 'react';
type Side = 'before' | 'after';
type Span = {
    offset: number;
    length: number;
};
export type RenderedChange = {
    text: string;
    spans: Span[];
};
export type RenderedChangePair = {
    before: RenderedChange;
    after: RenderedChange;
};
type Labels = {
    code: {
        copyLabel: string;
        copiedLabel: string;
    };
    footnotes: string;
};
/** Return plain text only when the block has a predictable rendered text order.
 * @param source - one Markdown block.
 * @returns displayed text, or undefined when its text order is ambiguous.
 */
export declare function renderedPlainText(source: string): string | undefined;
/** Parse each source once and locate changed visible words on both sides; return nothing when Markdown text order is ambiguous. */
export declare function renderedChangePair(before: string, after: string): RenderedChangePair | undefined;
/** Locate changed visible words on one side of a rendered block. */
export declare function renderedChangeSpans(before: string, after: string, side: Side): RenderedChange | undefined;
/**
 * Map ordered changed offsets through inline Markdown nodes with one text-node walk.
 * @param root - rendered Markdown whose textContent matches the compared text.
 * @param spans - ascending offsets in that text.
 * @returns DOM ranges for in-bounds spans; malformed spans are omitted.
 */
export declare function rangesForChangedSpans(root: HTMLElement, spans: Span[]): Range[];
/** Register CSS ranges only when the parsed plain text exactly matches the displayed Markdown. */
export declare function useRenderedChange(root: RefObject<HTMLElement>, source: string, opposite: string | undefined, side: Side, enabled: boolean, prepared?: RenderedChange | null): string | undefined;
/** Render a proposal side with word-level paint and unchanged Markdown structure. */
export declare function RenderedDiffText({ text, opposite, side, labels, comparison }: {
    text: string;
    opposite: string;
    side: Side;
    labels: Labels;
    comparison?: RenderedChange | null;
}): ReactNode;
export {};
//# sourceMappingURL=rendered-diff.d.ts.map