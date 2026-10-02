/** Small review controls bundle their artwork so older DSH clients render the same panel. */
import type { ReactNode } from 'react';
export type PaperIconKind = 'read' | 'changes' | 'versions' | 'history' | 'references' | 'refresh' | 'up' | 'down' | 'folder' | 'close' | 'edit' | 'sparkle' | 'fullscreen' | 'check' | 'shield' | 'code';
/** Render a decorative review icon; its button supplies the localized accessible name.
 * @param props - icon name and pixel size.
 * @returns one non-interactive SVG.
 */
export declare function PaperIcon({ kind, size }: {
    kind: PaperIconKind;
    size?: number;
}): ReactNode;
//# sourceMappingURL=icons.d.ts.map