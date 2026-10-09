// =============================================================================
// poll — the dashboard's one polling engine (hooks/usePolling is its React face).
//
// A poll is a request asked again on an interval. Polls that name the same `key`
// are one request stream: it runs at the shortest interval any of them asks for,
// every one of them gets each answer, and one that mounts while the last answer is
// younger than its own interval shows that answer at once instead of asking again.
// (The sidebar, the status bar, a page and its cards all ask for the stacks, the
// fleet role, the containers…: one request serves them.)
//
//   · hidden tab      polls pause, and ask at once when the tab shows again (when their last
//                     request is 5 s old or more); whenHidden: 'run' keeps one going
//   · errors          the next try backs off (2×, 4×… the interval, at most a minute
//                     beyond it); a 429 waits for its Retry-After; a cancelled request
//                     (server switch) is nobody's error
//   · reconnect       every poll asks at once when the link comes back (refreshAllPolls)
//   · server switch   every kept answer goes (serverScope), and an answer that lands
//                     after the switch is dropped
//   · a refresh       asked for while a request is on its way runs right after it
// =============================================================================

import { apiClient } from '../api/client'
import { apiOutcome } from '../api/errors'
import { onServerReset } from './serverScope'

export type WhenHidden = 'pause' | 'run'

export interface PollSubscriber<T> {
  intervalMs: number
  whenHidden: WhenHidden
  onValue: (data: T, at: number) => void
  onError: (err: Error) => void
  /** a request of this poll went out (true) or came back (false) */
  onFetching?: (fetching: boolean) => void
}

/** the longest a failing poll waits beyond its own interval */
const MAX_BACKOFF_MS = 60000
/** a poll asked less than this long ago does not ask again when the tab shows */
const SHOW_REFRESH_FLOOR_MS = 5000

const hidden = () => typeof document !== 'undefined' && document.hidden

export class PollEntry<T> {
  /** the last answer: the server and session it came from (apiClient scope key) and when */
  value: { scope: string; at: number; data: T } | null = null
  fn: () => Promise<T>
  private subs = new Set<PollSubscriber<T>>()
  private inflight = false
  private queued = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** when the last attempt started: the schedule is fixed-rate, like setInterval */
  private startedAt = 0
  private failures = 0
  private notBefore = 0
  /** refreshes asked for while a request was on its way: told when the one after it lands */
  private waiters: (() => void)[] = []

  constructor(fn: () => Promise<T>) {
    this.fn = fn
  }

  /** the last answer, when it belongs to the server and session in use */
  current(): { at: number; data: T } | null {
    return this.value && this.value.scope === apiClient.getScopeKey() ? this.value : null
  }

  subscribe(sub: PollSubscriber<T>): () => void {
    this.subs.add(sub)
    if (this.inflight) sub.onFetching?.(true)
    subscribed.add(this as PollEntry<unknown>)
    const kept = this.current()
    // an answer younger than this poll's interval (and newer than the last reconnect) is shown as it is
    if (kept && kept.at >= askedAllAt && Date.now() - kept.at < sub.intervalMs) {
      sub.onValue(kept.data, kept.at)
      this.schedule()
    } else if (!this.inflight) {
      void this.run()
    }
    return () => {
      this.subs.delete(sub)
      if (this.subs.size === 0) {
        this.clearTimer()
        subscribed.delete(this as PollEntry<unknown>)
      } else {
        this.schedule()
      }
    }
  }

  /** ask now (or right after the request on its way); resolves when that answer is in. With nobody polling, the next poll
   *  that mounts asks */
  refresh(): Promise<void> {
    if (this.subs.size === 0) {
      if (this.value) this.value = { ...this.value, at: 0 }
      return Promise.resolve()
    }
    if (this.inflight) {
      this.queued = true
      return new Promise((resolve) => this.waiters.push(resolve))
    }
    return this.run()
  }

  /** forget everything of the server before */
  reset(): void {
    this.value = null
    this.failures = 0
    this.notBefore = 0
  }

