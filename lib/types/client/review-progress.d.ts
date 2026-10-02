import type { ReactNode } from 'react';
import type { PaperBlock, PaperDocument } from '../schema.ts';
import type { PaperReviewKey } from './locales.ts';
/** Floating navigation for headings and their reviewable blocks. */
export declare function ReviewProgress({ blocks, baselines, jump, t }: {
    blocks: PaperBlock[];
    baselines: PaperDocument['baselines'];
    jump: (block: PaperBlock) => void;
    t: (key: PaperReviewKey) => string;
}): ReactNode;
//# sourceMappingURL=review-progress.d.ts.map