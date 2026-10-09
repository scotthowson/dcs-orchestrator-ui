// =============================================================================
// QuickActions — the dashboard's shortcut tiles, composed by the user
// =============================================================================
// Pages, links, stack and container controls, maintenance jobs, schedules and
// automations. The list lives in the dashboard layout (per user) and is edited
// in place; the defaults are the shortcuts the card always had.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { Rocket, Zap, Settings2, Plus, ArrowUp, ArrowDown, Trash2, Loader2, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { useStackStore } from '../../stores/stackStore'
import { useContainerStore } from '../../stores/containerStore'
import { useHealthStore } from '../../stores/healthStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import {
  runImagePrune, triggerLogRotate, fetchHealthReport, triggerBackup,
  startStack, stopStack, restartStack, updateStack,
  startContainer, stopContainer, restartContainer, recreateContainer,
  fetchSchedules, runSchedule, fetchAutomations, runAutomation,
} from '../../api/endpoints'
import type { PageId } from '../../../shared/types'
import { ADMIN_ONLY_PAGES } from '../../../shared/types'
import { pageLabel, pageTitles } from '../../constants/pageTitles'
import { activityOutcome, opGerund, startedInBackground, waitForStackActivity, type StackOp } from '../../lib/stackActivity'
import { Card, CardBody, ACCENTS, ACCENT_NAMES, type CardCommonProps } from './cardShared'
import ModalOverlay from '../common/ModalOverlay'
import Hint from '../common/Hint'
import { BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, BTN_TOOLBAR_QUIET, TONE_GHOST, TONE_GHOST_DANGER, TONE_OK } from '../../lib/ui'

import { EmptyState } from '../common/PageState'
import { Pill } from '../common/Pill'
import CloseButton from '../common/CloseButton'
export type ActionKind = 'page' | 'url' | 'stack' | 'container' | 'maintenance' | 'schedule' | 'automation'
export interface ActionDef {
  id: string
  kind: ActionKind
  label: string
  icon: string
  color: string
  /** page id, URL, stack name, container name, maintenance job, schedule id or automation id */
  target: string
  /** stack: start|stop|restart|update — container: start|stop|restart|recreate */
  op?: string
}

const KIND_LABEL: Record<ActionKind, string> = {
  page: 'Open a page', url: 'Open a link', stack: 'Stack control', container: 'Container control',
  maintenance: 'Maintenance job', schedule: 'Run a schedule', automation: 'Run an automation',
}
// (a shortcut is slate unless its colour means something: rose for the one that deletes)
const MAINTENANCE_JOBS: { id: string; label: string; icon: string; color: string }[] = [
  { id: 'prune-images', label: 'Prune images', icon: 'Trash2', color: 'rose' },
  { id: 'rotate-logs', label: 'Rotate logs', icon: 'Archive', color: 'slate' },
  { id: 'check-health', label: 'Check health', icon: 'HeartPulse', color: 'slate' },
  { id: 'run-backup', label: 'Run backup', icon: 'Download', color: 'slate' },
]
const ICON_CHOICES = ['Layers', 'HeartPulse', 'ScrollText', 'Monitor', 'Settings2', 'Box', 'TerminalSquare', 'Wrench', 'Archive', 'Trash2', 'Download', 'ListChecks', 'ArrowUpCircle', 'Zap', 'Play', 'Square', 'RotateCw', 'RefreshCw', 'Globe', 'Link', 'Rocket', 'Bell', 'Clock', 'Shield', 'Database', 'FolderOpen', 'Image', 'Network', 'HardDrive', 'Activity', 'Bookmark', 'Star', 'Cloud', 'Server', 'Cpu', 'Key']
const STACK_OPS = ['start', 'stop', 'restart', 'update']
const CONTAINER_OPS = ['start', 'stop', 'restart', 'recreate']

