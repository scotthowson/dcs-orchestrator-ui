// =============================================================================
// The Automation page's one list of rules. The server keeps two stores — the
// timed DCS tasks (/schedules) and the automation rules (/automations, at a cron
// time or when a condition is met) — and runs both on the same clock. The page
// shows them as one list of rules; each rule still writes to its own endpoint.
// =============================================================================

import {
  Archive, RefreshCw, Wrench, HeartPulse, RotateCcw, CirclePlay, CircleStop, Activity, Play,
  ArrowUpCircle, ArrowDownToLine, LifeBuoy, Box, HardDrive, Bell, Pause, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { pageLabel } from '../../constants/pageTitles'
import type { AutomationRule, Schedule } from '../../../shared/types'

/** what a rule waits for: a time, or something happening */
export type RuleKind = 'timed' | 'condition'
/** the filter over the list */
export type KindFilter = RuleKind | 'all'

export interface UnifiedRule {
  /** unique across both stores (an id may repeat on another VM) */
  key: string
  kind: RuleKind
  id: string
  name: string
  enabled: boolean
  member?: string | null
  member_name?: string
  vmid?: number | null
  lastRun: string | null
  runCount: number
  /** when it runs, in words */
  when: string
  /** the expression behind `when`, when the words are not the expression itself */
  whenCode?: string
  actionLabel: string
  actionIcon: LucideIcon
  target: string
  /** a condition rule's own tuning, in words ('95% · 30 min cooldown') */
  tuning?: string
  src: { type: 'schedule'; item: Schedule } | { type: 'automation'; item: AutomationRule }
}

// ---------------------------------------------------------------------------
// Timed DCS tasks (/schedules)
// ---------------------------------------------------------------------------

export const SCHEDULE_ACTION_ICONS: Record<string, LucideIcon> = {
  backup: Archive, update: RefreshCw, prune: Wrench, 'health-check': HeartPulse,
  restart: RotateCcw, start: CirclePlay, stop: CircleStop, 'metrics-snapshot': Activity, custom: Play,
  'dcs-update': ArrowUpCircle, 'image-update': ArrowDownToLine, recovery: LifeBuoy,
}
export const SCHEDULE_ACTION_LABELS: Record<string, string> = {
  backup: 'Backup', update: 'Update stack', prune: 'Docker prune',
  'health-check': 'Health check', restart: 'Restart stack', start: 'Start stack', stop: 'Stop stack',
  'metrics-snapshot': 'Metrics snapshot', custom: 'Custom script',
  'dcs-update': 'DCS self-update', 'image-update': 'Image updates', recovery: 'Recovery bundle',
}
/** What the target field means per action (empty: no target) */
export const SCHEDULE_TARGET_HINTS: Record<string, string> = {
  'dcs-update': 'Leave empty, or "images" to pull image updates for every stack as well. Rolls back by itself when the health score drops.',
  'image-update': 'Leave empty to pull newer images and recreate their containers, or "pull" to only pull them (the containers keep the old image until they are recreated).',
  recovery: `No target. Needs the RECOVERY_PASSPHRASE secret (${pageLabel('backup')} page); copies to RECOVERY_REMOTE when set.`,
}
export const SCHEDULE_PRESETS = [
  { value: '@minutely', label: 'Every minute' },
  { value: '@5min', label: 'Every 5 minutes' },
  { value: '@15min', label: 'Every 15 minutes' },
  { value: '@30min', label: 'Every 30 minutes' },
  { value: '@hourly', label: 'Every hour' },
  { value: '@daily', label: 'Every day' },
  { value: '@weekly', label: 'Every week' },
  { value: '@monthly', label: 'Every month' },
]
/** every action the API's schedule runner knows (start, stop and image-update included) */
export const SCHEDULE_ACTIONS = ['backup', 'update', 'image-update', 'prune', 'health-check', 'start', 'stop', 'restart', 'metrics-snapshot', 'dcs-update', 'recovery', 'custom']
/** the actions that run on one stack: the target is its name, and a run without one fails */
export const SCHEDULE_STACK_ACTIONS = new Set(['update', 'restart', 'start', 'stop'])

// ---------------------------------------------------------------------------
// Automation rules (/automations)
// ---------------------------------------------------------------------------

export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every minute (* * * * *)', cron: '* * * * *' },
  { label: 'Hourly (0 * * * *)', cron: '0 * * * *' },
  { label: 'Daily at midnight (0 0 * * *)', cron: '0 0 * * *' },
  { label: 'Weekly on Sunday (0 0 * * 0)', cron: '0 0 * * 0' },
  { label: 'Monthly (0 0 1 * *)', cron: '0 0 1 * *' },
]

