/** Demo entry: HTTP actions for the workbench. ?as=NAME opens it as a collaborator (comments only). */
import { createRoot } from 'react-dom/client'
import { ProjectWorkbench } from '../src/client/project/ProjectWorkbench.tsx'
import type { ProjectActions } from '../src/client/project/actions.ts'
import type { ProjectView } from '../src/project/store.ts'
import type { Claim, Project } from '../src/project/model.ts'

const as = new URLSearchParams(location.search).get('as')
const user = as ? { name: as, role: 'collaborator' as const } : { name: 'Jiahao', role: 'author' as const }
const headers = { 'Content-Type': 'application/json', 'X-Demo-User': encodeURIComponent(user.name), 'X-Demo-Role': user.role }

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }
  if (signal) init.signal = signal
  const r = await fetch(`api/${path}`, init)
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j as T
}

const actions: ProjectActions = {
  user,
  view: signal => call<ProjectView>('view', undefined, signal),
  revision: (n, signal) => call<Project>(`revision?n=${n}`, undefined, signal),
  apply: (changes, reason) => call('apply', { changes, reason }),
  comment: (target, text) => call('comment', { target, text }),
  setComment: (id, status) => call('set-comment', { id, status }),
  confirm: keys => call('confirm', { keys }),
  setStage: (stage, reason) => call('stage', { stage, reason }),
  assign: (id, assignee) => call('assign', { id, assignee }),
  markInSync: paragraph => call('in-sync', { paragraph }),
  decideDraft: (id, accept, text) => call('draft', { id, accept, text }),
  claimAt: async (claim, hash) => (await call<{ claim: Claim | null }>(`claim-at?claim=${encodeURIComponent(claim)}&hash=${encodeURIComponent(hash)}`)).claim,
  ask: task => call('ask', { task }),
  asset: path => /^https?:/.test(path) ? path : `asset?path=${encodeURIComponent(path)}`,
}

createRoot(document.getElementById('root')!).render(<ProjectWorkbench actions={actions} />)
