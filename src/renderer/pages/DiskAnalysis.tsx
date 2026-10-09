// =============================================================================
// Disk Analysis — where the disk space goes: the mounted drives, what Docker
// itself holds (images, containers, volumes, build cache), the app data of each
// stack, and the deep prune that clears everything unused.
// =============================================================================

import { useState, useMemo, useCallback } from 'react'
import {
  HardDrive, Trash2, RefreshCw, Loader2, WifiOff,
  Database, Layers, Box, Archive, PieChart,
  Pencil, Check, X,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { fetchMaintenanceDisk, fetchDisks, fetchStorageOverview, triggerDeepPrune } from '../api/endpoints'
import type { DiskAnalysis as DiskAnalysisData, DiskStackSize, DiskDfEntry, DiskVolumeSize, DiskInfo, StorageOverview } from '../../shared/types'
import { StorageSummary, ProxmoxStorage, VmDisks, fmtBytes } from '../components/storage/StorageEverywhere'
import { ErrorState, EmptyState } from '../components/common/PageState'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON_SM, TONE_DANGER, TONE_GHOST, TONE_GHOST_OK, FOCUS_RING } from '../lib/ui'
import { CARD, REVEAL } from '../lib/pageKit'
import { INPUT } from '../lib/fieldStyles'
import StatTile from '../components/common/StatTile'
import { Pill } from '../components/common/Pill'
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

/** The chart's colour for each kind of Docker data — telling the bars apart, not a status (so no amber) */
const DF_COLORS: Record<string, string> = {
  Images: '#06b6d4',       // cyan
  Containers: '#10b981',   // emerald
  Volumes: '#3b82f6',      // blue
  'Build Cache': '#64748b', // slate
  'Local Volumes': '#3b82f6',
}

const DF_COLOR_FALLBACK = '#64748b' // slate

