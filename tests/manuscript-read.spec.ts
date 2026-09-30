import { describe, expect, it } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { readManuscriptPage } from '../src/manuscript-read.ts'

describe('revision-pinned whole-block reads', () => {
  const revision = parseRevision('# Title\n\nFirst.\n\nSecond.\n\nThird.')
  it('returns every block exactly once across pages, preserving ids and exact source', () => {
    const first = readManuscriptPage(revision, { maxBlocks: 2 })
    const second = readManuscriptPage(revision, { maxBlocks: 2, startBlock: first.page.nextStartBlock!, revision: revision.id })
    expect([...first.blocks, ...second.blocks]).toEqual(revision.blocks)
    expect(second.page.nextStartBlock).toBeNull()
  })
  it('requires a pinned revision on continuation', () => {
    expect(() => readManuscriptPage(revision, { startBlock: 1 })).toThrow('requires the revision')
    expect(() => readManuscriptPage(revision, { startBlock: 1, revision: 'stale' })).toThrow('restart pagination')
  })
  it.each([{ maxBlocks: 0 }, { maxBlocks: 201 }, { maxBlocks: 1.5 }, { startBlock: -1 }, { maxCharacters: 0 }])('rejects invalid pagination %j', input => {
    expect(() => readManuscriptPage(revision, input)).toThrow()
  })
  it('returns an oversized first block whole and explicitly reports the soft budget exception', () => {
    const large = parseRevision('x'.repeat(1500) + '\n\nNext.')
    const page = readManuscriptPage(large, { maxCharacters: 1000 })
    expect(page.blocks[0]?.text).toBe('x'.repeat(1500))
    expect(page.page).toMatchObject({ exceededCharacterBudget: true, characters: 1500, nextStartBlock: 1 })
  })
  it('does not add another block beyond the character budget', () => {
    const large = parseRevision('a'.repeat(600) + '\n\n' + 'b'.repeat(600))
    expect(readManuscriptPage(large, { maxCharacters: 1000 }).blocks).toHaveLength(1)
  })
  it('handles end-of-document, empty documents and out-of-range indices explicitly', () => {
    expect(readManuscriptPage(parseRevision(''), {}).page.nextStartBlock).toBeNull()
    expect(readManuscriptPage(revision, { startBlock: 4, revision: revision.id }).blocks).toEqual([])
    expect(() => readManuscriptPage(revision, { startBlock: 5, revision: revision.id })).toThrow('exceeds')
  })
})
