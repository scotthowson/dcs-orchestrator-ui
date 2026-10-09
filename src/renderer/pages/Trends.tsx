// =============================================================================
// Trends — historical CPU, memory and disk charts, powered by the server's own
//          metrics snapshots (cron)
// =============================================================================

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { SegmentedControl } from '@mantine/core'
import { Clock, Cpu, HardDrive, MemoryStick, RefreshCw, Loader2, Database, WifiOff, Camera, BarChart3, Timer, Settings2, Save, ImageDown } from 'lucide-react'
import { toPng } from 'html-to-image'
import { createPortal } from 'react-dom'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { apiClient } from '../api/client'
import { memberPath } from '../api/endpoints'
import { fetchMetricsTrends, captureMetricsSnapshot, fetchAlertConfig, updateAlertConfig } from '../api/endpoints'
import type { MetricsTrendsResponse, AlertConfigResponse, AlertThresholds } from '../../shared/types'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { EmptyState, ErrorState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { Panel, METRIC_HEX } from '../components/dashboard/cardShared'
import { BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK, TONE_QUIET } from '../lib/ui'
import { pctTone, quiet } from '../lib/tone'
import StatTile from '../components/common/StatTile'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | '1y' | 'all'

const TIME_RANGES: { id: TimeRange; label: string; shortLabel: string }[] = [
  { id: '1h', label: '1 hour', shortLabel: '1h' },
  { id: '6h', label: '6 hours', shortLabel: '6h' },
  { id: '24h', label: '24 hours', shortLabel: '24h' },
  { id: '7d', label: '7 days', shortLabel: '7d' },
  { id: '30d', label: '30 days', shortLabel: '30d' },
  { id: '90d', label: '90 days', shortLabel: '90d' },
  { id: '1y', label: '1 year', shortLabel: '1y' },
  { id: 'all', label: 'All', shortLabel: 'All' },
]

/** Polling cadence follows the range: nobody needs a 1-year chart refreshed every minute */
function pollIntervalFor(range: TimeRange): number {
  if (range === '1h' || range === '6h') return 60_000
  if (range === '24h' || range === '7d') return 300_000
  return 900_000
}

function formatResolution(seconds?: number): string {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`
  return `${(seconds / 86400).toFixed(1)}d`
}

const tooltipStyle = {
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '10px',
  fontSize: '11px',
  color: '#e2e8f0',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
}

const tooltipLabelStyle = { color: '#94a3b8', fontSize: '10px', marginBottom: '4px' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format epoch timestamp to a readable time label based on the selected range */
function formatTimeLabel(epoch: number, range: TimeRange, full = false): string {
  const d = new Date(epoch * 1000)
  if (full) return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (range === '24h' || range === '7d') {
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${month}/${day} ${hours}:${mins}`
  }
  if (range === '30d' || range === '90d') return `${month}/${day}`
  return `${String(d.getFullYear()).slice(2)}/${month}/${day}`
}

/** Build chart-ready data from the API response */
function buildChartData(data: MetricsTrendsResponse | null, range: TimeRange) {
  if (!data?.points?.length) return []
  return data.points.map((p) => ({
    time: formatTimeLabel(p.epoch, range),
    epoch: p.epoch,
    cpu: p.cpu_pct,
    load1: p.load1,
    mem: p.mem_pct,
    disk: p.disk_pct,
    // min/max bands exist for rolled-up and downsampled points
    cpuBand: p.cpu_min != null && p.cpu_max != null ? [p.cpu_min, p.cpu_max] : undefined,
    memBand: p.mem_min != null && p.mem_max != null ? [p.mem_min, p.mem_max] : undefined,
    diskBand: p.disk_min != null && p.disk_max != null ? [p.disk_min, p.disk_max] : undefined,
  }))
}

// ---------------------------------------------------------------------------
// One chart: a panel with its average and peak, the area, the min–max band and the alert thresholds
// ---------------------------------------------------------------------------

interface TrendPanelProps {
  title: string
  icon: typeof Cpu
  gradientId: string
  strokeColor: string
  dataKey: string
  bandKey?: string
  range: TimeRange
  data: ReturnType<typeof buildChartData>
  thresholdWarning?: number
  thresholdCritical?: number
  unit?: string
}