export const DEFAULT_ACTIONS: ActionDef[] = [
  { id: 'stacks', kind: 'page', label: pageLabel('stacks'), icon: 'Layers', color: 'slate', target: 'stacks' },
  { id: 'health', kind: 'page', label: pageLabel('health'), icon: 'HeartPulse', color: 'slate', target: 'health' },
  { id: 'logs', kind: 'page', label: pageLabel('logs'), icon: 'ScrollText', color: 'slate', target: 'logs' },
  { id: 'system', kind: 'page', label: pageLabel('system'), icon: 'Monitor', color: 'slate', target: 'system' },
  { id: 'config', kind: 'page', label: pageLabel('config'), icon: 'Settings2', color: 'slate', target: 'config' },
  { id: 'containers', kind: 'page', label: pageLabel('containers'), icon: 'Box', color: 'slate', target: 'containers' },
  { id: 'terminal', kind: 'page', label: pageLabel('terminal'), icon: 'TerminalSquare', color: 'slate', target: 'terminal' },
  { id: 'maintenance', kind: 'page', label: pageLabel('maintenance'), icon: 'Wrench', color: 'slate', target: 'maintenance' },
  { id: 'backup', kind: 'page', label: pageLabel('backup'), icon: 'Archive', color: 'slate', target: 'backup' },
  { id: 'prune-images', kind: 'maintenance', label: 'Prune images', icon: 'Trash2', color: 'rose', target: 'prune-images' },
  { id: 'rotate-logs', kind: 'maintenance', label: 'Rotate logs', icon: 'Archive', color: 'slate', target: 'rotate-logs' },
  { id: 'check-health', kind: 'maintenance', label: 'Check health', icon: 'HeartPulse', color: 'slate', target: 'check-health' },
  { id: 'run-backup', kind: 'maintenance', label: 'Run backup', icon: 'Download', color: 'slate', target: 'run-backup' },
  { id: 'check-updates', kind: 'page', label: pageLabel('updates'), icon: 'ArrowUpCircle', color: 'slate', target: 'updates' },
]

function iconFor(name: string): React.ElementType {
  return ((Icons as unknown as Record<string, React.ElementType>)[name] ?? Zap) as React.ElementType
}
function newId(): string { return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }
function sanitize(list: unknown): ActionDef[] | null {
  if (!Array.isArray(list)) return null
  const out: ActionDef[] = []
  for (const a of list) {
    if (!a || typeof a !== 'object') continue
    const d = a as Partial<ActionDef>
    if (!d.kind || !(d.kind in KIND_LABEL) || typeof d.label !== 'string' || typeof d.target !== 'string') continue
    out.push({ id: typeof d.id === 'string' ? d.id : newId(), kind: d.kind, label: d.label, icon: typeof d.icon === 'string' ? d.icon : 'Zap', color: ACCENT_NAMES.includes(d.color || '') ? (d.color as string) : 'cyan', target: d.target, op: typeof d.op === 'string' ? d.op : undefined })
  }
  return out
}

