/** Context insertion for current composers and the installed DSH 0.1.6 action interface. */
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ComposerActions = Pick<InputActions, 'setDraft'> & Partial<Pick<InputActions, 'captureInsertion' | 'insertText'>>
const INSERTED = 'inserted'
const BUSY = 'busy'
const REFERENCES = 'references'

/**
 * Insert context without sending it or flattening existing reference chips.
 * @param actions - native composer actions; DSH 0.1.6 only exposes setDraft.
 * @param state - current draft, reference occurrences and submission phase.
 * @param text - review context selected by the operator.
 * @returns insertion success, a busy editor, or references unsupported by the older interface.
 */
export function attachContext(actions: ComposerActions, state: Pick<InputState, 'draft' | 'occurrences' | 'phase'>, text: string): 'inserted' | 'busy' | 'references' {
  if (state.phase !== 'plain') return BUSY
  if (actions.captureInsertion && actions.insertText) {
    return actions.insertText(text, actions.captureInsertion()) ? INSERTED : BUSY
  }
  if (state.occurrences.length > 0) return REFERENCES
  actions.setDraft(state.draft ? `${state.draft}\n\n${text}` : text)
  return INSERTED
}
