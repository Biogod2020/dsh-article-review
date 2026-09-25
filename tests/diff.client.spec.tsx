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
