import type { ReactNode } from 'react';
import type { Claim, Comment, Target } from '../../project/model.ts';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions } from './actions.ts';
export type { Focus } from './common.tsx';
import type { Focus } from './common.tsx';
/** Comments that belong to a claim: on it or on one of its evidence items. */
export declare const claimComments: (comments: Comment[], c: Claim) => Comment[];
export declare function StoryFlow({ view, actions, focus, onFocus, onGo, onAskComment, onRead }: {
    view: ProjectView;
    actions: ProjectActions;
    focus: Focus | null;
    onFocus: (f: Focus | null) => void;
    onGo: (f: Focus) => void;
    onAskComment: (t: Target, text: string) => Promise<void>;
    onRead: (paragraph: string) => void;
}): ReactNode;
/** Claim detail; `embedded` drops the side-panel frame when it lives in the floating window of the story canvas. */
export declare function ClaimDetail({ claim, view, actions, focusEvidence, onClose, onGo, onAskComment, onRead, embedded }: {
    claim: Claim;
    view: ProjectView;
    actions: ProjectActions;
    focusEvidence: string;
    onClose: () => void;
    onGo: (f: Focus) => void;
    onAskComment: (t: Target, text: string) => Promise<void>;
    onRead: (paragraph: string) => void;
    embedded?: boolean;
}): ReactNode;
