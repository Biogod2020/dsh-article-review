/** Current and released composer action interfaces preserve operator drafts. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SessionInputShell } from '../../../client/ui-conversation/src/client/input/facade.ts'
import { attachContext } from '../src/client/composer.ts'
import { en, zh } from '../src/client/locales.ts'

function shell(): SessionInputShell {
  return new SessionInputShell({ actx: new Context(), defaultSink: vi.fn(), commandAttachments: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
  } })
}

it.each(['', 'My existing instructions'])('attaches on DSH 0.1.6 without losing a plain draft: %s', (draft) => {
  const input = shell()
  try {
    input.setDraft(draft)
    expect(attachContext({ setDraft: (text) => { input.actions.setDraft(text) } }, input.state.getSnapshot(), 'Paper context')).toBe('inserted')
    expect(input.state.getSnapshot().draft).toBe(draft ? `${draft}\n\nPaper context` : 'Paper context')
  } finally { input.dispose() }
})

it('keeps reference chips on the current interface and refuses to flatten them on DSH 0.1.6', () => {
  const input = shell()
  try {
    input.setDraft('@ref')
    input.insertReference({ source: 'file', ref: 'article.md', label: 'article.md', clipboardText: '@[article.md](article.md)' },
      { start: 0, end: 4, draftRev: input.state.getSnapshot().draftRev })
    const before = input.state.getSnapshot()
    expect(attachContext({ setDraft: (text) => { input.actions.setDraft(text) } }, before, 'Paper context')).toBe('references')
    expect(input.state.getSnapshot()).toEqual(before)
    expect(attachContext(input.actions, before, ' Paper context')).toBe('inserted')
    expect(input.state.getSnapshot().draft).toContain('Paper context')
    expect(input.state.getSnapshot().occurrences).toEqual(before.occurrences)
    expect([en.referenceDraft, zh.referenceDraft]).toMatchSnapshot()
  } finally { input.dispose() }
})

it('leaves a busy or rejecting composer unchanged', () => {
  const setDraft = vi.fn()
  const state = { draft: 'Existing', occurrences: [], phase: 'submitting' as const }
  expect(attachContext({ setDraft }, state, 'Paper context')).toBe('busy')
  expect(setDraft).not.toHaveBeenCalled()
  const actions = { setDraft, captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }), insertText: () => false }
  expect(attachContext(actions, { ...state, phase: 'plain' }, 'Paper context')).toBe('busy')
  expect(setDraft).not.toHaveBeenCalled()
})
