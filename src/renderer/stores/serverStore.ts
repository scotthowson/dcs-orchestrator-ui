// =============================================================================
// Server Store — the DCS servers this dashboard knows, each with its own account
//
// One server is active at a time. Each profile keeps the session obtained on it (and, in the desktop app, a password
// remembered through the system keychain, lib/credentials), so switching back needs no sign-in.
//
// The rule that keeps everyone out who is not signed in: the dashboard (App: sidebar, pages, any data) is shown only
// while the ACTIVE server has a session that this server confirmed during this run of the app (authStore
// .validatedServerId). Everything else is a full screen of its own (`gate`): "Checking your sign-in", the sign-in for
// that server, or "can't be reached". Leaving a server — a switch, a session that ended, a sign-out — first takes the
// dashboard down, cancels the requests still on their way and empties every store, so nothing of one server is ever
// drawn under another, not even for a frame.
// =============================================================================

import { create } from 'zustand'
import type { ServerProfile, ServerSession, ConnectionProfile } from '../../shared/types'
import { apiClient, ApiCancelledError, ApiError, type AuthExpiredDetail } from '../api/client'
import { authLogin, authVerify } from '../api/endpoints'
import { useConnectionStore } from './connectionStore'
import { useSettingsStore, settlePageForRole } from './settingsStore'
import { useContainerStore } from './containerStore'
import { useStackStore } from './stackStore'
import { useHealthStore } from './healthStore'
import { useSystemStore } from './systemStore'
import { useImageStore } from './imageStore'
import { useLogStore } from './logStore'
import { useConfigStore } from './configStore'
import { useMetricsStore } from './metricsStore'
import { useNetworkStore } from './networkStore'
import { useRollbackStore } from './rollbackStore'
import { useScheduleStore } from './scheduleStore'
import { useSecretsStore } from './secretsStore'
import { usePluginStore } from './pluginStore'
import { useAuthStore, hasLocalSession, onSignOut, takeLegacyApiToken } from './authStore'
import { getDefaultServerUrl } from '../lib/env'
import { sseClient } from '../lib/sse'
import { resetUserSync } from '../lib/userSync'
import { rememberPassword, rememberedPassword, forgetPassword, rememberedServers } from '../lib/credentials'

const STORAGE_KEY = 'dcs-servers'

/** what is on screen instead of the dashboard: checking a session, or a server that does not answer.
 *  'open': the dashboard when signed in on the active server, its sign-in otherwise */
export type ServerGate = 'checking' | 'open' | 'unreachable'

/** why the sign-in is shown, for its notice */
export type SignInReason = 'expired' | 'signed-out' | 'password-rejected' | 'totp' | 'edit-address' | null

type Role = 'admin' | 'user' | 'bot'

interface ServerState {
  servers: ServerProfile[]
  activeServerId: string | null
  /** a switch is under way */
  loading: boolean
  gate: ServerGate
  /** what the unreachable screen says (the error of the last try) */
  gateDetail: string | null
  /** the server Cancel on the sign-in goes back to: the one left with a confirmed session */
  returnToId: string | null
  signInReason: SignInReason
  /** the last try of a server that did not answer, per server (this run only) */
  unreachable: Record<string, string>
  loadServers: () => void
  /** One-time import of the profiles the Settings page used to keep on its own */
  importLegacyProfiles: () => void
  addServer: (server: Omit<ServerProfile, 'id'>) => ServerProfile
  removeServer: (id: string) => void
  updateServer: (id: string, updates: Partial<ServerProfile>) => void
  /** Make another server the active one: true when it was entered signed in (its saved session works, or a remembered
   *  password signed in again); otherwise its sign-in or its "can't be reached" screen is up */
  switchServer: (id: string) => Promise<boolean>
  /** Check the active server's saved session (the app's start, Retry). `leave`: take the dashboard down first (its
   *  address was changed: it is another server now) */
  enterActiveServer: (opts?: { quiet?: boolean; leave?: boolean }) => Promise<boolean>
  /** The server just issued a session (sign-in, 2FA, invite, setup): keep it for the active server and open the
   *  dashboard. With `password` and `rememberPassword`, the desktop app keeps or forgets the password. */
  sessionStarted: (o: { token: string; username: string; role?: Role | string | null; password?: string; rememberPassword?: boolean }) => Promise<void>
  /** Cancel on the sign-in: back to the server left with a confirmed session */
  cancelSignIn: () => Promise<boolean>
  /** Sign out of one server: its session ends (on the server too, best effort); the remembered password stays */
  signOutServer: (id: string) => Promise<void>
  /** Forget the password remembered for a server */
  forgetServerPassword: (id: string) => Promise<void>
  getActiveServer: () => ServerProfile | null
  setDefaultServer: (id: string) => void
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function persistServers(servers: ServerProfile[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ servers, activeServerId: activeId }))
  } catch { /* ignore */ }
}

