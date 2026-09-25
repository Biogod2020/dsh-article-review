import type { ReactNode } from 'react';
/**
 * Dismiss on outside interaction, scrolling or Escape without changing the saved selection.
 * @param props - viewport position and explicit actions.
 * @returns contextual operator controls.
 */
export declare function SelectionMenu({ x, y, title, items, close }: {
    x: number;
    y: number;
    title: string;
    items: {
        label: string;
        color?: string;
        disabled?: boolean;
        run: () => void;
    }[];
    close: () => void;
}): ReactNode;
//# sourceMappingURL=selection-menu.d.ts.map