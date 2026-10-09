// =============================================================================
// StackCard — Stack card with status, annotations, priority, batch select, and actions
// =============================================================================

import {
  Play, Square, RotateCcw, Download, Loader2, Box,
  AlertTriangle, Tag, Pencil, Check, Shield, Trash2, Clock, Server,
  Cpu, MemoryStick, ArrowUpCircle, Archive, ExternalLink, Globe, Moon,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStackStore } from '../../stores/stackStore'
import { CopyButton } from '../common/CopyButton'
import Hint from '../common/Hint'
import { BTN_CARD_QUIET, BTN_ICON, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER } from '../../lib/ui'
import type { StackInfo } from '../../../shared/types'
import AppDataLabel from './AppDataLabel'
import { AsleepCount } from '../common/StateChip'
import { STACK_META, stackState } from '../../lib/containerState'
import { useConfirm } from '../common/ConfirmDialog'
import { serverHostname, memberHost, portUrl } from '../../lib/hosts'

import { REVEAL } from '../../lib/pageKit'
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface Props {
  stack: StackInfo
  isActionLoading: boolean
  onAction: (stackName: string, action: 'start' | 'stop' | 'restart' | 'update') => void
  onSelect: (stackName: string) => void
  onEdit?: (stackName: string) => void
  /** a hub: this stack runs on the hub itself and can move into a VM of its own, with its data */
  onMoveToVm?: (stackName: string) => void
  onDelete?: (stackName: string) => void
  batchMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (name: string) => void
  /** containers in this stack that match the current search */
  matchedContainers?: string[]
  isAdmin?: boolean
}

