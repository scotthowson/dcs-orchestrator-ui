// =============================================================================
// StackCard — Stack card with status, annotations, priority, batch select, and actions
// =============================================================================

import {
  Play, Square, RotateCcw, Download, Loader2, Box,
  AlertTriangle, Tag, Pencil, Check, Shield, Trash2, Clock, Server,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useStackStore } from '../../stores/stackStore'
import { CopyButton } from '../common/CopyButton'
import Hint from '../common/Hint'
import { BTN_CARD_QUIET, BTN_ICON, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER } from '../../lib/ui'
import type { StackInfo } from '../../../shared/types'
import AppDataLabel from './AppDataLabel'

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
  const lastActionTimestamps = useStackStore((s) => s.lastActionTimestamps)
  const lastAction = lastActionTimestamps[stack.name]
  const stackAnnotations = useSettingsStore((s) => s.stackAnnotations) ?? {}
  const annotation = stackAnnotations[stack.name] ?? {}
  const hasPriority = annotation.priority && annotation.priority !== 'normal'
  const priorityCfg = annotation.priority ? priorityConfig[annotation.priority] : null

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
      label: isRunning ? 'Reload' : 'Start',
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
        group relative glass glass-hover cursor-pointer overflow-hidden
        border-l-2 transition-all duration-300
        ${borderColor}
        ${isRunning && !batchMode ? 'glow-emerald' : ''}
        ${batchMode && isSelected ? 'ring-2 ring-cyan-500/40' : ''}
      `}
      onClick={handleCardClick}
    >
      {/* Subtle glow overlay for running stacks */}
      {isRunning && !batchMode && (
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/[0.03] to-transparent pointer-events-none" />
      )}

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
      <div className="relative p-5 pb-6">
        {/* Header row: checkbox (batch mode) + name + status + edit */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-start gap-3 flex-1 min-w-0 mr-3">
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
                    className="max-w-full truncate rounded text-left text-slate-100 group-hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
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
                <CopyButton text={stack.name} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" size={10} />
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
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
            <span
              className={`
                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ml-1
                ${
                  isRunning
                    ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25'
                    : isAsleep
                      ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/25'
                      : 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25'
                }
              `}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : isAsleep ? 'bg-indigo-400' : 'bg-slate-500'
                }`}
              />
              {isRunning ? 'Running' : isAsleep ? 'Sleeping' : 'Stopped'}
            </span>
          </div>
          {stack.placement === 'vm' && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ring-1 ${stack.reachable === false ? 'bg-rose-500/10 text-rose-300 ring-rose-500/25' : 'bg-violet-500/15 text-violet-200 ring-violet-500/25'}`} title={stack.reachable === false ? 'The VM is off or not answering' : `Runs in its own VM${stack.node ? ` on ${stack.node}` : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${stack.reachable === false ? 'bg-rose-400' : 'bg-violet-300'}`} />
              VM{stack.vmid ? ` #${stack.vmid}` : ''}{stack.reachable === false ? ' · off' : ''}
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
        <div className={`flex items-center gap-2 ${stack.placement !== 'vm' && stack.app_data ? 'mb-1.5' : 'mb-4'}`}>
          <Box className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs text-slate-400">
            <span className={`font-semibold ${isRunning ? 'text-emerald-400' : 'text-slate-300'}`}>
              {stack.running_containers}
            </span>{' '}
            {(stack.sleeping_containers ?? 0) > 0
              ? 'running'
              : <>container{stack.running_containers !== 1 ? 's' : ''} running</>}
            {(stack.sleeping_containers ?? 0) > 0 && (
              <>
                <span className="text-slate-600">{' · '}</span>
                <span className="font-semibold text-indigo-300">{stack.sleeping_containers}</span> sleeping
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
        {/* where its App-Data is (a hub stack: a VM's lives in the VM) */}
        {stack.placement !== 'vm' && <AppDataLabel stack={stack.name} appData={stack.app_data} className="mb-4" />}

        {/* Action buttons (hidden in batch mode) */}
        {!batchMode && (
          <div
            className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            {/* start, stop, restart and update are admin calls on the API: a viewer sees the state, not the controls */}
            {isAdmin && actionButtons.map(({ action, icon: Icon, label, tone, disabled }) => {
              const isDisabled = disabled || isActionLoading

              return (
                <Hint key={action} label={label}>
                  <button
                    onClick={() => onAction(stack.name, action)}
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

            {/* Compose file indicator */}
            {stack.has_env && (
              <span className="ml-auto text-[10px] text-slate-500 font-mono">.env</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
