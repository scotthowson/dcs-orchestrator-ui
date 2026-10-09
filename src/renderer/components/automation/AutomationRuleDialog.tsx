// =============================================================================
// AutomationRuleDialog — a rule that runs an action when something happens on
// the system (a container unhealthy, a disk full), or at a time written as a
// cron expression: create one or edit one. Saves to /automations.
// =============================================================================

import { useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '@mantine/core'
import { Zap, X, Loader2, Pencil, Plus, CalendarClock, AlertTriangle } from 'lucide-react'
import ModalOverlay from '../common/ModalOverlay'
import { useToast } from '../common/Toast'
import { BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_GHOST } from '../../lib/ui'
import { createAutomation, updateAutomation } from '../../api/endpoints'
import type { AutomationRule } from '../../../shared/types'
import {
  CRON_PRESETS, CONDITION_OPTIONS, AUTOMATION_ACTIONS, AUTOMATION_TARGET_HINTS, AUTOMATION_TARGET_PLACEHOLDERS,
  THRESHOLD_CONDITIONS, DEFAULT_THRESHOLD, DEFAULT_COOLDOWN_MIN, cronInWords,
} from './model'

import { INPUT, CAPTION } from '../../lib/fieldStyles'
type Trigger = 'schedule' | 'condition'

export default function AutomationRuleDialog({ editing, startTrigger, member, onSaved, onClose }: {
  /** the rule being edited; null creates one */
  editing: AutomationRule | null
  /** a new rule's trigger (the New rule question picked it) */
  startTrigger: Trigger
  /** the server the rule lives on (null: this one) */
  member: string | null
  onSaved: () => void
  onClose: () => void
}) {
  const uid = useId()
  const { addToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(editing?.name ?? '')
  const [trigger, setTrigger] = useState<Trigger>(editing?.trigger_type ?? startTrigger)
  const [cron, setCron] = useState(editing?.trigger_type === 'schedule' ? (editing.trigger_value || '0 * * * *') : '0 * * * *')
  const [condition, setCondition] = useState(editing?.trigger_type === 'condition' ? (editing.trigger_value || 'container_unhealthy') : 'container_unhealthy')
  const [actionType, setActionType] = useState(editing?.action_type ?? (startTrigger === 'condition' ? 'container_restart' : 'stack_restart'))
  const [actionTarget, setActionTarget] = useState(editing && editing.action_target !== '*' ? editing.action_target : '')
  // condition rules only, both optional: the percentage to reach and the minutes to wait after a fire (the engine keeps seconds)
  const [threshold, setThreshold] = useState(editing?.threshold != null ? String(editing.threshold) : '')
  // (the engine ticks once a minute, so a cooldown set in seconds by hand loses nothing by rounding)
  const [cooldown, setCooldown] = useState(editing?.cooldown != null ? String(Math.round(editing.cooldown / 60)) : '')

  const save = async () => {
    if (!name.trim()) return
    // the two tuning fields: whole numbers (a percentage, minutes); empty leaves the engine's default
    const th = trigger === 'condition' && THRESHOLD_CONDITIONS.has(condition) && threshold.trim() ? Number(threshold) : null
    const cdMin = trigger === 'condition' && cooldown.trim() ? Number(cooldown) : null
    if (th !== null && (!Number.isInteger(th) || th < 1 || th > 100)) { addToast({ type: 'error', message: 'The threshold is a whole number of percent, 1 to 100' }); return }
    if (cdMin !== null && (!Number.isInteger(cdMin) || cdMin < 0)) { addToast({ type: 'error', message: 'The cooldown is a whole number of minutes' }); return }
    setSaving(true)
    try {
      const tuning = { threshold: th, cooldown: cdMin === null ? null : cdMin * 60 }
      const payload = {
        name: name.trim(),
        trigger_type: trigger,
        trigger_value: trigger === 'schedule' ? cron : condition,
        action_type: actionType,
        action_target: actionTarget.trim() || '*',
        ...tuning,
      }
      if (editing) {
        await updateAutomation(editing.id, payload, member)
        addToast({ type: 'success', message: 'Rule updated' })
      } else {
        const created = await createAutomation({ ...payload, enabled: true }, member)
        // POST /automations keeps a fixed set of fields and drops the tuning, while the update merges the whole body:
        // a rule created with a threshold or a cooldown gets them in a second call (skipped once the server keeps them)
        if ((tuning.threshold !== null || tuning.cooldown !== null) && created?.id && created.threshold == null && created.cooldown == null) {
          await updateAutomation(created.id, tuning, member)
        }
        addToast({ type: 'success', message: 'Rule created' })
      }
      onSaved()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save the rule' })
    } finally {
      setSaving(false)
    }
  }

  const title = editing ? 'Edit rule' : trigger === 'condition' ? 'New rule: when something happens' : 'New timed rule (cron)'
  const cronWords = cronInWords(cron)

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <form
        onSubmit={(e) => { e.preventDefault(); save() }}
        className="w-full max-w-lg glass border border-white/10 rounded-2xl shadow-2xl shadow-black/40 flex flex-col animate-scale-in overflow-hidden max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Zap size={16} className="text-slate-400 shrink-0" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-200 truncate">{title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label htmlFor={`${uid}-name`} className={CAPTION}>Rule name</label>
            <input id={`${uid}-name`} type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={trigger === 'condition' ? 'e.g. Restart unhealthy containers' : 'e.g. Nightly prune'} autoComplete="off" className={INPUT} autoFocus />
          </div>

          {/* an existing rule may change what it waits for, as it always could */}
          {editing && (
            <div>
              <span className={CAPTION}>Runs</span>
              <SegmentedControl
                fullWidth
                aria-label="What the rule waits for"
                value={trigger}
                onChange={(v) => setTrigger(v as Trigger)}
                data={[
                  { value: 'condition', label: <span className="flex items-center justify-center gap-1.5 py-0.5"><AlertTriangle size={13} aria-hidden />When something happens</span> },
                  { value: 'schedule', label: <span className="flex items-center justify-center gap-1.5 py-0.5"><CalendarClock size={13} aria-hidden />At a time</span> },
                ]}
              />
            </div>
          )}

          {trigger === 'schedule' && (
            <div>
              <label htmlFor={`${uid}-cron`} className={CAPTION}>Cron expression</label>
              <input id={`${uid}-cron`} type="text" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="* * * * *"
                autoComplete="off" spellCheck={false} className={`${INPUT} font-mono`} />
              <p className="text-[10px] text-slate-500 mt-1 mb-2">{cronWords ? `${cronWords}, in the server's time zone` : 'minute hour day-of-month month day-of-week, in the server\'s time zone'}</p>
              <span className={CAPTION}>Quick presets</span>
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    type="button"
                    aria-pressed={cron === p.cron}
                    onClick={() => setCron(p.cron)}
                    className={`h-8 sm:h-7 px-2.5 rounded-lg text-[11px] font-medium border transition-colors ${
                      cron === p.cron
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-white/[0.03] text-slate-400 border-white/5 hover:bg-white/5 hover:text-slate-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {trigger === 'condition' && (
            <div>
              <label htmlFor={`${uid}-condition`} className={CAPTION}>When</label>
              <select id={`${uid}-condition`} value={condition} onChange={(e) => setCondition(e.target.value)} className={`${INPUT} cursor-pointer`}>
                {CONDITION_OPTIONS.map((c) => <option key={c.value} value={c.value} className="bg-slate-900 text-slate-200">{c.label}</option>)}
              </select>

              {/* the rule's own tuning (optional): the engine's defaults stand where a field is empty */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                {THRESHOLD_CONDITIONS.has(condition) && (
                  <div>
                    <label htmlFor={`${uid}-threshold`} className={CAPTION}>Threshold (%)</label>
                    <input id={`${uid}-threshold`} type="number" inputMode="numeric" min={1} max={100} step={1} value={threshold}
                      onChange={(e) => setThreshold(e.target.value)} placeholder={String(DEFAULT_THRESHOLD)} autoComplete="off" className={INPUT} />
                  </div>
                )}
                <div>
                  <label htmlFor={`${uid}-cooldown`} className={CAPTION}>Cooldown (minutes)</label>
                  <input id={`${uid}-cooldown`} type="number" inputMode="numeric" min={0} step={1} value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)} placeholder={String(DEFAULT_COOLDOWN_MIN)} autoComplete="off" className={INPUT} />
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {THRESHOLD_CONDITIONS.has(condition) ? `Fires at ${threshold.trim() || DEFAULT_THRESHOLD}%, then waits ` : 'After it fired, the rule waits '}
                {cooldown.trim() || DEFAULT_COOLDOWN_MIN} minute{(cooldown.trim() || String(DEFAULT_COOLDOWN_MIN)) === '1' ? '' : 's'} before it can fire again. Checked once a minute.
              </p>
            </div>
          )}

          <div>
            <label htmlFor={`${uid}-action`} className={CAPTION}>Then</label>
            <select id={`${uid}-action`} value={actionType} onChange={(e) => setActionType(e.target.value)} className={`${INPUT} cursor-pointer`}>
              {AUTOMATION_ACTIONS.map((a) => <option key={a.value} value={a.value} className="bg-slate-900 text-slate-200">{a.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-target`} className={CAPTION}>Target</label>
            <input id={`${uid}-target`} type="text" value={actionTarget} onChange={(e) => setActionTarget(e.target.value)}
              placeholder={AUTOMATION_TARGET_PLACEHOLDERS[actionType] ?? 'Stack name, container name, or "*" for all'} autoComplete="off" className={INPUT} />
            <p className="text-[10px] text-slate-500 mt-1">
              {AUTOMATION_TARGET_HINTS[actionType] ?? (trigger === 'condition'
                ? 'Leave empty or use "*": a container action then applies to the containers that matched the condition.'
                : 'Leave empty or use "*" to target all stacks/containers.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-white/5 shrink-0">
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-[9px] font-mono text-slate-400">Esc</kbd> to close
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none sm:px-6`}>Cancel</button>
            <button type="submit" disabled={saving || !name.trim()} className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : (editing ? <Pencil size={14} /> : <Plus size={14} />)}
              {editing ? 'Save changes' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </ModalOverlay>,
    document.body,
  )
}
