import { describe, expect, it } from 'vitest'
import { assertNewCitations, citationLabel, citationsIn, parseBibtex, possibleBareCitationKeys, readingBlocks, reviewableBlocks } from '../src/bibliography.ts'
import type { PaperBlock } from '../src/schema.ts'

const bib = `% source note
@article{hest,
 author={Jaume, Guillaume and Doucet, Paul and Song, Andrew},
 title={{HEST-1k: A Dataset for Spatial Transcriptomics and Histology Image Analysis}},
 year={2024}, url={https://example.org/hest}
}
@string{journal = {Nature}}
@article{stimage, author={Chen, Jiawen}, title={STimage-1K4M}, year={2024}, doi={10.1/example}}
`

describe('BibTeX indexing and citation policy', () => {
  it('indexes exact entries without treating comments or macros as references', () => {
    const entries = parseBibtex(bib, 'references/domain.bib')
    expect(entries.map(entry => entry.key)).toEqual(['hest', 'stimage'])
    expect(entries[0]?.fields.title).toBe('{HEST-1k: A Dataset for Spatial Transcriptomics and Histology Image Analysis}')
    expect(citationLabel(entries[0]!)).toBe('Jaume et al., 2024')
    expect(entries[1]?.fields.doi).toBe('10.1/example')
    expect(entries[0]?.raw.startsWith('@article{hest,')).toBe(true)
  })

  it('rejects an incomplete or malformed entry instead of silently indexing it', () => {
    expect(() => parseBibtex('@article{missing,title={A}', 'a.bib')).toThrow(/unclosed/)
    expect(() => parseBibtex('@article{bad key, title={A}}', 'a.bib')).toThrow(/Invalid BibTeX key/)
  })

  it('accepts canonical grouped citations and requires newly cited keys in bound BibTeX', () => {
    expect(citationsIn('A [@hest; @stimage] and `[@code]`.').map(citation => citation.keys)).toEqual([['hest', 'stimage']])
    expect(() => { assertNewCitations('Before.', 'Before [@hest; @stimage].', new Set(['hest', 'stimage'])) }).not.toThrow()
    expect(() => { assertNewCitations('Before.', 'Before [@stahl2016].', new Set(['stahl2016'])) }).not.toThrow()
    expect(() => { assertNewCitations('Before.', 'Before [@missing].', new Set(['hest'])) }).toThrow(/no entry/)
    expect(() => { assertNewCitations('Before.', 'Before [@hest].', null) }).toThrow(/Bind/)
  })

  it('refuses new bare year keys but does not block unchanged legacy keys', () => {
    expect(() => { assertNewCitations('A hest,stimage.', 'A hest,stimage. More prose.', new Set(['hest', 'stimage'])) }).not.toThrow()
    expect(() => { assertNewCitations('A hest.', 'A hest stahl2016.', new Set(['hest'])) }).toThrow(/Use \[@stahl2016\]/)
    expect(() => { assertNewCitations('A.', 'A [cite: hest].', new Set(['hest'])) }).toThrow(/Use \[@key\]/)
    expect(() => { assertNewCitations('A.', String.raw`Image $2000\times1939$ and \(1999\times2020\).`, new Set(['hest'])) }).not.toThrow()
  })

  it('does not mistake equations or code for unmarked citation keys', () => {
    const prose = String.raw`Image $2000\times1939$ and \(1999\times2020\); ` + '`stahl2016` [@hest].'
    expect(possibleBareCitationKeys(prose, ['hest', 'stahl2016'])).toEqual([])
    expect(possibleBareCitationKeys('Introduced by stahl2016, with hest.', ['hest', 'stahl2016'])).toEqual(['stahl2016', 'hest'])
  })

  it('keeps bibliography out of reading and progress while preserving later sections', () => {
    const blocks = [
      ['# Paper', 'heading'], ['<!-- source -->', 'html'], ['Body', 'paragraph'],
      ['## References', 'heading'], ['- **hest**: details', 'list'], ['## Appendix', 'heading'], ['Appendix text', 'paragraph'],
    ].map(([text, kind], index) => ({ id: String(index), text, kind, section: '', start: index, end: index + 1 })) as PaperBlock[]
    expect(readingBlocks(blocks).map(block => block.text)).toEqual(['# Paper', '<!-- source -->', 'Body', '## Appendix', 'Appendix text'])
    expect(reviewableBlocks(blocks).map(block => block.text)).toEqual(['# Paper', 'Body', '## Appendix', 'Appendix text'])
  })
})
