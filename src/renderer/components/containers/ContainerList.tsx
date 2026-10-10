// =============================================================================
// ContainerList — Full container table + mobile cards with favorites, stats.
// On a hub the rows come from the chosen fleet scope (everywhere, the hub, one
// VM); every quick and batch action goes to the server the row lives on.
// =============================================================================

import React, { useState, useMemo, useCallback } from 'react'
import { ContainerInfo } from '../../../shared/types'
import { useContainerStore } from '../../stores/containerStore'
import { containerActionOn, rowKey, type ContainerActionName } from '../../api/fleetScoped'
import ContainerRow, { ContainerCard, panelOf } from './ContainerRow'
import OnDemandDialog from './OnDemandDialog'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { EmptyState, ErrorState } from '../common/PageState'
import FleetScopeChips from '../fleet/FleetScopeChips'
import VmCapsule from '../fleet/VmCapsule'
import { AsleepCount } from '../common/StateChip'
import { containerState, countStates, statesLine, ASLEEP_HINT } from '../../lib/containerState'
import PageHeader from '../common/PageHeader'
import SortableTh from '../common/SortableTh'
import StatTile from '../common/StatTile'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_QUIET, BTN_CARD, TONE_GHOST, BTN_TOOLBAR_OK, BTN_TOOLBAR_DANGER, BTN_TOOLBAR_ATTN } from '../../lib/ui'
import { TONE_DOT, TONE_TEXT, TONE_TILE } from '../../lib/tone'
import type { FleetScope, ScopeMember } from '../../hooks/useFleetScope'
import { Box, CircleCheck, CircleX, CirclePause, Moon, Loader2, CheckSquare, Square as SquareIcon, Play, RefreshCw, RotateCw, Minus, Trash2 } from 'lucide-react'
import SearchInput from '../common/SearchInput'
import CloseButton from '../common/CloseButton'
// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = keyof ContainerInfo
type SortDirection = 'asc' | 'desc'

