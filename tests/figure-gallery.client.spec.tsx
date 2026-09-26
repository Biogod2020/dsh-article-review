/** Full-screen figure viewing preserves exact files, supports zoom/pan, and owns media cleanup. */
// @vitest-environment jsdom
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FigureGallery } from '../src/client/figure-gallery.tsx'
import type { PaperFigure } from '../src/client/figures.ts'

const figures: PaperFigure[] = [
  { blockId: 'first', label: 'Figure 1', path: 'figures/a.pdf', file: 'authentic/a.pdf' },
  { blockId: 'second', label: 'Figure 2', path: 'figures/b.pdf', file: 'authentic/b.pdf' },
]
const labels = { figures: 'Figures', pdf: 'PDF', image: 'Image', open: 'Open', close: 'Close figure', loading: 'Loading',
  failed: 'Preview failed', locate: 'Locate caption', native: 'Open complete file', expand: 'Expand figures', collapse: 'Collapse figures',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', actualSize: '100%', previous: 'Previous figure', next: 'Next figure',
  retry: 'Retry', pdfPreview: 'PDF preview: page 1. Open complete file for all pages.', panHint: 'Double-click to zoom; drag to pan.' }
const modalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
const releaseDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 0 }
  })
})

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const [name, descriptor] of [['showModal', modalDescriptor]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name)
  }
  for (const [name, descriptor] of [['setPointerCapture', captureDescriptor], ['releasePointerCapture', releaseDescriptor]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
})

function props(overrides: Partial<ComponentProps<typeof FigureGallery>> = {}): ComponentProps<typeof FigureGallery> {
  return { figures, manuscript: 'article.md', base: '', sessionId: 'gallery-fixture', signal: new AbortController().signal,
    thumbnail: vi.fn(async () => 'data:image/png;base64,thumbnail'), fullPage: vi.fn(async path => `data:image/png;base64,${path}`),
    bytes: vi.fn(async () => new Uint8Array([1, 2, 3])), selected: figures[0], onSelect: vi.fn(),
    onLocate: vi.fn(), onNative: vi.fn(), labels, ...overrides }
}

function Controlled({ initial, ...rest }: { initial?: PaperFigure } & Omit<ComponentProps<typeof FigureGallery>, 'selected'>) {
  const [selected, setSelected] = useState(initial)
  return <FigureGallery {...rest} selected={selected} onSelect={(figure) => { rest.onSelect(figure); setSelected(figure) }} />
}

async function image(label = 'Figure 1'): Promise<HTMLImageElement> {
  const node = await screen.findByRole<HTMLImageElement>('img', { name: label })
  Object.defineProperties(node, { naturalWidth: { configurable: true, value: 2000 }, naturalHeight: { configurable: true, value: 1200 } })
  fireEvent.load(node)
  return node
}

function deferred<T>() {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => { settle = resolve })
  return { promise, settle }
}

it('fits native pixels, zooms with controls and double click, and drags a magnified figure', async () => {
  render(<FigureGallery {...props()} />)
  const node = await image()
  const dialog = screen.getByRole('dialog')
  const viewport = document.querySelector<HTMLElement>('[data-figure-viewport]')
  if (!viewport) throw new Error('Figure viewport missing')
  expect(node.style.transform).toContain('scale(0.4)')
  expect(within(dialog).getByRole('status').textContent).toBe('40%')
  fireEvent.click(within(dialog).getByRole('button', { name: labels.actualSize }))
  expect(node.style.transform).toContain('scale(1)')
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 300, clientY: 200 })
  fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 420, clientY: 250 })
  expect(node.style.transform).toContain('translate3d(120px, 50px, 0)')
  fireEvent.pointerUp(viewport, { pointerId: 4 })
  fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 480, clientY: 300 })
  expect(node.style.transform).toContain('translate3d(120px, 50px, 0)')
  fireEvent.click(within(dialog).getByRole('button', { name: labels.zoomIn }))
  expect(node.style.transform).toContain('scale(1.5)')
  fireEvent.click(within(dialog).getByRole('button', { name: labels.zoomOut }))
  expect(node.style.transform).toContain('scale(1)')
  fireEvent.click(within(dialog).getByRole('button', { name: labels.fit }))
  expect(node.style.transform).toContain('translate3d(0px, 0px, 0) scale(0.4)')
  fireEvent.doubleClick(viewport)
  expect(node.style.transform).toContain('scale(1)')
  fireEvent.doubleClick(viewport)
  expect(node.style.transform).toContain('scale(0.4)')
  expect(dialog.textContent).toMatchSnapshot()
})

