import type { ReactNode } from 'react';
import type { Target } from '../../project/model.ts';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions } from './actions.ts';
import type { Focus } from './StoryFlow.tsx';
export declare function Reader({ view, actions, start, onFocus, onAskComment }: {
    view: ProjectView;
    actions: ProjectActions;
    start: string;
    onFocus: (f: Focus) => void;
    onAskComment: (t: Target, text: string) => Promise<void>;
}): ReactNode;
