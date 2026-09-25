/** Normalize legacy table dividers for display without changing saved manuscript Markdown. */
function pipeCells(line: string): string[] | undefined {
  const match = /^ {0,3}\|(.*)\|\s*$/u.exec(line)
  return match?.[1]?.split('|')
}

/**
 * Render converter-produced em-dash table dividers as GFM tables.
 * @param source - Markdown shown in the reader or rendered comparison.
 * @returns display-only Markdown with valid dividers; data cells and source records stay unchanged.
 */
export function normalizeLegacyTableDividers(source: string): string {
  if (!/[—–]/u.test(source)) return source
  const lines = source.split('\n')
  let fence: { marker: string; length: number } | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line === undefined) continue
    const fenceRun = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fenceRun) {
      const marker = fenceRun.startsWith('`') ? '`' : '~'
      if (!fence) fence = { marker, length: fenceRun.length }
      else if (marker === fence.marker && fenceRun.length >= fence.length) fence = undefined
      continue
    }
    if (fence || index === 0 || index === lines.length - 1) continue
    const header = pipeCells(lines[index - 1] ?? '')
    const divider = pipeCells(line)
    const body = pipeCells(lines[index + 1] ?? '')
    if (!header || !divider || !body || header.length !== divider.length || body.length !== divider.length
      || !divider.every(cell => /^\s*:?[—–-]+:?\s*$/u.test(cell))
      || !divider.some(cell => /[—–]/u.test(cell))) continue
    lines[index] = line.replace(/[—–-]+/gu, '---')
  }
  return lines.join('\n')
}