it('navigates adjacent figures with buttons and arrows, opens the exact complete PDF, and closes', async () => {
  const config = props()
  render(<Controlled {...config} initial={figures[0]} />)
  await image()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: labels.previous }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: labels.next }))
  await image('Figure 2')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: labels.next }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: labels.native }))
  expect(config.onNative).toHaveBeenCalledWith(figures[1])
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' })
  await image()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
  await image('Figure 2')
  expect(screen.getByText(labels.pdfPreview)).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: '1' })
  expect(screen.getByRole<HTMLImageElement>('img', { name: 'Figure 2' }).style.transform).toContain('scale(1)')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: '0' })
  expect(screen.getByRole<HTMLImageElement>('img', { name: 'Figure 2' }).style.transform).toContain('scale(0.4)')
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(config.onSelect).toHaveBeenLastCalledWith(undefined)
})

it('retries a failed PDF preview at the same pinned file, then reuses it after closing', async () => {
  const fullPage = vi.fn<ComponentProps<typeof FigureGallery>['fullPage']>()
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValue('data:image/png;base64,recovered')
  const config = props({ fullPage })
  const rendered = render(<FigureGallery {...config} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('dialog').textContent).toMatchSnapshot('failed PDF preview')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: labels.retry }))
  await image()
  expect(fullPage.mock.calls.map(call => call[0])).toEqual(['authentic/a.pdf', 'authentic/a.pdf'])
  rendered.rerender(<FigureGallery {...config} selected={undefined} />)
  rendered.rerender(<FigureGallery {...config} selected={{ ...figures[0] }} figures={figures.map(figure => ({ ...figure }))} />)
  await image()
  expect(fullPage).toHaveBeenCalledTimes(2)
  expect(config.thumbnail).toHaveBeenCalledTimes(1)
})

it('retries a failed dock thumbnail without changing its version', async () => {
  const thumbnail = vi.fn<ComponentProps<typeof FigureGallery>['thumbnail']>()
    .mockResolvedValueOnce(undefined).mockResolvedValue('data:image/png;base64,recovered')
  render(<FigureGallery {...props({ thumbnail, selected: undefined })} />)
  fireEvent.click(await screen.findByRole('button', { name: `${labels.retry} Figure 1` }))
  await waitFor(() => { expect(document.querySelector('aside img')?.getAttribute('src')).toBe('data:image/png;base64,recovered') })
  expect(thumbnail.mock.calls.map(call => call[0])).toEqual(['authentic/a.pdf', 'authentic/a.pdf'])
})

it('keeps unchanged figure data warm but reads a changed pinned file instead of a previous version', async () => {
  const config = props()
  const rendered = render(<FigureGallery {...config} />)
  await image()
  rendered.rerender(<FigureGallery {...config} selected={{ ...figures[0] }} figures={figures.map(figure => ({ ...figure }))} />)
  await image()
  expect(config.fullPage).toHaveBeenCalledTimes(1)
  expect(config.thumbnail).toHaveBeenCalledTimes(1)
  const replacement = { ...figures[0], file: 'authentic/new-a.pdf' }
  rendered.rerender(<FigureGallery {...config} figures={[replacement, figures[1]]} selected={replacement} />)
  await waitFor(() => { expect(screen.getByRole('img', { name: 'Figure 1' }).getAttribute('src')).toBe('data:image/png;base64,authentic/new-a.pdf') })
  expect(vi.mocked(config.fullPage).mock.calls.map(call => call[0])).toEqual(['authentic/a.pdf', 'authentic/new-a.pdf'])
})

it('aborts obsolete full-page reads and ignores a late response after navigating', async () => {
  const old = deferred<string | undefined>()
  const fullPage = vi.fn<ComponentProps<typeof FigureGallery>['fullPage']>()
    .mockReturnValueOnce(old.promise).mockResolvedValue('data:image/png;base64,newer')
  const config = props({ fullPage })
  const rendered = render(<FigureGallery {...config} />)
  expect(screen.getByText(labels.loading)).toBeTruthy()
  rendered.rerender(<FigureGallery {...config} selected={figures[1]} />)
  await image('Figure 2')
  expect(fullPage.mock.calls[0][1].aborted).toBe(true)
  await act(async () => { old.settle('data:image/png;base64,obsolete'); await old.promise })
  expect(screen.getByRole('img', { name: 'Figure 2' }).getAttribute('src')).toBe('data:image/png;base64,newer')
})

