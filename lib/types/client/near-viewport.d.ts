import type { RefObject } from 'react';
/** Observe once and release idle observers; mounting a far-away search target still reveals it normally. */
export declare function observeNearViewport(element: Element, activate: () => void, margin: string): () => void;
/** Retain activated content so scrolling never discards text selections or changes measured heights. */
export declare function useNearViewport(root: RefObject<HTMLElement>, enabled?: boolean, margin?: string): boolean;
