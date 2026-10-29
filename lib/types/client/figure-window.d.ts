import type { ReactNode } from 'react';
import type { FigureMedia } from './figure-preview.tsx';
import type { ReadingFigure } from './reading-figures.ts';
import type { PaperReviewKey } from './locales.ts';
export interface FigureWindowRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface FigureWindowBounds {
    width: number;
    height: number;
    top?: number;
}
export interface FigureAnchor {
    x: number;
    y: number;
    width: number;
    height: number;
}
export type FigureResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export declare function fitFigureWindow(rect: FigureWindowRect, bounds: FigureWindowBounds): FigureWindowRect;
/** Resize around the opposite edge so hitting a limit never moves the whole window. */
export declare function resizeFigureWindow(rect: FigureWindowRect, bounds: FigureWindowBounds, edge: FigureResizeEdge, dx: number, dy: number): FigureWindowRect;
export declare function initialFigureWindow(bounds: FigureWindowBounds, anchor?: FigureAnchor, preview?: boolean, size?: Pick<FigureWindowRect, 'width' | 'height'>): FigureWindowRect;
export declare function FigureWindow({ id, preview, anchor, bounds, saved, onChange, onClose, onDock, onOpen, onEnter, onLeave, label, t, children }: {
    id: string;
    preview: boolean;
    anchor?: FigureAnchor | undefined;
    bounds: FigureWindowBounds;
    saved?: FigureWindowRect | undefined;
    onChange: (rect: FigureWindowRect) => void;
    onClose: () => void;
    onDock: () => void;
    onOpen: () => void;
    onEnter: () => void;
    onLeave: () => void;
    label: string;
    t: (key: PaperReviewKey) => string;
    children: ReactNode;
}): ReactNode;
/** Peeks fetch only the selected artwork and never mount a modal or take keyboard focus. */
export declare function FigurePeek({ item, media, fullPage, onOpen, t }: {
    item: ReadingFigure;
    media: FigureMedia;
    fullPage: FigureMedia['thumbnail'];
    onOpen: () => void;
    t: (key: PaperReviewKey) => string;
}): ReactNode;
