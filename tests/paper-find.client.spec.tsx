/** Manuscript find stays in its own pane and highlights rendered words. */
// @vitest-environment jsdom
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PaperBlock } from '../src/schema.ts'
import { PaperFind, findPaperHits, searchableBlocks } from '../src/client/paper-find.tsx'
import { en } from '../src/client/locales.ts'

const blocks: PaperBlock[] = [
  { id: 'source', kind: 'html', section: '', text: '<!-- hidden evidence -->', start: 0, end: 24 },
  { id: 'one', kind: 'paragraph', section: '', text: 'A **paired** image and paired counts.', start: 25, end: 62 },
  { id: 'two', kind: 'paragraph', section: '', text: 'Another paired image.', start: 63, end: 84 },
]

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('indexes rendered words but omits hidden source notes and Markdown punctuation', () => {
  const indexed = searchableBlocks(blocks)
  expect(indexed.map(block => block.text)).toEqual(['A paired image and paired counts.', 'Another paired image.'])
  expect(findPaperHits(indexed, 'PAIRED')).toEqual([
    { blockId: 'one', occurrence: 0 }, { blockId: 'one', occurrence: 1 }, { blockId: 'two', occurrence: 0 },
  ])
  expect(findPaperHits(indexed, 'hidden')).toEqual([])
})

function Harness(): ReactNode {
  const panel = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState('read')
  return <><button data-outside>Outside</button><section ref={panel} tabIndex={-1} data-panel>
    <input aria-label="Manuscript path" />
    <button onClick={() => { setMode('changes') }}>Changes</button>
    <div ref={content} data-scroll><PaperFind panel={panel} content={content} blocks={blocks} mode={mode}
      onRead={() => { setMode('read') }} t={key => en[key]} />
    {mode === 'read' && <>
      <div data-block="one"><div data-reader-text>A <strong>paired</strong> image and paired counts.</div></div>
      <div data-block="two"><div data-reader-text>Another paired image.</div></div>
    </>}
    </div></section></>
}

it('opens only from the review pane, navigates matches, and clears temporary highlights', async () => {
  class TestHighlight { priority = 0; ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges } }
  const highlights = new Map<string, TestHighlight>()
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', { escape: (value: string) => value, highlights })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList)
  render(<Harness />)
  const panel = document.querySelector<HTMLElement>('[data-panel]')!
  screen.getByText('Outside').focus()
  fireEvent.keyDown(document, { key: 'f', metaKey: true })
  expect(screen.queryByRole('search')).toBeNull()
  screen.getByRole('textbox', { name: 'Manuscript path' }).focus()
  fireEvent.keyDown(document, { key: 'f', metaKey: true })
  expect(screen.queryByRole('search')).toBeNull()
  panel.focus()
  fireEvent.keyDown(document, { key: 'f', metaKey: true })
  const input = await screen.findByRole('searchbox', { name: en.find })
  fireEvent.change(input, { target: { value: 'paired' } })
  expect(screen.getByRole('status').textContent).toBe('1/3')
  await waitFor(() => { expect([...highlights.values()].some(value => value.ranges.length === 3)).toBe(true) })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('status').textContent).toBe('2/3')
  fireEvent.click(screen.getByRole('button', { name: en.findPrevious }))
  expect(screen.getByRole('status').textContent).toBe('1/3')
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('search')).toBeNull()
  expect(highlights.size).toBe(0)
  const outside = screen.getByText('Outside')
  outside.focus()
  fireEvent.pointerDown(document.querySelector('[data-reader-text]')!)
  outside.blur()
  fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
  expect(await screen.findByRole('searchbox', { name: en.find })).toBeTruthy()
})

it('switches from change review to manuscript read when finding', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => ({ length: 1 }) as DOMRectList)
  render(<Harness />)
  const changes = screen.getByText('Changes')
  fireEvent.click(changes)
  changes.focus()
  fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
  expect(await screen.findByRole('searchbox', { name: en.find })).toBeTruthy()
  expect(document.querySelector('[data-block="one"]')).toBeTruthy()
})
