// =============================================================================
// SSE Client — EventSource wrapper for real-time server push
// =============================================================================

import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { apiClient } from '../api/client'

export type SSEEventType = 'docker-event' | 'metrics' | 'log-line' | 'health-score' | 'keepalive' | 'chat'

export interface SSEMessage {
  type: SSEEventType
  data: unknown
  timestamp: string
}

type SSEListener = (event: SSEMessage) => void

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
  private eventSource: EventSource | null = null
  private listeners: Map<SSEEventType | '*', Set<SSEListener>> = new Map()
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

    const { serverUrl } = useSettingsStore.getState()
    // Pass auth token as query parameter since EventSource can't set headers;
    // on a hub, fleet=1 adds every VM's docker events and member=<id> asks for one VM's
    const params = new URLSearchParams()
    const token = apiClient.getAuthToken()
    if (token) params.set('token', token)
    if (this.scope === 'all') params.set('fleet', '1')
    else if (this.scope !== 'hub') params.set('member', this.scope)
    const query = params.toString()
    const url = `${serverUrl}/stream${query ? `?${query}` : ''}`

    try {
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = () => {
        this._connected = true
        this._authFailed = false
        this.reconnectAttempts = 0
      }

      // chat: the server's room (stores/chatStore), for a signed-in person while the room is on
      const eventTypes: SSEEventType[] = ['docker-event', 'metrics', 'log-line', 'health-score', 'chat']
      for (const type of eventTypes) {
        this.eventSource.addEventListener(type, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data)
            const msg: SSEMessage = { type, data, timestamp: new Date().toISOString() }
            this.emit(type, msg)
            // the chat is people talking, not server activity: only its own listeners hear it
            if (type !== 'chat') this.emit('*', msg)
          } catch {
            // ignore parse errors
          }
        })
      }

      this.eventSource.onerror = () => {
        this._connected = false
        // Check if this was an auth failure (EventSource fires onerror for HTTP errors)
        // If readyState is CLOSED and we never connected, likely 401
        if (this.eventSource?.readyState === EventSource.CLOSED && this.reconnectAttempts === 0) {
          this._authFailed = true
        }
        this.eventSource?.close()
        this.eventSource = null
        this.scheduleReconnect()
      }
    } catch {
      this.scheduleReconnect()
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
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected
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

  on(type: SSEEventType | '*', listener: SSEListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
    return () => this.listeners.get(type)?.delete(listener)
  }

  off(type: SSEEventType | '*', listener: SSEListener): void {
    this.listeners.get(type)?.delete(listener)
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
