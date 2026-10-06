// =============================================================================
// StatusBar — Bottom bar: 1-row on desktop, 2-row on mobile
// =============================================================================

import { useEffect, useState, useCallback } from 'react'
import { Activity, Clock, Container, Cpu, HardDrive, MemoryStick, Moon, User, Wifi, WifiOff } from 'lucide-react'
import { useApiLink } from '../../hooks/useApiLink'
import { useFleetTotals } from '../../hooks/useFleetTotals'
import { useSystemStore } from '../../stores/systemStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useHealthStore } from '../../stores/healthStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { pageLabel } from '../../constants/pageTitles'

function formatUptime(seconds: number): string {
  if (seconds < 0) return '--'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

function formatTime(date: Date): string {
  const use24h = useSettingsStore.getState().use24hClock !== false
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: !use24h,
  })
}

function MemoryBar({ used, total }: { used: number; total: number }) {
  const percent = total > 0 ? ((total - used) / total) * 100 : 0
  const color = percent > 80 ? 'bg-rose-400' : percent > 60 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color} progress-bar`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 tabular-nums">{Math.round(percent)}%</span>
    </div>
  )
}

export function StatusBar() {
  const status = useSystemStore((s) => s.status)
  const version = useSystemStore((s) => s.version)
  const connectionStatus = useConnectionStore((s) => s.status)
  const lastConnected = useConnectionStore((s) => s.lastConnected)
  const latencyMs = useConnectionStore((s) => s.latencyMs)
  const healthReport = useHealthStore((s) => s.report)
  const link = useApiLink()
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const currentUser = useAuthStore((s) => s.currentUser)

  const nav = (page: Parameters<typeof setCurrentPage>[0]) => () => setCurrentPage(page)

  const [appVersion, setAppVersion] = useState<string>('')
  const [now, setNow] = useState(formatTime(new Date()))
  const [lastRefreshAgo, setLastRefreshAgo] = useState('')
  const [sessionDuration, setSessionDuration] = useState('')

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
    }
  }, [])

  const updateRefreshAgo = useCallback(() => {
    if (!lastConnected) { setLastRefreshAgo(''); return }
    const diff = Math.floor((Date.now() - lastConnected) / 1000)
    if (diff < 5) setLastRefreshAgo('just now')
    else if (diff < 60) setLastRefreshAgo(`${diff}s ago`)
    else setLastRefreshAgo(`${Math.floor(diff / 60)}m ago`)
  }, [lastConnected])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(formatTime(new Date()))
      updateRefreshAgo()
      try {
        const raw = localStorage.getItem('auth-session')
        if (raw) {
          const session = JSON.parse(raw)
          if (session.expiresAt > 0) {
            const durationMs = useSettingsStore.getState().sessionDurationMinutes * 60 * 1000
            const startedAt = session.expiresAt - durationMs
            const elapsed = Math.floor((Date.now() - startedAt) / 1000)
            if (elapsed > 0) setSessionDuration(formatUptime(elapsed))
          }
        }
      } catch {}
    }, 1000)
    return () => clearInterval(timer)
  }, [updateRefreshAgo])

  const uptime = status?.uptime_seconds != null ? formatUptime(status.uptime_seconds) : '--'
  const apiVersion = version?.api_version ?? '--'
  const { totals: fleet } = useFleetTotals()   // a hub adds its VMs' containers
  const containersRunning = (status?.docker.containers.running ?? 0) + fleet.containersRunning
  const containersTotal = (status?.docker.containers.total ?? 0) + fleet.containersTotal
  // asleep on demand is up (the first request wakes it): it counts with the running ones, and is said apart
  const containersAsleep = (status?.docker.containers.sleeping ?? 0) + fleet.containersSleeping
  const containersUp = containersRunning + containersAsleep
  const containersTitle = `${containersRunning} running${containersAsleep ? ` · ${containersAsleep} asleep (on demand)` : ''} · ${containersTotal - containersUp} stopped · ${containersTotal} in all`
  const isConnected = connectionStatus === 'connected'
  const memUsed = status?.system?.memory_mb?.available ?? 0
  const memTotal = status?.system?.memory_mb?.total ?? 0
  const healthStatus = healthReport?.status
  const cpuCount = status?.system?.cpu_count ?? 0
  const loadAvg = status?.system?.load_average?.[0] ?? 0
  const cpuPct = cpuCount > 0 ? Math.min(100, Math.round((loadAvg / cpuCount) * 100)) : 0

  return (
    <footer className="bg-slate-900/80 backdrop-blur-xl border-t border-white/[0.05] shrink-0 select-none font-mono">
      {/* ---- Desktop: single row ---- */}
      <div className="hidden md:flex items-center justify-between h-7 px-4 text-[10px]">
        {/* Left */}
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1.5" title={link.live ? undefined : link.label}>
            <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${link.live ? 'bg-emerald-400' : link.state === 'trouble' ? 'bg-amber-400 animate-pulse' : link.state === 'reconnecting' ? 'bg-rose-400 animate-pulse' : 'bg-rose-500'}`} />
            <span className={link.live ? 'text-slate-400' : link.state === 'trouble' ? 'text-amber-300' : 'text-rose-300'}>
              {link.live ? 'Connected' : link.short}
            </span>
          </span>

          {/* no health verdict while the API does not answer: the connection chip already says why */}
          {healthStatus && link.live && (
            <>
              <span className="text-white/[0.06]">|</span>
              <button onClick={nav('health')} className="flex items-center gap-1 hover:brightness-125 transition-all cursor-pointer">
                <Activity size={9} className={
                  healthStatus === 'healthy' ? 'text-emerald-400' :
                  healthStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'
                } />
                <span className={`capitalize ${
                  healthStatus === 'healthy' ? 'text-emerald-400/80' :
                  healthStatus === 'degraded' ? 'text-amber-400/80' : 'text-rose-400/80'
                }`}>
                  {healthStatus}
                </span>
              </button>
            </>
          )}

          <span className="text-white/[0.06]">|</span>
          <button onClick={nav('uptime')} className="flex items-center gap-1 text-slate-500 hover:text-slate-400 transition-colors duration-200 cursor-pointer">
            <Clock size={9} />
            Uptime: <span className="text-slate-400">{uptime}</span>
          </button>

          <span className="text-white/[0.06]">|</span>
          <span className="text-slate-500">
            {appVersion && <><span className="text-slate-500">v{appVersion}</span> · </>}
            API <span className="text-slate-500">v{apiVersion}</span>
          </span>

          {currentUser && (
            <>
              <span className="text-white/[0.06]">|</span>
              <span className="flex items-center gap-1 text-slate-500">
                <User size={9} />
                <span className="text-slate-400">{currentUser}</span>
                {sessionDuration && <span className="text-slate-500">· {sessionDuration}</span>}
              </span>
            </>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2.5">
          {cpuCount > 0 && (
            <>
              <button onClick={nav('trends')} className="flex items-center gap-1 text-slate-500 hover:text-slate-400 transition-colors duration-200 cursor-pointer"><Cpu size={9} /> CPU</button>
              <button onClick={nav('trends')} className="flex items-center gap-1.5 cursor-pointer">
                <div className="w-16 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={`h-full rounded-full progress-bar ${cpuPct > 80 ? 'bg-rose-400' : cpuPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${cpuPct}%` }} />
                </div>
                <span className="text-[10px] text-slate-500 tabular-nums">{cpuPct}%</span>
              </button>
              <span className="text-white/[0.06]">|</span>
            </>
          )}
          {memTotal > 0 && (
            <>
              <button onClick={nav('trends')} className="flex items-center gap-1 text-slate-500 hover:text-slate-400 transition-colors duration-200 cursor-pointer"><MemoryStick size={9} /> RAM</button>
              <button aria-label={`Memory in use — ${pageLabel('trends')}`} onClick={nav('trends')} className="cursor-pointer"><MemoryBar used={memUsed} total={memTotal} /></button>
              <span className="text-white/[0.06]">|</span>
            </>
          )}

          <button onClick={nav('containers')} title={containersTitle} className="flex items-center gap-1 text-slate-500 hover:text-slate-400 transition-colors duration-200 cursor-pointer">
            <Container size={9} />
            <span className="text-emerald-400/80">{containersUp}</span>
            <span className="text-slate-700">/</span>
            <span className="text-slate-400">{containersTotal}</span>
            {containersAsleep > 0 && <span className="flex items-center gap-0.5 text-indigo-300"><Moon size={8} aria-hidden />{containersAsleep}</span>}
          </button>

          {lastRefreshAgo && (
            <>
              <span className="text-white/[0.06]">|</span>
              <span className="flex items-center gap-1 text-slate-500">
                {link.live ? <Wifi size={9} className="text-emerald-500/60" /> : <WifiOff size={9} className="text-rose-400/80" />}
                <span className={link.live ? 'text-slate-500' : 'text-rose-300/80'}>{link.live ? lastRefreshAgo : `last answer ${lastRefreshAgo}`}</span>
                {latencyMs != null && (
                  <span title="Round trip to the API — median of the last 5 checks" className={`text-[9px] tabular-nums ${latencyMs < 100 ? 'text-emerald-500/60' : latencyMs < 300 ? 'text-amber-500/60' : 'text-rose-500/60'}`}>
                    {latencyMs}ms
                  </span>
                )}
              </span>
            </>
          )}

          <span className="text-white/[0.06]">|</span>
          <span className="text-slate-500 tabular-nums">{now}</span>
        </div>
      </div>

      {/* ---- Mobile: two rows ---- */}
      <div className="hidden">
        {/* Row 1: connection + health + containers + clock */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${isConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span className={isConnected ? 'text-slate-400' : 'text-slate-500'}>
                {isConnected ? 'Connected' : connectionStatus}
              </span>
            </span>
            {healthStatus && (
              <>
                <span className="text-white/[0.06]">|</span>
                <span className="flex items-center gap-1">
                  <Activity size={8} className={
                    healthStatus === 'healthy' ? 'text-emerald-400' :
                    healthStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'
                  } />
                  <span className={`capitalize ${
                    healthStatus === 'healthy' ? 'text-emerald-400/80' :
                    healthStatus === 'degraded' ? 'text-amber-400/80' : 'text-rose-400/80'
                  }`}>
                    {healthStatus}
                  </span>
                </span>
              </>
            )}
          </div>
          <span className="text-slate-500 tabular-nums">{now}</span>
        </div>

        {/* Row 2: containers + uptime + last refresh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-slate-500" title={containersTitle}>
              <Container size={8} />
              <span className="text-emerald-400/80">{containersUp}</span>
              <span className="text-slate-700">/</span>
              <span className="text-slate-400">{containersTotal}</span>
              {containersAsleep > 0 && <span className="flex items-center gap-0.5 text-indigo-300"><Moon size={7} aria-hidden />{containersAsleep}</span>}
            </span>
            <span className="text-white/[0.06]">|</span>
            <span className="flex items-center gap-1 text-slate-500">
              <Clock size={8} />
              <span className="text-slate-400">{uptime}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastRefreshAgo && (
              <span className="flex items-center gap-1 text-slate-500">
                <Wifi size={8} className="text-emerald-500/60" />
                <span className="text-slate-500">{lastRefreshAgo}</span>
                {latencyMs != null && (
                  <span title="Round trip to the API — median of the last 5 checks" className={`text-[9px] tabular-nums ${latencyMs < 100 ? 'text-emerald-500/60' : latencyMs < 300 ? 'text-amber-500/60' : 'text-rose-500/60'}`}>
                    {latencyMs}ms
                  </span>
                )}
              </span>
            )}
            <span className="text-slate-500">
              {appVersion && <><span className="text-slate-500">v{appVersion}</span> · </>}
              v{apiVersion}
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
