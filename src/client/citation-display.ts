/** Reader-only labels for canonical citations; BibTeX remains the source of metadata. */
import type { BibliographyView } from '../schema.ts'

type BibEntry = BibliographyView['entries'][number]

const symbols: Record<string, string> = { aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', ss: 'ß' }
const accents: Record<string, string> = { "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', v: '\u030c', c: '\u0327', u: '\u0306', '=': '\u0304', '.': '\u0307' }

function plainName(value: string): string {
  return value.replace(/\{\\(aa|AA|ae|AE|oe|OE|ss|[oO])\}/g, (_match, name: string) => symbols[name] ?? name)
    .replace(/\{\\(['`^"~vcu=.])\s*([A-Za-z])\}/g, (_match, accent: string, letter: string) => `${letter}${accents[accent] ?? ''}`.normalize('NFC'))
    .replace(/[{}]/g, '')
}

function authorLabel(author: string | undefined): string | undefined {
  if (!author) return undefined
  const authors = author.split(/\s+and\s+/i)
  const family = (person: string): string => {
    const name = plainName(person.trim())
    return name.includes(',') ? name.split(',')[0]!.trim() : name.split(/\s+/).at(-1) ?? name
  }
  if (authors.length === 1) return family(authors[0]!)
  if (authors.length === 2) return `${family(authors[0]!)} & ${family(authors[1]!)}`
  return `${family(authors[0]!)} et al.`
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
    const keys = content.split(';').map(item => /^\s*@([A-Za-z0-9:_-]+)\s*$/.exec(item)?.[1])
    if (keys.some(key => key === undefined)) return original
    const labels = keys.map(key => {
      const entry = byKey.get(key!)
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
