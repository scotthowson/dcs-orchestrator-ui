// =============================================================================
// EditorStatus — the status line under every editor: the lines, where the caret
// is, the linter's counts (a press lists its messages, each a press away from
// its line), the language and the keys.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import Kbd from '../common/Kbd'
import type { LintDiagnostic } from '../../hooks/useComposeLinter'

type Diag = Pick<LintDiagnostic, 'line' | 'severity' | 'message' | 'fix'>

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function LintButton({ diagnostics, onJump, what }: { diagnostics: Diag[]; onJump?: (line: number) => void; what: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const info = diagnostics.length - errors - warnings
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true) }
  }, [open])
  if (!diagnostics.length) {
    return <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />Lint: all clear</span>
  }
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded px-1 -mx-1 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        aria-label={`${what} lint: ${plural(errors, 'error')}, ${plural(warnings, 'warning')}, ${plural(info, 'hint')} (list them)`}
      >
        {errors > 0 && <span className="flex items-center gap-1 text-rose-400"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden />{plural(errors, 'error')}</span>}
        {warnings > 0 && <span className="flex items-center gap-1 text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />{plural(warnings, 'warning')}</span>}
        {info > 0 && <span className="flex items-center gap-1 text-cyan-400"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden />{plural(info, 'hint')}</span>}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-30 w-[min(30rem,calc(100vw-2rem))] glass bg-slate-900/95 shadow-2xl shadow-black/40 p-2 animate-fade-in">
          <p className="px-1.5 pt-0.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{what} lint</p>
          <ul className="max-h-[40vh] overflow-y-auto overscroll-contain scrollbar-thin space-y-0.5">
            {diagnostics.slice(0, 80).map((d, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); onJump?.(d.line) }}
                  className="w-full flex items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                >
                  <span className={`shrink-0 font-mono text-[11px] tabular-nums w-9 ${d.severity === 'error' ? 'text-rose-300' : d.severity === 'warning' ? 'text-amber-300' : 'text-cyan-400'}`}>L{d.line}</span>
                  <span className="text-xs text-slate-300 leading-5 min-w-0">{d.message}{d.fix ? <span className="text-slate-500"> — {d.fix}</span> : null}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function EditorStatus({ lines, caret, lang, lint, readOnly, saveKey = true }: {
  lines: number
  caret?: { line: number; col: number } | null
  lang: string
  lint?: React.ReactNode
  readOnly?: boolean
  /** Ctrl+S does something here */
  saveKey?: boolean
}) {
  return (
    <>
      <span className="font-mono tabular-nums">{plural(lines, 'line')}</span>
      {caret && <span className="font-mono tabular-nums">Ln {caret.line}, Col {caret.col}</span>}
      {lint}
      <span className="ml-auto">{readOnly ? `${lang} · read-only` : lang}</span>
      <span className="hidden md:inline-flex items-center gap-1.5">
        {!readOnly && saveKey && <><Kbd>Ctrl+S</Kbd> save ·</>}
        <Kbd>Ctrl+F</Kbd> find · <Kbd>Esc</Kbd> close
      </span>
    </>
  )
}
