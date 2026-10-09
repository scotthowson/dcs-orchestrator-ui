// =============================================================================
// ScheduleDialog — a timed rule that runs one DCS task (a backup, a prune, an
// update…) on a preset clock: create one or edit one. Saves to /schedules.
// =============================================================================

import { useId } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Pencil, X, Loader2, CheckCircle } from 'lucide-react'
import ModalOverlay from '../common/ModalOverlay'
import { BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_GHOST } from '../../lib/ui'
import { SCHEDULE_PRESETS, SCHEDULE_ACTIONS, SCHEDULE_ACTION_LABELS, SCHEDULE_TARGET_HINTS, SCHEDULE_STACK_ACTIONS, cronInWords } from './model'
import { INPUT } from '../../lib/fieldStyles'
export type ScheduleFormState = { name: string; schedule: string; action: string; target: string }
export const EMPTY_SCHEDULE_FORM: ScheduleFormState = { name: '', schedule: '@daily', action: 'backup', target: '' }

export default function ScheduleDialog({ mode, form, setForm, saving, onSubmit, onClose }: {
  mode: 'create' | 'edit'
  form: ScheduleFormState
  setForm: (f: ScheduleFormState) => void
  saving: boolean
  onSubmit: () => void
  onClose: () => void
}) {
  const uid = useId()
  const needsTarget = SCHEDULE_STACK_ACTIONS.has(form.action)
  // a rule set to an expression of its own (through the API) keeps it: it is offered beside the presets
  const custom = form.schedule && !SCHEDULE_PRESETS.some((o) => o.value === form.schedule) ? form.schedule : null
  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="glass rounded-2xl p-6 w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto border border-white/10 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" aria-hidden>
              {mode === 'create' ? <Plus size={16} className="text-slate-300" /> : <Pencil size={14} className="text-slate-300" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">{mode === 'create' ? 'New timed rule' : 'Edit timed rule'}</h2>
              <p className="text-[11px] text-slate-500">Runs a DCS task at a time</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="space-y-4">
          <div>
            <label htmlFor={`${uid}-name`} className="block text-xs font-medium text-slate-400 mb-1.5">Name</label>
            <input id={`${uid}-name`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Daily backup" autoComplete="off" className={INPUT} autoFocus />
          </div>
          <div>
            <label htmlFor={`${uid}-schedule`} className="block text-xs font-medium text-slate-400 mb-1.5">When</label>
            <select id={`${uid}-schedule`} value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} className={INPUT}>
              {SCHEDULE_PRESETS.map((o) => <option key={o.value} value={o.value} className="bg-slate-900">{o.label}</option>)}
              {custom && <option value={custom} className="bg-slate-900">{cronInWords(custom) ?? custom} ({custom})</option>}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-action`} className="block text-xs font-medium text-slate-400 mb-1.5">Action</label>
            <select id={`${uid}-action`} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className={INPUT}>
              {SCHEDULE_ACTIONS.map((a) => <option key={a} value={a} className="bg-slate-900">{SCHEDULE_ACTION_LABELS[a] || a}</option>)}
            </select>
            {SCHEDULE_TARGET_HINTS[form.action] && (
              <p className="text-[10px] text-slate-500 mt-1.5">{SCHEDULE_TARGET_HINTS[form.action]}</p>
            )}
          </div>
          <div>
            <label htmlFor={`${uid}-target`} className="block text-xs font-medium text-slate-400 mb-1.5">
              Target {needsTarget ? <span className="text-rose-400" title="Required">*</span> : <span className="text-slate-500">(optional)</span>}
            </label>
            <input
              id={`${uid}-target`}
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder={form.action === 'custom' ? '/path/to/script.sh' : needsTarget ? 'Stack name, e.g. media-services' : 'Leave empty for all'}
              autoComplete="off"
              className={INPUT}
            />
            {form.action === 'custom' && <p className="text-[10px] text-slate-500 mt-1">Path to an executable script on the server</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
            <button type="submit" disabled={saving || !form.name} className={`${BTN_SHEET_PRIMARY} flex-1`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : mode === 'create' ? <Plus size={14} /> : <CheckCircle size={14} />} {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
