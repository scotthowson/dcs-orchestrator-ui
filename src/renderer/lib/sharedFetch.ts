// =============================================================================
// sharedFetch — one request for many callers. Every page, card and the sidebar
// ask the hub the same question (its fleet role, its VMs) when they mount; the
// first call goes out, the others share its answer while it is in flight and for
// a few seconds after. Kept per server and per session (apiClient.getScopeKey), so
// switching servers or signing in again never shows the answer of the one before.
// =============================================================================

import { apiClient } from '../api/client'

export interface SharedFetch<T> {
  (): Promise<T>
  /** forget the kept answer: the next call asks again (after an action that changes it) */
  invalidate: () => void
}

export function sharedFetch<T>(fn: () => Promise<T>, maxAgeMs: number): SharedFetch<T> {
  let inflight: { base: string; promise: Promise<T> } | null = null
  let kept: { base: string; at: number; value: T } | null = null
  const call = (() => {
    const base = apiClient.getScopeKey()
    if (kept && kept.base === base && Date.now() - kept.at < maxAgeMs) return Promise.resolve(kept.value)
    if (inflight && inflight.base === base) return inflight.promise
    const promise: Promise<T> = fn()
      .then((value) => { kept = { base, at: Date.now(), value }; return value })
      .finally(() => { if (inflight?.promise === promise) inflight = null })
    inflight = { base, promise }
    return promise
  }) as SharedFetch<T>
  call.invalidate = () => { kept = null; inflight = null }
  return call
}
