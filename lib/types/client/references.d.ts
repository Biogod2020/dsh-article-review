import type { ReactNode } from 'react';
import type { BibliographyView, PaperBlock } from '../schema.ts';
/** Locale-owned copy for bibliography filtering, binding, navigation, and recovery. */
export interface ReferencesLabels {
    title: string;
    help: string;
    sources: string;
    none: string;
    unbind: string;
    path: string;
    pathHint: string;
    bind: string;
    choose: string;
    missing: string;
    legacy: string;
    entries: string;
    loading: string;
    retry: string;
    search: string;
    searchHint: string;
    noEntries: string;
    noResults: string;
    clear: string;
    previous: string;
    next: string;
    page: string;
    showing: string;
    citationCount: string;
    locate: string;
    nextCitation: string;
    unused: string;
    doi: string;
    url: string;
}
/** Transient view preferences owned by the panel so tab changes do not reset the list. */
export interface ReferencesState {
    query: string;
    page: number;
    nextCitation: Record<string, number>;
}
/** Callbacks keep source binding and manuscript navigation under the parent panel's ownership. */
export interface ReferencesProps {
    bibliography?: BibliographyView | undefined;
    blocks: readonly PaperBlock[];
    busy: boolean;
    error?: string | undefined;
    path: string;
    onPathChange: (path: string) => void;
    onBind: (files: string[]) => void;
    onChoose: () => void;
    onRetry: () => void;
    onLocate: (blockId: string, key: string, occurrence: number) => void;
    labels: ReferencesLabels;
    state: ReferencesState;
    onStateChange: (state: ReferencesState) => void;
    focusedKey?: string | undefined;
}
/** Render at most forty entries while retaining all metadata for filtering and global find.
 * @param props - authoritative bibliography projection, localized controls, and controlled list state.
 * @returns a bounded reference list; actions only dispatch parent-owned callbacks.
 */
export declare function References(props: ReferencesProps): ReactNode;
//# sourceMappingURL=references.d.ts.map