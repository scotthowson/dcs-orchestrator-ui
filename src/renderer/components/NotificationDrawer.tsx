// =============================================================================
// NotificationDrawer — Slide-out notification center from the right side
// =============================================================================

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Switch as MantineSwitch } from '@mantine/core'
import {
  Bell, BellOff, X, Info, CheckCircle, AlertTriangle, XCircle,
  Clock, Trash2, Check, Settings2, Monitor,
} from 'lucide-react'
import { useNotificationStore } from '../stores/notificationStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Notification } from '../stores/notificationStore'
import type { PageId } from '../../shared/types'
import { useModalA11y } from '../hooks/useModalA11y'

import { Count } from './common/Pill'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'error' | 'warning' | 'info'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeStyles: Record<Notification['type'], { icon: typeof Info; color: string; bg: string; border: string }> = {
  info: {
    icon: Info,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/20',
  },
  success: {
    icon: CheckCircle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
  },
  error: {
    icon: XCircle,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/20',
  },
}

const filterTabs: { id: FilterTab; label: string; types: Notification['type'][] }[] = [
  { id: 'all', label: 'All', types: ['info', 'success', 'warning', 'error'] },
  { id: 'error', label: 'Errors', types: ['error'] },
  { id: 'warning', label: 'Warnings', types: ['warning'] },
  { id: 'info', label: 'Info', types: ['info', 'success'] },
]

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// NotificationCard
// ---------------------------------------------------------------------------

