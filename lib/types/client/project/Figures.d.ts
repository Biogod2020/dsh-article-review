import type { ReactNode } from 'react';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions } from './actions.ts';
import type { Focus } from './StoryFlow.tsx';
export declare function Figures({ view, actions, onFocus }: {
    view: ProjectView;
    actions: ProjectActions;
    onFocus: (f: Focus) => void;
}): ReactNode;
