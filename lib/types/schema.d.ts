/** Validated on-disk and RPC records. Review baselines change only on an explicit human action. */
import { z } from 'zod';
/** A source block, with a durable identity independent of its position and content hash. */
export declare const BlockSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodString;
    section: z.ZodString;
    text: z.ZodString;
    start: z.ZodNumber;
    end: z.ZodNumber;
}, z.core.$strip>;
/** Retained figure bytes and their authored destination. */
export declare const FigureAssetSchema: z.ZodObject<{
    path: z.ZodString;
    snapshot: z.ZodString;
    hash: z.ZodString;
}, z.core.$strip>;
/** One immutable imported or accepted manuscript version with optional retained figures. */
export declare const RevisionSchema: z.ZodObject<{
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
/** A quotation anchored to the block and the exact version the reader saw. */
export declare const AnnotationSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** Reader marks retain their source snapshot; removal is reversible and never edits the manuscript. */
export declare const HighlightSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** Replace or delete an exact block, or insert Markdown beside it; source writes still need acceptance. */
export declare const EditSchema: z.ZodObject<{
    blockId: z.ZodString;
    before: z.ZodString;
    after: z.ZodString;
    operation: z.ZodOptional<z.ZodEnum<{
        "insert-before": "insert-before";
        "insert-after": "insert-after";
    }>>;
}, z.core.$strip>;
/** A model proposal is never itself a write authorization. */
export declare const ProposalInputSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** Update selected fields of a pending proposal against the current reader version. */
export declare const ProposalRevisionInputSchema: z.ZodObject<{
    annotationIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    reason: z.ZodOptional<z.ZodString>;
    meaning: z.ZodOptional<z.ZodEnum<{
        style: "style";
        structure: "structure";
        claim: "claim";
        evidence: "evidence";
    }>>;
    edits: z.ZodOptional<z.ZodArray<z.ZodObject<{
        blockId: z.ZodString;
        before: z.ZodString;
        after: z.ZodString;
        operation: z.ZodOptional<z.ZodEnum<{
            "insert-before": "insert-before";
            "insert-after": "insert-after";
        }>>;
    }, z.core.$strip>>>;
    proposalId: z.ZodString;
    revision: z.ZodString;
    baseRevision: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** A proposal and the deterministic checks recorded when it was submitted. */
export declare const ProposalSchema: z.ZodObject<{
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
}, z.core.$strip>;
/** Snapshot-backed figure replacement; source writes still require acceptance. */
export declare const FigureReplacementSchema: z.ZodObject<{
    revision: z.ZodString;
    blockId: z.ZodString;
    figure: z.ZodString;
    replacement: z.ZodString;
    reason: z.ZodString;
    proposalId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Per-block human review state; accepting a proposal does not advance it. */
export declare const BaselineSchema: z.ZodObject<{
    blockId: z.ZodString;
    revision: z.ZodString;
    text: z.ZodString;
    locked: z.ZodBoolean;
    reviewedAt: z.ZodString;
    archivedAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Project-persisted state for one manuscript. No browser storage is authoritative. */
export declare const DocumentSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
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
    revisions: z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>;
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
}, z.core.$strip>;
/** Model and browser input accepted by the operator RPC dispatcher. */
export declare const CommandSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"open">;
    path: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"refresh">;
    path: z.ZodString;
    revision: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"annotate">;
    path: z.ZodString;
    revision: z.ZodString;
    blockId: z.ZodString;
    quote: z.ZodString;
    prefix: z.ZodString;
    suffix: z.ZodString;
    rendered: z.ZodOptional<z.ZodBoolean>;
    offset: z.ZodOptional<z.ZodNumber>;
    comment: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"highlight">;
    path: z.ZodString;
    revision: z.ZodString;
    blockId: z.ZodString;
    quote: z.ZodString;
    prefix: z.ZodString;
    suffix: z.ZodString;
    offset: z.ZodNumber;
    color: z.ZodEnum<{
        yellow: "yellow";
        green: "green";
        blue: "blue";
        underline: "underline";
    }>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"set-highlight">;
    path: z.ZodString;
    highlightId: z.ZodString;
    removed: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"resolve">;
    path: z.ZodString;
    annotationId: z.ZodString;
    resolved: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"review">;
    path: z.ZodString;
    revision: z.ZodString;
    blockIds: z.ZodArray<z.ZodString>;
    locked: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"unlock">;
    path: z.ZodString;
    blockId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"archive-baseline">;
    path: z.ZodString;
    revision: z.ZodString;
    blockId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"restore-baseline">;
    path: z.ZodString;
    revision: z.ZodString;
    blockId: z.ZodString;
    archivedAt: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"relink-baseline">;
    path: z.ZodString;
    revision: z.ZodString;
    blockId: z.ZodString;
    targetBlockId: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"decide">;
    path: z.ZodString;
    revision: z.ZodString;
    proposalId: z.ZodString;
    accept: z.ZodBoolean;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"position">;
    path: z.ZodString;
    reader: z.ZodString;
    blockId: z.ZodString;
}, z.core.$strip>], "action">;
/** Wire response, also validates browser reads before rendering. */
export declare const ViewSchema: z.ZodObject<{
    document: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
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
        revisions: z.ZodArray<z.ZodObject<{
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
        }, z.core.$strip>>;
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
    }, z.core.$strip>;
    diskChanged: z.ZodBoolean;
}, z.core.$strip>;
/** Hash-checked deletion copies exact Markdown on the host rather than through model arguments. */
export declare const DeletionInputSchema: z.ZodObject<{
    baseRevision: z.ZodString;
    blockId: z.ZodString;
    beforeHash: z.ZodString;
    reason: z.ZodString;
    proposalId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Whole-block deletion proposal, optionally appended to a pending group. */
export type DeletionInput = z.infer<typeof DeletionInputSchema>;
/** One bounded directory level of Markdown files and folders. */
export declare const FileListingSchema: z.ZodObject<{
    path: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
    }, z.core.$strip>>;
    truncated: z.ZodBoolean;
}, z.core.$strip>;
/** BibTeX remains on disk; this read-only projection keeps the bibliography outside the manuscript body. */
export declare const BibliographyViewSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodString>;
    entries: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        type: z.ZodString;
        file: z.ZodString;
        hash: z.ZodString;
        fields: z.ZodRecord<z.ZodString, z.ZodString>;
    }, z.core.$strip>>;
    missingKeys: z.ZodArray<z.ZodString>;
    possibleBareKeys: z.ZodArray<z.ZodString>;
    canonicalCitationCount: z.ZodNumber;
    citationStatus: z.ZodEnum<{
        resolved: "resolved";
        unbound: "unbound";
        "missing-keys": "missing-keys";
        "possible-legacy-keys": "possible-legacy-keys";
        "no-citations": "no-citations";
    }>;
}, z.core.$strip>;
/** Successful Connection envelope for operator clients. */
export declare const ViewResponseSchema: z.ZodObject<{
    result: z.ZodObject<{
        ok: z.ZodLiteral<true>;
        value: z.ZodObject<{
            document: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
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
                revisions: z.ZodArray<z.ZodObject<{
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
                }, z.core.$strip>>;
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
            }, z.core.$strip>;
            diskChanged: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Validated manuscript state. */
export type PaperDocument = z.infer<typeof DocumentSchema>;
/** One block in a revision. */
export type PaperBlock = z.infer<typeof BlockSchema>;
/** Immutable manuscript revision. */
export type PaperRevision = z.infer<typeof RevisionSchema>;
/** Stored reader annotation. */
export type Annotation = z.infer<typeof AnnotationSchema>;
/** Persisted reader highlight or underline. */
export type PaperHighlight = z.infer<typeof HighlightSchema>;
/** Pending or settled modification. */
export type Proposal = z.infer<typeof ProposalSchema>;
/** Proposal submitted by the model. */
export type ProposalInput = z.infer<typeof ProposalInputSchema>;
/** Partial in-place update of a pending proposal. */
export type ProposalRevisionInput = z.infer<typeof ProposalRevisionInputSchema>;
/** Snapshot-backed figure replacement request. */
export type FigureReplacement = z.infer<typeof FigureReplacementSchema>;
/** Retained figure bytes and their authored reference. */
export type FigureAsset = z.infer<typeof FigureAssetSchema>;
/** Validated operator action. */
export type PaperCommand = z.infer<typeof CommandSchema>;
/** Version-pinned reader response. */
export type PaperView = z.infer<typeof ViewSchema>;
/** Operator file-picker listing. */
export type FileListing = z.infer<typeof FileListingSchema>;
/** Indexed authoritative `.bib` files and manuscript citation diagnostics. */
export type BibliographyView = z.infer<typeof BibliographyViewSchema>;
//# sourceMappingURL=schema.d.ts.map