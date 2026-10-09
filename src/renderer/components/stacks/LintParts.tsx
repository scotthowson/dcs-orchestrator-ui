// =============================================================================
// LintParts — the compose linter's marks the editors draw (components/editor):
//   DiagNumber   a line number that carries diagnostics: coloured by its worst one,
//                the messages in a bubble on hover and on keyboard focus
//   CountBadge   the errors (or warnings) on a file's tab
// =============================================================================

import type { LintDiagnostic } from '../../hooks/useComposeLinter'

import { Count } from '../common/Pill'
const TONE = { error: 'text-rose-400', warning: 'text-amber-400', info: 'text-cyan-400' } as const
const GLYPH = { error: '●', warning: '▲', info: 'ℹ' } as const

/**
 * A gutter number with diagnostics on its line. Focusable, so a keyboard (or a screen reader, which reads the messages) gets
 * what a mouse gets; `focusable={false}` for a gutter that is hidden from assistive technology (the one beside a text area,
 * whose messages the panel under the editor lists).
 */
export function DiagNumber({ line, diags, className = '', width = 300, focusable = true }: { line: number; diags: LintDiagnostic[]; className?: string; width?: number; focusable?: boolean }) {
  const worst = diags.find((d) => d.severity === 'error') ?? diags.find((d) => d.severity === 'warning') ?? diags[0]
  return (
    <span
      {...(focusable ? { tabIndex: 0, role: 'note', 'aria-label': `Line ${line}: ${diags.map((d) => d.message).join('; ')}` } : {})}
      className="group/diag cursor-help rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <span className={`${TONE[worst.severity]} ${className}`}>{line}</span>
      <span className="absolute left-full top-0 ml-2 z-50 hidden group-hover/diag:block group-focus/diag:block animate-fade-in pointer-events-none text-left normal-case" style={{ width }} aria-hidden="true">
        <span className="block bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl shadow-black/40 p-2.5 space-y-1.5">
          {diags.map((d, i) => (
            <span key={i} className="flex items-start gap-2">
              <span className={`shrink-0 mt-0.5 ${TONE[d.severity]}`}>{GLYPH[d.severity]}</span>
              <span className="block">
                <span className="block text-[11px] text-slate-200 leading-snug">{d.message}</span>
                {d.fix && <span className="block text-[10px] text-slate-500 mt-0.5">Fix: {d.fix}</span>}
                <span className="block text-[9px] text-slate-500 font-mono">{d.rule}</span>
              </span>
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

/** the count on the Compose / .env tab of an editor: the errors in rose, else the warnings in amber */
export function CountBadge({ errors, warnings }: { errors: number; warnings: number }) {
  if (errors > 0) return <Count n={errors} tone="problem" label={`${errors} error${errors === 1 ? '' : 's'}`} />
  if (warnings > 0) return <Count n={warnings} tone="attention" label={`${warnings} warning${warnings === 1 ? '' : 's'}`} />
  return null
}
