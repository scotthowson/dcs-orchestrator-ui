// =============================================================================
// TypedConfirmDialog — the question behind a restore: an action that overwrites
// the server's configuration is not confirmed by a click but by typing a word.
// One dialog for the Backup and the Snapshots page, so both ask the same way:
// a warning, what is being restored, the word to type, Cancel and the action.
//
//   <TypedConfirmDialog
//     title="Confirm restore" word="RESTORE" confirmLabel="Restore backup"
//     warning="This will overwrite the configuration and data files."
//     detail="This action cannot be undone." subjectLabel="Restoring from"
//     subject={<>…the archive…</>} busy={restoring} onConfirm={run} onClose={close} />
//
// It is a modal dialog (focus goes to the field, Tab stays inside, Escape and a
// click outside close it — unless it is busy — and focus returns to the button
// that opened it, hooks/useModalA11y through ModalOverlay).
// =============================================================================

import { useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react'
import ModalOverlay from '../common/ModalOverlay'
import { BTN_ICON_SM, BTN_SHEET_DANGER, BTN_SHEET_QUIET, TONE_GHOST } from '../../lib/ui'

import CloseButton from '../common/CloseButton'
export default function TypedConfirmDialog({ title, word, confirmLabel, warning, detail, subjectLabel, subject, busy = false, onConfirm, onClose }: {
  title: string
  /** what has to be typed */
  word: string
  confirmLabel: string
  warning: ReactNode
  detail?: ReactNode
  subjectLabel: string
  subject: ReactNode
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const fieldId = useId()
  const close = () => { if (!busy) onClose() }
  return createPortal(
    <ModalOverlay onClose={close} className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto glass rounded-2xl border border-white/10 shadow-2xl shadow-black/60 animate-scale-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-rose-500/15" aria-hidden>
              <AlertTriangle size={18} className="text-rose-400" />
            </div>
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          </div>
          <CloseButton onClick={close} disabled={busy} />
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-4">
            <p className="text-sm text-rose-300 font-medium">{warning}</p>
            {detail && <p className="text-xs text-rose-400/70 mt-1.5">{detail}</p>}
          </div>

          <div className="glass border border-white/5 rounded-lg p-3.5">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">{subjectLabel}</p>
            {subject}
          </div>

          <div>
            <label htmlFor={fieldId} className="block text-xs font-medium text-slate-400 mb-2">
              Type <code className="font-mono bg-white/[0.06] px-1.5 py-0.5 rounded text-rose-400">{word}</code> to confirm
            </label>
            <input
              id={fieldId}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed === word && !busy) onConfirm() }}
              placeholder={word}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="w-full h-11 px-3 rounded-xl text-sm font-mono bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 transition-colors focus:outline-none focus-visible:border-rose-500/40 focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-50"
              autoFocus
            />
          </div>
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-white/5">
          <button type="button" onClick={close} disabled={busy} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={typed !== word || busy} className={`${BTN_SHEET_DANGER} flex-1 disabled:cursor-not-allowed`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
