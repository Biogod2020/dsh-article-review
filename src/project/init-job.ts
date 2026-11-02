/**
 * Initialising a project from a manuscript is long work: the agent reads every page, copies it and cuts its figures.
 * Models stop early on such work, and every page image they look at stays in the conversation. So the panel drives
 * it in rounds: one preparation turn, one turn per small batch of pages (or sections), one turn for the argument and
 * one for the check. This module plans the batches and writes each round's message; the host sends them.
 */

/** One round of copying: which part of the manuscript, in words the agent and the author both read. */
export interface Batch { label: string, part: string }

export type InitPhase = 'prepare' | 'copy' | 'argument' | 'check' | 'done'

/** Pages per batch and words per batch: small enough that a turn finishes them, large enough to keep turns few. */
const PAGES_PER_BATCH = 4
const WORDS_PER_BATCH = 1800

/**
 * Batches in reading order. A PDF is split by pages; LaTeX, Word and Markdown by the top-level headings of the
 * outline the preparation script wrote, two sections a batch, the last running to the end.
 */
export function planBatches(kind: string, pageWords: number[], outline: string, skip: boolean[] = []): Batch[] {
  if (kind === 'pdf') {
    const out: Batch[] = []
    let start = 0, words = 0
    const close = (end: number): void => {
      if (!start) return
      const span = start === end ? `${end}` : `${start}–${end}`
      const files = start === end ? `reading/pages/p${pad(end)}.png` : `reading/pages/p${pad(start)}.png … p${pad(end)}.png`
      out.push({ label: `第 ${span} 页`, part: `${start === end ? 'page' : 'pages'} ${span} (${files})` })
      start = 0; words = 0
    }
    pageWords.forEach((w, i) => {
      const page = i + 1
      // reference-list pages hold nothing to copy: a batch never contains or spans them
      if (skip[i]) { close(page - 1); return }
      if (!start) start = page
      words += w
      if (page - start + 1 >= PAGES_PER_BATCH || words >= WORDS_PER_BATCH || page === pageWords.length) close(page)
    })
    return out
  }
  const heads = outline.split('\n').map(l => /^- (?:section|heading): (.+)$/.exec(l)?.[1]?.trim()).filter((h): h is string => Boolean(h))
  if (!heads.length) return [{ label: '全文', part: 'the whole manuscript' }]
  const out: Batch[] = []
  for (let i = 0; i < heads.length; i += 2) {
    const first = i === 0 ? 'the title, author block and abstract, then the section' : 'the section'
    const end = i + 2 < heads.length ? `up to (not including) the section "${heads[i + 2]}"` : 'to the end of the manuscript, appendix included (not the reference list)'
    out.push({ label: `“${short(heads[i]!)}”起`, part: `${first} "${heads[i]}" ${i + 1 < heads.length ? `and the section "${heads[i + 1]}" ` : ''}${end}` })
  }
  return out
}

const REFERENCE_LINE = /(et al\.|arXiv preprint|In Proceedings|Proceedings of|Conference on|Journal of|doi:|https?:\/\/|\(\d{4}\)|, \d{4}[a-z]?\.)/

/**
 * Pages of the reference list, by position: after the page with a "References" / "Bibliography" heading line, up to
 * the first page that starts the appendix or supplement, and only pages whose lines mostly look like citations.
 * Related-work pages are full of "et al." too, so a citation-density rule alone would skip them.
 * Same rule as check_project.py.
 */
export function referencePages(pages: string[]): boolean[] {
  const out = pages.map(() => false)
  const start = pages.findIndex(t => /^\s*(References|Bibliography|Literature Cited|参考文献)\s*$/m.test(t))
  if (start < 0) return out
  for (let i = start + 1; i < pages.length; i++) {
    const t = pages[i]!
    if (/^\s*(Appendix|Appendices|Supplementary (Information|Material|Methods)|Table of Contents|A\.?\s+[A-Z][a-z])/m.test(t.split('\n').slice(0, 12).join('\n'))) break
    const lines = t.split('\n').filter(l => l.trim())
    if (lines.length && lines.filter(l => REFERENCE_LINE.test(l)).length / lines.length > 0.25) out[i] = true
  }
  return out
}

const pad = (n: number): string => String(n).padStart(3, '0')
const short = (s: string): string => s.length > 18 ? `${s.slice(0, 17)}…` : s

/** Where the copy stands, so the next batch continues at the right paragraph. */
export interface CopyState { paragraphs: number, figures: number, lastSection?: { id: string, heading: string }, lastParagraph?: { id: string, tail: string } }

export function copyState(project: { sections?: Array<{ id: string, heading: string, paragraphs: Array<{ id: string, text: string }> }>, figures?: unknown[] }): CopyState {
  const sections = project.sections ?? []
  const last = sections.at(-1)
  // the last section may hold only figures (a case study, a heading before a table): take the last paragraph anywhere
  const para = [...sections].reverse().find(x => x.paragraphs.length)?.paragraphs.at(-1)
  return {
    paragraphs: sections.reduce((n, s) => n + s.paragraphs.length, 0), figures: (project.figures ?? []).length,
    ...(last ? { lastSection: { id: last.id, heading: last.heading } } : {}),
    ...(para ? { lastParagraph: { id: para.id, tail: para.text.slice(-80) } } : {}),
  }
}

const TOOLS = 'Use only the paper-project-init scripts (page_tools.py grid/crop, check_project.py), read_image and the project_* tools; never the paper_* tools or the paper-figure-panels skill, which are for manuscript review.'

const RULES = 'Look at each page with read_image (or read the source) and copy its text yourself in the project format of the skill; never paste extracted text. ' +
  'Find every figure and table on these pages by looking, cut it on the coordinate grid, look at the crop, cut its panels and look at each.'

