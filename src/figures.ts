/** Discover local figure files without loading large media into the manuscript reader. */
import type { PaperBlock, PaperRevision } from './schema.ts'

/** One selectable local figure reference in a pinned manuscript block. */
export interface PaperFigure {
  readonly blockId: string
  readonly label: string
  readonly path: string
  /** Resolved workspace file, supplied when opening a preview from another revision. */
  readonly file?: string
}

const FIGURE_FILE = /\.(?:pdf|png|jpe?g|webp|gif|svg)$/i

/**
 * Read an explicitly authored figure root from the manuscript's opening provenance comment.
 * @param source - pinned Markdown source, not current disk content.
 * @returns one safe workspace-relative directory, or the manuscript directory when absent.
 */
export function authoredFigureBase(source: string): string {
  const opening = /^\s*<!--([\s\S]*?)-->/.exec(source)?.[1] ?? ''
  const roots = [...opening.matchAll(/Figure PDFs stay in\s+([^;\n]+)\s*;/gi)]
  if (roots.length !== 1) return ''
  const path = (roots[0]?.[1] ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!path || path.startsWith('/') || path.includes('://') || path.split('/').some(part => part === '..' || part === '.paper-review')) return ''
  return path
}

/** Reject destinations outside the workspace and non-file URLs before offering an opener. */
function localFigurePath(value: string): string | undefined {
  const path = value.trim().replace(/\\/g, '/')
  if (!path || path.startsWith('/') || path.includes('://') || path.split('/').some(part => part === '..' || part === '.paper-review')
    || !FIGURE_FILE.test(path)) return undefined
  return path
}

/**
 * Find explicit figure captions and ordinary Markdown images in displayed blocks.
 * @param blocks - pinned reader revision.
 * @returns selectable local figure references in manuscript order.
 */
export function collectFigures(blocks: PaperBlock[]): PaperFigure[] {
  const figures: PaperFigure[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (block.kind === 'code') continue
    const add = (label: string, value: string): void => {
      const path = localFigurePath(value)
      if (!path || seen.has(`${block.id}:\0${path}`)) return
      seen.add(`${block.id}:\0${path}`)
      figures.push({ blockId: block.id, label: label.trim() || path.split('/').at(-1) || path, path })
    }
    for (const match of block.text.matchAll(/\*\*(Figure\s+(?:\[[^\]]+\]|[\w.-]+))\*\*\s*\(\s*`([^`]+)`\s*\)/gi))
      add(match[1] ?? '', match[2] ?? '')
    for (const match of block.text.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g))
      add(match[1] ?? '', match[2] ?? match[3] ?? '')
  }
  return figures
}

/**
 * Resolve one authored destination under the manuscript directory or its provenance-declared figure root.
 * @param manuscript - workspace-relative Markdown file.
 * @param base - optional workspace-relative root declared in Markdown provenance.
 * @param path - validated local figure path.
 * @returns workspace-relative file path for the native DSH preview.
 */
export function figureFilePath(manuscript: string, base: string, path: string): string | undefined {
  const figure = localFigurePath(path)
  const directory = base || manuscript.slice(0, Math.max(0, manuscript.lastIndexOf('/')))
  if (!figure || directory.startsWith('/') || directory.split('/').includes('..')) return undefined
  return [directory, figure].filter(Boolean).join('/')
}

/**
 * Use retained figure bytes when this reader revision has a recorded snapshot.
 * @param revision - pinned reader version.
 * @param figure - authored reference in that version.
 * @returns reference with its snapshot destination, otherwise unchanged.
 */
export function pinnedFigure(revision: PaperRevision, figure: PaperFigure): PaperFigure {
  const retained = revision.figureAssets?.find(asset => asset.path === figure.path)
  return retained ? { ...figure, path: retained.snapshot } : figure
}

/**
 * Replace selected figure destinations without changing caption prose or other paths.
 * @param block - exact source block.
 * @param path - selected authored destination.
 * @param replacement - retained replacement destination.
 * @returns source with matching caption or Markdown image references updated.
 */
export function replaceFigureReference(block: PaperBlock, path: string, replacement: string): string {
  return block.text.replace(/(\*\*Figure\s+(?:\[[^\]]+\]|[\w.-]+)\*\*\s*\(\s*`)([^`]+)(`\s*\))/gi,
    (whole: string, prefix: string, destination: string, suffix: string) => destination === path ? prefix + replacement + suffix : whole)
    .replace(/(!\[[^\]]*\]\(\s*)(?:<([^>]+)>|([^\s)]+))((?:\s+[^)]*)?\))/g,
      (whole: string, prefix: string, angled: string | undefined, plain: string | undefined, suffix: string) => {
        if ((angled ?? plain) !== path) return whole
        return prefix + (angled === undefined ? replacement : `<${replacement}>`) + suffix
      })
}
