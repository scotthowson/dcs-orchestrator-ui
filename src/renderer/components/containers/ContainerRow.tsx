// =============================================================================
// ContainerRow — Table row + mobile card for a single container
// =============================================================================

import React, { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ContainerInfo, ContainerStats } from '../../../shared/types'
import { useContainerStore } from '../../stores/containerStore'
import {
  Box, RefreshCw, CheckSquare, Square,
  Star, Cpu, MemoryStick, Clock, ChevronRight,
  Play, RotateCw, Square as SquareStop, Moon } from 'lucide-react'
import { CopyButton } from '../common/CopyButton'
import Hint from '../common/Hint'
import VmCapsule from '../fleet/VmCapsule'
import { BTN_ICON_SM, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER } from '../../lib/ui'
import { StateChip, StateDot } from '../common/StateChip'
import { Pill } from '../common/Pill'
import { containerState, isAsleep, STATE_META } from '../../lib/containerState'

import { REVEAL } from '../../lib/pageKit'
// one pill shape for a container's state, whatever it says (sleeping included): same height, never on two lines
const STATE_PILL = 'inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium leading-none ring-1 whitespace-nowrap'
const ON_DEMAND_TAG = 'text-[10px] font-normal text-indigo-300/80'


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** the game-server panel that made a container (Pelican or Pterodactyl Wings, outside compose), or null */
export function panelOf(c: Pick<ContainerInfo, 'owner'>): 'Pelican' | 'Pterodactyl' | null {
  return c.owner === 'pelican' ? 'Pelican' : c.owner === 'pterodactyl' ? 'Pterodactyl' : null
}

/** "Pelican" in a pill, and what the UUID-named server runs (its image) */
function PanelTag({ container }: { container: ContainerInfo }) {
  const panel = panelOf(container)
  if (!panel) return null
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <Pill tone="fleet" size="xs" title={`Created by ${panel} Wings. Manage it in the ${panel} panel.`}>{panel}</Pill>
      {container.owner_hint && <span className="truncate text-[11px] text-slate-500 font-mono">{container.owner_hint}</span>}
    </span>
  )
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '--'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  return parts.join(' ')
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '\u2026'
}

function parseCpuPercent(cpuStr: string | number | undefined): number {
  if (cpuStr == null || cpuStr === '--') return 0
  if (typeof cpuStr === 'number') return cpuStr
  const match = String(cpuStr).match(/([\d.]+)/)
  return match ? parseFloat(match[1]) : 0
}

function parseMemPercent(memStr: string | number | undefined): number {
  if (memStr == null || memStr === '--') return 0
  if (typeof memStr === 'number') return memStr
  const match = String(memStr).match(/([\d.]+)/)
  return match ? parseFloat(match[1]) : 0
}

// ---------------------------------------------------------------------------
// Badge variants
// ---------------------------------------------------------------------------

type BadgeVariant = { bg: string; text: string; ring: string; dot: string }

