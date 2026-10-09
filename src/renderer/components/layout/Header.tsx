// =============================================================================
// Header — Top bar with page title, user profile dropdown, theme toggle, status
// =============================================================================

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon, LogOut, ChevronDown, Settings, Shield, UserCircle, Mail, Clock, Bell, Sparkles, Zap, Palette, Download, Network, Lock, RefreshCw, Package, Layout, Store, Cpu, HardDrive, BarChart3, KeyRound } from 'lucide-react'
import { BUILD_VERSION, BUILD_DATE } from '../../constants/buildInfo'
import { useSettingsStore } from '../../stores/settingsStore'
import { toggleMode, useResolvedMode } from '../../lib/colorMode'
import { useConnectionStore } from '../../stores/connectionStore'
import { useApiLink } from '../../hooks/useApiLink'
import { useSystemStore } from '../../stores/systemStore'
import { useAuthStore } from '../../stores/authStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { NotificationDrawer } from '../NotificationDrawer'
import Breadcrumbs from '../common/Breadcrumbs'
import type { PageId } from '../../../shared/types'
import type { ConnectionStatus } from '../../../shared/types'

import { pageLabel } from '../../constants/pageTitles'
import ModalOverlay from '../common/ModalOverlay'

import { Count } from '../common/Pill'
import CloseButton from '../common/CloseButton'
import { BTN_TOOLBAR_OK } from '../../lib/ui'
import Kbd from '../common/Kbd'
const statusConfig: Record<ConnectionStatus, { color: string; ringColor: string; pulse: boolean; label: string }> = {
  connected: {
    color: 'bg-emerald-400',
    ringColor: 'ring-emerald-400/30',
    pulse: false,
    label: 'Connected',
  },
  connecting: {
    color: 'bg-amber-400',
    ringColor: 'ring-amber-400/30',
    pulse: true,
    label: 'Connecting...',
  },
  disconnected: {
    color: 'bg-slate-500',
    ringColor: 'ring-slate-500/20',
    pulse: false,
    label: 'Disconnected',
  },
  error: {
    color: 'bg-rose-400',
    ringColor: 'ring-rose-400/30',
    pulse: true,
    label: 'Connection error',
  },
}

// ---------------------------------------------------------------------------
// User Profile Dropdown
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What's new Changelog
// ---------------------------------------------------------------------------

