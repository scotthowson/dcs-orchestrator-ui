// =============================================================================
// What a failed request means for the person — the one place that reads an API
// error. Every error the dashboard sees is an ApiError (api/client.ts); this
// sorts it into the outcome the app acts on:
//
//   cancelled     the dashboard dropped it itself (a server switch, a sign-out): nobody sees it
//   signed-out    401: that server's session ended. The client already told serverStore, which
//                 asks for that server's sign-in only (per-server accounts, 4.0.35)
//   forbidden     403: a viewer asked for an admin's thing: read-only, nothing to retry
//   rate-limited  429: wait `retryAfterMs` (the Retry-After header or the body's retry_after)
//   offline       no answer, a timeout, or a proxy that could not reach the API (502/503/504):
//                 the link's trouble. The polls that watch the link count it (usePolling
//                 reportsLink) and the heartbeat turns it into the unreachable screen
//   failed        the API answered with an error of its own (4xx/5xx): its message says why
// =============================================================================

import { ApiError, ApiCancelledError, ApiNetworkError, ApiTimeoutError } from './client'

export type ApiOutcomeKind = 'cancelled' | 'signed-out' | 'forbidden' | 'rate-limited' | 'offline' | 'failed'

export interface ApiOutcome {
  kind: ApiOutcomeKind
  /** the HTTP status (0: no answer) */
  status: number
  /** the server's words, or the error's own */
  message: string
  /** rate-limited: how long to wait before asking again (0 when the server did not say) */
  retryAfterMs: number
}

/** the gateway answers a proxy gives when it cannot reach the API behind it */
const LINK_STATUSES = [502, 503, 504]

export function apiOutcome(err: unknown): ApiOutcome {
  const message = err instanceof Error ? err.message : String(err)
  if (!(err instanceof ApiError)) return { kind: 'failed', status: 0, message, retryAfterMs: 0 }
  const base = { status: err.status, message, retryAfterMs: 0 }
  if (err instanceof ApiCancelledError) return { ...base, kind: 'cancelled' }
  if (err instanceof ApiNetworkError || err instanceof ApiTimeoutError || err.status === 0) return { ...base, kind: 'offline' }
  if (err.status === 401) return { ...base, kind: 'signed-out' }
  if (err.status === 403) return { ...base, kind: 'forbidden' }
  if (err.status === 429) return { ...base, kind: 'rate-limited', retryAfterMs: err.retryAfterMs }
  if (LINK_STATUSES.includes(err.status)) return { ...base, kind: 'offline', retryAfterMs: err.retryAfterMs }
  return { ...base, kind: 'failed' }
}

/** a failure that says something about the link to the server, not about one endpoint */
export function isLinkFailure(err: unknown): boolean {
  return apiOutcome(err).kind === 'offline'
}

/** the message of a failed request, in words (the server's own when it gave one) */
export function apiErrorMessage(err: unknown, fallback = 'The request failed'): string {
  if (err instanceof Error) return err.message || fallback
  return fallback
}

/** the JSON body of an error answer (a `reason`, `rolled_back`, `retry_after` …), {} when it had none */
export function apiErrorData(err: unknown): Record<string, unknown> {
  return err instanceof ApiError && err.data ? err.data : {}
}
