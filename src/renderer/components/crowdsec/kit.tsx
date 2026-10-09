// =============================================================================
// CrowdSec page kit — the small pieces every tab shares: card and button
// classes, tone chips, KPI tiles, segmented controls, the live clock, country
// flags and names, the sheet that hosts forms. Colours are only the Tailwind
// classes the theme engine re-maps (slate / emerald / amber / rose / cyan and
// white/N), so every theme, dark or light, restyles them.
// =============================================================================

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, Check } from 'lucide-react'
import type { CrowdSecStatusResponse } from '../../../shared/types'

// ---------------------------------------------------------------------------
// The house classes
// ---------------------------------------------------------------------------

export const CARD = 'rounded-xl bg-white/[0.03] border border-white/5'
export const BTN = 'h-9 px-3 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap'
export const BTN_QUIET = `${BTN} bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10`
export const BTN_PRIMARY = `${BTN} bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30`
export const BTN_DANGER = `${BTN} bg-rose-500/15 border border-rose-500/25 text-rose-300 hover:bg-rose-500/25`
export const BTN_WARN = `${BTN} bg-amber-500/15 border border-amber-500/25 text-amber-300 hover:bg-amber-500/25`
export const ICON_BTN = 'h-8 w-8 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const INPUT = 'w-full h-10 px-3 rounded-lg bg-slate-800/50 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-60'
export const TEXTAREA = 'w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-60'
export const LABEL = 'block text-xs font-medium text-slate-500 mb-1'
export const HINT = 'text-[11px] text-slate-500 mt-1'

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'mute'
export const TONE: Record<Tone, string> = {
  good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  bad: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  info: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  mute: 'bg-white/[0.04] text-slate-500 border-white/10',
}
export const DOT: Record<Tone, string> = { good: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-rose-400', info: 'bg-cyan-400', mute: 'bg-slate-500' }

export function Chip({ tone = 'mute', children, title, className = '' }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 text-[10px] leading-none font-medium px-1.5 py-1 rounded-md border shrink-0 ${TONE[tone]} ${className}`}>{children}</span>
}

export function Dot({ tone = 'mute', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[tone]} ${pulse ? 'animate-pulse' : ''}`} />
}