it('aborts a pending full-page request when the viewer is closed', async () => {
  const pageRead = deferred<string | undefined>()
  const fullPage = vi.fn<ComponentProps<typeof FigureGallery>['fullPage']>().mockReturnValue(pageRead.promise)
  const config = props({ fullPage })
  render(<Controlled {...config} initial={figures[0]} />)
  fireEvent.click(screen.getByRole('button', { name: labels.close }))
  expect(fullPage.mock.calls[0][1].aborted).toBe(true)
  await act(async () => { pageRead.settle('data:image/png;base64,late'); await pageRead.promise })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('opens a historical snapshot without preloading or navigating to the current authentic version', async () => {
  const snapshot = { ...figures[0], file: 'review-assets/historical-a.pdf' }
  const config = props({ selected: snapshot, showDock: false })
  render(<FigureGallery {...config} />)
  await image()
  expect(vi.mocked(config.fullPage).mock.calls.map(call => call[0])).toEqual(['review-assets/historical-a.pdf'])
  expect(config.thumbnail).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: labels.previous }).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: labels.next }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: labels.native }))
  expect(config.onNative).toHaveBeenCalledWith(snapshot)
})

it('aborts pending thumbnail and full-page reads on unmount without adopting their late results', async () => {
  const thumbnailRead = deferred<string | undefined>(), pageRead = deferred<string | undefined>()
  const thumbnail = vi.fn<ComponentProps<typeof FigureGallery>['thumbnail']>().mockReturnValue(thumbnailRead.promise)
  const fullPage = vi.fn<ComponentProps<typeof FigureGallery>['fullPage']>().mockReturnValue(pageRead.promise)
  const rendered = render(<FigureGallery {...props({ thumbnail, fullPage })} />)
  await waitFor(() => { expect(thumbnail).toHaveBeenCalledTimes(1) })
  rendered.unmount()
  expect(thumbnail.mock.calls[0][1].aborted).toBe(true)
  expect(fullPage.mock.calls[0][1].aborted).toBe(true)
  await act(async () => {
    thumbnailRead.settle('data:image/png;base64,late'); pageRead.settle('data:image/png;base64,late')
    await Promise.all([thumbnailRead.promise, pageRead.promise])
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('shares one binary read between the dock and modal, retries decode failure, and revokes owned URLs', async () => {
  const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const figure = { ...figures[0], file: 'authentic/a.png', path: 'figures/a.png' }
  const config = props({ figures: [figure], selected: figure })
  const rendered = render(<FigureGallery {...config} />)
  const first = await image()
  expect(config.bytes).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
  fireEvent.error(first)
  await screen.findByRole('alert')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: labels.retry }))
  await waitFor(() => { expect(screen.getByRole('img', { name: 'Figure 1' }).getAttribute('src')).toBe('blob:second') })
  expect(config.bytes).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: `${labels.retry} Figure 1` })).toBeNull()
  expect(revoke).toHaveBeenCalledWith('blob:first')
  rendered.unmount()
  expect(revoke).toHaveBeenCalledWith('blob:second')
})

it('does not create an owned URL from a binary response that completes after unmount', async () => {
  const create = vi.fn(), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const data = deferred<Uint8Array>()
  const bytes = vi.fn<ComponentProps<typeof FigureGallery>['bytes']>().mockReturnValue(data.promise)
  const figure = { ...figures[0], file: 'authentic/a.png', path: 'figures/a.png' }
  const rendered = render(<FigureGallery {...props({ figures: [figure], selected: figure, bytes })} />)
  await waitFor(() => { expect(bytes).toHaveBeenCalledTimes(1) })
  rendered.unmount()
  expect(bytes.mock.calls[0][1].aborted).toBe(true)
  await act(async () => { data.settle(new Uint8Array([1, 2, 3])); await data.promise })
  expect(create).not.toHaveBeenCalled()
  expect(revoke).not.toHaveBeenCalled()
})
