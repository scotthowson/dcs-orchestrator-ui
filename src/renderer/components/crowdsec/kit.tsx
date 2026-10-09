// =============================================================================
// CrowdSec page kit — what only the CrowdSec tabs need: the live clock, times
// and durations, country flags and names, the page's context, the duration
// picker. The look is the dashboard's own: buttons and headings from lib/ui,
// fields from lib/fieldStyles, the page card from lib/pageKit, colours by tone
// (lib/tone), and the shared Pill, Sheet, Segmented, StatTile, SectionHeader,
// CopyButton and Notice of components/common.
// =============================================================================

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { INPUT, HINT, FIELD_SM } from '../../lib/fieldStyles'
import type { Tone } from '../../lib/tone'
import { ApiError } from '../../api/client'
import type { CrowdSecStatusResponse } from '../../../shared/types'

// ---------------------------------------------------------------------------
// The two small controls every list tab shares
// ---------------------------------------------------------------------------

/** how long ago, counting on by itself; the exact time is in the tooltip */
export function Ago({ at, className = '' }: { at: string | null | undefined; className?: string }) {
  const now = useNow()
  return <span className={`tabular-nums ${className}`} title={at ? fmtTime(at) : undefined}>{fmtAgo(at, now)}</span>
}

/** a filter of a list as a native select: toolbar height, emerald while it narrows the list (`plain`: never) */
export function FilterSelect({ id, label, value, onChange, children, plain = false, className = 'sm:min-w-[8.5rem]' }: {
  id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode; plain?: boolean; className?: string
}) {
  return (
    <div className="relative min-w-0 sm:shrink-0">
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full ${FIELD_SM} pr-8 appearance-none cursor-pointer ${className} ${value && !plain ? '!border-emerald-500/30 !text-emerald-300' : ''}`}>{children}</select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time: one shared clock, durations and "ago"
// ---------------------------------------------------------------------------

const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | null = null
let clockNow = Date.now()
function clockSubscribe(cb: () => void): () => void {
  if (clockListeners.size === 0) {
    clockNow = Date.now()
    clockTimer = setInterval(() => { clockNow = Date.now(); clockListeners.forEach((l) => l()) }, 1000)
  }
  clockListeners.add(cb)
  return () => {
    clockListeners.delete(cb)
    if (clockListeners.size === 0 && clockTimer) { clearInterval(clockTimer); clockTimer = null }
  }
}
/** the current time in ms, ticking once a second for everyone who asks (one timer serves a whole table of countdowns) */
export function useNow(): number {
  return useSyncExternalStore(clockSubscribe, () => clockNow)
}

/** 14387 → "3h 59m", 4000 → "1h 06m", 300 → "5m 00s", 45 → "45s", 190000 → "2d 4h" */
export function fmtLeft(sec: number): string {
  if (!Number.isFinite(sec)) return '—'
  if (sec <= 0) return 'expired'
  if (sec >= 365 * 86400) return 'over a year'
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}
/** an ISO stamp or epoch seconds → "12s ago", "5m ago", "3h ago", "2d ago" */
export function fmtAgo(t: string | number | null | undefined, now = Date.now()): string {
  if (t === null || t === undefined || t === '') return 'never'
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t)
  if (!Number.isFinite(ms)) return '—'
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n >= 100000) return `${Math.round(n / 1000)}k`
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}
/** "4h" → "4 hours", "90m" → "90 minutes", "168h" → "7 days", "87600h" → "10 years" */
export function humanDuration(d: string): string {
  const m = /^(\d+)([mh])$/.exec(d)
  if (!m) return d
  let n = parseInt(m[1], 10)
  if (m[2] === 'm') return n === 1 ? '1 minute' : n < 120 ? `${n} minutes` : `${Math.round(n / 60)} hours`
  if (n >= 8760 && n % 8760 === 0) { n /= 8760; return n === 1 ? '1 year' : `${n} years` }
  if (n >= 48 && n % 24 === 0) return `${n / 24} days`
  return n === 1 ? '1 hour' : `${n} hours`
}
export function fmtTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—'
  const ms = typeof iso === 'number' ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Countries: a name from the browser's own tables, a flag where the platform can draw one, a code chip everywhere
// ---------------------------------------------------------------------------

let regionNames: Intl.DisplayNames | null | undefined
export function countryName(code: string): string {
  const cc = (code || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { regionNames = null }
  }
  try { return regionNames?.of(cc) || cc } catch { return cc }
}
export function flagEmoji(code: string): string {
  const cc = (code || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
let flagsOk: boolean | null = null
/** Windows draws a regional-indicator pair as two letters in a box: a real flag paints colour, letters paint grey */
export function flagsSupported(): boolean {
  if (flagsOk !== null) return flagsOk
  try {
    const c = document.createElement('canvas')
    c.width = 40; c.height = 32
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return (flagsOk = true)
    ctx.textBaseline = 'top'
    ctx.font = '24px sans-serif'
    ctx.fillText(flagEmoji('DE'), 0, 2)
    const px = ctx.getImageData(0, 0, 40, 32).data
    let coloured = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 128 && (Math.abs(px[i] - px[i + 1]) > 50 || Math.abs(px[i + 1] - px[i + 2]) > 50)) coloured++
    }
    flagsOk = coloured > 12
  } catch { flagsOk = true }
  return flagsOk
}

/** [🇩🇪 DE] Germany — the code chip always, the flag when the platform draws flags, the name when asked */
export function Country({ code, name = false, className = '' }: { code?: string | null; name?: boolean; className?: string }) {
  const cc = (code || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return <span className={`text-slate-500 text-xs ${className}`} title="The country is not known">—</span>
  const full = countryName(cc)
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`} title={full}>
      <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-white/[0.06] border border-white/10 text-[10px] font-mono font-semibold text-slate-300 shrink-0">
        {flagsSupported() && <span aria-hidden="true" className="text-[12px] leading-none">{flagEmoji(cc)}</span>}
        {cc}
      </span>
      {name && <span className="text-xs text-slate-300 truncate">{full}</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// What the tabs share
// ---------------------------------------------------------------------------

export interface CsContext {
  /** null = this server; a member id = a VM reached through the hub */
  member: string | null
  memberName: string
  isAdmin: boolean
  status: CrowdSecStatusResponse | null
  refreshStatus: () => void
  /** open a tab; `search` pre-fills its search box */
  goTab: (tab: string, search?: string) => void
}
export const CsCtx = createContext<CsContext>({ member: null, memberName: '', isAdmin: false, status: null, refreshStatus: () => {}, goTab: () => {} })
export function useCs(): CsContext { return useContext(CsCtx) }

/** the message of an API error, in words */
export function errMsg(e: unknown, fallback = 'The request failed'): string {
  if (e instanceof ApiError) return e.message || fallback
  if (e instanceof Error) return e.message || fallback
  return fallback
}
/** structured detail of an API error (a `reason`, `rolled_back` …) */
export function errData(e: unknown): Record<string, unknown> {
  return e instanceof ApiError && e.data ? e.data : {}
}

/** an address or network as the API accepts it, checked before the request goes out (the server checks again) */
export function looksLikeTarget(v: string): boolean {
  const t = v.trim()
  if (!t) return false
  const [addr, bits, extra] = t.split('/')
  if (extra !== undefined) return false
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return addr.split('.').every((o) => Number(o) <= 255) && (bits === undefined || Number(bits) <= 32)
  if (addr.includes(':') && /^[0-9a-fA-F:.]+$/.test(addr) && addr.length <= 45) return bits === undefined || Number(bits) <= 128
  return false
}

// ---------------------------------------------------------------------------
// Words for the origin of a ban and the family of an attack
// ---------------------------------------------------------------------------

export function originLabel(origin: string): string {
  if (origin === 'crowdsec') return 'Detected'
  if (origin === 'cscli') return 'Manual'
  if (origin === 'cscli-import') return 'Imported'
  if (origin === 'CAPI') return 'Community'
  if (origin.startsWith('lists')) return 'Blocklist'
  if (origin === 'console') return 'Console'
  return origin || '—'
}
export function originTone(origin: string): Tone {
  if (origin === 'crowdsec') return 'problem'
  if (origin === 'cscli' || origin === 'cscli-import') return 'info'
  return 'neutral'
}
export function familyTone(family?: string): Tone {
  switch (family) {
    case 'bruteforce': return 'problem'
    case 'exploit': return 'attention'
    case 'probe': return 'info'
    default: return 'neutral'
  }
}

/** trigger a browser download of some text */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** run something when the mouse or the keyboard leaves an element (menus close on it) */
export function useOutside(ref: React.RefObject<HTMLElement>, onOutside: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onOutside() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [ref, onOutside, active])
}

/** debounced copy of a value (a search box that asks the server) */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

// ---------------------------------------------------------------------------
// Durations the person types: 90m, 4h, 7d, 2w, 1h30m
// ---------------------------------------------------------------------------

/** seconds of "1h30m" / "4h" / "7d" / "2w" (null when it is not a duration) */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!/^(\d{1,9}[smhdw])+$/.test(t)) return null
  let total = 0
  for (const m of t.matchAll(/(\d{1,9})([smhdw])/g)) total += parseInt(m[1], 10) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as Record<string, number>)[m[2]]
  return total
}
/** 90 → "90m", 3600 → "1h", 604800 → "168h": the form the API stores */
export function canonicalDuration(sec: number): string {
  return sec % 3600 === 0 ? `${sec / 3600}h` : `${Math.floor(sec / 60)}m`
}
const PRESET_LABEL: Record<string, string> = { '30m': '30 min', '1h': '1 h', '4h': '4 h', '12h': '12 h', '24h': '24 h', '3d': '3 d', '7d': '7 d', '14d': '14 d', '30d': '30 d', '90d': '90 d' }
export const PERMANENT = 'permanent'

