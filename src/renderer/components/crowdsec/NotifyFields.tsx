// =============================================================================
// The building blocks of the Discord editor: collapsible sections, labelled
// fields with a character counter and the default next to them, the text
// inputs that know the placeholders (a picker, and a suggestion list while you
// type "{"), token inputs for scenario names, colour and number fields, the
// list of embed fields, and the choice cards of the webhook.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Braces, ChevronDown, Plus, Search, Trash2, X, RotateCcw } from 'lucide-react'
import type { CrowdSecPlaceholder } from '../../../shared/types'
import { useOutside } from './kit'
import { AUTO_COLORS, COLOR_PRESETS, LIM, cpLen, patternProblem, newFieldKey, type ColorMode, type Errors, type FormField } from './NotifyModel'

import { BTN_ICON_QUIET, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { Pill } from '../common/Pill'
import Segmented from '../common/Segmented'
import Sheet from '../common/Sheet'
import { Toggle } from '../common/Toggle'
// ---------------------------------------------------------------------------
// Small things
// ---------------------------------------------------------------------------

export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query)
    m.addEventListener('change', cb)
    return () => m.removeEventListener('change', cb)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

/** 12/200: amber near the limit, rose beyond it */
export function Counter({ n, max }: { n: number; max: number }) {
  const cls = n > max ? 'text-rose-300' : n >= max * 0.9 ? 'text-amber-300' : 'text-slate-500'
  return <span className={`text-[11px] tabular-nums ${cls}`} title={`${n} of ${max} characters`}>{n}/{max}</span>
}

const shorten = (s: string, n = 64): string => { const t = s.replace(/\s*\n\s*/g, ' ⏎ '); return t.length > n ? `${t.slice(0, n)}…` : t }

