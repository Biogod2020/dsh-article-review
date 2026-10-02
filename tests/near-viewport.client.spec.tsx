// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { observeNearViewport, useNearViewport } from '../src/client/near-viewport.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function observers() {
  const created: { callback: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; options: IntersectionObserverInit }[] = []
  class Observer {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn()
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) { created.push({ callback, options, ...this }) }
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  return created
}

it('shares one observer for 1000 blocks and removes it after the final disposal', () => {
  const created = observers()
  const root = document.createElement('article'); root.setAttribute('data-paper-scroll', '')
  const dispose = Array.from({ length: 1000 }, () => {
    const element = document.createElement('p'); root.append(element)
    return observeNearViewport(element, vi.fn(), '600px 0px')
  })
  expect(created).toHaveLength(1)
  expect(created[0]!.observe).toHaveBeenCalledTimes(1000)
  dispose.slice(0, -1).forEach(remove => remove())
  expect(created[0]!.disconnect).not.toHaveBeenCalled()
  dispose.at(-1)!()
  expect(created[0]!.disconnect).toHaveBeenCalledTimes(1)
  const next = observeNearViewport(root.appendChild(document.createElement('p')), vi.fn(), '600px 0px')
  expect(created).toHaveLength(2)
  next()
})

it('keeps scroll roots and preview margins separate and activates each target once', () => {
  const created = observers()
  const first = document.createElement('article'), second = document.createElement('article')
  first.setAttribute('data-paper-scroll', ''); second.setAttribute('data-paper-scroll', '')
  const a = first.appendChild(document.createElement('p')), b = second.appendChild(document.createElement('p'))
  const activate = vi.fn()
  const remove = [observeNearViewport(a, activate, '600px 0px'),
    observeNearViewport(b, vi.fn(), '600px 0px'), observeNearViewport(first.appendChild(document.createElement('img')), vi.fn(), '200px 0px')]
  expect(created).toHaveLength(3)
  created[0]!.callback([{ target: a, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  created[0]!.callback([{ target: a, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  expect(activate).toHaveBeenCalledTimes(1)
  remove.forEach(dispose => dispose())
})

it('renders normally without observer support', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  function Reader() { const ref = useRef<HTMLDivElement>(null); const ready = useNearViewport(ref)
    return <div ref={ref}>{ready ? 'Exact readable text' : 'Placeholder'}</div> }
  render(<Reader />)
  expect(screen.getByText('Exact readable text')).toBeTruthy()
})
