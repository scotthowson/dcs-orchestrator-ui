// =============================================================================
// Settings tab — what its cards share: the arithmetic of ban lengths, the rule
// for a scenario pattern, the checks a draft must pass before it is sent, the
// sentence that sums the profile up, and the small controls (a length picker
// that knows when its text is wrong, a scenario box with suggestions, the notice
// box). The checks repeat the API's own rules (_cs_profile_validate in
// .lib/crowdsec-config.sh) so a mistake is caught before the request goes out;
// the server checks again and its words are shown as they come.
// =============================================================================

import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, X, type LucideIcon } from 'lucide-react'
import { useOutside, parseDuration } from './kit'
import { HINT, INPUT } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { type Tone } from '../../lib/tone'
// ---------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------

/** CrowdSec bans by itself for a year at most; only a person can ban for ten */
export const YEAR_SECONDS = 365 * 86400
export const TEN_YEARS_SECONDS = 315360000
/** the length a manual ban gets when nothing was ever chosen (the API's own fallback) */
export const MANUAL_DEFAULT = '4h'
/** what the "longest ban" picker offers: a ceiling, not a ban length, so it has its own presets */
export const CAP_PRESETS = ['24h', '3d', '7d', '14d', '30d', '90d']
const PRESET_LABEL: Record<string, string> = { '30m': '30 min', '1h': '1 h', '4h': '4 h', '12h': '12 h', '24h': '24 h', '3d': '3 d', '7d': '7 d', '14d': '14 d', '30d': '30 d', '90d': '90 d' }