export default function QuickActions({ cardConfig, onSaveConfig, dashboardEditMode }: CardCommonProps) {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const isConnected = useConnectionStore((s) => s.status) === 'connected'
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const setHealthReport = useHealthStore((s) => s.setReport)
  const refreshContainers = useContainerStore((s) => s.refresh)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const actions = useMemo(() => {
    const cfg = cardConfig as { actions?: unknown } | undefined
    return sanitize(cfg?.actions) ?? DEFAULT_ACTIONS
  }, [cardConfig])
  const isCustom = !!sanitize((cardConfig as { actions?: unknown } | undefined)?.actions)

  const run = useCallback(async (a: ActionDef) => {
    if (a.kind === 'page') { setCurrentPage(a.target as PageId); return }
    if (a.kind === 'url') { if (/^https?:\/\//i.test(a.target)) window.open(a.target, '_blank', 'noopener'); return }
    if (!isConnected || loadingAction) return
    const needsConfirm = (a.kind === 'stack' && a.op !== 'start') || (a.kind === 'container' && a.op !== 'start') || (a.kind === 'maintenance' && a.target !== 'check-health')
    if (needsConfirm && !(await confirm({ title: a.label, message: `${a.label}: run this now?`, confirmLabel: 'Run now', danger: a.op === 'stop' }))) return
    setLoadingAction(a.id)
    try {
      if (a.kind === 'maintenance') {
        if (a.target === 'prune-images') { const r = await runImagePrune(); addToast({ type: r.success ? 'success' : 'error', message: r.success ? 'Stale images pruned' : 'Image prune failed' }) }
        else if (a.target === 'rotate-logs') { const r = await triggerLogRotate(); addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Logs rotated${r.archived_as ? ` — archived as ${r.archived_as}` : ''}` : 'Log rotation failed' }) }
        else if (a.target === 'check-health') { const rep = await fetchHealthReport(); setHealthReport(rep); const n = rep.summary?.unhealthy ?? 0; addToast({ type: n > 0 ? 'warning' : 'success', message: n > 0 ? `${n} container${n === 1 ? '' : 's'} need attention` : 'Everything is healthy' }) }
        else if (a.target === 'run-backup') { const r = await triggerBackup(); addToast({ type: r.success ? 'success' : 'error', message: r.success ? 'Backup started' : (r.message || 'Backup failed') }) }
      } else if (a.kind === 'stack') {
        const op: StackOp = STACK_OPS.includes(a.op || '') ? (a.op as StackOp) : 'start'
        const fn = { start: startStack, stop: stopStack, restart: restartStack, update: updateStack }[op]
        const r = await fn(a.target)
        if (r.success && startedInBackground((r as { output?: string }).output)) {
          // the API answered before anything ran: follow the stack's activity, then say how it ended
          addToast({ type: 'info', message: `${a.target}: ${opGerund(op).toLowerCase()}…`, duration: 4000 })
          void refreshContainers()
          addToast(activityOutcome(await waitForStackActivity(a.target), a.target, op))
        } else {
          addToast({ type: r.success ? 'success' : 'error', message: r.success ? `${a.target}: ${op} done` : `${a.target}: ${op} failed` })
        }
        void refreshContainers()
      } else if (a.kind === 'container') {
        const fn = { start: startContainer, stop: stopContainer, restart: restartContainer, recreate: recreateContainer }[a.op || 'start'] ?? startContainer
        const r = await fn(a.target)
        addToast({ type: r.success ? 'success' : 'error', message: r.success ? `${a.target}: ${a.op || 'start'} done` : `${a.target}: ${r.output || 'failed'}`, duration: r.success ? 3500 : 8000 })
        void refreshContainers()
      } else if (a.kind === 'schedule') {
        const r = await runSchedule(a.target)
        addToast({ type: r.success ? 'success' : 'error', message: r.success ? `${a.label} ran` : `${a.label} failed: ${r.output || ''}` })
      } else if (a.kind === 'automation') {
        const r = await runAutomation(a.target)
        addToast({ type: r.success ? 'success' : 'error', message: r.message || (r.success ? `${a.label} ran` : `${a.label} failed`) })
      }
    } catch (err) {
      addToast({ type: 'error', message: `${a.label}: ${err instanceof Error ? err.message : 'request failed'}` })
    } finally {
      setLoadingAction(null)
    }
  }, [setCurrentPage, isConnected, loadingAction, addToast, setHealthReport, refreshContainers, confirm])

  const visible = actions.filter((a) => {
    if (a.kind === 'page' && ADMIN_ONLY_PAGES.has(a.target as PageId) && !isAdmin) return false
    if ((a.kind === 'stack' || a.kind === 'container' || a.kind === 'maintenance' || a.kind === 'schedule' || a.kind === 'automation') && !isAdmin) return false
    return true
  })
  const canEdit = !!onSaveConfig && !dashboardEditMode

  return (
    <Card
      card="quick-actions"
      badge={isCustom ? <Pill tone="neutral">custom</Pill> : undefined}
      actions={canEdit ? (
        <Hint label="Customize the actions">
          <button type="button" aria-label="Customize the actions" onClick={() => setEditing(true)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><Settings2 size={12} /></button>
        </Hint>
      ) : undefined}
    >
      {visible.length === 0 ? (
        <EmptyState card
          icon={<Rocket size={22} />}
          title="No actions"
          hint="Add the shortcuts you use most."
          action={canEdit ? <button type="button" onClick={() => setEditing(true)} className={`${BTN_CARD} ${TONE_OK}`}>Add actions</button> : undefined}
        />
      ) : (
        <CardBody className="grid gap-1.5 content-start [grid-template-columns:repeat(auto-fill,minmax(118px,1fr))]">
          {visible.map((a) => {
            const acc = ACCENTS[a.color] ?? ACCENTS.cyan
            const Icon = iconFor(a.icon)
            const busy = loadingAction === a.id
            const disabled = (a.kind !== 'page' && a.kind !== 'url') && (!isConnected || !!loadingAction)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => run(a)}
                disabled={disabled}
                className="group flex items-center gap-2 rounded-lg px-2.5 py-2 border border-white/5 bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/10 text-left transition-all disabled:opacity-40 press"
                title={a.kind === 'url' ? a.target : undefined}
              >
                <span className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 ${acc.bg} ${acc.text}`}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-slate-200 truncate">{a.label}</span>
                  {(a.kind === 'stack' || a.kind === 'container') && <span className="block text-[10px] text-slate-500 truncate">{a.op || 'start'} · {a.target}</span>}
                </span>
              </button>
            )
          })}
        </CardBody>
      )}
      {editing && <ActionsEditor initial={actions} isAdmin={isAdmin} onClose={() => setEditing(false)} onSave={async (list) => { await onSaveConfig?.({ actions: list }); setEditing(false); addToast({ type: 'success', message: 'Quick actions saved' }) }} onReset={async () => { await onSaveConfig?.({}); setEditing(false); addToast({ type: 'success', message: 'Quick actions reset to the defaults' }) }} />}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function ActionsEditor({ initial, isAdmin, onClose, onSave, onReset }: {
  initial: ActionDef[]
  isAdmin: boolean
  onClose: () => void
  onSave: (list: ActionDef[]) => Promise<void> | void
  onReset: () => Promise<void> | void
}) {
  const [list, setList] = useState<ActionDef[]>(initial.map((a) => ({ ...a })))
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const stacks = useStackStore((s) => s.stacks)
  const containers = useContainerStore((s) => s.containers)
  const [schedules, setSchedules] = useState<{ id: string; name: string }[]>([])
  const [automations, setAutomations] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!isAdmin) return
    fetchSchedules().then((r) => setSchedules((r.schedules ?? []).map((s) => ({ id: s.id, name: s.name })))).catch(() => {})
    fetchAutomations().then((r) => setAutomations((r.automations ?? []).map((a) => ({ id: a.id, name: a.name })))).catch(() => {})
  }, [isAdmin])

  const update = (id: string, patch: Partial<ActionDef>) => setList((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  const move = (i: number, dir: -1 | 1) => setList((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n })
  const add = (kind: ActionKind) => {
    const base: ActionDef = { id: newId(), kind, label: KIND_LABEL[kind], icon: 'Zap', color: 'slate', target: '' }
    if (kind === 'page') Object.assign(base, { label: pageLabel('dashboard'), target: 'dashboard', icon: 'LayoutDashboard' })
    if (kind === 'url') Object.assign(base, { label: 'My link', target: 'https://', icon: 'Link' })
    if (kind === 'stack') Object.assign(base, { label: stacks[0] ? `Restart ${stacks[0].name}` : 'Restart stack', target: stacks[0]?.name ?? '', op: 'restart', icon: 'RotateCw' })
    if (kind === 'container') Object.assign(base, { label: containers[0] ? `Restart ${containers[0].name}` : 'Restart container', target: containers[0]?.name ?? '', op: 'restart', icon: 'RotateCw' })
    if (kind === 'maintenance') Object.assign(base, { label: MAINTENANCE_JOBS[0].label, target: MAINTENANCE_JOBS[0].id, icon: MAINTENANCE_JOBS[0].icon, color: MAINTENANCE_JOBS[0].color })
    if (kind === 'schedule') Object.assign(base, { label: schedules[0]?.name ?? 'Schedule', target: schedules[0]?.id ?? '', icon: 'Clock' })
    if (kind === 'automation') Object.assign(base, { label: automations[0]?.name ?? 'Automation', target: automations[0]?.id ?? '', icon: 'Bot' })
    setList((l) => [...l, base])
    setAdding(false)
  }
  const valid = list.every((a) => a.label.trim() && a.target.trim())
  const kinds: ActionKind[] = isAdmin ? ['page', 'url', 'stack', 'container', 'maintenance', 'schedule', 'automation'] : ['page', 'url']
  const field = 'px-2 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30'

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl mx-4 max-h-[88vh] flex flex-col bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5 border border-white/10"><Rocket size={16} className="text-slate-300" aria-hidden /></span>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Quick actions</h3>
              <p className="text-[11px] text-slate-500">Your shortcuts, in your order. Saved to your dashboard.</p>
            </div>
          </div>
          <Hint label="Close"><CloseButton onClick={onClose} /></Hint>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-6 py-4 space-y-2">
          {list.length === 0 && <p className="text-xs text-slate-500 text-center py-6">No actions yet — add one below.</p>}
          {list.map((a, i) => {
            const acc = ACCENTS[a.color] ?? ACCENTS.cyan
            const Icon = iconFor(a.icon)
            return (
              <div key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 ${acc.bg} ${acc.text}`}><Icon size={14} /></span>
                  <input aria-label="Label" value={a.label} onChange={(e) => update(a.id, { label: e.target.value })} placeholder="Label" className={`${field} flex-1 min-w-0`} />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0 hidden sm:inline">{KIND_LABEL[a.kind]}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Hint label="Move up"><button type="button" aria-label={`Move ${a.label} up`} onClick={() => move(i, -1)} disabled={i === 0} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><ArrowUp size={12} /></button></Hint>
                    <Hint label="Move down"><button type="button" aria-label={`Move ${a.label} down`} onClick={() => move(i, 1)} disabled={i === list.length - 1} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><ArrowDown size={12} /></button></Hint>
                    <Hint label="Remove"><button type="button" aria-label={`Remove ${a.label}`} onClick={() => setList((l) => l.filter((x) => x.id !== a.id))} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}><Trash2 size={12} /></button></Hint>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.kind === 'page' && (
                    <select aria-label="Page" value={a.target} onChange={(e) => update(a.id, { target: e.target.value })} className={`${field} bg-slate-800`}>
                      {(Object.keys(pageTitles) as PageId[]).filter((p) => isAdmin || !ADMIN_ONLY_PAGES.has(p)).map((p) => <option key={p} value={p}>{pageTitles[p]}</option>)}
                    </select>
                  )}
                  {a.kind === 'url' && <input aria-label="Link" value={a.target} onChange={(e) => update(a.id, { target: e.target.value })} placeholder="https://…" spellCheck={false} className={`${field} flex-1 min-w-[12rem] font-mono`} />}
                  {a.kind === 'stack' && (
                    <>
                      <select aria-label="Stack action" value={a.op || 'start'} onChange={(e) => update(a.id, { op: e.target.value })} className={`${field} bg-slate-800`}>{STACK_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      <select aria-label="Stack" value={a.target} onChange={(e) => update(a.id, { target: e.target.value })} className={`${field} bg-slate-800 font-mono`}>
                        {!stacks.some((s) => s.name === a.target) && <option value={a.target}>{a.target || 'choose a stack'}</option>}
                        {stacks.map((s) => <option key={`${s.member ?? ''}|${s.name}`} value={s.name}>{s.name}{s.member_name ? ` · ${s.member_name}` : ''}</option>)}
                      </select>
                    </>
                  )}
                  {a.kind === 'container' && (
                    <>
                      <select aria-label="Container action" value={a.op || 'start'} onChange={(e) => update(a.id, { op: e.target.value })} className={`${field} bg-slate-800`}>{CONTAINER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      <select aria-label="Container" value={a.target} onChange={(e) => update(a.id, { target: e.target.value })} className={`${field} bg-slate-800 font-mono`}>
                        {!containers.some((c) => c.name === a.target) && <option value={a.target}>{a.target || 'choose a container'}</option>}
                        {containers.map((c) => <option key={`${c.member ?? ''}|${c.name}`} value={c.name}>{c.name}{c.member_name ? ` · ${c.member_name}` : ''}</option>)}
                      </select>
                    </>
                  )}
                  {a.kind === 'maintenance' && (
                    <select aria-label="Maintenance job" value={a.target} onChange={(e) => { const job = MAINTENANCE_JOBS.find((j) => j.id === e.target.value); update(a.id, { target: e.target.value, ...(job ? { label: job.label, icon: job.icon, color: job.color } : {}) }) }} className={`${field} bg-slate-800`}>
                      {MAINTENANCE_JOBS.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                    </select>
                  )}
                  {a.kind === 'schedule' && (
                    <select aria-label="Schedule" value={a.target} onChange={(e) => { const s = schedules.find((x) => x.id === e.target.value); update(a.id, { target: e.target.value, ...(s ? { label: s.name } : {}) }) }} className={`${field} bg-slate-800`}>
                      {schedules.length === 0 && <option value="">No schedules yet</option>}
                      {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  {a.kind === 'automation' && (
                    <select aria-label="Automation" value={a.target} onChange={(e) => { const s = automations.find((x) => x.id === e.target.value); update(a.id, { target: e.target.value, ...(s ? { label: s.name } : {}) }) }} className={`${field} bg-slate-800`}>
                      {automations.length === 0 && <option value="">No automations yet</option>}
                      {automations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  <select aria-label="Icon" value={a.icon} onChange={(e) => update(a.id, { icon: e.target.value })} className={`${field} bg-slate-800`}>
                    {!ICON_CHOICES.includes(a.icon) && <option value={a.icon}>{a.icon}</option>}
                    {ICON_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
                    {ACCENT_NAMES.map((c) => (
                      <button key={c} type="button" onClick={() => update(a.id, { color: c })} className={`h-4 w-4 rounded-full ${ACCENTS[c].dot} ${a.color === c ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-slate-900' : 'opacity-60 hover:opacity-100'} transition-all`} aria-label={c} aria-pressed={a.color === c} />
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
          <div className="relative">
            <button type="button" aria-expanded={adding} onClick={() => setAdding((v) => !v)} className={BTN_TOOLBAR_QUIET}><Plus size={14} /> Add action</button>
            {adding && (
              <div className="absolute z-10 mt-1 w-56 rounded-xl bg-slate-900 border border-white/10 shadow-2xl p-1 animate-scale-in">
                {kinds.map((k) => <button key={k} type="button" onClick={() => add(k)} className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-white/5">{KIND_LABEL[k]}</button>)}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-white/5">
          <button type="button" onClick={() => void onReset()} className={BTN_CARD_QUIET}><RotateCcw size={12} /> Reset to defaults</button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className={BTN_SHEET_QUIET}>Cancel</button>
            <button type="button" onClick={async () => { setSaving(true); try { await onSave(list) } finally { setSaving(false) } }} disabled={!valid || saving} className={BTN_SHEET_PRIMARY}>
              {saving && <Loader2 size={16} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
