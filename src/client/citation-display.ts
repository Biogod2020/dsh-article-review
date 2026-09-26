/** Reader-only labels for canonical citations; BibTeX remains the source of metadata. */
import type { BibliographyView } from '../schema.ts'
import { plainBibText } from './bib-display.ts'
import { en } from './locales.ts'

type BibEntry = BibliographyView['entries'][number]

function authorLabel(author: string | undefined): string | undefined {
  if (!author) return undefined
  const authors = author.split(/\s+and\s+/i)
  const family = (person: string): string => {
    const name = plainBibText(person.trim())
    return name.includes(',') ? name.slice(0, name.indexOf(',')).trim() : name.split(/\s+/).at(-1) ?? name
  }
  const [first = '', second = ''] = authors
  if (authors.length === 1) return family(first)
  if (authors.length === 2) return `${family(first)} & ${family(second)}`
  // Manuscript citations follow the author's English ICLR style, not the UI language.
  return `${family(first)} ${en.citationEtAl}`
}

function citationLabel(entry: BibEntry): string | undefined {
  const author = authorLabel(entry.fields.author)
  const year = entry.fields.year?.trim()
  return author && year ? `${author}, ${year}` : undefined
}

/**
 * Show `[@key]` groups as author-year citations without changing the saved Markdown.
 * Unknown or incomplete entries stay visible as keys rather than suggesting verification.
 * @param source - one Markdown block from the manuscript.
 * @param entries - entries in its bound BibTeX files.
 * @returns display-only Markdown with resolvable citation groups formatted.
 */
export function displayCitations(source: string, entries: readonly BibEntry[]): string {
  if (entries.length === 0 || !source.includes('[@')) return source
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  const replace = (text: string): string => text.replace(/\[(@[^\]]+)\]/g, (original, content: string) => {
    const keys = content.split(';').map(item => /^\s*@([A-Za-z][A-Za-z0-9_:./-]*)\s*$/.exec(item)?.[1])
    if (keys.some(key => key === undefined)) return original
    const labels = keys.map((key) => {
      const entry = key ? byKey.get(key) : undefined
      return entry && citationLabel(entry)
    })
    return labels.every(label => label !== undefined) ? `(${labels.join('; ')})` : original
  })
  const code = /(`+)([\s\S]*?)\1/g
  let display = ''
  let cursor = 0
  for (let match = code.exec(source); match; match = code.exec(source)) {
    display += replace(source.slice(cursor, match.index)) + match[0]
    cursor = match.index + match[0].length
  }
  return display + replace(source.slice(cursor))
}
