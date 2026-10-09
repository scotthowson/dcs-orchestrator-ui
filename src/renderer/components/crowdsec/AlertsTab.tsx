// =============================================================================
// Alerts: what CrowdSec detected. A window (1 hour to 30 days), a search, a
// scenario and a country, one row per detection with its outcome (banned now or
// not), a sheet with the whole story behind each one. Live: the times count up
// by themselves and the list refreshes every 15 seconds.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, ChevronRight, RefreshCw, Info, BellOff, FlaskConical, Loader2, AlertTriangle } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { crowdsecAlerts } from '../../api/endpoints'
import type { CrowdSecAlert, CrowdSecFacet } from '../../../shared/types'
import { Country, countryName, fmtAgo, fmtNum, fmtTime, looksLikeTarget, useCs, useDebounced, useNow, Ago, FilterSelect } from './kit'
import { AlertSheet, outcomeOf, plural, sourceOf } from './AlertSheet'

import { BTN_ICON_QUIET, BTN_TOOLBAR_QUIET, BTN_CARD, TONE_GHOST } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import { Pill } from '../common/Pill'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import SearchInput from '../common/SearchInput'
// The sheet lives in its own file; BansTab and OverviewTab import it from here.
export { AlertSheet }

type Win = '1h' | '6h' | '24h' | '7d' | '30d'
const WINDOWS: Win[] = ['1h', '6h', '24h', '7d', '30d']
const WIN_LABEL: Record<Win, string> = { '1h': 'the last hour', '6h': 'the last 6 hours', '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days' }
const WIN_TITLE: Record<Win, string> = { '1h': 'Last hour', '6h': 'Last 6 hours', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' }
const WIN_DAYS: Record<Win, number> = { '1h': 1, '6h': 1, '24h': 1, '7d': 7, '30d': 30 }
const WIN_KEY = 'dcs-crowdsec-alerts-window'
const PAGE = 50
const MAX_ROWS = 1000

function loadWin(): Win {
  try { const v = localStorage.getItem(WIN_KEY); return (WINDOWS as string[]).includes(v || '') ? (v as Win) : '24h' } catch { return '24h' }
}

interface Filters { q: string; scenario: string; country: string; hideSim: boolean }

/** A tab opened from the overview brings a country code or a scenario name: those become filters (precise, and removable), anything else a search */
function interpretSeed(seed?: string): Pick<Filters, 'q' | 'scenario' | 'country'> {
  const s = (seed ?? '').trim()
  if (!s) return { q: '', scenario: '', country: '' }
  if (/^[A-Za-z]{2}$/.test(s)) return { q: '', scenario: '', country: s.toUpperCase() }
  if (looksLikeTarget(s)) return { q: s, scenario: '', country: '' }   // an address or a network (192.0.2.0/24 has a slash too)
  if (s.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._@+-]*\/[A-Za-z0-9._/:@+()' -]+$/.test(s)) return { q: '', scenario: s, country: '' }
  return { q: s, scenario: '', country: '' }
}

/** "crowdsecurity/http-probing" → "http-probing"; the facet may carry a plain-language label already */
function scenarioText(f: CrowdSecFacet & { label?: string }): string {
  return f.label || f.value.replace(/^crowdsecurity\//, '')
}

/** true from the width where the table replaces the cards (the same breakpoint as Tailwind's md) */
function useIsDesktop(): boolean {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)')
    const on = () => setV(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return v
}

function FilterChip({ label, onRemove, what }: { label: React.ReactNode; onRemove: () => void; what: string }) {
  return (
    <span className="inline-flex items-center h-8 pl-2.5 pr-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 max-w-full">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove the ${what} filter`} title={`Remove the ${what} filter`} className="h-8 w-8 rounded-lg inline-flex items-center justify-center hover:bg-white/10 shrink-0"><X size={13} /></button>
    </span>
  )
}

function SourceCell({ a, phone = false }: { a: CrowdSecAlert; phone?: boolean }) {
  const s = sourceOf(a)
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-2 min-w-0 flex-wrap">
        {s.value
          ? <span className={`font-mono text-[13px] text-slate-100 ${phone ? 'break-all' : 'truncate'}`} title={s.value}>{s.value}</span>
          : <span className="text-xs text-slate-500">no source</span>}
        {s.more > 0 && <span className="text-[11px] text-slate-500 shrink-0">+{s.more} more</span>}
        {s.own && a.source.country && <Country code={a.source.country} />}
      </span>
      {a.source.as_name && <span className="block text-[11px] text-slate-500 truncate max-w-[16rem]" title={`AS${a.source.as_number} ${a.source.as_name}`}>AS{a.source.as_number} · {a.source.as_name}</span>}
    </span>
  )
}

/** what a row is called: a detection has a plain label with the detector's own name under it; a manual ban is known by the reason typed for it */
function headOf(a: CrowdSecAlert): { title: string; sub: string } {
  if (a.kind === 'cscli') {
    const n = a.decisions.length || a.events_count
    const imported = a.decisions.some((d) => d.origin === 'cscli-import')
    return imported ? { title: `Imported list of ${n.toLocaleString()} ${n === 1 ? 'address' : 'addresses'}`, sub: a.scenario } : { title: a.scenario || a.label, sub: '' }
  }
  return { title: a.label, sub: a.scenario }
}

function OutcomeChip({ a }: { a: CrowdSecAlert }) {
  const o = outcomeOf(a)
  return <Pill tone={o.tone} title={o.title}>{o.tone === 'attention' && <FlaskConical size={10} />} {o.text}</Pill>
}

export default function AlertsTab({ seedSearch }: { seedSearch?: string }) {
  const { member } = useCs()
  const isDesktop = useIsDesktop()
  const now = useNow()
  const [win, setWinState] = useState<Win>(loadWin)
  const setWin = (w: Win) => { setWinState(w); try { localStorage.setItem(WIN_KEY, w) } catch { /* a private window */ } }
  const [f, setF] = useState<Filters>(() => ({ ...interpretSeed(seedSearch), hideSim: false }))
  const patch = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }))
  const [openId, setOpenId] = useState<number | null>(null)
  const dq = useDebounced(f.q.trim(), 300)

  // a later seed (the palette, another tab) replaces the filters; the first one is already in the state
  const lastSeed = useRef(seedSearch)
  useEffect(() => {
    if (seedSearch === lastSeed.current) return
    lastSeed.current = seedSearch
    if (seedSearch !== undefined) setF({ ...interpretSeed(seedSearch), hideSim: false })
  }, [seedSearch])

  // "Show more" grows the page; a change of filter starts again at one page
  const filterKey = `${win}|${dq}|${f.scenario}|${f.country}|${f.hideSim}`
  const [page, setPage] = useState({ key: filterKey, limit: PAGE })
  const limit = page.key === filterKey ? page.limit : PAGE

  const query = useMemo(() => ({ window: win, q: dq, scenario: f.scenario, country: f.country, simulated: f.hideSim ? ('no' as const) : ('any' as const), limit }), [win, dq, f.scenario, f.country, f.hideSim, limit])
  const queryKey = JSON.stringify(query)
  const viewKey = JSON.stringify({ ...query, limit: 0 })
  const queryRef = useRef(query); queryRef.current = query
  // usePolling only reports its first load: this tells every read, so a refresh can show that it is working
  const [fetching, setFetching] = useState(false)
  const poll = usePolling(async () => {
    const q = queryRef.current
    setFetching(true)
    try {
      return { view: JSON.stringify({ ...q, limit: 0 }), main: await crowdsecAlerts(q, member) }
    } finally { setFetching(false) }
  }, 15000)
  const refresh = poll.refresh
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } refresh() }, [queryKey, refresh])

  const cur = poll.data
  const data = cur?.main ?? null
  const stale = !!cur && cur.view !== viewKey
  const rows = data?.alerts ?? []
  const facets = data?.facets
  const filtered = !!(dq || f.scenario || f.country || f.hideSim)
  const clearFilters = () => setF({ q: '', scenario: '', country: '', hideSim: false })

  const scenarios = useMemo(() => {
    const list = facets?.scenarios ?? []
    return f.scenario && !list.some((x) => x.value === f.scenario) ? [{ value: f.scenario, count: 0 }, ...list] : list
  }, [facets, f.scenario])
  const countries = useMemo(() => {
    const list = facets?.countries ?? []
    return f.country && f.country.toLowerCase() !== 'unknown' && !list.some((x) => x.value === f.country) ? [{ value: f.country, count: 0 }, ...list] : list
  }, [facets, f.country])
  const labelOf = useMemo(() => new Map(rows.map((r) => [r.scenario, r.label])), [rows])
  const scenarioName = (v: string) => labelOf.get(v) || v.replace(/^crowdsecurity\//, '')
  const countryText = (v: string) => (v.toLowerCase() === 'unknown' ? 'not known' : countryName(v) || v)

  const retentionShort = !!data && WIN_DAYS[win] > data.retention_days

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Segmented<Win>
          value={win}
          onChange={setWin}
          ariaLabel="Time window"
          options={WINDOWS.map((w) => ({ value: w, label: w, title: WIN_TITLE[w] }))}
        />
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem] sm:max-w-sm order-last sm:order-none">
          <SearchInput size="sm" value={f.q} onChange={(v) => patch({ q: v })} id="alerts-search" maxLength={100} placeholder="Search address, detection, country, network" autoComplete="off" label="Search the alerts" />
        </div>
        <button type="button" onClick={refresh} className={`${BTN_ICON_QUIET} ml-auto`} aria-label="Refresh the alerts" title="Refresh the alerts"><RefreshCw size={14} className={fetching ? 'animate-spin' : ''} /></button>
      </div>
      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:flex-wrap">
        <FilterSelect className="sm:min-w-[9.5rem] sm:max-w-[16rem]" id="alerts-scenario" label="Detection" value={f.scenario} onChange={(v) => patch({ scenario: v })}>
          <option value="">All detections</option>
          {scenarios.map((s) => <option key={s.value} value={s.value}>{scenarioText(s)} ({s.count})</option>)}
        </FilterSelect>
        <FilterSelect className="sm:min-w-[9.5rem] sm:max-w-[16rem]" id="alerts-country" label="Country" value={f.country} onChange={(v) => patch({ country: v })}>
          <option value="">All countries</option>
          {countries.map((c) => <option key={c.value} value={c.value}>{countryName(c.value) || c.value} ({c.count})</option>)}
          {facets && facets.unknown_country > 0 && <option value="unknown">Country not known ({facets.unknown_country})</option>}
        </FilterSelect>
        <label className="inline-flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none h-9 px-1 col-span-2 sm:col-span-1" title="Simulated detections only raise an alert: nothing is banned">
          <input type="checkbox" checked={f.hideSim} onChange={(e) => patch({ hideSim: e.target.checked })} className="accent-emerald-500" /> Hide simulated
        </label>
        {filtered && <button type="button" onClick={clearFilters} className={`${BTN_CARD} ${TONE_GHOST}`}><X size={12} /> Clear the filters</button>}
      </div>
      {(f.scenario || f.country) && (
        <div className="flex items-center gap-2 flex-wrap" aria-label="Active filters">
          {f.scenario && <FilterChip what="detection" label={<><span className="opacity-70">Detection:</span> {scenarioName(f.scenario)}</>} onRemove={() => patch({ scenario: '' })} />}
          {f.country && <FilterChip what="country" label={<><span className="opacity-70">Country:</span> {countryText(f.country)}</>} onRemove={() => patch({ country: '' })} />}
        </div>
      )}

      {retentionShort && data && (
        <p className="text-xs text-amber-300 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <Info size={14} className="shrink-0 mt-0.5" /> CrowdSec keeps alerts for {plural(data.retention_days, 'day')}, so {WIN_LABEL[win]} can show {data.retention_days === 1 ? 'a day' : `${data.retention_days} days`} at most.
        </p>
      )}

      {poll.error && !cur && (
        <div className={`${CARD} p-4 flex items-start gap-3`} role="alert">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-rose-300 break-words">{poll.error.message}</p>
            <p className="text-xs text-slate-500 mt-1">The alerts could not be read. CrowdSec may be restarting.</p>
            <button type="button" onClick={refresh} className={`${BTN_TOOLBAR_QUIET} mt-3`}><RefreshCw size={14} /> Try again</button>
          </div>
        </div>
      )}
      {!cur && !poll.error && <div className="space-y-2" aria-busy="true" aria-label="Loading the alerts">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonBlock key={i} className="h-14" />)}</div>}
      {poll.error && cur && (
        <p className="text-xs text-amber-300 flex items-center gap-2 flex-wrap rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <AlertTriangle size={13} className="shrink-0" /> <span className="min-w-0">Could not refresh ({poll.error.message}). Showing the last answer{data ? `, read ${fmtAgo(data.as_of, now)}` : ''}.</span>
          <button type="button" onClick={refresh} className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline">Try again</button>
        </p>
      )}

      {data && rows.length === 0 && (
        <div className={`${CARD} px-6 py-14 text-center ${stale ? 'opacity-60' : ''}`}>
          <BellOff size={30} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">{filtered ? 'No alert matches these filters.' : `Quiet. CrowdSec detected nothing in ${WIN_LABEL[win]}.`}</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            {filtered
              ? `Nothing in ${WIN_LABEL[win]} fits. Loosen a filter, or look further back.`
              : 'That is the normal state of a well-behaved server, not a fault. When CrowdSec catches a scanner or a brute-forcer it is listed here, with what it did and whether the address is banned.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            {filtered && <button type="button" onClick={clearFilters} className={BTN_TOOLBAR_QUIET}><X size={14} /> Clear the filters</button>}
            {win !== '30d' && <button type="button" onClick={() => setWin(win === '7d' ? '30d' : '7d')} className={BTN_TOOLBAR_QUIET}>Look at {win === '7d' ? 'the last 30 days' : 'the last 7 days'}</button>}
          </div>
        </div>
      )}

      {data && rows.length > 0 && (
        <div className={`transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={stale}>
          {isDesktop ? (
            <div className={`${CARD} overflow-hidden`}>
              <table className="w-full text-sm">
                <caption className="sr-only">Alerts in {WIN_LABEL[win]}, newest first</caption>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                    <th scope="col" className="text-left font-semibold pl-4 pr-3 py-2.5 w-24">When</th>
                    <th scope="col" className="text-left font-semibold px-3 py-2.5">Detection</th>
                    <th scope="col" className="text-left font-semibold px-3 py-2.5">Source</th>
                    <th scope="col" className="text-right font-semibold px-3 py-2.5">Events</th>
                    <th scope="col" className="text-left font-semibold px-3 py-2.5">Outcome</th>
                    <th scope="col" className="w-8 pr-3"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {rows.map((a) => (
                    <tr key={a.id} className="hover:bg-white/[0.03] transition-colors cursor-pointer" onClick={() => setOpenId(a.id)}>
                      <td className="pl-4 pr-3 py-2.5 whitespace-nowrap text-xs text-slate-300"><Ago at={a.created_at} /></td>
                      <td className="px-3 py-2.5 min-w-0 max-w-[18rem]">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenId(a.id) }}
                          aria-label={`Alert ${a.id}: ${headOf(a).title}${sourceOf(a).value ? ` from ${sourceOf(a).value}` : ''}. Open the details`}
                          className="block w-full text-left rounded-md focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500/60"
                        >
                          <span className="block text-slate-200 truncate" title={headOf(a).title}>{headOf(a).title}</span>
                          {headOf(a).sub && <span className="block text-[11px] text-slate-500 truncate font-mono" title={headOf(a).sub}>{headOf(a).sub}</span>}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 min-w-0"><SourceCell a={a} /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-300" title={`${fmtNum(a.events_count)} suspicious request${a.events_count === 1 ? '' : 's'} added up to this alert`}>{fmtNum(a.events_count)}</td>
                      <td className="px-3 py-2.5"><OutcomeChip a={a} /></td>
                      <td className="pr-3 text-slate-500"><ChevronRight size={14} aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((a) => (
                <button key={a.id} type="button" onClick={() => setOpenId(a.id)} aria-label={`Alert ${a.id}: ${headOf(a).title}${sourceOf(a).value ? ` from ${sourceOf(a).value}` : ''}. Open the details`} className={`${CARD} w-full text-left p-3.5 block hover:bg-white/[0.06] transition-colors`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-100 leading-snug break-words">{headOf(a).title}</span>
                      {headOf(a).sub && <span className="block text-[11px] text-slate-500 font-mono break-all">{headOf(a).sub}</span>}
                    </span>
                    <Ago at={a.created_at} className="text-[11px] text-slate-500 shrink-0 pt-0.5" />
                  </span>
                  <span className="block mt-2.5"><SourceCell a={a} phone /></span>
                  <span className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                    <OutcomeChip a={a} />
                    <span className="text-[11px] text-slate-500 tabular-nums">{plural(a.events_count, 'event')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-slate-500 px-1 mt-2">
            <span className="tabular-nums">
              {filtered ? `${fmtNum(data.count)} of ${fmtNum(data.total)} in ${WIN_LABEL[win]} match` : `${plural(data.total, 'alert')} in ${WIN_LABEL[win]}`}
              {rows.length < data.count ? ` · showing the newest ${fmtNum(rows.length)}` : ''}
              <span className="text-slate-500" title={fmtTime(data.as_of)}> · updated {fmtAgo(data.as_of, now)}</span>
            </span>
            {rows.length < data.count && limit < MAX_ROWS && (
              <button type="button" onClick={() => setPage({ key: filterKey, limit: Math.min(MAX_ROWS, limit + PAGE) })} className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">
                {fetching && <Loader2 size={11} className="animate-spin" />} Show {Math.min(PAGE, data.count - rows.length)} more
              </button>
            )}
            {rows.length < data.count && limit >= MAX_ROWS && <span>That is as far back as this list goes. Narrow the window or add a filter to reach the rest.</span>}
          </div>
        </div>
      )}

      {openId !== null && <AlertSheet id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
