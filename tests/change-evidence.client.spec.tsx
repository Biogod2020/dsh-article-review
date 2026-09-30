// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ChangeEvidence } from '../src/client/change-evidence.tsx'
import { en } from '../src/client/locales.ts'
import type { PaperReviewKey } from '../src/client/locales.ts'
const t = (key: PaperReviewKey) => en[key]
afterEach(cleanup)
it('renders exact escaped before/after evidence, collapsed by default', () => {
  const { container } = render(<ChangeEvidence before="p < 0.05" after="p > 0.05" t={t} />)
  expect(screen.getByText('< 0.05')).toBeTruthy()
  expect(screen.getByText('> 0.05')).toBeTruthy()
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('code')?.title).toBe('2–8')
})
it('explicitly reports truncated evidence and omits unchanged passages', () => {
  const { container, rerender } = render(<ChangeEvidence before={Array.from({ length: 30 }, (_, i) => `${i}`).join('; ')} after="none" t={t} />)
  expect(screen.getByText(/Examples are truncated/)).toBeTruthy()
  rerender(<ChangeEvidence before="Unchanged." after="Unchanged." t={t} />)
  expect(container.querySelector('details')).toBeNull()
})