function asRole(r: unknown): Role | null {
  return r === 'admin' || r === 'user' || r === 'bot' ? r : null
}

function persistedRole(username: string | undefined): Role | null {
  if (!username) return null
  try { return asRole(localStorage.getItem(`user-role-${username}`)) } catch { return null }
}

/** a profile saved before 4.0.35 kept its token as apiToken/username */
function migrateProfile(p: ServerProfile): ServerProfile {
  const { apiToken, username, ...rest } = p
  const out: ServerProfile = { ...rest }
  if (apiToken && !out.session) out.session = { token: apiToken, username: username || '', role: persistedRole(username), savedAt: Date.now() }
  if (username && !out.lastUsername) out.lastUsername = username
  return out
}

/** Every store that holds what a server said: emptied before the next server is shown */
function resetServerData() {
  for (const store of [useHealthStore, useSystemStore, useImageStore, useLogStore, useConfigStore, useMetricsStore,
    useNetworkStore, useRollbackStore, useScheduleStore, useSecretsStore, usePluginStore] as const) {
    const s = store as unknown as { setState: (v: unknown, replace: true) => void; getInitialState: () => unknown }
    s.setState(s.getInitialState(), true)
  }
  // the favourites and the action times of the stacks are this device's, not the server's
  useContainerStore.setState({ containers: [], stats: {}, statsHistory: {}, loading: true, fetchedAt: 0 })
  useStackStore.setState({ stacks: [], selectedStack: null, loading: false, actionLoading: null })
}

/** Take the dashboard down and drop everything of the server in use; the saved sessions stay as they are */
function leaveServer() {
  useAuthStore.getState().suspendSession()
  apiClient.cancelAll()
  useConnectionStore.getState().disconnect()
  sseClient.disconnect()
  resetUserSync()
  resetServerData()
}

/** End a session on its server without touching the active one (POST /auth/logout with that token) */
function logoutElsewhere(url: string, token: string) {
  const base = url.replace(/\/$/, '')
  try {
    void fetch(`${base}/auth/logout`, { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }).catch(() => {})
  } catch { /* best effort */ }
}

function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status >= 500) return `The server answered ${err.status}${err.message ? `: ${err.message}` : ''}`
  if (err instanceof Error && err.message) return err.message
  return 'No answer from the server'
}

/** the newest enterServer wins: an older one still waiting for its server stops when it gets its answer */
let enterRun = 0
let loaded = false

