// =============================================================================
// Discord Rich Presence — "DCS · Managing <server>" on your Discord profile
// while the desktop app is open. Talks to the local Discord client over IPC;
// nothing leaves the machine except what Discord itself shows.
// =============================================================================

import { Client } from '@xhayper/discord-rpc'

export interface PresencePayload {
  /** first line, for example "Managing Howson-Ubuntu" */
  details: string
  /** second line, for example "17/17 containers · 9 stacks · healthy" */
  state: string
  /** asset key uploaded under the Discord application, or an https image URL */
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  /** unix ms when this session started (shows "elapsed") */
  startTimestamp?: number
  buttons?: { label: string; url: string }[]
}

export interface PresenceStatus {
  enabled: boolean
  connected: boolean
  clientId: string
  error: string
  /** unix ms of the last activity Discord accepted, 0 when none yet */
  lastSentAt: number
  lastPayload: PresencePayload | null
  /** Discord account the client is signed in with, once connected */
  user: string
}

const RECONNECT_MS = 30000
const MIN_UPDATE_MS = 15000
const SESSION_STARTED = Date.now()

/** Shown from the moment Discord accepts the connection until the app reports its facts */
const DEFAULT_PAYLOAD: PresencePayload = {
  details: 'DCS Orchestrator',
  state: 'Opening the dashboard…',
  largeImageKey: 'dcs',
  largeImageText: 'DCS Orchestrator',
  startTimestamp: SESSION_STARTED,
  buttons: [{ label: 'Get DCS', url: 'https://github.com/scotthowson/dcs-orchestrator' }],
}

let client: Client | null = null
let clientId = ''
let enabled = false
let connected = false
let lastError = ''
let lastPayload: PresencePayload | null = null
let lastSentAt = 0
let userName = ''
let pending: PresencePayload | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let connecting = false

const log = (...args: unknown[]) => console.log('[presence]', new Date().toISOString(), ...args)

function clearTimers() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
}

async function destroyClient() {
  clearTimers()
  connected = false
  userName = ''
  const c = client
  client = null
  if (c) {
    try { await c.user?.clearActivity() } catch { /* client may be gone */ }
    try { await c.destroy() } catch { /* ignore */ }
  }
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, RECONNECT_MS)
}

async function connect() {
  if (!enabled || !clientId || connecting || connected) return
  connecting = true
  const c = new Client({ clientId })
  client = c
  c.on('ready', () => {
    if (client !== c) return
    connected = true
    lastError = ''
    userName = c.user?.username ?? ''
    log('connected to Discord as', userName || '(unknown user)')
    // Show something right away; the renderer replaces it with live facts
    void send(lastPayload ?? DEFAULT_PAYLOAD, true)
  })
  c.on('disconnected', () => {
    if (client !== c) return
    connected = false
    log('Discord closed the connection')
    scheduleReconnect()
  })
  try {
    await c.login()
  } catch (err) {
    if (client === c) client = null
    connected = false
    lastError = err instanceof Error ? err.message : String(err)
    log('could not reach Discord:', lastError)
    scheduleReconnect()
  } finally {
    connecting = false
  }
}

async function send(payload: PresencePayload, force = false) {
  if (!client || !connected) return
  const now = Date.now()
  if (!force && now - lastSentAt < MIN_UPDATE_MS) {
    pending = payload
    if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        const p = pending
        pending = null
        if (p) void send(p, true)
      }, MIN_UPDATE_MS - (now - lastSentAt))
    }
    return
  }
  lastSentAt = now
  try {
    await client.user?.setActivity({
      details: payload.details.slice(0, 128),
      state: payload.state.slice(0, 128),
      largeImageKey: payload.largeImageKey,
      largeImageText: payload.largeImageText?.slice(0, 128),
      smallImageKey: payload.smallImageKey,
      smallImageText: payload.smallImageText?.slice(0, 128),
      startTimestamp: payload.startTimestamp,
      buttons: payload.buttons?.slice(0, 2),
      instance: false,
    })
    lastError = ''
    log('activity set:', payload.details, '|', payload.state)
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    log('setActivity failed:', lastError)
    connected = false
    scheduleReconnect()
  }
}

/** Apply settings: turn the presence on or off, or switch the application. */
export async function configurePresence(opts: { enabled: boolean; clientId: string }) {
  const nextId = (opts.clientId || '').trim()
  const nextEnabled = opts.enabled && /^[0-9]{15,22}$/.test(nextId)
  const changed = nextId !== clientId || nextEnabled !== enabled
  enabled = nextEnabled
  clientId = nextId
  if (opts.enabled && !nextEnabled) lastError = nextId ? 'The Application ID must be the 17–20 digit number from the Discord Developer Portal' : 'No Application ID set'
  if (!changed) {
    // same settings: a nudge to reconnect when the link dropped
    if (enabled && !connected) void connect()
    return
  }
  await destroyClient()
  if (enabled) void connect()
  else log('turned off')
}

/** Latest facts from the renderer; sent at most every 15 s (Discord's limit). */
export function updatePresence(payload: PresencePayload) {
  lastPayload = payload
  if (!enabled) return
  if (!connected) { void connect(); return }
  void send(payload)
}

export function presenceStatus(): PresenceStatus {
  return { enabled, connected, clientId, error: lastError, lastSentAt, lastPayload, user: userName }
}

export async function shutdownPresence() {
  enabled = false
  await destroyClient()
}
