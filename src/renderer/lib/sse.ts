// =============================================================================
// SSE — the dashboard's one live stream (GET /stream): one request for the
// whole app, read with fetch as it arrives so the session goes in the
// Authorization header (EventSource can only put it in the address, which
// proxies log). Opened by App.tsx while the API link is connected and closed
// when the dashboard leaves a server. Pages and cards subscribe to the events they
// want (on / useLiveEvent) and to whether it is open (onStatus /
// useLiveConnected); it reconnects by itself with a backoff.
// =============================================================================

import { useConnectionStore } from '../stores/connectionStore'
import { apiClient } from '../api/client'
import type { ChatLiveEvent, SSEMetricsEvent } from '../../shared/types'

/** what each event of the stream carries */
export interface SSEEventMap {
  /** a Docker event (on a hub with fleet=1 or member=<id>, tagged with the VM it came from: fleetTagOf) */
  'docker-event': Record<string, unknown>
  metrics: SSEMetricsEvent
  'log-line': Record<string, unknown>
  'health-score': Record<string, unknown>
  keepalive: Record<string, unknown>
  /** the server's chat room (stores/chatStore), for a signed-in person while the room is on */
  chat: ChatLiveEvent
}

export type SSEEventType = keyof SSEEventMap

export interface SSEMessage<K extends SSEEventType = SSEEventType> {
  type: K
  data: SSEEventMap[K]
  timestamp: string
}

type SSEListener = (event: SSEMessage) => void
type StatusListener = (connected: boolean) => void

/** the events the stream sends that a listener can get (keepalive only keeps the connection open) */
const STREAMED: SSEEventType[] = ['docker-event', 'metrics', 'log-line', 'health-score', 'chat']

/** What the stream carries on a hub: the hub's own docker events ('hub'), every VM's too ('all'), or one VM's (its member id) */
export type SSEScope = 'hub' | 'all' | (string & {})

/** The tag a hub puts on a VM's event: which member it came from (null = the hub itself) */
export interface FleetTag { member: string | null; member_name?: string; vmid?: number | null }

/** The fleet tag in an event's data, null when it carries none */
export function fleetTagOf(data: unknown): FleetTag | null {
  if (!data || typeof data !== 'object' || !('member' in data)) return null
  const d = data as { member?: unknown; member_name?: unknown; vmid?: unknown }
  return {
    member: typeof d.member === 'string' && d.member ? d.member : null,
    member_name: typeof d.member_name === 'string' ? d.member_name : undefined,
    vmid: typeof d.vmid === 'number' ? d.vmid : null,
  }
}

class SSEClient {
  /** the open request (aborted to close the stream) */
  private abort: AbortController | null = null
  private listeners: Map<SSEEventType | '*', Set<SSEListener>> = new Map()
  private statusListeners = new Set<StatusListener>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 20
  private _connected = false
  private _authFailed = false
  private scope: SSEScope = 'hub'
  /** connect() was asked for and disconnect() has not been since (a scope change then reconnects at once) */
  private wanted = false

  connect(): void {
    // close what is open without forgetting the retry count: disconnect() also resets it, which made every
    // reconnect start the backoff from zero (and the give-up limits never trigger)
    this.closeSource()
    this.wanted = true
    this._authFailed = false

    // on a hub, fleet=1 adds every VM's docker events and member=<id> asks for one VM's. The session rides in the
    // Authorization header, never in the address (proxies and the API log addresses)
    const params = new URLSearchParams()
    if (this.scope === 'all') params.set('fleet', '1')
    else if (this.scope !== 'hub') params.set('member', this.scope)
    const query = params.toString()
    // the server every request goes to (api/client): one address for both
    const url = `${apiClient.getBaseUrl()}/stream${query ? `?${query}` : ''}`
    const token = apiClient.getAuthToken()
    const abort = new AbortController()
    this.abort = abort
    void this.read(url, token, abort)
  }

  /** read the stream until it ends, fails or is closed; a stream that ends while wanted is opened again after a pause */
  private async read(url: string, token: string | null, abort: AbortController): Promise<void> {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
        signal: abort.signal,
      })
      if (!res.ok || !res.body) {
        // a refused session: retry rarely (the sign-in flow deals with the session itself)
        if (res.status === 401 || res.status === 403) this._authFailed = true
        throw new Error(`stream answered ${res.status}`)
      }
      this._authFailed = false
      this.reconnectAttempts = 0
      this.setConnected(true)
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let event = 'message'
      let data: string[] = []
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let nl: number
        while ((nl = buffer.search(/\r\n|\n|\r/)) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1))
          if (line === '') {
            if (data.length) this.dispatch(event, data.join('\n'))
            event = 'message'
            data = []
          } else if (line.startsWith(':')) {
            // a comment (the server's heartbeat)
          } else {
            const colon = line.indexOf(':')
            const field = colon < 0 ? line : line.slice(0, colon)
            const v = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
            if (field === 'event') event = v
            else if (field === 'data') data.push(v)
          }
        }
      }
    } catch {
      // closed by us (abort), refused, or the connection dropped: the checks below tell which
    }
    if (this.abort !== abort) return   // closed or replaced by connect()/disconnect()
    this.abort = null
    this.setConnected(false)
    this.scheduleReconnect()
  }

  private dispatch(event: string, raw: string): void {
    const type = event as SSEEventType
    if (!STREAMED.includes(type)) return
    try {
      const msg = { type, data: JSON.parse(raw), timestamp: new Date().toISOString() } as SSEMessage
      this.emit(type, msg)
      // the chat is people talking, not server activity: only its own listeners hear it
      if (type !== 'chat') this.emit('*', msg)
    } catch {
      // ignore parse errors
    }
  }

  /** the stream is not wanted any more: close it and start the retry count afresh next time */
  disconnect(): void {
    this.wanted = false
    this.closeSource()
    this.reconnectAttempts = 0
  }

  private closeSource(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.abort) {
      const abort = this.abort
      this.abort = null
      abort.abort()
    }
    this.setConnected(false)
  }

  private setConnected(connected: boolean): void {
    if (connected === this._connected) return
    this._connected = connected
    for (const fn of this.statusListeners) {
      try { fn(connected) } catch { /* ignore listener errors */ }
    }
  }

  isConnected(): boolean {
    return this._connected
  }

  /** told whenever the stream opens or drops; returns the unsubscribe */
  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  getScope(): SSEScope {
    return this.scope
  }

  /** Reconnects with the new scope at once when the stream is running; the same scope again does nothing */
  setScope(scope: SSEScope): void {
    if (scope === this.scope) return
    this.scope = scope
    if (this.wanted) this.connect()
  }

  /** every event of one type ('*': every one but the chat); returns the unsubscribe */
  on<K extends SSEEventType>(type: K, listener: (event: SSEMessage<K>) => void): () => void
  on(type: '*', listener: SSEListener): () => void
  on(type: SSEEventType | '*', listener: (event: never) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    const fn = listener as SSEListener
    this.listeners.get(type)!.add(fn)
    return () => { this.listeners.get(type)?.delete(fn) }
  }

  private emit(type: SSEEventType | '*', event: SSEMessage): void {
    this.listeners.get(type)?.forEach(fn => {
      try { fn(event) } catch { /* ignore listener errors */ }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    const { status } = useConnectionStore.getState()
    if (status === 'disconnected') return

    // If auth failed, use long backoff (don't spam 401s) — retry every 60s max 5 times
    if (this._authFailed) {
      if (this.reconnectAttempts >= 5) return
      const delay = 60000
      this.reconnectAttempts++
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
      return
    }

    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)), 30000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

export const sseClient = new SSEClient()
