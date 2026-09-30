/** Seeded model-based properties compare the index with the original conservative algorithm. */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parseRevision } from '../src/document.ts'
import { auditTextChanges } from '../src/change-audit.ts'

const fragment = fc.constantFrom('Alpha paragraph.', 'Beta paragraph.', 'Duplicate paragraph.', '# Heading',
  '## Methods', '### Participants', '- First\n- Second', '> Quoted paragraph.', '🧬 A Unicode paragraph.')

describe('document invariants', () => {
  it('matches the original unique identity rule across duplicates, insertions, removals and reordering', () => {
    fc.assert(fc.property(fc.array(fragment, { maxLength: 25 }), fc.array(fragment, { maxLength: 25 }), (before, after) => {
      const previous = parseRevision(before.join('\n\n'))
      const next = parseRevision(after.join('\n\n'), previous)
      for (const block of next.blocks) {
        const candidates = previous.blocks.filter(old => old.kind === block.kind && old.text === block.text)
        const unique = candidates.length === 1 && next.blocks.filter(item => item.kind === block.kind && item.text === block.text).length === 1
        if (unique) expect(block.id).toBe(candidates[0]!.id)
        else expect(previous.blocks.some(old => old.id === block.id)).toBe(false)
        expect(next.text.slice(block.start, block.end)).toBe(block.text)
      }
    }), { seed: 20260930, numRuns: 250 })
  })
  it('preserves explicit accepted same-kind replacements without guessing duplicate identity', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), fc.boolean(), (count, duplicate) => {
      const source = Array.from({ length: count }, (_, i) => `Original paragraph ${i}.`).join('\n\n')
      const previous = parseRevision(source), target = previous.blocks[0]!
      const replacements = new Map([[target.id, 'Accepted replacement.']])
      const next = parseRevision(source.replace(target.text, 'Accepted replacement.') + (duplicate ? '\n\nAccepted replacement.' : ''), previous, replacements)
      const matching = next.blocks.filter(block => block.text === 'Accepted replacement.')
      expect(matching.some(block => block.id === target.id)).toBe(!duplicate)
    }), { seed: 20260930, numRuns: 100 })
  })
  it('does not lose a sign change across generated nonzero magnitudes', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), number => {
      expect(auditTextChanges(`Effect -${number}`, `Effect +${number}`)[0]?.category).toBe('numbers')
    }), { seed: 20260930, numRuns: 250 })
  })
})
