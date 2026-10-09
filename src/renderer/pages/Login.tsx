// =============================================================================
// Login — the sign-in screen: connect to a server, sign in (with a 2FA code
// when the account has one), register with an invite code, or create the first
// admin. Shown before anyone is signed in, so it has no page header: it is the
// product's front door (the dashboard of DCS Orchestrator).
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Shield, User, Lock, ArrowRight, Globe,
  Layers, Loader2, AlertCircle, Sparkles, Clock, KeyRound, UserPlus,
  Wifi, WifiOff, X, Server, ArrowLeft,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useBrand } from '../hooks/useBrand'
import { useConnectionStore } from '../stores/connectionStore'
import { useServerStore } from '../stores/serverStore'
import { authRegister, authLogin, authSetup, fetchSetupStatus, totpValidate } from '../api/endpoints'
import { hydrateUser } from '../lib/userSync'
import { apiClient, ApiError, ApiNetworkError } from '../api/client'
import { canRememberPasswords } from '../lib/credentials'
import { ServerAccountList } from '../components/auth/ServerGateScreens'
import { discoverServerVerdict, blockedText } from '../lib/discover'
import Hint from '../components/common/Hint'
import PasswordStrengthMeter from '../components/auth/PasswordStrength'
import ShowPasswordButton from '../components/auth/ShowPasswordButton'
import { BTN_ICON_SM, BTN_TOOLBAR_QUIET, BTN_SHEET_PRIMARY, FOCUS_RING } from '../lib/ui'
/** the fields of the sign-in card: 48 px, an icon on the left */
const LOGIN_INPUT = 'w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-300'
/** …with a button on the right (show the password) */
const LOGIN_INPUT_PW = LOGIN_INPUT.replace('pr-4', 'pr-12')
/** a small text button beside a line of words (Change, Have an invite code?) */
const LINK_BTN = `rounded-md transition-colors ${FOCUS_RING}`

/** what the server answered to a sign-in: the session to keep for this server */
interface IssuedSession { token: string; username: string; role?: string | null }