/** label row, the control, the error and the help with the default value */
export function FieldShell({ id, label, right, counter, hint, def, onDefault, error, children }: {
  id: string; label: ReactNode; right?: ReactNode; counter?: ReactNode; hint?: ReactNode; def?: string; onDefault?: () => void; error?: string; children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-1 min-h-[1.25rem]">
        <label htmlFor={id} className="block text-xs font-medium text-slate-500">{label}</label>
        <div className="flex items-center gap-2 shrink-0">{right}{counter}</div>
      </div>
      {children}
      {error && <p id={`${id}-err`} role="alert" className="text-[11px] text-rose-300 mt-1">{error}</p>}
      {(hint || def !== undefined) && (
        <p id={`${id}-hint`} className={`${HINT} flex flex-wrap items-center gap-x-1.5`}>
          {hint && <span>{hint}</span>}
          {def !== undefined && (
            <span className="text-slate-500 inline-flex items-center gap-1 min-w-0">
              Default: <code className="font-mono text-slate-500 truncate max-w-[16rem]" title={def}>{def === '' ? 'empty' : shorten(def)}</code>
              {onDefault && <button type="button" onClick={onDefault} className="ml-1 py-1.5 -my-1.5 text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"><RotateCcw size={10} /> Use the default</button>}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

/** a switch with its words: label, one sentence, the default */
/** a collapsible block of the editor */
export function Section({ id, icon: Icon, title, summary, open, onToggle, problems = 0, edited = false, children }: {
  id: string; icon: React.ElementType; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; problems?: number; edited?: boolean; children: ReactNode
}) {
  return (
    <section id={id} className={`${CARD} scroll-mt-4`} aria-label={title}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-body`} className="w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl hover:bg-white/[0.03] transition-colors">
        <span className="h-8 w-8 rounded-lg bg-white/[0.05] border border-white/10 flex items-center justify-center shrink-0 text-slate-300"><Icon size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-100">{title}</span>
          {summary && <span className="block text-xs text-slate-500 truncate">{summary}</span>}
        </span>
        {problems > 0 && <Pill tone="problem">{problems} to fix</Pill>}
        {edited && problems === 0 && <Pill tone="attention">edited</Pill>}
        <ChevronDown size={16} className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={`${id}-body`} hidden={!open} className="px-4 pb-4 pt-4 space-y-4 border-t border-white/5">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Placeholders: the registry of inputs, the picker, the inline suggestions
// ---------------------------------------------------------------------------

export interface PhHandle { label: string; insert: (text: string) => void; focus: () => void }
export interface PhRegistry {
  register: (id: string, h: PhHandle) => () => void
  focused: (id: string) => void
  last: () => PhHandle | null
}
const PhCtx = createContext<PhRegistry | null>(null)

/** the inputs that take placeholders register here, so one picker can insert into the one that had the caret last */
export function usePhRegistry(): PhRegistry {
  return useMemo(() => {
    const map = new Map<string, PhHandle>()
    let lastId = ''
    return {
      register: (id, h) => { map.set(id, h); return () => { if (map.get(id) === h) map.delete(id) } },
      focused: (id) => { lastId = id },
      last: () => map.get(lastId) ?? map.get('description') ?? null,
    }
  }, [])
}
export const PhProvider = PhCtx.Provider

/** `strict` looks at the names only (the suggestions after "{"); otherwise the label, the group, the meaning and the example count too (the picker) */
function matchPlaceholders(list: CrowdSecPlaceholder[], q: string, strict = false): CrowdSecPlaceholder[] {
  const s = q.trim().toLowerCase().replace(/^\{|\}$/g, '')
  if (!s) return list
  const score = (p: CrowdSecPlaceholder): number => {
    if (p.name === s) return 0
    if (p.name.startsWith(s)) return 1
    if (p.name.includes(s)) return 2
    if (strict) return 9
    if (p.label.toLowerCase().includes(s)) return 3
    if (p.group.toLowerCase().includes(s) || p.description.toLowerCase().includes(s) || p.example.toLowerCase().includes(s)) return 4
    return 9
  }
  return list.filter((p) => score(p) < 9).sort((a, b) => score(a) - score(b))
}

/** the searchable list, grouped, with the label, the example and the meaning of each placeholder */
function PlaceholderList({ items, onPick, target, onClose }: { items: CrowdSecPlaceholder[]; onPick: (name: string) => void; target: string; onClose?: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const found = useMemo(() => matchPlaceholders(items, q), [items, q])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, found])
  const groups: { name: string; rows: { p: CrowdSecPlaceholder; i: number }[] }[] = []
  found.forEach((p, i) => {
    let g = groups.find((x) => x.name === p.group)
    if (!g) { g = { name: p.group, rows: [] }; groups.push(g) }
    g.rows.push({ p, i })
  })
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(found.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (found[active]) onPick(found[active].name) }
    else if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose() }
  }
  return (
    <div>
      <p className="text-[11px] text-slate-500 mb-2">Inserting into <span className="text-slate-300">{target}</span>. Placeholders are replaced by the real values when a message is sent.</p>
      <div className="relative mb-2">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <label htmlFor="ph-search" className="sr-only">Search the placeholders</label>
        <input id="ph-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search: ip, country, link…" autoComplete="off" spellCheck={false} className={`${INPUT} !h-9 !pl-9 !text-xs`} role="combobox" aria-expanded="true" aria-controls="ph-list" aria-autocomplete="list" aria-activedescendant={found[active] ? `ph-opt-${found[active].name}` : undefined} />
      </div>
      <div id="ph-list" ref={listRef} role="listbox" aria-label="Placeholders" className="max-h-72 overflow-y-auto scrollbar-thin -mx-1 px-1">
        {found.length === 0 && <p className="text-xs text-slate-500 py-6 text-center">No placeholder matches “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name} className="mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1">{g.name}</p>
            {g.rows.map(({ p, i }) => (
              <button key={p.name} id={`ph-opt-${p.name}`} type="button" role="option" aria-selected={i === active} data-active={i === active} onClick={() => onPick(p.name)} onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                <span className="flex items-baseline gap-2 flex-wrap">
                  <code className="font-mono text-[12px] text-emerald-300">{`{${p.name}}`}</code>
                  <span className="text-xs text-slate-200">{p.label}</span>
                </span>
                <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{p.description}</span>
                <span className="block text-[11px] text-slate-500 truncate mt-0.5">Example: <span className="font-mono">{p.example.trim() === '' ? '(empty)' : p.example}</span></span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** the button that opens the picker: a popover on a wide screen, a bottom sheet on a phone */
export function PlaceholderPicker({ items, onPick, target, label = 'Placeholders', compact = false, disabled = false }: { items: CrowdSecPlaceholder[]; onPick: (name: string) => void; target: () => string; label?: string; compact?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const wide = useMedia('(min-width: 640px)')
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useOutside(ref, () => setOpen(false), open && wide)
  const pick = (name: string) => { setOpen(false); onPick(name) }
  const closeAndReturn = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()) }
  // near the bottom of the window the list opens upwards
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      const below = window.innerHeight - r.bottom
      setUp(below < 440 && r.top > below)
    }
    setOpen((v) => !v)
  }
  return (
    <div className="relative" ref={ref}>
      <button ref={trigger} type="button" disabled={disabled || items.length === 0} onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
        aria-label={compact ? `Insert a placeholder: ${label}` : undefined} title="Insert a placeholder such as {ip} or {country_tag}"
        onMouseDown={(e) => e.preventDefault()}
        className={compact ? 'h-8 sm:h-7 px-2 rounded-md text-[11px] text-slate-500 hover:text-slate-100 hover:bg-white/10 inline-flex items-center gap-1 transition-colors disabled:opacity-40' : `${BTN_TOOLBAR_QUIET} !h-8`}>
        <Braces size={compact ? 12 : 13} /> {compact ? 'Insert' : label}
      </button>
      {open && wide && (
        <div role="dialog" aria-label="Insert a placeholder" className={`absolute right-0 ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} z-40 w-[min(30rem,88vw)] rounded-xl bg-slate-900 border border-white/10 shadow-black/40 p-3 shadow-xl animate-scale-in`}>
          <PlaceholderList items={items} onPick={pick} target={target()} onClose={closeAndReturn} />
        </div>
      )}
      {open && !wide && (
        <Sheet title="Insert a placeholder" subtitle="It is added where your cursor was." icon={<Braces size={18} />} tone="info" onClose={() => setOpen(false)}>
          <PlaceholderList items={items} onPick={pick} target={target()} />
        </Sheet>
      )}
    </div>
  )
}

interface PhInputProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  max: number
  placeholders: CrowdSecPlaceholder[]
  error?: string
  hint?: ReactNode
  def?: string
  onDefault?: () => void
  multiline?: boolean
  rows?: number
  disabled?: boolean
  placeholder?: string
  /** a form-level name that shows in "Inserting into …" when the label is generic */
  target?: string
  mono?: boolean
}

/** a text input (or a textarea) that inserts placeholders at the cursor and suggests them after "{" */
export function PlaceholderInput({ id, label, value, onChange, max, placeholders, error, hint, def, onDefault, multiline = false, rows = 3, disabled = false, placeholder, target, mono = true }: PhInputProps) {
  const reg = useContext(PhCtx)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const sel = useRef({ start: value.length, end: value.length })
  const valueRef = useRef(value); valueRef.current = value
  const caretTo = useRef<number | null>(null)
  const [sug, setSug] = useState<{ from: number; q: string; i: number } | null>(null)
  const targetName = target ?? label

  const items = useMemo(() => (sug ? matchPlaceholders(placeholders, sug.q, true).slice(0, 8) : []), [sug, placeholders])
  const open = !!sug && items.length > 0

  useLayoutEffect(() => {
    if (caretTo.current !== null && ref.current) {
      const c = caretTo.current
      caretTo.current = null
      try { ref.current.setSelectionRange(c, c) } catch { /* not a text input */ }
      sel.current = { start: c, end: c }
    }
  })

  const insertText = useCallback((text: string) => {
    const v = valueRef.current
    const el = ref.current
    const focused = el && document.activeElement === el
    const start = focused ? (el?.selectionStart ?? v.length) : Math.min(sel.current.start, v.length)
    const end = focused ? (el?.selectionEnd ?? v.length) : Math.min(sel.current.end, v.length)
    caretTo.current = start + text.length
    onChange(v.slice(0, start) + text + v.slice(end))
    el?.focus()
  }, [onChange])
  const insertRef = useRef(insertText); insertRef.current = insertText
  const labelRef = useRef(targetName); labelRef.current = targetName

  useEffect(() => {
    if (!reg) return
    const handle: PhHandle = { get label() { return labelRef.current }, insert: (t) => insertRef.current(t), focus: () => ref.current?.focus() }
    return reg.register(id, handle)
  }, [reg, id])

  const remember = () => {
    const el = ref.current
    if (el) sel.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
  }
  const look = (v: string, caret: number) => {
    const m = /\{([a-z_]*)$/.exec(v.slice(0, caret))
    setSug(m ? { from: caret - m[0].length, q: m[1], i: 0 } : null)
  }
  const accept = (name: string) => {
    if (!sug) return
    const v = valueRef.current
    const el = ref.current
    const to = el?.selectionStart ?? sug.from + 1 + sug.q.length
    const text = `{${name}}`
    caretTo.current = sug.from + text.length
    setSug(null)
    onChange(v.slice(0, sug.from) + text + v.slice(to))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !sug) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSug({ ...sug, i: Math.min(items.length - 1, sug.i + 1) }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSug({ ...sug, i: Math.max(0, sug.i - 1) }) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(items[Math.min(sug.i, items.length - 1)].name) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSug(null) }
  }
  const common = {
    id,
    ref,
    value,
    disabled,
    placeholder,
    spellCheck: false,
    autoComplete: 'off',
    'aria-invalid': !!error,
    'aria-describedby': `${id}-hint ${id}-err`,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      remember()
      onChange(e.target.value)
      look(e.target.value, e.target.selectionStart ?? e.target.value.length)
    },
    onFocus: () => reg?.focused(id),
    onBlur: () => { remember(); setSug(null) },
    onSelect: remember,
    onKeyUp: remember,
    onClick: remember,
    onKeyDown,
    role: open ? 'combobox' : undefined,
    'aria-expanded': open ? true : undefined,
    'aria-controls': open ? `${id}-sug` : undefined,
    'aria-autocomplete': open ? ('list' as const) : undefined,
    'aria-activedescendant': open && sug ? `${id}-sug-${items[Math.min(sug.i, items.length - 1)].name}` : undefined,
  }
  const cls = `${mono ? 'font-mono text-[13px]' : ''} ${error ? '!border-rose-500/40' : ''}`
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} def={def} onDefault={onDefault}
      counter={<Counter n={cpLen(value)} max={max} />}
      right={<PlaceholderPicker items={placeholders} compact label={label} disabled={disabled} target={() => targetName} onPick={(name) => insertText(`{${name}}`)} />}>
      <div className="relative">
        {multiline
          ? <textarea {...common} rows={rows} className={`${INPUT} resize-y min-h-[4.5rem] ${cls}`} />
          : <input {...common} type="text" className={`${INPUT} ${cls}`} />}
        {open && sug && (
          <div id={`${id}-sug`} role="listbox" aria-label="Placeholders" onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl bg-slate-900 border border-white/10 shadow-black/40 p-1 shadow-xl max-h-64 overflow-y-auto scrollbar-thin">
            {items.map((p, i) => (
              <button key={p.name} id={`${id}-sug-${p.name}`} type="button" role="option" aria-selected={i === sug.i} onClick={() => accept(p.name)} onMouseEnter={() => setSug({ ...sug, i })}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-baseline gap-2 min-w-0 ${i === sug.i ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                <code className="font-mono text-[12px] text-emerald-300 shrink-0">{`{${p.name}}`}</code>
                <span className="text-xs text-slate-300 shrink-0">{p.label}</span>
                <span className="text-[11px] text-slate-500 truncate font-mono min-w-0">{p.example.trim() === '' ? '(empty)' : p.example}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </FieldShell>
  )
}

// ---------------------------------------------------------------------------
// Scenario names as tokens
// ---------------------------------------------------------------------------

export interface TokenSuggestion { value: string; hint?: string }

/** chips for the names chosen, an input that offers the installed scenarios and takes anything that is a valid name or prefix */
export function TokenInput({ id, label, values, onChange, suggestions, error, hint, disabled = false, max = LIM.list, placeholder }: {
  id: string; label: string; values: string[]; onChange: (v: string[]) => void; suggestions: TokenSuggestion[]; error?: string; hint?: ReactNode; disabled?: boolean; max?: number; placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const [local, setLocal] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const items = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const pool = suggestions.filter((s) => !values.includes(s.value))
    const hits = q ? pool.filter((s) => s.value.toLowerCase().includes(q) || (s.hint ?? '').toLowerCase().includes(q)) : pool
    // a prefix that covers several scenarios comes first, then the names that start with what was typed
    const rank = (s: TokenSuggestion) => (s.value.endsWith('*') ? 0 : 2) + (s.value.toLowerCase().includes(`/${q}`) || s.value.toLowerCase().startsWith(q) ? 0 : 1)
    return hits.sort((a, b) => rank(a) - rank(b) || a.value.localeCompare(b.value)).slice(0, 8)
  }, [draft, suggestions, values])
  const full = values.length >= max

  const add = (raw: string): boolean => {
    const tokens = raw.split(/[\s,;]+/).filter((t) => t)
    if (tokens.length === 0) return true
    const next = [...values]
    for (const t of tokens) {
      const bad = patternProblem(t)
      if (bad) { setLocal(bad); setDraft(t); return false }
      if (!next.includes(t)) next.push(t)
      if (next.length > max) { setLocal(`Up to ${max} names`); return false }
    }
    setLocal(''); setDraft(''); setIdx(-1)
    onChange(next)
    return true
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx((i) => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(-1, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && idx >= 0 && items[idx]) add(items[idx].value); else if (draft.trim()) add(draft) }
    else if ((e.key === ',' || e.key === ' ' || e.key === ';') && draft.trim()) { e.preventDefault(); add(draft) }
    else if (e.key === 'Backspace' && draft === '' && values.length > 0) onChange(values.slice(0, -1))
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
  }
  const shown = error || local
  return (
    <FieldShell id={id} label={label} error={shown || undefined} hint={hint} counter={<span className={`text-[11px] tabular-nums ${full ? 'text-amber-300' : 'text-slate-500'}`}>{values.length}/{max}</span>}>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label={`${label}: chosen`}>
          {values.map((v) => (
            <li key={v} className={`inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-md border text-xs font-mono ${patternProblem(v) ? 'bg-rose-500/10 border-rose-500/25 text-rose-300' : 'bg-white/[0.06] border-white/10 text-slate-200'}`}>
              <span className="truncate max-w-[16rem]" title={v}>{v}</span>
              {!disabled && <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} title={`Remove ${v}`} className="h-7 w-7 rounded inline-flex items-center justify-center text-slate-500 hover:text-slate-100 hover:bg-white/10"><X size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input id={id} type="text" value={draft} disabled={disabled || full} placeholder={full ? `The list is full (${max} names)` : (placeholder ?? 'Type a name or pick one, then press Enter')} autoComplete="off" spellCheck={false}
          className={`${INPUT} font-mono text-[13px] ${shown ? '!border-rose-500/40' : ''}`} aria-invalid={!!shown} aria-describedby={`${id}-hint ${id}-err`}
          role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && idx >= 0 && items[idx] ? `${id}-opt-${idx}` : undefined}
          onChange={(e) => { setDraft(e.target.value); setLocal(''); setOpen(true); setIdx(-1) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); if (draft.trim()) add(draft) }}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); add(t) } }}
          onKeyDown={onKey} />
        {open && items.length > 0 && !disabled && (
          <div id={`${id}-list`} role="listbox" aria-label={`${label}: suggestions`} onMouseDown={(e) => e.preventDefault()} className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl bg-slate-900 border border-white/10 shadow-black/40 p-1 shadow-xl max-h-64 overflow-y-auto scrollbar-thin">
            {items.map((s, i) => (
              <button key={s.value} id={`${id}-opt-${i}`} type="button" role="option" aria-selected={i === idx} onClick={() => add(s.value)} onMouseEnter={() => setIdx(i)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg min-w-0 ${i === idx ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                <span className="block font-mono text-[12px] text-slate-100 truncate">{s.value}</span>
                {s.hint && <span className="block text-[11px] text-slate-500 truncate">{s.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </FieldShell>
  )
}

// ---------------------------------------------------------------------------
// Numbers and colours
// ---------------------------------------------------------------------------

export function NumberField({ id, label, value, onChange, min, max, unit, hint, def, error, disabled }: {
  id: string; label: string; value: string; onChange: (v: string) => void; min: number; max: number; unit?: string; hint: ReactNode; def: string; error?: string; disabled?: boolean
}) {
  return (
    <FieldShell id={id} label={label} error={error} hint={<>{hint} <span className="text-slate-500">From {min} to {max}.</span></>} def={def} onDefault={value !== def ? () => onChange(def) : undefined}>
      <div className="flex items-center gap-2">
        <input id={id} type="text" inputMode="numeric" autoComplete="off" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
          className={`${INPUT} max-w-[7rem] tabular-nums ${error ? '!border-rose-500/40' : ''}`} aria-invalid={!!error} aria-describedby={`${id}-hint ${id}-err`} />
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
    </FieldShell>
  )
}

export function ColorField({ mode, color, onMode, onColor, error, defColor, disabled }: { mode: ColorMode; color: string; onMode: (m: ColorMode) => void; onColor: (c: string) => void; error?: string; defColor: string; disabled?: boolean }) {
  const picker = useRef<HTMLInputElement>(null)
  const valid = /^#[0-9a-fA-F]{6}$/.test(color)
  const open = () => {
    const el = picker.current
    if (!el) return
    try { if (typeof el.showPicker === 'function') el.showPicker(); else el.click() } catch { el.click() }
  }
  return (
    <div className="space-y-3">
      <Segmented<ColorMode> value={mode} onChange={onMode} ariaLabel="How the colour is chosen" options={[{ value: 'auto', label: 'Automatic', disabled }, { value: 'fixed', label: 'One colour', disabled }]} className="w-fit" />
      {mode === 'auto' ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5" aria-label="The colours automatic picks">
          {AUTO_COLORS.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
              <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full shrink-0 border border-white/20" style={{ background: c.hex }} />
              <span className="truncate">{c.label}</span>
              <span className="font-mono text-[11px] text-slate-500">{c.hex}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={open} disabled={disabled} aria-label="Pick a colour" title="Pick a colour" className="h-10 w-10 rounded-lg border border-white/20 shrink-0 disabled:opacity-50" style={{ background: valid ? color : 'transparent' }} />
            <input ref={picker} type="color" tabIndex={-1} aria-hidden="true" value={valid ? color.toLowerCase() : '#e11d48'} onChange={(e) => onColor(e.target.value)} className="sr-only" />
            <label htmlFor="notify-color-hex" className="sr-only">Colour as a hex code</label>
            <input id="notify-color-hex" type="text" value={color} disabled={disabled} maxLength={7} spellCheck={false} autoComplete="off" onChange={(e) => onColor(e.target.value.startsWith('#') || e.target.value === '' ? e.target.value : `#${e.target.value}`)}
              className={`${INPUT} max-w-[8rem] font-mono ${error ? '!border-rose-500/40' : ''}`} aria-invalid={!!error} aria-describedby="notify-color-err" placeholder="#e11d48" />
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Colour presets">
              {COLOR_PRESETS.map((c) => (
                <button key={c.hex} type="button" disabled={disabled} onClick={() => onColor(c.hex)} aria-label={`${c.label} ${c.hex}`} aria-pressed={color.toLowerCase() === c.hex} title={`${c.label} ${c.hex}`}
                  className={`h-8 w-8 rounded-full border-2 shrink-0 transition-transform hover:scale-110 disabled:opacity-50 ${color.toLowerCase() === c.hex ? 'border-white' : 'border-transparent'}`} style={{ background: c.hex }} />
              ))}
            </div>
          </div>
          {error && <p id="notify-color-err" role="alert" className="text-[11px] text-rose-300 mt-1">{error}</p>}
          {color.toLowerCase() !== defColor.toLowerCase() && !disabled && <button type="button" onClick={() => onColor(defColor)} className="mt-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><RotateCcw size={10} /> Use the default colour ({defColor})</button>}
        </div>
      )}
    </div>
  )
}

/** a row of exclusive choices that wraps on a narrow screen (a Segmented would scroll sideways and hide the last ones) */
export function PillChoice<T extends string>({ value, onChange, options, ariaLabel, disabled = false }: { value: T; onChange: (v: T) => void; ariaLabel: string; disabled?: boolean; options: { value: T; label: string }[] }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(o.value)}
            className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>{o.label}</button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Choice cards (the webhook source)
// ---------------------------------------------------------------------------

export function ChoiceCards<T extends string>({ value, onChange, options, ariaLabel, disabled = false }: {
  value: T; onChange: (v: T) => void; ariaLabel: string; disabled?: boolean
  options: { value: T; title: string; text: string; foot?: ReactNode }[]
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const n = (i + step + options.length) % options.length
    onChange(options[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={disabled} onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
            className={`text-left min-w-0 rounded-xl border p-3 transition-colors disabled:opacity-60 ${on ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'}`}>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-3.5 w-3.5 rounded-full border shrink-0 flex items-center justify-center ${on ? 'border-emerald-400' : 'border-slate-500'}`}>{on && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}</span>
              <span className="text-sm font-medium text-slate-100">{o.title}</span>
            </span>
            <span className="block text-xs text-slate-500 mt-1.5 leading-relaxed">{o.text}</span>
            {o.foot && <span className="block mt-2 min-w-0">{o.foot}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The embed's fields
// ---------------------------------------------------------------------------

export function FieldsEditor({ fields, onChange, errors, max, placeholders, disabled, defFields }: {
  fields: FormField[]; onChange: (f: FormField[]) => void; errors: Errors; max: number; placeholders: CrowdSecPlaceholder[]; disabled?: boolean; defFields: number
}) {
  const focusKey = useRef<number | null>(null)
  useEffect(() => {
    if (focusKey.current !== null) { document.getElementById(`notify-field-${focusKey.current}-name`)?.focus(); focusKey.current = null }
  })
  const set = (i: number, patch: Partial<FormField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= fields.length) return
    const next = [...fields]; [next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-3">
      {fields.length === 0 && <p className="text-xs text-slate-500 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center">No fields. The message is the title and the description{defFields > 0 ? ` (the shipped message has ${defFields} fields)` : ''}.</p>}
      {fields.map((f, i) => (
        <div key={f.key} className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2" role="group" aria-label={`Field ${i + 1}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-300 mr-auto">Field {i + 1}</span>
            <div className="flex items-center gap-2">
              <Toggle id={`notify-field-${f.key}-inline`} checked={f.inline} onChange={(v) => set(i, { inline: v })} label={`Field ${i + 1} side by side`} disabled={disabled} />
              <label htmlFor={`notify-field-${f.key}-inline`} className="text-xs text-slate-500 cursor-pointer" title="Inline fields sit next to each other, up to three in a row">Side by side</label>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className={BTN_ICON_QUIET} disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move field ${i + 1} up`} title="Move up"><ArrowUp size={14} /></button>
              <button type="button" className={BTN_ICON_QUIET} disabled={disabled || i === fields.length - 1} onClick={() => move(i, 1)} aria-label={`Move field ${i + 1} down`} title="Move down"><ArrowDown size={14} /></button>
              <button type="button" className={`${BTN_ICON_QUIET} hover:!bg-rose-500/15 hover:!text-rose-300`} disabled={disabled} onClick={() => onChange(fields.filter((_, j) => j !== i))} aria-label={`Remove field ${i + 1}`} title="Remove this field"><Trash2 size={14} /></button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
            <PlaceholderInput id={`notify-field-${f.key}-name`} label="Name" target={`field ${i + 1} name`} value={f.name} onChange={(v) => set(i, { name: v })} max={LIM.fieldName} placeholders={placeholders} error={errors[`field.${i}.name`]} disabled={disabled} mono={false} />
            <PlaceholderInput id={`notify-field-${f.key}-value`} label="Value" target={`field ${i + 1} value`} value={f.value} onChange={(v) => set(i, { value: v })} max={LIM.fieldValue} placeholders={placeholders} error={errors[`field.${i}.value`]} disabled={disabled} multiline rows={2} />
          </div>
        </div>
      ))}
      {errors.fields && <p role="alert" className="text-[11px] text-rose-300">{errors.fields}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className={BTN_TOOLBAR_QUIET} disabled={disabled || fields.length >= max} onClick={() => { const k = newFieldKey(); focusKey.current = k; onChange([...fields, { key: k, name: '', value: '', inline: true }]) }}><Plus size={13} /> Add a field</button>
        <span className="text-[11px] text-slate-500 tabular-nums">{fields.length} of {max} fields{fields.length >= max ? '. That is the most Discord shows.' : ''}</span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">A field whose name or value ends up empty in a message (for example the first request of an SSH attack) is left out of that message.</p>
    </div>
  )
}