interface SortConfig {
  key: SortKey
  direction: SortDirection
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const mult = direction === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * mult
  const strA = String(a ?? '').toLowerCase()
  const strB = String(b ?? '').toLowerCase()
  return strA.localeCompare(strB) * mult
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  key: SortKey
  label: string
  align?: 'left' | 'center' | 'right'
  hiddenClass?: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'state', label: 'State' },
  { key: 'image', label: 'Resources' },
  { key: 'image', label: 'Image', hiddenClass: 'hidden lg:table-cell' },
  { key: 'uptime_seconds', label: 'Uptime', hiddenClass: 'hidden xl:table-cell' },
  { key: 'restart_count', label: 'Restarts', align: 'center', hiddenClass: 'hidden xl:table-cell' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContainerListProps {
  /** The rows of the chosen scope, each tagged with the server it lives on (member undefined or null = the hub) */
  containers: ContainerInfo[]
  loading: boolean
  error?: Error | null
  /** rowKey() of the open container */
  selectedKey: string | null
  onSelect: (container: ContainerInfo) => void
  isAdmin?: boolean
  onRefresh?: () => void
  /** a hub: everywhere, the hub alone, or one VM */
  scope: FleetScope
  setScope: (s: FleetScope) => void
  scopeMember: string | null
  memberName: string
  members: ScopeMember[]
  hasFleet: boolean
  /** a fetch is running behind rows already shown */
  busy?: boolean
}

/** stopped for real: not asleep on demand, not a game server its panel turned off */
const isStopped = (c: ContainerInfo): boolean => { const k = containerState(c); return !panelOf(c) && (k === 'stopped' || k === 'stuck' || k === 'created') }

const ContainerList: React.FC<ContainerListProps> = ({
  containers, loading, error, selectedKey, onSelect, isAdmin = false, onRefresh,
  scope, setScope, scopeMember, memberName, members, hasFleet, busy = false,
}) => {
  const favorites = useContainerStore((s) => s.favorites)
  const toggleFavorite = useContainerStore((s) => s.toggleFavorite)
  const confirm = useConfirm()
  const { addToast } = useToast()

  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null)
  /** the row whose "on demand" badge was clicked: its settings dialog is open */
  const [onDemandFor, setOnDemandFor] = useState<ContainerInfo | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortConfig>({ key: 'name', direction: 'asc' })
  const [filter, setFilter] = useState<'all' | 'running' | 'asleep' | 'stopped' | 'paused' | 'panel'>('all')

  // Batch selection state (rows by key: two servers may each run a container of the same name)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchResults, setBatchResults] = useState<{ key: string; name: string; where: string; action: string; success: boolean }[] | null>(null)

  // The server a row's action goes to: the row's own (a VM's rows are tagged, the hub's are not), else the VM chosen above
  const targetOf = useCallback((c: ContainerInfo): string | null => c.member ?? scopeMember, [scopeMember])

  const whereOf = useCallback((c: ContainerInfo): string => (c.member ? `VM ${c.member_name || c.member}` : hasFleet ? 'the hub' : ''), [hasFleet])

  const toggleContainer = useCallback((c: ContainerInfo) => {
    const key = rowKey(c)
    setSelectedContainers((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedContainers(new Set())
  }, [])

  const handleBatchAction = useCallback(async (action: 'start' | 'stop' | 'restart' | 'remove') => {
    if (selectedContainers.size === 0) return
    const rows = containers.filter((c) => selectedContainers.has(rowKey(c)))
    if (action === 'remove') {
      if (!(await confirm({ title: 'Remove these containers?', message: `Remove ${rows.length} container(s)? This will force-remove them and cannot be undone.`, confirmLabel: 'Remove', danger: true }))) return
    }
    // stopping takes what they serve away: it asks first, like a row's Stop
    if (action === 'stop') {
      if (!(await confirm({ title: 'Stop these containers?', message: `Stop ${rows.length} container${rows.length === 1 ? '' : 's'}? What ${rows.length === 1 ? 'it serves is' : 'they serve is'} unavailable until ${rows.length === 1 ? 'it is' : 'they are'} started again.`, confirmLabel: 'Stop', danger: true }))) return
    }
    setBatchLoading(true)
    setBatchResults(null)
    const results: { key: string; name: string; where: string; action: string; success: boolean }[] = []
    const warned: string[] = []
    // one call per row, each on its own server
    for (const c of rows) {
      try {
        const r = await containerActionOn(c.name, action, targetOf(c))
        if (r.warning) warned.push(c.owner_hint || c.name)
        results.push({ key: rowKey(c), name: c.name, where: whereOf(c), action, success: r.success !== false })
      } catch {
        results.push({ key: rowKey(c), name: c.name, where: whereOf(c), action, success: false })
      }
    }
    setBatchResults(results)
    setBatchLoading(false)
    if (warned.length) addToast({ type: 'warning', message: `${warned.join(', ')}: ${warned.length === 1 ? 'a game-server panel manages it' : 'a game-server panel manages them'} — use the panel`, duration: 6000 })
    onRefresh?.()
    // After remove, clear successfully removed containers from selection
    if (action === 'remove') {
      const removed = new Set(results.filter((r) => r.success).map((r) => r.key))
      if (removed.size > 0) {
        setSelectedContainers((prev) => {
          const next = new Set(prev)
          for (const key of removed) next.delete(key)
          return next
        })
      }
    }
  }, [selectedContainers, containers, confirm, targetOf, whereOf, onRefresh, addToast])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedContainers(new Set())
    setBatchResults(null)
  }, [])

  const handleQuickAction = useCallback(async (c: ContainerInfo, action: 'start' | 'stop' | 'restart') => {
    if (quickActionLoading) return
    // stopping is the one that takes something away: it asks first, like a stack's Stop
    if (action === 'stop' && !(await confirm({ title: `Stop ${c.name}?`, message: `Stop the container ${c.name}${c.member ? ` on VM ${c.member_name || c.member}` : ''}? What it serves is unavailable until it is started again.`, confirmLabel: 'Stop', danger: true }))) return
    setQuickActionLoading(`${rowKey(c)}-${action}`)
    try {
      const r = await containerActionOn(c.name, action as ContainerActionName, targetOf(c))
      if (r.success === false) addToast({ type: 'error', message: `Could not ${action} ${c.name}${c.member ? ` on VM ${c.member_name || c.member}` : ''}: ${r.output || 'unknown error'}`, duration: 6000 })
      else if (r.warning) addToast({ type: 'warning', message: `${c.owner_hint || c.name}: ${r.warning}`, duration: 6000 })
      onRefresh?.()
    } catch (err) {
      addToast({ type: 'error', message: `Could not ${action} ${c.name}${c.member ? ` on VM ${c.member_name || c.member}` : ''}: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally { setQuickActionLoading(null) }
  }, [quickActionLoading, targetOf, addToast, onRefresh, confirm])

  // Filter by tab + search
  const filtered = useMemo(() => {
    let result = containers
    if (filter === 'running') {
      result = result.filter((c) => c.state.toLowerCase() === 'running')
    } else if (filter === 'asleep') {
      // on demand, asleep on purpose: Sablier wakes them on the first request
      result = result.filter((c) => containerState(c) === 'asleep')
    } else if (filter === 'stopped') {
      // stopped for real (an on-demand one that cannot wake, Sablier not running, too); asleep is not stopped, nor a game server its panel turned off
      result = result.filter(isStopped)
    } else if (filter === 'paused') {
      result = result.filter((c) => c.state.toLowerCase() === 'paused')
    } else if (filter === 'panel') {
      result = result.filter((c) => panelOf(c))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.image.toLowerCase().includes(q) ||
          c.state.toLowerCase().includes(q) ||
          c.health.toLowerCase().includes(q) ||
          (c.member_name ?? '').toLowerCase().includes(q) ||
          (c.owner_hint ?? '').toLowerCase().includes(q) ||
          (panelOf(c) ?? '').toLowerCase().includes(q) ||
          (c.stack ?? '').toLowerCase().includes(q),
      )
    }
    return result
  }, [containers, search, filter])

  // Sort — favorites always first
  const sorted = useMemo(() => {
    const favSet = new Set(favorites)
    return [...filtered].sort((a, b) => {
      // Favorites first
      const aFav = favSet.has(a.name) ? 0 : 1
      const bFav = favSet.has(b.name) ? 0 : 1
      if (aFav !== bFav) return aFav - bFav
      return compareValues(a[sort.key], b[sort.key], sort.direction)
    })
  }, [filtered, sort, favorites])

  // "Select all" takes the rows on screen (the filter and the search), never ones hidden from the person
  const selectAll = useCallback(() => {
    setSelectedContainers(new Set(sorted.map(rowKey)))
  }, [sorted])

  // Everywhere: the VMs are the stacks — containers sit under their VM, the hub's own last. A game-server panel's
  // containers (Pelican, Pterodactyl Wings) are a group of their own at the end, wherever they run (each row says where)
  const groups = useMemo(() => {
    const own = sorted.filter((c) => !panelOf(c))
    const panels = (['Pelican', 'Pterodactyl'] as const)
      .map((p) => ({ key: `panel-${p}`, header: `Game servers (${p})`, rows: sorted.filter((c) => panelOf(c) === p) }))
      .filter((g) => g.rows.length > 0)
    let base: { key: string; header: string; rows: ContainerInfo[] }[]
    if (scope !== 'all' || !own.some((c) => c.member)) base = own.length ? [{ key: 'all', header: panels.length ? 'Stacks and other containers' : '', rows: own }] : []
    else {
      const byVm = new Map<string, ContainerInfo[]>()
      for (const c of own) { const k = c.member ?? 'hub'; if (!byVm.has(k)) byVm.set(k, []); byVm.get(k)!.push(c) }
      const vms = [...byVm.entries()].filter(([k]) => k !== 'hub').sort(([a], [b]) => a.localeCompare(b))
        .map(([k, rows]) => ({ key: k, header: `VM${rows[0].vmid ? ` #${rows[0].vmid}` : ''} · ${rows[0].member_name || k}`, rows }))
      const hub = byVm.get('hub')
      base = hub ? [...vms, { key: 'hub', header: 'On the hub — this server', rows: hub }] : vms
    }
    return [...base, ...panels]
  }, [scope, sorted])
  /** a group header's dot: the hub emerald, a VM amber, a game-server panel violet */
  const groupDot = (key: string) => (key === 'hub' ? 'bg-emerald-400' : key.startsWith('panel-') ? TONE_DOT.fleet : 'bg-amber-300')

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    )
  }

  // Summary counts (the whole scope: everywhere adds up across servers)
  const runningCount = containers.filter((c) => c.state.toLowerCase() === 'running').length
  const stateCounts = countStates(containers)
  const asleepCount = stateCounts.asleep
  const stoppedCount = containers.filter(isStopped).length
  const pausedCount = containers.filter((c) => c.state.toLowerCase() === 'paused').length
  // a game-server panel's containers: counted in the total, their own filter, never "stopped" when the panel turned them off
  const panelCount = containers.filter((c) => panelOf(c)).length
  const panelLabel = containers.some((c) => panelOf(c) === 'Pelican') ? 'Pelican' : 'Pterodactyl'

  const favSet = new Set(favorites)
  /** the list could not be read and there is nothing to show: the failed state replaces the tiles and the table */
  const failed = !!error && containers.length === 0
  // the page's own line (constants/pageTitles) unless it shows one part of a fleet
  const subtitle = scope === 'all'
    ? `Every container on the hub and its ${members.length} VM${members.length === 1 ? '' : 's'}`
    : scopeMember ? `The containers inside the VM ${memberName}` : undefined
  const emptyHint = search ? 'Try another name, image, stack or VM.' : filter !== 'all' ? `No ${filter === 'panel' ? 'game-server' : filter} containers right now — pick another filter.` : scopeMember ? `Nothing runs inside the VM ${memberName} yet — deploy a template there and its containers appear here.` : 'Start a stack or deploy a template and its containers appear here.'

  return (
    <div className="flex flex-col gap-4 md:gap-6 animate-fade-in">
      {onDemandFor && (
        <OnDemandDialog
          containerName={onDemandFor.name}
          member={onDemandFor.member ?? null}
          onDemand={!!onDemandFor.on_demand}
          onClose={() => setOnDemandFor(null)}
          onChanged={(res) => {
            addToast({ type: 'success', message: res.message || (res.enabled ? 'On-demand start enabled' : 'On-demand start disabled') })
            if (res.traefik_restarted) addToast({ type: 'info', message: 'Traefik restarted to load the Sablier plugin' })
            onRefresh?.()
          }}
          onError={(message) => addToast({ type: 'error', message })}
        />
      )}
      {/* ---- Header ---- */}
      <PageHeader
        page="containers"
        badge={<>
          {scopeMember && <VmCapsule member={scopeMember} name={memberName} vmid={members.find((m) => m.id === scopeMember)?.vmid} />}
          {!failed && <span className="text-sm text-slate-400">
            <span className="text-emerald-400 font-semibold">{runningCount} running</span>
            {asleepCount > 0 && <><span className="mx-1.5 text-slate-500">&middot;</span><AsleepCount n={asleepCount} /></>}
            {panelCount > 0 && <><span className="mx-1.5 text-slate-500">&middot;</span><span className={TONE_TEXT.fleet} title="Created by a game-server panel's Wings; managed in the panel">{panelCount} game server{panelCount === 1 ? '' : 's'}</span></>}
            <span className="mx-1.5 text-slate-500">&middot;</span>
            <span>{containers.length} total</span>
          </span>}
        </>}
        subtitle={subtitle}
        actions={<>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh"
              className={BTN_TOOLBAR_QUIET}
            >
              <RefreshCw size={14} className={loading || busy ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => batchMode ? exitBatchMode() : setBatchMode(true)}
              aria-label={batchMode ? 'Exit batch' : 'Batch select'}
              className={`${BTN_TOOLBAR} ${batchMode ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <CheckSquare size={14} />
              <span className="hidden sm:inline">{batchMode ? 'Exit batch' : 'Batch select'}</span>
            </button>
          )}
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={members} onChange={setScope} busy={busy} />}
      </PageHeader>

      {/* ---- Could not load (nothing read yet): the kit's failed state, never zeros or an endless shimmer ---- */}
      {failed && (
        <ErrorState title={`Could not load the containers${scopeMember ? ` of the VM ${memberName}` : ''}`} error={error} onRetry={onRefresh} />
      )}

      {/* ---- Batch Action Bar ---- */}
      {batchMode && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/15 animate-fade-in">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs font-semibold text-cyan-400">{selectedContainers.size} selected</span>
            <button type="button" onClick={selectAll} className={`${BTN_CARD} ${TONE_GHOST}`}>Select all</button>
            <span className="text-white/10">|</span>
            <button type="button" onClick={clearSelection} className={`${BTN_CARD} ${TONE_GHOST}`}>Clear</button>
            {scope === 'all' && <span className="hidden sm:inline text-[10px] text-slate-500">each row acts on its own server</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => handleBatchAction('start')} disabled={batchLoading || selectedContainers.size === 0}
              className={BTN_TOOLBAR_OK}>
              {batchLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start
            </button>
            <button onClick={() => handleBatchAction('stop')} disabled={batchLoading || selectedContainers.size === 0}
              className={BTN_TOOLBAR_DANGER}>
              {batchLoading ? <Loader2 size={14} className="animate-spin" /> : <Minus size={14} />} Stop
            </button>
            <button onClick={() => handleBatchAction('restart')} disabled={batchLoading || selectedContainers.size === 0}
              className={BTN_TOOLBAR_ATTN}>
              {batchLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Restart
            </button>
            <span className="w-px h-5 bg-white/[0.08]" />
            <button onClick={() => handleBatchAction('remove')} disabled={batchLoading || selectedContainers.size === 0}
              className={BTN_TOOLBAR_DANGER}>
              {batchLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
            </button>
          </div>
        </div>
      )}

      {/* ---- Batch results ---- */}
      {batchResults && (
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Batch results</p>
            <CloseButton size="sm" onClick={() => setBatchResults(null)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {batchResults.map((r) => (
              <div key={r.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
                r.success ? 'bg-emerald-500/[0.06] border-emerald-500/15 text-emerald-400' : 'bg-rose-500/[0.06] border-rose-500/15 text-rose-400'
              }`} title={r.where ? `${r.action} on ${r.where}` : r.action}>
                {r.success ? <CircleCheck size={12} className="shrink-0" /> : <CircleX size={12} className="shrink-0" />}
                <span className="truncate font-medium">{r.name}</span>
                {r.where && <span className="truncate text-[10px] text-slate-500 ml-auto">{r.where}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!failed && <>
      {/* ---- Summary cards ---- */}
      {/* asleep on demand has its own calm card (only when there is one): it is not counted as stopped */}
      <div className={`grid grid-cols-2 ${asleepCount > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3`}>
        <StatTile icon={Box} label="Total" value={containers.length} tone="info" className={asleepCount > 0 ? 'col-span-2 md:col-span-1' : ''} />
        <StatTile icon={CircleCheck} label="Running" value={runningCount} tone="ok" />
        {asleepCount > 0 && <StatTile icon={Moon} label="Asleep" value={asleepCount} iconClass="bg-indigo-500/10 text-indigo-300" title={`${ASLEEP_HINT}. Not a problem.`} />}
        <StatTile icon={CircleX} label="Stopped" value={stoppedCount} tone={stoppedCount > 0 ? 'problem' : 'neutral'} />
        <StatTile icon={CirclePause} label="Paused" value={pausedCount} tone={pausedCount > 0 ? 'attention' : 'neutral'} />
      </div>

      {/* ---- Filter tabs ---- */}
      <div className="surface flex items-center gap-1 overflow-x-auto scrollbar-none p-1">
        {(['all', 'running', 'asleep', 'stopped', 'paused', 'panel'] as const).filter((f) => (f !== 'asleep' || asleepCount > 0 || filter === 'asleep') && (f !== 'panel' || panelCount > 0 || filter === 'panel')).map((filterVal) => {
          const labelMap = { all: 'All', running: 'Running', asleep: 'Asleep', stopped: 'Stopped', paused: 'Paused', panel: panelLabel }
          const countMap = { all: containers.length, running: runningCount, asleep: asleepCount, stopped: stoppedCount, paused: pausedCount, panel: panelCount }
          const colorMap = { all: 'text-cyan-400', running: 'text-emerald-400', asleep: 'text-indigo-300', stopped: 'text-rose-400', paused: 'text-amber-400', panel: '' }
          const activeBgMap = { all: 'bg-cyan-500/15', running: 'bg-emerald-500/15', asleep: 'bg-indigo-500/15', stopped: 'bg-rose-500/15', paused: 'bg-amber-500/15', panel: TONE_TILE.fleet }
          return (
            <button
              key={filterVal}
              onClick={() => setFilter(filterVal)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
                transition-all duration-200
                ${filter === filterVal
                  ? `${activeBgMap[filterVal]} ${colorMap[filterVal]}`
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }
              `}
            >
              {labelMap[filterVal]}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === filterVal ? 'bg-white/10' : 'bg-white/5'}`}>
                {countMap[filterVal]}
              </span>
            </button>
          )
        })}
      </div>

      {/* ---- Search bar ---- */}
      <div className="relative">
        <SearchInput value={search} onChange={setSearch} placeholder={scope === 'all' ? 'Search containers, stacks and VMs...' : 'Search containers...'} />
        {search && (
          <span className="absolute right-10 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
            {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ---- Mobile card view ---- */}
      <div className="md:hidden">
        {loading && containers.length === 0 ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse bg-slate-800/40 rounded-xl h-20 border border-white/[0.03]" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<Box size={28} />}
            title={search ? 'No containers match your search.' : 'No containers found.'}
            hint={emptyHint}
          />
        ) : (
          <div className="flex flex-col gap-2.5 animate-fade-in">
            {groups.map((g) => (
              <React.Fragment key={`group-${g.key}`}>
                {g.header && (
                  <div className="flex items-center gap-2 px-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <span className={`w-1.5 h-1.5 rounded-full ${groupDot(g.key)}`} />
                    {g.header}
                    <span className="text-slate-500 normal-case tracking-normal" title={statesLine(countStates(g.rows))}>{statesLine(countStates(g.rows), { noun: false })} · {g.rows.length} in all</span>
                  </div>
                )}
                {g.rows.map((container) => (
                  <ContainerCard
                    key={rowKey(container)}
                    container={container}
                    isSelected={selectedKey === rowKey(container)}
                    onClick={batchMode ? toggleContainer : onSelect}
                    batchMode={batchMode}
                    batchSelected={selectedContainers.has(rowKey(container))}
                    isFavorite={favSet.has(container.name)}
                    onToggleFavorite={toggleFavorite}
                    showCapsule={scope === 'all'}
                    onOnDemand={isAdmin && !batchMode && !container.member ? setOnDemandFor : undefined}
                  />
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* ---- Desktop table ---- */}
      <div className="hidden md:block surface overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {batchMode && (
                  <th className="px-3 py-3 w-10">
                    <button
                      onClick={selectedContainers.size === sorted.length ? clearSelection : selectAll}
                      className="text-slate-500 hover:text-cyan-400 transition-colors"
                      aria-label={selectedContainers.size === sorted.length && sorted.length > 0 ? 'Clear the selection' : 'Select all'}
                    >
                      {selectedContainers.size === sorted.length && sorted.length > 0
                        ? <CheckSquare size={15} className="text-cyan-400" />
                        : <SquareIcon size={15} />
                      }
                    </button>
                  </th>
                )}
                <th className="w-8"><span className="sr-only">Favorite</span></th>
                {COLUMNS.map((col, idx) => (
                  <SortableTh
                    key={`${col.key}-${idx}`}
                    label={col.label}
                    active={sort.key === col.key}
                    direction={sort.direction}
                    onSort={() => handleSort(col.key)}
                    align={col.align === 'center' ? 'center' : 'left'}
                    className={col.hiddenClass}
                  />
                ))}
                <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && containers.length === 0 ? (
                <>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={COLUMNS.length + 3} className="py-1.5 px-3">
                        <div className="animate-pulse bg-slate-800/40 rounded-lg h-10 border border-white/[0.03]" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 3}>
                    <EmptyState
                      icon={<Box size={28} />}
                      title={search ? 'No containers match your search.' : 'No containers found.'}
                      hint={emptyHint}
                    />
                  </td>
                </tr>
              ) : (
                groups.flatMap((g) => [
                  ...(g.header ? [(
                    <tr key={`group-${g.key}`} className="bg-white/[0.02]">
                      <td colSpan={COLUMNS.length + 3} className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${groupDot(g.key)}`} />
                          {g.header}
                          <span className="text-slate-500 normal-case tracking-normal" title={statesLine(countStates(g.rows))}>{statesLine(countStates(g.rows), { noun: false })} · {g.rows.length} in all</span>
                        </span>
                      </td>
                    </tr>
                  )] : []),
                  ...g.rows.map((container) => (
                  <ContainerRow
                    key={rowKey(container)}
                    container={container}
                    isSelected={selectedKey === rowKey(container)}
                    onClick={batchMode ? toggleContainer : onSelect}
                    batchMode={batchMode}
                    batchSelected={selectedContainers.has(rowKey(container))}
                    isFavorite={favSet.has(container.name)}
                    onToggleFavorite={toggleFavorite}
                    onQuickAction={isAdmin ? handleQuickAction : undefined}
                    quickActionLoading={quickActionLoading}
                    showCapsule={scope === 'all'}
                    onOnDemand={isAdmin && !batchMode && !container.member ? setOnDemandFor : undefined}
                  />
                  )),
                ])
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>}
    </div>
  )
}

export default ContainerList
