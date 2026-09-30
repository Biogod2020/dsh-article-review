import { describe, expect, it } from 'vitest'
import { auditTextChanges } from '../src/change-audit.ts'

describe('bounded source-grounded change evidence', () => {
  it.each([
    ['p<0.05', 'p>0.05'], ['p≤.05', 'p≥.05'], ['p<=0.05', 'p>=0.05'],
    ['n = 1,000', 'n = 10,000'], ['p \\leq 0.01', 'p \\geq 0.01'],
    ['Dose 5 mg/kg', 'Dose 5 mg/g'], ['5 mM', '5 mm'], ['5 cm²', '5 cm³'],
    ['1e-3 mol/L', '1e+3 mol/L'], ['5 mL', '5 µL'], ['95% CI [-1, 2]', '95% CI [1, 2]'],
    ['Group A 40; group B 20', 'Group A 20; group B 40'],
  ])('retains numeric context for %s → %s', (before, after) => {
    expect(auditTextChanges(before, after).map(change => change.category)).toContain('numbers')
  })
  it('preserves real source offsets even with astral Unicode before a quantity', () => {
    const before = '🧬 effect -0.8', after = '🧬 effect +0.8'
    const evidence = auditTextChanges(before, after)[0]!
    for (const token of evidence.before) expect(before.slice(token.start, token.end)).toBe(token.text)
    for (const token of evidence.after) expect(after.slice(token.start, token.end)).toBe(token.text)
  })
  it('bounds evidence while retaining full counts and never silently declares completeness', () => {
    const change = auditTextChanges(Array.from({ length: 30 }, (_, i) => `${i}`).join('; '), 'none', 3)[0]!
    expect(change.before).toHaveLength(3)
    expect(change.beforeCount).toBe(30)
    expect(change.truncated).toBe(true)
  })
  it('detects swapped values, insertions, removals, citations and claim qualifiers', () => {
    expect(auditTextChanges('40 20', '20 40')[0]?.before).toHaveLength(2)
    expect(auditTextChanges('', 'n = 50; may outperform [@smith2026].').map(change => change.category))
      .toEqual(['numbers', 'citations', 'claim-language'])
    expect(auditTextChanges('This may help.', 'This helps.').map(change => change.category)).toContain('claim-language')
  })
  it('does not flag identical text or equivalent micro/minus glyphs', () => {
    expect(auditTextChanges('All 5 μg; −0.2.', 'All 5µg; -0.2.')).toEqual([])
    expect(auditTextChanges('p<0.05', 'p < 0.05')).toEqual([])
    expect(auditTextChanges('Exact source [@ref].', 'Exact source [@ref].')).toEqual([])
  })
  it.each([0, 101, 1.5, NaN])('rejects invalid evidence bounds %s', limit => {
    expect(() => auditTextChanges('1', '2', limit)).toThrow(RangeError)
  })
})
