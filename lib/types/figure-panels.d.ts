/** Source-backed panel regions and exact paragraph associations, separate from manuscript edits. */
import { z } from 'zod';
import type { PaperBlock, PaperRevision } from './schema.ts';
/** Normalized top-left crop coordinates on a rendered source page. */
export declare const PanelRegionSchema: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
/** Replace the complete panel map for one figure; an empty list removes that map. */
export declare const PanelInputSchema: z.ZodObject<{
    revision: z.ZodString;
    figureBlockId: z.ZodString;
    figure: z.ZodString;
    sourceHash: z.ZodString;
    panels: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        file: z.ZodString;
        page: z.ZodNumber;
        region: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
        targets: z.ZodArray<z.ZodObject<{
            blockId: z.ZodString;
            before: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Panel files and parent sources retain immutable workspace snapshots. */
export declare const FigurePanelSchema: z.ZodObject<{
    id: z.ZodString;
    figureBlockId: z.ZodString;
    figure: z.ZodString;
    label: z.ZodString;
    sourceHash: z.ZodString;
    sourceFile: z.ZodString;
    file: z.ZodString;
    hash: z.ZodString;
    page: z.ZodNumber;
    region: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
    targets: z.ZodArray<z.ZodObject<{
        blockId: z.ZodString;
        before: z.ZodString;
    }, z.core.$strip>>;
    stale: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type FigurePanel = z.infer<typeof FigurePanelSchema>;
export type PanelInput = z.infer<typeof PanelInputSchema>;
/** Confirm one saved map without repeating manuscript text or other figures' maps. */
export declare function panelAcknowledgement(panels: readonly FigurePanel[], input: Pick<PanelInput, 'figureBlockId' | 'figure'>): {
    figureBlockId: string;
    figure: string;
    panelCount: number;
    totalPanels: number;
    panels: {
        stale?: boolean;
        id: string;
        label: string;
        file: string;
        page: number;
        region: [number, number, number, number];
        targetBlockIds: string[];
    }[];
    manuscriptWritten: boolean;
    originalFilesWritten: boolean;
};
/** Return only still-exact associations; edited paragraphs never inherit an old crop silently. */
export declare function attachedPanelTargets(panel: FigurePanel, revision: Pick<PaperRevision, 'blocks'>): PaperBlock[];
