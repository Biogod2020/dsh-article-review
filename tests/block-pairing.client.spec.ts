/** Historical comparison pairs only display candidates, never persisted annotation identities. */
import { expect, it } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { pairRevisionBlocks } from '../src/client/block-pairing.ts'

it('pairs an externally rewritten block between unchanged neighbors without reusing its id', () => {
  const before = parseRevision('# Title\n\nFirst anchor.\n\nThe screening reference contains 400 studies.\n\nLast anchor.')
  const after = parseRevision('# Title\n\nFirst anchor.\n\nThe screening reference contains 420 studies.\n\nLast anchor.', before)
  const oldBlock = before.blocks[2]!
  const newBlock = after.blocks[2]!
  expect(oldBlock.id).not.toBe(newBlock.id)
  expect(pairRevisionBlocks(before.blocks, after.blocks).get(oldBlock.id)).toBe(newBlock.id)
  expect(before.blocks[2]?.id).toBe(oldBlock.id)
})

it('finds the changed paragraph after an insertion without pairing the insertion', () => {
  const before = parseRevision('# Title\n\nFirst anchor.\n\nThe cohort has 400 spatial samples from five sites.\n\nLast anchor.')
  const after = parseRevision('# Title\n\nFirst anchor.\n\nA new methodological note appears here.\n\nThe cohort has 420 spatial samples from five sites.\n\nLast anchor.', before)
  const pairs = pairRevisionBlocks(before.blocks, after.blocks)
  expect(pairs.get(before.blocks[2]!.id)).toBe(after.blocks[3]!.id)
  expect([...pairs.values()]).not.toContain(after.blocks[2]!.id)
})

it('leaves unrelated or ambiguous replacements without word-level pairing', () => {
  const source = '# Title\n\nFirst anchor.\n\nThe cohort includes 400 studies and 10 sites.\n\nLast anchor.'
  const before = parseRevision(source)
  const unrelated = parseRevision('# Title\n\nFirst anchor.\n\nA new discussion of microscopy appears here.\n\nLast anchor.', before)
  const ambiguous = parseRevision('# Title\n\nFirst anchor.\n\nThe cohort includes 400 studies and 11 sites.\n\nThe cohort includes 400 studies and 12 sites.\n\nLast anchor.', before)
  expect(pairRevisionBlocks(before.blocks, unrelated.blocks).has(before.blocks[2]!.id)).toBe(false)
  expect(pairRevisionBlocks(before.blocks, ambiguous.blocks).has(before.blocks[2]!.id)).toBe(false)
})
