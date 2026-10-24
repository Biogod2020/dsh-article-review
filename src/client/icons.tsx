/** Small review controls bundle their artwork so older DSH clients render the same panel. */
import type { ReactNode } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Manuscript with a revision pencil; the sidebar supplies size and theme-aware ink. */
export function PaperReviewIcon({ size = 26, className }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5h7.5L18 8v2.5" />
    <path d="M13.5 3.5V8H18M7.5 11.5H13M7.5 15h3" />
    <path d="m13.25 17.25 5.9-5.9a1.2 1.2 0 0 1 1.7 1.7l-5.9 5.9-2.95.75zM18 12.5l1.7 1.7" />
  </svg>
}

export type PaperIconKind = 'read' | 'changes' | 'versions' | 'history' | 'references'
  | 'refresh' | 'up' | 'down' | 'folder' | 'close' | 'edit' | 'sparkle'
  | 'fullscreen' | 'check' | 'shield' | 'code' | 'options' | 'preview' | 'pin' | 'image' | 'dock' | 'float'

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
  options: <><path d="M3 5h14M3 15h14M7 3v4M13 13v4" /><circle cx="7" cy="5" r="2" /><circle cx="13" cy="15" r="2" /></>,
  preview: <><path d="M10 3H4v14h12v-6M12 3h5v5M9 11l8-8" /></>,
  image: <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><circle cx="7" cy="7.5" r="1" /><path d="m3 14 4-4 3 3 3-5 4 6" /></>,
  dock: <><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M12 4v12" /></>,
  float: <><path d="M10 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" /><rect x="9" y="2" width="9" height="8" rx="1.5" /></>,
  pin: <path d="M7 3h6l-1 5 4 4H4l4-4-1-5ZM10 12v6" />,
}

/** Render a decorative review icon; its button supplies the localized accessible name.
 * @param props - icon name and pixel size.
 * @returns one non-interactive SVG.
 */
export function PaperIcon({ kind, size = 16 }: { kind: PaperIconKind; size?: number }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{artwork[kind]}</svg>
}
