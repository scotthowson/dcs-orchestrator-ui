// =============================================================================
// useLiveEvent / useLiveConnected — the React side of the live stream (lib/sse):
// a handler for one kind of event while the component is mounted, and whether
// the stream is open right now (updated when it opens or drops, never polled).
// =============================================================================

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { sseClient, type SSEEventType, type SSEMessage } from '../lib/sse'

/** `handler` gets every event of `type` ('*': every one but the chat) while mounted; the newest handler is called */
export function useLiveEvent<K extends SSEEventType>(type: K | '*', handler: (event: SSEMessage<K>) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => sseClient.on(type as K, (event) => ref.current(event)), [type])
}

const subscribe = (fn: () => void) => sseClient.onStatus(fn)
const snapshot = () => sseClient.isConnected()

/** whether the live stream is open */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
