import type { ReactNode } from 'react';
import type { PaperFigure } from './figures.ts';
interface FigureGalleryProps {
    readonly showDock?: boolean;
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
        readonly zoomIn: string;
        readonly zoomOut: string;
        readonly fit: string;
        readonly actualSize: string;
        readonly previous: string;
        readonly next: string;
        readonly retry: string;
        readonly pdfPreview: string;
        readonly panHint: string;
    };
}
/**
 * Show an exact-file thumbnail dock and zoomable full-screen preview with cancellable reads.
 * @param props - Pinned figure references, localized controls and authenticated media readers.
 * @returns A reader-local dock and modal; PDF previews show page one with a native full-PDF action.
 */
export declare function FigureGallery(props: FigureGalleryProps): ReactNode;
export {};
//# sourceMappingURL=figure-gallery.d.ts.map