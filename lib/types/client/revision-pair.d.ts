import type { PaperRevision } from '../schema.ts';
import type { WorkbenchDocument } from '../workbench-view.ts';
import type { VersionSelection } from './versions.tsx';
type ReadRevision = (path: string, revision: string, signal: AbortSignal, sessionId: string) => Promise<PaperRevision>;
/** Keep response races and cancellation scoped to the comparison that requested them. */
export declare function useRevisionPair(document: WorkbenchDocument | undefined, selection: VersionSelection | undefined, active: boolean, read: ReadRevision, lifetime: AbortSignal, sessionId: string): {
    revisions: PaperRevision[];
    loading: boolean;
    error: string;
    retry: () => void;
};
export {};
