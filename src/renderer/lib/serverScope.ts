// =============================================================================
// serverScope — everything in memory that a server said belongs to that server
// and that session. Leaving it (a switch to another server, a sign-out, a
// session the server ended) empties all of it at once, before the next server
// is shown: each store and cache registers its own reset here, next to its
// definition, and serverStore calls resetServerScope() — one list, so a new
// store cannot be forgotten. The requests still on their way are cancelled and
// the live stream closed by serverStore itself (api/client cancelAll, lib/sse).
// =============================================================================

type Reset = () => void

const resets = new Set<Reset>()

/** run `reset` whenever the dashboard leaves a server; returns the unregister */
export function onServerReset(reset: Reset): () => void {
  resets.add(reset)
  return () => { resets.delete(reset) }
}

/** a zustand store whose whole state is the server's: back to its initial state on leaving */
export function resetsWithServer(store: { setState: (v: never, replace: true) => void; getInitialState: () => unknown }): void {
  onServerReset(() => store.setState(store.getInitialState() as never, true))
}

/** empty every store and cache that holds what the server before said */
export function resetServerScope(): void {
  for (const reset of resets) {
    try { reset() } catch { /* one store failing never keeps the others' data around */ }
  }
}