function TrendPanel({ title, icon, gradientId, strokeColor, dataKey, bandKey, range, data, thresholdWarning, thresholdCritical, unit = '%' }: TrendPanelProps) {
  const hasBand = !!bandKey && data.some((d) => (d as Record<string, unknown>)[bandKey] != null)
  // Compute min/max for the dataKey
  const values = data.map((d) => Number((d as unknown as Record<string, unknown>)[dataKey] ?? 0))
  const peak = values.length > 0 ? Math.max(...values) : 0
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0

  return (
    <Panel
      icon={icon}
      title={title}
      meta={<>Avg <span className="text-slate-400 font-medium">{avg.toFixed(1)}{unit}</span> · Peak <span className="text-slate-400 font-medium">{peak.toFixed(1)}{unit}</span></>}
    >
      <div className="h-40 md:h-52" role="img" aria-label={`${title} over ${TIME_RANGES.find((r) => r.id === range)?.label ?? range}: average ${avg.toFixed(1)}${unit}, peak ${peak.toFixed(1)}${unit}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.35} />
                <stop offset="50%" stopColor={strokeColor} stopOpacity={0.12} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(51, 65, 85, 0.5)" vertical={false} />
            <XAxis
              dataKey="epoch"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => formatTimeLabel(v, range)}
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }}
              tickLine={false}
              axisLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
              width={44}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              labelFormatter={(v) => formatTimeLabel(Number(v), range, true)}
              formatter={(value: number | number[], name: string) =>
                Array.isArray(value)
                  ? [`${value[0].toFixed(1)} – ${value[1].toFixed(1)}${unit}`, 'min – max']
                  : [`${Number(value).toFixed(1)}${unit}`, name === dataKey ? title : name]
              }
              animationDuration={150}
            />
            {/* Threshold warning line */}
            {thresholdWarning != null && (
              <ReferenceLine
                y={thresholdWarning}
                stroke="#fbbf24"
                strokeDasharray="6 3"
                strokeWidth={1}
                strokeOpacity={0.5}
                label={{ value: `Warning ${thresholdWarning}%`, position: 'insideTopRight', fill: '#fbbf24', fontSize: 10, opacity: 0.7 }}
              />
            )}
            {/* Threshold critical line */}
            {thresholdCritical != null && (
              <ReferenceLine
                y={thresholdCritical}
                stroke="#f43f5e"
                strokeDasharray="6 3"
                strokeWidth={1}
                strokeOpacity={0.5}
                label={{ value: `Critical ${thresholdCritical}%`, position: 'insideTopRight', fill: '#f43f5e', fontSize: 10, opacity: 0.7 }}
              />
            )}
            {hasBand && bandKey && (
              <Area
                type="monotone"
                dataKey={bandKey}
                stroke="none"
                fill={strokeColor}
                fillOpacity={0.14}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />
            )}
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={data.length <= 500}
              animationDuration={600}
              dot={false}
              activeDot={{
                r: 4,
                stroke: strokeColor,
                strokeWidth: 2,
                fill: 'rgba(15, 23, 42, 0.9)',
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Main Trends Page
// ---------------------------------------------------------------------------

export default function Trends() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()

  const [range, setRange] = useState<TimeRange>('1h')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [capturing, setCapturing] = useState(false)

  // Alert threshold config modal state
  const [showAlertConfig, setShowAlertConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [editThresholds, setEditThresholds] = useState<AlertThresholds | null>(null)

  // Trends are per server: the hub's, or one VM's through the hub (Everywhere shows the hub's)
  const { scope, setScope, member: scopeMember, memberName: scopeName, members: scopeMembers, hasFleet } = useFleetScope()
  const trendsMember = scope === 'all' ? null : scopeMember
  const fetchTrends = useCallback(
    () => (trendsMember ? apiClient.get<MetricsTrendsResponse>(memberPath(trendsMember, `/metrics/trends?range=${range}`)) : fetchMetricsTrends(range)),
    [range, trendsMember],
  )

  const { data, loading, error, refresh } = usePolling<MetricsTrendsResponse>(
    fetchTrends,
    pollIntervalFor(range),
    { enabled: isConnected && autoRefresh },
  )

  // A new range must show new data at once, not at the next poll
  const firstRangeRender = useRef(true)
  useEffect(() => {
    if (firstRangeRender.current) { firstRangeRender.current = false; return }
    if (isConnected) refresh()
  }, [range, isConnected, refresh])

  // Fetch alert thresholds (once, low frequency). They are an admin's: the route answers 403 to anyone else
  const { data: alertConfig } = usePolling<AlertConfigResponse>(
    fetchAlertConfig,
    300000,
    { enabled: isConnected && isAdmin },
  )

  // Build chart data
  const chartData = useMemo(() => buildChartData(data, range), [data, range])

  // Latest data point for summary stats
  const latest = data?.points?.length ? data.points[data.points.length - 1] : null
  const pointCount = data?.count ?? 0
  const sampleCount = data?.total ?? pointCount
  const historySince = data?.oldest_epoch ? new Date(data.oldest_epoch * 1000) : null

  // Thresholds from alert config
  const thresholds = alertConfig?.thresholds

  // Manual snapshot capture
  const handleCaptureSnapshot = useCallback(async () => {
    setCapturing(true)
    try {
      // a VM's trends are its own: the snapshot is taken there, through the hub (like the trends shown)
      await captureMetricsSnapshot(trendsMember)
      addToast({ type: 'success', message: trendsMember ? `Snapshot captured on ${scopeName}` : 'Snapshot captured' })
      // Refresh trends data after capturing
      setTimeout(() => refresh(), 500)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? `Could not capture a snapshot: ${err.message}` : 'Could not capture a snapshot' })
    } finally {
      setCapturing(false)
    }
  }, [refresh, addToast, trendsMember, scopeName])

  // Manual refresh (also performs a one-time fetch when autoRefresh is off)
  // the charts as one picture: what is on the page, in the colours of the theme, at twice the resolution
  const chartsRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const handleExport = useCallback(async () => {
    const node = chartsRef.current
    if (!node || exporting) return
    setExporting(true)
    try {
      const bg = getComputedStyle(document.body).backgroundColor
      const url = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#0b1020', style: { padding: '16px' } })
      const a = document.createElement('a')
      a.href = url; a.download = `dcs-trends-${range}-${new Date().toISOString().slice(0, 10)}.png`
      document.body.appendChild(a); a.click(); a.remove()
      addToast({ type: 'success', message: 'The charts were saved as a picture' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The picture could not be made' })
    } finally { setExporting(false) }
  }, [exporting, range, addToast])
  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  // Open alert config modal
  const openAlertConfig = useCallback(() => {
    setEditThresholds(thresholds ? { ...thresholds } : {
      cpu_warning: 75,
      cpu_critical: 90,
      memory_warning: 80,
      memory_critical: 95,
      disk_warning: 80,
      disk_critical: 95,
      restart_threshold: 5,
    })
    setShowAlertConfig(true)
  }, [thresholds])

  // Save alert thresholds
  const handleSaveAlertConfig = useCallback(async () => {
    if (!editThresholds) return
    setSavingConfig(true)
    try {
      await updateAlertConfig(editThresholds)
      addToast({ type: 'success', message: 'Alert thresholds updated' })
      setShowAlertConfig(false)
    } catch {
      addToast({ type: 'error', message: 'Failed to update alert thresholds' })
    } finally {
      setSavingConfig(false)
    }
  }, [editThresholds, addToast])



  const rangeLabel = TIME_RANGES.find((r) => r.id === range)?.label ?? range

  // -------------------------------------------------------------------------
  // Disconnected state
  // -------------------------------------------------------------------------

  if (!isConnected) {
    return (
      <div className="space-y-4 md:space-y-5 animate-fade-in">
        <PageHeader page="trends" />
        <EmptyState icon={<WifiOff size={28} />} title="Not connected" hint="Connect to a server to see its resource trends." />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // one threshold slider: the value in a tone (amber for the warning, rose for the critical line)
  const slider = (id: string, label: string, tone: 'warning' | 'critical', value: number, onChange: (n: number) => void) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className={`text-[11px] uppercase tracking-wider font-semibold ${tone === 'warning' ? 'text-amber-400/80' : 'text-rose-400/80'}`}>{tone === 'warning' ? 'Warning' : 'Critical'}</label>
        <span className={`text-xs font-mono tabular-nums ${tone === 'warning' ? 'text-amber-400' : 'text-rose-400'}`}>{value}%</span>
      </div>
      <input
        id={id}
        aria-label={label}
        type="range"
        min={10}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full h-1.5 rounded-full appearance-none bg-slate-800 cursor-pointer ${tone === 'warning' ? 'accent-amber-400' : 'accent-rose-400'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40`}
      />
    </div>
  )

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="trends"
        badge={trendsMember ? <VmCapsule member={trendsMember} name={scopeName} vmid={scopeMembers.find((m) => m.id === trendsMember)?.vmid} /> : undefined}
        subtitle={pointCount > 0
          ? `${sampleCount.toLocaleString()} sample${sampleCount === 1 ? '' : 's'}${data?.resolution_s ? ` · ${formatResolution(data.resolution_s)} resolution` : ''} · ${rangeLabel}${historySince ? ` · history since ${historySince.toLocaleDateString([], { dateStyle: 'medium' })}` : ''}`
          : undefined}
        actions={<>
          {/* Capture a snapshot: admins only */}
          {isAdmin && (
            <button type="button" onClick={handleCaptureSnapshot} disabled={capturing} aria-label="Capture a snapshot" className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              {capturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              <span className="hidden sm:inline">Capture snapshot</span>
            </button>
          )}

          {/* Auto-refresh toggle */}
          <Hint label={autoRefresh ? 'The charts refresh by themselves' : 'The charts refresh only when you ask'}>
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              aria-pressed={autoRefresh}
              aria-label="Auto-refresh"
              className={`${BTN_TOOLBAR} ${autoRefresh ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <Timer size={14} />
              <span className="hidden sm:inline">{autoRefresh ? 'Auto' : 'Paused'}</span>
            </button>
          </Hint>

          {/* The charts as a picture */}
          {chartData.length > 0 && (
            <Hint label="Save the charts on this page as a picture (PNG)">
              <button type="button" onClick={() => void handleExport()} disabled={exporting} aria-label="Save the charts as a picture" className={BTN_TOOLBAR_QUIET}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
                <span className="hidden sm:inline">Picture</span>
              </button>
            </Hint>
          )}

          {/* Manual refresh */}
          <button type="button" onClick={handleRefresh} disabled={loading} aria-label="Refresh" className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        {hasFleet && (
          <>
            <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Trends of" busy={loading && !!data} />
            {scope === 'all' && <p className="mt-1 text-[11px] text-slate-500">Trends are kept per server: this is the hub's. Pick a VM to see its own.</p>}
            {trendsMember && <p className="mt-1 text-[11px] text-slate-500">The VM {scopeName}'s trends, read through the hub.</p>}
          </>
        )}
      </PageHeader>

      {/* Time range */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="max-w-full overflow-x-auto scrollbar-none">
        <SegmentedControl
          aria-label="Time range"
          value={range}
          onChange={(v) => setRange(v as TimeRange)}
          data={TIME_RANGES.map((tr) => ({
            value: tr.id,
            label: <span className="flex items-center gap-1.5"><Clock size={12} aria-hidden className="hidden sm:block" /><span className="hidden sm:inline">{tr.label}</span><span className="sm:hidden">{tr.shortLabel}</span></span>,
          }))}
        />
        </div>

        {/* Alert thresholds: admins only */}
        {isAdmin && (
          <Hint label="Set the levels that raise a warning or a critical alert">
            <button type="button" onClick={openAlertConfig} aria-label="Alerts" className={BTN_TOOLBAR_QUIET}>
              <Settings2 size={14} />
              <span className="hidden sm:inline">Alerts</span>
            </button>
          </Hint>
        )}

        {autoRefresh && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </div>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Cpu} label="Current CPU" value={latest ? `${latest.cpu_pct.toFixed(1)}%` : '--'} sub={latest ? `Load ${latest.load1.toFixed(2)}` : undefined} tone={latest ? quiet(pctTone(latest.cpu_pct)) : 'neutral'} />
        <StatTile icon={MemoryStick} label="Current memory" value={latest ? `${latest.mem_pct.toFixed(1)}%` : '--'} sub={latest ? `${latest.mem_used_mb.toLocaleString()} / ${latest.mem_total_mb.toLocaleString()} MB` : undefined} tone={latest ? quiet(pctTone(latest.mem_pct)) : 'neutral'} />
        <StatTile icon={HardDrive} label="Current disk" value={latest ? `${latest.disk_pct.toFixed(1)}%` : '--'} tone={latest ? quiet(pctTone(latest.disk_pct)) : 'neutral'} />
        <StatTile
          icon={Database}
          label="Samples"
          value={sampleCount > 0 ? sampleCount.toLocaleString() : '--'}
          sub={pointCount > 0 ? `${pointCount.toLocaleString()} points drawn${data?.resolution_s ? ` · ${formatResolution(data.resolution_s)}` : ''}` : undefined}
        />
      </div>

      {/* Loading: panels shaped like the charts that follow */}
      {loading && !data && (
        <div className="space-y-3 md:space-y-4" role="status" aria-label="Loading the trend data">
          {[[Cpu, 'CPU load'], [MemoryStick, 'Memory usage'], [HardDrive, 'Disk usage']].map(([Icon, title]) => (
            <Panel key={title as string} icon={Icon as typeof Cpu} title={title as string}>
              <div className="skeleton h-40 md:h-52" aria-hidden />
            </Panel>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !data && <ErrorState title="Could not load the trend data" error={error} onRetry={handleRefresh} />}

      {/* Empty state */}
      {data && chartData.length === 0 && (
        <div className="glass-card">
          <EmptyState
            icon={<BarChart3 size={28} />}
            title="No trend data yet"
            hint="The server records a snapshot every minute (cron). The charts appear once the first ones are in."
            action={isAdmin ? (
              <button type="button" onClick={handleCaptureSnapshot} disabled={capturing} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                {capturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                Capture the first snapshot
              </button>
            ) : undefined}
          />
        </div>
      )}

      {/* Charts */}
      {chartData.length > 0 && (
        <div ref={chartsRef} className="space-y-3 md:space-y-4">
          <TrendPanel
            title="CPU load"
            icon={Cpu}
            gradientId="trendCpuGradient"
            strokeColor={METRIC_HEX.cpu}
            dataKey="cpu"
            bandKey="cpuBand"
            range={range}
            data={chartData}
            thresholdWarning={thresholds?.cpu_warning}
            thresholdCritical={thresholds?.cpu_critical}
          />
          <TrendPanel
            title="Memory usage"
            icon={MemoryStick}
            gradientId="trendMemGradient"
            strokeColor={METRIC_HEX.mem}
            dataKey="mem"
            bandKey="memBand"
            range={range}
            data={chartData}
            thresholdWarning={thresholds?.memory_warning}
            thresholdCritical={thresholds?.memory_critical}
          />
          <TrendPanel
            title="Disk usage"
            icon={HardDrive}
            gradientId="trendDiskGradient"
            strokeColor={METRIC_HEX.disk}
            dataKey="disk"
            bandKey="diskBand"
            range={range}
            data={chartData}
            thresholdWarning={thresholds?.disk_warning}
            thresholdCritical={thresholds?.disk_critical}
          />
        </div>
      )}

      {/* Alert thresholds */}
      {showAlertConfig && editThresholds && createPortal(
        <ModalOverlay onClose={() => setShowAlertConfig(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl shadow-black/40 flex flex-col animate-scale-in overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <Settings2 size={16} className="text-slate-300" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-200">Alert thresholds</h3>
              </div>
              <Hint label="Close"><CloseButton onClick={() => setShowAlertConfig(false)} /></Hint>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <p className="text-xs text-slate-500">A warning is raised when a resource passes the first level, a critical alert at the second.</p>
              {/* CPU */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Cpu size={14} className="text-slate-400" aria-hidden />
                  <span className="text-xs font-semibold text-slate-300">CPU load</span>
                </div>
                <div className="space-y-3">
                  {slider('thr-cpu-warn', 'CPU warning', 'warning', editThresholds.cpu_warning, (n) => setEditThresholds({ ...editThresholds, cpu_warning: n }))}
                  {slider('thr-cpu-crit', 'CPU critical', 'critical', editThresholds.cpu_critical, (n) => setEditThresholds({ ...editThresholds, cpu_critical: n }))}
                </div>
              </div>

              <div className="border-t border-white/5" />

              {/* Memory */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MemoryStick size={14} className="text-slate-400" aria-hidden />
                  <span className="text-xs font-semibold text-slate-300">Memory usage</span>
                </div>
                <div className="space-y-3">
                  {slider('thr-mem-warn', 'Memory warning', 'warning', editThresholds.memory_warning, (n) => setEditThresholds({ ...editThresholds, memory_warning: n }))}
                  {slider('thr-mem-crit', 'Memory critical', 'critical', editThresholds.memory_critical, (n) => setEditThresholds({ ...editThresholds, memory_critical: n }))}
                </div>
              </div>

              <div className="border-t border-white/5" />

              {/* Disk */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <HardDrive size={14} className="text-slate-400" aria-hidden />
                  <span className="text-xs font-semibold text-slate-300">Disk usage</span>
                </div>
                <div className="space-y-3">
                  {slider('thr-disk-warn', 'Disk warning', 'warning', editThresholds.disk_warning, (n) => setEditThresholds({ ...editThresholds, disk_warning: n }))}
                  {slider('thr-disk-crit', 'Disk critical', 'critical', editThresholds.disk_critical, (n) => setEditThresholds({ ...editThresholds, disk_critical: n }))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5 shrink-0">
              <button type="button" onClick={() => setShowAlertConfig(false)} className={BTN_SHEET_QUIET}>Cancel</button>
              <button type="button" onClick={handleSaveAlertConfig} disabled={savingConfig} className={BTN_SHEET_PRIMARY}>
                {savingConfig ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save thresholds
              </button>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}
