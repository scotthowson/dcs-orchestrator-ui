// =============================================================================
// CodeArea — the code every editor shows, once: one text area over its own
// highlighted copy (YAML or .env colours, the line numbers in a gutter, the
// linter's marks on them, a bar beside each line changed since the last save),
// and Find / Replace above it. A viewer gets the same area read-only.
//
//   <CodeArea ref={code} value={text} onChange={setText} lang="yaml" label="Compose file"
//             diagnostics={lint} changed={diff.changed} bottomInset={barHeight} />
//   code.current.jumpTo(12)      the caret to line 12, scrolled into view and flashed
//   code.current.openFind()      Ctrl+F
//
// The text area's text is transparent and its caret is the theme's text colour (index.css .code-input); the two
// layers share one font, size, line height and padding, so the caret sits on the coloured copy.
// =============================================================================

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Replace, Search } from 'lucide-react'
import { DiagNumber } from '../stacks/LintParts'
import type { LintDiagnostic } from '../../hooks/useComposeLinter'
import { highlightLine, type CodeLanguage, type Segment } from './codeText'
import CloseButton from '../common/CloseButton'
import Hint from '../common/Hint'
import { BTN_CARD, BTN_ICON_SM, TONE_GHOST, TONE_PRESSED, TONE_QUIET } from '../../lib/ui'

export interface CodeAreaHandle {
  /** put the caret on a line (1-based), scroll it into view and flash it */
  jumpTo: (line: number) => void
  focus: () => void
  /** open Find (with Replace when `replace` and the area is editable) */
  openFind: (replace?: boolean) => void
  /** Find is open: Escape closes it first */
  findOpen: () => boolean
  closeFind: () => void
}

export interface CodeAreaProps {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  lang: CodeLanguage
  /** the text area's name for a screen reader ("Compose file", ".env file") */
  label: string
  diagnostics?: Pick<LintDiagnostic, 'line' | 'severity' | 'message' | 'rule' | 'fix'>[]
  /** the lines (1-based) that differ from the saved text */
  changed?: Set<number>
  /** a block to mark in the gutter (the service a container's editor was opened at) */
  focusBlock?: { start: number; end: number } | null
  /** room left under the last line (the save bar floats over the bottom of the area) */
  bottomInset?: number
  /** the caret moved: line and column, 1-based */
  onCaret?: (line: number, col: number) => void
  /** an id for the text area (the frame's footer points at it) */
  id?: string
}

const LINE = 24 // leading-6
const PAD = 12 // py-3

interface Range { start: number; end: number }

/** one highlighted line, with the Find matches on it marked (the active one ringed) */
const CodeLine = memo(function CodeLine({ text, lang, ranges, active }: { text: string; lang: CodeLanguage; ranges?: Range[]; active: number }) {
  const segs = highlightLine(text, lang)
  if (!ranges?.length) return <div className="h-6">{segs.map((s, i) => <span key={i} className={s.cls}>{s.text}</span>)}{text === '' ? '​' : null}</div>
  // split the coloured pieces where a match starts or ends
  const out: { seg: Segment; match: number }[] = []
  let pos = 0
  for (const s of segs) {
    let i = 0
    while (i < s.text.length) {
      const at = pos + i
      const r = ranges.findIndex((m) => at >= m.start && at < m.end)
      let j = i + 1
      while (j < s.text.length && ranges.findIndex((m) => pos + j >= m.start && pos + j < m.end) === r) j++
      out.push({ seg: { text: s.text.slice(i, j), cls: s.cls }, match: r })
      i = j
    }
    pos += s.text.length
  }
  return (
    <div className="h-6">
      {out.map((p, i) => p.match < 0
        ? <span key={i} className={p.seg.cls}>{p.seg.text}</span>
        : <span key={i} className={`rounded-sm ${p.match === active ? 'bg-amber-400/30 ring-1 ring-amber-400/60 text-white' : 'bg-amber-400/15 text-white'}`}>{p.seg.text}</span>)}
    </div>
  )
})

