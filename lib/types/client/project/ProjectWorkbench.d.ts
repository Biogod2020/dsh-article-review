import type { ReactNode } from 'react';
import type { ProjectActions } from './actions.ts';
/**
 * @param refresh - changes when the host knows the project changed (an agent turn ended), forcing a reload.
 * @param agentBusy - the host's agent is working on something this panel asked for.
 */
export declare function ProjectWorkbench({ actions, refresh: refreshKey, agentBusy }: {
    actions: ProjectActions;
    refresh?: number;
    agentBusy?: boolean;
}): ReactNode;
