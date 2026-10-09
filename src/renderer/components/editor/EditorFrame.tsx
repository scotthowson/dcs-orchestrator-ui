// =============================================================================
// EditorFrame — the window every editor opens in, the same for the stack's
// files, a container's way into them and a template: full screen on a phone, a
// large panel above it; the title and what it edits, the file tabs, the tools
// (always in the order Find · Diff · History · Copy), the ✕; the body; the save
// bar floating over the bottom of the body; a status line under it.
//
// The keys, once for all of them:
//   Ctrl/Cmd+S   onSave (check, then save)
//   Ctrl/Cmd+F   onFind
//   Escape       onEscape first (Find open, a diff shown), else close — asking first when something is unsaved
// A click beside the panel closes it the same way.
// =============================================================================

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useModalA11y } from '../../hooks/useModalA11y'
import { useConfirm } from '../common/ConfirmDialog'
import CloseButton from '../common/CloseButton'
import Hint from '../common/Hint'
import { TONE_TILE, type Tone } from '../../lib/tone'
import { TITLE_DIALOG } from '../../lib/ui'

export interface EditorFrameProps {
  title: string
  /** under the title: the file, the stack, where it was opened from */
  subtitle?: ReactNode
  icon: ReactNode
  tone?: Tone
  /** beside the title (the stack's state) */
  badge?: ReactNode
  tabs?: ReactNode
  tools?: ReactNode
  /** something is unsaved (closing asks first) */
  dirty: boolean
  /** what closing loses, for the question ("your changes to docker-compose.yml") */
  dirtyWhat?: string
  onClose: () => void
  onSave?: () => void
  onFind?: () => void
  /** Escape: return true when it was used (Find closed, the diff left) */
  onEscape?: () => boolean
  /** the save bar (SaveBar placement="panel") */
  bar?: ReactNode
  /** the status line under the body */
  status?: ReactNode
  children: ReactNode
}

export default function EditorFrame({
  title, subtitle, icon, tone = 'info', badge, tabs, tools, dirty, dirtyWhat = 'your changes', onClose, onSave, onFind, onEscape, bar, status, children,
}: EditorFrameProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const confirm = useConfirm()
  // focus stays inside and goes back to what opened it; Escape is the frame's own (below)
  useModalA11y(panelRef, () => {}, { closeOnEscape: false })

  const requestClose = useCallback(async () => {
    if (dirty && !(await confirm({
      title: 'Close without saving?',
      message: `Nothing is saved yet: closing the editor loses ${dirtyWhat}.`,
      confirmLabel: 'Close without saving',
      cancelLabel: 'Keep editing',
      danger: true,
    }))) return
    onClose()
  }, [dirty, dirtyWhat, confirm, onClose])

  const keys = useRef({ requestClose, onSave, onFind, onEscape })
  keys.current = { requestClose, onSave, onFind, onEscape }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a confirmation or a sheet opened from the editor answers its own keys
      const top = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => d.getClientRects().length).pop()
      if (top && top !== panelRef.current) return
      const k = keys.current
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        // this Escape is the editor's: the page behind it must not take it too (Stacks checks defaultPrevented)
        e.preventDefault()
        if (k.onEscape?.()) return
        void k.requestClose()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        k.onSave?.()
      } else if (mod && e.key.toLowerCase() === 'f' && k.onFind) {
        e.preventDefault()
        k.onFind()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) void requestClose() }}
      className="fixed inset-0 z-[9999] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full h-full sm:h-[92vh] sm:max-w-[min(1400px,96vw)] sm:mx-4 flex flex-col overflow-hidden bg-slate-900/95 backdrop-blur-2xl sm:border border-white/10 sm:rounded-2xl shadow-2xl shadow-black/40 animate-scale-in safe-area-top"
      >
        <header className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 sm:px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0 flex-1 basis-60">
            <div className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${TONE_TILE[tone]}`} aria-hidden>{icon}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 id={titleId} className={`${TITLE_DIALOG} truncate`}>{title}</h2>
                {badge}
              </div>
              {subtitle && <div className="text-[11px] text-slate-500 font-mono truncate">{subtitle}</div>}
            </div>
            <Hint label={dirty ? 'Close (asks first: something is unsaved)' : 'Close (Esc)'}>
              <CloseButton onClick={() => void requestClose()} className="ml-auto sm:hidden" />
            </Hint>
          </div>
          {tabs && <div className="order-3 sm:order-none basis-full sm:basis-auto min-w-0 max-w-full overflow-x-auto scrollbar-none">{tabs}</div>}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {tools}
            <Hint label={dirty ? 'Close (asks first: something is unsaved)' : 'Close (Esc)'}>
              <CloseButton onClick={() => void requestClose()} className="hidden sm:inline-flex" />
            </Hint>
          </div>
        </header>
        <div className="relative flex-1 min-h-0 flex flex-col">
          {children}
          {bar}
        </div>
        {status && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 pt-2 pad-bottom-safe [--pad-b:0.5rem] border-t border-white/5 bg-slate-900/60 text-[11px] text-slate-500">
            {status}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
