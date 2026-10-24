/** Adapt the reading surface to the artwork, keeping narrow columns out of wide diagrams. */
export type FigurePlacement = 'auto' | 'side' | 'top'
export function resolveFigurePlacement(width: number, aspect: number | undefined, preference: FigurePlacement): 'side' | 'top' {
  if (width > 0 && width < 760) return 'top'
  if (preference !== 'auto') return preference
  return aspect !== undefined && aspect >= 2.2 ? 'top' : 'side'
}

/** Leave at least 320 px for prose and 260 px for figures when the viewport permits. */
export function readingColumnRatio(ratio: number, width: number): number {
  const minimum = Math.max(.35, width > 0 ? Math.min(.6, 320 / width) : .35)
  const maximum = Math.max(minimum, Math.min(.72, width > 0 ? 1 - 266 / width : .72))
  return Math.max(minimum, Math.min(maximum, ratio))
}
