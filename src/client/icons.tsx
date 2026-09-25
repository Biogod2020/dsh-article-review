/** Small review controls bundle their artwork so older DSH clients render the same panel. */
import type { ReactNode } from 'react'

export type PaperIconKind = 'read' | 'changes' | 'versions' | 'history' | 'references'
  | 'refresh' | 'up' | 'down' | 'folder' | 'close' | 'edit' | 'sparkle'
  | 'fullscreen' | 'check' | 'shield' | 'code'

const artwork: Record<PaperIconKind, ReactNode> = {
  read: <><path d="M5 2.5h7l3 3V17.5H5z" /><path d="M12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3" /></>,
  changes: <><path d="M4 4h7M4 8h7M4 12h5M4 16h4" /><path d="m11 14 5-5 2 2-5 5-3 1z" /></>,
  versions: <><rect x="2.5" y="3" width="6" height="14" rx="1" /><rect x="11.5" y="3" width="6" height="14" rx="1" /></>,
  history: <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5v5l3 2" /></>,
  references: <><path d="M3.5 5c0-1.5 3-2.5 6.5-2.5s6.5 1 6.5 2.5-3 2.5-6.5 2.5S3.5 6.5 3.5 5Z" /><path d="M3.5 5v5c0 1.5 3 2.5 6.5 2.5s6.5-1 6.5-2.5V5M3.5 10v5c0 1.5 3 2.5 6.5 2.5s6.5-1 6.5-2.5v-5" /></>,
  refresh: <><path d="M16.5 8a6.5 6.5 0 1 0 .3 3.5" /><path d="M16.5 3.5V8H12" /></>,
  up: <path d="m4 12 6-6 6 6" />,
  down: <path d="m4 8 6 6 6-6" />,
  folder: <path d="M2.5 6V4.5A1.5 1.5 0 0 1 4 3h4l2 2h6A1.5 1.5 0 0 1 17.5 6.5V15A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15V6Zm0 2h15" />,
  close: <path d="M4.5 4.5 15.5 15.5M15.5 4.5 4.5 15.5" />,
  edit: <><path d="M10.5 4H5A2 2 0 0 0 3 6v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9.5" /><path d="m10 10 6-6 2 2-6 6-3 1z" /></>,
  sparkle: <><path d="m10 2 1.7 5.3L17 9l-5.3 1.7L10 16l-1.7-5.3L3 9l5.3-1.7zM16.5 15v3M15 16.5h3" /></>,
  fullscreen: <path d="M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4" />,
  check: <><circle cx="10" cy="10" r="7.5" /><path d="m6.5 10 2.3 2.3 4.7-4.7" /></>,
  shield: <><path d="M10 2.5 16 5v5c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V5z" /><path d="m7.5 10 1.8 1.8 3.5-3.5" /></>,
  code: <path d="m7.5 5-5 5 5 5m5-10 5 5-5 5m-1-12-3 14" />,
}

/** Render a decorative review icon; its button supplies the localized accessible name.
 * @param props - icon name and pixel size.
 * @returns one non-interactive SVG.
 */
export function PaperIcon({ kind, size = 16 }: { kind: PaperIconKind; size?: number }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{artwork[kind]}</svg>
}
