// =============================================================================
// API Client — fetch wrapper for the DCS Orchestrator REST API
// =============================================================================

import { getDefaultServerUrl } from '../lib/env'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** the JSON body of the error answer, when it had one (a `reason`, `rolled_back` …) */
    public data?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ApiTimeoutError extends ApiError {
  constructor(path: string, timeoutMs: number) {
    super(0, `Request to ${path} timed out after ${timeoutMs}ms`)
    this.name = 'ApiTimeoutError'
  }
}

/** A request the dashboard dropped itself: the server was switched or the session ended while it was on its way.
 *  Its answer belonged to the server before, so nobody gets to see it. */
export class ApiCancelledError extends ApiError {
  constructor(path: string) {
    super(0, `Request to ${path} was cancelled`)
    this.name = 'ApiCancelledError'
  }
}

/** detail of the 'api-auth-expired' event: which server and which session the 401 was about */
export interface AuthExpiredDetail { baseUrl: string; epoch: number; path: string }

export class ApiNetworkError extends ApiError {
  constructor(path: string, cause?: string) {
    super(0, `Network error requesting ${path}${cause ? `: ${cause}` : ''}`)
    this.name = 'ApiNetworkError'
  }
}

/**
 * Endpoints whose 401 means "the credentials in this request are wrong", not
 * "your API session is gone". A 401 from anything else ends the session.
 */
const CREDENTIAL_CHECK_PATHS = [
  '/auth/login',
  '/auth/setup',
  '/auth/register',
  '/auth/totp/validate',
  '/auth/totp/verify',
  '/auth/totp/disable',
  // a wrong current password is a 401 about the body, not the session
  '/auth/password',
  '/terminal/auth',
  // a wrong dashboard password when a personal ssh key is made is a 401 about the body, not the session
  '/ssh/keys',
  '/terminal/exec',
  '/system/os-update',
  '/system/docker-engine/update',
]

function isCredentialCheckPath(path: string): boolean {
  // the same calls made on a VM through the hub (/fleet/members/<id>/api/…) relay the VM's answer: its 401 is about the
  // Linux account or terminal session sent along, not about this session on the hub
  const clean = path.split('?')[0].replace(/^\/fleet\/members\/[^/]+\/api(?=\/)/, '')
  return CREDENTIAL_CHECK_PATHS.some((p) => clean === p || clean.startsWith(`${p}/`))
}

export class ApiClient {
  private baseUrl: string
  private timeout: number
  private maxRetries: number
  private authToken: string | null = null
  /** bumped by cancelAll(): a request started before it never delivers its answer (or its 401) */
  private epoch = 0
  private inflight = new Set<AbortController>()

