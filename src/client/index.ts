/** Native right-sidebar registration; source files keep their ordinary default preview. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import { z } from 'zod'
import { BibliographyViewSchema, FileListingSchema, ViewSchema } from '../schema.ts'
import { PaperPanel, type PaperPanelActions } from './panel.tsx'
import { en, zh } from './locales.ts'

/** Browser dependencies supplied by the Web profile. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'connection', 'remote', 'remote.workspaceFiles']
/**
 * Contribute the explicit Paper review page and its operator transport.
 * @param ctx - Client context with authenticated connection and native sidebar seats.
 */
export function apply(ctx: Context): void {
  const id = '@deepseek-ai/dsh-experimental-paper-review'
  const t = ctx.locale.bind('paperReview')
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register('paperReview', { zh, en }))
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind: 'paper-review', priority: 'extension', title: () => t('title'),
    guide: [{ id: 'paper', order: 5, title: () => t('guide'), description: () => t('description') }],
    keepMounted: true,
  }))
  const resolveFigure = async (path: string, signal: AbortSignal, sessionId: string): Promise<string> => {
    const result = await connection.rpc.call('/api', 'paper-review/figure-path', { sessionId, path }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return z.object({ path: z.string() }).parse(result.value).path
  }
  const actions: PaperPanelActions = {
    async command(command, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/command', { sessionId, command }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return ViewSchema.parse(result.value)
    },
    async listFiles(path, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/list-files', { sessionId, path }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return FileListingSchema.parse(result.value)
    },
    async pickFile(signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/pick-file', { sessionId }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ path: z.string().nullable() }).parse(result.value).path
    },
    async currentFile(signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/current', { sessionId }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ path: z.string().nullable() }).parse(result.value).path
    },
    async bibliography(path, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/bibliography', { sessionId, path }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return BibliographyViewSchema.parse(result.value)
    },
    async bindBibliography(path, files, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/bind-bibliography', { sessionId, path, files }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return BibliographyViewSchema.parse(result.value)
    },
    async pickBibliography(signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/pick-bibliography', { sessionId }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ path: z.string().nullable() }).parse(result.value).path
    },
    async pickFigure(signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/pick-figure', { sessionId }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ path: z.string().nullable() }).parse(result.value).path
    },
    async listFigureFiles(path, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/list-files', { sessionId, path, extension: 'figure' }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return FileListingSchema.parse(result.value)
    },
    async replaceFigure(path, input, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/replace-figure', { sessionId, path, ...input }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return ViewSchema.parse(result.value)
    },
    figurePath: resolveFigure,
    async figureThumbnail(path, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/figure-thumbnail', { sessionId, path, size: 'thumb' }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ url: z.string().optional() }).parse(result.value).url
    },
    async figurePage(path, signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/figure-thumbnail', { sessionId, path, size: 'full' }, signal)
      if (!result.ok) throw new Error(result.error.message)
      return z.object({ url: z.string().optional() }).parse(result.value).url
    },
    async figureBytes(path, signal, sessionId) {
      const source = await resolveFigure(path, signal, sessionId)
      const result = await ctx.remote.workspaceFiles.readBytes(sessionId as SessionId, source, {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value.data
    },
    async leave(signal, sessionId) {
      const result = await connection.rpc.call('/api', 'paper-review/leave', { sessionId }, signal)
      if (!result.ok) throw new Error(result.error.message)
    },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id, locale: 'paperReview', inject: () => actions,
  }, PaperPanel)))
}
