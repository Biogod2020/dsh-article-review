import type { ReactNode } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { BibliographyView, FileListing, PaperCommand, PaperView } from '../schema.ts';
/** Operator actions carried over the authenticated DSH connection. */
export interface PaperPanelActions {
    /** @param command - explicit operator gesture. @param signal - tab lifetime. @returns validated persisted state. */
    command: (command: PaperCommand, signal: AbortSignal, sessionId: string) => Promise<PaperView>;
    /**
     * @param path - workspace-relative folder.
     * @param signal - tab lifetime.
     * @param sessionId - native conversation.
     * @returns bounded Markdown listing.
     */
    listFiles: (path: string, signal: AbortSignal, sessionId: string) => Promise<FileListing>;
    /** @returns selected workspace-relative Markdown path, or null when Finder is canceled. */
    pickFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>;
    /** @returns manuscript selected by the operator or agent in this conversation. */
    currentFile: (signal: AbortSignal, sessionId: string) => Promise<string | null>;
    /** Read the manuscript's bound authoritative BibTeX index and citation diagnostics. */
    bibliography: (path: string, signal: AbortSignal, sessionId: string) => Promise<BibliographyView>;
    /** Replace explicit `.bib` bindings; no bibliography or manuscript source is edited. */
    bindBibliography: (path: string, files: string[], signal: AbortSignal, sessionId: string) => Promise<BibliographyView>;
    /** Choose a workspace `.bib` file through Finder on a macOS DSH host. */
    pickBibliography: (signal: AbortSignal, sessionId: string) => Promise<string | null>;
    /** @param path - workspace-relative figure. @returns canonical path for native preview. */
    figurePath: (path: string, signal: AbortSignal, sessionId: string) => Promise<string>;
    /** @param path - workspace-relative PDF. @returns bounded first-page PNG when a renderer is available. */
    figureThumbnail: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>;
    /** @param path - workspace-relative PDF. @returns readable first-page PNG when a renderer is available. */
    figurePage: (path: string, signal: AbortSignal, sessionId: string) => Promise<string | undefined>;
    /** @param path - workspace-relative figure. @returns complete local bytes within DSH's file limit. */
    figureBytes: (path: string, signal: AbortSignal, sessionId: string) => Promise<Uint8Array>;
    /** @param signal - tab lifetime. @param sessionId - idle native conversation. @returns when its normal tools have been restored. */
    leave: (signal: AbortSignal, sessionId: string) => Promise<void>;
}
/** Native sidebar props and locale-owned labels. */
export type PaperPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'paperReview'> & PaperPanelActions;
/** Word-level changes with unchanged surrounding text. @param props - before and after source. @returns accessible diff. */
export declare const WordDiff: import("react").MemoExoticComponent<({ before, after, labels, markdownLabels }: {
    before: string;
    after: string;
    labels: {
        compare: string;
        before: string;
        after: string;
    };
    markdownLabels: {
        code: {
            copyLabel: string;
            copiedLabel: string;
        };
        footnotes: string;
    };
}) => ReactNode>;
/**
 * Keep the current manuscript fixed while fetching new proposal metadata.
 * @param props - native session input actions, sidebar lifetime and operator transport.
 * @returns manuscript workbench.
 */
export declare function PaperPanel({ useTabInfo, useSession, useInput, sessionId, inputActions, t, command, listFiles, pickFile, currentFile, bibliography, bindBibliography, pickBibliography, figurePath, figureThumbnail, figurePage, figureBytes, leave, }: PaperPanelProps): ReactNode;
//# sourceMappingURL=panel.d.ts.map