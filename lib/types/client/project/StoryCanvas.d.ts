import type { ReactNode } from 'react';
import type { Target } from '../../project/model.ts';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions } from './actions.ts';
import type { Focus } from './common.tsx';
export declare function StoryCanvas({ view, actions, focus, onGo, onAskComment, onRead }: {
    view: ProjectView;
    actions: ProjectActions;
    focus: Focus | null;
    onGo: (f: Focus) => void;
    onAskComment: (t: Target, text: string) => Promise<void>;
    onRead: (paragraph: string) => void;
}): ReactNode;