function NotificationCard({
  notification,
  onNavigate,
}: {
  notification: Notification
  onNavigate: (page: string) => void
}) {
  const { markAsRead, removeNotification } = useNotificationStore()
  const style = typeStyles[notification.type]
  const Icon = style.icon

  const handleClick = () => {
    if (!notification.read) {
      markAsRead(notification.id)
    }
    if (notification.action?.page) {
      onNavigate(notification.action.page)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`
        group relative flex items-start gap-3 px-4 py-3
        border-b border-white/[0.03]
        transition-all duration-200
        ${notification.action ? 'cursor-pointer' : 'cursor-default'}
        ${notification.read ? 'opacity-60' : ''}
        hover:bg-white/[0.03]
      `}
    >
      {/* Type icon */}
      <div className={`
        flex-shrink-0 flex items-center justify-center
        w-8 h-8 rounded-lg mt-0.5
        ${style.bg} ${style.border} border
      `}>
        <Icon size={14} className={style.color} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs font-semibold leading-snug ${notification.read ? 'text-slate-400' : 'text-slate-200'}`}>
            {notification.title}
          </p>
          {/* Remove button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeNotification(notification.id)
            }}
            className="
              flex-shrink-0 opacity-0 group-hover:opacity-100
              p-0.5 rounded text-slate-500 hover:text-rose-400
              transition-all duration-150
            "
            title="Remove notification"
          >
            <X size={12} />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Clock size={9} />
            {relativeTime(notification.timestamp)}
          </span>
          {notification.action && (
            <span className="text-[10px] text-cyan-500/70 font-medium">
              {notification.action.label}
            </span>
          )}
        </div>
      </div>

      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute bottom-3.5 right-3.5 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-400/20 flex-shrink-0" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle Switch
// ---------------------------------------------------------------------------

/** a preference row: its name on the left, the dashboard's toggle (a Mantine Switch) on the right; the whole row toggles */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="py-1.5 text-slate-400 hover:text-slate-300 transition-colors">
      <MantineSwitch
        size="sm"
        checked={checked}
        onChange={() => onChange(!checked)}
        label={label}
        labelPosition="left"
        classNames={{ body: 'justify-between' }}
        styles={{ label: { fontSize: 11 } }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// NotificationDrawer
// ---------------------------------------------------------------------------

export function NotificationDrawer() {
  const {
    drawerOpen,
    preferences,
    markAllRead,
    clearAll,
    setDrawerOpen,
    setPreference,
    requestDesktopPermission,
    getServerNotifications,
    getServerUnreadCount,
  } = useNotificationStore()

  // Use server-filtered notifications — only show notifications for the active server
  const notifications = getServerNotifications()
  const unreadCount = getServerUnreadCount()

  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const panelRef = useRef<HTMLDivElement>(null)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [showPrefs, setShowPrefs] = useState(false)

  // Closed, the drawer stays in the page (it slides out): nothing in it may take a Tab or be read
  useLayoutEffect(() => { panelRef.current?.toggleAttribute('inert', !drawerOpen) }, [drawerOpen])
  // Open: Escape closes it, focus moves in, stays inside and returns to the bell that opened it
  useModalA11y(panelRef, () => setDrawerOpen(false), { active: drawerOpen })

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setDrawerOpen(false)
      }
    },
    [setDrawerOpen],
  )

  const handleNavigate = useCallback(
    (page: string) => {
      setCurrentPage(page as PageId)
      setDrawerOpen(false)
    },
    [setCurrentPage, setDrawerOpen],
  )

  // Filtered notifications
  const currentFilter = filterTabs.find((t) => t.id === activeFilter) ?? filterTabs[0]
  const filteredNotifications = useMemo(
    () => notifications.filter((n) => currentFilter.types.includes(n.type)),
    [notifications, currentFilter],
  )

  // Per-tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = { all: 0, error: 0, warning: 0, info: 0 }
    for (const n of notifications) {
      counts.all++
      if (n.type === 'error') counts.error++
      else if (n.type === 'warning') counts.warning++
      else counts.info++
    }
    return counts
  }, [notifications])

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        className={`
          fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm
          transition-opacity duration-300
          ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
      >
        {/* Drawer panel */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          className={`
            absolute top-0 right-0 h-full w-[380px] max-w-[calc(100vw-2rem)]
            bg-slate-950 border-l border-white/5
            flex flex-col
            transition-transform duration-300 ease-out
            ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}
          `}
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-slate-200">Notifications</h2>
              {unreadCount > 0 && (
                <Count n={unreadCount} tone="info" label={`${unreadCount} unread`} />
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Preferences toggle */}
              <button
                onClick={() => setShowPrefs(!showPrefs)}
                className={`
                  flex items-center justify-center w-7 h-7 rounded-lg
                  transition-all duration-150
                  ${showPrefs
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                  }
                `}
                title="Notification preferences"
              >
                <Settings2 size={13} />
              </button>

              {/* Mark all read */}
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="
                    flex items-center gap-1 px-2 py-1 rounded-md
                    text-[10px] font-medium text-slate-500
                    hover:bg-white/5 hover:text-slate-300
                    transition-all duration-150
                  "
                  title="Mark all as read"
                >
                  <Check size={11} />
                  <span>Mark all read</span>
                </button>
              )}

              {/* Clear all */}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="
                    flex items-center gap-1 px-2 py-1 rounded-md
                    text-[10px] font-medium text-slate-500
                    hover:bg-rose-500/10 hover:text-rose-400
                    transition-all duration-150
                  "
                  title="Clear all notifications"
                >
                  <Trash2 size={11} />
                </button>
              )}

              {/* Close */}
              <button
                onClick={() => setDrawerOpen(false)}
                className="
                  flex items-center justify-center w-7 h-7 rounded-lg
                  text-slate-500 hover:bg-white/5 hover:text-slate-300
                  transition-all duration-150 ml-1
                "
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Preferences Panel */}
          {showPrefs && (
            <div className="px-4 py-3 border-b border-white/5 bg-white/[0.01] shrink-0 animate-fade-in">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                Alert Preferences
              </p>
              <div className="space-y-0.5">
                <Toggle
                  checked={preferences.healthAlerts}
                  onChange={(v) => setPreference('healthAlerts', v)}
                  label="Health state changes"
                />
                <Toggle
                  checked={preferences.connectionAlerts}
                  onChange={(v) => setPreference('connectionAlerts', v)}
                  label="Connection changes"
                />
                <Toggle
                  checked={preferences.containerCrashAlerts}
                  onChange={(v) => setPreference('containerCrashAlerts', v)}
                  label="Container crash alerts"
                />
                <Toggle
                  checked={preferences.desktopNotifications}
                  onChange={(v) => {
                    if (v && 'Notification' in window && Notification.permission === 'default') {
                      requestDesktopPermission()
                    } else {
                      setPreference('desktopNotifications', v)
                    }
                  }}
                  label="Desktop notifications"
                />
              </div>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 shrink-0">
            {filterTabs.map((tab) => {
              const count = tabCounts[tab.id]
              const isActive = activeFilter === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-md
                    text-[11px] font-medium transition-all duration-150
                    ${isActive
                      ? 'bg-white/[0.06] text-slate-200 border border-white/10'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }
                  `}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`
                      text-[9px] rounded-full px-1.5 py-0.5 font-bold
                      ${isActive ? 'bg-white/[0.08] text-slate-300' : 'bg-white/5 text-slate-500'}
                    `}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5">
                  <BellOff size={24} className="text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-400">
                    {activeFilter === 'all' ? 'No notifications yet' : `No ${currentFilter.label.toLowerCase()}`}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {activeFilter === 'all'
                      ? 'Notifications from your Docker services will appear here'
                      : 'Try checking another filter tab'}
                  </p>
                </div>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onNavigate={handleNavigate}
                />
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-white/5 shrink-0">
              <p className="text-[10px] text-slate-500 text-center">
                {activeFilter === 'all'
                  ? `${notifications.length} notification${notifications.length !== 1 ? 's' : ''}`
                  : `${filteredNotifications.length} of ${notifications.length}`}
                {unreadCount > 0 && ` \u00b7 ${unreadCount} unread`}
              </p>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
