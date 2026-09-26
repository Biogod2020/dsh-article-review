/** Display-only BibTeX formatting and citation locations; saved metadata remains untouched. */
import type { BibliographyView, PaperBlock } from '../schema.ts'

type Entry = BibliographyView['entries'][number]
const accents: Record<string, string> = { "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308', '~': '\u0303', v: '\u030c', c: '\u0327', u: '\u0306', H: '\u030b', '=': '\u0304', '.': '\u0307', r: '\u030a' }
const symbols: Record<string, string> = { aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', ss: 'ß', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', LaTeX: 'LaTeX', TeX: 'TeX', textendash: '–', textemdash: '—' }

/** Convert common BibTeX formatting and accents to readable plain text, preserving unknown commands.
 * @param value - one original BibTeX field.
 * @returns display text without changing the authoritative field.
 */
export function plainBibText(value: string | undefined): string {
  return (value ?? '')
    .replace(/\\(?:textit|textbf|emph|textrm|textsc|mathrm|url)\s*\{/g, '{')
    .replace(/\\(['`^"~=.]|[vcuHr](?![A-Za-z]))\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|([A-Za-z]))/g,
      (_match, accent: string, grouped: string | undefined, bare: string | undefined) => {
        const letter = (grouped ?? bare ?? '').replace(/^\\([ij])$/, '$1')
        return `${letter}${accents[accent] ?? ''}`.normalize('NFC')
      })
    .replace(/\\([A-Za-z]+)(?:\{\})?/g, (command, name: string) => symbols[name] ?? command)
    .replace(/\\([&%_#$])/g, '$1').replace(/\\[{}]/g, matched => matched === '\\{' ? '\u0001' : '\u0002')
    .replace(/[{}]/g, '').replace(/\u0001/g, '{').replace(/\u0002/g, '}')
    .replace(/~/g, ' ').replace(/---/g, '—').replace(/--/g, '–').replace(/\s+/g, ' ').trim()
}

function externalUrl(value: string | undefined): string | undefined {
  const candidate = plainBibText(value)
  try {
    const url = new URL(candidate)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

/** Resolve DOI and publication URLs without making non-web BibTeX values clickable.
 * @param entry - indexed authoritative metadata.
 * @returns validated external links, with duplicate URLs omitted.
 */
export function referenceLinks(entry: Entry): { doi: string | undefined; url: string | undefined } {
  const doi = plainBibText(entry.fields.doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
  const doiUrl = /^10\.\d{4,9}\/[^\s]+$/.test(doi) ? `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` : undefined
  const url = externalUrl(entry.fields.url)
  return { doi: doiUrl, url: url !== doiUrl ? url : undefined }
}

/** Readable metadata used by both the list filter and panel-wide search.
 * @param entry - original bibliography entry.
 * @returns human-readable searchable text, including its exact citation key and source file.
 */
export function referenceEntryText(entry: Entry): string {
  return [`[@${entry.key}]`, plainBibText(entry.fields.author), plainBibText(entry.fields.year),
    plainBibText(entry.fields.title), plainBibText(entry.fields.journal ?? entry.fields.booktitle),
    entry.file, plainBibText(entry.fields.doi), plainBibText(entry.fields.url)].filter(Boolean).join(' ')
}

/** One canonical citation occurrence in a rendered manuscript block. */
export interface ReferenceCitationLocation { blockId: string; occurrence: number }

/** Index canonical citations once per block collection, excluding code and source comments.
 * @param blocks - current manuscript blocks in source order.
 * @returns locations for every cited key, including repeated occurrences in one paragraph.
 */
export function referenceCitationLocations(blocks: readonly PaperBlock[]): Map<string, ReferenceCitationLocation[]> {
  const locations = new Map<string, ReferenceCitationLocation[]>()
  for (const block of blocks) {
    if (block.kind === 'code' || block.kind === 'html') continue
    const prose = block.text.replace(/(`+)([\s\S]*?)\1/g, value => ' '.repeat(value.length))
      .replace(/<!--[\s\S]*?-->/g, value => ' '.repeat(value.length))
    const occurrences = new Map<string, number>()
    for (const match of prose.matchAll(/\[@([^\]]+)\]/g)) {
      const keys = (match[1] ?? '').split(';').map((part, index) => {
        const key = part.trim()
        return index === 0 ? key : key.startsWith('@') ? key.slice(1) : ''
      })
      if (!keys.length || keys.some(key => !/^[A-Za-z][A-Za-z0-9_:./-]*$/.test(key))) continue
      for (const key of keys) {
        const occurrence = occurrences.get(key) ?? 0
        occurrences.set(key, occurrence + 1)
        const group = locations.get(key) ?? []
        group.push({ blockId: block.id, occurrence }); locations.set(key, group)
      }
    }
  }
  return locations
}