/** preset chips + a custom field (+ permanent): the value is a duration text or "permanent" */
export function DurationPicker({ value, onChange, presets = ['1h', '4h', '24h', '7d', '30d'], allowPermanent = false, maxSeconds = 365 * 86400, ariaLabel = 'Duration', disabled = false }: {
  value: string; onChange: (v: string) => void; presets?: string[]; allowPermanent?: boolean; maxSeconds?: number; ariaLabel?: string; disabled?: boolean
}) {
  const isPreset = presets.includes(value)
  const isPerm = value === PERMANENT
  const [custom, setCustom] = useState(!isPreset && !isPerm && value !== '')
  const [text, setText] = useState(!isPreset && !isPerm ? value : '')
  const sec = parseDuration(text)
  const bad = custom && text.trim() !== '' && (sec === null || sec < 60 || sec > maxSeconds)
  const chip = (on: boolean) => `h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`
  return (
    <div>
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" disabled={disabled} aria-pressed={value === p && !custom} className={chip(value === p && !custom)} onClick={() => { setCustom(false); onChange(p) }}>{PRESET_LABEL[p] ?? p}</button>
        ))}
        <button type="button" disabled={disabled} aria-pressed={custom} className={chip(custom)} onClick={() => { setCustom(true); if (sec !== null && sec >= 60 && sec <= maxSeconds) onChange(canonicalDuration(sec)) }}>Custom</button>
        {allowPermanent && (
          <button type="button" disabled={disabled} aria-pressed={isPerm} className={`${chip(isPerm)} ${isPerm ? '!bg-rose-500/15 !text-rose-300 !border-rose-500/25' : ''}`} onClick={() => { setCustom(false); onChange(PERMANENT) }}>Permanent</button>
        )}
      </div>
      {custom && (
        <div className="mt-2">
          <input
            className={`${INPUT} max-w-[14rem] ${bad ? '!border-rose-500/40' : ''}`}
            value={text}
            disabled={disabled}
            placeholder="e.g. 90m, 12h, 10d, 2w"
            aria-label={`${ariaLabel}: custom`}
            aria-invalid={bad}
            onChange={(e) => {
              setText(e.target.value)
              const v = parseDuration(e.target.value)
              if (v !== null && v >= 60 && v <= maxSeconds) onChange(canonicalDuration(v))
            }}
          />
          <p className={`${HINT} ${bad ? '!text-rose-300' : ''}`}>{bad ? `Use minutes, hours, days or weeks between 1 minute and ${maxSeconds >= 3153600000 ? '10 years' : `${Math.round(maxSeconds / 86400)} days`}.` : 'Minutes (m), hours (h), days (d) or weeks (w); combine them, like 1d12h.'}</p>
        </div>
      )}
      {isPerm && <p className="text-[11px] text-rose-300 mt-2">CrowdSec has no ban without an end, so a permanent ban lasts ten years.</p>}
    </div>
  )
}
