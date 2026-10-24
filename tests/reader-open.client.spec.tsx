/** Automatic reader opening respects session focus, dismissal and idle polling. */
// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderOpen } from '../src/client/reader-open.tsx'
import type { ReaderOpenProps } from '../src/client/reader-open.tsx'
afterEach(() => { cleanup(); sessionStorage.clear() })
it('reveals once for its mounted session and does not reopen a dismissed tab', async () => {
  const request = vi.fn(async () => ({ requestId: 'one', path: 'papers/new/article.md' })), reveal = vi.fn()
  const props = { sessionId: 'import-test', useSession: () => false,
    mounted: { subscribe: () => () => {}, getSnapshot: () => 'import-test' }, request, reveal } as unknown as ReaderOpenProps
  const first = render(<ReaderOpen {...props} />)
  await waitFor(() => { expect(reveal).toHaveBeenCalledOnce() })
  expect(reveal).toHaveBeenCalledWith('import-test', { requestId: 'one', path: 'papers/new/article.md' })
  first.unmount(); render(<ReaderOpen {...props} />)
  await waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
  expect(reveal).toHaveBeenCalledOnce()
})
it('never checks or reveals a background conversation', () => {
  const request = vi.fn(), reveal = vi.fn()
  render(<ReaderOpen {...{ sessionId: 'background', useSession: () => true,
    mounted: { subscribe: () => () => {}, getSnapshot: () => 'foreground' }, request, reveal } as unknown as ReaderOpenProps} />)
  expect(request).not.toHaveBeenCalled(); expect(reveal).not.toHaveBeenCalled()
})
