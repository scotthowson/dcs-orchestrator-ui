// =============================================================================
// usePolling — the one way a page, a card or a hook keeps data fresh. A request
// asked now and again every `intervalMs`, through the polling engine (lib/poll):
// paused while the tab is hidden, backing off while it fails, asked again the
// moment the link to the server comes back, and shared with every other poll of
// the same `key`.
//
//   usePolling(fetchStacks, 15000, { key: 'stacks' })
//
// By default a poll runs only while the API link is connected (the connection
// store); requireConnection: false is for the screens before it (setup).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '../stores/connectionStore'
import { PollEntry, pollEntry, refreshAllPolls, type WhenHidden } from '../lib/poll'
import { isLinkFailure } from '../api/errors'

export interface UsePollingOptions {
  /** whether this poll runs at all (default true); it also waits for the API link unless requireConnection is false */
  enabled?: boolean
  /** polls with the same key are one request stream: name the request (and its arguments), e.g. `health:${scope}`.
   *  A new key asks at once (a scope switch); the answer shown stays until the new one lands */
  key?: string
  /** default true: only while the API link is connected */
  requireConnection?: boolean
  /** 'pause' (default): nothing while the tab is hidden, and a fresh answer when it shows; 'run': keeps going */
  whenHidden?: WhenHidden
  /** called with every failed attempt (a cancelled request is not one) */
  onError?: (err: Error) => void
  /** this poll watches the link: a failure of the link (no answer, a gateway error) counts towards "unstable", an answer
   *  says it is fine (connectionStore reportPollFailure / reportPollSuccess) */
  reportsLink?: boolean
}

export interface UsePollingResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  /** ask now, outside the interval (resolves when the answer is in) */
  refresh: () => Promise<void>
  /** the same, under the name some cards use */
  refetch: () => Promise<void>
  /** a request is on its way (the first load and every one after: a refresh button can turn) */
  fetching: boolean
  /** when the answer shown arrived (ms), 0 before the first */
  updatedAt: number
  /** the key the answer shown was asked under: right after a key change the answer of the old key is still shown, and
   *  `dataKey === key` tells the new one (a scope switch never shows the old rows under the new label) */
  dataKey: string | undefined
}

interface PollState<T> { data: T | null; loading: boolean; error: Error | null; updatedAt: number; dataKey: string | undefined }

// the link came back: every poll asks at once (its answers may be from before the drop)
useConnectionStore.subscribe((s, prev) => {
  if (s.status === 'connected' && prev.status !== 'connected') refreshAllPolls()
})

export function usePolling<T>(fetchFn: () => Promise<T>, intervalMs: number, options?: UsePollingOptions): UsePollingResult<T> {
  const { enabled = true, key, requireConnection = true, whenHidden = 'pause', onError, reportsLink = false } = options ?? {}
  const connected = useConnectionStore((s) => s.status === 'connected')
  const active = enabled && (connected || !requireConnection)

  const [state, setState] = useState<PollState<T>>({ data: null, loading: true, error: null, updatedAt: 0, dataKey: undefined })
  const [fetching, setFetching] = useState(false)

  // a poll without a key has an engine entry of its own; a keyed one shares the key's
  const ownRef = useRef<PollEntry<T> | null>(null)
  const entry = key !== undefined ? pollEntry<T>(key, fetchFn) : (ownRef.current ??= new PollEntry<T>(fetchFn))
  // the newest function asks (it closes over the newest arguments)
  entry.fn = fetchFn

  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const reportsRef = useRef(reportsLink)
  reportsRef.current = reportsLink

  useEffect(() => {
    if (!active) {
      setState((s) => (s.loading ? { ...s, loading: false } : s))
      setFetching(false)
      return
    }
    setState((s) => (s.loading ? s : { ...s, loading: true }))
    const unsubscribe = entry.subscribe({
      intervalMs,
      whenHidden,
      onValue: (data, at) => {
        setState({ data, loading: false, error: null, updatedAt: at, dataKey: key })
        if (reportsRef.current) useConnectionStore.getState().reportPollSuccess()
      },
      onError: (err) => {
        setState((s) => ({ ...s, loading: false, error: err }))
        onErrorRef.current?.(err)
        if (reportsRef.current && isLinkFailure(err)) useConnectionStore.getState().reportPollFailure()
      },
      onFetching: setFetching,
    })
    // a request of the entry left behind (another key) is not this poll's any more
    return () => { unsubscribe(); setFetching(false) }
  }, [entry, key, active, intervalMs, whenHidden])

  const refresh = useCallback(() => entry.refresh(), [entry])
  return { ...state, fetching, refresh, refetch: refresh }
}
