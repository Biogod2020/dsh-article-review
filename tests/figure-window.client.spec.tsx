/** Floating artwork remains reachable after resize and supports keyboard movement. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { FigureWindow, fitFigureWindow, initialFigureWindow, resizeFigureWindow } from '../src/client/figure-window.tsx'
import type { FigureResizeEdge } from '../src/client/figure-window.tsx'
import { en } from '../src/client/locales.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('constrains saved windows and anchored previews to both narrow and resized readers', () => {
  for (const bounds of [{ width: 320, height: 500 }, { width: 1280, height: 720 }, { width: 180, height: 180 }, { width: 575, height: 900, top: 84 }]) {
    for (const rect of [fitFigureWindow({ x: 900, y: 700, width: 700, height: 650 }, bounds), initialFigureWindow(bounds, { x: 260, y: 430, width: 35, height: 25 }, true)]) {
      expect(rect.x).toBeGreaterThanOrEqual(8); expect(rect.y).toBeGreaterThanOrEqual(('top' in bounds ? bounds.top : 0) + 8)
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width - 8)
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height - 8)
    }
  }
})
it('moves and resizes by keyboard, saves the result, and closes on Escape', async () => {
  const onChange = vi.fn(), onClose = vi.fn()
  render(<FigureWindow id="test-window" preview={false} bounds={{ width: 1200, height: 800 }} saved={{ x: 100, y: 100, width: 500, height: 400 }}
    onChange={onChange} onClose={onClose} onDock={vi.fn()} onOpen={vi.fn()} onEnter={vi.fn()} onLeave={vi.fn()} label="Figure 1" t={key => en[key]}><p>Artwork</p></FigureWindow>)
  fireEvent.keyDown(screen.getByRole('button', { name: en.moveFigureWindow }), { key: 'ArrowRight' })
  fireEvent.keyDown(screen.getByRole('button', { name: en.resizeFigureWindow }), { key: 'ArrowDown' })
  await waitFor(() => { expect(onChange).toHaveBeenLastCalledWith({ x: 120, y: 100, width: 500, height: 420 }) })
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce()
})
it('resizes from every edge and corner while preserving the opposite edges at limits', () => {
  const start = { x: 200, y: 180, width: 500, height: 400 }, bounds = { width: 1200, height: 900, top: 80 }
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as FigureResizeEdge[]) {
    const next = resizeFigureWindow(start, bounds, edge, -80, -60)
    expect(next.x).toBe(edge.includes('w') ? 120 : 200)
    expect(next.y).toBe(edge.includes('n') ? 120 : 180)
    expect(next.width).toBe(edge.includes('w') ? 580 : edge.includes('e') ? 420 : 500)
    expect(next.height).toBe(edge.includes('n') ? 460 : edge.includes('s') ? 340 : 400)
    for (const distance of [-9999, 9999]) {
      const limited = resizeFigureWindow(start, bounds, edge, distance, distance)
      expect(limited.width).toBeGreaterThanOrEqual(300); expect(limited.height).toBeGreaterThanOrEqual(240)
      expect(limited.x).toBeGreaterThanOrEqual(8); expect(limited.y).toBeGreaterThanOrEqual(88)
      expect(limited.x + limited.width).toBeLessThanOrEqual(1192); expect(limited.y + limited.height).toBeLessThanOrEqual(892)
      if (edge.includes('w')) expect(limited.x + limited.width).toBe(700)
      if (edge.includes('n')) expect(limited.y + limited.height).toBe(580)
    }
  }
})
it('keeps pointer capture and geometry when dragging a peek into a persistent window', async () => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 0 }
  })
  const onChange = vi.fn()
  function Host() {
    const [preview, setPreview] = useState(true)
    return <FigureWindow id="preview-window" preview={preview} anchor={{ x: 50, y: 100, width: 35, height: 20 }}
      bounds={{ width: 1200, height: 900 }} saved={{ x: 100, y: 100, width: 500, height: 400 }} onChange={onChange}
      onClose={vi.fn()} onDock={vi.fn()} onOpen={() => { setPreview(false) }} onEnter={vi.fn()} onLeave={vi.fn()} label="Figure 1" t={key => en[key]}><p>Artwork</p></FigureWindow>
  }
  render(<Host />)
  const window = screen.getByRole('dialog'), resize = screen.getByRole('button', { name: en.resizeFigureWindow })
  const capture = vi.fn(), release = vi.fn()
  Object.assign(resize, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release })
  expect(window.style.width).toBe('500px')
  fireEvent.pointerDown(resize, { pointerId: 7, button: 0, clientX: 595, clientY: 500 })
  expect(window.dataset.figureWindow).toBe('floating')
  expect(screen.getByRole('button', { name: en.resizeFigureWindow })).toBe(resize)
  expect(window.style.left).toBe('95px'); expect(window.style.top).toBe('100px')
  fireEvent.pointerMove(resize, { pointerId: 7, clientX: 725, clientY: 580 })
  fireEvent.pointerUp(resize, { pointerId: 7, clientX: 725, clientY: 580 })
  expect(window.style.width).toBe('630px'); expect(window.style.height).toBe('480px')
  expect(capture).toHaveBeenCalledWith(7); expect(release).toHaveBeenCalledWith(7)
  await waitFor(() => { expect(onChange).toHaveBeenLastCalledWith({ x: 95, y: 100, width: 630, height: 480 }) })
})
it('uses remembered dimensions for a fresh hover without reusing the previous anchor', () => {
  const bounds = { width: 1500, height: 1000 }, size = { width: 720, height: 460 }
  const next = initialFigureWindow(bounds, { x: 40, y: 200, width: 25, height: 20 }, true, size)
  expect(next).toEqual({ x: 75, y: 200, ...size })
  const centered = initialFigureWindow({ width: 1000, height: 900 }, { x: 800, y: 450, width: 25, height: 20 }, true, { width: 720, height: 600 })
  expect(centered.width).toBe(720); expect(centered.height).toBe(600)
  expect(centered.y).toBeGreaterThanOrEqual(8); expect(centered.y + centered.height).toBeLessThanOrEqual(892)
})
