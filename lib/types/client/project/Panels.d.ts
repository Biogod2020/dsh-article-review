import type { ReactNode } from 'react';
import type { Comment } from '../../project/model.ts';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions, AgentTask } from './actions.ts';
import type { Focus } from './StoryFlow.tsx';
export declare function targetLabel(view: ProjectView, c: Comment): string;
export declare function focusOf(c: Comment): Focus;
export declare function Overview({ view, actions, onAsk, busy, onTab }: {
    view: ProjectView;
    actions: ProjectActions;
    onAsk: (t: AgentTask) => void;
    busy: boolean;
    onTab: (tab: string) => void;
}): ReactNode;
export declare const HUMAN: Set<"check" | "author" | "collaborator" | "editor" | "reviewer" | "audience" | "chat">;
export declare function Inbox({ view, actions, onGo, onAsk, busy }: {
    view: ProjectView;
    actions: ProjectActions;
    onGo: (f: Focus) => void;
    onAsk: (t: AgentTask) => void;
    busy: boolean;
}): ReactNode;
export declare function History({ view, onGo }: {
    view: ProjectView;
    onGo: (f: Focus) => void;
}): ReactNode;
/**
 * Number triage: every unregistered number with the agent's first sort (a hint), so parameters can be cleared in a
 * batch with one stated reason while results are registered or checked one by one.
 */
export declare function Numbers({ view, actions, onGo, onAsk, busy }: {
    view: ProjectView;
    actions: ProjectActions;
    onGo: (f: Focus) => void;
    onAsk: (t: AgentTask) => void;
    busy: boolean;
}): ReactNode;
/** Optional view: claim dependencies as a simple ordered list (the abstract network was rarely used). */
export declare function Network({ view, onGo }: {
    view: ProjectView;
    onGo: (f: Focus) => void;
}): ReactNode;
