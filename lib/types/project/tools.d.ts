import type { ProjectStore, ProjectView } from './store.ts';
type Args = Record<string, any>;
/** What a tool returns to the model: plain JSON (DSH's JsonValue has the same shape). */
export type Json = string | number | boolean | null | Json[] | {
    [key: string]: Json;
};
/** The parts of a project view a model asks for; the whole view of a real paper is too large for one tool result. */
export declare function modelView(v: ProjectView, include: string[], ids: string[]): object;
export declare function readTool(store: ProjectStore, args: Args): Promise<Json>;
export declare function applyTool(store: ProjectStore, args: Args, actor: string): Promise<Json>;
export declare function commentTool(store: ProjectStore, args: Args): Promise<Json>;
export declare function draftTool(store: ProjectStore, args: Args, actor: string): Promise<Json>;
export declare function linkTool(store: ProjectStore, args: Args, actor: string): Promise<Json>;
export declare function numberHintsTool(store: ProjectStore, args: Args): Promise<Json>;
export {};
