/** Repeated rendered text must remain tied to the occurrence the author actually selected. */
import { expect, it } from 'vitest'
import { locateQuote } from '../src/client/selection.ts'

it('uses the saved occurrence even when neighboring words repeat', () => {
  expect(locateQuote('same same same', { quote: 'same', prefix: '', suffix: '', offset: 5 })).toBe(5)
  expect(locateQuote('same same same', { quote: 'same', prefix: '', suffix: '' })).toBeUndefined()
})

it('refuses mismatched contexts and locates a unique rendered phrase across inline formatting', () => {
  const text = 'First evidence and second evidence.'
  expect(locateQuote(text, { quote: 'evidence and', prefix: 'First ', suffix: ' second evidence.', offset: 6 })).toBe(6)
  expect(locateQuote(text, { quote: 'evidence', prefix: 'second ', suffix: '.', offset: 0 })).toBe(26)
  expect(locateQuote(text, { quote: 'evidence', prefix: 'third ', suffix: '.', offset: 26 })).toBeUndefined()
  expect(locateQuote(text, { quote: '', prefix: '', suffix: '' })).toBeUndefined()
})