  constructor(baseUrl = getDefaultServerUrl(), timeout = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeout = timeout
    this.maxRetries = 2
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '')
    this.pingPath = '/ping'
  }

  setTimeout(ms: number): void {
    this.timeout = ms
  }

  setAuthToken(token: string | null): void {
    this.authToken = token
  }

  getAuthToken(): string | null {
    return this.authToken
  }

  /** the server and the session the answers in memory belong to: caches key on it (lib/sharedFetch) */
  getScopeKey(): string {
    return `${this.baseUrl}#${this.epoch}`
  }

  getEpoch(): number {
    return this.epoch
  }

  /**
   * Leaving a server (a switch, a sign-out, a session that ended): every request still on its way is aborted and
   * whatever answers arrive later are dropped, so nothing from the server before lands in the stores of the next one.
   */
  cancelAll(): void {
    this.epoch++
    for (const c of this.inflight) c.abort()
    this.inflight.clear()
  }

  private async requestOnce<T>(method: string, path: string, body?: string, timeoutOverride?: number): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const epoch = this.epoch
    const baseUrl = this.baseUrl
    const controller = new AbortController()
    this.inflight.add(controller)
    const timeoutId = setTimeout(() => controller.abort(), timeoutOverride ?? this.timeout)

    const init: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      },
      signal: controller.signal,
    }
    if (body) init.body = body

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err: unknown) {
      if (epoch !== this.epoch) throw new ApiCancelledError(path)
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ApiTimeoutError(path, timeoutOverride ?? this.timeout)
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new ApiNetworkError(path, message)
    } finally {
      clearTimeout(timeoutId)
      this.inflight.delete(controller)
    }
    if (epoch !== this.epoch) throw new ApiCancelledError(path)

    if (!response.ok) {
      let errorMessage = response.statusText
      let errorData: Record<string, unknown> | undefined
      try {
        const data = await response.json()
        if (data && typeof data === 'object') errorData = data as Record<string, unknown>
        if (data && typeof data.error === 'string') {
          errorMessage = data.error
        } else if (data && typeof data.message === 'string') {
          errorMessage = data.message
        }
      } catch {
        // response body was not JSON — use statusText
      }
      // Handle 401 — the API session is invalid, expired, or was never
      // established on this server (e.g. a session persisted by an older UI,
      // or a server that was reinstalled). End the session so the login /
      // setup flow takes over instead of polling forever; the authStore
      // listener ignores the event when nobody is signed in.
      // Endpoints that answer 401 about credentials carried *inside* the
      // request (password, TOTP code, Linux login, terminal session) leave
      // the API session untouched.
      if (response.status === 401) {
        if (epoch !== this.epoch) throw new ApiCancelledError(path)
        if (!isCredentialCheckPath(path)) {
          this.authToken = null
          window.dispatchEvent(new CustomEvent<AuthExpiredDetail>('api-auth-expired', { detail: { baseUrl, epoch, path } }))
        }
        throw new ApiError(401, errorMessage, errorData)
      }
      throw new ApiError(response.status, errorMessage, errorData)
    }

    // Read body as text first, then parse — more resilient to encoding issues
    const text = await response.text()
    if (epoch !== this.epoch) throw new ApiCancelledError(path)
    if (!text || text.trim().length === 0) {
      return {} as T
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError(response.status, `Invalid JSON response from ${path}`)
    }
  }

  private async request<T>(method: string, path: string, body?: string, timeoutOverride?: number): Promise<T> {
    // Only retry idempotent GET requests on network errors — never POST/DELETE
    // which may have already modified server state
    if (method !== 'GET') {
      return this.requestOnce<T>(method, path, body, timeoutOverride)
    }
    let lastError: Error | null = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, body, timeoutOverride)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        // Only retry on network errors, not API errors
        if (!(err instanceof ApiNetworkError)) throw err
        // Wait a bit before retrying
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
      }
    }
    throw lastError!
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: unknown, timeoutOverride?: number): Promise<T> {
    return this.request<T>('POST', path, body ? JSON.stringify(body) : undefined, timeoutOverride)
  }

  async put<T>(path: string, body?: unknown, timeoutOverride?: number): Promise<T> {
    return this.request<T>('PUT', path, body ? JSON.stringify(body) : undefined, timeoutOverride)
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  /** GET /ping on a 3.6+ API, GET / on older ones (remembered per server) */
  private pingPath: '/ping' | '/' = '/ping'

  /**
   * Reachability check for the heartbeat. No auth headers (so no CORS preflight)
   * and the smallest answer the API has, so the time it takes is the round trip.
   */
  async testConnection(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      try {
        const response = await fetch(`${this.baseUrl}${this.pingPath}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (response.status === 404 && this.pingPath === '/ping') {
          // An API before 3.6 has no /ping: use the root document from now on
          this.pingPath = '/'
          return this.testConnection()
        }
        // The dashboard's own HTML answers 200 too; only the API speaks JSON
        return response.ok && (response.headers.get('content-type') || '').includes('json')
      } catch {
        return false
      } finally {
        clearTimeout(timeoutId)
      }
    } catch {
      return false
    }
  }
}

export const apiClient = new ApiClient()
