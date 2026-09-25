/** BibTeX entry indexing and manuscript citation checks; `.bib` files remain authoritative. */
import { createHash } from 'node:crypto'
export { readingBlocks, reviewableBlocks } from './review-blocks.ts'

/** One exact BibTeX entry and its fields; field values are not claims of source verification. */
export interface BibEntry {
  key: string
  type: string
  raw: string
  hash: string
  fields: Record<string, string>
  file: string
}

/** A canonical `[@key]` or `[@first; @second]` manuscript citation. */
export interface Citation {
  keys: string[]
  raw: string
  start: number
  end: number
}

const KEY = /^[A-Za-z][A-Za-z0-9_:./-]*$/
const CITE = /\[@([^\]]+)\]/g
const BARE_YEAR_KEY = /\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g

function withoutInlineCode(text: string): string {
  return text.replace(/(`+)([\s\S]*?)\1/g, value => ' '.repeat(value.length))
}

function withoutCanonicalCitations(text: string): string {
  return withoutInlineCode(text)
    .replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^\n$]*(?<!\\)\$/g, value => ' '.repeat(value.length))
    .replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, value => ' '.repeat(value.length))
    .replace(CITE, value => ' '.repeat(value.length))
}

/**
 * Find likely unmarked citation keys in prose, ignoring code, math, and canonical citations.
 * @param text - manuscript Markdown to inspect.
 * @param boundKeys - keys available in the bound BibTeX files.
 * @returns possible bare keys for author review, not verified citations.
 */
export function possibleBareCitationKeys(text: string, boundKeys: Iterable<string>): string[] {
  const prose = withoutCanonicalCitations(text)
  const found = new Set(prose.match(BARE_YEAR_KEY) ?? [])
  for (const key of boundKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(prose)) found.add(key)
  }
  return [...found]
}

function matching(text: string, start: number, open: string, close: string): number {
  if (open === '"') {
    for (let at = start + 1; at < text.length; at++) {
      if (text[at] === '\\') { at++; continue }
      if (text[at] === '"') return at
    }
    throw new Error('BibTeX quoted field is unclosed')
  }
  let depth = 0
  let quoted = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]
    if (char === '\\') { at++; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === open) depth++
    else if (char === close && --depth === 0) return at
  }
  throw new Error('BibTeX entry has an unclosed delimiter')
}

function fieldsOf(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let at = 0
  while (at < body.length) {
    while (/[\s,]/.test(body[at] ?? '') && at < body.length) at++
    if (at >= body.length) break
    const name = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(at))?.[0]
    if (!name) throw new Error('BibTeX field name is invalid')
    at += name.length
    while (/\s/.test(body[at] ?? '') && at < body.length) at++
    if (body[at++] !== '=') throw new Error(`BibTeX field ${name} needs =`)
    while (/\s/.test(body[at] ?? '') && at < body.length) at++
    let value = ''
    if (body[at] === '{' || body[at] === '"') {
      const start = at
      const opener = body[at] === '{' ? '{' : '"'
      const end = matching(body, start, opener, opener === '{' ? '}' : '"')
      value = body.slice(start + 1, end)
      at = end + 1
    } else {
      const end = body.indexOf(',', at)
      value = body.slice(at, end < 0 ? undefined : end).trim()
      at = end < 0 ? body.length : end
    }
    if (!value.trim()) throw new Error(`BibTeX field ${name} is empty`)
    fields[name.toLowerCase()] = value.trim()
    while (/\s/.test(body[at] ?? '') && at < body.length) at++
    if (at < body.length && body[at] !== ',') throw new Error(`BibTeX field ${name} is followed by unsupported syntax`)
  }
  return fields
}

/**
 * Index entries without rewriting BibTeX syntax or expanding macros.
 * @param text - exact source file.
 * @param file - workspace-relative source identity.
 * @returns entries with exact raw ranges for conflict-checked replacement.
 */
export function parseBibtex(text: string, file: string): BibEntry[] {
  const entries: BibEntry[] = []
  let at = 0
  while (at < text.length) {
    if (text[at] === '%') { at = text.indexOf('\n', at) + 1 || text.length; continue }
    if (text[at] !== '@') { at++; continue }
    const start = at
    const type = /^@[A-Za-z]+/.exec(text.slice(at))?.[0].slice(1)
    if (!type) throw new Error(`Invalid BibTeX entry at offset ${at}`)
    at += type.length + 1
    while (/\s/.test(text[at] ?? '') && at < text.length) at++
    const open = text[at]
    if (open !== '{' && open !== '(') throw new Error(`BibTeX ${type} needs an opening delimiter`)
    const end = matching(text, at, open, open === '{' ? '}' : ')')
    const raw = text.slice(start, end + 1)
    const content = text.slice(at + 1, end)
    at = end + 1
    if (/^(?:comment|string|preamble)$/i.test(type)) continue
    const comma = content.indexOf(',')
    if (comma < 0) throw new Error(`BibTeX ${type} has no key separator`)
    const key = content.slice(0, comma).trim()
    if (!KEY.test(key)) throw new Error(`Invalid BibTeX key: ${key}`)
    entries.push({ key, type: type.toLowerCase(), raw,
      hash: createHash('sha256').update(raw).digest('hex'), fields: fieldsOf(content.slice(comma + 1)), file })
  }
  return entries
}

/**
 * Find canonical citations outside inline code while retaining source offsets.
 * @param text - Markdown source block.
 * @returns recognized canonical citations.
 */
export function citationsIn(text: string): Citation[] {
  return [...withoutInlineCode(text).matchAll(CITE)].flatMap((match) => {
    const keys = match[1]?.split(';').map((part, index) => {
      const item = part.trim()
      return index === 0 ? item : item.startsWith('@') ? item.slice(1) : ''
    }) ?? []
    return keys.length > 0 && keys.every(key => KEY.test(key))
      ? [{ keys, raw: match[0], start: match.index, end: match.index + match[0].length }] : []
  })
}

function count(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

/**
 * Reject newly introduced unresolved or unmarked citations without blocking unchanged legacy prose.
 * @param before - exact source block before a proposal.
 * @param after - proposed replacement.
 * @param keys - keys in the bound `.bib` files, or null when no files are bound.
 */
export function assertNewCitations(before: string, after: string, keys: ReadonlySet<string> | null): void {
  const old = count(citationsIn(before).flatMap(citation => citation.keys))
  const next = count(citationsIn(after).flatMap(citation => citation.keys))
  for (const [key, amount] of next) {
    if (amount <= (old.get(key) ?? 0)) continue
    if (!keys) throw new Error('Bind the authoritative .bib files before adding citations')
    if (!keys.has(key)) throw new Error(`Citation [@${key}] has no entry in the bound .bib files`)
  }
  const oldBare = count(withoutCanonicalCitations(before).match(BARE_YEAR_KEY) ?? [])
  for (const [key, amount] of count(withoutCanonicalCitations(after).match(BARE_YEAR_KEY) ?? [])) {
    if (amount > (oldBare.get(key) ?? 0)) throw new Error(`Use [@${key}] instead of an unmarked citation key`)
  }
  if ((after.match(/\[cite:\s*[^\]]+\]/g) ?? []).length > (before.match(/\[cite:\s*[^\]]+\]/g) ?? []).length) {
    throw new Error('Use [@key] instead of [cite: key] for new citations')
  }
}

/**
 * Format a compact author-year label without claiming bibliographic verification.
 * @param entry - indexed BibTeX metadata.
 * @returns author-year display label.
 */
export function citationLabel(entry: BibEntry): string {
  const people = entry.fields.author?.split(/\s+and\s+/i) ?? []
  const first = people[0]?.replace(/[{}]/g, '').trim() ?? ''
  const surname = first.includes(',') ? first.split(',')[0]?.trim() : first.split(/\s+/).at(-1)
  const author = surname ? `${surname}${people.length > 2 ? ' et al.' : people.length === 2 ? ' & ' + (people[1]?.split(',')[0]?.trim() ?? '') : ''}` : entry.key
  return entry.fields.year ? `${author}, ${entry.fields.year.replace(/[{}]/g, '')}` : author
}