const STATE_VARIANTS: Record<string, BadgeVariant> = {
  running: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400' },
  exited:  { bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'ring-rose-500/20', dot: 'bg-rose-400' },
  paused:  { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', dot: 'bg-amber-400' },
  restarting: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'ring-cyan-500/20', dot: 'bg-cyan-400' },
  created: { bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20', dot: 'bg-slate-400' },
}
const DEFAULT_STATE_VARIANT: BadgeVariant = { bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20', dot: 'bg-slate-400' }

const HEALTH_VARIANTS: Record<string, BadgeVariant> = {
  healthy:   { bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400' },
  unhealthy: { bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'ring-rose-500/20', dot: 'bg-rose-400' },
  starting:  { bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', dot: 'bg-amber-400' },
}
const DEFAULT_HEALTH_VARIANT: BadgeVariant = { bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20', dot: 'bg-slate-400' }

// ---------------------------------------------------------------------------
// Inline stats mini-bar
// ---------------------------------------------------------------------------

function MiniBar({ percent, label }: { percent: number; label: string }) {
  const color = percent > 80 ? 'bg-rose-400' : percent > 60 ? 'bg-amber-400' : 'bg-emerald-400'
  const textColor = percent > 80 ? 'text-rose-400' : percent > 60 ? 'text-amber-400' : 'text-slate-500'
  return (
    <div className="flex items-center gap-1" title={`${label}: ${percent.toFixed(1)}%`}>
      <div className="w-10 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <span className={`text-[9px] tabular-nums ${textColor}`}>{Math.round(percent)}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContainerRowProps {
  container: ContainerInfo
  isSelected: boolean
  /** The row itself: two servers of a fleet may each run a container of the same name */
  onClick: (container: ContainerInfo) => void
  batchMode?: boolean
  batchSelected?: boolean
  isFavorite?: boolean
  onToggleFavorite?: (name: string) => void
  onQuickAction?: (container: ContainerInfo, action: 'start' | 'stop' | 'restart') => void
  /** `${member}|${name}-${action}` of the row whose quick action is running */
  quickActionLoading?: string | null
  /** The Everywhere view of a hub: say where the row lives (the hub, or a VM by number and name) */
  showCapsule?: boolean
  /** an admin's click on the "on demand" badge: the on-demand settings (idle time, waiting page, off) */
  onOnDemand?: (container: ContainerInfo) => void
}

/** A row's own live usage when the list carries it, else what the stats poller stored under its name */
function rowUsage(container: ContainerInfo, stats: ContainerStats | undefined): { cpuPct: number; memPct: number; has: boolean } {
  if (container.cpu_percent != null || container.mem_percent != null) {
    return { cpuPct: container.cpu_percent ?? 0, memPct: container.mem_percent ?? 0, has: true }
  }
  return { cpuPct: parseCpuPercent(stats?.cpu_percent), memPct: parseMemPercent(stats?.memory_percent), has: !!stats }
}

// ---------------------------------------------------------------------------
// Desktop table row
// ---------------------------------------------------------------------------

const ContainerRow: React.FC<ContainerRowProps> = ({
  container, isSelected, onClick,
  batchMode, batchSelected,
  isFavorite, onToggleFavorite,
  onQuickAction, quickActionLoading,
  showCapsule = false, onOnDemand,
}) => {
  const stats: ContainerStats | undefined = useContainerStore((s) => s.stats[container.name])

  const stateKey = container.state.toLowerCase()
  const sv = STATE_VARIANTS[stateKey] ?? DEFAULT_STATE_VARIANT

  const { cpuPct, memPct, has: hasUsage } = rowUsage(container, stats)
  const isRunning = stateKey === 'running'
  const busyKey = `${container.member ?? ''}|${container.name}-`

  return (
    <tr
      onClick={() => onClick(container)}
      className={`
        group cursor-pointer transition-all duration-200 border-b border-white/[0.03]
        ${batchMode && batchSelected
          ? 'bg-cyan-500/[0.08] border-l-2 border-l-cyan-400'
          : isSelected
            ? 'bg-emerald-500/10 border-l-2 border-l-emerald-400'
            : 'hover:bg-white/5 border-l-2 border-l-transparent'
        }
      `}
    >
      {/* Batch checkbox */}
      {batchMode && (
        <td className="px-3 py-3 w-10">
          <button
            type="button"
            role="checkbox"
            aria-checked={!!batchSelected}
            aria-label={`Select ${container.name}`}
            onClick={(e) => { e.stopPropagation(); onClick(container) }}
            className="rounded p-1.5 -m-1.5"
          >
            {batchSelected
              ? <CheckSquare size={15} className="text-cyan-400" />
              : <Square size={15} className="text-slate-500 group-hover:text-slate-400 transition-colors" />
            }
          </button>
        </td>
      )}

      {/* Favorite star */}
      <td className="px-1 py-1 w-10">
        <Hint label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(container.name) }}
            className={`${BTN_ICON_SM} ${TONE_GHOST}`}
            aria-label={`Favorite ${container.name}`}
            aria-pressed={isFavorite}
          >
            <Star
              size={13}
              className={isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-500'}
            />
          </button>
        </Hint>
      </td>

      {/* Name — the VM / hub capsule sits under it, so a narrow table never squeezes the two into the state column */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Box className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition-colors flex-shrink-0" />
          <div className="flex flex-col items-start gap-1 min-w-0">
            <ContainerNameWithPopover container={container} formatUptime={formatUptime} onOpen={() => onClick(container)} />
            <PanelTag container={container} />
            {showCapsule && <VmCapsule member={container.member} name={container.member_name} vmid={container.vmid} size="xs" />}
          </div>
        </div>
      </td>

      {/* State — every pill the same height, on one line; an on-demand container says so inside its pill */}
      <td className="px-3 py-3 whitespace-nowrap">
        {isAsleep(container) ? (
          <StateChip
            state={containerState(container)}
            onClick={onOnDemand ? () => onOnDemand(container) : undefined}
            title={onOnDemand ? `${STATE_META[containerState(container)].hint} — click for the idle time, the waiting page, or to serve it normally` : undefined}
          />
        ) : (
          <span className={`${STATE_PILL} ${sv.bg} ${sv.text} ${sv.ring}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sv.dot} ${stateKey === 'running' ? 'animate-pulse' : ''}`} />
            {container.state}
            {container.on_demand && (onOnDemand
              ? <button type="button" onClick={(e) => { e.stopPropagation(); onOnDemand(container) }} className={`${ON_DEMAND_TAG} hover:text-indigo-200 underline-offset-2 hover:underline`} title="Sablier stops it when idle — click for the on-demand settings">· on demand</button>
              : <span className={ON_DEMAND_TAG} title="Sablier stops it when idle">· on demand</span>)}
          </span>
        )}
      </td>

      {/* CPU + Memory (inline stats) */}
      <td className="px-3 py-3">
        {isRunning && hasUsage ? (
          <div className="flex flex-col gap-0.5">
            <MiniBar percent={cpuPct} label="CPU" />
            <MiniBar percent={memPct} label="Memory" />
          </div>
        ) : (
          <span className="text-xs text-slate-500">--</span>
        )}
      </td>

      {/* Image */}
      <td className="px-3 py-3 hidden lg:table-cell">
        <span className="text-xs text-slate-400 font-mono" title={container.image}>
          {truncate(container.image, 35)}
        </span>
      </td>

      {/* Uptime */}
      <td className="px-3 py-3 hidden xl:table-cell">
        <span className="text-sm text-slate-400">{formatUptime(container.uptime_seconds)}</span>
      </td>

      {/* Restarts */}
      <td className="px-3 py-3 text-center hidden xl:table-cell">
        <span className={`inline-flex items-center gap-1 text-sm ${container.restart_count > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
          {container.restart_count > 0 && <RefreshCw className="h-3 w-3" />}
          {container.restart_count}
        </span>
      </td>

      {/* Quick actions (an admin's): they show under the pointer, while the keyboard is inside the group, and always on a touch screen */}
      <td className="px-3 py-2">
        {onQuickAction && <div className={`flex items-center gap-1 transition-opacity ${REVEAL}`}>
          {container.state !== 'running' && (
            <Hint label={isAsleep(container) ? 'Wake it now (Sablier puts it back to sleep when idle)' : 'Start'}>
              <button
                onClick={(e) => { e.stopPropagation(); onQuickAction?.(container, 'start') }}
                className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}
                aria-label={`${isAsleep(container) ? 'Wake' : 'Start'} ${container.name}`}
              >
                {quickActionLoading === `${busyKey}start` ? <RefreshCw size={12} className="animate-spin text-emerald-400" /> : <Play size={12} />}
              </button>
            </Hint>
          )}
          {container.state === 'running' && (
            <Hint label="Restart">
              <button
                onClick={(e) => { e.stopPropagation(); onQuickAction?.(container, 'restart') }}
                className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                aria-label={`Restart ${container.name}`}
              >
                {quickActionLoading === `${busyKey}restart` ? <RefreshCw size={12} className="animate-spin" /> : <RotateCw size={12} />}
              </button>
            </Hint>
          )}
          {container.state === 'running' && (
            <Hint label="Stop">
              <button
                onClick={(e) => { e.stopPropagation(); onQuickAction?.(container, 'stop') }}
                className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}
                aria-label={`Stop ${container.name}`}
              >
                {quickActionLoading === `${busyKey}stop` ? <RefreshCw size={12} className="animate-spin text-rose-400" /> : <SquareStop size={12} />}
              </button>
            </Hint>
          )}
        </div>}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Mobile card view
// ---------------------------------------------------------------------------

export const ContainerCard: React.FC<ContainerRowProps> = ({
  container, isSelected, onClick,
  batchMode, batchSelected,
  isFavorite, onToggleFavorite,
  showCapsule = false, onOnDemand,
}) => {
  const stats: ContainerStats | undefined = useContainerStore((s) => s.stats[container.name])

  const stateKey = container.state.toLowerCase()
  const sv = STATE_VARIANTS[stateKey] ?? DEFAULT_STATE_VARIANT
  const healthKey = container.health.toLowerCase()
  const hv = HEALTH_VARIANTS[healthKey] ?? DEFAULT_HEALTH_VARIANT

  const { cpuPct, memPct, has: hasUsage } = rowUsage(container, stats)
  const isRunning = stateKey === 'running'

  return (
    <div
      onClick={() => onClick(container)}
      className={`
        group cursor-pointer rounded-2xl p-4 transition-all duration-200
        border
        ${batchMode && batchSelected
          ? 'bg-cyan-500/[0.08] border-cyan-500/20'
          : isSelected
            ? 'bg-emerald-500/[0.06] border-emerald-500/20'
            : 'bg-white/[0.03] border-white/5 hover:bg-white/5 active:scale-[0.98]'
        }
      `}
    >
      {/* Top: name + state + favorite */}
      <div className="flex items-center gap-2">
        {batchMode && (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!batchSelected}
            aria-label={`Select ${container.name}`}
            onClick={(e) => { e.stopPropagation(); onClick(container) }}
            className="flex-shrink-0 rounded p-1.5 -m-1.5"
          >
            {batchSelected
              ? <CheckSquare size={16} className="text-cyan-400" />
              : <Square size={16} className="text-slate-500" />
            }
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(container.name) }}
          className={`${BTN_ICON_SM} ${TONE_GHOST} -ml-1`}
          aria-label={`Favorite ${container.name}`}
          aria-pressed={isFavorite}
        >
          <Star
            size={14}
            className={isFavorite ? 'text-amber-400 fill-amber-400' : 'text-slate-500'}
          />
        </button>
        <Box className="h-4 w-4 text-slate-500 flex-shrink-0" />
        {/* the whole card opens the container for a finger; this button is the way in for a keyboard */}
        <button
          type="button"
          data-container-open={container.name}
          onClick={(e) => { e.stopPropagation(); onClick(container) }}
          className="min-w-0 flex-1 truncate rounded text-left text-[15px] font-semibold text-slate-200"
        >
          {container.name}
        </button>
        <ChevronRight className="h-4 w-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
      </div>

      {/* Middle: badges */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <PanelTag container={container} />
        {showCapsule && <VmCapsule member={container.member} name={container.member_name} vmid={container.vmid} size="xs" />}
        {isAsleep(container) ? (
          <StateChip state={containerState(container)} size="xs" onClick={onOnDemand ? () => onOnDemand(container) : undefined} />
        ) : (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ${sv.bg} ${sv.text} ${sv.ring}`}>
            <span className={`h-1 w-1 rounded-full ${sv.dot} ${stateKey === 'running' ? 'animate-pulse' : ''}`} />
            {container.state}
          </span>
        )}
        {container.on_demand && !isAsleep(container) && (
          onOnDemand
            ? <button type="button" onClick={(e) => { e.stopPropagation(); onOnDemand(container) }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 bg-indigo-500/10 text-indigo-300 ring-indigo-500/20 hover:bg-indigo-500/20 transition-colors" title="Sablier starts it on the first request and stops it when idle — tap for the settings"><Moon size={9} /> on demand</button>
            : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 bg-indigo-500/10 text-indigo-300 ring-indigo-500/20" title="Sablier starts it on the first request and stops it when idle"><Moon size={9} /> on demand</span>
        )}
        {/* asleep: its last health check is history */}
        {!isAsleep(container) && (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 ${hv.bg} ${hv.text} ${hv.ring}`}>
            <span className={`h-1 w-1 rounded-full ${hv.dot}`} />
            {container.health || 'none'}
          </span>
        )}
        {container.restart_count > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
            <RefreshCw size={9} /> {container.restart_count}
          </span>
        )}
      </div>

      {/* Bottom: stats + uptime */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/[0.03]">
        {isRunning && hasUsage ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Cpu size={10} className="text-cyan-400" />
              <MiniBar percent={cpuPct} label="CPU" />
            </div>
            <div className="flex items-center gap-1">
              <MemoryStick size={10} className="text-emerald-400" />
              <MiniBar percent={memPct} label="Memory" />
            </div>
          </div>
        ) : (
          <span className="text-[10px] text-slate-500">No live stats</span>
        )}
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <Clock size={9} />
          {formatUptime(container.uptime_seconds)}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Portal-based container name popover (escapes overflow:hidden on parent glass)
// ---------------------------------------------------------------------------
function ContainerNameWithPopover({ container, formatUptime, onOpen }: { container: ContainerInfo; formatUptime: (s: number) => string; onOpen: () => void }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: rect.left, y: rect.bottom + 6 })
    setShow(true)
  }, [])

  const handleLeave = useCallback(() => {
    timerRef.current = setTimeout(() => setShow(false), 150)
  }, [])

  const handlePopoverEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return (
    <div className="relative">
      <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="text-sm font-medium flex items-center gap-1">
        <button
          type="button"
          data-container-open={container.name}
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          onFocus={handleEnter}
          onBlur={handleLeave}
          className="-my-0.5 py-0.5 rounded text-left whitespace-nowrap text-slate-200 group-hover:text-white transition-colors"
        >
          {container.name}
        </button>
        <CopyButton text={container.name} label="Copy the container name" className={REVEAL} />
      </div>
      {show && createPortal(
        <div
          className="fixed z-[99999] animate-fade-in"
          style={{ left: pos.x, top: pos.y, width: 280 }}
          onMouseEnter={handlePopoverEnter}
          onMouseLeave={handleLeave}
        >
          <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <StateDot state={containerState(container)} />
              <span className="text-xs font-semibold text-slate-200">{container.name}</span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">State</span><span className={isAsleep(container) ? STATE_META[containerState(container)].text : 'text-slate-300 capitalize'}>{isAsleep(container) ? `${STATE_META[containerState(container)].label} · on demand` : container.state}</span></div>
              {container.health && container.health !== 'none' && <div className="flex justify-between"><span className="text-slate-500">Health</span><span className={`capitalize ${container.health === 'healthy' ? 'text-emerald-400' : container.health === 'unhealthy' ? 'text-rose-400' : 'text-amber-400'}`}>{container.health}</span></div>}
              <div className="flex justify-between"><span className="text-slate-500">Image</span><span className="text-slate-300 font-mono truncate ml-2 max-w-[160px]">{container.image}</span></div>
              {container.ports && <div className="flex justify-between"><span className="text-slate-500">Ports</span><span className="text-cyan-400 font-mono truncate ml-2 max-w-[160px]">{container.ports}</span></div>}
              {container.uptime_seconds > 0 && <div className="flex justify-between"><span className="text-slate-500">Uptime</span><span className="text-slate-400">{formatUptime(container.uptime_seconds)}</span></div>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default ContainerRow
