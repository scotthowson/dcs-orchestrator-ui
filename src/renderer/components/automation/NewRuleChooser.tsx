// =============================================================================
// NewRuleChooser — the first question of New rule: at a time, or when
// something happens. Each answer opens its own dialog; a quieter third line
// keeps the cron-expression rule with the condition rules' actions.
// =============================================================================

import { createPortal } from 'react-dom'
import { CalendarClock, Radar, ChevronRight, Code2 } from 'lucide-react'
import ModalOverlay from '../common/ModalOverlay'
import CloseButton from '../common/CloseButton'
export type NewRuleChoice = 'timed' | 'condition' | 'cron'

const OPTION = 'w-full flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.06] hover:border-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'

export default function NewRuleChooser({ where, onPick, onClose }: {
  /** where the rule will live, in words ("the hub", "media-vm") */
  where: string | null
  onPick: (c: NewRuleChoice) => void
  onClose: () => void
}) {
  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4" onClick={onClose}>
      <div className="w-full max-w-md glass border border-white/10 rounded-2xl shadow-2xl shadow-black/40 animate-scale-in p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-100">New rule</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">When should it run{where ? ` on ${where}` : ''}?</p>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="space-y-2.5">
          <button type="button" onClick={() => onPick('timed')} className={OPTION}>
            <span className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0" aria-hidden><CalendarClock size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-100">At a time</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">Every hour, every night, every week: a backup, a prune, image updates, a health check, a stack restart.</span>
            </span>
            <ChevronRight size={16} className="text-slate-500 shrink-0 self-center" aria-hidden />
          </button>
          <button type="button" onClick={() => onPick('condition')} className={OPTION}>
            <span className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0" aria-hidden><Radar size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-100">When something happens</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">A container turns unhealthy or exits, CPU or memory runs high, the disk fills up: restart it, prune, back up, send a notification.</span>
            </span>
            <ChevronRight size={16} className="text-slate-500 shrink-0 self-center" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onPick('cron')}
          className="mt-3 w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <Code2 size={13} className="shrink-0" aria-hidden />
          <span className="flex-1">At a time written as a cron expression, with a notification or a container restart</span>
          <ChevronRight size={13} className="shrink-0" aria-hidden />
        </button>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
