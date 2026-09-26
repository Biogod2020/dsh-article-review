/** The minimap exposes headings first and lets the entire collapsed track open its outline. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { ReviewProgress } from '../src/client/review-progress.tsx'
import { reviewNavigation } from '../src/client/review-navigation.ts'
import { en } from '../src/client/locales.ts'

const source = '# Paper\n\nOpening context.\n\n## Methods\n\nMethods context.\n\n### Screening Reference\n\nClass A uses direct imaging.\n\n## Results\n\nThe evaluation was retrospective.'
const blocks = parseRevision(source).blocks

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('builds source-order locations and nested heading ranges', () => {
  const navigation = reviewNavigation(blocks)
  const root = navigation.entries[0]
  expect(root?.type).toBe('section')
  if (root?.type !== 'section') return
  expect(root.title).toBe('Paper')
  expect(root.end).toBe(blocks.length)
  expect(root.entries.filter(entry => entry.type === 'section').map(entry => entry.title)).toEqual(['Methods', 'Results'])
  const methods = root.entries.find(entry => entry.type === 'section' && entry.title === 'Methods')
  if (methods?.type !== 'section') return
  expect(methods.end).toBe(blocks.findIndex(block => block.text === '## Results'))
  expect(methods.entries.find(entry => entry.type === 'section' && entry.title === 'Screening Reference')).toBeTruthy()
  expect(navigation.locations.get(blocks[5]?.id ?? '')).toEqual({ index: 5, total: blocks.length,
    headings: ['Paper', 'Methods', 'Screening Reference'] })
})

it('opens from a click anywhere on the minimap and progressively discloses paragraphs', () => {
  const jump = vi.fn()
  render(<ReviewProgress blocks={blocks} baselines={[]} jump={jump} t={key => en[key]} />)
  const track = document.querySelector('[data-progress-track]')
  expect(track).toBeTruthy()
  fireEvent.click(track as Element)
  expect(screen.getByRole('navigation', { name: en.progressOutline })).toBeTruthy()
  expect(screen.getByRole('button', { name: `${en.progressUnfoldSection} Methods` })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Class A uses direct imaging/ })).toBeNull()
  expect({ toggle: en.progressExpand, outline: screen.getByRole('navigation', { name: en.progressOutline }).textContent,
    actions: [en.progressExpandAll, en.progressCollapseAll] }).toMatchSnapshot('collapsed sections in the manuscript outline')
  fireEvent.click(screen.getByRole('button', { name: `${en.progressUnfoldSection} Methods` }))
  fireEvent.click(screen.getByRole('button', { name: `${en.progressUnfoldSection} Screening Reference` }))
  fireEvent.click(screen.getByRole('button', { name: /Class A uses direct imaging/ }))
  expect(jump).toHaveBeenCalledWith(blocks[5])
  expect(screen.queryByRole('navigation', { name: en.progressOutline })).toBeNull()
  fireEvent.click(document.querySelector('[data-progress-track]') as Element)
  fireEvent.click(screen.getByRole('button', { name: en.progressCollapseAll }))
  expect(screen.queryByRole('button', { name: /Class A uses direct imaging/ })).toBeNull()
})
