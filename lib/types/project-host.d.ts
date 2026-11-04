/**
 * Project mode in DSH: one ProjectStore per project directory, model tools for the conversation's agent, and the
 * authenticated operator RPC the project panel uses. Agent work requested from the panel becomes a follow-up
 * message in the same conversation; its results land in the store through the tools below.
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
/** Model tools of project mode; available in every conversation, each names its project directory. */
export declare const PROJECT_TOOLS: readonly ["project_read", "project_apply", "project_comment", "project_draft", "project_number_hints", "project_link_paragraphs"];
/**
 * Register project mode.
 * @param ctx - host plugin context (connection, tools, agents).
 * @param rootFor - the conversation's workspace root, shared with manuscript review.
 */
export declare function applyProject(ctx: Context, rootFor: (sessionId: SessionId) => Promise<string>): void;
