/**
 * Reading pages for the project reader, the same way the preprint reader of the paper frontend paginates: every
 * section starts a page, a section's text is cut into the fewest pages near a comfortable length (no short tails),
 * and a paragraph longer than a page is cut at sentence ends. Figure references in the text are found so the reader
 * can show, beside each page, the panels that page cites.
 */
import type { Project } from './model.ts'

export const TARGET_WORDS = 220   // one page fits a laptop screen at 18px without scrolling
export const MAX_WORDS = 270
export const SPLIT_WORDS = 300

/** A piece of one paragraph on a page; `part` > 0 marks a continuation of a paragraph cut at a sentence end. */
export interface Chunk { paragraph: string, text: string, part: number, front: boolean }
export interface ReadingPage {
  section: string, subsection: string,
  /** headings shown at the top of the page: the section (h2) and/or subsection (h3) that start here */
  heads: Array<{ level: 2 | 3, text: string }>,
  chunks: Chunk[],
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length

/** "3.1. Hybrid Mode Interface", "B.2 …", "(ii) …" are subsections; "3. Results", "B. …", "Abstract" are sections. */
export function headingLevel(heading: string): 2 | 3 {
  return /^\s*(?:\d+\.\d+|[A-Z]\.\d+|\((?:[ivx]+|[a-z])\))/.test(heading) ? 3 : 2
}

/** Sentences of a paragraph: a cut after . ! ? followed by a capital or an opening bracket/quote. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(“"[])/)
}

/** The author block and affiliations before the abstract: short lines without a sentence end, in the first section. */
function isFront(text: string, sectionIndex: number, paragraphIndex: number): boolean {
  return sectionIndex === 0 && paragraphIndex < 4 && words(text) <= 45 && !/[.!?]["”’)]?\s*$/.test(text.trim())
}

/** Cut a section's chunks into pages near TARGET_WORDS (dynamic programming; too long or too short is penalised). */
export function bestCuts(chunks: Chunk[]): Chunk[][] {
  const ws = chunks.map(c => words(c.text))
  const n = ws.length
  if (!n) return [[]]
  const cost = (a: number, b: number): number => {
    let s = 0
    for (let i = a; i < b; i++) s += ws[i]!
    let c = (s - TARGET_WORDS) ** 2
    if (s > MAX_WORDS + 40 && b - a > 1) c += 1e6
    if (s < 110) c += 2e5
    return c
  }
  const best = [0, ...Array<number>(n).fill(Infinity)]
  const back = Array<number>(n + 1).fill(0)
  for (let b = 1; b <= n; b++) for (let a = 0; a < b; a++) {
    const v = best[a]! + cost(a, b)
    if (v < best[b]!) { best[b] = v; back[b] = a }
  }
  const cuts: Array<[number, number]> = []
  for (let b = n; b > 0; b = back[b]!) cuts.push([back[b]!, b])
  return cuts.reverse().map(([a, b]) => chunks.slice(a, b))
}

export function paginate(project: Pick<Project, 'sections'>): ReadingPage[] {
  interface Group { section: string, subsection: string, heads: ReadingPage['heads'], chunks: Chunk[] }
  const groups: Group[] = []
  let sec = '', sub = ''
  project.sections.forEach((s, si) => {
    const level = headingLevel(s.heading)
    if (level === 2) { sec = s.heading; sub = '' } else sub = s.heading
    const last = groups.at(-1)
    // a section heading directly followed by a subsection shares its page
    if (last && !last.chunks.length) { last.subsection = sub; last.heads.push({ level, text: s.heading }) }
    else groups.push({ section: sec, subsection: sub, heads: [{ level, text: s.heading }], chunks: [] })
    const g = groups.at(-1)!
    s.paragraphs.forEach((x, pi) => {
      const front = isFront(x.text, si, pi)
      if (words(x.text) <= SPLIT_WORDS) { g.chunks.push({ paragraph: x.id, text: x.text, part: 0, front }); return }
      let acc: string[] = [], n = 0, part = 0
      for (const sentence of sentences(x.text)) {
        acc.push(sentence); n += words(sentence)
        if (n >= TARGET_WORDS) { g.chunks.push({ paragraph: x.id, text: acc.join(' '), part: part++, front }); acc = []; n = 0 }
      }
      if (acc.length) g.chunks.push({ paragraph: x.id, text: acc.join(' '), part, front })
    })
  })
  const pages: Array<ReadingPage & { g: Group }> = []
  for (const g of groups) {
    bestCuts(g.chunks).forEach((part, i) => pages.push({ section: g.section, subsection: g.subsection, heads: i === 0 ? g.heads : [], chunks: part, g }))
  }
  // tiny closing sections (acknowledgements, availability) share one page
  const out: ReadingPage[] = []
  const size = (p: ReadingPage): number => p.chunks.reduce((n, c) => n + words(c.text), 0) + p.heads.length * 4
  for (const { g: _g, ...p } of pages) {
    const prev = out.at(-1)
    if (prev && size(p) < 120 && size(prev) < 120) { prev.heads.push(...p.heads); prev.chunks.push(...p.chunks) } else out.push(p)
  }
  return out
}

/** A figure reference in running text, resolved against the project's figures. */
export interface FigureRef { start: number, end: number, figure: string, panel: string | null }

/** Which kind of display item a label names: main figure, table, extended data, supplementary; plus its number. */
export function figureKey(label: string): string | null {
  const m = /(extended\s+data|supplementary|supp\.?|table|tab\.|fig(?:ure)?s?\.?)\s*(?:fig(?:ure)?s?\.?\s*|table\s*)?(S?\d+)/i.exec(label)
  if (!m) return null
  const k = m[1]!.toLowerCase()
  const kind = k.startsWith('ext') ? 'E' : k.startsWith('supp') ? 'S' : k.startsWith('tab') ? 'T' : 'F'
  return `${/table/i.test(label) && kind !== 'T' ? `${kind}T` : kind}${m[2]!.toUpperCase()}`
}

/**
 * Figure and table references in a paragraph: "Figure 2D", "Fig. 3a–c", "Figures 2 and 8", "Tables 1 and 2",
 * "Extended Data Fig. 4b", "Table S3". Each number in a list becomes its own reference; a panel letter selects the
 * panel with that label when the figure has one, otherwise the whole figure.
 */
export function figureRefs(text: string, figures: Project['figures']): FigureRef[] {
  const index = new Map<string, Project['figures'][number]>()
  for (const f of figures) { const k = figureKey(f.label); if (k && !index.has(k)) index.set(k, f) }
  const out: FigureRef[] = []
  const head = /\b(Extended\s+Data\s+(?:Fig(?:ure)?s?\.?|Tables?)|Supplementary\s+(?:Fig(?:ure)?s?\.?|Tables?)|Fig(?:ure)?s?\.?|Tables?)\s*/g
  const item = /(S?\d+)([a-zA-Z](?:\s*[–-]\s*[a-zA-Z])?)?(?![\w])/y
  let m: RegExpExecArray | null
  while ((m = head.exec(text))) {
    const kindLabel = m[1]!
    let at = head.lastIndex, first = true
    for (;;) {
      item.lastIndex = at
      const it = item.exec(text)
      if (!it) break
      const key = figureKey(`${kindLabel} ${it[1]}`)
      const f = key ? index.get(key) : undefined
      if (f) {
        const letter = it[2]?.[0]?.toLowerCase() ?? null
        const panel = letter ? f.panels.find(p => p.label.toLowerCase() === letter)?.label ?? null : null
        // the first item's link covers "Figure 2D"; later items in a list link only their own number
        out.push({ start: first ? m.index : it.index, end: it.index + it[0].length, figure: f.id, panel })
      }
      first = false
      at = it.index + it[0].length
      const sep = /^\s*(?:,|;|and|&|or)\s*/.exec(text.slice(at))
      if (!sep || !/^S?\d/.test(text.slice(at + sep[0].length))) break
      at += sep[0].length
    }
    head.lastIndex = at
  }
  return out
}
