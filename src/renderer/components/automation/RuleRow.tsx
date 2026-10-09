// =============================================================================
// RuleRow — one rule of the Automation page, timed or condition alike: what
// starts it, what it does and where, whether it is on, when it last ran; its
// buttons act on the rule where it lives. Its runs open inline below it.
// =============================================================================

import { useEffect, useState } from 'react'
import {
  CalendarClock, Radar, Clock, Zap, Pause, Play, Pencil, Trash2, Loader2, ChevronDown, ChevronRight,
  History, CheckCircle, XCircle, ArrowRight,
} from 'lucide-react'
import VmCapsule from '../fleet/VmCapsule'
import Hint from '../common/Hint'
import { BTN_CARD, BTN_ICON_SM, TONE_QUIET, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER } from '../../lib/ui'
import { useScheduleStore } from '../../stores/scheduleStore'
import { fetchAutomationHistory } from '../../api/endpoints'
import { SCHEDULE_ACTION_LABELS, relativeTime, type UnifiedRule } from './model'

import { Pill } from '../common/Pill'
export interface RuleRowProps {
  rule: UnifiedRule
  isAdmin: boolean
  /** the member a scope-less rule belongs to (the list's own scope) */
  scopeMember: string | null
  running: boolean
  toggling: boolean
  deleting: boolean
  onRun: () => void
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onScope: (scope: string) => void
}