const CHANGELOG = [
  {
    version: '2.8',
    date: '2026-03-31',
    highlights: [
      { icon: Store, color: 'text-orange-400', text: 'Homarr integration — auto-register services on deploy with icons' },
      { icon: KeyRound, color: 'text-amber-400', text: 'Secrets system — encrypted ${SECRETS_KEY} variables in compose files' },
      { icon: Cpu, color: 'text-cyan-400', text: 'Live CPU/memory stats on containers page and dashboard Top Consumers' },
      { icon: Bell, color: 'text-rose-400', text: 'NTFY notification engine — custom messages with template variables' },
      { icon: Package, color: 'text-emerald-400', text: 'Registry-based image update detection (no pulling)' },
      { icon: HardDrive, color: 'text-sky-400', text: 'Disk analysis — host disk stats, Docker volumes, per-stack sizes' },
      { icon: BarChart3, color: 'text-amber-400', text: 'Resource limits toggle on template deploy (memory + CPU)' },
      { icon: Sparkles, color: 'text-pink-400', text: '15 template categories with grouped view and smart filtering' },
      { icon: Zap, color: 'text-indigo-400', text: 'Deploy only starts new services — no more Plex/Homarr restarts' },
      { icon: Shield, color: 'text-violet-400', text: '60+ server config settings readable and writable via API' },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-03-30',
    highlights: [
      { icon: Shield, color: 'text-violet-400', text: 'Authelia SSO — single sign-on with 2FA, deployed from Setup Wizard' },
      { icon: Zap, color: 'text-emerald-400', text: 'Traefik auto-routing — wildcard TLS, auto DNS, custom subdomains' },
      { icon: Network, color: 'text-cyan-400', text: 'Cloudflare DNS — auto CNAME on deploy, auto-delete on undeploy' },
      { icon: Lock, color: 'text-amber-400', text: 'Auto-generate secrets and encryption keys on deploy' },
      { icon: Layout, color: 'text-amber-400', text: 'Customizable dashboard — drag, resize, rearrange cards' },
      { icon: RefreshCw, color: 'text-emerald-400', text: 'System updates — one-click with backup tags and rollback' },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-03-18',
    highlights: [
      { icon: Zap, color: 'text-emerald-400', text: 'Setup Wizard — guided first-run configuration with Traefik' },
      { icon: Package, color: 'text-cyan-400', text: '100+ service templates with one-click deployment' },
      { icon: Lock, color: 'text-amber-400', text: 'Security hardening — SSRF protection, session management' },
      { icon: Layout, color: 'text-violet-400', text: 'Plugin system with lifecycle hooks and template support' },
    ],
  },
]

function WhatsNewModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Mark as seen
  useEffect(() => {
    localStorage.setItem('whats-new-seen', BUILD_VERSION)
  }, [])

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 glass rounded-2xl border border-white/10 shadow-2xl shadow-black/40 animate-scale-in max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/10">
              <Sparkles size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">What's new</h2>
              <p className="text-xs text-slate-400">Latest features and improvements</p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Changelog */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-6">
          {CHANGELOG.map((release, ri) => (
            <div key={release.version}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-bold text-white">v{release.version}</span>
                <span className="text-[10px] text-slate-500 font-mono">{release.date}</span>
                {ri === 0 && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    Latest
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {release.highlights.map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.text} className="flex items-start gap-3 py-1.5">
                      <Icon size={14} className={`${item.color} shrink-0 mt-0.5`} />
                      <p className="text-xs text-slate-300 leading-relaxed">{item.text}</p>
                    </div>
                  )
                })}
              </div>
              {ri < CHANGELOG.length - 1 && <div className="border-b border-white/5 mt-4" />}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-slate-500">DCS Orchestrator · dashboard v{BUILD_VERSION}</p>
          <button
            onClick={onClose}
            className={BTN_TOOLBAR_OK}
          >
            Got it
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// User Profile Dropdown
// ---------------------------------------------------------------------------

function UserProfileDropdown({ onClose, onWhatsNew, hasUnseen }: { onClose: () => void; onWhatsNew?: () => void; hasUnseen?: boolean }) {
  const { currentUser, userRole, logout } = useAuthStore()
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const ref = useRef<HTMLDivElement>(null)

  // Get profile data from per-user localStorage key
  const profileData = (() => {
    try {
      const key = currentUser ? `user-profile-${currentUser}` : 'user-profile'
      let raw = localStorage.getItem(key)
      if (!raw && key !== 'user-profile') raw = localStorage.getItem('user-profile')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })()

  const userInitial = (currentUser?.[0] ?? 'U').toUpperCase()
  const profileIconRaw = profileData.icon ?? ''
  // SECURITY: Only allow http/https/data URIs for profile images — prevents javascript: XSS
  const profileIcon = profileIconRaw.length > 2 && /^(https?:|data:image\/)/.test(profileIconRaw) ? profileIconRaw : profileIconRaw.length <= 2 ? profileIconRaw : ''
  const profileEmail = profileData.email ?? ''
  const statusEmojiRaw: string = profileData.statusEmoji ?? ''
  // Older builds saved the emoji as its JSON escape text: show the emoji, not the text
  const statusEmoji = /^(\\u[0-9A-Fa-f]{4})+$/.test(statusEmojiRaw) ? (() => { try { return JSON.parse('"' + statusEmojiRaw + '"') as string } catch { return '' } })() : statusEmojiRaw

  // Compute session duration from localStorage
  const sessionDuration = (() => {
    try {
      const raw = localStorage.getItem('auth-session')
      if (!raw) return ''
      const session = JSON.parse(raw)
      const start = session.loginAt ?? session.createdAt ?? session.timestamp
      if (!start) return ''
      const mins = Math.floor((Date.now() - start) / 60000)
      if (mins < 1) return 'Just now'
      if (mins < 60) return `${mins}m`
      const hrs = Math.floor(mins / 60)
      if (hrs < 24) return `${hrs}h ${mins % 60}m`
      return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
    } catch { return '' }
  })()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const menuItems = [
    {
      icon: UserCircle,
      label: 'Edit profile',
      description: 'Name, email, avatar',
      onClick: () => { onClose(); setCurrentPage('settings') },
    },
    {
      icon: Settings,
      label: 'Settings',
      description: 'Connection, preferences',
      onClick: () => { onClose(); setCurrentPage('settings') },
    },
    {
      icon: Shield,
      label: 'Security',
      description: 'Local auth, session',
      onClick: () => { onClose(); setCurrentPage('settings') },
    },
  ]

  return (
    <div
      ref={ref}
      className="no-drag absolute right-0 top-full mt-2 w-72 rounded-xl overflow-hidden animate-scale-in z-50 shadow-2xl shadow-black/40 border border-white/10"
      style={{ WebkitAppRegion: 'no-drag', backgroundColor: 'rgba(15, 23, 42, 0.97)', backdropFilter: 'blur(24px)' } as React.CSSProperties}
    >
      {/* Profile header */}
      <div className="px-4 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          {profileIcon && profileIcon.length > 2 ? (
            <img src={profileIcon} alt="" className="w-8 h-8 md:w-10 md:h-10 rounded-full object-cover ring-2 ring-emerald-500/20" />
          ) : profileIcon ? (
            <span className="text-2xl">{profileIcon}</span>
          ) : (
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-emerald-500/20">
              {userInitial}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">
              {currentUser}{statusEmoji ? ` ${statusEmoji}` : ''}
            </p>
            {profileEmail ? (
              <p className="text-[10px] text-slate-500 truncate flex items-center gap-1">
                <Mail size={8} />
                {profileEmail}
              </p>
            ) : (
              <p className="text-[10px] text-slate-500 capitalize">{userRole ?? 'User'}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-[9px] font-semibold text-emerald-400">
              <Clock size={8} />
              Active
            </span>
            {sessionDuration && (
              <span className="text-[9px] text-slate-500 tabular-nums">
                Session: {sessionDuration}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Menu items */}
      <div className="py-1.5">
        {menuItems.map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            className="no-drag flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-white/5 transition-colors duration-200 cursor-pointer"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5">
              <item.icon size={14} className="text-slate-400" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium text-slate-200">{item.label}</p>
              <p className="text-[10px] text-slate-500">{item.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* What's new */}
      <div className="border-t border-white/5 py-1.5">
        <button
          onClick={() => { onClose(); onWhatsNew?.() }}
          className="no-drag flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-white/5 transition-colors duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 relative">
            <Sparkles size={14} className="text-amber-400" />
            {hasUnseen && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400" />}
          </div>
          <div className="text-left">
            <p className="text-xs font-medium text-slate-200">What's new</p>
            <p className="text-[10px] text-slate-500">Latest features & changes</p>
          </div>
        </button>
      </div>

      {/* Lock & Logout */}
      <div className="border-t border-white/5 p-2 space-y-1">
        <button
          onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('dcs-lock-screen')) }}
          className="no-drag flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-amber-400 hover:bg-amber-500/10 transition-colors duration-200 cursor-pointer"
        >
          <Lock size={14} />
          <span className="text-xs font-medium">Lock screen</span>
        </button>
        <button
          onClick={() => { onClose(); logout() }}
          className="no-drag flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors duration-200 cursor-pointer"
        >
          <LogOut size={14} />
          <span className="text-xs font-medium">Sign out</span>
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function Header() {
  const currentPage = useSettingsStore((s) => s.currentPage)
  // the look showing now ("System" resolved); the switch always picks the other one explicitly
  const mode = useResolvedMode()
  const connectionStatus = useConnectionStore((s) => s.status)
  const latencyMs = useConnectionStore((s) => s.latencyMs)
  const serverStatus = useSystemStore((s) => s.status)
  const { currentUser } = useAuthStore()
  const unreadCount = useNotificationStore((s) => s.getServerUnreadCount())
  const toggleDrawer = useNotificationStore((s) => s.toggleDrawer)

  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [profileVersion, setProfileVersion] = useState(0)

  // Show What's new badge if user hasn't seen this version
  const whatsNewSeen = localStorage.getItem('whats-new-seen')
  const hasNewChangelog = whatsNewSeen !== BUILD_VERSION

  // Re-read profile data when the profile-updated event fires
  useEffect(() => {
    const handler = () => setProfileVersion((v) => v + 1)
    window.addEventListener('profile-updated', handler)
    return () => window.removeEventListener('profile-updated', handler)
  }, [])

  const title = pageLabel(currentPage)
  // what the pill says is what is going on: an API that stalls, one that is being reconnected, one that is gone
  const link = useApiLink()
  const { color, ringColor, pulse, label } = link.state === 'trouble'
    ? { color: 'bg-amber-400', ringColor: 'ring-amber-400/30', pulse: true, label: link.short }
    : connectionStatus === 'error'
      ? { ...statusConfig.error, label: link.short }
      : statusConfig[connectionStatus]
  const hostname = serverStatus?.hostname
  const isDark = mode === 'dark'
  const userInitial = (currentUser?.[0] ?? 'U').toUpperCase()

  // Get profile icon (re-reads on profileVersion change)
  const profileIcon = (() => {
    void profileVersion // dependency trigger
    try {
      const key = currentUser ? `user-profile-${currentUser}` : 'user-profile'
      let raw = localStorage.getItem(key)
      if (!raw && key !== 'user-profile') raw = localStorage.getItem('user-profile')
      return raw ? JSON.parse(raw).icon ?? '' : ''
    } catch { return '' }
  })()

  const toggleTheme = toggleMode

  return (
    <>
    <header
      className="
        drag-region relative
        flex items-center justify-between
        h-14 px-4 md:px-5
        bg-slate-900/80 backdrop-blur-2xl
        border-b border-white/5
        shrink-0
      "
    >
      {/* Left: a phone names the page here; from md up the page's own heading does, and this is the breadcrumb (where you are) */}
      <div className="no-drag flex items-center gap-3 min-w-0">
        <p className="md:hidden text-base font-semibold text-slate-200 select-none tracking-wide truncate">
          {title}
        </p>
        <div className="hidden md:block">
          <Breadcrumbs />
        </div>
        {hostname && (
          <span className="hidden md:contents">
            <span className="text-white/[0.08]">/</span>
            <span className="text-xs text-slate-500 font-mono select-none">
              {hostname}
            </span>
          </span>
        )}
      </div>

      {/* Centre: global search — finds pages, containers, stacks, templates, routes, VMs and docs */}
      <div className="no-drag hidden lg:flex absolute left-1/2 -translate-x-1/2 w-[min(38vw,32rem)]">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          className="
            w-full flex items-center gap-2.5
            rounded-xl px-3 py-1.5
            text-[12px] text-slate-500
            bg-white/[0.04] border border-white/[0.06]
            hover:bg-white/[0.07] hover:text-slate-300 hover:border-white/10
            transition-all duration-200 press
          "
          title="Search anything (Ctrl+K)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <span className="flex-1 text-left truncate">Search anything…</span>
          <Kbd>Ctrl+K</Kbd>
        </button>
      </div>

      {/* Right: Notifications beside the user menu, then theme and connection */}
      <div className="no-drag flex items-center gap-2.5">
        {/* Notification bell */}
        <button
          onClick={toggleDrawer}
          className="
            relative flex items-center justify-center w-11 h-11 md:w-8 md:h-8
            rounded-lg text-slate-400
            bg-white/[0.03] border border-white/5
            hover:bg-white/10 hover:text-slate-200
            transition-all duration-200 press
          "
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <Count alert n={unreadCount > 99 ? '99+' : unreadCount} className="absolute -top-1 -right-1 animate-scale-in" />
          )}
        </button>

        {/* Compact search on tablets (the centred bar needs a wide header) */}
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
          className="hidden md:flex lg:hidden items-center justify-center w-8 h-8 rounded-lg text-slate-400 bg-white/[0.03] border border-white/5 hover:bg-white/10 hover:text-slate-200 transition-all duration-200 press"
          title="Search (Ctrl+K)"
          aria-label="Search"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>

        {/* User Profile Button */}
        {currentUser && (
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="
                flex items-center gap-1.5 md:gap-2 px-1.5 md:px-2 py-1.5 rounded-lg min-h-[44px] md:min-h-0
                bg-white/[0.03] border border-white/5
                hover:bg-white/5 hover:border-white/10
                transition-all duration-200 press
              "
            >
              {profileIcon && profileIcon.length > 2 ? (
                <img src={profileIcon} alt="" className="w-5 h-5 rounded-full object-cover" />
              ) : profileIcon ? (
                <span className="text-sm">{profileIcon}</span>
              ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white text-[9px] font-bold">
                  {userInitial}
                </div>
              )}
              <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">{currentUser}</span>
              <ChevronDown size={10} className={`text-slate-500 transition-transform duration-200 hidden sm:block ${showProfileMenu ? 'rotate-180' : ''}`} />
            </button>

            {showProfileMenu && (
              <UserProfileDropdown onClose={() => setShowProfileMenu(false)} onWhatsNew={() => setShowWhatsNew(true)} hasUnseen={hasNewChangelog} />
            )}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="
            flex items-center justify-center w-11 h-11 md:w-8 md:h-8
            rounded-lg text-slate-400
            bg-white/[0.03] border border-white/5
            hover:bg-white/10 hover:text-slate-200
            transition-all duration-200 press
          "
          title={isDark ? 'Switch to light mode (Ctrl+D)' : 'Switch to dark mode (Ctrl+D)'}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Connection status pill */}
        <div className={`
          inline-flex items-center gap-1.5 md:gap-2 rounded-full px-2 md:px-3 py-1 md:py-1.5
          border transition-all duration-300
          ${link.state === 'live'
            ? 'bg-emerald-500/8 border-emerald-500/15 glow-emerald'
            : link.state === 'trouble'
              ? 'bg-amber-500/8 border-amber-500/15'
            : connectionStatus === 'error'
              ? 'bg-rose-500/8 border-rose-500/15'
              : connectionStatus === 'connecting'
                ? 'bg-amber-500/8 border-amber-500/15'
                : 'bg-slate-500/8 border-slate-500/15'
          }
        `}>
          <span className="relative flex h-2 w-2">
            {pulse && (
              <span
                className={`absolute inset-0 rounded-full ${color} opacity-50 animate-ping`}
                style={{ animationDuration: '2s' }}
              />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${color} ring-2 ${ringColor} transition-colors duration-500`} />
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-400 font-medium">{label}</span>
          {link.live && latencyMs != null && (
            <>
              <span className="hidden sm:inline text-slate-500 text-[10px]">&mdash;</span>
              <span className={`hidden sm:inline text-[10px] tabular-nums font-mono ${latencyMs < 100 ? 'text-emerald-400/70' : latencyMs < 300 ? 'text-amber-400/70' : 'text-rose-400/70'}`}>{latencyMs}ms</span>
            </>
          )}
        </div>
      </div>
    </header>
    <NotificationDrawer />
    {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}
    </>
  )
}
