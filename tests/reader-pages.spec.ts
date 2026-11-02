import { describe, expect, it } from 'vitest'
import { figureKey, figureRefs, headingLevel, paginate } from '../src/project/reader-pages.ts'

const para = (id: string, n: number, word = 'word'): { id: string, text: string, claims: string[], basis: Record<string, string> } =>
  ({ id, text: Array.from({ length: n }, (_, i) => (i % 15 === 14 ? `${word}.` : i % 15 === 0 ? 'The' : word)).join(' ') + '.', claims: [], basis: {} })

describe('reading pages', () => {
  it('starts every section on a page and cuts near the target length', () => {
    const pages = paginate({ sections: [
      { id: 's1', heading: 'Abstract', beat: '', paragraphs: [{ id: 'a', text: 'Ann Lee¹, Bo Chen²', claims: [], basis: {} }, para('b', 180)] },
      { id: 's2', heading: '1. Introduction', beat: '', paragraphs: [para('c', 120), para('d', 120), para('e', 120), para('f', 120)] },
      { id: 's3', heading: '1.1. Details', beat: '', paragraphs: [para('g', 650)] },
    ] })
    expect(pages[0]!.heads[0]!.text).toBe('Abstract')
    expect(pages[0]!.chunks[0]).toMatchObject({ paragraph: 'a', front: true })
    const intro = pages.filter(p => p.section === '1. Introduction' && !p.subsection)
    expect(intro).toHaveLength(2)          // 480 words: two pages of 240, not 270 + 210 tails
    expect(intro.map(p => p.chunks.length)).toEqual([2, 2])
    const long = pages.filter(p => p.chunks.some(c => c.paragraph === 'g'))
    expect(long.length).toBeGreaterThan(1)   // a 650-word paragraph is cut at sentence ends
    expect(long[1]!.chunks[0]!.part).toBeGreaterThan(0)
    expect(headingLevel('3.1. Hybrid Mode Interface')).toBe(3)
    expect(headingLevel('B. Design')).toBe(2)
    expect(headingLevel('(ii) Knowledge tasks')).toBe(3)
  })
  it('finds figure references and resolves panels', () => {
    const figures = [
      { id: 'F2', label: 'Fig. 2', title: '', caption: '', placement: 'main' as const, file: 'a.png', panels: [{ label: 'a', image: '', note: '', spare: false }, { label: 'd', image: '', note: '', spare: false }] },
      { id: 'F8', label: 'Figure 8', title: '', caption: '', placement: 'main' as const, file: 'b.png', panels: [] },
      { id: 'T1', label: 'Table 1', title: '', caption: '', placement: 'main' as const, file: 'c.png', panels: [] },
      { id: 'ED4', label: 'Extended Data Fig. 4', title: '', caption: '', placement: 'extended' as const, file: 'd.png', panels: [] },
    ]
    const text = 'As shown in Figure 2D and Figures 2 and 8, results (Table 1; Extended Data Fig. 4b) hold, unlike Fig. 9.'
    const refs = figureRefs(text, figures)
    expect(refs.map(r => [text.slice(r.start, r.end), r.figure, r.panel])).toEqual([
      ['Figure 2D', 'F2', 'd'], ['Figures 2', 'F2', null], ['8', 'F8', null], ['Table 1', 'T1', null], ['Extended Data Fig. 4b', 'ED4', null],
    ])
    expect(figureKey('Extended Data Table 2')).toBe('ET2')
    expect(figureKey('Fig. S3')).toBe('FS3')
  })
})
