/**
 * Project mode: a paper is a project that moves from materials to a story-flow skeleton, then to claims and
 * figures, then to prose, then to reading review. The skeleton stays the reference after drafting: every
 * paragraph records which claims it states and the claim text it was written from, so either side drifting
 * is visible.
 */
import { z } from 'zod';
/** Ordered stages; the author advances them, checklists only advise. */
export declare const STAGES: readonly ["materials", "skeleton", "refine", "draft", "read", "submit"];
export declare const StageSchema: z.ZodEnum<{
    read: "read";
    submit: "submit";
    draft: "draft";
    materials: "materials";
    skeleton: "skeleton";
    refine: "refine";
}>;
export type Stage = z.infer<typeof StageSchema>;
/** A figure panel that can be attached to evidence; image is a workspace path or URL. */
/** image may be omitted in an agent's upsert; applyChanges keeps the existing image of a panel with the same label. */
export declare const PanelSchema: z.ZodObject<{
    label: z.ZodString;
    image: z.ZodDefault<z.ZodString>;
    note: z.ZodDefault<z.ZodString>;
    spare: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const FigureSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    title: z.ZodDefault<z.ZodString>;
    caption: z.ZodDefault<z.ZodString>;
    placement: z.ZodDefault<z.ZodEnum<{
        main: "main";
        extended: "extended";
        unplaced: "unplaced";
    }>>;
    file: z.ZodDefault<z.ZodString>;
    panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        image: z.ZodDefault<z.ZodString>;
        note: z.ZodDefault<z.ZodString>;
        spare: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Figure = z.infer<typeof FigureSchema>;
/** A number the paper may state, with where it comes from; prose and claims are checked against this list. */
export declare const NumberSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    value: z.ZodString;
    source: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type RegisteredNumber = z.infer<typeof NumberSchema>;
export declare const EVIDENCE_KINDS: readonly ["how", "support", "limit", "gap"];
export declare const EVIDENCE_STATUS: readonly ["sufficient", "partial", "missing", "risk"];
export declare const EvidenceSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodDefault<z.ZodEnum<{
        how: "how";
        support: "support";
        limit: "limit";
        gap: "gap";
    }>>;
    status: z.ZodDefault<z.ZodEnum<{
        sufficient: "sufficient";
        partial: "partial";
        missing: "missing";
        risk: "risk";
    }>>;
    text: z.ZodString;
    source: z.ZodDefault<z.ZodString>;
    panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
        figure: z.ZodString;
        label: z.ZodString;
    }, z.core.$strip>>>;
    owner: z.ZodDefault<z.ZodString>;
    due: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export declare const ClaimSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    statement: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        support: "support";
        core: "core";
    }>>;
    reviewerQuestion: z.ZodDefault<z.ZodString>;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodDefault<z.ZodEnum<{
            how: "how";
            support: "support";
            limit: "limit";
            gap: "gap";
        }>>;
        status: z.ZodDefault<z.ZodEnum<{
            sufficient: "sufficient";
            partial: "partial";
            missing: "missing";
            risk: "risk";
        }>>;
        text: z.ZodString;
        source: z.ZodDefault<z.ZodString>;
        panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
            figure: z.ZodString;
            label: z.ZodString;
        }, z.core.$strip>>>;
        owner: z.ZodDefault<z.ZodString>;
        due: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Claim = z.infer<typeof ClaimSchema>;
/** One step of the story; claims carry it. */
export declare const BeatSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    summary: z.ZodDefault<z.ZodString>;
    claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type Beat = z.infer<typeof BeatSchema>;
/** A paragraph of the draft. basis = claim id -> hash of that claim when the paragraph was written or synced. */
export declare const ParagraphSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
    basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type Paragraph = z.infer<typeof ParagraphSchema>;
export declare const SectionSchema: z.ZodObject<{
    id: z.ZodString;
    heading: z.ZodString;
    beat: z.ZodDefault<z.ZodString>;
    paragraphs: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
        basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type Section = z.infer<typeof SectionSchema>;
/** Who said it. Personas are model reviewers with fixed roles; chat is a request made in the conversation. */
/** check = a problem found by checks (initialisation, repository); it reaches the author like a person's comment. */
export declare const COMMENT_SOURCES: readonly ["author", "collaborator", "editor", "reviewer", "audience", "chat", "check"];
export type CommentSource = typeof COMMENT_SOURCES[number];
export declare const TargetSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        claim: "claim";
        evidence: "evidence";
        figure: "figure";
        paragraph: "paragraph";
        beat: "beat";
        project: "project";
        thesis: "thesis";
    }>;
    id: z.ZodDefault<z.ZodString>;
    quote: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type Target = z.infer<typeof TargetSchema>;
