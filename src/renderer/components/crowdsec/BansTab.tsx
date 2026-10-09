// =============================================================================
// Bans: everything CrowdSec is blocking right now. Search, filter by origin,
// scenario, country and kind, sort, ban an address (or a network, or for ever),
// lift one or many, import a list, export the list. The countdown is live.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Upload, Download, Unlock, Loader2, X, Info, FlaskConical, Infinity as InfinityIcon, ShieldOff } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecDecisions, crowdsecUnban, crowdsecBulkUnban, crowdsecExportBans } from '../../api/endpoints'
import type { CrowdSecDecision, CrowdSecDecisionQuery } from '../../../shared/types'
import { Country, downloadText, errMsg, fmtLeft, fmtTime, originLabel, originTone, useCs, useDebounced, useNow, useOutside, fmtNum, FilterSelect } from './kit'
import BanSheet from './BanSheet'
import ImportSheet from './ImportSheet'
import { AlertSheet } from './AlertsTab'

import { BTN_ICON_QUIET, BTN_TOOLBAR_DANGER, BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET, BTN_CARD, TONE_GHOST } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import { Pill } from '../common/Pill'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import SearchInput from '../common/SearchInput'
const PAGE = 500

type Sort = NonNullable<CrowdSecDecisionQuery['sort']>
const SORTS: { value: Sort; label: string; dir: 'asc' | 'desc' }[] = [
  { value: 'created', label: 'Newest first', dir: 'desc' },
  { value: 'expires', label: 'Expiring soon', dir: 'asc' },
  { value: 'value', label: 'Address', dir: 'asc' },
  { value: 'country', label: 'Country', dir: 'asc' },
  { value: 'scenario', label: 'Reason', dir: 'asc' },
]

function idOf(d: CrowdSecDecision): string { return String(d.id ?? d.value ?? d.ip) }

/** what a ban says about itself: the reason an operator typed leads on manual and imported bans, the plain-language name on detected ones */
function reasonOf(d: CrowdSecDecision): { title: string; sub: string } {
  const typed = d.origin === 'cscli' || d.origin === 'cscli-import'
  if (typed) return { title: d.scenario || d.label || '', sub: d.label && d.label !== d.scenario ? d.label : '' }
  const title = d.label || d.scenario || ''
  return { title, sub: d.scenario && d.scenario !== title ? d.scenario : '' }
}

/** a live countdown to the moment a ban ends */
function Expires({ d }: { d: CrowdSecDecision }) {
  const now = useNow()
  if (d.permanent) return <span title={`Ends ${fmtTime(d.expires_at)}`}><Pill tone="problem"><InfinityIcon size={10} /> permanent</Pill></span>
  const left = d.expires_at ? Math.round((Date.parse(d.expires_at) - now) / 1000) : (d.seconds_left ?? 0)
  return (
    <span title={d.expires_at ? `Ends ${fmtTime(d.expires_at)}` : undefined} className={`tabular-nums text-xs ${left < 300 ? 'text-amber-300' : 'text-slate-300'}`}>
      {left <= 0 ? 'ending…' : fmtLeft(left)}
    </span>
  )
}

