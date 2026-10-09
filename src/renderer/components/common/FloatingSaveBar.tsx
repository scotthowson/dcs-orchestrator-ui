// =============================================================================
// FloatingSaveBar — Reusable floating save indicator with discard/save actions
// =============================================================================
// Shows at bottom of viewport when hasChanges is true. Rendered via createPortal
// to document.body so CSS transforms on parent containers don't break fixed pos.
// =============================================================================

import type React from 'react'
import { Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { BTN_TOOLBAR, TONE_GHOST } from '../../lib/ui'

interface FloatingSaveBarProps {
  hasChanges: boolean
  onSave: () => void
  onDiscard: () => void
  saving?: boolean
  saveLabel?: string
  savingLabel?: string
  message?: string
  discardLabel?: string
  /** Extra control shown next to the message, e.g. an "apply now" checkbox */
  extra?: React.ReactNode
  /** Raise above full-screen editors (their overlays sit at 9999) */
  zIndex?: number
}

export function FloatingSaveBar({
  hasChanges,
  onSave,
  onDiscard,
  saving = false,
  saveLabel = 'Save',
  savingLabel = 'Saving...',
  message = 'You have unsaved changes',
  discardLabel = 'Discard',
  extra,
  zIndex = 100,
}: FloatingSaveBarProps) {
  if (!hasChanges) return null

  return createPortal(
    <div className="fixed bottom-6 inset-x-0 flex justify-center pointer-events-none animate-fade-in-up px-4" style={{ zIndex }}>
      <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-slate-800/95 backdrop-blur-lg border border-white/10 px-5 py-3 shadow-2xl shadow-black/40 pointer-events-auto max-w-full">
        <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-sm text-slate-300">{message}</span>
        {extra}
        <button
          type="button"
          onClick={onDiscard}
          className={`${BTN_TOOLBAR} ${TONE_GHOST} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40`}
        >
          {discardLabel}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`${BTN_TOOLBAR} font-semibold text-white bg-emerald-500 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70`}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? savingLabel : saveLabel}
        </button>
      </div>
    </div>,
    document.body,
  )
}
