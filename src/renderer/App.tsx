import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { pageLabel, pageMeta } from './constants/pageTitles'
import { StatusBar } from './components/layout/StatusBar'
import { ToastProvider } from './components/common/Toast'
import { ConfirmDialogHost } from './components/common/ConfirmDialog'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import UpdateBanner from './components/common/UpdateBanner'
import OnboardingOverlay from './components/common/OnboardingOverlay'
import { CommandPalette } from './components/CommandPalette'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { GlobalPoller } from './components/GlobalPoller'
import DiscordPresence from './components/DiscordPresence'
import { useSettingsStore } from './stores/settingsStore'
import { useConnectionStore } from './stores/connectionStore'
import { useAuthStore } from './stores/authStore'
import { useServerStore, endSavedSessionsWithoutDeviceSession } from './stores/serverStore'
import { ServerCheckingScreen, ServerUnreachableScreen } from './components/auth/ServerGateScreens'
import { getDefaultServerUrl } from './lib/env'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Stacks from './pages/Stacks'
import Containers from './pages/Containers'
import Images from './pages/Images'
import Health from './pages/Health'
import Networks from './pages/Networks'
import Logs from './pages/Logs'
import System from './pages/System'
import Config from './pages/Config'
import Settings from './pages/Settings'
import Bookmarks from './pages/Bookmarks'
import Activity from './pages/Activity'
import Diagnostics from './pages/Diagnostics'
import Users from './pages/Users'
import Maintenance from './pages/Maintenance'
import Environment from './pages/Environment'
import Volumes from './pages/Volumes'
import Backup from './pages/Backup'
import Terminal from './pages/Terminal'
import Trends from './pages/Trends'
import Updates from './pages/Updates'
import Notifications from './pages/Notifications'
import Templates from './pages/Templates'
import Automations from './pages/Automations'
import Topology from './pages/Topology'
import FileBrowser from './pages/FileBrowser'
import DiskAnalysis from './pages/DiskAnalysis'
import Secrets from './pages/Secrets'
import Plugins from './pages/Plugins'
import DNS from './pages/DNS'
import Technitium from './pages/Technitium'
import { technitiumEnabledNow } from './hooks/useTechnitiumEnabled'
import Proxmox from './pages/Proxmox'
import CrowdSec from './pages/CrowdSec'
import Export from './pages/Export'
import SetupWizard from './pages/SetupWizard'
import { BackToTop } from './components/common/BackToTop'
import ChatBubble from './components/chat/ChatBubble'
import { MobileNav } from './components/layout/MobileNav'
import { SectionTabs } from './components/layout/SectionTabs'
import { navSections, visiblePages, sectionTarget, type AliasPageId } from './constants/navSections'
import { apiClient } from './api/client'
import { sseClient } from './lib/sse'
import { sanitizeCss } from './lib/cssSanitize'
import { useThemeStore, syncDocumentTheme, effectiveThemeNeedsDoc, THEME_POLL_MS } from './stores/themeStore'
import { usePolling } from './hooks/usePolling'
import { hydrateUser, resetUserSync, profileStorageKey } from './lib/userSync'
import { toggleMode, useResolvedMode } from './lib/colorMode'
import type { PageId } from '../shared/types'
import { ADMIN_ONLY_PAGES } from '../shared/types'
import ModalOverlay from './components/common/ModalOverlay'

// a page that moved into another (navSections PAGE_ALIASES) is never shown under its own id
const pageComponents: Record<Exclude<PageId, AliasPageId>, React.ComponentType> = {
  dashboard: Dashboard,
  stacks: Stacks,
  containers: Containers,
  images: Images,
  health: Health,
  networks: Networks,
  volumes: Volumes,
  bookmarks: Bookmarks,
  activity: Activity,
  logs: Logs,
  system: System,
  diagnostics: Diagnostics,
  config: Config,
  settings: Settings,
  users: Users,
  maintenance: Maintenance,
  environment: Environment,
  backup: Backup,
  terminal: Terminal,
  trends: Trends,
  updates: Updates,
  notifications: Notifications,
  templates: Templates,
  automations: Automations,
  topology: Topology,
  'file-browser': FileBrowser,
  'disk-analysis': DiskAnalysis,
  secrets: Secrets,
  plugins: Plugins,
  dns: DNS,
  technitium: Technitium,
  proxmox: Proxmox,
  crowdsec: CrowdSec,
  export: Export,
  setup: SetupWizard as unknown as React.ComponentType,
}

