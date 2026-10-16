import { clientBundle } from '../../client/tsdown.client.ts'

const preset = clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })

export default (options: Parameters<typeof preset>[0]) => preset(options).map(bundle => {
  if (bundle.platform !== 'browser') return bundle
  const { neverBundle, alwaysBundle } = bundle.deps ?? {}
  if (typeof neverBundle !== 'function' || typeof alwaysBundle !== 'function') throw new Error('DSH client dependency predicates are required')
  // Official Desktop rc.2 predates the shared zod module introduced in alpha.4.
  return { ...bundle, deps: { ...bundle.deps,
    neverBundle: (specifier: string) => specifier !== 'zod' && neverBundle(specifier),
    alwaysBundle: (specifier: string) => specifier === 'zod' || alwaysBundle(specifier),
  } }
})
