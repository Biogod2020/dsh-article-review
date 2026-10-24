/** Source-backed panel regions and exact paragraph associations, separate from manuscript edits. */
import { z } from 'zod'
import type { PaperBlock, PaperRevision } from './schema.ts'
import { collectFigures } from './figures.ts'

/** Normalized top-left crop coordinates on a rendered source page. */
export const PanelRegionSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1),
  z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([left, top, right, bottom]) => left < right && top < bottom, 'Crop must have positive area')
const target = z.object({ blockId: z.string().min(1), before: z.string().min(1).max(2_000_000) })
/** Replace the complete panel map for one figure; an empty list removes that map. */
export const PanelInputSchema = z.object({ revision: z.string().min(1), figureBlockId: z.string().min(1),
  figure: z.string().min(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  panels: z.array(z.object({ label: z.string().min(1).max(80), file: z.string().min(1),
    page: z.number().int().min(1), region: PanelRegionSchema, targets: z.array(target).min(1).max(100) })).max(52),
}).refine(input => new Set(input.panels.map(panel => panel.label.toLowerCase())).size === input.panels.length,
  'Panel labels must be unique within a figure')
/** Panel files and parent sources retain immutable workspace snapshots. */
export const FigurePanelSchema = z.object({ id: z.string(), figureBlockId: z.string(), figure: z.string(),
  label: z.string(), sourceHash: z.string(), sourceFile: z.string(), file: z.string(), hash: z.string(),
  page: z.number().int().min(1), region: PanelRegionSchema, targets: z.array(target),
  stale: z.boolean().optional(),
})
export type FigurePanel = z.infer<typeof FigurePanelSchema>
export type PanelInput = z.infer<typeof PanelInputSchema>

/** Confirm one saved map without repeating manuscript text or other figures' maps. */
export function panelAcknowledgement(panels: readonly FigurePanel[], input: Pick<PanelInput, 'figureBlockId' | 'figure'>) {
  const saved = panels.filter(panel => panel.figureBlockId === input.figureBlockId && panel.figure === input.figure)
  return { figureBlockId: input.figureBlockId, figure: input.figure, panelCount: saved.length, totalPanels: panels.length,
    panels: saved.map(panel => ({ id: panel.id, label: panel.label, file: panel.file, page: panel.page,
      region: panel.region, targetBlockIds: panel.targets.map(target => target.blockId),
      ...(panel.stale === undefined ? {} : { stale: panel.stale }) })),
    manuscriptWritten: false, originalFilesWritten: false }
}

/** Return only still-exact associations; edited paragraphs never inherit an old crop silently. */
export function attachedPanelTargets(panel: FigurePanel, revision: Pick<PaperRevision, 'blocks'>): PaperBlock[] {
  if (panel.stale || !collectFigures(revision.blocks).some(figure => figure.blockId === panel.figureBlockId && figure.path === panel.figure)) return []
  return panel.targets.flatMap(target => revision.blocks.filter(block => block.id === target.blockId && block.text === target.before))
}