/** Icon mapping for Docker DF types (the same hues as the bars) */
function dfIcon(type: string) {
  const lower = type.toLowerCase()
  if (lower.includes('image')) return <Layers size={14} className="text-cyan-400" aria-hidden />
  if (lower.includes('container')) return <Box size={14} className="text-emerald-400" aria-hidden />
  if (lower.includes('volume')) return <Database size={14} className="text-blue-400" aria-hidden />
  if (lower.includes('cache')) return <Archive size={14} className="text-slate-400" aria-hidden />
  return <HardDrive size={14} className="text-slate-400" aria-hidden />
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse size strings like "1.2GB", "450MB", "12.5 kB" to MB for chart values */
function parseSizeToMB(s: string): number {
  const match = s.match(/^([\d.]+)\s*([KMGTP]?i?B?)$/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].replace(/i?B$/i, '').toUpperCase()
  switch (unit) {
    case 'K': return num / 1024
    case 'M': return num
    case 'G': return num * 1024
    case 'T': return num * 1024 * 1024
    default: return num / (1024 * 1024)
  }
}

/** Parse size strings to bytes for sorting */
function parseSizeToBytes(s: string): number {
  return parseSizeToMB(s) * 1024 * 1024
}

/** Format MB value to a clean human-friendly label */
function formatMB(mb: number): string {
  if (mb >= 1024 * 1024) {
    const tb = mb / (1024 * 1024)
    return tb >= 10 ? `${Math.round(tb)} TB` : `${tb.toFixed(1)} TB`
  }
  if (mb >= 1024) {
    const gb = mb / 1024
    return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
  }
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${(mb * 1024).toFixed(0)} KB`
}

/** a small heading over a card: an icon and the words in capitals (the capitals are CSS) */
function CardTitle({ icon, children, aside }: { icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{children}</h2>
      </div>
      {aside}
    </div>
  )
}

/** the page's shape while the first answer is on its way */
function DiskSkeleton() {
  return (
    <div role="status" aria-label="Reading the disks" className="space-y-4 md:space-y-5" aria-busy>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${CARD} p-3 sm:p-4 flex items-center gap-3`} aria-hidden>
            <div className="skeleton w-10 h-10 rounded-lg shrink-0" />
            <div className="space-y-2 flex-1"><div className="skeleton h-4 w-20 rounded" /><div className="skeleton h-2.5 w-16 rounded" /></div>
          </div>
        ))}
      </div>
      <div className={`${CARD} p-5`} aria-hidden>
        <div className="skeleton h-3 w-28 rounded mb-3" />
        <div className="skeleton h-4 w-full rounded-full" />
      </div>
      <div className={`${CARD} p-5 space-y-3`} aria-hidden>
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-24 w-full rounded-xl" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DiskAnalysis() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()

  // ---- Stores ----
  const diskLabels = useSettingsStore((s) => s.diskLabels) ?? {}
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  // Inline rename state for drive cards
  const [renamingMount, setRenamingMount] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // ---- Polling ----
  const {
    data: disk,
    loading,
    error,
    refresh,
  } = usePolling<DiskAnalysisData>(fetchMaintenanceDisk, 30000, { enabled: isConnected })

  // Mounted drives from /disks endpoint (same as Dashboard)
  const { data: disksData } = usePolling<{ total: number; disks: DiskInfo[] }>(fetchDisks, 60000, { enabled: isConnected })
  const mountedDrives = disksData?.disks ?? []

  // every machine: the Proxmox nodes (disks, pools) and the VMs' disks; shown when there is more than this server
  const { data: overview } = usePolling<StorageOverview>(fetchStorageOverview, 60000, { enabled: isConnected })
  const everywhere = !!overview && (overview.proxmox.linked || overview.vms.length > 0)

  // Rename handler — writes to shared settingsStore (syncs to Dashboard + Settings)
  const handleRenameLabel = useCallback((mount: string, label: string) => {
    const next = { ...diskLabels }
    if (label) {
      next[mount] = label
    } else {
      delete next[mount]
    }
    updateSetting('diskLabels', next)
    setRenamingMount(null)
  }, [diskLabels, updateSetting])

  // Aggregate totals across all mounted drives (deduplicated by device)
  const storageTotals = useMemo(() => {
    // across every machine: real capacity counted once (this server's drives and the Proxmox pools)
    if (everywhere && overview && overview.totals.total > 0) {
      const t = overview.totals
      return {
        total: fmtBytes(t.total), used: fmtBytes(t.used), free: fmtBytes(t.avail),
        percent: Math.round((t.used / t.total) * 100), driveCount: t.drives, devices: t.devices,
      }
    }
    if (!mountedDrives.length) return null
    // Deduplicate by device — some devices mount at multiple paths
    const seen = new Set<string>()
    let totalMB = 0
    let usedMB = 0
    for (const d of mountedDrives) {
      if (seen.has(d.device)) continue
      seen.add(d.device)
      totalMB += parseSizeToMB(d.total)
      usedMB += parseSizeToMB(d.used)
    }
    const freeMB = totalMB - usedMB
    const pct = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0
    return {
      total: formatMB(totalMB),
      used: formatMB(usedMB),
      free: formatMB(freeMB),
      percent: pct,
      driveCount: seen.size,
      devices: 1,
    }
  }, [mountedDrives, everywhere, overview])

  // ---- Action state ----
  const [deepPruning, setDeepPruning] = useState(false)

  // ---- Deep prune: ask first (Cancel is focused), then do it ----
  const handleDeepPrune = useCallback(async () => {
    const ok = await confirm({
      title: 'Deep prune',
      message: 'This removes all unused Docker resources: stopped containers, unused networks, dangling and unreferenced images, unused volumes and the build cache.\n\nData in the volumes it removes is lost for good, and this cannot be undone. Go on only if nothing important sits in dangling volumes or unused images.',
      confirmLabel: 'Delete everything unused',
      danger: true,
    })
    if (!ok) return
    setDeepPruning(true)
    try {
      const res = await triggerDeepPrune()
      addToast({
        type: res.success ? 'success' : 'error',
        message: res.success
          ? 'Deep prune completed — all unused resources removed'
          : (res.output || 'Deep prune failed'),
      })
      refresh()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Deep prune failed',
      })
    } finally {
      setDeepPruning(false)
    }
  }, [confirm, addToast, refresh])

  // ---- Derived data ----

  /** Docker DF chart data */
  const dfChartData = useMemo(() => {
    if (!disk?.docker_df?.length) return []
    return disk.docker_df.map((entry: DiskDfEntry) => ({
      name: entry.type,
      sizeMB: parseSizeToMB(entry.size),
      sizeLabel: entry.size,
    }))
  }, [disk])

  /** Stack sizes sorted largest-first */
  const sortedStacks = useMemo(() => {
    if (!disk?.stack_sizes?.length) return []
    return [...disk.stack_sizes].sort(
      (a: DiskStackSize, b: DiskStackSize) => parseSizeToBytes(b.size) - parseSizeToBytes(a.size),
    )
  }, [disk])

  /** The Docker volumes, largest first */
  const sortedVolumes = useMemo(() => {
    if (!disk?.volumes?.length) return []
    return [...disk.volumes].sort((a: DiskVolumeSize, b: DiskVolumeSize) => parseSizeToBytes(b.size) - parseSizeToBytes(a.size))
  }, [disk])

  /** Largest stack size in MB for bar width calculations */
  const maxStackMB = useMemo(() => {
    if (!sortedStacks.length) return 1
    return sortedStacks.reduce(
      (max: number, s: DiskStackSize) => Math.max(max, parseSizeToMB(s.size)),
      0,
    ) || 1
  }, [sortedStacks])

  // ---------------------------------------------------------------------------
  // Which of the page's states this is
  // ---------------------------------------------------------------------------

  const isEmpty = !!disk && !disk.docker_df?.length && !disk.stack_sizes?.length
  const state: 'offline' | 'loading' | 'error' | 'empty' | 'ready' =
    !isConnected ? 'offline'
      : loading && !disk ? 'loading'
        : error && !disk ? 'error'
          : isEmpty ? 'empty'
            : 'ready'

  // the line under the name: the numbers of all drives when known, else the host's disk, else the registry's
  const subtitle = state === 'ready' || state === 'empty'
    ? (storageTotals
        ? <>
            <span className="text-slate-300">{storageTotals.used}</span>
            {' used of '}
            <span className="text-slate-300">{storageTotals.total}</span>
            {' across '}
            <span className="text-slate-300">{storageTotals.driveCount}</span>
            {` drive${storageTotals.driveCount !== 1 ? 's' : ''} `}
            {storageTotals.devices > 1 && <>{'on '}<span className="text-slate-300">{storageTotals.devices}</span>{' machines '}</>}
            <span className={`font-semibold ${storageTotals.percent > 80 ? 'text-amber-400' : storageTotals.percent > 60 ? 'text-slate-300' : 'text-emerald-400'}`}>
              ({storageTotals.percent}%)
            </span>
          </>
        : disk?.host_disk?.percent
          ? `${disk.host_disk.used} of ${disk.host_disk.total} used (${disk.host_disk.percent})`
          : undefined)
    : undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />

      <PageHeader
        page="disk-analysis"
        subtitle={subtitle}
        actions={isConnected && (
          <>
            {/* Deep prune — admin only */}
            {isAdmin && state === 'ready' && (
              <button
                type="button"
                onClick={handleDeepPrune}
                disabled={deepPruning}
                className={`${BTN_TOOLBAR} ${TONE_DANGER} ${FOCUS_RING}`}
              >
                {deepPruning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Deep prune
              </button>
            )}
            <button type="button" onClick={refresh} disabled={loading} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </>
        )}
      />

      {state === 'offline' && (
        <EmptyState icon={<WifiOff size={28} />} title="Connect to a server to see the disk analysis" />
      )}

      {state === 'loading' && <DiskSkeleton />}

      {state === 'error' && <ErrorState title="Failed to load the disk analysis" error={error} onRetry={refresh} />}

      {state === 'empty' && (
        <EmptyState
          icon={<PieChart size={28} />}
          title="No disk data yet"
          hint="Disk analysis appears here once Docker services are running and the maintenance endpoint reports usage."
          action={<button type="button" onClick={refresh} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}><RefreshCw size={14} /> Check again</button>}
        />
      )}

      {state === 'ready' && (
        <>
          {/* ----------------------------------------------------------------- */}
          {/* Overview stat cards                                                */}
          {/* ----------------------------------------------------------------- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
            <StatTile icon={Database} label="App data" value={disk?.total_app_data && disk.total_app_data !== 'N/A' ? disk.total_app_data : '—'} />
            <StatTile icon={HardDrive} label="Total storage" value={storageTotals?.total ?? disk?.host_disk?.total ?? '—'} />
            <StatTile
              icon={PieChart}
              label="Used"
              value={storageTotals?.used ?? disk?.host_disk?.used ?? '—'}
              tone={(storageTotals?.percent ?? parseInt(disk?.host_disk?.percent ?? '0')) > 80 ? 'attention' : 'neutral'}
              sub={storageTotals || disk?.host_disk?.percent ? `${storageTotals ? `${storageTotals.percent}%` : disk?.host_disk?.percent} of the disk` : undefined}
            />
            <StatTile icon={Archive} label="Available" value={storageTotals?.free ?? disk?.host_disk?.available ?? '—'} />
          </div>

          {/* Every machine: one bar with a segment per machine */}
          {everywhere && overview && <StorageSummary data={overview} />}

          {/* Aggregate storage bar (this server alone) */}
          {!everywhere && storageTotals && (() => {
            const pct = storageTotals.percent
            const barGradient = pct > 90
              ? 'bg-gradient-to-r from-rose-500 to-red-500 shadow-rose-500/20'
              : pct > 75
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-500/20'
                : 'bg-gradient-to-r from-emerald-500 to-cyan-500 shadow-emerald-500/20'
            return (
              <div className={`${CARD} p-4 sm:p-5 animate-fade-in`} style={{ animationDelay: '60ms' }}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Total storage</span>
                    <Pill tone="neutral">{storageTotals.driveCount} drive{storageTotals.driveCount !== 1 ? 's' : ''}</Pill>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-500">
                      <span className="text-slate-300 font-medium">{storageTotals.used}</span>
                      <span className="text-slate-500 mx-0.5">/</span>
                      {storageTotals.total}
                    </span>
                    <span className="text-slate-500" aria-hidden>|</span>
                    <span><span className="text-slate-300 font-medium">{storageTotals.free}</span> <span className="text-slate-500">free</span></span>
                  </div>
                </div>
                <div className="relative h-4 rounded-full bg-slate-800 overflow-hidden" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent used`}>
                  <div
                    className={`h-full rounded-full transition-all duration-700 shadow-lg ${barGradient}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })()}

          {/* ----------------------------------------------------------------- */}
          {/* Mounted Drives                                                     */}
          {/* ----------------------------------------------------------------- */}
          {mountedDrives.length > 0 && (
            <div
              className={`${CARD} p-4 md:p-6 animate-fade-in`}
              style={{ animationDelay: '90ms' }}
            >
              <CardTitle
                icon={<HardDrive size={14} className="text-cyan-400" aria-hidden />}
                aside={<Pill tone="neutral">{mountedDrives.length} drive{mountedDrives.length !== 1 ? 's' : ''}</Pill>}
              >
                {everywhere ? `${overview?.hub.name || 'This server'} — drives` : 'Mounted drives'}
              </CardTitle>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...mountedDrives]
                  .sort((a, b) => parseInt(b.percent) - parseInt(a.percent))
                  .map((d) => {
                    const pct = parseInt(d.percent.replace('%', '')) || 0
                    const label = diskLabels[d.mount] || ''
                    const displayName = label || d.mount
                    const barColor = pct >= 90
                      ? 'from-rose-500 to-red-500'
                      : pct >= 75
                        ? 'from-amber-500 to-orange-500'
                        : 'from-emerald-500 to-cyan-500'
                    const textColor = pct >= 90 ? 'text-rose-400' : pct >= 75 ? 'text-amber-400' : 'text-emerald-400'

                    return (
                      <div
                        key={d.mount}
                        className={`group ${CARD} hover:border-white/10 p-4 transition-colors`}
                      >
                        {/* Header: name + percent */}
                        <div className="flex items-center justify-between mb-3 gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <HardDrive size={13} className={`${textColor} shrink-0`} aria-hidden />
                            {renamingMount === d.mount ? (
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' ? handleRenameLabel(d.mount, renameValue.trim()) : e.key === 'Escape' ? setRenamingMount(null) : null}
                                  autoFocus
                                  aria-label={`Name for ${d.mount}`}
                                  placeholder={d.mount}
                                  className={`${INPUT} flex-1 min-w-0 !px-2 !py-1 !text-xs`}
                                />
                                <Hint label="Save the name">
                                  <button type="button" aria-label="Save" onClick={() => handleRenameLabel(d.mount, renameValue.trim())} className={`${BTN_ICON_SM} ${TONE_GHOST_OK} ${FOCUS_RING}`}><Check size={12} /></button>
                                </Hint>
                                <Hint label="Cancel">
                                  <button type="button" aria-label="Cancel" onClick={() => setRenamingMount(null)} className={`${BTN_ICON_SM} ${TONE_GHOST} ${FOCUS_RING}`}><X size={12} /></button>
                                </Hint>
                              </div>
                            ) : (
                              <>
                                <span className="text-sm font-semibold text-slate-200 truncate" title={d.mount}>
                                  {displayName}
                                </span>
                                <Hint label="Rename drive">
                                  <button
                                    type="button"
                                    aria-label={`Rename the drive ${displayName}`}
                                    onClick={() => { setRenameValue(label); setRenamingMount(d.mount) }}
                                    className={`${BTN_ICON_SM} ${TONE_GHOST} ${REVEAL} ${FOCUS_RING}`}
                                  >
                                    <Pencil size={12} />
                                  </button>
                                </Hint>
                              </>
                            )}
                          </div>
                          <span className={`text-sm font-bold tabular-nums ${textColor} shrink-0`}>
                            {d.percent}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="relative h-3 rounded-full bg-slate-800/80 overflow-hidden mb-3" role="meter" aria-label={`${displayName} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent used`}>
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700 ease-out ${pct >= 90 ? 'animate-pulse' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* Details */}
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">
                            <span className="text-slate-300 font-medium">{d.used}</span>
                            <span className="text-slate-500 mx-0.5">/</span>
                            <span>{d.total}</span>
                          </span>
                          <span className="text-slate-500">
                            <span className="text-slate-300 font-medium">{d.available}</span>
                            <span className="ml-0.5">free</span>
                          </span>
                        </div>

                        {/* Device + mount path */}
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500 font-mono truncate">
                          <span title={d.device}>{d.device}</span>
                          {label && (
                            <>
                              <span className="text-slate-600" aria-hidden>&rarr;</span>
                              <span title={d.mount}>{d.mount}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------- */}
          {/* The Proxmox nodes and the VMs                                      */}
          {/* ----------------------------------------------------------------- */}
          {everywhere && overview && <ProxmoxStorage data={overview} />}
          {everywhere && overview && <VmDisks data={overview} />}

          {/* ----------------------------------------------------------------- */}
          {/* Docker DF breakdown — Chart + Table                                */}
          {/* ----------------------------------------------------------------- */}
          {disk?.docker_df && disk.docker_df.length > 0 && (
            <div
              className={`${CARD} p-4 md:p-6 animate-fade-in`}
              style={{ animationDelay: '120ms' }}
            >
              <CardTitle icon={<Layers size={14} className="text-cyan-400" aria-hidden />}>
                Docker disk usage
              </CardTitle>

              {/* Horizontal bar chart */}
              {dfChartData.length > 0 && (
                <div className="h-44 md:h-52 mb-5" role="img" aria-label={`Bar chart of the space Docker uses: ${dfChartData.map((d) => `${d.name} ${d.sizeLabel}`).join(', ')}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dfChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(51, 65, 85, 0.5)" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => formatMB(v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                        axisLine={false}
                        width={90}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        formatter={(value: number, _name: string, props: { payload?: { sizeLabel?: string } }) => [
                          props.payload?.sizeLabel ?? formatMB(value),
                          'Size',
                        ]}
                        animationDuration={150}
                      />
                      <Bar
                        dataKey="sizeMB"
                        radius={[0, 6, 6, 0]}
                        animationDuration={600}
                        maxBarSize={28}
                      >
                        {dfChartData.map((entry: { name: string; sizeMB: number; sizeLabel: string }, idx: number) => (
                          <Cell
                            key={`cell-${idx}`}
                            fill={DF_COLORS[entry.name] ?? DF_COLOR_FALLBACK}
                            fillOpacity={0.75}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Docker DF table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th scope="col" className="text-left px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Type</th>
                      <th scope="col" className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Total</th>
                      <th scope="col" className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Active</th>
                      <th scope="col" className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Size</th>
                      <th scope="col" className="text-right px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Reclaimable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {disk.docker_df.map((row: DiskDfEntry) => (
                      <tr key={row.type} className="hover:bg-white/[0.03] transition-colors duration-150">
                        <td className="px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            {dfIcon(row.type)}
                            <span className="text-slate-200 font-medium">{row.type}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300 text-xs tabular-nums">{row.total}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300 text-xs tabular-nums">{row.active}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300 text-xs tabular-nums">{row.size}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Pill tone="info">{row.reclaimable}</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------- */}
          {/* Stack sizes section                                                */}
          {/* ----------------------------------------------------------------- */}
          {sortedStacks.length > 0 && (
            <div
              className={`${CARD} p-4 md:p-6 animate-fade-in`}
              style={{ animationDelay: '180ms' }}
            >
              <CardTitle
                icon={<Box size={14} className="text-cyan-400" aria-hidden />}
                aside={<span className="text-[11px] text-slate-500">{sortedStacks.length} stack{sortedStacks.length === 1 ? '' : 's'}</span>}
              >
                App data per stack
              </CardTitle>

              <div className="space-y-2.5 stagger-children">
                {sortedStacks.map((entry: DiskStackSize, idx: number) => {
                  const pct = Math.max((parseSizeToMB(entry.size) / maxStackMB) * 100, 2)
                  return (
                    <div
                      key={entry.name}
                      className="animate-fade-in"
                      style={{ animationDelay: `${200 + idx * 40}ms` }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-300 font-mono truncate mr-3">{entry.name}</span>
                        <span className="text-xs text-slate-400 font-mono shrink-0 tabular-nums">{entry.size}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------- */}
          {/* Docker Volumes                                                     */}
          {/* ----------------------------------------------------------------- */}
          {sortedVolumes.length > 0 && (
            <div
              className={`${CARD} p-4 md:p-6 animate-fade-in`}
              style={{ animationDelay: '240ms' }}
            >
              <CardTitle
                icon={<Database size={14} className="text-blue-400" aria-hidden />}
                aside={<span className="text-[11px] text-slate-500">{sortedVolumes.length} volume{sortedVolumes.length === 1 ? '' : 's'}</span>}
              >
                Docker volumes
              </CardTitle>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {sortedVolumes.map((vol: DiskVolumeSize) => (
                  <div
                    key={vol.name}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.03] hover:border-white/10 transition-colors"
                  >
                    <span className="text-[11px] text-slate-400 font-mono truncate mr-3" title={vol.name}>
                      {vol.name.length > 30 ? `...${vol.name.slice(-27)}` : vol.name}
                    </span>
                    <span className="text-[11px] text-slate-300 font-mono shrink-0 font-medium tabular-nums">{vol.size}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
