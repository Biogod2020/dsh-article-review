/** Readable Markdown stays complete while the exact source diff remains inspectable. */
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WordDiff } from '../src/client/panel.tsx'
import { en, zh } from '../src/client/locales.ts'

it.each([en, zh])('offers complete before and after text for a reordered sentence', (copy) => {
  const before = 'Resolving identities is **central** to reusing samples.'
  const after = 'Reusing samples requires resolving identities.'
  const html = renderToStaticMarkup(<WordDiff before={before} after={after}
    labels={{ compare: copy.compare, before: copy.before, after: copy.after }}
    markdownLabels={{ code: { copyLabel: copy.copy, copiedLabel: copy.copied }, footnotes: copy.footnotes }} />)
  expect(html).toContain('<strong>central</strong>')
  expect(html).toContain(`<p>${after}</p>`)
  expect(html).not.toContain('<ins')
  expect(html).not.toContain('<del')
  expect(html.replace(/ class="[^"]*"/g, '')).toMatchSnapshot()
})

it.each([en, zh])('shows a new paragraph without an empty comparison column', (copy) => {
  const html = renderToStaticMarkup(<WordDiff before="" after="A **new** paragraph."
    labels={{ compare: copy.compare, before: copy.original, after: copy.revised }}
    markdownLabels={{ code: { copyLabel: copy.copy, copiedLabel: copy.copied }, footnotes: copy.footnotes }} />)
  expect(html).not.toContain('data-rendered-before')
  expect(html).toContain('<strong>new</strong>')
  expect(html).toContain('data-rendered-after')
  expect(html.replace(/ class="[^"]*"/g, '')).toMatchSnapshot()
})