export default function RuleRow({ rule, isAdmin, scopeMember, running, toggling, deleting, onRun, onToggle, onEdit, onDelete, onScope }: RuleRowProps) {
  const [open, setOpen] = useState(false)
  const Icon = rule.actionIcon
  const timed = rule.kind === 'timed'
  return (
    <li className={`glass rounded-xl overflow-hidden border transition-colors ${rule.enabled ? 'border-white/5 hover:border-white/10' : 'border-white/[0.03]'}`}>
      <div className="p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* the action's icon: emerald while the rule is on */}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${rule.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-slate-500'}`} aria-hidden>
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`text-sm font-medium truncate max-w-full ${rule.enabled ? 'text-slate-100' : 'text-slate-400'}`}>{rule.name}</h3>
            {rule.member !== undefined && <VmCapsule member={rule.member} name={rule.member_name} vmid={rule.vmid} size="xs" onClick={() => onScope(rule.member ?? 'hub')} />}
            <Pill tone={timed ? 'info' : 'attention'} icon={timed ? <CalendarClock size={10} /> : <Radar size={10} />}>{timed ? 'Timed' : 'Condition'}</Pill>
            <Pill tone={rule.enabled ? 'ok' : 'neutral'}>{rule.enabled ? 'Active' : 'Paused'}</Pill>
          </div>
          {/* when → what → where */}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 text-xs text-slate-300">
            <span className="flex items-center gap-1">
              {timed ? <Clock className="w-3 h-3 text-slate-500" aria-hidden /> : <Radar className="w-3 h-3 text-slate-500" aria-hidden />}
              {rule.when}
            </span>
            {rule.whenCode && <code className="font-mono text-[10px] text-cyan-300 bg-cyan-500/10 px-1 rounded border border-cyan-500/15">{rule.whenCode}</code>}
            <ArrowRight className="w-3 h-3 text-slate-500" aria-label="then" />
            <span className="text-slate-200">{rule.actionLabel}</span>
            {rule.target && <>
              <span className="text-slate-500">on</span>
              <span className="font-mono text-[11px] text-slate-300 break-all">{rule.target}</span>
            </>}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-[11px] text-slate-500">
            <span title={rule.lastRun ? new Date(rule.lastRun).toLocaleString() : undefined}>Last run: {relativeTime(rule.lastRun)}</span>
            <span className="tabular-nums">{rule.runCount} run{rule.runCount === 1 ? '' : 's'}</span>
            {rule.tuning && <span className="tabular-nums">{rule.tuning}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isAdmin && (
            <Hint label="Run the action now">
              <button type="button" onClick={onRun} disabled={running} aria-label={`Run ${rule.name} now`} className={`${BTN_CARD} ${TONE_QUIET}`}>
                {running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                <span className="hidden md:inline">Run</span>
              </button>
            </Hint>
          )}
          {isAdmin && (
            <Hint label={rule.enabled ? 'Pause' : 'Resume'}>
              <button
                type="button"
                onClick={onToggle}
                aria-busy={toggling}
                aria-label={`${rule.enabled ? 'Pause' : 'Resume'} ${rule.name}`}
                className={`${BTN_ICON_SM} ${rule.enabled ? TONE_GHOST : TONE_GHOST_OK}`}
              >
                {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : rule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
            </Hint>
          )}
          {isAdmin && (
            <Hint label="Edit">
              <button type="button" onClick={onEdit} aria-label={`Edit ${rule.name}`} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </Hint>
          )}
          <Hint label={open ? 'Hide the runs' : 'Show the runs'}>
            <button type="button" aria-label={open ? `Hide the runs of ${rule.name}` : `Show the runs of ${rule.name}`} aria-expanded={open} onClick={() => setOpen(!open)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </Hint>
          {isAdmin && (
            <Hint label="Delete">
              <button type="button" onClick={onDelete} disabled={deleting} aria-label={`Delete ${rule.name}`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </Hint>
          )}
        </div>
      </div>

      {open && <RuleHistory rule={rule} member={rule.member ?? scopeMember} />}
    </li>
  )
}

interface Run { timestamp: string; success: boolean; label?: string; manual?: boolean; durationMs?: number | null; output?: string }

/** the runs live where the rule does: a VM's are asked on that VM, not the hub; a new run re-reads them */
function RuleHistory({ rule, member }: { rule: UnifiedRule; member: string | null }) {
  const scheduleHistory = useScheduleStore((s) => s.history[rule.id])
  const fetchScheduleHistory = useScheduleStore((s) => s.fetchHistory)
  const [autoRuns, setAutoRuns] = useState<Run[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const isSchedule = rule.src.type === 'schedule'

  useEffect(() => {
    if (isSchedule) { fetchScheduleHistory(rule.id, member); return }
    let live = true
    fetchAutomationHistory(rule.id, member)
      .then((r) => { if (live) { setFailed(false); setAutoRuns((r.history ?? []).map((h) => ({ timestamp: h.timestamp, success: h.success, output: h.message }))) } })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [isSchedule, rule.id, member, rule.runCount, rule.lastRun, fetchScheduleHistory])

  const runs: Run[] | null = isSchedule
    ? (scheduleHistory ? scheduleHistory.map((h) => ({
        timestamp: h.timestamp, success: h.success, label: SCHEDULE_ACTION_LABELS[h.action] || h.action,
        manual: h.trigger === 'manual', durationMs: h.duration_ms, output: h.output,
      })) : null)
    : autoRuns

  return (
    <div className="border-t border-white/5 p-4 bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-slate-400" aria-hidden />
        <h4 className="text-sm text-slate-300 font-medium">Run history</h4>
        {runs && runs.length > 0 && <span className="text-[11px] text-slate-500 tabular-nums">{runs.length}</span>}
      </div>
      {failed ? (
        <p className="text-sm text-rose-300">Could not read the runs of this rule</p>
      ) : runs === null ? (
        <div className="space-y-2" role="status" aria-label="Reading the runs">{[0, 1].map((i) => <div key={i} className="skeleton h-5 rounded" aria-hidden />)}</div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-slate-500">No runs yet</p>
      ) : (
        <ul className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin">
          {runs.map((h, idx) => {
            const expandable = !!h.output?.trim()
            const isOpen = openIdx === idx
            const line = (
              <>
                {h.success ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Succeeded" /> : <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-label="Failed" />}
                <span className="text-slate-400 tabular-nums">{new Date(h.timestamp).toLocaleString()}</span>
                {h.label && <span className="text-slate-400">{h.label}</span>}
                {h.manual && <Pill tone="neutral">manual</Pill>}
                {h.durationMs != null && <span className="text-slate-500 tabular-nums">{h.durationMs} ms</span>}
                {expandable && (isOpen ? <ChevronDown size={12} className="text-slate-500 ml-auto shrink-0" aria-hidden /> : <ChevronRight size={12} className="text-slate-500 ml-auto shrink-0" aria-hidden />)}
              </>
            )
            return (
              <li key={`${h.timestamp}-${idx}`} className="rounded-lg">
                {expandable ? (
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpenIdx(isOpen ? null : idx)}
                    className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 rounded-lg text-xs text-left hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                    {line}
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs">{line}</div>
                )}
                {expandable && isOpen && (
                  <pre className="mx-2 mb-2 text-[11px] text-slate-400 font-mono bg-slate-950/60 rounded-lg p-3 whitespace-pre-wrap break-all border border-white/[0.03] max-h-48 overflow-y-auto scrollbar-thin">{h.output}</pre>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
