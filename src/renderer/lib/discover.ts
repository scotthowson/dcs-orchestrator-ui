// =============================================================================
// Server discovery — turn whatever the user typed into the API base URL that
// actually answers. People enter the dashboard's hostname
// (https://ui.example.com), a LAN address (192.168.1.10) or the API itself
// (…:9876); the API can sit directly on its port or behind the dashboard's
// /api proxy (Traefik → nginx → API). Every candidate is probed at once and
// the first one that identifies itself as the DCS API wins.
// =============================================================================

export interface DiscoveredServer {
  /** The API base URL to use (no trailing slash) */
  url: string
  /** Straight to the API port, or through the dashboard's /api proxy */
  via: 'direct' | 'proxy'
  version?: string
  authEnabled?: boolean
  /** false when the server still needs the setup wizard */
  initialized?: boolean
  /** the server answers, but this browser may not read its other answers: it does not list this dashboard's address
   *  (API_CORS_ORIGINS). Only a web dashboard on another origin; the desktop app has no such limit */
  blocked?: boolean
}

/** what a discovery found: a server this dashboard can use, else one that answers but does not let this dashboard in */
export interface DiscoveryVerdict {
  found: DiscoveredServer | null
  blocked: DiscoveredServer | null
}

const PROBE_TIMEOUT_MS = 6000
const DEFAULT_PORT = 9876

/** Candidate base URLs, most likely first */
export function candidateUrls(input: string): string[] {
  const raw = input.trim().replace(/\/+$/, '')
  if (!raw) return []
  if (raw.startsWith('/')) return [raw] // relative: the dashboard's own proxy
  const m = raw.match(/^(https?):\/\/(.+)$/i)
  const scheme = m ? m[1].toLowerCase() : ''
  const rest = m ? m[2] : raw
  const host = rest.split('/')[0]
  const path = rest.slice(host.length)
  const hasPort = /:\d+$/.test(host)
  const bareHost = host.replace(/:\d+$/, '').toLowerCase()
  const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(bareHost) || bareHost === 'localhost' || !bareHost.includes('.') || /\.(local|lan|home|internal)$/.test(bareHost)
  const schemes = scheme ? [scheme] : local ? ['http', 'https'] : ['https', 'http']
  const out: string[] = []
  for (const s of schemes) {
    const base = `${s}://${host}${path}`
    // A bare LAN address most likely means the API port itself
    if (local && !hasPort && !path) out.push(`${s}://${host}:${DEFAULT_PORT}`)
    out.push(base)
    if (!/\/api$/i.test(base)) out.push(`${base}/api`)
    if (!local && !hasPort && !path) out.push(`${s}://${host}:${DEFAULT_PORT}`)
  }
  // http typed for a public name: the site almost always redirects to https
  if (scheme === 'http' && !local) {
    const b = `https://${host}${path}`
    out.push(b)
    if (!/\/api$/i.test(b)) out.push(`${b}/api`)
  }
  return Array.from(new Set(out))
}

/** The page's own origin in a browser tab; null in the desktop app (its main process lets every answer through) */
function browserOrigin(): string | null {
  if (typeof window === 'undefined' || window.electronAPI) return null
  const o = window.location?.origin
  return o && o !== 'null' ? o : null
}

/** true when the address is on another origin than this page, in a browser tab */
export function isCrossOrigin(url: string): boolean {
  const here = browserOrigin()
  if (!here) return false
  try {
    return new URL(url, window.location.href).origin !== here
  } catch {
    return false
  }
}

/** a fetch that fails without an answer: in a browser, a cross-origin answer the server did not allow fails exactly so */
const isNetworkError = (err: unknown) => err instanceof TypeError

/**
 * Why a web dashboard cannot use a server that answers: the server does not list this dashboard's address. The setting
 * is on that server's Config page (API server → Dashboards allowed from other addresses, API_CORS_ORIGINS).
 */
export function blockedText(url: string): string {
  let host = url
  try { host = new URL(url, window.location.href).host } catch { /* keep the address as typed */ }
  const here = browserOrigin() ?? 'this dashboard'
  return `${host} answers, but it doesn't allow this dashboard's address (${here}). Ask its admin to add that address under Settings → Config → API server → Dashboards allowed from other addresses, or use the desktop app.`
}

/**
 * The server at url answers (GET /ping, which a current server lets every origin read) but refuses this dashboard's
 * address (GET /setup/status, which keeps the server's allow-list, fails without an answer). Always false in the
 * desktop app and for the dashboard's own origin.
 */
export async function corsBlocked(url: string): Promise<boolean> {
  if (!isCrossOrigin(url)) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  const get = (path: string) => fetch(`${url}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal })
  try {
    try {
      const ping = await get('/ping')
      if (!ping.ok || !(ping.headers.get('content-type') || '').includes('json')) return false
      await ping.text()
    } catch {
      return false // nothing answered (or an older server, which hides even its heartbeat from another origin)
    }
    try {
      await get('/setup/status')
      return false
    } catch (err) {
      return isNetworkError(err)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function probe(url: string): Promise<DiscoveredServer | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/`, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal })
    if (!res.ok) return null
    let data: Record<string, unknown>
    try {
      data = JSON.parse(await res.text())
    } catch {
      return null // HTML — the dashboard page itself, not the API
    }
    const name = typeof data.name === 'string' ? data.name : ''
    if (!/dcs orchestrator|docker compose skeleton/i.test(name) && !Array.isArray(data.endpoints)) return null
    const found: DiscoveredServer = {
      url,
      via: /\/api$/i.test(url) ? 'proxy' : 'direct',
      version: typeof data.version === 'string' ? data.version : undefined,
      authEnabled: data.auth_enabled === true,
    }
    try {
      const st = await fetch(`${url}/setup/status`, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal })
      if (st.ok) {
        const s = await st.json()
        if (typeof s.initialized === 'boolean') found.initialized = s.initialized
      }
    } catch (err) {
      // the catalogue is readable from every origin, the rest only from the addresses the server lists: an answer the
      // browser refuses here, on another origin, is that list
      if (isNetworkError(err) && isCrossOrigin(url)) found.blocked = true
    }
    return found
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe every candidate at once (the address as typed, then <address>/api, then the API port); the first one this
 * dashboard can use wins, else the first one that answers but does not let this dashboard in.
 */
export async function discoverServerVerdict(input: string): Promise<DiscoveryVerdict> {
  const cands = candidateUrls(input)
  if (cands.length === 0) return { found: null, blocked: null }
  const results = (await Promise.all(cands.map(probe))).filter((r): r is DiscoveredServer => r !== null)
  return { found: results.find((r) => !r.blocked) ?? null, blocked: results.find((r) => r.blocked) ?? null }
}

/** The server this dashboard can use at an address, or null */
export async function discoverServer(input: string): Promise<DiscoveredServer | null> {
  return (await discoverServerVerdict(input)).found
}
