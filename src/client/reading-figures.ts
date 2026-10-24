/** Resolve explicit figure callouts and verified panel targets in the displayed revision. */
import type { PaperBlock, PaperRevision } from '../schema.ts'
import type { PaperFigure } from '../figures.ts'
import { figureFilePath, pinnedFigure } from '../figures.ts'
import { attachedPanelTargets } from '../figure-panels.ts'
import type { FigurePanel } from '../figure-panels.ts'

export interface ReadingFigure { key: string; figure: PaperFigure; file: string; targets: string[]; panel?: FigurePanel }

/** Whole figures remain selectable even when no panel map has been created. */
export function readingFigures(manuscript: string, base: string, revision: PaperRevision, figures: PaperFigure[], panels: FigurePanel[]): ReadingFigure[] {
  return figures.flatMap(figure => {
    const shown = pinnedFigure(revision, figure)
    const file = figureFilePath(manuscript, base, shown.path)
    if (!file) return []
    const items: ReadingFigure[] = [{ key: `${figure.blockId}:${figure.path}`, figure: { ...shown, file }, file, targets: [figure.blockId] }]
    for (const panel of panels.filter(panel => panel.figureBlockId === figure.blockId && panel.figure === figure.path)) {
      const targets = attachedPanelTargets(panel, revision)
      if (targets.length) items.push({ key: `panel:${panel.id}`, figure: { ...shown, label: `${figure.label} · ${panel.label}`, file: panel.file },
        file: panel.file, targets: targets.map(block => block.id), panel })
    }
    return items
  })
}

/** Match authored figure numbers or ids; caption proximity alone never implies an association. */
export function relatedReadingFigures(block: PaperBlock | undefined, items: ReadingFigure[]): ReadingFigure[] {
  if (!block || block.kind === 'code') return []
  const panels = items.filter(item => item.panel && item.targets.includes(block.id))
  const wholes = items.filter(item => {
    if (item.panel) return false
    if (item.targets.includes(block.id)) return true
    const token = /(?:Figure|Fig\.?)[\s]+(?:\[([^\]]+)\]|([\w.-]+))/i.exec(item.figure.label)
    const number = token?.[2]
    const id = token?.[1]
    if (id) return block.text.includes(`@${id}`) || block.text.includes(`{${id}}`) || block.text.includes(`](#${id})`)
    if (!number) return false
    const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b(?:fig(?:ure)?s?\\.?)\\s+${escaped}(?=[a-z]?(?:\\b|[(),–—-]))`, 'i').test(block.text)
  })
  return [...panels, ...wholes]
}

export interface FigureReference { start: number; end: number; label: string; item: ReadingFigure }
/** Resolve printed callouts, including shorthand lists, without inventing missing panels. */
export function figureReferences(text: string, items: ReadingFigure[]): FigureReference[] {
  const groups = new Map<string, ReadingFigure[]>()
  for (const item of items) {
    const number = /\b(?:fig(?:ure)?\.?)\s+(S?\d+)\b/i.exec(item.figure.label)?.[1]?.toUpperCase()
    if (number) groups.set(number, [...(groups.get(number) ?? []), item])
  }
  const choose = (number: string, panel?: string): ReadingFigure | undefined => {
    const group = groups.get(number.toUpperCase())
    return (panel ? group?.find(item => item.panel?.label.toLowerCase() === panel.toLowerCase()) : undefined) ?? group?.find(item => !item.panel)
  }
  const found: FigureReference[] = []
  const pattern = /\b(?:fig(?:ure)?s?\.?)\s+(S?\d+)(?:\s*([a-z]))?(?![\p{L}\p{N}_])/giu
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    let number = match[1]!, panel = match[2], end = pattern.lastIndex
    const item = choose(number, panel)
    if (!item) continue
    const range = panel ? /^\s*(?:[–—-]|to)\s*([a-z])(?![\p{L}\p{N}_])/iu.exec(text.slice(end)) : null
    if (range) { end += range[0].length; panel = undefined }
    found.push({ start: match.index, end, label: text.slice(match.index, end), item: range ? choose(number)! : item })
    while (true) {
      const next = /^\s*(?:[,;&]|\band\b)\s*(?:(S?\d+)\s*)?([a-z])?(?![\p{L}\p{N}_])/iu.exec(text.slice(end))
      if (!next || (!next[1] && !next[2])) break
      const nextNumber = next[1] ?? number, nextPanel = next[2]
      const selected = choose(nextNumber, nextPanel)
      if (!selected) break
      const token = /(?:S?\d+\s*)?[a-z]?$|S?\d+$/i.exec(next[0])?.[0]?.trim()
      if (!token) break
      const tokenStart = end + next[0].lastIndexOf(token)
      end += next[0].length; number = nextNumber; panel = nextPanel
      found.push({ start: tokenStart, end, label: `Figure ${number}${panel ?? ''}`, item: selected })
    }
    pattern.lastIndex = end
  }
  return found
}
