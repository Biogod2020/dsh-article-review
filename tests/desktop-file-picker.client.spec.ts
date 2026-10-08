// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { pickDesktopFile } from '../src/client/desktop-file-picker.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('leaves Web on the existing host transport without opening a browser upload dialog', () => {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click')
  expect(pickDesktopFile('.md', new AbortController().signal)).toBeUndefined()
  expect(click).not.toHaveBeenCalled()
})

it('opens synchronously in Desktop and resolves the real host path rather than input fakepath', async () => {
  const file = new File(['# Paper'], '稿件.md')
  const pathFor = vi.fn(() => '/workspace/稿件.md')
  vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor })
  let input: HTMLInputElement | undefined
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { input = this })
  const selected = pickDesktopFile('.md', new AbortController().signal)
  expect(input?.isConnected).toBe(true)
  expect(input?.accept).toBe('.md')
  Object.defineProperty(input!, 'files', { value: [file] })
  input!.dispatchEvent(new Event('change'))
  expect(await selected).toBe('/workspace/稿件.md')
  expect(pathFor).toHaveBeenCalledWith(file)
  expect(input?.isConnected).toBe(false)
})

it.each(['cancel', 'abort'] as const)('settles %s and removes the input without a selection', async (event) => {
  vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor: vi.fn() })
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  const controller = new AbortController()
  const selected = pickDesktopFile('.bib', controller.signal)
  const input = document.querySelector('input')!
  if (event === 'abort') controller.abort()
  else input.dispatchEvent(new Event('cancel'))
  expect(await selected).toBeNull()
  expect(input.isConnected).toBe(false)
})

it('refuses a selected file whose Desktop bridge has no host path and cleans up', async () => {
  vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor: () => '' })
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  const selected = pickDesktopFile('.md', new AbortController().signal)
  const input = document.querySelector('input')!
  Object.defineProperty(input, 'files', { value: [new File(['paper'], 'paper.md')] })
  input.dispatchEvent(new Event('change'))
  await expect(selected).rejects.toThrow('could not resolve')
  expect(input.isConnected).toBe(false)
})