/** 4 hours, 7 days, 90 minutes, 2 hours 30 minutes: a number of seconds in words */
export function wordsOf(sec: number): string {
  const n = (x: number, unit: string) => `${x.toLocaleString()} ${unit}${x === 1 ? '' : 's'}`
  if (sec >= 86400 && sec % 86400 === 0) {
    const d = sec / 86400
    return d >= 365 && d % 365 === 0 ? n(d / 365, 'year') : n(d, 'day')
  }
  if (sec >= 3600 && sec % 3600 === 0) return n(sec / 3600, 'hour')
  if (sec % 60 === 0) {
    const m = sec / 60
    return m < 120 ? n(m, 'minute') : `${n(Math.floor(m / 60), 'hour')} ${n(m % 60, 'minute')}`
  }
  return n(sec, 'second')
}
/** "168h" / "7d" → "7 days"; text that is not a length stays as typed */
export function lengthWords(v: string): string {
  const s = parseDuration(v)
  return s === null ? v.trim() || '—' : wordsOf(s)
}
/** the two texts mean the same length ("7d" and "168h"); text that is not a length compares as text */
export function sameLength(a: string, b: string): boolean {
  const x = parseDuration(a), y = parseDuration(b)
  return x !== null && y !== null ? x === y : a.trim() === b.trim()
}
/** the picker shows "7 d" for "168h": a server value becomes the preset that means the same */
export function presetFor(v: string, presets: string[]): string {
  const s = parseDuration(v)
  return (s !== null && presets.find((p) => parseDuration(p) === s)) || v
}
/** why a typed length cannot be used (nothing when it can) */
export function lengthProblem(v: string, max: number): string | undefined {
  const t = v.replace(/\s+/g, '')
  if (!t) return 'Choose a length.'
  const s = parseDuration(t)
  if (s === null) return 'Use minutes, hours, days or weeks, like 30m, 4h, 7d or 2w.'
  if (t.length > 24) return 'That is too long to be a length. Something like 1d12h is enough.'
  if (s < 60) return 'A ban lasts at least 1 minute.'
  if (s > max) return max >= TEN_YEARS_SECONDS ? 'A manual ban can last ten years at most.' : 'CrowdSec bans by itself for a year (365 days) at most. Use a manual ban for longer.'
  return undefined
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n.toLocaleString()}${s[(v - 20) % 10] || s[v] || s[0]}`
}
/** what repeat-offender escalation does with these two numbers: "4 hours, 8 hours, 12 hours and so on, up to 30 days (from the 180th ban)" */
export function ladderWords(base: string, cap: string): string | null {
  const b = parseDuration(base), c = parseDuration(cap)
  if (b === null || c === null || b < 60 || c < b) return null
  const n = Math.ceil(c / b)
  if (n <= 1) return `every ban already lasts ${wordsOf(c)}`
  // every step in the unit the base is written in ("12 hours, 24 hours, 36 hours", not "12 hours, 1 day, 36 hours")
  const unit = b % 86400 === 0 ? 86400 : b % 3600 === 0 ? 3600 : 60
  const name = unit === 86400 ? 'day' : unit === 3600 ? 'hour' : 'minute'
  const step = (sec: number) => (sec % unit === 0 ? `${(sec / unit).toLocaleString()} ${name}${sec / unit === 1 ? '' : 's'}` : wordsOf(sec))
  const seq: string[] = []
  for (let i = 1; i <= Math.min(3, n); i++) seq.push(step(Math.min(i * b, c)))
  return n > 3 ? `${seq.join(', ')} and so on, up to ${wordsOf(c)} (from the ${ordinal(n)} ban)` : `${seq.join(', ')} (${wordsOf(c)} is the most, from the ${ordinal(n)} ban)`
}
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Scenarios: the pattern rule, plain names, the draft
// ---------------------------------------------------------------------------

/** the API's rule (_cs_valid_pattern): a scenario name, or a prefix that ends in * */
export const PATTERN_RE = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,119}\*?$/
/** the plain-language names the rest of the page uses (the same table the API labels alerts with) */
const LABELS: [string, string][] = [
  ['crowdsecurity/ssh', 'SSH brute force'], ['crowdsecurity/http-cve', 'Exploit attempt'], ['crowdsecurity/CVE', 'Exploit attempt'],
  ['crowdsecurity/http-sqli', 'SQL injection probe'], ['crowdsecurity/http-xss', 'Cross-site scripting probe'], ['crowdsecurity/http-path-traversal', 'Path traversal probe'],
  ['crowdsecurity/http-backdoors', 'Backdoor probe'], ['crowdsecurity/http-admin-interface', 'Admin panel probe'], ['crowdsecurity/http-bad-user-agent', 'Known bad scanner'],
  ['crowdsecurity/http-probing', 'Web probing'], ['crowdsecurity/http-sensitive-files', 'Sensitive file probe'], ['crowdsecurity/http-crawl', 'Aggressive crawler'],
  ['crowdsecurity/http-generic-bf', 'Web login brute force'], ['crowdsecurity/http-open-proxy', 'Open proxy probe'], ['crowdsecurity/http-wordpress', 'WordPress attack'],
  ['crowdsecurity/http-dos', 'HTTP flood'], ['crowdsecurity/nginx-req-limit', 'Request flood'], ['LePresidente/', 'Application brute force'], ['crowdsecurity/traefik', 'Traefik abuse'],
]
export function scenarioLabel(pattern: string): string | null {
  return LABELS.find(([prefix]) => pattern.startsWith(prefix))?.[1] ?? null
}
export function shortName(pattern: string): string { return pattern.replace(/^crowdsecurity\//, '') }
export interface ScenarioInfo { name: string; description: string }
/** how many installed scenarios a pattern covers (a name: 0 or 1; a prefix: any number) */
export function matchCount(pattern: string, scenarios: ScenarioInfo[]): number {
  return pattern.endsWith('*') ? scenarios.filter((s) => s.name.startsWith(pattern.slice(0, -1))).length : scenarios.filter((s) => s.name === pattern).length
}

export interface OverrideRow { id: number; pattern: string; duration: string }
/** the form: everything the tab edits. Values are texts as typed; the checks below say whether they can be sent. */
export interface Draft {
  duration: string
  range_duration: string
  escalate: { enabled: boolean; max: string }
  overrides: OverrideRow[]
  manual: string
}
let rowSeq = 0
export function newRowId(): number { return ++rowSeq }

export function draftFrom(s: { profile: { duration: string; range_duration?: string; escalate?: { enabled: boolean; max: string }; overrides?: { pattern: string; duration: string }[] }; manual_duration?: string; presets?: string[] }): Draft {
  const p = s.profile
  const presets = s.presets ?? []
  return {
    duration: presetFor(p.duration, presets),
    range_duration: presetFor(p.range_duration ?? p.duration, presets),
    escalate: { enabled: !!p.escalate?.enabled, max: presetFor(p.escalate?.max ?? '720h', CAP_PRESETS) },
    overrides: (p.overrides ?? []).map((o) => ({ id: newRowId(), pattern: o.pattern, duration: presetFor(o.duration, presets) })),
    manual: presetFor(s.manual_duration || MANUAL_DEFAULT, presets),
  }
}
export function sameProfile(a: Draft, b: Draft): boolean {
  if (!sameLength(a.duration, b.duration) || !sameLength(a.range_duration, b.range_duration)) return false
  if (a.escalate.enabled !== b.escalate.enabled) return false
  if (a.escalate.enabled && !sameLength(a.escalate.max, b.escalate.max)) return false
  if (a.overrides.length !== b.overrides.length) return false
  return a.overrides.every((o, i) => o.pattern.trim() === b.overrides[i].pattern.trim() && sameLength(o.duration, b.overrides[i].duration))
}
export function sameDraft(a: Draft, b: Draft): boolean { return sameProfile(a, b) && sameLength(a.manual, b.manual) }
export type Field = 'duration' | 'range' | 'escalate' | 'overrides' | 'manual'
/** which of the five settings differ between two drafts */
export function changedFields(a: Draft, b: Draft): Set<Field> {
  const out = new Set<Field>()
  if (!sameLength(a.duration, b.duration)) out.add('duration')
  if (!sameLength(a.range_duration, b.range_duration)) out.add('range')
  if (a.escalate.enabled !== b.escalate.enabled || (a.escalate.enabled && !sameLength(a.escalate.max, b.escalate.max))) out.add('escalate')
  if (!sameProfile({ ...a, duration: b.duration, range_duration: b.range_duration, escalate: b.escalate }, b)) out.add('overrides')
  if (!sameLength(a.manual, b.manual)) out.add('manual')
  return out
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export interface RowProblem { pattern?: string; length?: string; warn?: string }
export interface Problems {
  length?: string
  range?: string
  cap?: string
  manual?: string
  rowCount?: string
  rows: Record<number, RowProblem>
  /** not a mistake, but worth knowing: the cap cuts a longer length */
  capNote?: string
  /** how many things stop the draft from being sent */
  hard: number
}

export function checkDraft(d: Draft, o: { autoMax: number; manualMax: number; maxRows: number; scenarios: ScenarioInfo[] }): Problems {
  const p: Problems = { rows: {}, hard: 0 }
  const hard = () => { p.hard++ }
  p.length = lengthProblem(d.duration, o.autoMax); if (p.length) hard()
  p.range = lengthProblem(d.range_duration, o.autoMax); if (p.range) hard()
  if (d.escalate.enabled) {
    p.cap = lengthProblem(d.escalate.max, o.autoMax)
    if (!p.cap && !p.length) {
      const cap = parseDuration(d.escalate.max) as number, base = parseDuration(d.duration) as number
      if (cap < base) p.cap = `The longest ban (${wordsOf(cap)}) is shorter than the default ban (${wordsOf(base)}). Raise the maximum or shorten the default.`
    }
    if (p.cap) hard()
  }
  p.manual = lengthProblem(d.manual, o.manualMax); if (p.manual) hard()
  if (d.overrides.length > o.maxRows) { p.rowCount = `At most ${o.maxRows} scenario lengths.`; hard() }
  const seen = new Map<string, number>()
  d.overrides.forEach((r, i) => {
    const rp: RowProblem = {}
    const pat = r.pattern.trim()
    if (!pat) rp.pattern = 'Choose or type a scenario.'
    else if (!PATTERN_RE.test(pat)) rp.pattern = 'Use a scenario name like crowdsecurity/ssh-bf, or a prefix ending in * like crowdsecurity/ssh-*.'
    else if (seen.has(pat)) rp.pattern = `Already used in row ${(seen.get(pat) as number) + 1}. A scenario can have one length.`
    else {
      seen.set(pat, i)
      const above = d.overrides.slice(0, i).find((e) => { const ep = e.pattern.trim(); return ep.endsWith('*') && PATTERN_RE.test(ep) && pat.startsWith(ep.slice(0, -1)) })
      if (above) rp.warn = `Never used: ${above.pattern.trim()} above it already matches. The first matching row wins.`
      else if (o.scenarios.length > 0 && matchCount(pat, o.scenarios) === 0) rp.warn = 'No installed scenario has this name, so it does nothing for now.'
    }
    rp.length = lengthProblem(r.duration, o.autoMax)
    if (rp.pattern) hard()
    if (rp.length) hard()
    if (rp.pattern || rp.length || rp.warn) p.rows[r.id] = rp
  })
  if (d.escalate.enabled && !p.cap && !p.length) {
    const cap = parseDuration(d.escalate.max) as number
    const cut: string[] = []
    const rg = parseDuration(d.range_duration)
    if (rg !== null && rg > cap && !p.range) cut.push(`the network length (${wordsOf(rg)})`)
    const over = d.overrides.filter((r) => { const s = parseDuration(r.duration); return s !== null && s > cap }).length
    if (over > 0) cut.push(over === 1 ? 'one scenario length' : `${over} scenario lengths`)
    if (cut.length) p.capNote = `The longest ban is shorter than ${cut.join(' and ')}, so those bans are cut to ${wordsOf(cap)}.`
  }
  return p
}

/** the profile the API takes: every field, so the file that comes out is exactly the form */
export function profileOf(d: Draft, fallbackCap: string): { duration: string; range_duration: string; escalate: { enabled: boolean; max: string }; overrides: { pattern: string; duration: string }[] } {
  const capOk = !lengthProblem(d.escalate.max, YEAR_SECONDS)
  return {
    duration: d.duration.trim(),
    range_duration: d.range_duration.trim(),
    escalate: { enabled: d.escalate.enabled, max: capOk ? d.escalate.max.trim() : fallbackCap },
    overrides: d.overrides.map((r) => ({ pattern: r.pattern.trim(), duration: r.duration.trim() })),
  }
}

// ---------------------------------------------------------------------------
// The sentence
// ---------------------------------------------------------------------------

function B({ children }: { children: ReactNode }) { return <strong className="font-semibold text-slate-100">{children}</strong> }
/** "Attackers are banned for 4 hours; SSH brute force for 1 day; a repeat offender for up to 7 days." */
export function ProfileSentence({ d }: { d: Draft }) {
  const len = (v: string) => { const s = parseDuration(v); return s === null ? '…' : wordsOf(s) }
  const rows = d.overrides.filter((r) => r.pattern.trim() && PATTERN_RE.test(r.pattern.trim()))
  const same = sameLength(d.duration, d.range_duration)
  return (
    <p className="text-sm text-slate-300 leading-relaxed" data-testid="profile-sentence">
      Attackers are banned for <B>{len(d.duration)}</B>
      {!same && <>, a whole network for <B>{len(d.range_duration)}</B></>}
      {rows.slice(0, 3).map((r) => <span key={r.id}>; {scenarioLabel(r.pattern.trim()) ?? <span className="font-mono text-xs">{shortName(r.pattern.trim())}</span>} for <B>{len(r.duration)}</B></span>)}
      {rows.length > 3 && <>; {rows.length - 3} more kinds of attack have a length of their own</>}
      {d.escalate.enabled && <>; a repeat offender is banned longer each time, up to <B>{len(d.escalate.max)}</B></>}.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Layout: one setting per row, a notice box
// ---------------------------------------------------------------------------

/** a row of the settings list: what it is and what it does on the left, the control (and its default) on the right */
export function Setting({ title, help, changed = false, hint, children, id }: { title: string; help: ReactNode; changed?: boolean; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="grid gap-x-8 gap-y-3 py-4 first:pt-0 last:pb-0 xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]" data-setting={id}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-slate-200">{title}</h3>
          {changed && <span className="text-[10px] font-medium leading-none px-1.5 py-1 rounded-md border bg-amber-500/10 text-amber-300 border-amber-500/20">changed</span>}
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{help}</p>
      </div>
      <div className="min-w-0">
        {children}
        {hint && <p className={HINT}>{hint}</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/**
 * A ban length: preset chips, a Custom chip and a box for the text. Like the kit's DurationPicker, but the
 * text is the parent's (whatever was typed, even when it is wrong), so the form can refuse to save while a length is
 * not a length; and a server value such as 168h lights the 7 d chip instead of opening Custom.
 * Give it a new key when the parent replaces the value from outside (Discard, a save).
 */
export function LengthPicker({ value, onChange, presets, ariaLabel, disabled = false, error, hint }: {
  value: string; onChange: (v: string) => void; presets: string[]; ariaLabel: string; disabled?: boolean; error?: string; hint?: ReactNode
}) {
  const sec = parseDuration(value)
  const hit = sec === null ? undefined : presets.find((p) => parseDuration(p) === sec)
  const [custom, setCustom] = useState(!hit)
  const showCustom = custom || !hit
  const boxId = useId()
  const chip = (on: boolean) => `h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`
  return (
    <div>
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" disabled={disabled} aria-pressed={!showCustom && hit === p} className={chip(!showCustom && hit === p)} onClick={() => { setCustom(false); onChange(p) }}>{PRESET_LABEL[p] ?? p}</button>
        ))}
        <button type="button" disabled={disabled} aria-pressed={showCustom} className={chip(showCustom)} onClick={() => setCustom(true)}>Custom</button>
      </div>
      {showCustom && (
        <div className="mt-2">
          <input
            id={boxId}
            className={`${INPUT} max-w-[14rem] ${error ? '!border-rose-500/40' : ''}`}
            value={value}
            disabled={disabled}
            placeholder="e.g. 90m, 12h, 10d, 2w"
            aria-label={`${ariaLabel}: custom length`}
            aria-invalid={!!error}
            aria-describedby={`${boxId}-note`}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
          />
          <p id={`${boxId}-note`} className={`${HINT} ${error ? '!text-rose-300' : ''}`} role={error ? 'alert' : undefined}>
            {error ?? (sec !== null ? `That is ${wordsOf(sec)}. Minutes (m), hours (h), days (d) or weeks (w); combine them, like 1d12h.` : 'Minutes (m), hours (h), days (d) or weeks (w); combine them, like 1d12h.')}
          </p>
        </div>
      )}
      {!showCustom && error && <p className={`${HINT} !text-rose-300`} role="alert">{error}</p>}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  )
}

/** the small version for a table row: a drop-down of the presets and, for anything else, a text box */
export function CompactLength({ value, onChange, presets, ariaLabel, disabled = false, invalid = false }: { value: string; onChange: (v: string) => void; presets: string[]; ariaLabel: string; disabled?: boolean; invalid?: boolean }) {
  const sec = parseDuration(value)
  const hit = sec === null ? undefined : presets.find((p) => parseDuration(p) === sec)
  const [custom, setCustom] = useState(!hit)
  const showCustom = custom || !hit
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="relative shrink-0">
        <select
          aria-label={ariaLabel}
          disabled={disabled}
          value={showCustom ? '__custom' : (hit as string)}
          onChange={(e) => { if (e.target.value === '__custom') setCustom(true); else { setCustom(false); onChange(e.target.value) } }}
          className={`${INPUT} !h-9 !text-xs pr-8 appearance-none cursor-pointer w-[8.5rem] ${invalid ? '!border-rose-500/40' : ''}`}
        >
          {presets.map((p) => <option key={p} value={p} className="bg-slate-900 text-slate-200">{wordsOf(parseDuration(p) ?? 0)}</option>)}
          <option value="__custom" className="bg-slate-900 text-slate-200">Custom…</option>
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true" />
      </div>
      {showCustom && (
        <input
          className={`${INPUT} !h-9 !text-xs w-28 ${invalid ? '!border-rose-500/40' : ''}`}
          value={value}
          disabled={disabled}
          placeholder="e.g. 2d"
          aria-label={`${ariaLabel}: custom length`}
          aria-invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

/** installed scenarios the box suggests first when it is empty (the ones people usually want a length for) */
const POPULAR = ['crowdsecurity/ssh-bf', 'crowdsecurity/ssh-slow-bf', 'crowdsecurity/http-probing', 'crowdsecurity/http-bad-user-agent', 'crowdsecurity/http-backdoors-attempts', 'crowdsecurity/http-sensitive-files', 'crowdsecurity/http-crawl-non_statics', 'crowdsecurity/http-generic-bf']
interface Suggestion { value: string; hint: string }
/** the longest text every name starts with */
function commonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let p = names[0]
  for (const n of names) { while (!n.startsWith(p)) p = p.slice(0, -1) }
  return p
}
function suggest(text: string, scenarios: ScenarioInfo[]): { list: Suggestion[]; more: number } {
  const q = text.trim().replace(/\*$/, '')
  const hint = (s: ScenarioInfo) => scenarioLabel(s.name) ? `${scenarioLabel(s.name)} · ${s.description}` : s.description
  let hits: ScenarioInfo[]
  if (q) {
    const needle = q.toLowerCase()
    const all = scenarios.filter((s) => s.name.toLowerCase().includes(needle))
    hits = [...all.filter((s) => s.name.toLowerCase().startsWith(needle)), ...all.filter((s) => !s.name.toLowerCase().startsWith(needle))]
  } else {
    hits = [...POPULAR.map((n) => scenarios.find((s) => s.name === n)).filter((s): s is ScenarioInfo => !!s), ...scenarios.filter((s) => !POPULAR.includes(s.name))]
  }
  const list: Suggestion[] = []
  // prefixes that cover several scenarios at once: what was typed, and what all the matches share ("ssh" → crowdsecurity/ssh-*)
  if (q.length >= 2 && !text.trim().endsWith('*')) {
    const globs = new Set<string>()
    if (scenarios.filter((s) => s.name.startsWith(q)).length >= 2) globs.add(q)
    const lcp = commonPrefix(hits.map((s) => s.name))
    if (hits.length >= 2 && lcp.includes('/') && lcp.length > lcp.indexOf('/') + 1) globs.add(lcp)
    for (const g of globs) {
      const covered = scenarios.filter((s) => s.name.startsWith(g)).length
      if (covered >= 2) list.push({ value: `${g}*`, hint: `All ${covered} installed scenarios that start with ${g}` })
    }
  }
  const room = 8 - list.length
  for (const s of hits.slice(0, room)) list.push({ value: s.name, hint: hint(s) })
  return { list, more: Math.max(0, hits.length - room) }
}

/** the scenario of an override: free text, with the installed scenarios (and prefixes that cover several) offered as you type */
export function ScenarioInput({ value, onChange, scenarios, ariaLabel, invalid = false, disabled = false, autoFocus = false }: { value: string; onChange: (v: string) => void; scenarios: ScenarioInfo[]; ariaLabel: string; invalid?: boolean; disabled?: boolean; autoFocus?: boolean }) {
  const listId = useId()
  const wrap = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const { list, more } = useMemo(() => suggest(value, scenarios), [value, scenarios])
  useOutside(wrap, () => setOpen(false), open)
  const shown = open && list.length > 0
  const pick = (v: string) => { onChange(v); setOpen(false); setActive(-1) }
  return (
    <div ref={wrap} className="relative min-w-0">
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        className={`${INPUT} !h-9 font-mono !text-xs ${invalid ? '!border-rose-500/40' : ''}`}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="crowdsecurity/ssh-bf or crowdsecurity/ssh-*"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (list.length ? (a + 1) % list.length : -1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((a) => (list.length ? (a <= 0 ? list.length - 1 : a - 1) : -1)) }
          else if (e.key === 'Enter' && shown && active >= 0) { e.preventDefault(); pick(list[active].value) }
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" tabIndex={-1} aria-label="Installed scenarios" onMouseDown={(e) => e.preventDefault()} className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto scrollbar-thin rounded-xl bg-slate-900 border border-white/10 p-1 shadow-xl">
          {list.map((o, i) => (
            <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(o.value) }} onMouseEnter={() => setActive(i)} className={`px-2.5 py-1.5 rounded-lg cursor-pointer ${i === active ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              <span className="block font-mono text-xs text-slate-100 break-all">{o.value}</span>
              <span className="block text-[11px] text-slate-500 truncate">{o.hint}</span>
            </li>
          ))}
          {more > 0 && <li role="presentation" className="px-2.5 py-1 text-[11px] text-slate-500">{more} more — keep typing to narrow it down</li>}
        </ul>
      )}
    </div>
  )
}