/** The message that starts the job: preparation only, so the turn is short and the panel can plan the batches. */
export function prepareMessage(lines: string[]): string {
  return ['Initialise a paper project with the paper-project-init skill. The Paper panel drives this work in rounds and sends the next round when you end your turn.',
    '', ...lines, '',
    'This round: step 1 only. Run init_project.py with these inputs, set the title (and journal/audience if the manuscript shows them) with project_apply set-meta, and read reading/outline.md. ' +
    'Do not copy any text yet. End your turn with one line saying the project is prepared and how many pages or sections it has.'].join('\n')
}

export function copyMessage(project: string, batch: Batch, round: number, rounds: number, state: CopyState, retry: boolean): string {
  const where = state.lastSection
    ? `So far the project has ${state.paragraphs} paragraphs and ${state.figures} figures and ends with section ${state.lastSection.id} "${state.lastSection.heading}"` +
      (state.lastParagraph ? `; the last paragraph is ${state.lastParagraph.id}, ending "…${state.lastParagraph.tail}"` : '') + '. ' +
      'Continue from there: if the first page of this batch begins in the middle of that paragraph, extend it (upsert-paragraph, same id, the joined text); a new heading starts a new section with the next id. ' +
      'Figures already recorded (see project_read include figures) are not cut again.'
    : 'Nothing is copied yet: start with the title block and abstract (section s1).'
  return [`${retry ? 'Nothing was recorded in the last round. ' : ''}Paper project ${JSON.stringify(project)}, copying round ${round} of ${rounds}: copy ${batch.part}, following steps 2 and 3 of the paper-project-init skill for this part only.`,
    RULES, TOOLS, where,
    'If the last paragraph of this part continues beyond it, look at the next page and copy that paragraph to its end. Record sections and paragraphs with project_apply as you go, and each figure with upsert-figure once its panels are cut.',
    'Do nothing else in this round (no claims, no check). Do not ask the user anything: if the pages and this message disagree, follow the pages and say so in your summary. End your turn with one line: what you recorded.'].join('\n\n')
}

export function argumentMessage(project: string, withRepo: boolean): string {
  return [`Paper project ${JSON.stringify(project)}: all text and figures are copied. Now do steps 4 and 5 of the paper-project-init skill: ` +
    (withRepo ? 'run match_numbers.py first, then reconstruct the argument with the repository, ' : 'reconstruct the argument, ') +
    'linking every evidence item to the figure panel that shows it (look at the panel), then link every paragraph to the claims it states.',
    'Write thesis, beat and claim titles and statements in Chinese (the author\'s working language); keep quotes, numbers and technical terms as in the paper. Do not ask the user anything in this round; note open questions as gap evidence or in your summary. End your turn with one line: what you built.'].join('\n\n')
}

/**
 * The check's errors as lines for the next round, one line per kind of problem: the same guidance repeated for twenty
 * paragraphs made an 8 KB message; grouped, each kind lists its places once and its guidance once.
 */
export function errorLines(findings: unknown): string[] {
  type Finding = { severity?: string, title?: string, detail?: string, guidance?: string, where?: string }
  const errors = (Array.isArray(findings) ? findings as Finding[] : []).filter(f => f.severity === 'error')
  const groups = new Map<string, { kind: string, guidance: string, items: string[] }>()
  for (const f of errors) {
    // "格式：s5-p1 有 LaTeX 标记" → kind "有 LaTeX 标记" at s5-p1; titles without a place stay whole
    const m = /^(格式：)?(\S+) (有|段落|页眉|单词|正文|图注)(.*)$/.exec(f.title ?? '')
    const kind = m ? `${m[1] ?? ''}${m[3]}${m[4]}` : (f.title ?? '')
    const key = `${kind}|${f.guidance ?? ''}`
    const g = groups.get(key) ?? { kind, guidance: f.guidance ?? '', items: [] }
    g.items.push(m ? `${m[2]}${f.detail ? ` ${f.detail}` : ''}` : (f.detail ?? ''))
    groups.set(key, g)
  }
  return [...groups.values()].slice(0, 20).map(g => {
    const places = g.items.filter(Boolean)
    return [g.kind, places.length ? places.slice(0, 25).join('; ') + (places.length > 25 ? `; … (${places.length} in all)` : '') : '', g.guidance].filter(Boolean).join(' — ')
  })
}

export function checkMessage(project: string, errors: string[] = []): string {
  if (errors.length) {
    return [`Paper project ${JSON.stringify(project)}: the check still reports ${errors.length} error${errors.length > 1 ? 's' : ''}. Fix each one now; do not only report them.`,
      errors.map((e, i) => `${i + 1}. ${e}`).join('\n'),
      TOOLS,
      'For a crop: look at the page on its grid again (page_tools.py grid), choose a better box, cut it again under the same file name (page_tools.py crop), and look at the result; for panels, grid the figure crop, cut each panel to assets/<figure id><label>.png and update the figure with upsert-figure. ' +
      'For text: look at the page again and correct the paragraph (same id). Then run check_project.py again, record any remaining findings with project_comment (source "check"), and give the author the four-part report the skill describes. Do not ask the user anything in this round.'].join('\n\n')
  }
  return [`Paper project ${JSON.stringify(project)}: do step 6 of the paper-project-init skill. Run check_project.py; ` +
    'while it exits with status 1, go back to the pages it names, look again, and fix the copy or the figures, then run it again.',
    'Then record the remaining findings and your own list of problems with project_comment (source "check"), and give the author the four-part report the skill describes. Do not ask the user anything in this round.'].join('\n\n')
}
