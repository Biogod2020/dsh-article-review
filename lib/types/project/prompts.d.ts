/**
 * Prompts for project mode. Every task, including writing, asks the model to judge the paper the way an editor,
 * a reviewer and the intended reader would, because the author's own view is the one the paper already has.
 * The prompts carry data as JSON and say so; nothing in the project text is an instruction.
 */
import type { Project, Comment, CommentSource, Section } from './model.ts';
export type Persona = Extract<CommentSource, 'editor' | 'reviewer' | 'audience'>;
/** Fixed reviewer roles. Each owns one question so their comments do not overlap. */
export declare const PERSONAS: Record<Persona, {
    name: string;
    brief: string;
    owns: string;
}>;
/** Plain, expert style: the author's standing requirement for prose. */
export declare const DEFAULT_STYLE = "Write as a native-speaker expert in the field would for a top journal, but so that a reader whose first language is\nnot English reads it comfortably: one idea per sentence, subject and verb early, concrete nouns, defined terms,\nno stacked modifiers, no idioms or rhetorical flourish, active voice where natural. Precise numbers with their unit\nand denominator. Claims no stronger than their evidence.";
/** Ask a persona for comments on the whole project or one part. */
export declare function personaReviewPrompt(p: Project, persona: Persona, focus: string, comments: Comment[]): string;
/** First skeleton from materials. */
export declare function skeletonPrompt(p: Project, materials: string): string;
/** Revise the skeleton (claims and figures) in answer to open comments. */
export declare function refinePrompt(p: Project, comments: Comment[]): string;
/** Write one section from its beat and claims. */
export declare function draftPrompt(p: Project, section: Section, previous: string): string;
/** Rewrite paragraphs whose claims changed after they were written. */
export declare function resyncPrompt(p: Project, paragraphs: {
    id: string;
    text: string;
    claims: string[];
}[]): string;
/** Convert an existing article into a project: skeleton plus sections whose paragraphs point at claims. */
export declare function importPrompt(article: string): string;
/** Hash map a paragraph is written from, for callers that create paragraphs outside applyChanges. */
export declare const basisFor: (p: Project, claimIds: string[]) => Record<string, string>;
/** First sort of unregistered numbers in the prose, so the author can clear parameters quickly and check results first. */
export declare function numberTriagePrompt(p: Project, items: {
    key: string;
    value: string;
    quote: string;
}[]): string;
/** Agent work requested from the project panel. */
export type ProjectTask = {
    kind: 'skeleton';
} | {
    kind: 'persona';
    persona: Persona;
    focus: string;
} | {
    kind: 'refine';
    comments: string[];
} | {
    kind: 'draft';
    beat: string;
} | {
    kind: 'resync';
    paragraphs: string[];
} | {
    kind: 'numbers';
};
/**
 * The conversation message for a task when a tool-using agent (DSH) does the work. The agent reads the project with
 * project_read and records results with the project_* tools; the store, not the prose of the reply, is the outcome.
 */
export declare function agentTaskMessage(task: ProjectTask, project: string, style: string): string;