export default function BansTab({ seedSearch }: { seedSearch?: string }) {
  const { member, isAdmin, status, refreshStatus } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState(seedSearch ?? '')
  const dq = useDebounced(q, 300)
  const [scope, setScope] = useState<'' | 'ip' | 'range'>('')
  const [origin, setOrigin] = useState('')
  const [country, setCountry] = useState('')
  const [scenario, setScenario] = useState('')
  const [hideSim, setHideSim] = useState(false)
  const [sort, setSort] = useState<Sort>('created')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [banning, setBanning] = useState<{ value?: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [alertId, setAlertId] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useOutside(menuRef, () => setMenu(false), menu)

  const dir = SORTS.find((x) => x.value === sort)?.dir ?? 'desc'
  const query = useMemo<CrowdSecDecisionQuery>(() => ({ q: dq, scope, origin, country, scenario, simulated: hideSim ? 'no' : 'any', sort, dir, limit }), [dq, scope, origin, country, scenario, hideSim, sort, dir, limit])
  const queryRef = useRef(query); queryRef.current = query
  const poll = usePolling(() => crowdsecDecisions(queryRef.current, member), 15000)
  const refresh = poll.refresh
  useEffect(() => { refresh() }, [query, refresh])
  useEffect(() => { setLimit(PAGE) }, [dq, scope, origin, country, scenario, hideSim, sort])

  const data = poll.data
  const rows = data?.decisions ?? []
  const facets = data?.facets
  const filtered = !!(dq || scope || origin || country || scenario || hideSim)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(idOf(r)))
  // a selection only keeps what is still on screen
  useEffect(() => {
    if (selected.size === 0) return
    const ids = new Set(rows.map(idOf))
    const next = new Set([...selected].filter((x) => ids.has(x)))
    if (next.size !== selected.size) setSelected(next)
  }, [rows, selected])

  const after = useCallback(() => { refresh(); refreshStatus() }, [refresh, refreshStatus])

  const unbanOne = async (d: CrowdSecDecision) => {
    if (d.permanent && !(await confirm({ title: 'Lift a permanent ban?', message: `${d.value ?? d.ip} was banned for good. Lifting it lets that address in again.`, confirmLabel: 'Lift the ban', danger: true }))) return
    const key = `u:${idOf(d)}`
    setBusy(key)
    try {
      const r = await crowdsecUnban(d.value ?? d.ip, member)
      addToast({ type: 'success', message: r.message || `Lifted the ban on ${d.value ?? d.ip}` })
      after()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not lift the ban'), duration: 7000 }) } finally { setBusy('') }
  }
  const unbanSelected = async () => {
    const picked = rows.filter((r) => selected.has(idOf(r)))
    if (!picked.length) return
    const perm = picked.filter((p) => p.permanent).length
    if (!(await confirm({ title: `Lift ${picked.length} ban${picked.length === 1 ? '' : 's'}?`, message: `${picked.slice(0, 4).map((p) => p.value ?? p.ip).join(', ')}${picked.length > 4 ? ` and ${picked.length - 4} more` : ''} will be let in again.${perm ? `\n${perm} of them ${perm === 1 ? 'is a permanent ban' : 'are permanent bans'}.` : ''}`, confirmLabel: 'Lift them', danger: true }))) return
    setBusy('bulk')
    try {
      const ids = picked.map((p) => p.id).filter((x): x is number => typeof x === 'number')
      // the server lifts at most 200 per request
      let deleted = 0, failed = 0
      setProgress({ done: 0, total: ids.length })
      for (let i = 0; i < ids.length; i += 200) {
        const r = await crowdsecBulkUnban({ ids: ids.slice(i, i + 200) }, member)
        deleted += r.deleted; failed += r.failed
        setProgress({ done: Math.min(ids.length, i + 200), total: ids.length })
      }
      addToast({ type: failed ? 'warning' : 'success', message: `Lifted ${deleted} ban${deleted === 1 ? '' : 's'}${failed ? `, ${failed} could not be lifted` : ''}`, duration: 6000 })
      setSelected(new Set()); after()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not lift the bans'), duration: 7000 }) } finally { setBusy(''); setProgress(null) }
  }
  const doExport = async (fmt: 'csv' | 'json') => {
    setMenu(false); setBusy('export')
    try {
      // the whole filtered list in cscli's order: the export ignores sort and dir (and pages)
      const r = await crowdsecExportBans(fmt, { ...queryRef.current, limit: undefined, offset: undefined, sort: undefined, dir: undefined }, member)
      downloadText(r.filename, r.content, fmt === 'csv' ? 'text/csv' : 'application/json')
      addToast({ type: 'success', message: `Exported ${r.count} ban${r.count === 1 ? '' : 's'} as ${fmt.toUpperCase()}` })
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not export'), duration: 7000 }) } finally { setBusy('') }
  }
  const clearFilters = () => { setQ(''); setScope(''); setOrigin(''); setCountry(''); setScenario(''); setHideSim(false) }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem] sm:max-w-xs">
          <SearchInput size="sm" value={q} onChange={setQ} id="bans-search" placeholder="Search address, reason, country, network" autoComplete="off" label="Search the bans" />
        </div>
        <Segmented<'' | 'ip' | 'range'> value={scope} onChange={setScope} ariaLabel="Kind of ban" options={[{ value: '', label: 'All' }, { value: 'ip', label: 'Addresses' }, { value: 'range', label: 'Networks' }]} />
        <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
          {isAdmin && <button type="button" onClick={() => setBanning({})} className={`${BTN_TOOLBAR_OK} flex-1 sm:flex-none`}><Plus size={14} /> Ban an address</button>}
          {isAdmin && <button type="button" onClick={() => setImporting(true)} className={BTN_TOOLBAR_QUIET} title="Ban many addresses from a list or a file"><Upload size={14} /><span className="hidden sm:inline">Import</span></button>}
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu((v) => !v)} disabled={busy === 'export'} className={BTN_TOOLBAR_QUIET} aria-haspopup="menu" aria-expanded={menu} title="Download the list"><Download size={14} /><span className="hidden sm:inline">Export</span></button>
            {menu && (
              <div role="menu" className="absolute right-0 top-10 z-30 w-44 rounded-xl glass border border-white/10 p-1 shadow-xl animate-scale-in">
                <button role="menuitem" type="button" onClick={() => doExport('csv')} className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-white/10">CSV (spreadsheet)</button>
                <button role="menuitem" type="button" onClick={() => doExport('json')} className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-white/10">JSON</button>
                <p className="px-3 py-1.5 text-[10px] text-slate-500">{filtered ? 'The filtered list' : 'Every active ban'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:flex-wrap">
        <FilterSelect id="bans-origin" label="Where the ban came from" value={origin} onChange={setOrigin}>
          <option value="">All origins</option>
          {(facets?.origins ?? []).map((o) => <option key={o.value} value={o.value}>{originLabel(o.value)} ({o.count})</option>)}
        </FilterSelect>
        <FilterSelect id="bans-country" label="Country" value={country} onChange={setCountry}>
          <option value="">All countries</option>
          {(facets?.countries ?? []).map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
          {facets && facets.unknown_country > 0 && <option value="unknown">Unknown ({facets.unknown_country})</option>}
        </FilterSelect>
        <FilterSelect id="bans-scenario" label="Reason" value={scenario} onChange={setScenario}>
          <option value="">All reasons</option>
          {(facets?.scenarios ?? []).map((c) => <option key={c.value} value={c.value}>{c.value.replace('crowdsecurity/', '')} ({c.count})</option>)}
        </FilterSelect>
        <FilterSelect id="bans-sort" label="Sort" plain value={sort} onChange={(v) => setSort(v as Sort)}>
          {SORTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </FilterSelect>
        <label className="inline-flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none h-9 px-1 col-span-2 sm:col-span-1">
          <input type="checkbox" checked={hideSim} onChange={(e) => setHideSim(e.target.checked)} className="accent-emerald-500" /> Hide simulated
        </label>
        {filtered && <button type="button" onClick={clearFilters} className={`${BTN_CARD} ${TONE_GHOST}`}><X size={12} /> Clear the filters</button>}
      </div>

      {/* bulk bar */}
      {isAdmin && selected.size > 0 && (
        <div className="sticky top-2 z-20 rounded-xl glass border border-emerald-500/20 px-3 py-2 flex items-center gap-3 flex-wrap animate-scale-in" role="region" aria-label="Selected bans">
          <span className="text-sm text-slate-100 tabular-nums">{selected.size} selected</span>
          <button type="button" onClick={unbanSelected} disabled={busy === 'bulk'} className={BTN_TOOLBAR_DANGER}>{busy === 'bulk' ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} {busy === 'bulk' && progress ? `Lifting ${progress.done} of ${progress.total}…` : <>Lift {selected.size === 1 ? 'this ban' : `these ${selected.size} bans`}</>}</button>
          <button type="button" onClick={() => setSelected(new Set())} className={`${BTN_CARD} ${TONE_GHOST} ml-auto`}>Clear the selection</button>
        </div>
      )}

      {poll.error && !data && <p className={`${CARD} p-4 text-sm text-rose-300`} role="alert">{poll.error.message}</p>}
      {!data && !poll.error && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-12" />)}</div>}

      {data && rows.length === 0 && (
        <div className={`${CARD} px-6 py-14 text-center`}>
          <ShieldOff size={30} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">{filtered ? 'No ban matches these filters.' : 'Nothing is banned right now.'}</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">{filtered ? 'Loosen a filter, or clear them all.' : 'When CrowdSec catches a scanner or a brute-forcer, it shows up here with its country, the reason and a live countdown.'}</p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            {filtered && <button type="button" onClick={clearFilters} className={BTN_TOOLBAR_QUIET}><X size={14} /> Clear the filters</button>}
            {isAdmin && !filtered && <button type="button" onClick={() => setBanning({})} className={BTN_TOOLBAR_OK}><Plus size={14} /> Ban an address</button>}
          </div>
        </div>
      )}

      {data && rows.length > 0 && (
        <>
          {/* the table (a desktop) */}
          <div className={`${CARD} overflow-hidden hidden lg:block`}>
            <table className="w-full text-sm table-fixed">
              <colgroup>
                {isAdmin && <col className="w-10" />}
                <col className="w-[9.5rem] xl:w-[12rem]" />
                <col className="w-[5rem] xl:w-[11rem]" />
                <col />
                <col className="hidden xl:table-column w-[7rem]" />
                <col className="w-[6rem]" />
                <col className="w-[5.5rem]" />
              </colgroup>
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-white/5">
                  {isAdmin && <th className="w-10 pl-4 py-2.5"><input type="checkbox" aria-label="Select every ban shown" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map(idOf)) : new Set())} className="accent-emerald-500" /></th>}
                  <th className="text-left font-semibold px-3 py-2.5">Address</th>
                  <th className="text-left font-semibold px-3 py-2.5">Country</th>
                  <th className="text-left font-semibold px-3 py-2.5">Reason</th>
                  <th className="text-left font-semibold px-3 py-2.5 hidden xl:table-cell">Origin</th>
                  <th className="text-left font-semibold px-3 py-2.5">Ends in</th>
                  <th className="w-24 pr-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((d) => {
                  const id = idOf(d)
                  return (
                    <tr key={id} className={`hover:bg-white/[0.03] transition-colors ${selected.has(id) ? 'bg-emerald-500/[0.05]' : ''}`}>
                      {isAdmin && <td className="pl-4 py-2.5"><input type="checkbox" aria-label={`Select ${d.value ?? d.ip}`} checked={selected.has(id)} onChange={() => toggle(id)} className="accent-emerald-500" /></td>}
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[13px] text-slate-100 truncate">{d.value ?? d.ip}</span>
                          {d.scope === 'Range' && <Pill tone="neutral">network</Pill>}
                          {d.simulated && <Pill tone="attention" title="Only alerts: a simulated ban is never enforced"><FlaskConical size={10} /> simulated</Pill>}
                        </div>
                        {d.as_name && <p className="text-[11px] text-slate-500 truncate max-w-[16rem]" title={`AS${d.as_number} ${d.as_name}`}>AS{d.as_number} · {d.as_name}</p>}
                      </td>
                      <td className="px-3 py-2.5 min-w-0"><span className="hidden xl:inline-flex max-w-full"><Country code={d.country} name /></span><span className="xl:hidden"><Country code={d.country} /></span></td>
                      <td className="px-3 py-2.5 min-w-0">
                        <p className="text-slate-200 truncate" title={reasonOf(d).title}>{reasonOf(d).title}</p>
                        {reasonOf(d).sub && <p className="text-[11px] text-slate-500 truncate" title={reasonOf(d).sub}>{reasonOf(d).sub}<span className="xl:hidden"> · {originLabel(d.origin ?? '')}</span></p>}
                        {!reasonOf(d).sub && <p className="text-[11px] text-slate-500 truncate xl:hidden">{originLabel(d.origin ?? '')}</p>}
                      </td>
                      <td className="px-3 py-2.5 hidden xl:table-cell"><Pill tone={originTone(d.origin ?? '')}>{originLabel(d.origin ?? '')}</Pill></td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><Expires d={d} /></td>
                      <td className="pr-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {d.alert_id && d.origin === 'crowdsec' && <button type="button" className={BTN_ICON_QUIET} aria-label={`Details of the alert behind ${d.value ?? d.ip}`} title="The alert behind this ban" onClick={() => setAlertId(d.alert_id as number)}><Info size={14} /></button>}
                          {isAdmin && <button type="button" className={`${BTN_ICON_QUIET} hover:!bg-rose-500/15 hover:!text-rose-300`} aria-label={`Lift the ban on ${d.value ?? d.ip}`} title="Lift this ban" disabled={busy === `u:${id}`} onClick={() => unbanOne(d)}>{busy === `u:${id}` ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* cards (a phone) */}
          <div className="lg:hidden space-y-2">
            {rows.map((d) => {
              const id = idOf(d)
              return (
                <div key={id} className={`${CARD} p-3.5 ${selected.has(id) ? '!border-emerald-500/30' : ''}`}>
                  <div className="flex items-start gap-3">
                    {isAdmin && <input type="checkbox" aria-label={`Select ${d.value ?? d.ip}`} checked={selected.has(id)} onChange={() => toggle(id)} className="accent-emerald-500 mt-1 w-4 h-4" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-slate-100 break-all">{d.value ?? d.ip}</span>
                        {d.scope === 'Range' && <Pill tone="neutral">network</Pill>}
                        {d.simulated && <Pill tone="attention"><FlaskConical size={10} /> simulated</Pill>}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 truncate">{reasonOf(d).title}</p>
                      {d.as_name && <p className="text-[11px] text-slate-500 truncate">AS{d.as_number} · {d.as_name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0"><Expires d={d} /><span className="text-[10px] text-slate-500">ends in</span></div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                    <div className="flex items-center gap-2 min-w-0"><Country code={d.country} /><Pill tone={originTone(d.origin ?? '')}>{originLabel(d.origin ?? '')}</Pill></div>
                    <div className="flex items-center gap-1.5">
                      {d.alert_id && d.origin === 'crowdsec' && <button type="button" className={BTN_ICON_QUIET} aria-label={`Details of the alert behind ${d.value ?? d.ip}`} onClick={() => setAlertId(d.alert_id as number)}><Info size={14} /></button>}
                      {isAdmin && <button type="button" className={`${BTN_ICON_QUIET} !w-auto px-2.5 gap-1.5 text-[11px]`} aria-label={`Lift the ban on ${d.value ?? d.ip}`} disabled={busy === `u:${id}`} onClick={() => unbanOne(d)}>{busy === `u:${id}` ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Lift</button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-slate-500 px-1">
            <span className="tabular-nums">{filtered ? `${fmtNum(data.count)} of ${fmtNum(data.total)} bans match` : `${fmtNum(data.total)} active ban${data.total === 1 ? '' : 's'}`}{rows.length < data.count ? ` · showing ${rows.length}` : ''}</span>
            {rows.length < data.count && limit < 2000 && <button type="button" onClick={() => setLimit((l) => Math.min(2000, l + PAGE))} className="text-cyan-400 hover:text-cyan-300">Show more</button>}
            {data.truncated && <span className="text-amber-400">CrowdSec has more bans than the page loads (2000): filter the list to find the rest.</span>}
            {data.community > 0 && <span title="CrowdSec also holds the community blocklist. Those addresses are enforced by the bouncer but are not listed here.">plus {fmtNum(data.community)} on the community blocklist</span>}
          </div>
        </>
      )}
      {status?.counts && status.counts.simulated > 0 && !hideSim && data && data.total > 0 && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5 px-1"><FlaskConical size={11} /> {status.counts.simulated} simulated ban{status.counts.simulated === 1 ? '' : 's'}: those scenarios only alert (Settings → Simulation) and are never enforced.</p>
      )}

      {banning && <BanSheet initialValue={banning.value} onClose={() => setBanning(null)} onDone={after} />}
      {importing && <ImportSheet onClose={() => setImporting(false)} onDone={after} />}
      {alertId !== null && <AlertSheet id={alertId} onClose={() => setAlertId(null)} />}
    </div>
  )
}
