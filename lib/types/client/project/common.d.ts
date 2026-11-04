import type { ReactNode } from 'react';
import type React from 'react';
import type { Comment, Evidence, Stage, Target } from '../../project/model.ts';
import type { ReviewStatus } from '../../project/units.ts';
import type { ProjectView } from '../../project/store.ts';
export declare const STAGE_LABEL: Record<Stage, string>;
export declare const STAGE_HINT: Record<Stage, string>;
export declare const SOURCE_LABEL: Record<Comment['source'], string>;
export declare const STATUS_LABEL: Record<Comment['status'], string>;
export declare const EV_KIND: Record<Evidence['kind'], string>;
export declare const EV_STATUS: Record<Evidence['status'], string>;
export declare const REVIEW_LABEL: Record<ReviewStatus, string>;
export declare const cx: (...xs: (string | false | undefined | null)[]) => string;
export declare function ReviewDot({ status }: {
    status: ReviewStatus | undefined;
}): ReactNode;
/** One bar segment per supporting/limiting item, coloured by status: how much the claim stands on. */
export declare function EvidenceBar({ evidence }: {
    evidence: Evidence[];
}): ReactNode;
/** Word-level difference; whole numbers stay one token because diffWordsWithSpace splits on spaces only. */
export declare function WordDiff({ before, after }: {
    before: string;
    after: string;
}): ReactNode;
export declare function SourceTag({ c }: {
    c: Comment;
}): ReactNode;
/** Where a unit key or comment target lives, for jumping there; `from` is the comment the jump started at. */
export interface Focus {
    kind: Target['kind'];
    id: string;
    from?: string;
}
/** A paragraph as a person names it: section, position and opening words, not its internal id. */
export declare function paraLabel(view: ProjectView | undefined, id: string): string;
export declare const unitFocus: (key: string) => Focus;
/**
 * A comment with its reply and the author's controls. The reply lists what the answering revision actually changed
 * (each a link to the change) and any paragraph rewrites still waiting, so a reply can be checked against the record.
 */
export declare function CommentCard({ c, view, onStatus, onGo, canDecide, targetLabel, onAssign }: {
    c: Comment;
    view?: ProjectView;
    onStatus?: (s: Comment['status']) => void;
    onGo?: (f: Focus) => void;
    canDecide: boolean;
    targetLabel?: string;
    onAssign?: (name: string) => void;
}): ReactNode;
/** Write a comment; the author can also hand it straight to the agent (the usual way of working). */
export declare function CommentBox({ target, onSave, onSaveAndAsk, placeholder, author }: {
    target: Target;
    onSave: (t: Target, text: string) => Promise<void>;
    onSaveAndAsk?: (t: Target, text: string) => Promise<void>;
    placeholder?: string;
    author: string;
}): ReactNode;
export declare function Empty({ children }: {
    children: ReactNode;
}): ReactNode;
/** A project image: linked directly when the host serves files, otherwise loaded once and cached. */
export declare function AssetImg({ actions, path, ...rest }: {
    actions: {
        asset(p: string): string;
        loadAsset?(p: string): Promise<string>;
    };
    path: string;
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'>): ReactNode;