export declare const CommentSchema: z.ZodObject<{
    id: z.ZodString;
    target: z.ZodObject<{
        kind: z.ZodEnum<{
            claim: "claim";
            evidence: "evidence";
            figure: "figure";
            paragraph: "paragraph";
            beat: "beat";
            project: "project";
            thesis: "thesis";
        }>;
        id: z.ZodDefault<z.ZodString>;
        quote: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodEnum<{
        check: "check";
        author: "author";
        collaborator: "collaborator";
        editor: "editor";
        reviewer: "reviewer";
        audience: "audience";
        chat: "chat";
    }>;
    author: z.ZodString;
    text: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        open: "open";
        answered: "answered";
        closed: "closed";
        declined: "declined";
    }>>;
    response: z.ZodOptional<z.ZodObject<{
        text: z.ZodString;
        revision: z.ZodNumber;
        at: z.ZodString;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    stage: z.ZodEnum<{
        read: "read";
        submit: "submit";
        draft: "draft";
        materials: "materials";
        skeleton: "skeleton";
        refine: "refine";
    }>;
    assignee: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type Comment = z.infer<typeof CommentSchema>;
/** A dependency between claims; only shown in the optional network view. */
export declare const LinkSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    label: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const ProjectSchema: z.ZodObject<{
    schemaVersion: z.ZodDefault<z.ZodLiteral<1>>;
    title: z.ZodString;
    journal: z.ZodDefault<z.ZodString>;
    audience: z.ZodDefault<z.ZodString>;
    style: z.ZodDefault<z.ZodString>;
    stage: z.ZodDefault<z.ZodEnum<{
        read: "read";
        submit: "submit";
        draft: "draft";
        materials: "materials";
        skeleton: "skeleton";
        refine: "refine";
    }>>;
    materials: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        path: z.ZodDefault<z.ZodString>;
        note: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    thesis: z.ZodDefault<z.ZodObject<{
        title: z.ZodDefault<z.ZodString>;
        statement: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    beats: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodDefault<z.ZodString>;
        claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    claims: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        statement: z.ZodString;
        role: z.ZodDefault<z.ZodEnum<{
            support: "support";
            core: "core";
        }>>;
        reviewerQuestion: z.ZodDefault<z.ZodString>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodDefault<z.ZodEnum<{
                how: "how";
                support: "support";
                limit: "limit";
                gap: "gap";
            }>>;
            status: z.ZodDefault<z.ZodEnum<{
                sufficient: "sufficient";
                partial: "partial";
                missing: "missing";
                risk: "risk";
            }>>;
            text: z.ZodString;
            source: z.ZodDefault<z.ZodString>;
            panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
                figure: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>>>;
            owner: z.ZodDefault<z.ZodString>;
            due: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    figures: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        title: z.ZodDefault<z.ZodString>;
        caption: z.ZodDefault<z.ZodString>;
        placement: z.ZodDefault<z.ZodEnum<{
            main: "main";
            extended: "extended";
            unplaced: "unplaced";
        }>>;
        file: z.ZodDefault<z.ZodString>;
        panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            image: z.ZodDefault<z.ZodString>;
            note: z.ZodDefault<z.ZodString>;
            spare: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    numbers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        value: z.ZodString;
        source: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    sections: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        heading: z.ZodString;
        beat: z.ZodDefault<z.ZodString>;
        paragraphs: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
            basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    links: z.ZodDefault<z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        label: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    numberIgnores: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type Project = z.infer<typeof ProjectSchema>;
/** One recorded change; reason and the comments it answers make the history explain itself. */
export declare const HistoryEntrySchema: z.ZodObject<{
    revision: z.ZodNumber;
    at: z.ZodString;
    actor: z.ZodString;
    reason: z.ZodString;
    comments: z.ZodDefault<z.ZodArray<z.ZodString>>;
    units: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
/** Private review state beside the project: comments, the author's reviewed hashes, history. */
/**
 * A proposed rewrite of one paragraph, waiting for the author. Prose is never replaced silently: the author sees the
 * word diff and accepts or discards it. Accepting checks that the paragraph still reads as `before`.
 */
export declare const DraftSchema: z.ZodObject<{
    id: z.ZodString;
    section: z.ZodString;
    paragraph: z.ZodString;
    before: z.ZodString;
    after: z.ZodString;
    claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
    reason: z.ZodString;
    actor: z.ZodString;
    comments: z.ZodDefault<z.ZodArray<z.ZodString>>;
    createdAt: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        pending: "pending";
        accepted: "accepted";
        stale: "stale";
        discarded: "discarded";
    }>>;
}, z.core.$strip>;
export type Draft = z.infer<typeof DraftSchema>;
export declare const ReviewStateSchema: z.ZodObject<{
    revision: z.ZodDefault<z.ZodNumber>;
    comments: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        target: z.ZodObject<{
            kind: z.ZodEnum<{
                claim: "claim";
                evidence: "evidence";
                figure: "figure";
                paragraph: "paragraph";
                beat: "beat";
                project: "project";
                thesis: "thesis";
            }>;
            id: z.ZodDefault<z.ZodString>;
            quote: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodEnum<{
            check: "check";
            author: "author";
            collaborator: "collaborator";
            editor: "editor";
            reviewer: "reviewer";
            audience: "audience";
            chat: "chat";
        }>;
        author: z.ZodString;
        text: z.ZodString;
        status: z.ZodDefault<z.ZodEnum<{
            open: "open";
            answered: "answered";
            closed: "closed";
            declined: "declined";
        }>>;
        response: z.ZodOptional<z.ZodObject<{
            text: z.ZodString;
            revision: z.ZodNumber;
            at: z.ZodString;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        stage: z.ZodEnum<{
            read: "read";
            submit: "submit";
            draft: "draft";
            materials: "materials";
            skeleton: "skeleton";
            refine: "refine";
        }>;
        assignee: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    reviewed: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        hash: z.ZodString;
        revision: z.ZodNumber;
        at: z.ZodString;
    }, z.core.$strip>>>;
    history: z.ZodDefault<z.ZodArray<z.ZodObject<{
        revision: z.ZodNumber;
        at: z.ZodString;
        actor: z.ZodString;
        reason: z.ZodString;
        comments: z.ZodDefault<z.ZodArray<z.ZodString>>;
        units: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    drafts: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        section: z.ZodString;
        paragraph: z.ZodString;
        before: z.ZodString;
        after: z.ZodString;
        claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
        reason: z.ZodString;
        actor: z.ZodString;
        comments: z.ZodDefault<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
        status: z.ZodDefault<z.ZodEnum<{
            pending: "pending";
            accepted: "accepted";
            stale: "stale";
            discarded: "discarded";
        }>>;
    }, z.core.$strip>>>;
    numberHints: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        kind: z.ZodEnum<{
            result: "result";
            parameter: "parameter";
            citation: "citation";
            other: "other";
        }>;
        note: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type ReviewState = z.infer<typeof ReviewStateSchema>;
/**
 * A change the agent or the author applies. Units are replaced whole (upsert) or removed; the store records the
 * changed unit keys so the author sees them as "changed since review".
 */
export declare const ChangeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    op: z.ZodLiteral<"set-meta">;
    fields: z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        style: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        journal: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        audience: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"set-thesis">;
    thesis: z.ZodObject<{
        title: z.ZodString;
        statement: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-beat">;
    beat: z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        summary: z.ZodDefault<z.ZodString>;
        claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    index: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-claim">;
    claim: z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        statement: z.ZodString;
        role: z.ZodDefault<z.ZodEnum<{
            support: "support";
            core: "core";
        }>>;
        reviewerQuestion: z.ZodDefault<z.ZodString>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodDefault<z.ZodEnum<{
                how: "how";
                support: "support";
                limit: "limit";
                gap: "gap";
            }>>;
            status: z.ZodDefault<z.ZodEnum<{
                sufficient: "sufficient";
                partial: "partial";
                missing: "missing";
                risk: "risk";
            }>>;
            text: z.ZodString;
            source: z.ZodDefault<z.ZodString>;
            panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
                figure: z.ZodString;
                label: z.ZodString;
            }, z.core.$strip>>>;
            owner: z.ZodDefault<z.ZodString>;
            due: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-figure">;
    figure: z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        title: z.ZodDefault<z.ZodString>;
        caption: z.ZodDefault<z.ZodString>;
        placement: z.ZodDefault<z.ZodEnum<{
            main: "main";
            extended: "extended";
            unplaced: "unplaced";
        }>>;
        file: z.ZodDefault<z.ZodString>;
        panels: z.ZodDefault<z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            image: z.ZodDefault<z.ZodString>;
            note: z.ZodDefault<z.ZodString>;
            spare: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-number">;
    number: z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        value: z.ZodString;
        source: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-section">;
    section: z.ZodObject<{
        id: z.ZodString;
        heading: z.ZodString;
        beat: z.ZodDefault<z.ZodString>;
        paragraphs: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
            basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    index: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"upsert-paragraph">;
    section: z.ZodString;
    paragraph: z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        claims: z.ZodDefault<z.ZodArray<z.ZodString>>;
        basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
    after: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"remove">;
    unit: z.ZodEnum<{
        number: "number";
        claim: "claim";
        figure: "figure";
        section: "section";
        paragraph: "paragraph";
        beat: "beat";
    }>;
    id: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"set-links">;
    links: z.ZodArray<z.ZodObject<{
        from: z.ZodString;
        to: z.ZodString;
        label: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    op: z.ZodLiteral<"ignore-number">;
    value: z.ZodString;
    where: z.ZodDefault<z.ZodString>;
}, z.core.$strip>], "op">;
export type Change = z.infer<typeof ChangeSchema>;
