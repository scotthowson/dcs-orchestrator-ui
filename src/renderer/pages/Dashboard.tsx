// =============================================================================
// Dashboard — Advanced overview page with live data, disk mounts, quick actions
// =============================================================================

import React, { useRef, useEffect } from 'react'
import { WifiOff, Wifi, Loader2, Server, RefreshCw, Settings2, BellRing } from 'lucide-react'
import { Badge } from '@mantine/core'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import {
  fetchEvents, fetchVersion,
  fetchDisks, fetchSystemInfo,
  fetchStacks, fetchImageUpdates, fetchBackupStatus, fetchOsUpdates,
  fetchLogStats, fetchMaintenanceReport, fetchNotificationHistory,
  fetchAutomations, fetchSchedules, fetchMetricsTrends, crowdsecStatus, crowdsecCommunity,
} from '../api/endpoints'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useContainerStore } from '../stores/containerStore'
import { useSystemStore } from '../stores/systemStore'
import { useHealthStore } from '../stores/healthStore'
import { useLogStore } from '../stores/logStore'
import type { ResourceHistoryPoint } from '../components/dashboard/ResourceChart'
import DashboardGrid from '../components/dashboard/DashboardGrid'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useDashboardLayout } from '../hooks/useDashboardLayout'
import { useNotificationStore } from '../stores/notificationStore'
import { useStackStore } from '../stores/stackStore'
import { useToast } from '../components/common/Toast'
import { pageLabel } from '../constants/pageTitles'
import { BTN_SHEET_PRIMARY, BTN_TOOLBAR_QUIET } from '../lib/ui'
import type { DiskInfo, HealthReport } from '../../shared/types'

// ---------------------------------------------------------------------------
// Disconnected hero — gorgeous animated illustration
// ---------------------------------------------------------------------------

