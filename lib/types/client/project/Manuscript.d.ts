import type { ReactNode } from 'react';
import type { ProjectView } from '../../project/store.ts';
import type { ProjectActions, AgentTask } from './actions.ts';
import type { Focus } from './StoryFlow.tsx';
export declare function Draft({ view, actions, onFocus, onAsk, onRead, busy, start, from, onBack }: {
    view: ProjectView;
    actions: ProjectActions;
    onFocus: (f: Focus) => void;
    onAsk: (t: AgentTask) => void;
    onRead: (paragraph: string) => void;
    busy: boolean;
    start: string;
    /** the comment the author came from, with the way back to it */
    from: string;
    onBack: () => void;
}): ReactNode;