const refreshServerThemes = () => useThemeStore.getState().refresh()

// Ctrl+1…9 and Ctrl+0 open the sidebar's ten sections in order (navSections), each on the tab it was last on

/** the active server's saved session was checked at the start of this run (App's init) */
let activeServerEntered = false

export default function App() {
  const { currentPage, loadSettings, setCurrentPage, theme, toggleSidebar, updateSetting, autoLockMinutes, customCSS } = useSettingsStore()
  const { connect, setServerUrl } = useConnectionStore()
  const { loading: authLoading, checkAccountExists, logout } = useAuthStore()
  // Signed in means: a session the ACTIVE server confirmed during this run of the app (serverStore). Anything less
  // (a session read from storage and not checked yet, a server that does not answer, a sign-in on another server)
  // shows its own full screen below, never the dashboard.
  const sessionConfirmed = useAuthStore((s) => s.isAuthenticated && !!s.validatedServerId)
  const validatedServerId = useAuthStore((s) => s.validatedServerId)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const gate = useServerStore((s) => s.gate)
  const isAuthenticated = sessionConfirmed && validatedServerId === activeServerId && gate === 'open'
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const [transitionPage, setTransitionPage] = useState(currentPage)
  const [transitioning, setTransitioning] = useState(false)
  const [settingsReady, setSettingsReady] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [lockPassword, setLockPassword] = useState('')
  const [lockError, setLockError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [lockAttempts, setLockAttempts] = useState(0)
  const [lockLockedUntil, setLockLockedUntil] = useState(0)

  // Live countdown for lock screen lockout
  useEffect(() => {
    if (!isLocked || lockLockedUntil <= Date.now()) return
    const interval = setInterval(() => {
      const now = Date.now()
      if (lockLockedUntil > now) {
        const remaining = Math.ceil((lockLockedUntil - now) / 1000)
        setLockError(`Too many failed attempts. Try again in ${remaining}s`)
      } else {
        setLockError('')
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [isLocked, lockLockedUntil])

  // Smooth logout transition: brief fade-to-dark before Login mounts.
  // useLayoutEffect fires synchronously BEFORE the browser paints, so
  // the user never sees Login flash before the dark screen appears.
  const [logoutFading, setLogoutFading] = useState(false)
  const prevAuthRef = useRef(isAuthenticated)
  useLayoutEffect(() => {
    if (prevAuthRef.current && !isAuthenticated) {
      setLogoutFading(true)
      const timer = setTimeout(() => setLogoutFading(false), 300)
      prevAuthRef.current = false
      return () => clearTimeout(timer)
    }
    prevAuthRef.current = isAuthenticated
  }, [isAuthenticated])

  // Personal preferences: reduced motion (a class the stylesheet honours) and the page after sign-in
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', !!reduceMotion)
  }, [reduceMotion])
  const defaultPage = useSettingsStore((s) => s.defaultPage)
  const prevAuthForPageRef = useRef(isAuthenticated)
  useEffect(() => {
    if (!prevAuthForPageRef.current && isAuthenticated && defaultPage && defaultPage !== 'dashboard') {
      setCurrentPage(defaultPage)
    }
    prevAuthForPageRef.current = isAuthenticated
  }, [isAuthenticated, defaultPage, setCurrentPage])

  // A link to a page (https://dashboard/#/stacks, from Homarr, a bookmark, a chat message) opens that page: once signed in, and
  // again whenever the address changes. The mark is then taken out of the address, so a later reload returns to the page
  // you were on last rather than to the linked one.
  useEffect(() => {
    if (!isAuthenticated) return
    const open = () => {
      const m = /^#\/([a-z-]+)\/?$/.exec(window.location.hash)
      if (!m) return
      const page = m[1] as PageId
      if (!(page in pageMeta) || page === 'setup') return
      setCurrentPage(page)
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* a sandboxed frame */ }
    }
    // after the page-after-sign-in preference, so a link wins over it
    const t = setTimeout(open, 0)
    window.addEventListener('hashchange', open)
    return () => { clearTimeout(t); window.removeEventListener('hashchange', open) }
  }, [isAuthenticated, setCurrentPage])

  // Load settings first, then sync server URL to the connection layer
  useEffect(() => {
    async function init() {
      checkAccountExists()
      await loadSettings()
      // the servers this dashboard knows (and the sessions saved for them); the active one is the server to talk to
      useServerStore.getState().loadServers()
      const active = useServerStore.getState().getActiveServer()
      if (active?.url && active.url !== useSettingsStore.getState().serverUrl) useSettingsStore.getState().updateSetting('serverUrl', active.url)
      // After settings load, sync the persisted server URL to apiClient + connectionStore
      const { serverUrl } = useSettingsStore.getState()
      if (serverUrl) {
        setServerUrl(serverUrl)
      }

      // Check if server needs first-run setup.
      // In Electron: single IPC call uses Node.js http in main process (no CORS).
      // In browser: falls back to raw fetch().
      let currentServerUrl = useSettingsStore.getState().serverUrl || getDefaultServerUrl()
      // Don't prepend http:// on relative URLs (Docker/web mode uses /api)
      if (!currentServerUrl.startsWith('/') && !/^https?:\/\//i.test(currentServerUrl)) currentServerUrl = `http://${currentServerUrl}`
      // The API may still be coming up right after ./setup.sh — a proxy 502
      // or a refused connection is "unknown", not "initialized", so keep trying.
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          let initialized = true
          if (window.electronAPI?.checkServer) {
            const res = await window.electronAPI.checkServer(currentServerUrl)
            if (res.reachable) {
              initialized = res.initialized
            }
          } else {
            const ctrl = new AbortController()
            const tid = setTimeout(() => ctrl.abort(), 5000)
            const resp = await fetch(`${currentServerUrl}/setup/status`, { method: 'GET', signal: ctrl.signal })
            clearTimeout(tid)
            if (!resp.ok) {
              throw new Error(`setup/status answered ${resp.status}`)
            }
            const data = await resp.json()
            initialized = !!data.initialized
          }
          if (!initialized) {
            if (window.electronAPI) {
              await window.electronAPI.setSetting('userAccounts', undefined)
            }
            localStorage.removeItem('userAccounts')
            localStorage.removeItem('auth-session')
            localStorage.removeItem('api-auth-token')
            apiClient.setAuthToken(null)
            const fresh = useServerStore.getState().activeServerId
            if (fresh) useServerStore.getState().updateServer(fresh, { session: null })
            useAuthStore.setState({ hasAccount: false, isAuthenticated: false, currentUser: null, validatedServerId: null })
            useServerStore.setState({ gate: 'open' })
            setCurrentPage('setup')
            setSettingsReady(true)
            return
          }
          break
        } catch {
          if (attempt < 5) await new Promise(r => setTimeout(r, 500))
        }
      }

      // The dashboard opens only for a session the active server confirms now ("Checking your sign-in" meanwhile):
      // without a device session the saved ones are ended first, so the sign-in shows
      setSettingsReady(true)
      // once per run of the app (development runs this effect twice)
      if (activeServerEntered) return
      activeServerEntered = true
      endSavedSessionsWithoutDeviceSession()
      await useServerStore.getState().enterActiveServer()
    }
    init()
  }, [checkAccountExists, loadSettings, setServerUrl, setCurrentPage])

  // Only connect after settings are loaded and server URL is synced
  useEffect(() => {
    if (isAuthenticated && settingsReady) {
      connect()
    }
  }, [isAuthenticated, settingsReady, connect])

  // Activate SSE when connected, disconnect when not
  const connectionStatus = useConnectionStore((s) => s.status)
  useEffect(() => {
    if (connectionStatus === 'connected') {
      sseClient.connect()
    } else {
      sseClient.disconnect()
    }
    return () => sseClient.disconnect()
  }, [connectionStatus])

  // The look: the person's theme, else the server's active theme, else DCS
  // Emerald — in the mode the person chose (or the device prefers). Re-dressed
  // whenever any of those change or a server theme's document (css) arrives.
  const themeName = useSettingsStore((s) => s.themeName)
  const serverThemeActive = useSettingsStore((s) => s.serverThemeActive)
  const settingsLoaded = useSettingsStore((s) => s.settingsLoaded)
  const resolvedMode = useResolvedMode()
  const themeMetas = useThemeStore((s) => s.metas)
  const themeDocs = useThemeStore((s) => s.docs)
  const localThemes = useThemeStore((s) => s.localThemes)
  const themesSupported = useThemeStore((s) => s.supported)
  useEffect(() => {
    syncDocumentTheme()
    const pending = effectiveThemeNeedsDoc()
    if (pending) useThemeStore.getState().ensureDoc(pending)
  }, [settingsLoaded, theme, resolvedMode, themeName, serverThemeActive, themeMetas, themeDocs, localThemes, themesSupported])

  // Follow the server: read GET /themes once signed in (the list needs a session: asked before sign-in it is refused and the theme
  // would wait for the next poll) and every five minutes
  usePolling(refreshServerThemes, THEME_POLL_MS, { enabled: isAuthenticated })

  // Apply per-user appearance (accent color + background image)
  const [accentColor, setAccentColor] = useState('emerald')
  const [backgroundImage, setBackgroundImage] = useState('')
  const currentUser = useAuthStore((s) => s.currentUser)
  useEffect(() => {
    const readProfile = () => {
      try {
        const key = currentUser ? profileStorageKey(currentUser) : 'user-profile'
        let raw = localStorage.getItem(key)
        // Fallback to legacy global key for migration
        if (!raw && key !== 'user-profile') raw = localStorage.getItem('user-profile')
        if (raw) {
          const parsed = JSON.parse(raw)
          setAccentColor(parsed.accentColor || 'emerald')
          setBackgroundImage(parsed.backgroundImage || '')
          return
        }
      } catch {}
      setAccentColor('emerald')
      setBackgroundImage('')
    }
    readProfile()
    window.addEventListener('profile-updated', readProfile)
    return () => window.removeEventListener('profile-updated', readProfile)
  }, [currentUser])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor)
  }, [accentColor])

  // What belongs to the person (profile, icon, accent, personal theme and choices, dashboard layout) is read the moment they are
  // signed in, on any device: the sign-in page already waited for it, this covers every other way in (a restored session, a server switch)
  const apiToken = useAuthStore((s) => s.apiToken)
  const wasSignedInRef = useRef(false)
  useEffect(() => {
    if (!isAuthenticated) {
      if (wasSignedInRef.current) { wasSignedInRef.current = false; resetUserSync() }   // signed out: the next sign-in reads everything again
      return
    }
    wasSignedInRef.current = true
    if (connectionStatus === 'connected') void hydrateUser()
  }, [isAuthenticated, currentUser, apiToken, connectionStatus])

  // Sync document title with current page
  useEffect(() => {
    document.title = `${pageLabel(currentPage)} — DCS Orchestrator`
  }, [currentPage])

  // Custom CSS injection — with security sanitization
  useEffect(() => {
    let styleEl = document.getElementById('custom-user-css') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'custom-user-css'
      document.head.appendChild(styleEl)
    }
    // SECURITY: nothing that loads or runs anything survives (lib/cssSanitize —
    // the same filter a theme's extra css goes through)
    styleEl.textContent = sanitizeCss(customCSS).css
    return () => {
      // Don't remove on cleanup — persist across re-renders
    }
  }, [customCSS])

  // Session expiry checker — forces logout when session expires
  useEffect(() => {
    if (!isAuthenticated) return
    const checkExpiry = () => {
      try {
        const raw = localStorage.getItem('auth-session')
        if (!raw) return
        const session = JSON.parse(raw)
        // expiresAt === 0 means indefinite — skip
        if (session.expiresAt && session.expiresAt !== 0 && Date.now() > session.expiresAt) {
          sessionStorage.setItem('logout-reason', 'session-expired')
          logout()
        }
      } catch { /* ignore */ }
    }
    // Check every 30 seconds
    const interval = setInterval(checkExpiry, 30000)
    return () => clearInterval(interval)
  }, [isAuthenticated, logout])

  // Auto-lock after inactivity — shows lock screen instead of full logout
  const resetAutoLock = useCallback(() => {
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current)
      autoLockTimerRef.current = null
    }
    if (autoLockMinutes > 0 && isAuthenticated && !isLocked) {
      autoLockTimerRef.current = setTimeout(() => {
        setIsLocked(true)
        setLockPassword('')
        setLockError('')
      }, autoLockMinutes * 60 * 1000)
    }
  }, [autoLockMinutes, isAuthenticated, isLocked])

  // Signing in (again) is an unlock: a lock that fired while the session was
  // dead must not greet the user right after the login page
  const wasAuthenticatedRef = useRef(isAuthenticated)
  useEffect(() => {
    if (isAuthenticated && !wasAuthenticatedRef.current) {
      setIsLocked(false)
      setLockPassword('')
      setLockError('')
      setLockAttempts(0)
      setLockLockedUntil(0)
    }
    wasAuthenticatedRef.current = isAuthenticated
  }, [isAuthenticated])

  // Unlock handler — verifies password locally with rate limiting
  const handleUnlock = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!lockPassword.trim() || unlocking) return

    // Check lock screen rate limit
    if (lockLockedUntil > Date.now()) {
      const remaining = Math.ceil((lockLockedUntil - Date.now()) / 1000)
      setLockError(`Too many failed attempts. Try again in ${remaining}s`)
      return
    }

    setUnlocking(true)
    setLockError('')
    try {
      const { login, currentUser } = useAuthStore.getState()
      if (!currentUser) { setLockError('No active session'); setUnlocking(false); return }
      const ok = await login(currentUser, lockPassword, true) // rememberMe — preserve session after unlock
      if (ok) {
        setIsLocked(false)
        setLockPassword('')
        setLockError('')
        setLockAttempts(0)
        setLockLockedUntil(0)
        resetAutoLock()
      } else {
        const next = lockAttempts + 1
        setLockAttempts(next)
        if (next >= 5) {
          const until = Date.now() + 60_000
          setLockLockedUntil(until)
          setLockError('Too many failed attempts. Try again in 60s')
          setLockAttempts(0)
        } else {
          setLockError('Incorrect password')
        }
      }
    } catch {
      setLockError('Verification failed')
    }
    setUnlocking(false)
  }, [lockPassword, unlocking, resetAutoLock, lockAttempts, lockLockedUntil])

  useEffect(() => {
    if (!isAuthenticated || autoLockMinutes <= 0 || isLocked) return
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const
    const handler = () => resetAutoLock()
    for (const evt of events) window.addEventListener(evt, handler, { passive: true })
    resetAutoLock()
    return () => {
      for (const evt of events) window.removeEventListener(evt, handler)
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current)
    }
  }, [isAuthenticated, autoLockMinutes, resetAutoLock, isLocked])

  // Listen for manual lock from header dropdown
  useEffect(() => {
    const handler = () => { setIsLocked(true); setLockPassword(''); setLockError('') }
    window.addEventListener('dcs-lock-screen', handler)
    return () => window.removeEventListener('dcs-lock-screen', handler)
  }, [])

  // The payload of a navigation reaches the new page once it is on screen, never the page being left (settingsStore)
  useEffect(() => {
    if (transitionPage !== currentPage) return
    const pending = useSettingsStore.getState().pendingNavigationPayload
    if (pending) useSettingsStore.setState({ navigationPayload: pending, pendingNavigationPayload: null })
  }, [transitionPage, currentPage])

  // Smooth page transition: fade out, swap component, fade in
  useEffect(() => {
    if (currentPage !== transitionPage) {
      setTransitioning(true)
      mainRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
      const timer = setTimeout(() => {
        setTransitionPage(currentPage)
        setTransitioning(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [currentPage, transitionPage])

  // Global keyboard shortcuts
  useEffect(() => {
    if (!isAuthenticated || currentPage === 'setup') return
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      const digit = parseInt(e.key, 10)
      if (digit >= 0 && digit <= 9 && !e.shiftKey && !e.altKey) {
        const section = navSections[digit === 0 ? 9 : digit - 1]
        if (section) {
          e.preventDefault()
          const { currentPage: current, hiddenPages } = useSettingsStore.getState()
          const hidden = technitiumEnabledNow() ? hiddenPages ?? [] : [...(hiddenPages ?? []), 'technitium' as const]
          const shown = visiblePages(section, { isAdmin: useAuthStore.getState().userRole === 'admin', hidden, adminOnly: ADMIN_ONLY_PAGES })
          if (shown.includes(current as never)) setCurrentPage(current, { resetView: true })
          else {
            const to = sectionTarget(section, shown)
            if (to) setCurrentPage(to)
          }
        }
      }
      // Ctrl+B → Toggle sidebar
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        toggleSidebar()
      }
      // Ctrl+D → Toggle dark/light theme
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        toggleMode()
      }
      // Ctrl+R → Refresh (dispatch custom event for pages to listen to)
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app-refresh'))
      }
      // Ctrl+T → Terminal
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        setCurrentPage('terminal')
      }
      // Ctrl+Shift+P → Command Palette (alternative to Ctrl+K)
      if (e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('open-command-palette'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCurrentPage, isAuthenticated, currentPage, toggleSidebar, updateSetting])

  // Show setup wizard if server needs first-run setup
  if (currentPage === 'setup' && settingsReady) {
    return <SetupWizard onComplete={() => setCurrentPage('dashboard')} />
  }

  // Show login screen if not authenticated
  if (!settingsReady || authLoading) {
    return (
      <div className="h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 animate-fade-in">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-xl" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20 flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-gradient">DCS Orchestrator</h1>
          </div>
          <div className="w-32 h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-emerald-500/40 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    // During logout fade, show a brief dark screen so the layout doesn't
    // abruptly snap from the full dashboard to the login form.
    if (logoutFading) {
      return <div className="h-screen bg-slate-950" />
    }
    if (gate === 'checking') return <ServerCheckingScreen />
    if (gate === 'unreachable') return <ServerUnreachableScreen />
    // keyed by the server: each server's sign-in starts afresh with its own account filled in
    return <Login key={activeServerId ?? 'none'} />
  }

  const ActivePage = pageComponents[transitionPage as Exclude<PageId, AliasPageId>] || Dashboard

  return (
    <ToastProvider>
      <div
        className="h-screen flex flex-col bg-slate-950 overflow-hidden theme-bg safe-area-top safe-area-bottom"
        style={backgroundImage && /^(https?:|data:image\/|\/|\.\/)/i.test(backgroundImage) ? {
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        } : undefined}
      >
        {/* Background overlay for readability when using bg image */}
        {backgroundImage && (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm z-0" />
        )}

        {/* A newer dashboard build is being served (web only) */}
        <UpdateBanner />

        {/* Lock screen overlay — preserves app state, just requires password to continue */}
        {isLocked && (
          <ModalOverlay label="Session locked" className="fixed inset-0 z-[99998] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl animate-fade-in">
            <div className="w-full max-w-sm mx-4">
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center">
                  <Lock size={28} className="text-amber-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-100">Session locked</h2>
                <p className="text-sm text-slate-500 mt-1">Locked due to inactivity. Enter your password to continue.</p>
              </div>
              <form onSubmit={handleUnlock} className="space-y-4">
                <div className="relative">
                  <input
                    type="password"
                    value={lockPassword}
                    onChange={(e) => { setLockPassword(e.target.value); setLockError('') }}
                    placeholder="Enter password"
                    autoFocus
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
                {lockError && (
                  <p className="text-xs text-rose-400 text-center">{lockError}</p>
                )}
                <button
                  type="submit"
                  disabled={unlocking || !lockPassword.trim()}
                  className="w-full py-3 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {unlocking ? 'Verifying...' : 'Unlock'}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsLocked(false); logout() }}
                  className="w-full py-2 text-xs text-slate-500 hover:text-slate-400 transition-colors"
                >
                  Sign out instead
                </button>
              </form>
            </div>
          </ModalOverlay>
        )}

        {/* Onboarding overlay (self-managing visibility via localStorage) */}
        <OnboardingOverlay />

        {/* Global data polling (sidebar badges, status bar) */}
        <GlobalPoller />
        <DiscordPresence />

        {/* Command Palette + Keyboard Shortcuts */}
        <CommandPalette />
        <KeyboardShortcuts />
        {/* The one confirm dialog every page asks with (useConfirm) */}
        <ConfirmDialogHost />

        {/* Header — z-30 so dropdown renders above content area */}
        <div className="relative z-30">
          <Header />
        </div>

        <div className="flex flex-1 overflow-hidden relative z-10">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content area */}
          {/* room at the bottom for the floating chat and back-to-top buttons: the last row of a page scrolls clear of them */}
          <main ref={mainRef} className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-24 transition-all duration-300 scrollbar-thin overscroll-contain">
            <div className="max-w-[1600px] mx-auto">
              {/* the section's pages: outside the fade, so switching tabs never blinks the strip */}
              <SectionTabs />
              <div className={`transition-all duration-150 ${transitioning ? 'opacity-0 translate-y-0.5 scale-[0.998]' : 'opacity-100 translate-y-0 scale-100'}`}>
                <ErrorBoundary
                  key={transitionPage}
                  fallbackMessage="This page encountered an error"
                  onNavigateHome={() => setCurrentPage('dashboard')}
                >
                  <ActivePage />
                </ErrorBoundary>
              </div>
            </div>
            <BackToTop scrollRef={mainRef} />
          </main>
          {/* the server's chat room, bottom right (drawn into document.body) */}
          <ChatBubble />
        </div>

        {/* Status bar (desktop) and the phone's bottom navigation */}
        <div className="relative z-10">
          <StatusBar />
          <MobileNav />
        </div>
      </div>
    </ToastProvider>
  )
}
