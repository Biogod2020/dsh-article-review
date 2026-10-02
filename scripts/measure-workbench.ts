/** Reproducible wire-size and parser-cost comparison; these timings are Node measurements, not browser FPS. */
import { performance } from 'node:perf_hooks'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRevision } from '../src/document.ts'
import { ViewSchema } from '../src/schema.ts'
import { WorkbenchViewSchema, workbenchView } from '../src/workbench-view.ts'
import { PdfPreviewCache } from '../src/pdf-preview-cache.ts'
import { pdfThumbnail } from '../src/figure-thumbnail.ts'
import { samplePdf } from '../tests/pdf-fixture.ts'

const revisions = Array.from({ length: 24 }, (_, version) => parseRevision(Array.from({ length: 500 }, (_, paragraph) =>
  `Paragraph ${paragraph}. We compared paired revisions in three synthetic datasets (n = 42). `
  + `The **manuscript review** workflow preserves exact evidence and source locations. Revision ${paragraph % 50 === 0 ? version : 0}.`).join('\n\n')))
const view = { diskChanged: false, document: { schemaVersion: 1 as const, path: 'synthetic.md', current: revisions.at(-1)!,
  revisions, annotations: [], highlights: [], proposals: [], baselines: [], history: [], reading: {} } }
const full = JSON.stringify(view), light = JSON.stringify(workbenchView(view))
function medianParse(wire: string, parse: (value: unknown) => unknown): number {
  for (let index = 0; index < 3; index++) parse(JSON.parse(wire))
  const elapsed = Array.from({ length: 15 }, () => {
    const start = performance.now(); parse(JSON.parse(wire)); return performance.now() - start
  }).sort((a, b) => a - b)
  return Number(elapsed[7]!.toFixed(3))
}
const before = medianParse(full, value => ViewSchema.parse(value))
const after = medianParse(light, value => WorkbenchViewSchema.parse(value))
const directory = await mkdtemp(join(tmpdir(), 'paper-review-measure-'))
let repeatedPdfPreview: { rendererAvailable: boolean; callsBefore: number; callsAfter: number; cacheBudgetBytes: number }
const cacheBudgetBytes = 4_194_304
let callsBefore = 0, callsAfter = 0
const cache = new PdfPreviewCache(cacheBudgetBytes, 1, async (...args) => { callsAfter++; return pdfThumbnail(...args) })
try {
  const path = join(directory, 'synthetic.pdf')
  await writeFile(path, samplePdf())
  const signal = new AbortController().signal
  const direct = async (): Promise<string | undefined> => { callsBefore++; return pdfThumbnail(path, signal) }
  const original = await Promise.all([direct(), direct(), direct()])
  await direct()
  await Promise.all([cache.get(path, signal), cache.get(path, signal), cache.get(path, signal)])
  await cache.get(path, signal)
  repeatedPdfPreview = { rendererAvailable: original.every(Boolean), callsBefore, callsAfter, cacheBudgetBytes }
} finally { cache.dispose(); await rm(directory, { recursive: true, force: true }) }
console.log(JSON.stringify({ fixture: { paragraphs: 500, revisions: 24 }, node: process.version,
  wireBytes: { before: Buffer.byteLength(full), after: Buffer.byteLength(light),
    reductionPercent: Number((100 * (1 - Buffer.byteLength(light) / Buffer.byteLength(full))).toFixed(2)) },
  parseAndValidateMedianMs: { before, after },
  historicalBodiesRetainedDuringReading: { before: 24, after: 0 },
  comparisonHistoricalBodies: 'At most the selected pair; the current revision is reused',
  repeatedPdfPreview,
}, null, 2))
