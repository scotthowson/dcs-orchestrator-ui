// =============================================================================
// DiffView — what changed, the same in every editor: the saved text on the left,
// the edited one on the right (one column with − and + on a phone), unchanged
// stretches folded to three lines of context around each change.
//
//   <DiffView diff={diffLines(saved, text)} left="Saved" right="Your edit" />
// =============================================================================

import { useMemo, useState } from 'react'
import type { DiffRow, LineDiff } from './codeText'

const CONTEXT = 3

type Piece = { kind: 'rows'; rows: DiffRow[] } | { kind: 'fold'; rows: DiffRow[]; key: number }

function fold(rows: DiffRow[]): Piece[] {
  const changed = rows.map((r) => r.left.kind !== 'same' || r.right.kind !== 'same')
  const keep = rows.map((_, i) => {
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) if (changed[k]) return true
    return false
  })
  const out: Piece[] = []
  let i = 0
  while (i < rows.length) {
    const start = i
    const kept = keep[i]
    while (i < rows.length && keep[i] === kept) i++
    const slice = rows.slice(start, i)
    if (kept || slice.length <= 2) out.push({ kind: 'rows', rows: slice })
    else out.push({ kind: 'fold', rows: slice, key: start })
  }
  return out
}

const num = 'inline-block w-10 shrink-0 text-right pr-2.5 select-none tabular-nums text-xs leading-6'

function Side({ cell, side }: { cell: DiffRow['left'] | DiffRow['right']; side: 'left' | 'right' }) {
  const change = cell.kind === 'removed' || cell.kind === 'added'
  const pad = cell.kind === 'pad'
  const bg = change ? (side === 'left' ? 'bg-rose-500/[0.08]' : 'bg-emerald-500/[0.08]') : pad ? 'bg-slate-900/40' : ''
  const fg = change ? (side === 'left' ? 'text-rose-300' : 'text-emerald-300') : 'text-slate-400'
  return (
    <div className={`flex min-w-0 min-h-6 ${bg} ${side === 'left' ? 'border-r border-white/5' : ''}`}>
      <span className={`${num} ${change ? fg : 'text-slate-500'}`}>{cell.n ?? ''}</span>
      <span className={`flex-1 whitespace-pre pr-3 overflow-hidden text-ellipsis ${fg}`}>{cell.text || ' '}</span>
    </div>
  )
}

export default function DiffView({ diff, left = 'Saved', right = 'Your edit', empty = 'No changes since the last save' }: { diff: LineDiff; left?: string; right?: string; empty?: string }) {
  const pieces = useMemo(() => fold(diff.rows), [diff])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const nothing = diff.added === 0 && diff.removed === 0

  const fragment = (rows: DiffRow[], unified: boolean) => rows.map((r, i) => {
    if (!unified) {
      return (
        <div key={i} className="grid grid-cols-2">
          <Side cell={r.left} side="left" />
          <Side cell={r.right} side="right" />
        </div>
      )
    }
    if (r.left.kind === 'same') {
      return <div key={i} className="flex min-h-6"><span className={`${num} text-slate-500`}>{r.right.n}</span><span className="w-4 shrink-0" /><span className="flex-1 whitespace-pre pr-3 text-slate-400">{r.right.text || ' '}</span></div>
    }
    return (
      <div key={i}>
        {r.left.kind === 'removed' && <div className="flex min-h-6 bg-rose-500/[0.08]"><span className={`${num} text-rose-300`}>{r.left.n}</span><span className="w-4 shrink-0 text-rose-300" aria-label="removed">−</span><span className="flex-1 whitespace-pre pr-3 text-rose-300">{r.left.text || ' '}</span></div>}
        {r.right.kind === 'added' && <div className="flex min-h-6 bg-emerald-500/[0.08]"><span className={`${num} text-emerald-300`}>{r.right.n}</span><span className="w-4 shrink-0 text-emerald-300" aria-label="added">+</span><span className="flex-1 whitespace-pre pr-3 text-emerald-300">{r.right.text || ' '}</span></div>}
      </div>
    )
  })

  const body = (unified: boolean) => pieces.map((p, i) => {
    if (p.kind === 'rows' || open.has(p.key)) return <div key={i}>{fragment(p.rows, unified)}</div>
    return (
      <button
        key={i}
        type="button"
        onClick={() => setOpen((s) => new Set(s).add(p.key))}
        className="w-full h-7 flex items-center gap-2 px-3 text-[11px] font-sans text-slate-500 bg-white/[0.03] hover:bg-white/5 hover:text-slate-300 border-y border-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
      >
        ⋯ {p.rows.length} unchanged lines (show them)
      </button>
    )
  })

  if (nothing) {
    return <div className="flex-1 min-h-0 flex items-center justify-center bg-slate-950 text-sm text-slate-500 p-6">{empty}</div>
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto overscroll-contain scrollbar-thin bg-slate-950" data-sweep-scroll>
      <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-white/5 bg-slate-900/90 backdrop-blur-sm text-[11px] font-semibold uppercase tracking-wider">
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 border-r border-white/5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden /><span className="text-slate-400">{left}</span>
          <span className="ml-auto normal-case tracking-normal font-normal text-slate-500 tabular-nums">{diff.removed} removed</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /><span className="text-slate-400">{right}</span>
          <span className="ml-auto normal-case tracking-normal font-normal text-slate-500 tabular-nums">{diff.added} added</span>
        </div>
        <div className="sm:hidden col-span-2 flex items-center gap-3 px-3 py-2 normal-case tracking-normal font-normal text-slate-400">
          <span><span className="text-rose-300">−{diff.removed}</span> {left.toLowerCase()}</span>
          <span><span className="text-emerald-300">+{diff.added}</span> {right.toLowerCase()}</span>
        </div>
      </div>
      <div className="hidden sm:block font-mono text-[13px] leading-6 code-text">{body(false)}</div>
      <div className="sm:hidden font-mono text-[13px] leading-6 code-text min-w-max">{body(true)}</div>
    </div>
  )
}