const CodeArea = forwardRef<CodeAreaHandle, CodeAreaProps>(function CodeArea(
  { value, onChange, readOnly = false, lang, label, diagnostics = [], changed, focusBlock, bottomInset = 0, onCaret, id },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const charW = useRef(7.8)
  const [find, setFind] = useState<{ open: boolean; replace: boolean }>({ open: false, replace: false })
  const [query, setQuery] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [flash, setFlash] = useState<number | null>(null)
  const lines = useMemo(() => value.split('\n'), [value])

  // the width of one character of the code font, for keeping the caret in view sideways
  useEffect(() => {
    const probe = document.createElement('span')
    probe.className = 'font-mono text-[13px]'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    probe.textContent = 'x'.repeat(40)
    document.body.appendChild(probe)
    charW.current = probe.getBoundingClientRect().width / 40 || 7.8
    probe.remove()
  }, [])

  const diagMap = useMemo(() => {
    const m = new Map<number, LintDiagnostic[]>()
    for (const d of diagnostics) { const a = m.get(d.line) ?? []; a.push(d as LintDiagnostic); m.set(d.line, a) }
    return m
  }, [diagnostics])

  // ---- Find ----------------------------------------------------------------
  const matches = useMemo(() => {
    const q = query.toLowerCase()
    const byLine = new Map<number, Range[]>()
    const flat: { line: number; idx: number; start: number; end: number }[] = []
    if (!find.open || !q) return { byLine, flat }
    lines.forEach((l, li) => {
      const low = l.toLowerCase()
      let p = low.indexOf(q)
      while (p >= 0) {
        const rs = byLine.get(li) ?? []
        flat.push({ line: li, idx: rs.length, start: p, end: p + q.length })
        rs.push({ start: p, end: p + q.length })
        byLine.set(li, rs)
        p = low.indexOf(q, p + Math.max(1, q.length))
      }
    })
    return { byLine, flat }
  }, [lines, query, find.open])
  const total = matches.flat.length
  const current = total ? matches.flat[Math.min(activeMatch, total - 1)] : null

  useEffect(() => { setActiveMatch(0) }, [query])

  const offsetOf = useCallback((line: number, col = 0) => {
    let o = 0
    for (let i = 0; i < line && i < lines.length; i++) o += lines[i].length + 1
    return o + col
  }, [lines])

  /** keep a line (0-based) and column in view, clear of the save bar */
  const reveal = useCallback((line: number, col = 0) => {
    const sc = scrollRef.current
    if (!sc) return
    const top = PAD + line * LINE
    const viewBottom = sc.scrollTop + sc.clientHeight - bottomInset
    if (top < sc.scrollTop + LINE) sc.scrollTop = Math.max(0, top - LINE * 2)
    else if (top + LINE > viewBottom - LINE) sc.scrollTop = top + LINE * 3 - sc.clientHeight + bottomInset
    const gutter = 48
    const x = gutter + PAD + col * charW.current
    if (x < sc.scrollLeft + gutter + PAD) sc.scrollLeft = Math.max(0, x - gutter - PAD * 4)
    else if (x > sc.scrollLeft + sc.clientWidth - PAD * 3) sc.scrollLeft = x - sc.clientWidth + PAD * 6
  }, [bottomInset])

  // the active match comes into view when the search or the step changes (not on every edit while Find is open)
  const currentRef = useRef(current)
  currentRef.current = current
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  useEffect(() => {
    const c = currentRef.current
    if (c) revealRef.current(c.line, c.start)
  }, [activeMatch, query, find.open])

  const caretMoved = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd
    const before = ta.value.slice(0, pos)
    const line = before.split('\n').length - 1
    const col = pos - (before.lastIndexOf('\n') + 1)
    reveal(line, col)
    onCaret?.(line + 1, col + 1)
  }, [reveal, onCaret])

  const jumpTo = useCallback((line: number) => {
    const ta = taRef.current
    const li = Math.max(0, Math.min(lines.length - 1, line - 1))
    // the caret at the line's first character, nothing selected (a key pressed next must not replace the line)
    const col = lines[li].length - lines[li].trimStart().length
    if (ta) {
      ta.focus({ preventScroll: true })
      const at = offsetOf(li, col)
      ta.setSelectionRange(at, at)
    }
    reveal(li, col)
    onCaret?.(li + 1, col + 1)
    setFlash(li)
    window.setTimeout(() => setFlash((f) => (f === li ? null : f)), 1600)
  }, [lines, offsetOf, reveal, onCaret])

  const openFind = useCallback((replace = false) => {
    setFind({ open: true, replace: replace && !readOnly })
    // a selection on one line becomes the search
    const ta = taRef.current
    if (ta && document.activeElement === ta && ta.selectionEnd > ta.selectionStart) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd)
      if (!sel.includes('\n')) setQuery(sel)
    }
    window.setTimeout(() => { findRef.current?.focus(); findRef.current?.select() }, 0)
  }, [readOnly])
  const closeFind = useCallback(() => {
    setFind({ open: false, replace: false })
    taRef.current?.focus({ preventScroll: true })
  }, [])

  useImperativeHandle(ref, () => ({
    jumpTo,
    focus: () => taRef.current?.focus({ preventScroll: true }),
    openFind,
    findOpen: () => find.open,
    closeFind,
  }), [jumpTo, openFind, find.open, closeFind])

  const step = (d: 1 | -1) => total && setActiveMatch((i) => (i + d + total) % total)

  /** replace through the text area, so the browser's undo takes it back */
  const writeRange = (start: number, end: number, text: string) => {
    const ta = taRef.current
    if (!ta || readOnly) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(start, end)
    const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!done) onChange?.(ta.value.slice(0, start) + text + ta.value.slice(end))
  }
  const replaceOne = () => {
    if (!current) return
    const s = offsetOf(current.line, current.start)
    writeRange(s, s + (current.end - current.start), replaceWith)
    window.setTimeout(() => findRef.current?.focus(), 0)
  }
  const replaceAll = () => {
    if (!total || !query) return
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    writeRange(0, value.length, value.replace(new RegExp(esc, 'gi'), () => replaceWith))
    window.setTimeout(() => findRef.current?.focus(), 0)
  }

  const findKeys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind() }
  }

  const widest = useMemo(() => lines.reduce((w, l) => Math.max(w, l.length), 0), [lines])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {find.open && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 border-b border-white/5 bg-slate-900/50" role="search" aria-label="Find in the file">
          <div className="relative flex-1 min-w-[10rem]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
            <input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={findKeys}
              aria-label="Find"
              placeholder="Find"
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums shrink-0 min-w-[4.5rem] text-right" role="status">
            {query ? (total ? `${Math.min(activeMatch, total - 1) + 1} of ${total}` : 'No match') : ''}
          </span>
          <div className="flex items-center gap-0.5 shrink-0">
            <Hint label="Previous match (Shift+Enter)">
              <button type="button" aria-label="Previous match" disabled={total < 1} onClick={() => step(-1)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><ChevronUp size={14} /></button>
            </Hint>
            <Hint label="Next match (Enter)">
              <button type="button" aria-label="Next match" disabled={total < 1} onClick={() => step(1)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><ChevronDown size={14} /></button>
            </Hint>
            {!readOnly && (
              <Hint label="Replace">
                <button type="button" aria-label="Replace" aria-pressed={find.replace} onClick={() => setFind((f) => ({ ...f, replace: !f.replace }))} className={`${BTN_ICON_SM} ${find.replace ? TONE_PRESSED : TONE_GHOST}`}><Replace size={14} /></button>
              </Hint>
            )}
            <CloseButton size="sm" label="Close Find" onClick={closeFind} />
          </div>
          {find.replace && !readOnly && (
            <div className="basis-full flex flex-wrap items-center gap-2">
              <input
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind() } }}
                aria-label="Replace with"
                placeholder="Replace with"
                className="flex-1 min-w-[10rem] h-8 px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
              />
              <button type="button" onClick={replaceOne} disabled={!current} className={`${BTN_CARD} ${TONE_QUIET}`}>Replace</button>
              <button type="button" onClick={replaceAll} disabled={!total} className={`${BTN_CARD} ${TONE_QUIET}`}>Replace all</button>
            </div>
          )}
        </div>
      )}

      <div ref={scrollRef} className="code-scroll flex-1 min-h-0 overflow-auto overscroll-contain scrollbar-thin bg-slate-950" data-sweep-scroll>
        <div className="flex min-w-full w-max font-mono text-[13px] leading-6">
          {/* the gutter: line numbers, the linter's marks, a bar beside a changed line */}
          <div className="sticky left-0 z-10 shrink-0 w-12 select-none bg-slate-950 border-r border-white/5 py-3" aria-hidden="true">
            {lines.map((_, i) => {
              const n = i + 1
              const diags = diagMap.get(n)
              const inBlock = focusBlock && n >= focusBlock.start && n <= focusBlock.end
              return (
                <div key={i} className={`relative h-6 pr-2.5 text-right text-xs tabular-nums ${inBlock ? 'bg-white/[0.03]' : ''}`}>
                  {changed?.has(n) && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-emerald-400" />}
                  {diags ? <DiagNumber line={n} diags={diags} focusable={false} width={300} className="text-xs tabular-nums" /> : <span className="text-slate-500">{n}</span>}
                </div>
              )
            })}
          </div>
          {/* the code: its coloured copy under the text area that takes the typing */}
          <div className="relative flex-1" style={{ minWidth: `calc(${widest}ch + 3rem)` }}>
            <div className="code-text py-3 pl-3 pr-6 whitespace-pre pointer-events-none" aria-hidden="true">
              {lines.map((l, i) => (
                <div key={i} className={flash === i ? 'bg-amber-400/[0.06]' : current?.line === i ? 'bg-amber-400/[0.03]' : undefined}>
                  <CodeLine text={l} lang={lang} ranges={matches.byLine.get(i)} active={current?.line === i ? current.idx : -1} />
                </div>
              ))}
            </div>
            <textarea
              ref={taRef}
              id={id}
              value={value}
              readOnly={readOnly}
              aria-readonly={readOnly || undefined}
              aria-label={label}
              onChange={(e) => onChange?.(e.target.value)}
              onKeyUp={caretMoved}
              onClick={caretMoved}
              onSelect={caretMoved}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="code-input absolute inset-0 w-full h-full py-3 pl-3 pr-6 m-0 border-0 bg-transparent resize-none overflow-hidden whitespace-pre font-mono text-[13px] leading-6"
            />
          </div>
        </div>
        <div style={{ height: bottomInset }} aria-hidden="true" />
      </div>
    </div>
  )
})

export default CodeArea
