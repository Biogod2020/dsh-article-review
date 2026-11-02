/** What the project workbench needs from its host: the DSH connection in the plugin, HTTP in the demo. */
import type { Change, Claim, Comment, Project, Stage, Target } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { Persona } from '../../project/prompts.ts'

/** Work handed to the agent. The host decides how: the plugin posts it into the conversation, the demo runs a model. */
export type AgentTask =
  | { kind: 'skeleton' }
  | { kind: 'persona', persona: Persona, focus: string }
  | { kind: 'refine', comments: string[] }
  | { kind: 'draft', beat: string }
  | { kind: 'resync', paragraphs: string[] }
  | { kind: 'chat', text: string, target: Target }
  | { kind: 'numbers' }

export interface ProjectUser { name: string, role: 'author' | 'collaborator' }

export interface ProjectActions {
  user: ProjectUser
  view(signal?: AbortSignal): Promise<ProjectView>
  revision(n: number, signal?: AbortSignal): Promise<Project>
  /** Author edits go through the same recorded path as agent edits. */
  apply(changes: Change[], reason: string): Promise<ProjectView>
  comment(target: Target, text: string): Promise<ProjectView>
  setComment(id: string, status: Comment['status']): Promise<ProjectView>
  confirm(keys: string[]): Promise<ProjectView>
  /** reason is required when entering submit with unmet checklist items */
  setStage(stage: Stage, reason?: string): Promise<ProjectView>
  assign(comment: string, assignee: string): Promise<ProjectView>
  markInSync(paragraph: string): Promise<ProjectView>
  /** Accept (replace the paragraph) or discard a rewrite draft. */
  decideDraft(id: string, accept: boolean, text?: string): Promise<ProjectView>
  /** The claim as it was when a paragraph was written (basis hash), or null if no snapshot matches. */
  claimAt(claim: string, hash: string): Promise<Claim | null>
  /** Start agent work; resolves when the host has finished or handed it over, with a line for the activity log. */
  ask(task: AgentTask): Promise<{ summary: string, view?: ProjectView }>
  /** URL for a project image when the host can serve one directly (demo). */
  asset(path: string): string
  /** Load a project image as a data or blob URL when it cannot be linked directly (DSH). */
  loadAsset?(path: string): Promise<string>
}
