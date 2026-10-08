/** The browser receives the current manuscript and a historical version index, never every saved body. */
import { z } from 'zod';
import type { PaperView } from './schema.ts';
/** Immutable IDs and dates are enough for version choices. */
export declare const RevisionSummarySchema: z.ZodObject<{
    id: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strip>;
/** Browser projection; the full durable document stays on the host. */
export declare const WorkbenchViewSchema: z.ZodObject<{
    document: z.ZodObject<{
        path: z.ZodString;
        current: z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            blocks: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodString;
                section: z.ZodString;
                text: z.ZodString;
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strip>>;
            createdAt: z.ZodString;
            figureAssets: z.ZodOptional<z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                snapshot: z.ZodString;
                hash: z.ZodString;
            }, z.core.$strip>>>;
        }, z.core.$strip>;
        schemaVersion: z.ZodLiteral<1>;
        annotations: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            blockId: z.ZodString;
            revision: z.ZodString;
            quote: z.ZodString;
            prefix: z.ZodString;
            suffix: z.ZodString;
            comment: z.ZodString;
            renderedSource: z.ZodOptional<z.ZodString>;
            offset: z.ZodOptional<z.ZodNumber>;
            status: z.ZodEnum<{
                open: "open";
                resolved: "resolved";
            }>;
            anchor: z.ZodEnum<{
                attached: "attached";
                "needs-location": "needs-location";
            }>;
        }, z.core.$strip>>;
        proposals: z.ZodArray<z.ZodObject<{
            baseRevision: z.ZodString;
            annotationIds: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
            meaning: z.ZodEnum<{
                style: "style";
                structure: "structure";
                claim: "claim";
                evidence: "evidence";
            }>;
            edits: z.ZodArray<z.ZodObject<{
                blockId: z.ZodString;
                before: z.ZodString;
                after: z.ZodString;
                operation: z.ZodOptional<z.ZodEnum<{
                    "insert-before": "insert-before";
                    "insert-after": "insert-after";
                }>>;
            }, z.core.$strip>>;
            id: z.ZodString;
            status: z.ZodEnum<{
                pending: "pending";
                accepted: "accepted";
                rejected: "rejected";
            }>;
            createdAt: z.ZodString;
            flags: z.ZodArray<z.ZodEnum<{
                structure: "structure";
                numbers: "numbers";
                citations: "citations";
                figures: "figures";
                "claim-language": "claim-language";
                methods: "methods";
            }>>;
            figureChanges: z.ZodOptional<z.ZodArray<z.ZodObject<{
                blockId: z.ZodString;
                before: z.ZodObject<{
                    path: z.ZodString;
                    snapshot: z.ZodString;
                    hash: z.ZodString;
                }, z.core.$strip>;
                after: z.ZodObject<{
                    path: z.ZodString;
                    snapshot: z.ZodString;
                    hash: z.ZodString;
                }, z.core.$strip>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        highlights: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            blockId: z.ZodString;
            revision: z.ZodString;
            quote: z.ZodString;
            prefix: z.ZodString;
            suffix: z.ZodString;
            renderedSource: z.ZodString;
            offset: z.ZodNumber;
            color: z.ZodEnum<{
                yellow: "yellow";
                green: "green";
                blue: "blue";
                underline: "underline";
            }>;
            anchor: z.ZodEnum<{
                attached: "attached";
                "needs-location": "needs-location";
            }>;
            removed: z.ZodBoolean;
        }, z.core.$strip>>>;
        baselines: z.ZodArray<z.ZodObject<{
            blockId: z.ZodString;
            revision: z.ZodString;
            text: z.ZodString;
            locked: z.ZodBoolean;
            reviewedAt: z.ZodString;
            archivedAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        history: z.ZodArray<z.ZodObject<{
            at: z.ZodString;
            action: z.ZodString;
            detail: z.ZodString;
        }, z.core.$strip>>;
        reading: z.ZodRecord<z.ZodString, z.ZodString>;
        revisions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            createdAt: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    diskChanged: z.ZodBoolean;
}, z.core.$strip>;
export type WorkbenchView = z.infer<typeof WorkbenchViewSchema>;
export type WorkbenchDocument = WorkbenchView['document'];
/** Project an already validated store read without cloning its current manuscript or altering history. */
export declare function workbenchView(view: PaperView): WorkbenchView;
