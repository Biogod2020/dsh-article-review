import type { Claim, Comment, Draft, Project, ReviewState, Stage, Target } from './model.ts';
import type { CheckItem, NumberIssue, ReviewStatus, SyncIssue, Unit } from './units.ts';
/** What the client renders: the project plus everything derived from it. */
export interface ProjectView {
    project: Project;
    revision: number;
    comments: Comment[];
    history: ReviewState['history'];
    status: Record<string, ReviewStatus>;
    /** unit key -> revision at which the author last confirmed it (for "changed since my review" diffs) */
    reviewed: Record<string, number>;
    units: Unit[];
    sync: SyncIssue[];
    numbers: NumberIssue[];
    checklist: CheckItem[];
    /** Paragraph rewrites: pending ones wait for the author; a pending draft whose paragraph changed meanwhile is stale. */
    drafts: Draft[];
    numberHints: ReviewState['numberHints'];
}
export declare class ProjectStore {
    readonly root: string;
    private queue;
    constructor(root: string);
    private get projectPath();
    private get statePath();
    /** Run one operation at a time so read-modify-write never interleaves. */
    private serial;
    load(): Promise<{
        project: Project;
        state: ReviewState;
    }>;
    /** Create a project; refuses to overwrite an existing one. */
    create(project: Project): Promise<ProjectView>;
    derive(project: Project, state: ReviewState): ProjectView;
    view(): Promise<ProjectView>;
    /** A past revision of the project, for comparisons. */
    revision(n: number): Promise<Project>;
    /**
     * Apply changes directly and record them: they show as "changed since review" until the author confirms them.
     * Responses mark the answered comments; the reason and actor go into history.
     */
    apply(input: {
        changes: unknown[];
        actor: string;
        reason: string;
        responses?: {
            comment: string;
            text: string;
        }[];
    }): Promise<ProjectView>;
    addComment(input: {
        target: Target;
        source: Comment['source'];
        author: string;
        text: string;
    }): Promise<{
        view: ProjectView;
        comment: Comment;
    }>;
    /** Close, decline or reopen a comment. Only the author decides; the agent answers through apply(). */
    setComment(id: string, status: Comment['status']): Promise<ProjectView>;
    setAssignee(id: string, assignee: string): Promise<ProjectView>;
    /** Store the agent's sort of unregistered numbers (hints only). */
    setNumberHints(hints: ReviewState['numberHints']): Promise<ProjectView>;
    /** Mark units as reviewed at their current content. */
    confirm(keys: string[]): Promise<ProjectView>;
    /**
     * Move to a stage. Entering "submit" with unmet checklist items needs a written reason, kept in history:
     * the checklist advises elsewhere, but submission is where skipping it must be a recorded decision.
     */
    setStage(stage: Stage, actor: string, reason?: string): Promise<ProjectView>;
    /** Record proposed paragraph rewrites; an earlier pending draft for the same paragraph is replaced. */
    addDrafts(drafts: Omit<Draft, 'id' | 'createdAt' | 'status'>[]): Promise<ProjectView>;
    /**
     * Accept or discard a draft. Accepting replaces the paragraph only if it still reads as the draft's `before`,
     * and records the paragraph as written from the current claims.
     */
    decideDraft(id: string, accept: boolean, actor: string, edited?: string): Promise<ProjectView>;
    /** The claim as it was when a paragraph recorded `hash` (latest matching revision), for "still consistent?" checks. */
    claimAt(claimId: string, hash: string): Promise<Claim | null>;
    /**
     * Record which claims paragraphs state, without touching their text; the basis becomes the current claims.
     * Used when a project is initialised from an existing manuscript.
     */
    linkParagraphs(links: Record<string, string[]>, actor: string, reason: string): Promise<{
        view: ProjectView;
        unknownParagraphs: string[];
        unknownClaims: string[];
    }>;
    /** The author accepts a paragraph as matching its current claims without rewriting it. */
    markInSync(paragraphId: string, actor: string): Promise<ProjectView>;
}
