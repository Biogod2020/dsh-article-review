/** Figure navigation stays local; image fitting uses the actual viewport and source aspect ratio. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FigureCompanion } from '../src/client/figure-companion.tsx'
import { en } from '../src/client/locales.ts'
import { parseRevision } from '../src/document.ts'
import { collectFigures } from '../src/figures.ts'
import { readingFigures } from '../src/client/reading-figures.ts'
import type { ReadingFigure } from '../src/client/reading-figures.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const revision = parseRevision('First result.\n\nSecond result.\n\n> **Figure 1** (`one.png`): First caption.\n\n> **Figure 2** (`two.png`): Second caption.')
  const figures = collectFigures(revision.blocks), figure = figures[0]!
  const items = readingFigures('article.md', '', revision, figures, [{ id: 'a', figure: figure.path, figureBlockId: figure.blockId,
    sourceHash: 'a'.repeat(64), sourceFile: 'one.png', file: 'crop-a.png', hash: 'b'.repeat(64), label: 'a', page: 1, region: [0, 0, 1, 1],
    targets: revision.blocks.slice(0, 2).map(block => ({ blockId: block.id, before: block.text })) }])
  const props = { items, selected: items[1], pinned: true, collapsed: false, caption: 'First caption.', onCollapse: vi.fn(),
    onSelect: vi.fn(), onPin: vi.fn(), onOpen: vi.fn(), onLocate: vi.fn(), onViewChange: vi.fn(),
    media: { bytes: vi.fn(async () => new Uint8Array([1])), thumbnail: vi.fn(), signal: new AbortController().signal, sessionId: 'fixture' },
    fullPage: vi.fn(), stale: false, t: (key: keyof typeof en) => en[key] }
  return { props, items, mount: () => render(<FigureCompanion {...props} />) }
}

it('keeps the figure selector short, offers panel shortcuts and moves between parent figures', () => {
  const { props, items, mount } = fixture(); mount()
  const select = screen.getByLabelText(en.readingFigure)
  expect(select.querySelectorAll('option').length).toBe(2)
  expect((select as HTMLSelectElement).value).toBe(items[0]!.key)
  expect(screen.getByRole('button', { name: en.previousFigure }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.showWholeFigure }))
  expect(props.onSelect).toHaveBeenLastCalledWith(items[0]!.key)
  fireEvent.click(screen.getByRole('button', { name: `${en.showPanel} a` }))
  expect(props.onSelect).toHaveBeenLastCalledWith(items[1]!.key)
  fireEvent.click(screen.getByRole('button', { name: en.nextFigure }))
  expect(props.onSelect).toHaveBeenLastCalledWith(items[2]!.key)
  expect(props.onLocate).not.toHaveBeenCalled()
})

it('makes a figure without panels explicit without a permanent AI action', () => {
  const { props, items } = fixture()
  render(<FigureCompanion {...props} selected={items[2] as ReadingFigure} />)
  expect(screen.getByText(en.noFigurePanels)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.showWholeFigure }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: `${en.showPanel} a` })).toBeNull()
  expect(screen.queryByRole('button', { name: en.preparePanels })).toBeNull()
  expect(props.onLocate).not.toHaveBeenCalled()
})

it('fits tall artwork and restores each image’s zoom and pan when switching back', async () => {
  const { props, items, mount } = fixture(), mounted = mount()
  const viewport = document.querySelector<HTMLElement>('[data-companion-file]')!
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 424 }, clientHeight: { configurable: true, value: 324 } })
  fireEvent(window, new Event('resize'))
  const image = await screen.findByRole('img')
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1000 }, naturalHeight: { configurable: true, value: 2000 } })
  fireEvent.load(image)
  expect(image.style.width).toBe('400px')
  expect(screen.getByLabelText(en.figureScale).textContent).toBe(en.figureFitWidth)
  fireEvent.change(screen.getByLabelText(en.figureFitMode), { target: { value: 'window' } })
  expect(image.style.width).toBe('150px')
  fireEvent.click(screen.getByRole('button', { name: en.figureZoomIn }))
  expect(image.style.width).toBe('225px')
  viewport.scrollLeft = 87; viewport.scrollTop = 190
  fireEvent.scroll(viewport)
  fireEvent.click(screen.getByRole('button', { name: en.showWholeFigure }))
  expect(props.onViewChange).toHaveBeenLastCalledWith('crop-a.png', { fit: 'window', zoom: 1.5, left: 87, top: 190 })
  mounted.rerender(<FigureCompanion {...props} selected={items[0] as ReadingFigure} />)
  expect(viewport.scrollLeft).toBe(0); expect(viewport.scrollTop).toBe(0)
  expect(screen.getByRole('button', { name: en.figureZoomOut }).hasAttribute('disabled')).toBe(false)
  await waitFor(() => { expect(props.media.bytes).toHaveBeenLastCalledWith('one.png', expect.any(AbortSignal), 'fixture') })
  mounted.rerender(<FigureCompanion {...props} />)
  const restored = await screen.findByRole('img')
  Object.defineProperties(restored, { naturalWidth: { configurable: true, value: 1000 }, naturalHeight: { configurable: true, value: 2000 } })
  fireEvent.load(restored)
  expect(restored.style.width).toBe('225px')
  expect(viewport.scrollLeft).toBe(87); expect(viewport.scrollTop).toBe(190)
  const views = Object.fromEntries(props.onViewChange.mock.calls)
  mounted.unmount()
  render(<FigureCompanion {...props} views={views} />)
  const reopenedViewport = document.querySelector<HTMLElement>('[data-companion-file]')!
  Object.defineProperties(reopenedViewport, { clientWidth: { configurable: true, value: 424 }, clientHeight: { configurable: true, value: 324 } })
  fireEvent(window, new Event('resize'))
  const reopened = await screen.findByRole('img')
  Object.defineProperties(reopened, { naturalWidth: { configurable: true, value: 1000 }, naturalHeight: { configurable: true, value: 2000 } })
  fireEvent.load(reopened)
  expect(reopened.style.width).toBe('225px')
  expect(reopenedViewport.scrollLeft).toBe(87); expect(reopenedViewport.scrollTop).toBe(190)
})

it('collapses unassociated sections and labels deliberate browsing separately', () => {
  const { props } = fixture(), onBrowse = vi.fn()
  render(<FigureCompanion {...props} selected={undefined} relation="none" section onBrowse={onBrowse} />)
  expect(screen.getByRole('status').textContent).toBe(en.noSectionFigure)
  expect(screen.queryByRole('img')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.browseFigures }))
  expect(onBrowse).toHaveBeenCalledOnce()
})

it('adapts the initial fitting mode for wide artwork without overriding an explicit image choice', async () => {
  const { props, mount } = fixture(), mounted = mount()
  await screen.findByRole('img')
  mounted.rerender(<FigureCompanion {...props} defaultFit="window" />)
  expect((screen.getByLabelText(en.figureFitMode) as HTMLSelectElement).value).toBe('window')
  fireEvent.change(screen.getByLabelText(en.figureFitMode), { target: { value: 'actual' } })
  mounted.rerender(<FigureCompanion {...props} defaultFit="width" />)
  expect((screen.getByLabelText(en.figureFitMode) as HTMLSelectElement).value).toBe('actual')
})

it('lets every associated paragraph be located and exposes the complete caption on demand', () => {
  const { props, items, mount } = fixture(); mount()
  const locate = screen.getByRole('button', { name: en.locatePanelText })
  fireEvent.click(locate); fireEvent.click(locate); fireEvent.click(locate)
  expect(props.onLocate.mock.calls.map(([id]) => id)).toEqual([items[1]!.targets[0], items[1]!.targets[1], items[1]!.targets[0]])
  expect(within(document.querySelector('details')!).getByText('First caption.')).toBeTruthy()
  expect(document.querySelector('details')!.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.collapseFigures }))
  expect(props.onCollapse).toHaveBeenCalledOnce()
})

it('retains the zoom focal point after scrollbars change the viewport size', async () => {
  const { mount } = fixture(); mount()
  const viewport = document.querySelector<HTMLElement>('[data-companion-file]')!
  let width = 424
  Object.defineProperties(viewport, { clientWidth: { configurable: true, get: () => width }, clientHeight: { configurable: true, value: 324 } })
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 324))
  fireEvent(window, new Event('resize'))
  const image = await screen.findByRole('img')
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1000 }, naturalHeight: { configurable: true, value: 2000 } })
  vi.spyOn(image, 'getBoundingClientRect').mockImplementation(() => {
    const w = parseFloat(image.style.width), h = w * 2
    return new DOMRect(12 - viewport.scrollLeft, 12 - viewport.scrollTop, w, h)
  })
  fireEvent.load(image)
  const center = () => { const rect = image.getBoundingClientRect(); return { x: (width / 2 - rect.left) / rect.width, y: (162 - rect.top) / rect.height } }
  const before = center()
  fireEvent.click(screen.getByRole('button', { name: en.figureZoomIn }))
  width = 408; fireEvent(window, new Event('resize'))
  expect(center().x).toBeCloseTo(before.x, 6)
  expect(center().y).toBeCloseTo(before.y, 6)
})

it('retains an actionable retry after media failure', async () => {
  const { props, mount } = fixture()
  props.media.bytes.mockRejectedValueOnce(new Error('offline'))
  mount(); await screen.findByText(en.figureOpenFailed)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(await screen.findByRole('img')).toBeTruthy()
  expect(props.media.bytes).toHaveBeenCalledTimes(2)
})
