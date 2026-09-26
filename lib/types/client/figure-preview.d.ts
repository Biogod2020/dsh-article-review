import type { ReactNode } from 'react';
import type { PaperFigure } from '../figures.ts';
import type { PaperReviewKey } from './locales.ts';
/** Authenticated readers supplied by the native sidebar. */
export interface FigureMedia {
    thumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>;
    bytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>;
    signal: AbortSignal;
    sessionId: string;
}
/**
 * Show a small on-demand preview without mounting full-resolution figures in the reader.
 * @param props - exact file, local media readers and localized actions.
 * @returns bounded thumbnail with open/replace actions and a collapsible body.
 */
export declare function FigurePreview({ figure, file, media, t, onOpen, onReplace }: {
    figure: PaperFigure;
    file: string;
    media: FigureMedia;
    t: (key: PaperReviewKey) => string;
    onOpen: (figure: PaperFigure) => void;
    onReplace?: (figure: PaperFigure) => void;
}): ReactNode;
//# sourceMappingURL=figure-preview.d.ts.map