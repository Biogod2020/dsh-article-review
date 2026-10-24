/** Printed citations remain selectable while exposing pointer and keyboard artwork navigation. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { collectFigures } from '../src/figures.ts'
import { figureReferences, readingFigures } from '../src/client/reading-figures.ts'
import { FigureReferences, referenceRanges } from '../src/client/figure-references.tsx'
import { captureSelection } from '../src/client/selection.ts'

function fixture() {
  const revision = parseRevision('Results.\n\n> **Figure 1** (`one.png`): Caption.\n\n> **Figure 10** (`ten.png`): Other.\n\n> **Figure S1** (`supp.png`): Supplemental.')
  const figures = collectFigures(revision.blocks), figure = figures[0]!
  return readingFigures('article.md', '', revision, figures, ['a', 'b', 'c'].map(label => ({ id: label, figure: 'one.png', figureBlockId: figure.blockId, label,
    sourceHash: 'a'.repeat(64), sourceFile: 'one.png', file: `${label}.png`, hash: 'b'.repeat(64), page: 1, region: [0, 0, 1, 1],
    targets: [{ blockId: revision.blocks[0]!.id, before: revision.blocks[0]!.text }] })))
}
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('matches exact panels, abbreviated lists, supplemental figures and whole-figure fallbacks', () => {
  const items = fixture(), text = 'Figure 1a,b; Fig. 10; Figures 1c and 10; Figure S1. Figure 1z. Figure 100.'
  expect(figureReferences(text, items).map(ref => [text.slice(ref.start, ref.end), ref.item.file])).toEqual([
    ['Figure 1a', 'a.png'], ['b', 'b.png'], ['Fig. 10', 'ten.png'], ['Figures 1c', 'c.png'], ['10', 'ten.png'], ['Figure S1', 'supp.png'], ['Figure 1z', 'one.png'],
  ])
  expect(figureReferences('Fig. 1a–c', items).map(ref => ref.item.file)).toEqual(['one.png'])
  expect(figureReferences('Figure 1a2 and configuration 10', items)).toEqual([])
})
it('resolves split inline markup and skips code, math and existing links without replacing nodes', () => {
  const node = document.createElement('div')
  node.innerHTML = '<p>See Figure <em>1a</em>, <code>Figure 1b</code>, <a href="https://example.com">Figure 1c</a> and <span class="katex">Figure 1a</span>.</p>'
  const original = node.querySelector('em')!.firstChild
  expect(referenceRanges(node, fixture()).map(ref => ref.range.toString())).toEqual(['Figure 1a'])
  expect(node.querySelector('em')!.firstChild).toBe(original)
})
it('uses the printed text for hover and click, preserves selections and keeps keyboard controls in the same bounds', () => {
  vi.stubGlobal('ResizeObserver', undefined); vi.stubGlobal('PointerEvent', MouseEvent)
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(20, 10, 60, 20)] })
  const actions = { items: fixture(), windowId: 'figure-window', onPreview: vi.fn(), onLeave: vi.fn(), onOpen: vi.fn() }
  const select = vi.fn(), text = 'Read Fig. 1a in context.'
  const { container } = render(<div data-reader-text onMouseUp={select}><FigureReferences actions={actions}><p>{text}</p></FigureReferences></div>)
  const wrapper = container.querySelector<HTMLElement>('[data-inline-figures]')!, paragraph = wrapper.querySelector('p')!, original = paragraph.firstChild
  expect(wrapper.textContent).toBe(text)
  fireEvent.pointerMove(paragraph, { clientX: 30, clientY: 15 })
  expect(actions.onPreview).toHaveBeenCalledWith('panel:a', screen.getByRole('button', { name: 'Fig. 1a' }), undefined)
  fireEvent.mouseUp(paragraph, { clientX: 30, clientY: 15 }); expect(select).not.toHaveBeenCalled()
  fireEvent.click(paragraph, { clientX: 30, clientY: 15 }); expect(actions.onOpen).toHaveBeenCalledOnce()
  const range = document.createRange(); range.setStart(original!, 5); range.setEnd(original!, 12); window.getSelection()!.addRange(range)
  fireEvent.mouseUp(paragraph, { clientX: 30, clientY: 15 }); fireEvent.click(paragraph, { clientX: 30, clientY: 15 })
  expect(select).toHaveBeenCalledOnce(); expect(actions.onOpen).toHaveBeenCalledOnce()
  expect(captureSelection(container.querySelector('[data-reader-text]')!)?.quote).toBe('Fig. 1a')
  expect(paragraph.firstChild).toBe(original)
  window.getSelection()!.removeAllRanges()
  fireEvent.focus(screen.getByRole('button', { name: 'Fig. 1a' }))
  expect(actions.onPreview).toHaveBeenLastCalledWith('panel:a', expect.any(HTMLElement), 'focus')
  fireEvent.click(screen.getByRole('button', { name: 'Fig. 1a' })); expect(actions.onOpen).toHaveBeenCalledTimes(2)
})
