// =============================================================================
// SaveBar — the bar that comes up from the bottom when something is unsaved:
// what changed and what it will change, at most three buttons (Check only ·
// Discard · the one primary, which checks and saves in one press), and above
// them what the check found — each problem with its line, a press away.
//
//   <SaveBar open={dirty} placement="panel" status="3 lines changed" detail="dashdot takes it on the next Update"
//     phase={run.phase} result={run.result} onJump={(l) => code.current?.jumpTo(l)}
//     primary={{ label: 'Save', onClick: run.submit }} onCheck={run.checkOnly} secondary={{ label: 'Discard', onClick: discard }} />
//
//   placement  panel  inside an editor (the editor leaves room under its last line: onHeight)
//              page   at the bottom of the window, above a phone's tab bar; it lifts the chat and back-to-top
//                     buttons by its height while it shows (index.css .lift-over-savebar)
//   static     always there, in the flow of a sheet (the deploy sheet's footer)
//
// On a phone the bar is as wide as the screen, its buttons 44 px, the primary the widest, clear of the home bar.
// =============================================================================

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from 'lucide-react'
import type { PipelinePhase, PipelineResult } from './useSavePipeline'
import { BTN_SHEET, BTN_SHEET_PRIMARY, TONE_QUIET, TONE_GHOST } from '../../lib/ui'
import { TONE_TEXT } from '../../lib/tone'

export interface SaveBarAction {
  label: string
  onClick: () => void
  disabled?: boolean
  /** why it is disabled (a hint under the bar's status) */
  reason?: string
  /** the words while it runs ("Saving…") */
  busyLabel?: string
  icon?: ReactNode
}

export interface SaveBarProps {
  open: boolean
  placement: 'panel' | 'page' | 'static'
  /** what is unsaved: "3 lines changed", "2 variables changed" */
  status: ReactNode
  /** what saving it changes: the services, when it takes effect */
  detail?: ReactNode
  phase?: PipelinePhase
  result?: PipelineResult | null
  onJump?: (line: number) => void
  onDismissResult?: () => void
  /** the one main action (absent for a viewer) */
  primary?: SaveBarAction
  /** "Check only": run the check without saving */
  onCheck?: () => void
  checkLabel?: string
  secondary?: SaveBarAction
  /** a control beside the status (the container's "Recreate to apply" switch) */
  extra?: ReactNode
  /** the bar's height (panel placement: the editor keeps its last lines clear of it) */
  onHeight?: (h: number) => void
  /** the region's name for a screen reader */
  label?: string
  /** above a full-screen editor (its overlay sits at 9999) */
  zIndex?: number
  /** the dot before the status: amber for something unsaved (default), cyan for an action not yet taken (a deploy) */
  pip?: 'attention' | 'info'
}

const ICON = { ok: CircleCheck, attention: TriangleAlert, problem: CircleAlert } as const
/** the button row on a phone: the primary takes what the others leave */
const GRID_COLS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-[auto_1fr]', 'grid-cols-[auto_auto_1fr]']

function primaryWords(primary: SaveBarAction, phase: PipelinePhase): string {
  if (phase === 'saved') return 'Saved'
  if (phase === 'checking') return 'Checking…'
  if (phase === 'saving') return primary.busyLabel ?? `${primary.label}…`
  return primary.label
}

function pipClass(phase: PipelinePhase, pip: 'attention' | 'info'): string {
  if (phase === 'saved') return 'bg-emerald-400'
  if (phase === 'checking' || phase === 'saving') return 'bg-cyan-400 animate-pulse'
  return pip === 'info' ? 'bg-cyan-400' : 'bg-amber-400'
}
const BTN = `${BTN_SHEET} sm:h-9 sm:px-3.5`
const PRIMARY = `${BTN_SHEET_PRIMARY} sm:h-9 sm:px-4 min-w-[7rem]`

