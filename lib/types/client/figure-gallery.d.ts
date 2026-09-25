import type { ReactNode } from 'react';
import type { PaperFigure } from './figures.ts';
interface FigureGalleryProps {
    readonly figures: PaperFigure[];
    readonly manuscript: string;
    readonly base: string;
    readonly sessionId: string;
    readonly signal: AbortSignal;
    readonly thumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>;
    readonly fullPage: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>;
    readonly bytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>;
    readonly selected: PaperFigure | undefined;
    readonly onSelect: (figure?: PaperFigure) => void;
    readonly onLocate: (figure: PaperFigure) => void;
    readonly onNative: (figure: PaperFigure) => void;
    readonly labels: {
        readonly figures: string;
        readonly pdf: string;
        readonly image: string;
        readonly open: string;
        readonly close: string;
        readonly loading: string;
        readonly failed: string;
        readonly locate: string;
        readonly native: string;
        readonly expand: string;
        readonly collapse: string;
    };
}
/**
 * Show one persistent small cover, expand thumbnails on hover/focus, and preview on demand.
 * @param props - pinned figure references and authenticated local media readers.
 * @returns a reader-local dock and a viewport-sized modal only while a figure is selected.
 */
export declare function FigureGallery(props: FigureGalleryProps): ReactNode;
export {};
//# sourceMappingURL=figure-gallery.d.ts.map