export const CONDITION_OPTIONS = [
  { value: 'container_unhealthy', label: 'Container unhealthy' },
  { value: 'container_stopped', label: 'Container exited with an error' },
  { value: 'high_cpu', label: 'High CPU usage (≥90%)' },
  { value: 'high_memory', label: 'High memory usage (≥90%)' },
  { value: 'disk_full', label: 'Disk full (≥90%)' },
]
/** the conditions in a sentence ("When a container turns unhealthy") */
const CONDITION_WORDS: Record<string, string> = {
  container_unhealthy: 'When a container turns unhealthy',
  container_stopped: 'When a container exits with an error',
  high_cpu: 'When CPU runs high',
  high_memory: 'When memory runs high',
  disk_full: 'When the disk fills up',
}

export const AUTOMATION_ACTIONS = [
  { value: 'stack_restart', label: 'Restart stack' },
  { value: 'container_restart', label: 'Restart container' },
  { value: 'stack_start', label: 'Start stack' },
  { value: 'stack_stop', label: 'Stop stack' },
  { value: 'docker_prune', label: 'Docker prune' },
  { value: 'backup_trigger', label: 'Start a backup' },
  { value: 'notification_send', label: 'Send notification' },
  { value: 'dcs_update', label: 'DCS self-update' },
  { value: 'recovery_bundle', label: 'Recovery bundle' },
]
const AUTOMATION_ACTION_ICONS: Record<string, LucideIcon> = {
  stack_start: Play, stack_stop: Pause, stack_restart: RefreshCw, container_restart: Box, docker_prune: HardDrive,
  backup_trigger: Archive, notification_send: Bell, dcs_update: ArrowUpCircle, recovery_bundle: LifeBuoy,
}

/** what the target field means for the actions that do not take a stack or a container */
export const AUTOMATION_TARGET_HINTS: Record<string, string> = {
  dcs_update: 'Leave empty, or "images" to pull image updates for every stack as well. Rolls back by itself when the health score drops.',
  recovery_bundle: `No target. Needs the RECOVERY_PASSPHRASE secret (${pageLabel('backup')} page); copies to RECOVERY_REMOTE when set.`,
  notification_send: 'The text of the notification.',
}
export const AUTOMATION_TARGET_PLACEHOLDERS: Record<string, string> = {
  dcs_update: 'Leave empty, or "images"',
  recovery_bundle: 'No target',
  notification_send: 'The message',
}

/** the conditions a rule may set its own threshold for (a percentage); the others are yes-or-no */
export const THRESHOLD_CONDITIONS = new Set(['high_cpu', 'high_memory', 'disk_full'])
/** the engine's own defaults, shown as placeholders (its cooldown is 900 s) */
export const DEFAULT_THRESHOLD = 90
export const DEFAULT_COOLDOWN_MIN = 15

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const pad = (n: number) => String(n).padStart(2, '0')
const isNum = (s: string) => /^\d+$/.test(s)

