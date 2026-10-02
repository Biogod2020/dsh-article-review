// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderText } from '../src/client/reader-text.tsx'
import type { PaperBlock } from '../src/schema.ts'

const citations = vi.hoisted(() => vi.fn((text: string) => text))
vi.mock('../src/client/citation-display.ts', () => ({ displayCitations: citations }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('defers citation formatting and Markdown until a distant block approaches the viewport', () => {
  let notify: IntersectionObserverCallback | undefined
  let target: Element | undefined
  class Observer {
    constructor(callback: IntersectionObserverCallback) { notify = callback }
    observe(element: Element): void { target = element }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  const block: PaperBlock = { id: 'b', kind: 'paragraph', section: '', text: 'Exact **readable** source.', start: 0, end: 26 }
  const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
  const { container } = render(<ReaderText block={block} labels={labels} highlights={[]} annotations={[]} />)
  expect(citations).not.toHaveBeenCalled()
  expect(container.querySelector('[data-reader-placeholder]')).toBeTruthy()
  act(() => notify!([{ target: target!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
  expect(citations).toHaveBeenCalledTimes(1)
  expect(container.querySelector('strong')?.textContent).toBe('readable')
  expect(container.querySelector('[data-reader-placeholder]')).toBeNull()
})
