// =============================================================================
// Sheet — the one panel a form or a detail opens in: a bottom sheet on a phone,
// a centred dialog above it (or, with placement="side", a panel along the right
// edge that leaves the page visible, for an editor that previews on the page).
// Escape closes it, focus moves in (the first field, else the first control),
// cycles inside and returns to what opened it, and sheets stack: one opened from
// another takes Escape for itself (hooks/useModalA11y).
//
//   <Sheet title="Ban an address" subtitle="…" icon={<Ban size={18} />} tone="problem" onClose={close}
//     footer={<><button className={BTN_SHEET_QUIET}>Cancel</button><button className={BTN_SHEET_PRIMARY}>Ban</button></>}>
//     …the form…
//   </Sheet>
//
//   tone      the icon tile's tone (lib/tone): ok (default), info, attention, problem, fleet (the fleet's sheets)
//   wide      672 px instead of 448 (a table, a preview)
//   footer    the buttons that end the form: they stay in reach under a body that scrolls
//   keepOnBackdrop  a click beside the sheet does not close it (an editor with unsaved work)
// =============================================================================

import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from '../../hooks/useModalA11y'
import CloseButton from './CloseButton'
import { TONE_TILE, type Tone } from '../../lib/tone'

export interface SheetProps {
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  tone?: Tone
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  placement?: 'center' | 'side'
  keepOnBackdrop?: boolean
}

export default function Sheet({ title, subtitle, icon, tone = 'ok', onClose, children, footer, wide = false, placement = 'center', keepOnBackdrop = false }: SheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(panelRef, onClose)
  const side = placement === 'side'
  const frame = side
    ? `w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-xl'} max-h-[92vh] sm:max-h-none sm:h-full flex flex-col bg-slate-900/95 backdrop-blur-2xl border border-white/10 sm:border-y-0 sm:border-r-0 rounded-t-3xl sm:rounded-none sm:rounded-l-2xl shadow-2xl shadow-black/50 animate-slide-up`
    : `w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] flex flex-col glass rounded-t-3xl sm:rounded-2xl animate-slide-up`
  return createPortal(
    <div
      className={`fixed inset-0 flex items-end justify-center ${side ? 'z-[9998] sm:items-stretch sm:justify-end bg-black/30 animate-fade-in' : 'z-[100] sm:items-center bg-black/60 backdrop-blur-sm'}`}
      onClick={keepOnBackdrop ? undefined : onClose}
    >
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={frame} onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" aria-hidden />
          <div className="flex items-start gap-3 mb-4">
            {icon && <div className={`p-2.5 rounded-xl shrink-0 ${TONE_TILE[tone]}`} aria-hidden>{icon}</div>}
            <div className="min-w-0 flex-1">
              <h3 id={titleId} className="text-base font-semibold text-slate-100 break-words">{title}</h3>
              {subtitle && <div className="text-sm text-slate-400 mt-0.5 break-words">{subtitle}</div>}
            </div>
            <CloseButton onClick={onClose} />
          </div>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin px-5 ${footer ? 'pb-4' : 'pb-5'}`}>{children}</div>
        {footer && <div className="shrink-0 px-5 py-4 border-t border-white/10 safe-area-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