export const useServerStore = create<ServerState>((set, get) => {
  /** point the API client and the connection at a profile */
  const pointAt = (server: ServerProfile) => {
    apiClient.setBaseUrl(server.url)
    useConnectionStore.getState().setServerUrl(server.url)
    if (useSettingsStore.getState().serverUrl !== server.url) useSettingsStore.getState().updateSetting('serverUrl', server.url)
  }

  const setUnreachable = (id: string, detail: string | null) => {
    const unreachable = { ...get().unreachable }
    if (detail) unreachable[id] = detail
    else delete unreachable[id]
    set({ unreachable })
  }

  const adopt = (id: string, session: ServerSession) => {
    setUnreachable(id, null)
    try { sessionStorage.removeItem('logout-reason') } catch { /* storage unavailable */ }
    set({ gate: 'open', gateDetail: null, returnToId: null, signInReason: null })
    useAuthStore.getState().adoptSession(session.username, session.token, session.role, id)
    settlePageForRole(useAuthStore.getState().userRole)
  }

  /**
   * Check a server's saved session and enter it: a session the server confirms (GET /auth/verify) opens the
   * dashboard; a dead one is dropped and, when the desktop app remembers the password (and the person did not sign
   * out of this server), signs in again by itself; otherwise the sign-in for this server. A server that does not
   * answer gets its "can't be reached" screen, never the dashboard.
   */
  const enterServer = async (id: string, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    const run = ++enterRun
    const stale = () => run !== enterRun || get().activeServerId !== id
    const server = get().servers.find((s) => s.id === id)
    if (!server) return false
    if (!opts.quiet) set({ gate: 'checking', gateDetail: null })
    pointAt(server)

    const session = server.session
    if (session?.token) {
      apiClient.setAuthToken(session.token)
      try {
        const v = await authVerify()
        if (stale()) return false
        if (v.valid === false) throw new ApiError(401, v.message || 'Token is invalid or expired')
        const confirmed: ServerSession = { ...session, username: v.username || session.username, role: asRole(v.role) ?? session.role }
        get().updateServer(id, { session: confirmed, lastUsername: confirmed.username, lastConnected: Date.now() })
        adopt(id, confirmed)
        return true
      } catch (err) {
        if (stale() || err instanceof ApiCancelledError) return false
        apiClient.setAuthToken(null)
        if (err instanceof ApiError && err.status === 401) {
          get().updateServer(id, { session: null })
          if (!get().signInReason) set({ signInReason: 'expired' })
        } else {
          setUnreachable(id, errorText(err))
          set({ gate: 'unreachable', gateDetail: errorText(err) })
          return false
        }
      }
    }

    const fresh = get().servers.find((s) => s.id === id)
    if (fresh?.remember && !fresh.signedOut) {
      const cred = await rememberedPassword(id, fresh.url)
      if (stale()) return false
      if (cred) {
        try {
          const res = await authLogin(cred.username, cred.password)
          if (stale()) return false
          if (res.success && res.token) {
            await get().sessionStarted({ token: res.token, username: res.username || cred.username, role: res.role })
            return true
          }
          // a 2FA account: the code is asked on the sign-in, which starts again from the password
          get().updateServer(id, { lastUsername: cred.username })
          set({ signInReason: 'totp' })
        } catch (err) {
          if (stale() || err instanceof ApiCancelledError) return false
          if (err instanceof ApiError && err.status === 401) {
            get().updateServer(id, { lastUsername: cred.username })
            set({ signInReason: 'password-rejected' })
          } else if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) {
            setUnreachable(id, errorText(err))
            set({ gate: 'unreachable', gateDetail: errorText(err) })
            return false
          }
        }
      }
    }

    // no session that works: the sign-in for this server — when it answers at all
    if (!session?.token) {
      const ok = await apiClient.testConnection()
      if (stale()) return false
      if (!ok) {
        const detail = `No DCS API answered at ${server.url}`
        setUnreachable(id, detail)
        set({ gate: 'unreachable', gateDetail: detail })
        return false
      }
    }
    setUnreachable(id, null)
    set({ gate: 'open', gateDetail: null })
    return false
  }

  return {
    servers: [],
    activeServerId: null,
    loading: false,
    gate: 'checking',
    gateDetail: null,
    returnToId: null,
    signInReason: null,
    unreachable: {},

    loadServers: () => {
      if (loaded) return
      loaded = true
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const data = JSON.parse(raw)
          const servers = ((data.servers || []) as ServerProfile[]).map(migrateProfile)
          set({ servers, activeServerId: data.activeServerId || servers[0]?.id || null })
        }
        if (get().servers.length === 0) {
          const { serverUrl } = useSettingsStore.getState()
          const defaultServer: ServerProfile = {
            id: generateId(),
            name: 'Local Server',
            url: serverUrl || getDefaultServerUrl(),
            isDefault: true,
          }
          set({ servers: [defaultServer], activeServerId: defaultServer.id })
        }
        // the one token kept before 4.0.35 belongs to the server that was active then
        const legacy = takeLegacyApiToken()
        const activeId = get().activeServerId
        if (legacy && activeId) {
          const active = get().servers.find((s) => s.id === activeId)
          if (active && !active.session) {
            let user = active.lastUsername || useSettingsStore.getState().lastUsername || ''
            try { user = sessionStorage.getItem('currentUser') || JSON.parse(localStorage.getItem('auth-session') || '{}').username || user } catch { /* keep */ }
            set({ servers: get().servers.map((s) => s.id === activeId ? { ...s, session: { token: legacy, username: user, role: persistedRole(user), savedAt: Date.now() } } : s) })
          }
        }
        persistServers(get().servers, get().activeServerId)
        get().importLegacyProfiles()
      } catch { /* ignore */ }
      // which servers have a password in the keychain (desktop): the profiles follow the keychain, and a password
      // whose profile is gone is forgotten
      void rememberedServers().then((ids) => {
        const known = new Set(get().servers.map((s) => s.id))
        for (const id of ids) if (!known.has(id)) void forgetPassword(id)
        const has = new Set(ids)
        const servers = get().servers.map((s) => (!!s.remember === has.has(s.id) ? s : { ...s, remember: has.has(s.id) }))
        if (servers.some((s, i) => s !== get().servers[i])) {
          set({ servers })
          persistServers(servers, get().activeServerId)
        }
      })
    },

    importLegacyProfiles: () => {
      const legacy = useSettingsStore.getState().connectionProfiles ?? []
      if (legacy.length === 0) return
      const known = new Set(get().servers.map((s) => s.url))
      const extra: ServerProfile[] = legacy
        .filter((p: ConnectionProfile) => p.url && !known.has(p.url))
        .map((p: ConnectionProfile) => ({ id: generateId(), name: p.name || p.url, url: p.url, isDefault: false, lastConnected: p.lastConnected }))
      if (extra.length > 0) {
        const servers = [...get().servers, ...extra]
        set({ servers })
        persistServers(servers, get().activeServerId)
      }
      useSettingsStore.getState().updateSetting('connectionProfiles', [])
    },

    addServer: (server) => {
      const newServer: ServerProfile = { ...server, id: generateId() }
      const servers = [...get().servers, newServer]
      set({ servers })
      persistServers(servers, get().activeServerId)
      return newServer
    },

    removeServer: (id) => {
      const gone = get().servers.find((s) => s.id === id)
      if (!gone) return
      if (gone.session?.token) logoutElsewhere(gone.url, gone.session.token)
      void forgetPassword(id)
      const servers = get().servers.filter((s) => s.id !== id)
      const wasActive = get().activeServerId === id
      set({ servers, returnToId: get().returnToId === id ? null : get().returnToId })
      persistServers(servers, get().activeServerId)
      if (wasActive && servers[0]) void get().switchServer(servers[0].id)
    },

    updateServer: (id, updates) => {
      const servers = get().servers.map((s) => {
        if (s.id !== id) return s
        const next = { ...s, ...updates }
        // a new address is another server: the session and the password were for the old one
        if (updates.url !== undefined && updates.url !== s.url && updates.session === undefined) {
          if (s.session?.token) logoutElsewhere(s.url, s.session.token)
          if (s.remember) void forgetPassword(id)
          next.session = null
          next.remember = false
        }
        return next
      })
      set({ servers })
      persistServers(servers, get().activeServerId)
    },

    switchServer: async (id) => {
      const target = get().servers.find((s) => s.id === id)
      if (!target) return false
      const auth = useAuthStore.getState()
      const prev = get().activeServerId
      const prevConfirmed = auth.isAuthenticated && !!prev && auth.validatedServerId === prev
      // the server in use, signed in: only the connection is tried again
      if (id === prev && prevConfirmed) return useConnectionStore.getState().connect()

      // the dashboard of the server before goes away first, with everything it showed
      leaveServer()
      const returnToId = prevConfirmed && prev !== id ? prev : get().returnToId === id ? null : get().returnToId
      set({ activeServerId: id, loading: true, returnToId, signInReason: null })
      persistServers(get().servers, id)
      const ok = await enterServer(id)
      set({ loading: false })
      return ok
    },

    enterActiveServer: async (opts) => {
      const id = get().activeServerId
      if (!id) return false
      if (opts?.leave) { leaveServer(); set({ returnToId: null, signInReason: null }) }
      return enterServer(id, opts)
    },

    sessionStarted: async ({ token, username, role, password, rememberPassword: keep }) => {
      const id = get().activeServerId
      const server = get().servers.find((s) => s.id === id)
      if (!id || !server) {
        apiClient.setAuthToken(token)
        return
      }
      const session: ServerSession = { token, username, role: asRole(role), savedAt: Date.now() }
      let remember = !!server.remember
      if (password !== undefined && keep !== undefined) {
        if (keep) remember = await rememberPassword(id, server.url, username, password)
        else if (server.remember) { await forgetPassword(id); remember = false }
      }
      get().updateServer(id, { session, lastUsername: username, signedOut: false, remember, lastConnected: Date.now() })
      useSettingsStore.getState().updateSetting('lastUsername', username)
      if (get().activeServerId !== id) return
      adopt(id, session)
    },

    cancelSignIn: async () => {
      const back = get().returnToId
      if (!back || !get().servers.some((s) => s.id === back)) {
        set({ returnToId: null })
        return false
      }
      return get().switchServer(back)
    },

    signOutServer: async (id) => {
      const server = get().servers.find((s) => s.id === id)
      if (!server) return
      const token = server.session?.token
      if (id === get().activeServerId) {
        leaveServer()
        set({ returnToId: null, signInReason: 'signed-out', gate: 'open' })
      } else if (get().returnToId === id) {
        set({ returnToId: null })
      }
      get().updateServer(id, { session: null, signedOut: true })
      if (token) logoutElsewhere(server.url, token)
    },

    forgetServerPassword: async (id) => {
      await forgetPassword(id)
      get().updateServer(id, { remember: false })
    },

    getActiveServer: () => {
      const { servers, activeServerId } = get()
      return servers.find(s => s.id === activeServerId) || null
    },

    setDefaultServer: (id) => {
      const servers = get().servers.map(s => ({ ...s, isDefault: s.id === id }))
      set({ servers })
      persistServers(servers, get().activeServerId)
    },
  }
})