export default function Login() {
  const {
    hasAccount, loading, error,
    register, login, clearError,
  } = useAuthStore()
  const { name: projectName, subtitle: projectSubtitle } = useBrand()
  // The sign-in is always for the ACTIVE server (App keys this screen by it): its name and address are on show, its
  // account is filled in, Cancel goes back to the server left with a confirmed session.
  const server = useServerStore((s) => s.servers.find((x) => x.id === s.activeServerId) ?? null)
  const serverCount = useServerStore((s) => s.servers.length)
  const returnTo = useServerStore((s) => (s.returnToId ? s.servers.find((x) => x.id === s.returnToId) ?? null : null))
  const signInReason = useServerStore((s) => s.signInReason)
  const settingsLastUsername = useSettingsStore((s) => s.lastUsername)
  const lastUsername = server?.lastUsername || server?.session?.username || (serverCount <= 1 ? settingsLastUsername : '') || ''
  const [canRemember, setCanRemember] = useState(false)
  const [rememberPw, setRememberPw] = useState(!!server?.remember)
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => { void canRememberPasswords().then(setCanRemember) }, [])
  const sessionDurationMinutes = useSettingsStore((s) => s.sessionDurationMinutes)
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const { setServerUrl } = useConnectionStore()

  const [username, setUsername] = useState(lastUsername || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [showTotpInput, setShowTotpInput] = useState(false)
  const [totpToken, setTotpToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpError, setTotpError] = useState('')
  const [totpSubmitting, setTotpSubmitting] = useState(false)
  // Read the current URL from settings (always fresh) rather than apiClient (may be stale)
  const settingsServerUrl = useSettingsStore((s) => s.serverUrl)
  const [serverUrl, setServerUrlLocal] = useState(settingsServerUrl || apiClient.getBaseUrl())
  const [serverAuthError, setServerAuthError] = useState<string | null>(null)
  // The reason is read without consuming it: App draws a dark frame between the dashboard and this screen, so
  // this screen mounts twice (and twice in development, StrictMode), and the first mount used to take the reason
  // away from the one that stays. It is forgotten when the screen goes away after having been on show.
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(() => sessionStorage.getItem('logout-reason') === 'session-expired' || useServerStore.getState().signInReason === 'expired')
  // a password change (Settings → Security) ends every session of the account on the server, this one too: the
  // note to sign in with the new password lands here (this screen sits outside the dashboard's toast provider)
  const [passwordChangedNotice, setPasswordChangedNotice] = useState(() => sessionStorage.getItem('logout-reason') === 'password-changed')
  useEffect(() => {
    const shownAt = Date.now()
    return () => { if (Date.now() - shownAt > 400) sessionStorage.removeItem('logout-reason') }
  }, [])
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connDetail, setConnDetail] = useState('')
  const connTestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // When we already have a configured server URL (e.g. returning from logout),
  // start optimistically: skip the loading spinner and show the login form
  // immediately while verifying the server in the background.
  const hasKnownServer = !!settingsServerUrl && signInReason !== 'edit-address'
  const [connected, setConnected] = useState(hasKnownServer)
  const [serverInitialized, setServerInitialized] = useState(hasKnownServer)
  const [initialChecking, setInitialChecking] = useState(!hasKnownServer)

  // Derive session label from settings
  const sessionLabel = (() => {
    if (sessionDurationMinutes <= 0) return 'Stay signed in'
    if (sessionDurationMinutes < 60) return `Remember me for ${sessionDurationMinutes} min`
    if (sessionDurationMinutes === 60) return 'Remember me for 1 hour'
    if (sessionDurationMinutes < 1440) return `Remember me for ${sessionDurationMinutes / 60} hours`
    if (sessionDurationMinutes === 1440) return 'Remember me for 1 day'
    return `Remember me for ${Math.round(sessionDurationMinutes / 1440)} days`
  })()

  // Normalize URL: ensure it has a protocol prefix

  // Combined connection test + setup detection in ONE call.
  // In Electron: uses checkServer IPC which runs Node.js http.get in the main
  // process — completely bypasses Chromium (no CORS, no CSP, no PNA, nothing).
  // In browser: falls back to sequential fetch() calls.
  /** Sync URL change to the active server profile in serverStore */
  const syncUrlToServerStore = useCallback((url: string) => {
    const { servers, activeServerId, updateServer } = useServerStore.getState()
    if (activeServerId) {
      const active = servers.find(s => s.id === activeServerId)
      if (active && active.url !== url) {
        updateServer(activeServerId, { url })
      }
    }
  }, [])

  const checkServer = useCallback(async (rawUrl: string, isInitial = false) => {
    const typed = rawUrl.trim()
    if (!typed) { setConnStatus('idle'); setConnected(false); setServerInitialized(false); setInitialChecking(false); return }

    // Only reset state on explicit URL changes — not during
    // background re-checks after logout (prevents login form flash)
    if (!isInitial) {
      setConnStatus('testing')
      setConnected(false)
      setServerInitialized(false)
    }
    setConnDetail('')
    try {
      // One discovery pass covers every way the address can be written: the
      // API port directly, the dashboard's /api proxy behind Traefik, http or
      // https, with or without a scheme — the same in Electron, the Android
      // app and the browser.
      const { found, blocked } = await discoverServerVerdict(typed)
      if (!found) {
        // it answers, but does not let this web dashboard's address in: say so instead of "unreachable"
        if (blocked) setConnDetail(blockedText(blocked.url))
        if (!isInitial) {
          setConnected(false)
          setServerInitialized(false)
        }
        setConnStatus(isInitial ? 'idle' : 'fail')
        setInitialChecking(false)
        return
      }
      const url = found.url
      apiClient.setBaseUrl(url)
      setServerUrl(url)
      useSettingsStore.getState().updateSetting('serverUrl', url)
      syncUrlToServerStore(url)
      setConnDetail(`${found.via === 'proxy' ? 'through the dashboard proxy' : 'API port'} · ${url}${found.version ? ` · API ${found.version}` : ''}`)

      if (found.initialized === false) {
        // Server needs first-run setup — clear stale data + redirect
        if (window.electronAPI) {
          await window.electronAPI.setSetting('userAccounts', undefined)
        }
        localStorage.removeItem('userAccounts')
        localStorage.removeItem('auth-session')
        localStorage.removeItem('api-auth-token')
        apiClient.setAuthToken(null)
        useAuthStore.setState({ hasAccount: false, isAuthenticated: false, currentUser: null })
        setCurrentPage('setup')
        setInitialChecking(false)
        return
      }
      setServerInitialized(true)
      setConnStatus('ok')
      setConnected(true)
    } catch {
      // On initial auto-check failure, keep optimistic state to prevent flash
      if (!isInitial) {
        setConnected(false)
        setServerInitialized(false)
      }
      setConnStatus(isInitial ? 'idle' : 'fail')
    }
    setInitialChecking(false)
  }, [setServerUrl, setCurrentPage, syncUrlToServerStore])

  // Track the initial URL so we can distinguish user-initiated URL changes
  // from the initial mount (which should NOT reset optimistic state).
  const mountUrlRef = useRef(serverUrl)

  // Fire check on URL changes — but skip the initial mount when we have
  // a known server (returning from logout). This prevents the
  // Phase 2 → Phase 1 → Phase 2 flash.
  useEffect(() => {
    if (connTestTimer.current) clearTimeout(connTestTimer.current)
    if (!serverUrl.trim()) {
      setConnStatus('idle')
      setInitialChecking(false)
      return
    }

    // If the URL hasn't changed from mount-time AND we have a known server,
    // skip the background check entirely. The user was just authenticated —
    // setup detection will happen at form submission time.
    if (serverUrl === mountUrlRef.current && hasKnownServer) {
      setInitialChecking(false)
      return
    }

    // URL changed from what we mounted with — this is a user-initiated change.
    // Reset connection state and debounce the server check.
    if (serverUrl !== mountUrlRef.current) {
      setInitialChecking(false)
      setConnected(false)
      setServerInitialized(false)
      connTestTimer.current = setTimeout(() => checkServer(serverUrl), 800)
    } else {
      // No known server (first-time setup) — check immediately
      checkServer(serverUrl, true)
    }
    return () => { if (connTestTimer.current) clearTimeout(connTestTimer.current) }
  }, [serverUrl, checkServer, hasKnownServer])

  // Sync local serverUrl state when settings change externally (e.g., server switch)
  useEffect(() => {
    if (settingsServerUrl && settingsServerUrl !== serverUrl && !connected) {
      setServerUrlLocal(settingsServerUrl)
    }
  }, [settingsServerUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // checkAccountExists is already called by App.tsx — do NOT call it here
  // or it creates an infinite mount/unmount loop (loading→unmount Login→remount→repeat)

  // Mode is determined by whether an account exists AND the server needs setup.
  // If the server is already initialized (has admin), always show Sign In —
  // even on a new device with no local accounts.
  // Create-account mode only when nothing is known: no local account AND the
  // server check failed. A reachable server decides (initialized → Sign In,
  // not set up → the wizard); while it is being checked, Sign In is shown.
  const isSetup = !hasAccount && !serverInitialized && connStatus === 'fail'

  /** Sign in on the server (or create its first admin). The dashboard opens only with a session the server issued:
   *  a server that does not answer, or answers without a session, is a failure shown here (there is no way in
   *  without the server). A 2FA account answers with a pending token: the code step takes over. */
  const attemptServerAuth = async (user: string, pass: string, isInitialSetup: boolean): Promise<IssuedSession | null> => {
    setServerAuthError(null)
    try {
      const res = isInitialSetup ? await authSetup(user, pass) : await authLogin(user, pass)
      if (res.success && res.token) return { token: res.token, username: res.username || user, role: res.role }
      const r = res as unknown as Record<string, unknown>
      if (r.requires_totp && r.totp_token) {
        setTotpToken(r.totp_token as string)
        setShowTotpInput(true)
        return null
      }
      setServerAuthError('The server did not sign you in')
      return null
    } catch (err) {
      if (err instanceof ApiNetworkError || (err instanceof ApiError && err.status === 0)) {
        setServerAuthError(`${server?.name ?? 'The server'} can’t be reached right now. Nothing opens until it answers.`)
      } else {
        setServerAuthError(err instanceof ApiError ? err.message : 'Authentication failed')
      }
      return null
    }
  }

  /** The session is kept for this server (and the password, when asked, in the desktop app's keychain): the dashboard opens */
  const finishSignIn = async (issued: IssuedSession, pass: string) => {
    await useServerStore.getState().sessionStarted({
      token: issued.token,
      username: issued.username,
      role: issued.role ?? null,
      password: pass,
      rememberPassword: canRemember ? rememberPw : undefined,
    })
  }

  /** Switch between login and register modes, resetting form state */
  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode)
    setUsername(newMode === 'login' && lastUsername ? lastUsername : '')
    setPassword('')
    setConfirmPassword('')
    setInviteCode('')
    setShowPassword(false)
    setRegisterError(null)
    clearError()
  }

  /** Handle invite-code registration via the REST API */
  const handleInviteRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setRegisterError(null)
    clearError()

    if (!inviteCode.trim()) {
      setRegisterError('Invite code is required')
      return
    }
    if (!username.trim() || !password.trim()) {
      setRegisterError('Username and password are required')
      return
    }
    if (password.length < 8) {
      setRegisterError('Password must be at least 8 characters')
      return
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setRegisterError('Password must contain at least one uppercase letter and one number')
      return
    }
    if (password !== confirmPassword) {
      setRegisterError('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      // Apply server URL before API call and persist it
      if (serverUrl !== apiClient.getBaseUrl()) {
        apiClient.setBaseUrl(serverUrl)
        setServerUrl(serverUrl)
        useSettingsStore.getState().updateSetting('serverUrl', serverUrl)
        syncUrlToServerStore(serverUrl)
      }

      // Check if server is uninitialized — redirect to setup wizard
      try {
        const status = await fetchSetupStatus()
        if (!status.initialized) {
          setCurrentPage('setup')
          setSubmitting(false)
          return
        }
      } catch {
        // Server unreachable — proceed with normal auth
      }

      const res = await authRegister(username.trim(), password, inviteCode.trim())
      if (res.success && res.token) {
        apiClient.setAuthToken(res.token)

        // Persist session — use dynamic duration from settings
        // SECURITY: Do NOT store the API token in auth-session (it's already in api-auth-token)
        // Storing it in two places doubles the attack surface for token theft.
        const durationMs = sessionDurationMinutes <= 0 ? 0 : sessionDurationMinutes * 60 * 1000
        sessionStorage.setItem('currentUser', res.username)
        const session = {
          username: res.username,
          expiresAt: durationMs === 0 ? 0 : Date.now() + durationMs,
          token: 'redacted', // Session validation uses api-auth-token, not this field
        }
        localStorage.setItem('auth-session', JSON.stringify(session))

        // Also create local account so app lock works offline
        await register(username.trim(), password, { overwrite: true })

        // Remember username for next session
        useSettingsStore.getState().updateSetting('lastUsername', username.trim())
        useAuthStore.setState({ hasAccount: true })

        // the session is this server's: the dashboard opens
        await finishSignIn({ token: res.token, username: res.username || username.trim(), role: res.role }, password)
      } else {
        setRegisterError('Registration failed — unexpected response')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setRegisterError(message)
    } finally {
      setSubmitting(false)
    }
  }

  // Handle TOTP code submission (second step of 2FA login)
  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (totpSubmitting || totpCode.length !== 6) return
    setTotpSubmitting(true)
    setTotpError('')
    try {
      const res = await totpValidate(totpToken, totpCode)
      if (res.success && res.token) {
        apiClient.setAuthToken(res.token)
        await hydrateUser({ user: res.username || username, timeoutMs: 1500 })
        setShowTotpInput(false)
        setTotpCode('')

        // Persist session
        const durationMs = sessionDurationMinutes <= 0 ? 0 : sessionDurationMinutes * 60 * 1000
        sessionStorage.setItem('currentUser', res.username || username)
        localStorage.setItem('auth-session', JSON.stringify({
          username: res.username || username,
          expiresAt: durationMs === 0 ? 0 : Date.now() + durationMs,
          token: 'redacted',
        }))

        // the local copy for the app lock (created, or brought in line with the password the server accepted)
        if (!(await login(username, password, rememberMe))) { clearError(); await register(username.trim(), password, { overwrite: true }) }
        useSettingsStore.getState().updateSetting('lastUsername', username.trim())
        useAuthStore.setState({ hasAccount: true })
        await finishSignIn({ token: res.token, username: res.username || username.trim(), role: res.role }, password)
      } else {
        setTotpError('Invalid code')
      }
    } catch (err) {
      setTotpError(err instanceof Error ? err.message : 'Verification failed')
    }
    setTotpSubmitting(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    if (isSetup && password !== confirmPassword) {
      return
    }

    setSubmitting(true)
    clearError()
    setServerAuthError(null)

    // Apply server URL before auth and persist it
    if (serverUrl !== apiClient.getBaseUrl()) {
      apiClient.setBaseUrl(serverUrl)
      setServerUrl(serverUrl)
      useSettingsStore.getState().updateSetting('serverUrl', serverUrl)
      syncUrlToServerStore(serverUrl)
    }

    // Check if server is uninitialized — redirect to setup wizard
    try {
      const status = await fetchSetupStatus()
      if (!status.initialized) {
        setCurrentPage('setup')
        setSubmitting(false)
        return
      }
    } catch {
      // Server unreachable — proceed with normal auth
    }

    // The server first: no session from it, no way in. Then the local copy of the account (the app lock), then the
    // session is kept for this server and the dashboard opens.
    const issued = await attemptServerAuth(username, password, isSetup)
    if (!issued) {
      setSubmitting(false)
      return
    }
    apiClient.setAuthToken(issued.token)
    let success = false
    if (isSetup) {
      success = await register(username, password)
    } else {
      success = await login(username, password, rememberMe)
      if (!success) {
        // The server accepted these credentials: the local copy (used for the
        // app lock) is created, or brought in line with them when the same
        // username was used on another server
        clearError()
        success = await register(username.trim(), password, { overwrite: true })
      }
    }
    clearError()
    useSettingsStore.getState().updateSetting('lastUsername', username.trim())
    // profile, icon, accent, personal theme and choices, layout: read now so the first page is already theirs (a slow server never holds the sign-in longer than this)
    await hydrateUser({ user: issued.username, timeoutMs: 1500 })
    await finishSignIn(issued, password)
    setSubmitting(false)
  }

  if (loading || initialChecking) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <Layers className="w-7 h-7 text-emerald-400" />
          </div>
          <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-y-auto overflow-x-hidden scrollbar-thin"
      style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}
    >
      {/* Animated background effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full bg-emerald-500/[0.05] blur-3xl animate-float-slow" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full bg-cyan-500/[0.05] blur-3xl animate-float-slow" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/[0.04] blur-3xl animate-float-slow" style={{ animationDelay: '6s' }} />
        <div className="absolute -bottom-1/4 left-1/3 w-[28rem] h-[28rem] rounded-full bg-rose-500/[0.03] blur-3xl animate-float-slow" style={{ animationDelay: '9s' }} />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          animation: 'float 20s ease-in-out infinite',
        }}
      />

      {/* Login card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mb-4 animate-float">
            <Layers className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            {projectName}
          </h1>
          {projectSubtitle && (
            <p className="text-sm text-slate-500 mt-1">
              {projectSubtitle}
            </p>
          )}
        </div>

        {/* Form card */}
        <div className="glass gradient-border-animated p-8">

          {/* ════════════════════════════════════════════════════════════════
              Phase 1 — Server Connection (shown until server is verified)
              ════════════════════════════════════════════════════════════════ */}
          {!connected ? (
            <div className="animate-fade-in">
              {/* Connection banner */}
              <div className="flex items-center gap-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-4 py-3 mb-6">
                <Globe size={16} className="text-cyan-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-cyan-300">Server connection</p>
                  <p className="text-[10px] text-cyan-400/70 mt-0.5">
                    Connect to your DCS Orchestrator server to get started
                  </p>
                </div>
              </div>

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-100">Connect to a server</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Your dashboard address or the API server — the port and the /api path are found automatically
                </p>
              </div>

              {/* Server URL — press Enter or click button to test */}
              <form onSubmit={(e) => {
                e.preventDefault()
                if (connTestTimer.current) clearTimeout(connTestTimer.current)
                if (serverUrl.trim()) checkServer(serverUrl)
              }}>
                <div>
                  <label htmlFor="connect-server-address" className="block text-xs font-medium text-slate-400 mb-1.5">Server address</label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="connect-server-address"
                      type="text"
                      inputMode="url"
                      value={serverUrl}
                      onChange={(e) => setServerUrlLocal(e.target.value)}
                      placeholder={window.electronAPI ? "192.168.1.100:9876 or https://ui.example.com" : "/api"}
                      autoFocus
                      autoComplete="url"
                      className={`${LOGIN_INPUT} !pr-10`}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {connStatus === 'testing' && <Loader2 size={14} className="text-slate-500 animate-spin" />}
                      {connStatus === 'ok' && <Wifi size={14} className="text-emerald-400" />}
                      {connStatus === 'fail' && <WifiOff size={14} className="text-rose-400" />}
                    </div>
                  </div>
                  {/* One line tall until the message needs more (the unreachable hint wraps), so state changes barely shift the form */}
                  <p aria-live="polite" className={`text-[10px] mt-1 min-h-[1rem] leading-snug transition-colors duration-200 ${
                    connStatus === 'ok' ? 'text-emerald-400/80'
                    : connStatus === 'fail' ? 'text-rose-400/80'
                    : connStatus === 'testing' ? 'text-cyan-400/80'
                    : 'text-slate-500'
                  }`}>
                    {connStatus === 'ok' ? `Connected${connDetail ? ` — ${connDetail}` : ''}`
                    : connStatus === 'fail' ? connDetail || 'Server unreachable — tried the address as typed, with /api and on port 9876. Behind Traefik use https://ui.yourdomain/api; on the LAN, host:9876'
                    : connStatus === 'testing' ? 'Connecting…'
                    : 'Dashboard address (https://ui.example.com) or the API on the LAN (192.168.1.10:9876)'}
                  </p>
                </div>

                {/* Test connection button */}
                <button
                  type="submit"
                  disabled={connStatus === 'testing' || connStatus === 'ok' || !serverUrl.trim()}
                  className={`${BTN_SHEET_PRIMARY} w-full mt-4`}
                >
                  {connStatus === 'testing' ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Testing connection…
                    </>
                  ) : connStatus === 'ok' ? (
                    <>
                      <Wifi size={16} />
                      Connected
                    </>
                  ) : (
                    <>
                      <Wifi size={16} />
                      Test connection
                    </>
                  )}
                </button>
              </form>
            </div>

          ) : (
          <>
          {/* ════════════════════════════════════════════════════════════════
              Phase 2 — Authentication (server verified as initialized)
              ════════════════════════════════════════════════════════════════ */}

          {/* ── Initial Setup (admin creation) ── */}
          {isSetup && (
            <>
              {/* Setup banner */}
              <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 mb-6">
                <Sparkles size={16} className="text-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-300">Initial setup</p>
                  <p className="text-[10px] text-emerald-400/70 mt-0.5">
                    Create your admin account to get started
                  </p>
                </div>
              </div>

              {/* Connected server display */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 mb-6">
                <div className="flex items-center gap-2 min-w-0">
                  <Wifi size={12} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-slate-400 font-mono truncate">{serverUrl}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setConnected(false); setServerInitialized(false); setConnStatus('idle') }}
                  aria-label="Change the server"
                  className={`${LINK_BTN} h-8 px-2.5 -mr-1.5 text-[11px] font-medium text-slate-400 hover:text-cyan-400 hover:bg-white/5 shrink-0 ml-2`}
                >
                  Change
                </button>
              </div>

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-100">Create admin account</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Set up your credentials to secure the dashboard
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Username */}
                <div>
                  <label htmlFor="setup-username" className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="setup-username"
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); clearError() }}
                      placeholder="Enter username"
                      autoFocus
                      autoComplete="username"
                      className={LOGIN_INPUT}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="setup-password" className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="setup-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearError() }}
                      placeholder="Enter password"
                      autoComplete="new-password"
                      className={LOGIN_INPUT_PW}
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Min 8 characters, must include an uppercase letter and a number
                  </p>
                </div>

                {/* Confirm Password */}
                <div>
                  <label htmlFor="setup-confirm-password" className="block text-xs font-medium text-slate-400 mb-1.5">Confirm password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="setup-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                      className={`
                        w-full pl-10 pr-4 py-3 bg-white/5 border rounded-lg
                        text-sm text-slate-200 placeholder-slate-600
                        focus:outline-none focus:ring-1 transition-all duration-300
                        ${confirmPassword && password !== confirmPassword
                          ? 'border-rose-500/50 focus:border-rose-500/50 focus:ring-rose-500/25'
                          : 'border-white/10 focus:border-emerald-500/50 focus:ring-emerald-500/20'
                        }
                      `}
                    />
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-[10px] text-rose-400 mt-1">Passwords do not match</p>
                  )}
                </div>

                {/* Error */}
                {(error || serverAuthError) && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                    <p className="text-xs text-rose-300">{serverAuthError || error}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting || !username.trim() || !password.trim() || password !== confirmPassword}
                  className={`${BTN_SHEET_PRIMARY} w-full`}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {submitting ? 'Creating account…' : 'Create account and start'}
                </button>
              </form>
            </>
          )}

          {/* ── TOTP 2FA Input ── */}
          {showTotpInput && (
            <div key="totp-mode" className="animate-fade-in">
              <div className="mb-6 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Shield size={24} className="text-cyan-400" />
                </div>
                <h2 className="text-lg font-semibold text-slate-100">Two-factor authentication</h2>
                <p className="text-xs text-slate-500 mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div className="flex justify-center">
                  <input
                    aria-label="6-digit code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setTotpError('') }}
                    placeholder="000000"
                    autoFocus
                    autoComplete="one-time-code"
                    className="w-48 text-center text-2xl font-mono tracking-[0.5em] px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-slate-200 placeholder-slate-700 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all duration-300"
                  />
                </div>
                {totpError && (
                  <div role="alert" className="flex items-center gap-2 justify-center rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                    <p className="text-xs text-rose-300">{totpError}</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={totpSubmitting || totpCode.length !== 6}
                  className={`${BTN_SHEET_PRIMARY} w-full`}
                >
                  {totpSubmitting ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                  {totpSubmitting ? 'Verifying…' : 'Verify code'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowTotpInput(false); setTotpCode(''); setTotpError(''); setTotpToken('') }}
                  className={`${BTN_TOOLBAR_QUIET} w-full justify-center`}
                >
                  Back to sign in
                </button>
              </form>
            </div>
          )}

          {/* ── Sign In mode ── */}
          {!isSetup && mode === 'login' && !showTotpInput && (
            <div key="login-mode" className="animate-fade-in">
              {/* The server this sign-in is for: its name and address, so there is no doubt which account is asked */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 mb-6" data-testid="signin-server">
                <div className="flex items-center gap-2 min-w-0">
                  <Server size={13} className="text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    {server && <p className="text-xs font-medium text-slate-200 truncate">{server.name}</p>}
                    <p className="text-[11px] text-slate-400 font-mono truncate">{serverUrl}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setConnected(false); setServerInitialized(false); setConnStatus('idle') }}
                  aria-label="Change the server address"
                  className={`${LINK_BTN} h-8 px-2.5 -mr-1.5 text-[11px] font-medium text-slate-400 hover:text-cyan-400 hover:bg-white/5 shrink-0 ml-2`}
                >
                  Change
                </button>
              </div>

              {/* Why the sign-in is asked again (a remembered password the server refused, a 2FA code) */}
              {(signInReason === 'password-rejected' || signInReason === 'totp') && (
                <div role="status" className="flex items-center gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3.5 py-3 mb-4">
                  <KeyRound size={15} className="text-amber-400 shrink-0" />
                  <p className="text-[11px] text-amber-300">
                    {signInReason === 'totp'
                      ? 'This account asks for a 6-digit code: sign in with the password, then the code.'
                      : 'The saved password was not accepted. Sign in with the current one.'}
                  </p>
                </div>
              )}

              {/* Session expired notice */}
              {sessionExpiredNotice && (
                <div className="flex items-center gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3.5 py-3 mb-4 animate-fade-in">
                  <Clock size={15} className="text-amber-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-amber-300">Session expired</p>
                    <p className="text-[10px] text-amber-400/70 mt-0.5">Your session has expired. Please sign in again to continue.</p>
                  </div>
                  <Hint label="Dismiss">
                    <button type="button" aria-label="Dismiss" onClick={() => setSessionExpiredNotice(false)} className={`${BTN_ICON_SM} text-amber-400 hover:bg-amber-500/10 shrink-0 ml-auto ${FOCUS_RING}`}>
                      <X size={14} />
                    </button>
                  </Hint>
                </div>
              )}

              {/* Password changed notice */}
              {passwordChangedNotice && (
                <div className="flex items-center gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-3 mb-4 animate-fade-in" role="status">
                  <KeyRound size={15} className="text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">Password changed</p>
                    <p className="text-[10px] text-emerald-400/70 mt-0.5">Every session of your account was signed out. Sign in again with the new password.</p>
                  </div>
                  <Hint label="Dismiss">
                    <button type="button" aria-label="Dismiss" onClick={() => setPasswordChangedNotice(false)} className={`${BTN_ICON_SM} text-emerald-400 hover:bg-emerald-500/10 shrink-0 ml-auto ${FOCUS_RING}`}>
                      <X size={14} />
                    </button>
                  </Hint>
                </div>
              )}

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-100">{server && serverCount > 1 ? `Sign in to ${server.name}` : 'Welcome back'}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {serverCount > 1 ? 'Each server has its own account. Enter the one for this server.' : 'Enter your credentials to access the dashboard'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Username */}
                <div>
                  <label htmlFor="signin-username" className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="signin-username"
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); clearError() }}
                      placeholder="Enter username"
                      autoFocus
                      autoComplete="username"
                      className={LOGIN_INPUT}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="signin-password" className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="signin-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearError() }}
                      placeholder="Enter password"
                      autoComplete="current-password"
                      className={LOGIN_INPUT_PW}
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                </div>

                {/* Remember me: the whole line is the check box */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={rememberMe}
                  onClick={() => setRememberMe(!rememberMe)}
                  className={`${LINK_BTN} flex items-center gap-2 min-h-[2rem] -my-1 py-1 pr-2 text-left`}
                >
                  <span
                    aria-hidden
                    className={`
                      flex items-center justify-center w-4 h-4 rounded border transition-all shrink-0
                      ${rememberMe
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'bg-white/5 border-white/20 hover:border-white/30'
                      }
                    `}
                  >
                    {rememberMe && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock size={11} className="text-slate-500" />
                    <span className="text-xs text-slate-400">{sessionLabel}</span>
                  </span>
                </button>

                {/* Desktop app only: the password is kept in the system keychain (safeStorage), for this server alone */}
                {canRemember && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={rememberPw}
                    onClick={() => setRememberPw(!rememberPw)}
                    className={`${LINK_BTN} flex items-center gap-2 min-h-[2rem] -my-1 py-1 pr-2 text-left`}
                  >
                    <span
                      aria-hidden
                      className={`flex items-center justify-center w-4 h-4 rounded border transition-all shrink-0 ${rememberPw ? 'bg-emerald-500 border-emerald-500' : 'bg-white/5 border-white/20 hover:border-white/30'}`}
                    >
                      {rememberPw && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <KeyRound size={11} className="text-slate-500" />
                      <span className="text-xs text-slate-400">Remember the password on this device</span>
                    </span>
                  </button>
                )}

                {/* Error */}
                {(error || serverAuthError) && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                    <p className="text-xs text-rose-300">{serverAuthError || error}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting || !username.trim() || !password.trim()}
                  className={`${BTN_SHEET_PRIMARY} w-full`}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              {/* Switch to register mode */}
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`${LINK_BTN} px-2 py-2 text-xs text-slate-500 hover:text-slate-300`}
                >
                  Have an invite code? <span className="font-medium text-cyan-400">Register</span>
                </button>
              </div>

              {/* Cancel: back to the server left signed in, untouched */}
              {returnTo && (
                <button
                  type="button"
                  disabled={cancelling || submitting}
                  onClick={async () => { setCancelling(true); const ok = await useServerStore.getState().cancelSignIn(); if (!ok) setCancelling(false) }}
                  className={`${BTN_TOOLBAR_QUIET} w-full justify-center mt-2`}
                >
                  {cancelling ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeft size={14} />}
                  Cancel — back to {returnTo.name}
                </button>
              )}

              {/* the other servers this device knows */}
              <ServerAccountList excludeId={server?.id} />
            </div>
          )}

          {/* ── Register with Invite Code mode ── */}
          {!isSetup && mode === 'register' && (
            <div key="register-mode" className="animate-fade-in">
              {/* Connected server display */}
              <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 mb-6">
                <div className="flex items-center gap-2 min-w-0">
                  <Wifi size={12} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-slate-400 font-mono truncate">{serverUrl}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setConnected(false); setServerInitialized(false); setConnStatus('idle') }}
                  aria-label="Change the server"
                  className={`${LINK_BTN} h-8 px-2.5 -mr-1.5 text-[11px] font-medium text-slate-400 hover:text-cyan-400 hover:bg-white/5 shrink-0 ml-2`}
                >
                  Change
                </button>
              </div>

              {/* Invite banner */}
              <div className="flex items-center gap-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-4 py-3 mb-6">
                <KeyRound size={16} className="text-cyan-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-cyan-300">Invite registration</p>
                  <p className="text-[10px] text-cyan-400/70 mt-0.5">
                    Use an invite code to create your account
                  </p>
                </div>
              </div>

              {/* Header */}
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-100">Create account</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Enter your invite code and choose your credentials
                </p>
              </div>

              <form onSubmit={handleInviteRegister} className="space-y-4">
                {/* Invite Code */}
                <div>
                  <label htmlFor="register-invite" className="block text-xs font-medium text-slate-400 mb-1.5">Invite code</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="register-invite"
                      type="text"
                      value={inviteCode}
                      onChange={(e) => { setInviteCode(e.target.value); setRegisterError(null) }}
                      placeholder="Enter invite code"
                      autoFocus
                      autoComplete="off"
                      className={LOGIN_INPUT}
                    />
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label htmlFor="register-username" className="block text-xs font-medium text-slate-400 mb-1.5">Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="register-username"
                      type="text"
                      value={username}
                      onChange={(e) => { setUsername(e.target.value); setRegisterError(null) }}
                      placeholder="Choose a username"
                      autoComplete="username"
                      className={LOGIN_INPUT}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="register-password" className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="register-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setRegisterError(null) }}
                      placeholder="Choose a password"
                      autoComplete="new-password"
                      className={LOGIN_INPUT_PW}
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Min 8 characters, must include an uppercase letter and a number
                  </p>
                </div>

                {/* Password strength */}
                {password && <PasswordStrengthMeter password={password} />}

                {/* Confirm Password */}
                <div>
                  <label htmlFor="register-confirm-password" className="block text-xs font-medium text-slate-400 mb-1.5">Confirm password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    <input
                      id="register-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setRegisterError(null) }}
                      placeholder="Confirm password"
                      autoComplete="new-password"
                      className={`
                        w-full pl-10 pr-4 py-3 bg-white/5 border rounded-lg
                        text-sm text-slate-200 placeholder-slate-600
                        focus:outline-none focus:ring-1 transition-all duration-300
                        ${confirmPassword && password !== confirmPassword
                          ? 'border-rose-500/50 focus:border-rose-500/50 focus:ring-rose-500/25'
                          : 'border-white/10 focus:border-emerald-500/50 focus:ring-emerald-500/20'
                        }
                      `}
                    />
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-[10px] text-rose-400 mt-1">Passwords do not match</p>
                  )}
                </div>

                {/* Error */}
                {(registerError || error) && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
                    <AlertCircle size={14} className="text-rose-400 shrink-0" />
                    <p className="text-xs text-rose-300">{registerError || error}</p>
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting || !inviteCode.trim() || !username.trim() || !password.trim() || password !== confirmPassword}
                  className={`${BTN_SHEET_PRIMARY} w-full`}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <UserPlus size={16} />
                  )}
                  {submitting ? 'Creating account…' : 'Register'}
                </button>
              </form>

              {/* Switch to login mode */}
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`${LINK_BTN} px-2 py-2 text-xs text-slate-500 hover:text-slate-300`}
                >
                  Already have an account? <span className="font-medium text-emerald-400">Sign in</span>
                </button>
              </div>
            </div>
          )}

          </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <Shield size={12} className="text-slate-500" />
          <p className="text-[10px] text-slate-500">
            {!connected
              ? 'Secure connection to your DCS API server'
              : !isSetup && mode === 'register'
                ? 'Secure registration via server-validated invite codes'
                : serverInitialized
                  ? 'Authenticated via server API with local offline fallback'
                  : 'PBKDF2 encrypted credentials stored locally on this device only'
            }
          </p>
        </div>
      </div>
    </div>
  )
}
