/** Adapt the reading surface to the artwork, keeping narrow columns out of wide diagrams. */
export type FigurePlacement = 'auto' | 'side' | 'top';
export declare function resolveFigurePlacement(width: number, aspect: number | undefined, preference: FigurePlacement): 'side' | 'top';
/** Leave at least 320 px for prose and 260 px for figures when the viewport permits. */
export declare function readingColumnRatio(ratio: number, width: number): number;