  /** the tab shows again: the polls that paused ask at once (unless they asked moments ago: flipping tabs is no burst) */
  resume(): void {
    if (this.subs.size === 0) return
    const paused = [...this.subs].some((s) => s.whenHidden === 'pause')
    if (paused && Date.now() - this.startedAt >= SHOW_REFRESH_FLOOR_MS) void this.run()
    else this.schedule()
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  schedule(): void {
    this.clearTimer()
    if (this.inflight) return
    const active = [...this.subs].filter((s) => s.whenHidden === 'run' || !hidden())
    if (!active.length) return
    const interval = Math.min(...active.map((s) => s.intervalMs))
    const delay = this.failures ? Math.min(interval * 2 ** this.failures, interval + MAX_BACKOFF_MS) : interval
    const due = Math.max(this.startedAt + delay, this.notBefore)
    this.timer = setTimeout(() => { this.timer = null; void this.run() }, Math.max(0, due - Date.now()))
  }

  async run(): Promise<void> {
    if (this.inflight) { this.queued = true; return }
    this.clearTimer()
    this.inflight = true
    this.startedAt = Date.now()
    for (const s of this.subs) s.onFetching?.(true)
    const scope = apiClient.getScopeKey()
    try {
      const data = await this.fn()
      if (scope === apiClient.getScopeKey()) {
        const at = Date.now()
        this.failures = 0
        this.notBefore = 0
        this.value = { scope, at, data }
        for (const s of [...this.subs]) s.onValue(data, at)
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      const outcome = apiOutcome(err)
      if (outcome.kind !== 'cancelled' && scope === apiClient.getScopeKey()) {
        this.failures = Math.min(this.failures + 1, 6)
        if (outcome.retryAfterMs > 0) this.notBefore = Date.now() + outcome.retryAfterMs
        for (const s of [...this.subs]) s.onError(err)
      }
    } finally {
      this.inflight = false
      for (const s of [...this.subs]) s.onFetching?.(false)
      const waiters = this.waiters
      this.waiters = []
      if (this.queued && this.subs.size > 0) {
        this.queued = false
        void this.run().then(() => waiters.forEach((w) => w()))
      } else {
        this.queued = false
        waiters.forEach((w) => w())
        this.schedule()
      }
    }
  }
}

/** the entries some poll is subscribed to (keyed or not): the visibility and reconnect handlers reach them all */
const subscribed = new Set<PollEntry<unknown>>()
const keyed = new Map<string, PollEntry<unknown>>()
/** the last reconnect: an answer from before it is never shown as current to a poll that mounts */
let askedAllAt = 0

/** the shared entry of a key (made with `fn` the first time) */
export function pollEntry<T>(key: string, fn: () => Promise<T>): PollEntry<T> {
  let e = keyed.get(key) as PollEntry<T> | undefined
  if (!e) {
    e = new PollEntry<T>(fn)
    keyed.set(key, e as PollEntry<unknown>)
  }
  return e
}

/** ask a key again now — every poll of it gets the answer (after an action that changed what it lists) */
export function refreshPoll(key: string): Promise<void> {
  return keyed.get(key)?.refresh() ?? Promise.resolve()
}

/** the last answer of a key from this server and session, however old (null: none) */
export function lastPollValue<T>(key: string): T | null {
  return (keyed.get(key)?.current()?.data as T | undefined) ?? null
}

/** the link came back: every poll asks at once, and a poll that mounts asks too */
export function refreshAllPolls(): void {
  askedAllAt = Date.now()
  for (const e of subscribed) void e.run()
}

// the answers of a poll that is not keyed carry the scope they came from, and current() ignores another's
onServerReset(() => {
  for (const e of keyed.values()) e.reset()
})

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    for (const e of subscribed) {
      if (hidden()) e.schedule()   // only the polls that run in the background keep a timer
      else e.resume()
    }
  })
}
