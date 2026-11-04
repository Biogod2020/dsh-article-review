/** Small review controls bundle their artwork so older DSH clients render the same panel. */
import type { ReactNode } from 'react';
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives';
/** Manuscript with a revision pencil; the sidebar supplies size and theme-aware ink. */
export declare function PaperReviewIcon({ size, className }: IconProps): ReactNode;
export type PaperIconKind = 'read' | 'changes' | 'versions' | 'history' | 'references' | 'refresh' | 'up' | 'down' | 'folder' | 'close' | 'edit' | 'sparkle' | 'fullscreen' | 'check' | 'shield' | 'code' | 'options' | 'preview' | 'pin' | 'image' | 'dock' | 'float';
/** Render a decorative review icon; its button supplies the localized accessible name.
 * @param props - icon name and pixel size.
 * @returns one non-interactive SVG.
 */
export declare function PaperIcon({ kind, size }: {
    kind: PaperIconKind;
    size?: number;
}): ReactNode;