function ResultPanel({ result, onJump, onDismiss }: { result: PipelineResult; onJump?: (l: number) => void; onDismiss?: () => void }) {
  const Icon = ICON[result.tone]
  const tone = TONE_TEXT[result.tone]
  return (
    <div className="border-b border-white/5 px-4 pt-3 pb-2.5" data-save-result={result.tone}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={14} className={`${tone} shrink-0`} aria-hidden />
        <p className={`text-xs font-medium ${tone} min-w-0 flex-1`}>
          {result.title}
          {result.stale && <span className="text-slate-500 font-normal"> · from before your last edit</span>}
        </p>
        {onDismiss && result.tone !== 'ok' && (
          <button type="button" onClick={onDismiss} className={`h-7 px-2 rounded-md text-[11px] ${TONE_GHOST}`}>Hide</button>
        )}
      </div>
      {result.problems.length > 0 && (
        <ul className="mt-2 max-h-[30vh] overflow-y-auto overscroll-contain scrollbar-thin space-y-0.5 -mx-1" aria-label="What the check found">
          {result.problems.map((p, i) => (
            <li key={i}>
              {p.line && onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(p.line!)}
                  className="w-full flex items-start gap-2.5 rounded-md px-1 py-1 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  aria-label={`Line ${p.line}: ${p.message} (go to the line)`}
                >
                  <span className={`shrink-0 font-mono text-[11px] tabular-nums rounded px-1.5 py-px border border-white/10 bg-white/5 ${p.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}`}>Line {p.line}</span>
                  <span className="text-xs text-slate-300 leading-5 min-w-0 break-words">{p.message}</span>
                </button>
              ) : (
                <div className="flex items-start gap-2.5 px-1 py-1">
                  <span className={`shrink-0 mt-[7px] h-1.5 w-1.5 rounded-full ${p.severity === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`} aria-hidden />
                  <span className="text-xs text-slate-300 leading-5 min-w-0 break-words font-mono">{p.message}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SaveBar({
  open, placement, status, detail, phase = 'idle', result, onJump, onDismissResult, primary, onCheck, checkLabel = 'Check only',
  secondary, extra, onHeight, label = 'Unsaved changes', zIndex, pip = 'attention',
}: SaveBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const busy = phase === 'checking' || phase === 'saving'
  const show = open || busy || phase === 'saved'

  // tell the editor (or the page's floating buttons) how much room the bar takes
  useLayoutEffect(() => {
    const el = ref.current
    if (!show || !el) {
      onHeight?.(0)
      return
    }
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      onHeight?.(h)
      if (placement === 'page') document.documentElement.style.setProperty('--dcs-savebar-h', `${h + 28}px`)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (placement === 'page') document.documentElement.style.removeProperty('--dcs-savebar-h')
    }
  }, [show, placement, onHeight])

  if (!show) return null

  const saved = phase === 'saved'
  const reason = primary?.disabled && primary.reason
  const buttons = [secondary, onCheck, primary].filter(Boolean).length

  const card = (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className={placement === 'static'
        ? 'shrink-0 border-t border-white/10'
        : `pointer-events-auto relative overflow-hidden glass bg-slate-900/95 shadow-2xl shadow-black/40 animate-fade-in-up ${placement === 'panel' ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl'}`}
    >
      {/* the pipeline's progress: a thin line along the top while it checks and saves */}
      {busy && <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden><div className="h-full w-full bg-emerald-400 animate-pulse" /></div>}
      {result && <ResultPanel result={result} onJump={onJump} onDismiss={onDismissResult} />}
      <div className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 ${placement === 'static' ? 'pt-4 pad-bottom-safe' : 'py-3'}`}>
        <div className="min-w-0 flex-1 flex items-start gap-2.5">
          <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${pipClass(phase, pip)}`} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm text-slate-200 leading-5" aria-live="polite">{saved ? 'All changes saved' : status}</p>
            {detail && !saved && <p className="text-xs text-slate-500 leading-5 mt-0.5">{detail}</p>}
            {reason && <p className="text-xs text-amber-300 leading-5 mt-0.5">{reason}</p>}
            {extra && <div className="mt-2">{extra}</div>}
          </div>
        </div>
        <div className={`grid ${GRID_COLS[buttons]} sm:flex sm:items-center gap-2 shrink-0`}>
          {secondary && (
            <button type="button" onClick={secondary.onClick} disabled={busy || secondary.disabled} className={`${BTN} ${TONE_QUIET}`}>
              {secondary.icon}{secondary.label}
            </button>
          )}
          {onCheck && (
            <button type="button" onClick={onCheck} disabled={busy || saved} className={`${BTN} ${TONE_QUIET}`} title="Run the check and list what it finds, without saving">
              {checkLabel}
            </button>
          )}
          {primary && (
            <button
              type="button"
              onClick={primary.onClick}
              disabled={busy || saved || primary.disabled}
              aria-busy={busy || undefined}
              className={PRIMARY}
              data-save-primary
            >
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
              {saved && <CircleCheck size={16} aria-hidden />}
              {!busy && !saved && primary.icon}
              {primaryWords(primary, phase)}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (placement === 'static') return card
  if (placement === 'panel') {
    return <div className="absolute inset-x-0 bottom-0 sm:bottom-4 z-20 flex justify-center sm:px-4 pointer-events-none" style={zIndex ? { zIndex } : undefined}><div className="w-full sm:max-w-3xl">{card}</div></div>
  }
  return createPortal(
    <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 flex justify-center px-2 sm:px-4 pointer-events-none" style={{ zIndex: zIndex ?? 100 }}>
      <div className="w-full sm:max-w-2xl">{card}</div>
    </div>,
    document.body,
  )
}