function DisconnectedHero() {
  const connectionStatus = useConnectionStore((s) => s.status)
  const serverUrl = useConnectionStore((s) => s.serverUrl)
  const connect = useConnectionStore((s) => s.connect)
  const reconnectAttempts = useConnectionStore((s) => s.reconnectAttempts)

  const isConnecting = connectionStatus === 'connecting'
  const isError = connectionStatus === 'error'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] relative">
      {/* Background ambient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-emerald-500/[0.04] blur-3xl animate-breathe" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full bg-cyan-500/[0.03] blur-3xl animate-breathe" style={{ animationDelay: '2s' }} />
      </div>

      {/* Main illustration */}
      <div className="relative mb-8 w-40 h-40 flex items-center justify-center" aria-hidden>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-40 h-40 rounded-full border border-white/[0.03] animate-spin-slow" />
        </div>
        <div className="absolute inset-[-16px] flex items-center justify-center">
          <div className="w-[calc(100%+32px)] h-[calc(100%+32px)] rounded-full border border-dashed border-white/[0.03]" style={{ animation: 'spin 20s linear infinite reverse' }} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-orbit">
            <div className="w-2 h-2 rounded-full bg-emerald-400/60" />
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-center w-24 h-24">
          <div className={`
            absolute inset-0 rounded-2xl
            ${isConnecting ? 'bg-cyan-500/10 border-cyan-500/20' : isError ? 'bg-rose-500/10 border-rose-500/20' : 'bg-slate-500/10 border-slate-500/20'}
            border backdrop-blur-sm transition-colors duration-500
          `} />
          {isConnecting ? (
            <Loader2 size={36} className="relative z-10 text-cyan-400 animate-spin" />
          ) : isError ? (
            <WifiOff size={36} className="relative z-10 text-rose-400" />
          ) : (
            <Server size={36} className="relative z-10 text-slate-400 animate-pulse-glow" />
          )}
        </div>
      </div>

      <div className="text-center max-w-md animate-fade-in-up relative z-10">
        <h2 className={`text-2xl font-bold mb-2 ${isConnecting ? 'text-cyan-400' : isError ? 'text-rose-400' : 'text-slate-300'}`}>
          {isConnecting ? 'Connecting…' : isError ? 'Connection failed' : 'Waiting for the server'}
        </h2>
        <p className="text-slate-500 text-sm leading-relaxed mb-6">
          {isConnecting
            ? 'Connecting to the API server…'
            : isError
              ? serverUrl === '/api'
                ? <>Unable to reach the API server. Run <span className="font-mono text-slate-400">./setup.sh</span> or <span className="font-mono text-slate-400">./start.sh</span> on your host.</>
                : <>Unable to reach <span className="font-mono text-slate-400">{serverUrl}</span>. Make sure the server is running.</>
              : <>Connect to your DCS Orchestrator API to see live dashboard data.</>
          }
        </p>
        <div className="flex items-center justify-center gap-3 mb-6">
          <Badge component="span" size="lg" color={isConnecting ? 'cyan' : isError ? 'rose' : 'slate'}>
            {isConnecting ? 'Connecting' : isError ? `Attempt ${reconnectAttempts}` : 'Disconnected'}
          </Badge>
        </div>
        {(isError || connectionStatus === 'disconnected') && (
          <button type="button" onClick={() => connect()} className={`${BTN_SHEET_PRIMARY} mx-auto`}>
            <RefreshCw size={16} />
            Retry connection
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const connectionStatus = useConnectionStore((s) => s.status)
  const isConnected = connectionStatus === 'connected'
  // the backup status is an admin's: the route answers 403 to anyone else, so only an admin asks
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  const setSystemVersion = useSystemStore((s) => s.setVersion)
  const setSystemInfo = useSystemStore((s) => s.setSystem)
  const systemStatus = useSystemStore((s) => s.status)
  const systemInfo = useSystemStore((s) => s.system)
  const pushMetrics = useSystemStore((s) => s.pushMetrics)

  const healthReport = useHealthStore((s) => s.report)

  const setEvents = useLogStore((s) => s.setEvents)
  const events = useLogStore((s) => s.events)
  const setStacks = useStackStore((s) => s.setStacks)

  // Resource history for trending charts (cap at 60 data points)
  const resourceHistoryRef = useRef<ResourceHistoryPoint[]>([])

  // Track previous health status for notification triggers
  const prevHealthStatusRef = useRef<HealthReport['status'] | null>(null)

  // Welcome toast + onboarding after first-time setup
  const { addToast } = useToast()
  useEffect(() => {
    if (sessionStorage.getItem('dcs-just-setup')) {
      sessionStorage.removeItem('dcs-just-setup')
      addToast({ type: 'success', message: 'Welcome! Your server is configured and ready.', duration: 6000 })
      // Trigger onboarding overlay after render settles (avoids flash from
      // auth/connection state changes during the setup→dashboard transition)
      setTimeout(() => {
        localStorage.removeItem('onboarding_complete')
        window.dispatchEvent(new Event('show-onboarding'))
      }, 800)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Dashboard layout editor
  const dashLayout = useDashboardLayout()

  // =========================================================================
  // Data from stores (populated by GlobalPoller)
  // =========================================================================

  // Push metric snapshots for sparklines in OverviewCards
  React.useEffect(() => {
    if (!systemStatus) return
    const cpuCount = systemInfo?.cpu_count ?? 1
    const loadAvg1 = systemStatus.system.load_average[0] ?? 0
    const cpuPct = Math.min(100, Math.round((loadAvg1 / cpuCount) * 100))
    const memT = systemStatus.system.memory_mb.total
    const memA = systemStatus.system.memory_mb.available
    const memPct = memT > 0 ? Math.round(((memT - memA) / memT) * 100) : 0
    pushMetrics({
      stacks: systemStatus.stacks.running,
      containers: systemStatus.docker.containers.running,
      cpu: cpuPct,
      mem: memPct,
    })
  }, [systemStatus, systemInfo, pushMetrics])

  // Push health metric separately
  React.useEffect(() => {
    if (!healthReport) return
    // asleep on demand stays out: it is not unhealthy, it waits for its first request
    const total = (healthReport.summary.total - (healthReport.summary.sleeping ?? 0)) || 1
    const healthPct = Math.round((healthReport.summary.healthy / total) * 100)
    pushMetrics({ health: healthPct })
  }, [healthReport, pushMetrics])

  // Build resource history from systemStatus changes (fed by GlobalPoller)
  React.useEffect(() => {
    if (!systemStatus) return

    const cpuCount = systemInfo?.cpu_count ?? 1
    const loadAvg1 = systemStatus.system.load_average[0] ?? 0
    const cpuPercent = Math.min(100, Math.round((loadAvg1 / cpuCount) * 100))

    const memTotal = systemStatus.system.memory_mb.total
    const memAvailable = systemStatus.system.memory_mb.available
    const memUsed = Math.max(0, memTotal - memAvailable)
    const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0

    const now = new Date()
    const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

    const point: ResourceHistoryPoint = {
      time: timeLabel,
      cpu: cpuPercent,
      mem: memPercent,
    }

    const history = resourceHistoryRef.current
    history.push(point)
    if (history.length > 60) {
      history.splice(0, history.length - 60)
    }
  }, [systemStatus, systemInfo])

  // Health state change notifications (fed by GlobalPoller)
  useEffect(() => {
    if (!healthReport) return
    const current = healthReport.status
    const prev = prevHealthStatusRef.current

    // Only fire on transitions (not on first load)
    if (prev !== null && prev !== current) {
      const { preferences, addNotification } = useNotificationStore.getState()
      if (preferences.healthAlerts) {
        if (current === 'degraded' || current === 'critical') {
          addNotification({
            type: current === 'critical' ? 'error' : 'warning',
            title: current === 'critical' ? 'System health critical' : 'System health degraded',
            message: `${healthReport.summary.unhealthy} of ${healthReport.summary.total - (healthReport.summary.sleeping ?? 0)} running containers unhealthy`,
            persist: true,
            action: { label: `View ${pageLabel('health')}`, page: 'health' },
          })
        } else if (current === 'healthy' && (prev === 'degraded' || prev === 'critical')) {
          addNotification({
            type: 'success',
            title: 'System health restored',
            message: `All ${healthReport.summary.total - (healthReport.summary.sleeping ?? 0)} containers are healthy${healthReport.summary.sleeping ? ` (${healthReport.summary.sleeping} asleep on demand)` : ''}`,
            persist: true,
            action: { label: `View ${pageLabel('health')}`, page: 'health' },
          })
        }
      }
    }

    prevHealthStatusRef.current = current
  }, [healthReport])

  // Every card's poll watches the link (a failure of the link counts towards "unstable", an answer says it is fine). The
  // requests other places ask too (the stacks, the version, the system, CrowdSec) are keyed: one request serves them all.
  const watch = { reportsLink: true } as const

  // --- /events every 8 s ---
  const eventsPoll = usePolling(fetchEvents, 8000, { ...watch, key: pollKeys.events(null) })
  React.useEffect(() => {
    if (eventsPoll.data) setEvents(eventsPoll.data.events)
  }, [eventsPoll.data, setEvents])

  // --- /version every 10 min ---
  const versionPoll = usePolling(fetchVersion, 600000, { ...watch, key: pollKeys.version })
  React.useEffect(() => {
    if (versionPoll.data) setSystemVersion(versionPoll.data)
  }, [versionPoll.data, setSystemVersion])

  // --- /system every 60 s (provides cpu_count for CPU gauge) ---
  const systemInfoPoll = usePolling(fetchSystemInfo, 60000, { ...watch, key: pollKeys.systemInfo() })
  React.useEffect(() => {
    if (systemInfoPoll.data) setSystemInfo(systemInfoPoll.data)
  }, [systemInfoPoll.data, setSystemInfo])

  // Containers come from the global poller: one request serves every page
  const containers = useContainerStore((s) => s.containers)

  // --- /disks every 30 s ---
  const disksPoll = usePolling(fetchDisks, 30000, { ...watch, key: pollKeys.disks })
  const disks: DiskInfo[] = disksPoll.data?.disks ?? []

  // =========================================================================
  // Widget polls
  // =========================================================================

  // --- /stacks every 15 s (synced to the store for the command palette) ---
  const stacksPoll = usePolling(fetchStacks, 15000, { ...watch, key: pollKeys.stacks })
  React.useEffect(() => {
    if (stacksPoll.data?.stacks) setStacks(stacksPoll.data.stacks)
  }, [stacksPoll.data, setStacks])

  // --- /images/check-updates every 2 min ---
  const imageUpdatesPoll = usePolling(fetchImageUpdates, 120000, watch)

  // --- /backups/status every 30 s (admins only) ---
  const backupStatusPoll = usePolling(fetchBackupStatus, 30000, { ...watch, enabled: isAdmin })

  // --- /system/os-updates?fleet=1 every 10 min (admins only): each server looks in the background, the answer is cheap ---
  const osUpdatesPoll = usePolling(fetchOsUpdates, 600000, { ...watch, enabled: isAdmin })

  // --- /logs/stats every 30 s ---
  const logStatsPoll = usePolling(fetchLogStats, 30000, watch)

  // --- /maintenance/report every 60 s ---
  const maintenancePoll = usePolling(fetchMaintenanceReport, 60000, watch)

  // --- /notifications/history every 30 s ---
  const notifHistoryPoll = usePolling(fetchNotificationHistory, 30000, watch)

  // --- /automations every 60 s; the timed rules (schedules) are rules of the same Automation page: the card lists both ---
  const automationsPoll = usePolling(fetchAutomations, 60000, watch)
  const schedulesPoll = usePolling(() => fetchSchedules(), 60000, watch)

  // --- /crowdsec/status every 60 s ---
  const crowdsecPoll = usePolling(() => crowdsecStatus(), 60000, { ...watch, key: pollKeys.crowdsecStatus(null) })
  // --- /crowdsec/community every 10 min (admins, while CrowdSec runs): "Needs your attention" says when the community has refused
  // the engine for hours. The GET reads what the server already knows and never logs in to the community service ---
  const crowdsecCommunityPoll = usePolling(() => crowdsecCommunity(), 600000, {
    key: pollKeys.crowdsecCommunity(null),
    enabled: isAdmin && !!crowdsecPoll.data?.running,
  })

  // --- /metrics/trends?range=1h every 60 s ---
  const trendsPoll = usePolling(() => fetchMetricsTrends('1h'), 60000, watch)

  // Show disconnected hero ONLY when not connected AND we've NEVER had data.
  // Once data has loaded, keep showing cards even during brief disconnects
  // to prevent the jarring flash between "Connecting..." and cards.
  const [everConnected, setEverConnected] = React.useState(false)
  React.useEffect(() => {
    if (isConnected) setEverConnected(true)
  }, [isConnected])

  const hasNoData = !systemStatus && !healthReport && events.length === 0
  const showDisconnected = !isConnected && !everConnected && hasNoData

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      {/* the "never connected" screen below says it in full: the banner is for a link that drops later */}
      {!showDisconnected && <DisconnectedBanner />}
      <PageHeader
        page="dashboard"
        badge={isConnected ? <Badge component="span" color="emerald" leftSection={<Wifi size={11} />}>Live</Badge> : undefined}
        subtitle={systemStatus
          ? <><span className="text-slate-300">{systemStatus.hostname}</span>{' \u2014 uptime '}{formatUptime(systemStatus.uptime_seconds)}</>
          : undefined}
        actions={isConnected && !dashLayout.editMode ? (
          <Hint label="Move, resize, add and hide the cards">
            <button type="button" onClick={dashLayout.enterEditMode} className={`${BTN_TOOLBAR_QUIET} hidden sm:flex`}>
              <Settings2 size={14} /> Edit dashboard
            </button>
          </Hint>
        ) : undefined}
      />

      {showDisconnected ? (
        <DisconnectedHero />
      ) : (
        <>
          {!dashLayout.editMode && <NeedsYouOffer layout={dashLayout} />}
          <DashboardGrid
            cards={dashLayout.allCards}
            editMode={dashLayout.editMode}
            onToggleCard={dashLayout.toggleCard}
            onResizeCard={dashLayout.resizeCard}
            onMoveCard={dashLayout.moveCard}
            onExitEdit={() => {
              void dashLayout.exitEditMode().then((ok) => {
                if (!ok) addToast({ type: 'error', message: 'Layout kept in this browser only — the server did not save it' })
              })
            }}
            labels={dashLayout.labels}
            onDiscardEdit={dashLayout.discardEdit}
            onResetLayout={dashLayout.resetLayout}
            onAddSpecial={dashLayout.addSpecial}
            onAddPluginCard={dashLayout.addPluginCard}
            onSetLabel={dashLayout.setLabel}
            cardConfig={dashLayout.cardConfig}
            onSaveCardConfig={dashLayout.saveCardConfig}
            cardProps={{
              'needs-you': { stacks: stacksPoll.data?.stacks ?? null, stacksError: stacksPoll.error, images: imageUpdatesPoll.data ?? null, backup: backupStatusPoll.data ?? null, disks: disksPoll.data?.disks ?? null, osUpdates: osUpdatesPoll.data ?? null, crowdsecCommunity: crowdsecCommunityPoll.data ?? null },
              'stack-controls': { stacks: stacksPoll.data?.stacks ?? null, error: stacksPoll.error, onRetry: stacksPoll.refresh, onRefresh: stacksPoll.refresh },
              'stack-grid': { stacks: stacksPoll.data?.stacks ?? null, error: stacksPoll.error, onRetry: stacksPoll.refresh },
              'resource-chart': { history: resourceHistoryRef.current },
              'container-overview': { containers },
              'disk-monitor': { disks },
              'trends': { data: trendsPoll.data ?? null, error: trendsPoll.error, onRetry: trendsPoll.refresh },
              'image-updates': { data: imageUpdatesPoll.data ?? null, error: imageUpdatesPoll.error, onRetry: imageUpdatesPoll.refresh },
              'backup-status': { data: backupStatusPoll.data ?? null, error: backupStatusPoll.error, onRetry: backupStatusPoll.refresh },
              'log-health': { data: logStatsPoll.data ?? null, error: logStatsPoll.error, onRetry: logStatsPoll.refresh },
              'maintenance': { data: maintenancePoll.data ?? null, error: maintenancePoll.error, onRetry: maintenancePoll.refresh },
              'notifications': { data: notifHistoryPoll.data ?? null, error: notifHistoryPoll.error, onRetry: notifHistoryPoll.refresh },
              'automations': { data: automationsPoll.data ?? null, schedules: schedulesPoll.data ?? null, error: automationsPoll.error, onRetry: automationsPoll.refresh },
              'crowdsec': { data: crowdsecPoll.data ?? null, error: crowdsecPoll.error, onRetry: crowdsecPoll.refresh },
            }}
          />
        </>
      )}
    </div>
  )
}

/**
 * A dashboard saved before "Needs your attention" existed gets it hidden, like every new card. This asks once,
 * above the grid: put it on top (the rest of the layout moves down, unchanged) or leave it in the card picker.
 * The answer is kept with the layout, so the other devices don't ask again.
 */
function NeedsYouOffer({ layout }: { layout: ReturnType<typeof useDashboardLayout> }) {
  const card = layout.allCards.find((c) => c.id === 'needs-you')
  const answered = (layout.cardConfig as Record<string, { offer?: string } | undefined>)['needs-you']?.offer
  if (!card || card.visible || answered) return null
  return (
    <div className="glass-card flex flex-wrap items-center gap-3 px-4 py-3 border-emerald-500/20 animate-fade-in">
      <BellRing size={18} className="shrink-0 accent-text" aria-hidden />
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium text-slate-200">New card: Needs your attention</p>
        <p className="text-xs text-slate-400">It lists only what&apos;s broken or waiting on you, each with the page that fixes it. Your cards stay as they are; they move down one row.</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => void layout.saveCardConfig('needs-you', { offer: 'declined' })}>Not now</button>
        <button type="button" className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors" onClick={() => void layout.placeOnTop('needs-you', { offer: 'added' })}>
          Add it to the top
        </button>
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}