/** Pretty-print stack category names: "core-infrastructure" -> "Core Infrastructure" */
function formatStackName(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const priorityConfig = {
  critical: { label: 'Critical', color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', icon: Shield },
  high: { label: 'High', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
  normal: { label: 'Normal', color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20', icon: Tag },
  low: { label: 'Low', color: 'text-slate-500', bg: 'bg-slate-500/10 border-slate-500/20', icon: Tag },
}

export default function StackCard({ stack, isActionLoading, onAction, onSelect, onEdit, onMoveToVm, onDelete, batchMode, isSelected, onToggleSelect, matchedContainers, isAdmin = false }: Props) {
  const isRunning = stack.status === 'running'
  const isAsleep = !isRunning && !!stack.sleeping   // Sablier keeps every container of it asleep on purpose
  const cantWake = isAsleep && stack.sablier_up === false   // ...but Sablier is not running: nothing can wake it
  // running, but some of its containers are down: the stack's detail says "Partly down", so does its card
  const partial = isRunning && stackState(stack) === 'partial'
  const confirm = useConfirm()
  // stopping takes something away: it asks first, like the stack's own Stop
  const runAction = async (action: 'start' | 'stop' | 'restart' | 'update') => {
    if (action === 'stop' && !(await confirm({ title: `Stop ${stack.name}?`, message: `Stop every container in ${stack.name}? What it serves is unavailable until it is started again.`, confirmLabel: 'Stop stack', danger: true }))) return
    onAction(stack.name, action)
  }
  const lastActionTimestamps = useStackStore((s) => s.lastActionTimestamps)
  const lastAction = lastActionTimestamps[stack.name]
  const stackAnnotations = useSettingsStore((s) => s.stackAnnotations) ?? {}
  const annotation = stackAnnotations[stack.name] ?? {}
  const hasPriority = annotation.priority && annotation.priority !== 'normal'
  const priorityCfg = annotation.priority ? priorityConfig[annotation.priority] : null
  // counts: running, asleep on purpose (Sablier), and stopped — the rest of the stack's containers
  const sleepingCount = stack.sleeping_containers ?? 0
  const stoppedCount = Math.max(0, (stack.total_containers ?? stack.running_containers) - stack.running_containers - sleepingCount)
  const vmHost = stack.placement === 'vm' ? memberHost(stack.member_url) : ''
  // ways into the stack's apps: its Traefik addresses, then its published ports on the machine it runs on
  const portHost = stack.placement === 'vm' ? vmHost : serverHostname()
  const appLinks: { href: string; label: string; web: boolean }[] = [
    ...(stack.links ?? []).map((href) => ({ href, label: href.replace(/^https?:\/\//, ''), web: true })),
    ...(portHost ? (stack.ports ?? []).map((p) => ({ href: portUrl(portHost, p), label: `:${p}`, web: false })) : []),
  ]
  const lastBackupMs = stack.last_backup ? Date.parse(stack.last_backup) : NaN

  // emerald starts, rose stops, the rest is neutral (the colours the Proxmox page gives a stack's controls)
  const actionButtons: {
    action: 'start' | 'stop' | 'restart' | 'update'
    icon: typeof Play
    label: string
    tone: string
    disabled?: boolean
  }[] = [
    {
      action: 'start',
      icon: Play,
      label: isRunning ? 'Reload' : isAsleep ? 'Wake now' : 'Start',
      tone: TONE_GHOST_OK,
    },
    {
      action: 'stop',
      icon: Square,
      label: 'Stop',
      tone: TONE_GHOST_DANGER,
      disabled: !isRunning,
    },
    {
      action: 'restart',
      icon: RotateCcw,
      label: 'Restart',
      tone: TONE_GHOST,
      disabled: !isRunning,
    },
    {
      action: 'update',
      icon: Download,
      label: 'Update',
      tone: TONE_GHOST,
    },
  ]

  // Border color based on priority (or selection in batch mode)
  const borderColor = batchMode && isSelected
    ? 'border-l-cyan-500/70'
    : annotation.priority === 'critical'
      ? 'border-l-rose-500/70'
      : annotation.priority === 'high'
        ? 'border-l-amber-500/70'
        : isRunning ? 'border-l-emerald-500/70' : 'border-l-slate-600/50'

  // Handle card click based on mode
  const handleCardClick = () => {
    if (batchMode && onToggleSelect) {
      onToggleSelect(stack.name)
    } else {
      onSelect(stack.name)
    }
  }

  return (
    <div
      className={`
        group relative surface cursor-pointer overflow-hidden flex flex-col
        border-l-2 hover:bg-white/[0.02] transition-colors duration-150
        ${borderColor}
        ${batchMode && isSelected ? 'ring-2 ring-cyan-500/40' : ''}
      `}
      onClick={handleCardClick}
    >
      {/* Selected glow overlay in batch mode */}
      {batchMode && isSelected && (
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.05] to-transparent pointer-events-none" />
      )}

      {/* Critical/high priority indicator */}
      {annotation.priority === 'critical' && (
        <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none">
          <div className="absolute -right-6 -top-6 w-12 h-12 rounded-full bg-rose-500/10" />
        </div>
      )}

      {/* Card content */}
      <div className="relative flex flex-1 flex-col p-4 md:p-5">
        {/* Header row: checkbox (batch mode) + name + status + edit */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Batch mode checkbox */}
            {batchMode && (
              <button role="checkbox" aria-checked={isSelected} aria-label={`Select ${stack.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSelect?.(stack.name)
                }}
                className="shrink-0 mt-0.5 flex items-center justify-center p-1.5 -m-1.5 rounded"
              >
                <span className={`
                  w-5 h-5 rounded border-2 flex items-center justify-center
                  transition-all duration-200
                  ${isSelected
                    ? 'bg-cyan-500 border-cyan-500 text-white'
                    : 'border-slate-500/50 hover:border-slate-400 bg-transparent'}
                `}>
                  {isSelected && <Check size={12} strokeWidth={3} />}
                </span>
              </button>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {/* the whole card opens the stack for a mouse; this button is the way in for a keyboard */}
                <h3 className="text-sm font-semibold truncate min-w-0">
                  <button
                    type="button"
                    data-stack-open={stack.name}
                    onClick={(e) => { e.stopPropagation(); handleCardClick() }}
                    className="-my-0.5 py-0.5 max-w-full truncate rounded text-left text-slate-100 group-hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    aria-label={batchMode ? undefined : `Open ${annotation.label || formatStackName(stack.name)}`}
                  >
                    {annotation.label || formatStackName(stack.name)}
                  </button>
                </h3>
                {hasPriority && priorityCfg && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold border ${priorityCfg.bg} ${priorityCfg.color}`}
                    title={`Priority: ${priorityCfg.label} — affects sort order and visual emphasis`}
                  >
                    <priorityCfg.icon size={8} />
                    {priorityCfg.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5 font-mono flex items-center gap-1">
                {stack.name}
                <CopyButton text={stack.name} label="Copy the stack name" className={REVEAL} />
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`
                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                ${
                  partial
                    ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25'
                  : isRunning
                    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25'
                    : cantWake
                      ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25'
                    : isAsleep
                      ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/25'
                      : 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25'
                }
              `}
              title={partial ? STACK_META.partial.hint : cantWake ? STACK_META.stuck.hint : isAsleep ? STACK_META.asleep.hint : undefined}
            >
              {isAsleep
                ? <Moon size={11} aria-hidden className="shrink-0" />
                : <span className={`w-1.5 h-1.5 rounded-full ${partial ? 'bg-amber-400' : isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />}
              {partial ? STACK_META.partial.label : isRunning ? 'Running' : cantWake ? STACK_META.stuck.label : isAsleep ? STACK_META.asleep.label : 'Stopped'}
            </span>
          </div>
          {stack.placement === 'vm' && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ring-1 ${stack.reachable === false ? 'bg-rose-500/10 text-rose-300 ring-rose-500/25' : 'bg-violet-500/15 text-violet-200 ring-violet-500/25'}`} title={stack.reachable === false ? 'The VM is off or not answering' : `Runs in its own VM${stack.node ? ` on ${stack.node}` : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${stack.reachable === false ? 'bg-rose-400' : 'bg-violet-300'}`} />
              VM{stack.vmid ? ` #${stack.vmid}` : ''}{stack.reachable === false ? ' · off' : ''}
            </span>
          )}
          {vmHost && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400" title={`The VM's address: ${vmHost}`}>
              <Globe size={10} className="text-violet-300/70" aria-hidden />
              {vmHost}
              <CopyButton text={vmHost} label="Copy the address" className={REVEAL} />
            </span>
          )}
          </div>
        </div>

        {/* Notes (if set) */}
        {annotation.notes && (
          <p className="text-[10px] text-slate-500 italic mb-2 line-clamp-2">{annotation.notes}</p>
        )}

        {/* Containers that match the search */}
        {matchedContainers && matchedContainers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mb-3 animate-fade-in">
            <span className="text-[10px] text-slate-500 mr-0.5">contains</span>
            {matchedContainers.slice(0, 6).map((n) => (
              <span key={n} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">{n}</span>
            ))}
            {matchedContainers.length > 6 && <span className="text-[10px] text-slate-500">+{matchedContainers.length - 6}</span>}
          </div>
        )}

        {/* Container count */}
        <div className="flex items-center gap-2 mb-1.5">
          <Box className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs text-slate-400">
            <span className={`font-semibold ${isRunning ? 'text-emerald-400' : 'text-slate-300'}`}>
              {stack.running_containers}
            </span>{' '}
            {sleepingCount > 0 || stoppedCount > 0
              ? 'running'
              : <>container{stack.running_containers !== 1 ? 's' : ''} running</>}
            {sleepingCount > 0 && (
              <>
                <span className="text-slate-600">{' · '}</span>
                {stack.sablier_up === false
                  ? <AsleepCount stuck={sleepingCount} n={0} className="font-semibold" />
                  : <AsleepCount n={sleepingCount} className="font-semibold" />}
              </>
            )}
            {stoppedCount > 0 && (
              <>
                <span className="text-slate-600">{' · '}</span>
                <span className="font-semibold text-rose-400">{stoppedCount}</span> <span className="text-rose-300/80">stopped</span>
              </>
            )}
          </span>
          {lastAction && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock size={10} />
              {formatRelativeTime(lastAction)}
            </span>
          )}
        </div>
        {/* where its App-Data is, with the free space of its disk (a VM's stack: in the VM, as the VM reports it) */}
        <AppDataLabel stack={stack.name} appData={stack.app_data} className="mb-1.5" />

        {/* load, images waiting for an update, the last backup */}
        {(isRunning && (stack.cpu_percent != null || stack.mem_percent != null)) || (stack.updates_available ?? 0) > 0 || !Number.isNaN(lastBackupMs) ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 mb-1.5">
            {isRunning && stack.cpu_percent != null && (
              <span className="inline-flex items-center gap-1" title="CPU of its running containers (100% = one core)">
                <Cpu size={10} aria-hidden /> <span className="font-mono text-slate-300">{stack.cpu_percent.toFixed(1)}%</span>
              </span>
            )}
            {isRunning && stack.mem_percent != null && (
              <span className="inline-flex items-center gap-1" title="Memory of its running containers, percent of the machine">
                <MemoryStick size={10} aria-hidden /> <span className="font-mono text-slate-300">{stack.mem_percent.toFixed(1)}%</span>
              </span>
            )}
            {(stack.updates_available ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20" title="Images of this stack with a newer version upstream (the last registry check)">
                <ArrowUpCircle size={10} aria-hidden /> {stack.updates_available} update{stack.updates_available !== 1 ? 's' : ''}
              </span>
            )}
            {!Number.isNaN(lastBackupMs) && (
              <span className="inline-flex items-center gap-1" title={`Last backup: ${new Date(lastBackupMs).toLocaleString()}`}>
                <Archive size={10} aria-hidden /> backed up {formatRelativeTime(lastBackupMs)}
              </span>
            )}
          </div>
        ) : null}

        {/* open its apps */}
        {appLinks.length > 0 && !batchMode && (
          <div className="flex flex-wrap items-center gap-1 mb-1.5" onClick={(e) => e.stopPropagation()}>
            {appLinks.slice(0, 4).map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" title={`Open ${l.href}`}
                className="inline-flex items-center gap-1 max-w-[12rem] rounded-md px-1.5 py-0.5 text-[10px] font-mono bg-white/[0.04] border border-white/[0.06] text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-200 hover:border-cyan-500/20 transition-colors no-underline">
                <ExternalLink size={9} className="shrink-0" aria-hidden />
                <span className="truncate">{l.label}</span>
              </a>
            ))}
            {appLinks.length > 4 && <span className="text-[10px] text-slate-500">+{appLinks.length - 4}</span>}
          </div>
        )}
        {/* Action buttons (hidden in batch mode): the stack's controls left, editing it right */}
        {!batchMode && (
          <div
            className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 border-t border-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* start, stop, restart and update are admin calls on the API: a viewer sees the state, not the controls */}
            {isAdmin && actionButtons.map(({ action, icon: Icon, label, tone, disabled }) => {
              const isDisabled = disabled || isActionLoading

              return (
                <Hint key={action} label={label}>
                  <button
                    onClick={() => void runAction(action)}
                    disabled={isDisabled}
                    aria-label={`${label} ${stack.name}`}
                    className={`${BTN_ICON} ${tone} disabled:cursor-not-allowed`}
                  >
                    {isActionLoading ? (
                      <Loader2 size={14} className="animate-spin text-slate-400" />
                    ) : (
                      <Icon size={14} />
                    )}
                  </button>
                </Hint>
              )
            })}

            <div className="ml-auto flex items-center gap-1.5">
              {/* Compose file indicator */}
              {stack.has_env && (
                <span className="mr-1 text-[10px] text-slate-500 font-mono">.env</span>
              )}
              {!batchMode && onMoveToVm && !stack.hub_only && (
                <Hint label="Move this stack into a Proxmox VM of its own, with its data">
                  <button
                    onClick={(e) => { e.stopPropagation(); onMoveToVm(stack.name) }}
                    aria-label={`Move ${stack.name} into a VM`}
                    className={`${BTN_CARD_QUIET} text-violet-300 hover:bg-violet-500/10`}
                  >
                    <Server size={12} />
                    <span className="hidden sm:inline">To a VM</span>
                  </button>
                </Hint>
              )}
              {!batchMode && onEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(stack.name) }}
                  aria-label={`Edit ${stack.name}`}
                  className={BTN_CARD_QUIET}
                >
                  <Pencil size={12} />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              {!batchMode && onDelete && !isRunning && (
                <Hint label="Delete the stack">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(stack.name) }}
                    aria-label={`Delete ${stack.name}`}
                    className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100`}
                  >
                    <Trash2 size={12} />
                  </button>
                </Hint>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
