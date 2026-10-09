// =============================================================================
// OverviewCards — Quick stats grid (4 columns) for the Dashboard
// =============================================================================

import { useFleetRole } from '../../hooks/useFleetRole'
import { useFleetTotals } from '../../hooks/useFleetTotals'
import { useStackCounts } from '../../hooks/useStackCounts'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { fetchStacks } from '../../api/endpoints'
import React, { useEffect, useRef, useState } from 'react'
import { Layers, Box, HardDrive, HeartPulse } from 'lucide-react'
import { useSystemStore } from '../../stores/systemStore'
import { useHealthStore } from '../../stores/healthStore'
import { useApiLink } from '../../hooks/useApiLink'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { pctTone } from '../../lib/tone'
// ---------------------------------------------------------------------------
// AnimatedCounter — Smoothly animates between numeric values using rAF
// ---------------------------------------------------------------------------

interface AnimatedCounterProps {
  value: number
  duration?: number
  className?: string
}

function AnimatedCounter({ value, duration = 800, className = '' }: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const previousValue = useRef(value)
  const rafId = useRef<number | null>(null)
  const startTime = useRef<number | null>(null)

  useEffect(() => {
    const from = previousValue.current
    const to = value

    // Nothing to animate
    if (from === to) {
      setDisplayValue(to)
      return
    }

    // Cancel any in-flight animation
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
    }

    // Snapshot the current displayed value as the starting point when
    // interrupting mid-animation, so the counter picks up smoothly
    const animateFrom = displayValue !== to ? displayValue : from

    startTime.current = null

    // Cubic ease-out for natural deceleration
    const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

    const step = (timestamp: number) => {
      if (startTime.current === null) startTime.current = timestamp
      const elapsed = timestamp - startTime.current
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOut(progress)

      const current = animateFrom + (to - animateFrom) * easedProgress
      setDisplayValue(Math.round(current))

      if (progress < 1) {
        rafId.current = requestAnimationFrame(step)
      } else {
        // Ensure we land exactly on target
        setDisplayValue(to)
        previousValue.current = to
        rafId.current = null
      }
    }

    rafId.current = requestAnimationFrame(step)

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        // When cleanup fires due to value change, snapshot where we are
        previousValue.current = displayValue
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  return (
    <span className={`tabular-nums ${className}`}>
      {displayValue}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline SVG chart for metric history
// ---------------------------------------------------------------------------

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const w = 80
  const h = 28
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 2) - 1
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------

interface CardProps {
  icon: React.ReactNode
  label: string
  value: string | number | React.ReactNode
  subtitle?: string
  accentColor: 'emerald' | 'cyan' | 'amber' | 'rose'
  trend?: 'up' | 'down' | 'stable'
  loading?: boolean
  index?: number
  onClick?: () => void
  pulse?: boolean
  sparkData?: number[]
  extraClassName?: string
}

const accentBorderMap: Record<CardProps['accentColor'], string> = {
  emerald: 'border-t-emerald-500',
  cyan: 'border-t-cyan-500',
  amber: 'border-t-amber-500',
  rose: 'border-t-rose-500',
}

const accentBgMap: Record<CardProps['accentColor'], string> = {
  emerald: 'bg-emerald-500/10 text-emerald-400',
  cyan: 'bg-cyan-500/10 text-cyan-400',
  amber: 'bg-amber-500/10 text-amber-400',
  rose: 'bg-rose-500/10 text-rose-400',
}

// an arrow says which way; its colour is the tile's verdict (cyan is information: a plain arrow)
const trendSymbols: Record<NonNullable<CardProps['trend']>, string> = { up: '\u2191', down: '\u2193', stable: '\u2192' }
const trendColors: Record<CardProps['accentColor'], string> = {
  emerald: 'text-emerald-400', cyan: 'text-slate-400', amber: 'text-amber-400', rose: 'text-rose-400',
}

const sparkColorMap: Record<CardProps['accentColor'], string> = {
  emerald: '#10b981',
  cyan: '#06b6d4',
  amber: '#f59e0b',
  rose: '#f43f5e',
}

function StatCard({ icon, label, value, subtitle, accentColor, trend, loading, index = 0, onClick, pulse, sparkData, extraClassName }: CardProps) {
  const className = `
    relative overflow-hidden rounded-xl border-t-2 ${accentBorderMap[accentColor]}
    border bg-slate-900/60 backdrop-blur-md text-left
    p-4 transition-all duration-300 hover:bg-slate-900/80 hover:border-white/10
    hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5
    animate-fade-in
    ${onClick ? 'cursor-pointer' : ''}
    ${pulse ? 'border-rose-500/30 animate-pulse' : 'border-white/5'}
    ${extraClassName ?? ''}
  `
  const style = { animationDelay: `${index * 60}ms` }
  const content = (
    <>
      {loading ? (
        <div role="status" aria-label={`Loading ${label}`}>
          <div className="flex items-start justify-between" aria-hidden>
            <div className="skeleton h-10 w-10" />
            <div className="skeleton h-4 w-4" />
          </div>
          <div className="mt-4 space-y-2" aria-hidden>
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-16" />
            <div className="skeleton h-2.5 w-28" />
          </div>
        </div>
      ) : (
        <>
          <span className="flex items-start justify-between">
            <span className={`rounded-lg p-2.5 ${accentBgMap[accentColor]}`} aria-hidden>
              {icon}
            </span>
            {trend && (
              <span className={`text-sm font-medium ${trendColors[accentColor]}`} aria-hidden>
                {trendSymbols[trend]}
              </span>
            )}
          </span>
          <span className="mt-4 block">
            <span className="block text-sm font-medium text-slate-400">{label}</span>
            <span className="mt-1 block text-lg md:text-2xl font-bold text-white tracking-tight tabular-nums">
              {typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
            </span>
            {subtitle && <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span>}
            {sparkData && sparkData.length >= 2 && (
              <span className="mt-2 block" aria-hidden>
                <Sparkline data={sparkData} color={sparkColorMap[accentColor]} />
              </span>
            )}
          </span>
        </>
      )}

      {/* Subtle gradient glow */}
      <span className={`
        pointer-events-none absolute -bottom-4 -right-4 h-24 w-24 rounded-full opacity-10 blur-2xl
        ${accentColor === 'emerald' ? 'bg-emerald-500' : ''}
        ${accentColor === 'cyan' ? 'bg-cyan-500' : ''}
        ${accentColor === 'amber' ? 'bg-amber-500' : ''}
        ${accentColor === 'rose' ? 'bg-rose-500' : ''}
      `} aria-hidden />
    </>
  )
  // a tile that leads to a page is a button (a keyboard reaches it); the others are plain boxes
  return onClick
    ? <button type="button" onClick={onClick} aria-label={loading ? `${label}: loading` : undefined} aria-busy={loading || undefined} className={`${className} flex flex-col justify-start`} style={style}>{content}</button>
    : <div className={className} style={style}>{content}</div>
}

export default function OverviewCards() {
  // Read store data directly — no loading flags, just check if data is null
  const status = useSystemStore((s) => s.status)
  const metricHistory = useSystemStore((s) => s.metricHistory)
  const report = useHealthStore((s) => s.report)
  const connectionStatus = useConnectionStore((s) => s.status)
  const link = useApiLink()
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)

  // The disk decides the images tile's colour: amber from 75 %, rose (and a pulse) from 90 %
  const diskPercent = status?.system.disk.percent
    ? parseInt(status.system.disk.percent.replace('%', ''), 10)
    : 0
  const diskTone = pctTone(diskPercent)
  const diskWarning = diskTone !== 'ok'

  // Status data hasn't arrived yet — show loading skeletons for first 3 cards
  const statusLoading = !status

  // --- Stacks ---
  // a hub: the cards count the whole fleet — its own stacks and containers plus every VM's
  const { isHub } = useFleetRole()
  const fleetStacks = usePolling(fetchStacks, 30000, { key: pollKeys.stacks, enabled: isHub })
  const { totals: fleet } = useFleetTotals()
  const vmStacks = isHub ? (fleetStacks.data?.stacks ?? []).filter((s) => s.placement === 'vm') : []
  // a stack asleep on demand is fine (the first request wakes it): it counts with the running ones
  const stackCounts = useStackCounts('all')
  const asleepStacks = stackCounts.loaded ? stackCounts.sleeping : 0
  const runningStacks = (status?.stacks.running ?? 0) + vmStacks.filter((s) => s.status === 'running').length + asleepStacks
  const totalStacks = (status?.stacks.total ?? 0) + vmStacks.length
  const stackTrend: CardProps['trend'] =
    totalStacks === 0 ? 'stable' : runningStacks === totalStacks ? 'up' : 'down'

  // --- Containers ---
  const fleetRunning = fleet.containersRunning
  const fleetTotal = fleet.containersTotal
  const runningContainers = (status?.docker.containers.running ?? 0) + fleetRunning
  const totalContainers = (status?.docker.containers.total ?? 0) + fleetTotal
  // asleep on demand is not stopped: Sablier stopped it on purpose and wakes it on the first request
  const asleepContainers = (status?.docker.containers.sleeping ?? 0) + fleet.containersSleeping
  const stoppedContainers = Math.max(0, (status?.docker.containers.stopped ?? 0) - (status?.docker.containers.sleeping ?? 0))
    + Math.max(0, fleetTotal - fleetRunning - fleet.containersSleeping)
  const containerTrend: CardProps['trend'] =
    stoppedContainers > 0 ? 'down' : runningContainers > 0 ? 'up' : 'stable'

  // --- Images ---
  const imageCount = (status?.docker.images ?? 0) + fleet.images   // a hub adds its VMs' images

  // --- Health ---
  // When no report AND not connected, show "Unknown"
  // When no report AND connected (still loading), show "Checking..."
  // When report exists, show real status
  // a report is a fact about the moment it was taken: while the API does not answer the card says that instead of the last verdict
  const hasReport = !!report && link.live
  const isDisconnected = !link.live
  const healthLabel = hasReport
    ? report.status === 'healthy' ? 'Healthy'
      : report.status === 'degraded' ? 'Degraded'
      : 'Critical'
    : isDisconnected ? link.short : 'Checking…'

  const healthAccent: CardProps['accentColor'] = hasReport
    ? report.status === 'healthy' ? 'emerald'
      : report.status === 'degraded' ? 'amber'
      : 'rose'
    : isDisconnected ? (link.state === 'trouble' ? 'amber' : 'rose') : 'amber'

  const healthTrend: CardProps['trend'] = hasReport
    ? report.status === 'healthy' ? 'up'
      : report.status === 'degraded' ? 'stable'
      : 'down'
    : isDisconnected ? 'down' : 'stable'

  // Only show skeleton when connected and still waiting for first data
  const healthLoading = !hasReport && connectionStatus === 'connected'

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        icon={<Layers className="h-5 w-5" />}
        label="Total stacks"
        value={
          <span className="tabular-nums">
            <AnimatedCounter value={runningStacks} />
            {' / '}
            <AnimatedCounter value={totalStacks} />
          </span>
        }
        subtitle={asleepStacks > 0 ? `${runningStacks - asleepStacks} running · ${asleepStacks} asleep` : `${runningStacks} running`}
        accentColor={runningStacks === totalStacks && totalStacks > 0 ? 'emerald' : 'amber'}
        trend={stackTrend}
        loading={statusLoading}
        index={0}
        onClick={() => setCurrentPage('stacks')}
        sparkData={metricHistory.stacks}
      />
      <StatCard
        icon={<Box className="h-5 w-5" />}
        label="Running containers"
        value={runningContainers}
        subtitle={`${totalContainers} total${asleepContainers > 0 ? `, ${asleepContainers} asleep` : ''}, ${stoppedContainers} stopped`}
        accentColor={stoppedContainers > 0 ? 'amber' : 'emerald'}
        trend={containerTrend}
        loading={statusLoading}
        index={1}
        onClick={() => setCurrentPage('containers')}
        sparkData={metricHistory.containers}
      />
      <StatCard
        icon={<HardDrive className="h-5 w-5" />}
        label="Docker images"
        value={imageCount}
        subtitle={diskWarning ? `Disk ${diskPercent}% used` : undefined}
        accentColor={diskTone === 'problem' ? 'rose' : diskWarning ? 'amber' : 'cyan'}
        trend="stable"
        loading={statusLoading}
        index={2}
        onClick={() => setCurrentPage('images')}
        pulse={diskTone === 'problem'}
      />
      <StatCard
        icon={<HeartPulse className="h-5 w-5" />}
        label="System health"
        value={healthLabel}
        subtitle={
          hasReport
            ? `${report.summary.healthy} healthy, ${report.summary.unhealthy} unhealthy`
            : isDisconnected
              ? link.state === 'trouble' ? 'The API is not answering' : link.state === 'reconnecting' ? 'API reconnecting — health is unknown' : 'API not connected'
              : 'Loading health data…'
        }
        accentColor={healthAccent}
        trend={healthTrend}
        loading={healthLoading}
        index={3}
        onClick={() => setCurrentPage('health')}
        sparkData={metricHistory.health}
      />
    </div>
  )
}
