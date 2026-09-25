import { describe, expect, it } from 'vitest'
import { displayCitations } from '../src/client/citation-display.ts'
import type { BibliographyView } from '../src/schema.ts'

type Entry = BibliographyView['entries'][number]
const entry = (key: string, author: string, year: string): Entry =>
  ({ key, type: 'article', file: 'references/main.bib', hash: key, fields: { author, year, title: key } })

describe('reader citation display', () => {
  const entries = [
    entry('stahl2016', 'St{\\aa}hl, Patrik L. and Salm{\\\'e}n, Fredrik and Vickovic, Sanja', '2016'),
    entry('hest', 'Jaume, Guillaume and Doucet, Paul and Song, Andrew H.', '2024'),
    entry('stimage', 'Chen, Jiawen and Zhou, Muqing and Wu, Wenrong', '2024'),
  ]

  it('shows author-year labels for one or several bound keys', () => {
    expect(displayCitations('Introduced in 2016 [@stahl2016]. Images [@hest; @stimage].', entries))
      .toBe('Introduced in 2016 (Ståhl et al., 2016). Images (Jaume et al., 2024; Chen et al., 2024).')
  })

  it('keeps unknown citations and inline code as source instead of fabricating a label', () => {
    expect(displayCitations('See [@unknown] and `[@hest]`, then [@hest; @unknown].', entries))
      .toBe('See [@unknown] and `[@hest]`, then [@hest; @unknown].')
  })
})
