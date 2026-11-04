// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginUpdates } from '../src/client/plugin-updates.tsx'
afterEach(cleanup)
it('reads status without enabling updates and applies consent only after the user toggles', async () => {
  const view = {enabled:false,supported:true,runningVersion:'1.0.1',phase:'disabled'}
  const call = vi.fn(async (_method: string, payload: Record<string,unknown>) => ({...view,...payload}))
  const {container} = render(<PluginUpdates rpc={{call}} />)
  expect(call).not.toHaveBeenCalled()
  const details=container.querySelector('details')!; details.open=true; fireEvent(details,new Event('toggle'))
  await screen.findByRole('checkbox')
  expect(call.mock.calls.every(([,payload])=>!('enabled' in payload))).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(()=>expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true))
  expect(call.mock.calls.filter(([,payload])=>'enabled' in payload)).toEqual([['paper-review/update',{enabled:true}]])
})
it('keeps the switch off and shows a scheduler failure without retrying the mutation', async () => {
  const call=vi.fn(async (_method: string,payload: Record<string,unknown>)=>{
    if('enabled' in payload)throw Error('Could not configure the user update service')
    return {enabled:false,supported:true,runningVersion:'1.0.1',phase:'disabled'}
  })
  const {container}=render(<PluginUpdates rpc={{call}} />)
  const details=container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'))
  fireEvent.click(await screen.findByRole('checkbox'))
  expect((await screen.findByRole('alert')).textContent).toContain('Could not configure')
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  expect(call.mock.calls.filter(([,payload])=>'enabled' in payload)).toHaveLength(1)
})
