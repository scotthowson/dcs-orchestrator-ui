import { create } from 'zustand'
import { ConnectionStatus } from '../../shared/types'
import { apiClient } from '../api/client'
import { useNotificationStore } from './notificationStore'
import { useAuthStore } from './authStore'

// retries run about every 10 s once backed off: this is roughly 25 minutes before the dashboard stops trying by itself
export const MAX_RECONNECT_ATTEMPTS = 150
const BASE_RECONNECT_DELAY_MS = 1000
const HEARTBEAT_INTERVAL_MS = 10000

interface ConnectionState {
  status: ConnectionStatus
  serverUrl: string
  lastError: string | null
  lastConnected: number | null
  reconnectAttempts: number
  consecutiveFailures: number
  /** heartbeats (a check every 10 s) that failed in a row, while the link still counts as connected */
  heartbeatFailures: number
  latencyMs: number | null
  setServerUrl: (url: string) => void
  setStatus: (status: ConnectionStatus) => void
  setError: (error: string | null) => void
  connect: () => Promise<boolean>
  disconnect: () => void
  reportPollSuccess: () => void
  reportPollFailure: () => void
}

let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** The latency shown is the median of the last few heartbeats: one slow hop does not flip it */
const LATENCY_SAMPLES = 5
let latencySamples: number[] = []
function recordLatency(ms: number): number {
  latencySamples = [...latencySamples.slice(-(LATENCY_SAMPLES - 1)), ms]
  const sorted = [...latencySamples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Push a connection notification with cooldown to prevent flood */
let lastConnNotifTime = 0
let lastConnNotifType = ''
const CONN_NOTIF_COOLDOWN_MS = 60000 // 60 seconds between same-type notifications

function pushConnectionNotification(type: 'success' | 'error' | 'warning', title: string, message: string) {
  const { preferences, addNotification } = useNotificationStore.getState()
  if (!preferences.connectionAlerts) return
  // Deduplicate: skip if same type was sent within cooldown
  const now = Date.now()
  if (type === lastConnNotifType && now - lastConnNotifTime < CONN_NOTIF_COOLDOWN_MS) return
  lastConnNotifTime = now
  lastConnNotifType = type
  addNotification({ type, title, message, persist: type === 'error', action: { label: 'View Dashboard', page: 'dashboard' } })
}

let heartbeatFailCount = 0
let pollReconnectTimer: ReturnType<typeof setTimeout> | null = null
const POLL_RECONNECT_DELAY_MS = 5000
const HEARTBEAT_FAIL_THRESHOLD = 3 // require 3 consecutive failures (30s) before declaring disconnected

function startHeartbeat(connectFn: () => Promise<boolean>) {
  stopHeartbeat()
  heartbeatFailCount = 0
  let lastBeatAt = Date.now()
  heartbeatTimer = setInterval(async () => {
    try {
      const beatAt = Date.now()
      const t0 = performance.now()
      const ok = await apiClient.testConnection()
      // the ping can wait behind the dashboard's own requests (six connections per server) and time out while the server
      // answers everything else: a beat is missed only when nothing at all answered since the one before
      const alive = !ok && apiClient.answeredSince(lastBeatAt)
      lastBeatAt = beatAt
      if (ok) {
        heartbeatFailCount = 0
        useConnectionStore.setState({ latencyMs: recordLatency(Math.round(performance.now() - t0)), heartbeatFailures: 0 })
      } else if (alive) {
        heartbeatFailCount = 0
        useConnectionStore.setState({ heartbeatFailures: 0 })
      } else {
        heartbeatFailCount++
        useConnectionStore.setState({ heartbeatFailures: heartbeatFailCount })
        // Only declare connection lost after multiple consecutive failures.
        // The DCS API server is single-threaded bash — it can't respond to heartbeat
        // pings while serving a large request (compose file load, image pull, etc).
        // 3 failures × 10s = 30 seconds of unresponsiveness before we declare disconnected.
        if (heartbeatFailCount >= HEARTBEAT_FAIL_THRESHOLD) {
          const store = useConnectionStore.getState()
          if (store.status === 'connected') {
            store.setStatus('error')
            store.setError('Lost connection to API server')
            pushConnectionNotification('error', 'Connection Lost', 'Lost connection to the API server. Attempting to reconnect...')
            connectFn()
          }
        }
      }
    } catch {
      // Swallow unexpected errors in heartbeat — don't let them crash the interval
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  serverUrl: apiClient.getBaseUrl(),
  lastError: null,
  lastConnected: null,
  reconnectAttempts: 0,
  consecutiveFailures: 0,
  heartbeatFailures: 0,
  latencyMs: null,

  setServerUrl: (url) => {
    apiClient.setBaseUrl(url)
    latencySamples = []
    set({ serverUrl: url, latencyMs: null })
  },

  setStatus: (status) => set({ status }),

  setError: (error) => set({ lastError: error }),

  connect: async () => {
    const { status, reconnectAttempts: prevAttempts } = get()
    if (status === 'connecting') return false

    // Restore API auth token from authStore before connecting
    const { apiToken } = useAuthStore.getState()
    if (apiToken && !apiClient.getAuthToken()) {
      apiClient.setAuthToken(apiToken)
    }

    const wasError = status === 'error'
    // Only show 'connecting' on first attempt or user-initiated retry.
    // During automatic reconnect retries, stay in 'error' to avoid UI flashing.
    if (prevAttempts === 0) {
      set({ status: 'connecting', lastError: null })
    }

    try {
      const t0 = performance.now()
      const ok = await apiClient.testConnection()
      const latencyMs = recordLatency(Math.round(performance.now() - t0))
      if (ok) {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        set({
          status: 'connected',
          lastConnected: Date.now(),
          reconnectAttempts: 0,
          consecutiveFailures: 0,
          heartbeatFailures: 0,
          lastError: null,
          latencyMs,
        })

        // Notify on reconnection (only if we were in error state, not initial connect)
        if (wasError || prevAttempts > 0) {
          pushConnectionNotification('success', 'Connection Restored', 'Successfully reconnected to the API server.')
        }

        // Start heartbeat to detect disconnections
        startHeartbeat(() => get().connect())
        return true
      }
      throw new Error('Server returned unsuccessful response')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const attempts = get().reconnectAttempts + 1

      set({
        status: 'error',
        lastError: message,
        reconnectAttempts: attempts,
      })

      // Schedule reconnect with exponential backoff
      if (attempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * Math.pow(2, Math.min(attempts - 1, 5)),
          10000,
        )
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          get().connect()
        }, delay)
      }

      return false
    }
  },

  disconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    stopHeartbeat()
    set({
      status: 'disconnected',
      lastError: null,
      reconnectAttempts: 0,
      consecutiveFailures: 0,
      heartbeatFailures: 0,
    })
  },

  // Call this when a polling endpoint succeeds — resets failure counter
  reportPollSuccess: () => {
    const { consecutiveFailures, status } = get()
    if (consecutiveFailures > 0) {
      set({ consecutiveFailures: 0 })
    }
    // If we were in error state but a poll succeeded, we're actually connected
    if (status === 'error') {
      set({ status: 'connected', lastError: null, reconnectAttempts: 0 })
      pushConnectionNotification('success', 'Connection Restored', 'API connection recovered successfully.')
    }
  },

  // Call this when a polling endpoint fails — after N consecutive failures, mark disconnected
  reportPollFailure: () => {
    const failures = get().consecutiveFailures + 1
    set({ consecutiveFailures: failures })
    // After 4 consecutive poll failures, trigger reconnection
    // (higher threshold prevents false disconnects when server is busy with large requests)
    if (failures >= 4 && get().status === 'connected') {
      set({ status: 'error', lastError: 'Multiple API requests failed', consecutiveFailures: 0 })
      pushConnectionNotification('error', 'Connection Unstable', 'Multiple API requests have failed. Attempting to reconnect...')
      // Reconnect after a pause, never immediately: the health probe (GET /)
      // can succeed while every data endpoint keeps failing (rate limited,
      // broken endpoint), and an instant reconnect turned that into a
      // request storm of "unstable"/"restored" cycles.
      if (!pollReconnectTimer) {
        pollReconnectTimer = setTimeout(() => {
          pollReconnectTimer = null
          get().connect()
        }, POLL_RECONNECT_DELAY_MS)
      }
    }
  },
}))