// Signing out (the header, the command palette, the lock screen, a device session that ran out): the active
// server's session ends, and with `everywhere` every other server's too — on each server as well, best effort
onSignOut(({ everywhere }) => {
  const st = useServerStore.getState()
  const activeId = st.activeServerId
  apiClient.cancelAll()
  sseClient.disconnect()
  resetUserSync()
  resetServerData()
  const servers = st.servers.map((s) => {
    if (s.id === activeId) return { ...s, session: null, signedOut: everywhere ? true : s.signedOut }
    if (!everywhere) return s
    if (s.session?.token) logoutElsewhere(s.url, s.session.token)
    return { ...s, session: null, signedOut: true }
  })
  useServerStore.setState({ servers, returnToId: null, gate: 'open', signInReason: everywhere ? 'signed-out' : null })
  persistServers(servers, activeId)
})

// A 401 from the active server (ApiClient): its session ended. Only this server is asked again — by itself with a
// remembered password, else with its sign-in, pre-filled; the sessions saved for other servers stay. The dashboard goes
// away at once with everything it showed. Answers from a server or session left before (another epoch) are ignored,
// and once the dashboard is down a second 401 finds nobody signed in and asks nothing.
window.addEventListener('api-auth-expired', (e) => {
  const detail = (e as CustomEvent<AuthExpiredDetail | undefined>).detail
  const auth = useAuthStore.getState()
  const st = useServerStore.getState()
  const id = st.activeServerId
  if (!id || !auth.isAuthenticated || auth.validatedServerId !== id) return
  if (detail && (detail.epoch !== apiClient.getEpoch() || detail.baseUrl !== apiClient.getBaseUrl())) return
  try { sessionStorage.setItem('logout-reason', 'session-expired') } catch { /* storage unavailable */ }
  leaveServer()
  st.updateServer(id, { session: null })
  useServerStore.setState({ returnToId: null, signInReason: 'expired' })
  void st.enterActiveServer()
})