/** a cron expression in words for the common shapes; null when it is anything else (the row shows the expression) */
export function cronInWords(expr: string): string | null {
  const preset = SCHEDULE_PRESETS.find((p) => p.value === expr)
  if (preset) return preset.label
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [mi, h, dom, mon, dow] = f
  if (mon !== '*') return null
  if (f.every((x) => x === '*')) return 'Every minute'
  const step = /^\*\/(\d+)$/
  if (step.test(mi) && h === '*' && dom === '*' && dow === '*') return `Every ${mi.match(step)![1]} minutes`
  if (isNum(mi) && h === '*' && dom === '*' && dow === '*') return mi === '0' ? 'Every hour' : `Every hour at :${pad(Number(mi))}`
  if (isNum(mi) && step.test(h) && dom === '*' && dow === '*') return `Every ${h.match(step)![1]} hours`
  if (!isNum(mi) || !isNum(h)) return null
  const at = `${pad(Number(h))}:${pad(Number(mi))}`
  if (dom === '*' && dow === '*') return `Every day at ${at}`
  if (dom === '*' && isNum(dow) && Number(dow) <= 7) return `Every ${DAYS[Number(dow)]} at ${at}`
  if (isNum(dom) && dow === '*') return `Monthly on day ${dom} at ${at}`
  return null
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return 'Never'
  if (diff < 0) return 'Just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function automationActionLabel(type: string): string {
  return AUTOMATION_ACTIONS.find((a) => a.value === type)?.label ?? type
}

// ---------------------------------------------------------------------------
// The one list
// ---------------------------------------------------------------------------

export function fromSchedule(s: Schedule): UnifiedRule {
  const expr = s.schedule || s.cron || ''
  const words = cronInWords(expr)
  return {
    key: `s:${s.member ?? 'here'}:${s.id}`,
    kind: 'timed',
    id: s.id,
    name: s.name,
    enabled: !!s.enabled,
    member: s.member, member_name: s.member_name, vmid: s.vmid,
    lastRun: s.last_run ?? null,
    runCount: s.run_count ?? 0,
    when: words ?? (expr || '—'),
    whenCode: words && !expr.startsWith('@') ? expr : undefined,
    actionLabel: SCHEDULE_ACTION_LABELS[s.action] || s.action,
    actionIcon: SCHEDULE_ACTION_ICONS[s.action] || Play,
    target: s.target || '',
    src: { type: 'schedule', item: s },
  }
}

export function fromAutomation(r: AutomationRule): UnifiedRule {
  const timed = r.trigger_type === 'schedule'
  const words = timed ? cronInWords(r.trigger_value) : null
  const tuning = !timed && (r.threshold != null || r.cooldown != null)
    ? [r.threshold != null ? `${r.threshold}%` : null, r.cooldown != null ? `${Math.round(r.cooldown / 60)} min cooldown` : null].filter(Boolean).join(' · ')
    : undefined
  return {
    key: `a:${r.member ?? 'here'}:${r.id}`,
    kind: timed ? 'timed' : 'condition',
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    member: r.member, member_name: r.member_name, vmid: r.vmid,
    lastRun: r.last_run ?? null,
    runCount: r.run_count ?? 0,
    when: timed ? (words ?? r.trigger_value) : (CONDITION_WORDS[r.trigger_value] ?? r.trigger_value),
    whenCode: timed && words ? r.trigger_value : undefined,
    actionLabel: automationActionLabel(r.action_type),
    actionIcon: AUTOMATION_ACTION_ICONS[r.action_type] || Zap,
    target: automationTarget(r),
    tuning,
    src: { type: 'automation', item: r },
  }
}

/** where an automation's action lands, in words: a name, every one, or the notification's text */
function automationTarget(r: AutomationRule): string {
  const t = r.action_target && r.action_target !== '*' ? r.action_target : ''
  if (r.action_type === 'notification_send') return t ? `“${t}”` : ''
  if (r.action_type === 'recovery_bundle' || r.action_type === 'dcs_update' || r.action_type === 'backup_trigger' || r.action_type === 'docker_prune') return t
  if (t) return t
  return r.trigger_type === 'condition' && r.action_type === 'container_restart' ? 'the matching containers' : 'all'
}

/** active first, then by name */
export function sortRules(rules: UnifiedRule[]): UnifiedRule[] {
  return [...rules].sort((a, b) => (a.enabled === b.enabled ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.enabled ? -1 : 1))
}

/** the shared look of the dialogs' fields */
export const FIELD = 'w-full h-11 px-3 rounded-xl bg-white/5 text-sm text-slate-200 placeholder-slate-500 border border-white/10 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40'
