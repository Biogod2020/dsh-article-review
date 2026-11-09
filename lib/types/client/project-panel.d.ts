import type { ReactNode } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Authenticated transport, supplied by the client entry. */
export interface ProjectRpc {
    call(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
export type ProjectPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & {
    rpc: ProjectRpc;
    openManuscriptReview: () => void;
};
/** Default project folder for a manuscript: papers/<name>-project, named after the file or, for main.tex and the like, its folder. */
export declare function defaultOutput(source: string, n?: number): string;
export declare function ProjectPanel({ sessionId, useSession, rpc, openManuscriptReview }: ProjectPanelProps): ReactNode;