// A server that stops answering while in use (the heartbeat gave up, or the reconnect failed): if /ping is silent
// too, its "can't be reached" screen replaces the dashboard. The session is kept; Retry (or the screen's own
// retries) checks it again and comes back in.
useConnectionStore.subscribe((s, prev) => {
  if (s.status !== 'error' || prev.status === 'error') return
  const auth = useAuthStore.getState()
  const id = useServerStore.getState().activeServerId
  if (!id || !auth.isAuthenticated || auth.validatedServerId !== id) return
  const epoch = apiClient.getEpoch()
  const stillHere = () => {
    const a = useAuthStore.getState()
    return apiClient.getEpoch() === epoch && a.isAuthenticated && a.validatedServerId === id
  }
  // two pings a few seconds apart, both silent: a server that is only busy (a burst of requests) keeps the dashboard
  void (async () => {
    for (let i = 0; i < 2; i++) {
      if (i) await new Promise((r) => setTimeout(r, 4000))
      if (!stillHere() || (await apiClient.testConnection())) return
    }
    if (!stillHere()) return
    leaveServer()
    const detail = 'The server stopped answering'
    useServerStore.setState((st) => ({ gate: 'unreachable', gateDetail: detail, unreachable: { ...st.unreachable, [id]: detail } }))
  })()
})

/**
 * The app starts without a device session ("Remember me for …" was off, or its time ran out while the app was
 * closed): the sessions saved per server are not used — the sign-in shows (a password the desktop app remembers still
 * signs in by itself, that is what it was kept for). They are dropped here only, not ended on their servers: another tab
 * of the same browser may still be working with one. Returns true when that was the case.
 */
export function endSavedSessionsWithoutDeviceSession(): boolean {
  if (hasLocalSession()) return false
  const st = useServerStore.getState()
  if (!st.servers.some((s) => s.session?.token)) return true
  const servers = st.servers.map((s) => (s.session?.token ? { ...s, session: null } : s))
  useServerStore.setState({ servers })
  persistServers(servers, st.activeServerId)
  return true
}