/** a section title: small uppercase label, an optional count and controls on the right */
export function SectionHead({ icon: Icon, title, count, right, className = '' }: { icon?: React.ElementType; title: ReactNode; count?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 flex-wrap ${className}`}>
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 min-w-0">
        {Icon && <Icon size={12} className="shrink-0" />} <span className="truncate">{title}</span>
        {count !== undefined && count !== null && <span className="text-slate-500 tabular-nums normal-case tracking-normal font-normal">{count}</span>}
      </h2>
      {right}
    </div>
  )
}

/** one number with its label: the status strip and the overview use these */
export function Kpi({ label, short, value, sub, tone = 'mute', icon: Icon, onClick, title, subOnPhone = false }: { label: string; short?: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: React.ElementType; onClick?: () => void; title?: string; subOnPhone?: boolean }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider truncate">{short ? <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></> : label}</p>
        {Icon && <Icon size={13} className={`shrink-0 hidden sm:block ${tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-rose-400' : tone === 'info' ? 'text-cyan-400' : 'text-slate-500'}`} />}
      </div>
      <p className="text-xl md:text-2xl font-semibold text-slate-100 tabular-nums leading-tight mt-1 truncate">{value}</p>
      {sub !== undefined && <p className={`text-[11px] text-slate-500 mt-0.5 truncate ${subOnPhone ? '' : 'hidden sm:block'}`}>{sub}</p>}
    </>
  )
  const cls = `${CARD} px-3 sm:px-3.5 py-2.5 sm:py-3 min-w-0 text-left`
  if (onClick) return <button type="button" title={title} onClick={onClick} className={`${cls} hover:bg-white/[0.06] transition-colors`}>{inner}</button>
  return <div title={title} className={cls}>{inner}</div>
}

export function Skel({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-lg ${className}`} />
}

/** the pill row the app uses for filters: an active option glows emerald */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, className = '' }: {
  value: T
  options: { value: T; label: ReactNode; count?: number | string; title?: string; disabled?: boolean; icon?: React.ElementType }[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  // a long row scrolls sideways on a phone: keep the chosen option in view (the palette and the overview open tabs by themselves)
  const first = useRef(true)
  useEffect(() => {
    const c = box.current
    const on = c?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (c && on && c.scrollWidth > c.clientWidth) c.scrollTo({ left: on.offsetLeft - (c.clientWidth - on.offsetWidth) / 2, behavior: first.current ? 'auto' : 'smooth' })
    first.current = false
  }, [value])
  return (
    <div ref={box} role="group" aria-label={ariaLabel} className={`relative flex items-center gap-1 p-1 rounded-xl bg-slate-900/60 backdrop-blur-md border border-white/5 overflow-x-auto scrollbar-none max-w-full ${className}`}>
      {options.map((o) => {
        const on = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            disabled={o.disabled}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-8 sm:h-7 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors border disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' : 'text-slate-500 hover:text-slate-200 hover:bg-white/5 border-transparent'}`}
          >
            {Icon && <Icon size={12} />}
            {o.label}
            {o.count !== undefined && <span className={`tabular-nums text-[10px] ${on ? 'text-emerald-300' : 'text-slate-500'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** a toggle switch (accessible: role=switch) */
export function Switch({ checked, onChange, label, disabled = false, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed before:content-[''] before:absolute before:-inset-2 ${checked ? 'bg-emerald-500/40 border-emerald-500/40' : 'bg-white/10 border-white/10'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

/** a small copy-to-clipboard button */
export function CopyIcon({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }).catch(() => {}) }}
      className="h-6 w-6 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/10 inline-flex items-center justify-center shrink-0 transition-colors"
    >
      {done ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// The sheet that hosts forms: centred on a desktop, a bottom sheet on a phone
// ---------------------------------------------------------------------------

// the sheets that are open, the newest last: Escape closes only that one (a ban form opened from an alert closes alone)
const sheetStack: symbol[] = []
export function CsSheet({ title, subtitle, icon, tone = 'good', onClose, children, wide = false, footer }: {
  title: string; subtitle?: string; icon?: ReactNode; tone?: Tone; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode
}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const me = Symbol('sheet')
    sheetStack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sheetStack[sheetStack.length - 1] !== me) return
      e.stopPropagation(); closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); const i = sheetStack.indexOf(me); if (i >= 0) sheetStack.splice(i, 1) }
  }, [])
  const tile = tone === 'bad' ? 'bg-rose-500/15 text-rose-400' : tone === 'warn' ? 'bg-amber-500/15 text-amber-400' : tone === 'info' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-emerald-500/15 text-emerald-400'
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] flex flex-col glass rounded-t-3xl sm:rounded-2xl animate-slide-up`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 shrink-0">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          <div className="flex items-start gap-3">
            {icon && <div className={`p-2.5 rounded-xl shrink-0 ${tile}`}>{icon}</div>}
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-100 break-words">{title}</h3>
              {subtitle && <p className="text-sm text-slate-500 mt-0.5 break-words">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5" aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        <div className="px-5 pb-5 overflow-y-auto scrollbar-thin min-h-0">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-white/5 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body,
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

/** the message of an API error, in words; structured detail of one (a `reason`, `rolled_back` …): api/errors */
export { apiErrorMessage as errMsg, apiErrorData as errData } from '../../api/errors'

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
  if (origin === 'crowdsec') return 'bad'
  if (origin === 'cscli' || origin === 'cscli-import') return 'info'
  return 'mute'
}
export function familyTone(family?: string): Tone {
  switch (family) {
    case 'bruteforce': return 'bad'
    case 'exploit': return 'warn'
    case 'probe': return 'info'
    default: return 'mute'
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
