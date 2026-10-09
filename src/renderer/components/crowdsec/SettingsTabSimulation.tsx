// =============================================================================
// Settings → simulation mode. A scenario in simulation mode still detects and
// still raises alerts, but its bans are only pretend: they show in the list with
// a "simulated" chip and the Traefik bouncer never enforces them. One switch
// makes the whole engine watch-only; then the scenarios that are switched off are
// the exceptions that still ban (the API's exclusions). A switch acts at once,
// optimistically, and goes back if CrowdSec refuses. CrowdSec is reloaded after
// each change (about two seconds), so changes go out one at a time.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CircleAlert, FlaskConical, Info, Loader2, Package, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecSimulation, crowdsecSetSimulation } from '../../api/endpoints'
import { errMsg, useCs } from './kit'
import { type ScenarioInfo } from './SettingsTabParts'
import { BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import { Toggle } from '../common/Toggle'
import Notice from '../common/Notice'
import { Panel } from '../dashboard/cardShared'
import SearchInput from '../common/SearchInput'
const POLL_MS = 30_000
const SHOWN = 50

export interface SimRow { name: string; description: string; simulated: boolean }
export interface SimView { global: boolean; exclusions: string[]; scenarios: SimRow[] }

export interface Simulation {
  view: SimView | null
  error: Error | null
  /** scenario names (and '*' for the whole-engine switch) with a change waiting or running */
  pending: string[]
  retry: () => void
  setScenario: (name: string, simulated: boolean) => void
  setGlobal: (on: boolean) => void
  /** what the profile card offers as suggestions */
  installed: ScenarioInfo[]
}

/** the tab's one source of truth for simulation: polled, optimistic while changes are on their way */
export function useSimulation(): Simulation {
  const { member, refreshStatus } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const [fresh, setFresh] = useState<SimView | null>(null)
  const [local, setLocal] = useState<SimView | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const gen = useRef(0)
  const inFlight = useRef(0)
  const chain = useRef<Promise<void>>(Promise.resolve())

  // no polling while changes are on their way, and an answer that was asked before the last change is thrown away
  const poll = usePolling(async () => {
    const g = gen.current
    const d = await crowdsecSimulation(member)
    return { g, d }
  }, POLL_MS, { enabled: isConnected && pending.length === 0 })
  useEffect(() => {
    const p = poll.data
    if (!p || p.g !== gen.current || inFlight.current > 0) return
    setFresh({ global: p.d.global, exclusions: p.d.exclusions ?? [], scenarios: p.d.scenarios ?? [] })
    setLocal(null)
  }, [poll.data])

  const view = local ?? fresh
  const viewRef = useRef<SimView | null>(null); viewRef.current = view

  const queue = useCallback((key: string, optimistic: (v: SimView) => SimView, revert: (v: SimView) => SimView, call: () => Promise<{ message: string }>, failText: string) => {
    const cur = viewRef.current
    if (!cur) return
    gen.current++
    inFlight.current++
    setPending((q) => [...q, key])
    setLocal((l) => optimistic(l ?? cur))
    chain.current = chain.current.then(async () => {
      try {
        const r = await call()
        addToast({ type: 'success', message: `${r.message}. CrowdSec was reloaded.`, duration: 4500 })
        refreshStatus()
      } catch (e) {
        setLocal((l) => (l ? revert(l) : l))
        addToast({ type: 'error', message: errMsg(e, failText), duration: 8000 })
      } finally {
        inFlight.current--
        setPending((q) => { const i = q.indexOf(key); return i < 0 ? q : [...q.slice(0, i), ...q.slice(i + 1)] })
      }
    })
  }, [addToast, refreshStatus])

  const setScenario = useCallback((name: string, simulated: boolean) => {
    const set = (on: boolean) => (v: SimView): SimView => ({
      ...v,
      scenarios: v.scenarios.map((r) => (r.name === name ? { ...r, simulated: on } : r)),
      exclusions: (v.global ? !on : on) ? [...new Set([...v.exclusions, name])] : v.exclusions.filter((x) => x !== name),
    })
    queue(name, set(simulated), set(!simulated), () => crowdsecSetSimulation({ scenario: name, enabled: simulated }, member), `Could not change ${name}`)
  }, [queue, member])

  const setGlobal = useCallback((on: boolean) => {
    const before = viewRef.current
    if (!before) return
    // the API clears the exceptions when the mode flips: everything follows the switch
    queue('*', (v) => ({ global: on, exclusions: [], scenarios: v.scenarios.map((r) => ({ ...r, simulated: on })) }), () => before, () => crowdsecSetSimulation({ global: true, enabled: on }, member), 'Could not change watch-only mode')
  }, [queue, member])

  const installed = useMemo<ScenarioInfo[]>(() => (view?.scenarios ?? []).map((r) => ({ name: r.name, description: r.description })), [view?.scenarios])
  return { view, error: poll.error, pending, retry: poll.refresh, setScenario, setGlobal, installed }
}

type Filter = 'all' | 'sim' | 'ban'

export default function SimulationCard({ sim }: { sim: Simulation }) {
  const { isAdmin, status, goTab } = useCs()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [all, setAll] = useState(false)
  const { view, error, pending } = sim

  const rows = view?.scenarios ?? []
  const simulatedCount = rows.filter((r) => r.simulated).length
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => (filter === 'all' || (filter === 'sim') === r.simulated) && (!needle || r.name.toLowerCase().includes(needle) || r.description.toLowerCase().includes(needle)))
  }, [rows, q, filter])
  const visible = all ? shown : shown.slice(0, SHOWN)
  const global = !!view?.global
  const bansNow = status?.counts?.simulated ?? 0

  const flipGlobal = async (on: boolean) => {
    if (on && !(await confirm({
      title: 'Turn on watch-only mode?',
      message: 'CrowdSec will keep detecting attacks and raising alerts, but the bans it makes from now on are only pretend, so Traefik will not block those attackers. Bans that already exist and bans you add by hand still work. Turn it off again to be protected.',
      confirmLabel: 'Turn on watch-only mode',
      danger: true,
    }))) return
    if (!on && !(await confirm({
      title: 'Turn off watch-only mode?',
      message: 'Every scenario bans again. The scenarios you had made exceptions (they kept banning) go back to normal too, and so does anything you switched to alerts only before.',
      confirmLabel: 'Turn it off',
    }))) return
    sim.setGlobal(on)
  }

  if (!view) {
    return (
      <Panel id="cs-simulation" icon={FlaskConical} title="Simulation mode" sub="Scenarios that only alert and never ban.">
        {error ? (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-3 flex items-start gap-2.5" role="alert">
            <CircleAlert size={16} className="text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-100">Could not read the simulation settings</p>
              <p className="text-xs text-slate-300 mt-1 break-words">{error.message}</p>
              <button type="button" onClick={sim.retry} className={`${BTN_TOOLBAR_QUIET} mt-2`}><RefreshCw size={14} /> Try again</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the simulation settings"><SkeletonBlock className="h-20" /><SkeletonBlock className="h-9" /><SkeletonBlock className="h-40" /></div>
        )}
      </Panel>
    )
  }

  return (
    <Panel
      id="cs-simulation"
      icon={FlaskConical}
      title="Simulation mode"
      sub="A scenario in simulation mode still detects attacks and raises alerts, but it never bans anyone. Use it to try a new or noisy scenario before you let it block traffic."
      actions={<>
        {global ? <Pill tone="problem">watch only</Pill> : simulatedCount > 0 ? <Pill tone="attention"><FlaskConical size={10} /> {simulatedCount} simulated</Pill> : <Pill tone="neutral">all scenarios ban</Pill>}
      </>}
    >
      {error && <p className="mb-3 text-[11px] text-amber-300 flex items-center gap-1.5" role="status">Could not refresh just now, so this is the last answer. <button type="button" onClick={sim.retry} className="text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-2">Try again</button></p>}

      {/* the whole engine */}
      <div className={`rounded-xl border p-3.5 ${global ? 'border-rose-500/25 bg-rose-500/[0.05]' : 'border-white/5 bg-white/[0.02]'}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-slate-200">Watch only</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">CrowdSec detects and alerts but bans nothing. Handy for a first week on real traffic, to see what would be blocked before anything is.</p>
            <p className={HINT}>Default: off.</p>
          </div>
          {isAdmin
            ? <div className="flex items-center gap-2 shrink-0">{pending.includes('*') && <Loader2 size={14} className="animate-spin text-slate-500" aria-label="Working" />}<Toggle checked={global} onChange={flipGlobal} label="Watch only: detect and alert but ban nothing" disabled={pending.includes('*')} /></div>
            : <Pill tone={global ? 'problem' : 'neutral'}>{global ? 'on' : 'off'}</Pill>}
        </div>
        {global && (
          <Notice tone="problem" icon={TriangleAlert} role="alert" className="mt-3" title="CrowdSec is not blocking new attackers">
            Watch only is on. CrowdSec still sees attacks and raises alerts, but the bans it makes are only pretend, so Traefik does not block those attackers. Bans that already exist and bans you add by hand still work.
            {rows.length > 0 && <> The scenarios below with their switch off are the exceptions: they still ban.</>}
          </Notice>
        )}
      </div>

      {/* one by one */}
      <div className="mt-5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-64">
            <SearchInput size="sm" value={q} onChange={(v) => { setQ(v); setAll(false) }} id="sim-search" placeholder="Search scenarios" autoComplete="off" label="Search the scenarios" />
          </div>
          <Segmented<Filter> value={filter} onChange={(v) => { setFilter(v); setAll(false) }} ariaLabel="Which scenarios to list" options={[
            { value: 'all', label: 'All', count: rows.length },
            { value: 'sim', label: 'Alerts only', count: simulatedCount },
            { value: 'ban', label: global ? 'Still banning' : 'Banning', count: rows.length - simulatedCount },
          ]} />
          <p className="text-xs text-slate-500 tabular-nums sm:ml-auto" aria-live="polite">{simulatedCount} of {rows.length} {global ? 'only alert' : 'simulated'}{global && rows.length - simulatedCount > 0 ? `, ${rows.length - simulatedCount} still ban` : ''}</p>
        </div>

        {rows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] px-5 py-8 text-center">
            <Package size={26} className="mx-auto text-slate-500" aria-hidden="true" />
            <p className="mt-3 text-sm text-slate-300">No scenarios are installed</p>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">CrowdSec has nothing to detect yet, so there is nothing to simulate. Install a collection from the Hub and its scenarios appear here.</p>
            <button type="button" className={`${BTN_TOOLBAR_QUIET} mt-4`} onClick={() => goTab('hub')}><ArrowRight size={14} /> Open the Hub</button>
          </div>
        ) : shown.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] px-5 py-8 text-center">
            <p className="text-sm text-slate-300">No scenario matches.</p>
            <button type="button" className={`${BTN_TOOLBAR_QUIET} mt-3`} onClick={() => { setQ(''); setFilter('all') }}><X size={14} /> Clear the search</button>
          </div>
        ) : (
          <>
            <ul className="mt-2 md:columns-2 md:gap-x-8" aria-label="Scenarios">
              {visible.map((r) => {
                const busy = pending.includes(r.name)
                return (
                  <li key={r.name} className="flex items-center gap-3 py-2.5 border-b border-white/[0.04] min-w-0 break-inside-avoid">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px] text-slate-100 break-all leading-snug">{r.name}</p>
                      {r.description && <p className="text-[11px] text-slate-500 leading-snug mt-0.5 line-clamp-2" title={r.description}>{r.description}</p>}
                    </div>
                    {global && !r.simulated && <Pill tone="info" title="An exception: this scenario still bans while watch-only is on">still bans</Pill>}
                    {!global && r.simulated && <Pill tone="attention" title="Only raises alerts: its bans are never enforced"><FlaskConical size={10} /> alerts only</Pill>}
                    {isAdmin ? (
                      <div className="flex items-center gap-2 shrink-0">
                        {busy && <Loader2 size={13} className="animate-spin text-slate-500" aria-label="Working" />}
                        <Toggle checked={r.simulated} onChange={(v) => sim.setScenario(r.name, v)} label={`Alerts only for ${r.name}`} />
                      </div>
                    ) : global && r.simulated ? <Pill tone="neutral">alerts only</Pill> : null}
                  </li>
                )
              })}
            </ul>
            {shown.length > visible.length && (
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setAll(true)}>Show all {shown.length}</button>
                <span className="text-[11px] text-slate-500 tabular-nums">Showing the first {visible.length}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-5 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2.5 flex items-start gap-2.5 text-xs text-slate-500 leading-relaxed">
        <Info size={14} className="shrink-0 mt-0.5 text-slate-500" aria-hidden="true" />
        <p>
          What a simulated ban looks like: the detection still shows in Alerts, and its ban appears in Bans with a <Pill tone="attention"><FlaskConical size={10} /> simulated</Pill> chip.
          The Traefik bouncer never enforces it, so the address is not blocked.
          {bansNow > 0 && <> Right now {bansNow} simulated ban{bansNow === 1 ? '' : 's'} {bansNow === 1 ? 'is' : 'are'} on the list.</>}
          {' '}<button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => goTab('bans')}>Open Bans</button>
        </p>
      </div>
    </Panel>
  )
}
