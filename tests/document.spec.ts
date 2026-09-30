/** Regression tests for changes that can alter a scientific statement. */
import { describe, expect, it } from 'vitest'
import { checkChanges, migrateAnnotations, parseRevision } from '../src/document.ts'
import type { Annotation, ProposalInput } from '../src/schema.ts'

function flags(before: string, after: string, heading = '## Results') {
  const revision = parseRevision(`${heading}\n\n${before}`)
  const block = revision.blocks.at(-1)!
  const proposal: ProposalInput = { baseRevision: revision.id, annotationIds: [], reason: 'Review edit',
    meaning: 'style', edits: [{ blockId: block.id, before, after }] }
  return checkChanges(proposal, revision.blocks)
}

describe('scientific change regression', () => {
  it.each([
    ['Effect was -0.8.', 'Effect was +0.8.'],
    ['p < 0.05.', 'p > 0.05.'],
    ['p ≤ .05.', 'p ≥ .05.'],
    ['Dose: 10 ng.', 'Dose: 10 pg.'],
    ['Concentration: 5 mmol/L.', 'Concentration: 5 mmol/mL.'],
    ['Incubated for 24 h.', 'Incubated for 24 min.'],
    ['The CI was [-0.3, 0.7].', 'The CI was [0.3, 0.7].'],
  ])('flags numerical semantics: %s → %s', (before, after) => {
    expect(flags(before, after)).toContain('numbers')
  })
  it('does not flag harmless spacing or equivalent Unicode micro/minus glyphs', () => {
    expect(flags('Dose 5 μg; effect −0.3.', 'Dose 5µg; effect -0.3.')).not.toContain('numbers')
  })
  it('does not lose Methods context in a nested subsection', () => {
    expect(flags('We analyzed the cohort.', 'We analyzed the samples.', '## Methods\n\n### Participants')).toContain('methods')
  })
  it('stops inheriting Methods at the next sibling heading', () => {
    expect(flags('We analyzed the cohort.', 'We analyzed the samples.', '## Methods\n\n### Participants\n\n## Results')).not.toContain('methods')
  })
  it('detaches an overlapping ambiguous quote rather than guessing', () => {
    const revision = parseRevision('ababa')
    const annotation: Annotation = { id: 'A1', blockId: revision.blocks[0]!.id, revision: revision.id,
      quote: 'aba', prefix: '', suffix: '', comment: 'Which occurrence?', status: 'open', anchor: 'attached' }
    expect(migrateAnnotations([annotation], revision)[0]!.anchor).toBe('needs-location')
  })
})
