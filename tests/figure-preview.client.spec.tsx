/** Small figure previews load on demand and expose explicit image-replacement actions. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FigurePreview } from '../src/client/figure-preview.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const figure = { blockId: 'block', label: 'Figure 2', path: 'figures/a.pdf' }

it('loads a thumbnail, opens its exact workspace file, and can collapse it', async () => {
  const thumbnail = vi.fn(async () => 'data:image/png;base64,AAAA')
  const onOpen = vi.fn(), onReplace = vi.fn()
  const { container } = render(<FigurePreview figure={figure} file="package/figures/a.pdf"
    media={{ thumbnail, bytes: vi.fn(), signal: new AbortController().signal, sessionId: 'fixture' }}
    t={key => en[key]} onOpen={onOpen} onReplace={onReplace} />)
  await screen.findByAltText('Figure 2')
  expect(container.textContent).toMatchSnapshot()
  fireEvent.click(screen.getByRole('button', { name: `${en.openFigure} Figure 2` }))
  expect(onOpen).toHaveBeenCalledWith({ ...figure, file: 'package/figures/a.pdf' })
  fireEvent.click(screen.getByRole('button', { name: en.replaceFigure }))
  expect(onReplace).toHaveBeenCalledWith(figure)
  fireEvent.click(screen.getByRole('button', { name: /Figure preview/ }))
  expect(screen.queryByAltText('Figure 2')).toBeNull()
  expect(thumbnail).toHaveBeenCalledTimes(1)
})

it('shows a visible failure when a figure cannot be previewed', async () => {
  render(<FigurePreview figure={figure} file="missing.pdf" media={{ thumbnail: async () => undefined,
    bytes: vi.fn(), signal: new AbortController().signal, sessionId: 'fixture' }} t={key => en[key]} onOpen={vi.fn()} />)
  await waitFor(() => { expect(screen.getByText(en.figureOpenFailed)).toBeTruthy() })
})
