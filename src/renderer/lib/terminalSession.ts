// =============================================================================
// terminalSession — the Linux sign-in of the Terminal page (and the System page's OS updates) belongs to the server
// that issued it. It is kept in this tab per server address, never sent to another server, and ended on its server
// (POST /terminal/auth/logout) when the dashboard leaves that server or the person signs out. The commands typed are
// kept per server address too, and forgotten on sign-out.
// =============================================================================

import { apiClient } from '../api/client'
import { onSignOut } from '../stores/authStore'

export interface TerminalSession {
  token: string
  username: string
  expiresAt?: number
}

const SESSION_PREFIX = 'terminal-session@'
const HISTORY_PREFIX = 'terminal-history@'

const server = () => apiClient.getBaseUrl()

function keysWith(storage: Storage, prefix: string): string[] {
  const out: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k && k.startsWith(prefix)) out.push(k)
  }
  return out
}

/** the session this tab keeps for the server in use (null: none, or unreadable) */
export function readTerminalSession(): TerminalSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_PREFIX + server()) || 'null')
    return parsed && typeof parsed.token === 'string' && parsed.token ? (parsed as TerminalSession) : null
  } catch {
    return null
  }
}

export function saveTerminalSession(session: TerminalSession): void {
  try { sessionStorage.setItem(SESSION_PREFIX + server(), JSON.stringify(session)) } catch { /* storage unavailable */ }
}

export function forgetTerminalSession(): void {
  try { sessionStorage.removeItem(SESSION_PREFIX + server()) } catch { /* storage unavailable */ }
}

/**
 * End every terminal session this tab keeps: the one of the server in use on that server (with the dashboard's
 * session, which the server asks for), then drop them all. A session kept for another address is dropped unsent.
 * Called when the dashboard leaves a server (before its session is put away) and on sign-out.
 */
export function endTerminalSessions(): void {
  const base = server()
  const auth = apiClient.getAuthToken()
  try {
    for (const key of keysWith(sessionStorage, SESSION_PREFIX)) {
      const url = key.slice(SESSION_PREFIX.length)
      let token = ''
      try { token = JSON.parse(sessionStorage.getItem(key) || '{}').token || '' } catch { /* unreadable */ }
      sessionStorage.removeItem(key)
      if (token && auth && url === base) {
        void fetch(`${url}/terminal/auth/logout`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
          body: JSON.stringify({ token }),
          keepalive: true,
        }).catch(() => {})
      }
    }
  } catch { /* storage unavailable */ }
}

export function readTerminalHistory(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_PREFIX + server()) || '[]')
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveTerminalHistory(list: string[]): void {
  try {
    if (list.length) localStorage.setItem(HISTORY_PREFIX + server(), JSON.stringify(list))
    else localStorage.removeItem(HISTORY_PREFIX + server())
  } catch { /* storage full or unavailable */ }
}

function forgetAllHistory(): void {
  try { for (const key of keysWith(localStorage, HISTORY_PREFIX)) localStorage.removeItem(key) } catch { /* storage unavailable */ }
}

// what builds before 4.0.37 kept without a server: nobody knows which server issued it, so it is dropped unsent
try {
  sessionStorage.removeItem('terminal-session')
  localStorage.removeItem('terminal-history')
} catch { /* storage unavailable */ }

// signing out: the terminal sessions end, and the commands typed on this device are forgotten
onSignOut(() => {
  endTerminalSessions()
  forgetAllHistory()
})
