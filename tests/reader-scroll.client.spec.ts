/** Reader jumps settle after lazy content mounts and release temporary observers. */
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { capturePaperPosition, restorePaperPosition, revealPaperTarget, scrollPaperTarget } from '../src/client/reader-scroll.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function viewportFixture(lazy = true) {
  const viewport = document.createElement('div')
  const target = document.createElement('div')
  const placeholder = document.createElement('div')
  placeholder.dataset.readerPlaceholder = ''
  if (lazy) target.append(placeholder)
  viewport.append(target); document.body.append(viewport)
  target.dataset.block = 'reading-anchor'
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  let sourceTop = 700
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 500, 600))
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, sourceTop - viewport.scrollTop, 500, 100))
  const scroll = vi.fn((options: ScrollToOptions) => { viewport.scrollTop = options.top ?? 0 })
  viewport.scrollTo = scroll
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  return { viewport, target, placeholder, scroll, frames,
    move: (top: number) => { sourceTop = top },
    flush: () => { for (const [id, callback] of frames) { frames.delete(id); callback(0) } } }
}

it('scrolls its own viewport instantly and corrects the anchor after lazy Markdown changes heights', async () => {
  const fixture = viewportFixture()
  const release = revealPaperTarget(fixture.viewport, fixture.target)
  expect(fixture.scroll).toHaveBeenLastCalledWith({ top: 580, behavior: 'instant' })
  fixture.move(520)
  fixture.placeholder.replaceWith(document.createTextNode('The exact anchor has rendered.'))
  await Promise.resolve()
  fixture.flush()
  expect(fixture.scroll).toHaveBeenLastCalledWith({ top: 400, behavior: 'instant' })
  expect(fixture.target.getBoundingClientRect().top).toBe(120)
  fixture.target.append(document.createElement('span'))
  await Promise.resolve()
  expect(fixture.frames.size).toBe(0)
  release()
})

it('cancels a queued correction when another navigation takes over', async () => {
  const fixture = viewportFixture()
  const release = revealPaperTarget(fixture.viewport, fixture.target)
  fixture.placeholder.remove()
  await Promise.resolve()
  expect(fixture.frames.size).toBe(1)
  release()
  fixture.flush()
  expect(fixture.scroll).toHaveBeenCalledTimes(1)
})

it('does not keep watching an already rendered target', async () => {
  const fixture = viewportFixture(false)
  const release = revealPaperTarget(fixture.viewport, fixture.target)
  fixture.target.append(document.createElement('p'))
  await Promise.resolve()
  expect(fixture.frames.size).toBe(0)
  release()
})

it('uses the target fallback when the viewport has no measurable layout', () => {
  const viewport = document.createElement('div')
  const target = document.createElement('div')
  const scroll = vi.fn()
  target.scrollIntoView = scroll
  scrollPaperTarget(viewport, target)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
})

it('restores the same paragraph offset after preceding lazy blocks change height', async () => {
  const fixture = viewportFixture()
  fixture.viewport.scrollTop = 740
  const position = capturePaperPosition(fixture.viewport)
  expect(position).toEqual({ top: 740, anchor: { blockId: 'reading-anchor', offset: -40 } })
  fixture.viewport.scrollTop = 0
  fixture.move(960)
  const release = restorePaperPosition(fixture.viewport, position)
  expect(fixture.viewport.scrollTop).toBe(1000)
  fixture.move(870)
  fixture.placeholder.replaceWith(document.createTextNode('The paragraph has rendered.'))
  await Promise.resolve(); fixture.flush()
  expect(fixture.viewport.scrollTop).toBe(910)
  expect(fixture.target.getBoundingClientRect().top).toBe(-40)
  fixture.move(810)
  fixture.viewport.prepend(document.createElement('p'))
  await Promise.resolve(); fixture.flush()
  expect(fixture.viewport.scrollTop).toBe(850)
  expect(fixture.target.getBoundingClientRect().top).toBe(-40)
  release()
})

it('falls back to pixels when the saved block is missing and keeps the document start at zero', () => {
  const fixture = viewportFixture(false)
  fixture.viewport.scrollTop = 85
  restorePaperPosition(fixture.viewport, { top: 360, anchor: { blockId: 'removed', offset: -12 } })()
  expect(fixture.viewport.scrollTop).toBe(360)
  fixture.viewport.scrollTop = 0
  expect(capturePaperPosition(fixture.viewport)).toEqual({ top: 0 })
})

it('captures a late reading anchor without measuring every preceding block', () => {
  const viewport = document.createElement('div')
  document.body.append(viewport)
  viewport.scrollTop = 75025
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 600))
  const measure = vi.fn((index: number) => new DOMRect(0, index * 100 - viewport.scrollTop, 500, 100))
  for (let index = 0; index < 1000; index += 1) {
    const block = document.createElement('div')
    block.dataset.block = `paragraph-${index}`
    vi.spyOn(block, 'getBoundingClientRect').mockImplementation(() => measure(index))
    viewport.append(block)
  }
  expect(capturePaperPosition(viewport)).toEqual({ top: 75025, anchor: { blockId: 'paragraph-750', offset: -25 } })
  expect(measure.mock.calls.length).toBeLessThan(20)
})

it('does not override manual scrolling while restoration is still settling', async () => {
  const fixture = viewportFixture()
  const release = restorePaperPosition(fixture.viewport, { top: 740, anchor: { blockId: 'reading-anchor', offset: -40 } })
  fixture.placeholder.remove()
  await Promise.resolve()
  fixture.viewport.dispatchEvent(new WheelEvent('wheel'))
  fixture.viewport.scrollTop = 1100
  fixture.flush()
  expect(fixture.viewport.scrollTop).toBe(1100)
  release()
})
