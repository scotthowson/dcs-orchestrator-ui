// =============================================================================
// ConfirmDialog — the one "are you sure?" every page asks with, in place of
// window.confirm: useConfirm() gives a confirm(opts) that resolves true when
// the person agrees; <ConfirmDialogHost/> (mounted once in App) draws it.
//
// For the keyboard it is an alert dialog: focus goes to Cancel when the action
// is destructive (Enter must not delete) and to the confirm button otherwise,
// Tab stays inside, Escape says no, and focus returns to what asked
// (hooks/useModalA11y).
// =============================================================================

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { AlertTriangle, HelpCircle } from 'lucide-react'
import { useModalA11y } from '../../hooks/useModalA11y'
import { TONE_TILE } from '../../lib/tone'
import { BTN_SHEET_DANGER, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, TITLE_DIALOG } from '../../lib/ui'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** a destructive action: rose accents on the icon and the confirm button */
  danger?: boolean
}

interface PendingConfirm extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  pending: PendingConfirm | null
  ask: (opts: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

let nextId = 0

const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask: (opts) =>
    new Promise<boolean>((resolve) => {
      // a second question while one is open answers the first with "no"
      get().pending?.resolve(false)
      set({ pending: { ...opts, id: ++nextId, resolve } })
    }),
  settle: (ok) => {
    const p = get().pending
    if (!p) return
    set({ pending: null })
    p.resolve(ok)
  },
}))

/** Ask before a destructive or surprising action; resolves true when the person confirms, false on cancel, Escape or a backdrop click */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return useConfirmStore((s) => s.ask)
}

/** The dialog every confirm() renders in; mount it once, near the toasts */
export function ConfirmDialogHost() {
  const pending = useConfirmStore((s) => s.pending)
  const settle = useConfirmStore((s) => s.settle)
  if (!pending) return null
  // one panel per question, so each takes the focus and gives it back on its own
  return createPortal(<ConfirmPanel key={pending.id} pending={pending} settle={settle} />, document.body)
}

function ConfirmPanel({ pending, settle }: { pending: PendingConfirm; settle: (ok: boolean) => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const danger = !!pending.danger
  useModalA11y(panelRef, () => settle(false), { initialFocus: danger ? cancelRef : confirmRef })

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => settle(false)}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className={`glass rounded-2xl p-6 w-full max-w-sm mx-4 border animate-scale-in ${danger ? 'border-rose-500/20' : 'border-white/10'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div aria-hidden className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONE_TILE[danger ? 'problem' : 'attention']}`}>
            {danger ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
          </div>
          <h3 id="confirm-dialog-title" className={`${TITLE_DIALOG} pt-2 leading-6 break-words min-w-0`}>{pending.title}</h3>
        </div>
        <p id="confirm-dialog-message" className="text-sm leading-relaxed text-slate-300 mb-6 whitespace-pre-line break-words">{pending.message}</p>
        <div className="flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => settle(false)}
            className={`flex-1 ${BTN_SHEET_QUIET}`}
          >
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => settle(true)}
            className={`flex-1 ${danger ? BTN_SHEET_DANGER : BTN_SHEET_PRIMARY}`}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
