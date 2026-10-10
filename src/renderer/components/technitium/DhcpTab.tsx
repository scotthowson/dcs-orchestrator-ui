// The Technitium page's DHCP tab: who hands out addresses now, the guided move from the router to Technitium (scan,
// make the scope here off with every known device kept on its address, turn the router's off, turn this one on, renew
// a device and see the DNS it was given), the scopes and their reservations, the leases with the DNS each device got,
// and the devices that do not ask Technitium yet. A viewer reads it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Radar, Network, Router as RouterIcon, Power, RefreshCw, CheckCircle2, XCircle, Loader2, Trash2, ShieldAlert, Pin, ArrowRight,
} from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import StatTile from '../common/StatTile'
import StatusLine from '../common/StatusLine'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import { fetchTechnitiumDhcp, saveTechnitiumScope, switchTechnitiumDhcp, endTechnitiumLease, scanTechnitiumDevices } from '../../api/endpoints'
import type { TechnitiumDhcp, TechnitiumScopeInput } from '../../../shared/types'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR_PRIMARY, BTN_TOOLBAR_OK, BTN_ICON_SM, TONE_GHOST_DANGER, TEXT_META } from '../../lib/ui'
import { INPUT, LABEL, HINT } from '../../lib/fieldStyles'
import { DeviceIcon, ago, useDeviceDirectory } from './deviceKit'

const ROUTER_OFF_KEY = 'dcs-tt-router-dhcp-off'
const ip4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const until = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : iso }

export default function DhcpTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumDhcp, 30000, { key: 'technitium-dhcp' })
  const dir = useDeviceDirectory()
  if (loading && !data) return <Skeleton variant="cards" rows={3} />
  if (error && !data) return <ErrorState title="Could not read Technitium's DHCP" error={error} onRetry={() => void refresh()} />
  if (!data) return null
  const reserved = data.scopes.reduce((n, s) => n + s.reservations.length, 0)
  const onDirectory = async () => { await Promise.all([refresh(), dir.refresh()]) }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={data.enabled ? Network : RouterIcon} label="Hands out addresses" value={data.enabled ? 'Technitium' : 'The router'} tone={data.enabled ? 'ok' : 'neutral'} />
        <StatTile icon={Network} label="Leases" value={data.leases.length.toLocaleString()} tone="neutral" />
        <StatTile icon={Pin} label="Reserved" value={reserved.toLocaleString()} tone="neutral" />
        <StatTile icon={Radar} label="Ask Technitium" value={`${data.devices.asking} of ${data.devices.seen}`} sub="devices seen in the last 24 h" tone={data.devices.seen && data.devices.asking < data.devices.seen ? 'attention' : 'ok'} />
      </div>
      <MoveFlow data={data} isAdmin={isAdmin} devices={dir.data?.devices.length ?? 0} lastScan={dir.data?.last_scan?.at ?? null} onChanged={onDirectory} />
      {data.scopes.map((s) => <ScopePanel key={s.name} scope={s} isAdmin={isAdmin} onChanged={refresh} />)}
      <LeasesPanel data={data} isAdmin={isAdmin} onChanged={refresh} />
      {data.devices.silent.length > 0 && (
        <Panel icon={ShieldAlert} title="Not asking Technitium" sub="Seen on the network in the last 24 hours, but no query reached Technitium: they still use the DNS the router gave them (or one of their own). Once DHCP is here they move over as their leases renew.">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.devices.silent.map((d) => (
              <li key={d.id} className="flex items-center gap-2 min-w-0">
                <DeviceIcon icon={d.icon} size="sm" />
                <span className="truncate text-sm text-slate-300">{d.nickname ?? d.hostname ?? d.ip}</span>
                <span className="font-mono text-xs text-slate-500 shrink-0">{d.ip}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

type StepState = 'done' | 'now' | 'todo'
function Step({ n, state, title, children }: { n: number; state: StepState; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3" aria-current={state === 'now' ? 'step' : undefined}>
      <span aria-hidden className={`h-7 w-7 shrink-0 rounded-full inline-flex items-center justify-center text-xs font-semibold border ${state === 'done' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : state === 'now' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300' : 'bg-white/[0.03] border-white/5 text-slate-500'}`}>
        {state === 'done' ? <CheckCircle2 size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1 pb-4">
        <p className={`text-sm font-medium ${state === 'todo' ? 'text-slate-400' : 'text-slate-200'}`}>{title}<span className="sr-only">{state === 'done' ? ' (done)' : state === 'now' ? ' (next)' : ''}</span></p>
        {children && <div className="mt-2 space-y-3">{children}</div>}
      </div>
    </li>
  )
}

/** the guided move: five steps, each says whether it is done; the next one is open */
function MoveFlow({ data, isAdmin, devices, lastScan, onChanged }: { data: TechnitiumDhcp; isAdmin: boolean; devices: number; lastScan: number | null; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [routerOff, setRouterOff] = useState(() => { try { return localStorage.getItem(ROUTER_OFF_KEY) === '1' } catch { return false } })
  const hubScope = data.scopes.find((s) => data.hub && s.network && data.hub.ip.split('.').slice(0, 3).join('.') === s.network.split('.').slice(0, 3).join('.'))
  const s1: StepState = devices > 0 ? 'done' : 'now'
  const s2: StepState = hubScope ? 'done' : s1 === 'done' ? 'now' : 'todo'
  const s4: StepState = hubScope?.enabled ? 'done' : s2 === 'done' && routerOff ? 'now' : 'todo'
  const s3: StepState = routerOff || hubScope?.enabled ? 'done' : s2 === 'done' ? 'now' : 'todo'
  const s5: StepState = hubScope?.enabled ? 'now' : 'todo'
  const run = async (key: string, fn: () => Promise<{ message: string }>) => {
    setBusy(key)
    try { const r = await fn(); addToast({ type: 'success', message: r.message }); await onChanged() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }
  const markRouter = (v: boolean) => { setRouterOff(v); try { localStorage.setItem(ROUTER_OFF_KEY, v ? '1' : '0') } catch { /* private window */ } }
  const enable = async () => {
    if (!await confirm({ title: 'Hand out addresses from Technitium?', message: `Every device that renews its lease is told to use ${hubScope?.dns.join(' then ')} for DNS. Both resolvers must stay up from now on; if the primary is down for long, turn the router's DHCP back on.\nThe router's DHCP must be off first: two DHCP servers hand out the same addresses.`, confirmLabel: 'Turn DHCP on here' })) return
    await run('enable', () => switchTechnitiumDhcp(true, hubScope?.name))
  }
  return (
    <Panel icon={ArrowRight} title="Move DHCP here" sub="Five steps from the router to Technitium. Nothing changes address: every device DCS knows keeps the one it has.">
      <Notice tone="attention" icon={ShieldAlert} title="Both resolvers must stay up">
        Once Technitium hands out addresses, every device uses {data.resolvers.primary ?? 'the primary'}{data.resolvers.secondary ? ` then ${data.resolvers.secondary}` : ''} for DNS. If the primary is down for long, turn the router's DHCP back on.
      </Notice>
      <ol className="mt-4">
        <Step n={1} state={s1} title="Scan the network, so every device is in the directory">
          <p className={TEXT_META}>{devices ? `${devices} device${devices === 1 ? '' : 's'} known${lastScan ? `, scanned ${ago(lastScan)}` : ''}.` : 'No device known yet.'}</p>
          {isAdmin && <button type="button" disabled={!!busy} className={devices ? BTN_TOOLBAR_QUIET : BTN_TOOLBAR_PRIMARY} onClick={() => void run('scan', scanTechnitiumDevices)}>
            {busy === 'scan' ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />} {devices ? 'Scan again' : 'Scan the network'}
          </button>}
        </Step>
        <Step n={2} state={s2} title="Create the scope here, off">
          {hubScope
            ? <p className={TEXT_META}>{hubScope.name}: {hubScope.start} – {hubScope.end}, {hubScope.reservations.length} reserved, {hubScope.enabled ? 'on' : 'off'}.</p>
            : data.suggested && isAdmin && s2 === 'now'
              ? <ScopeForm suggested={data.suggested} devices={devices} busy={busy === 'scope'} onSave={(sc) => run('scope', () => saveTechnitiumScope(sc))} />
              : <p className={TEXT_META}>{data.suggested ? `From the hub's network: ${data.suggested.start} – ${data.suggested.end}.` : 'The hub has no default route: DCS cannot tell its network.'}</p>}
        </Step>
        <Step n={3} state={s3} title="Turn the router's DHCP off">
          {s3 !== 'todo' && <>
            <p className={TEXT_META}>Bell Home Hub 4000: open http://{data.hub?.gateway ?? '192.168.2.1'}, <strong className="text-slate-300">Advanced tools and settings → DHCP</strong>, turn the DHCP server off, Save. Other routers: LAN or DHCP settings.</p>
            {isAdmin && !hubScope?.enabled && <ToggleRow label="I turned the router's DHCP off" checked={routerOff} onChange={markRouter} />}
          </>}
        </Step>
        <Step n={4} state={s4} title="Turn DHCP on here">
          {isAdmin && hubScope && !hubScope.enabled && (
            <button type="button" disabled={!!busy || !routerOff} className={BTN_TOOLBAR_PRIMARY} onClick={() => void enable()}>
              {busy === 'enable' ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} Turn DHCP on here
            </button>
          )}
          {hubScope?.enabled && <p className={TEXT_META}>Technitium hands out addresses from {hubScope.name}.</p>}
        </Step>
        <Step n={5} state={s5} title="Renew a device and check the DNS it was given">
          {s5 === 'now' && <RenewCheck data={data} onRefresh={onChanged} />}
        </Step>
      </ol>
    </Panel>
  )
}

/** the scope the hub's network suggests, editable; every known device kept on its address (on) */
function ScopeForm({ suggested, devices, busy, onSave }: { suggested: NonNullable<TechnitiumDhcp['suggested']>; devices: number; busy: boolean; onSave: (s: TechnitiumScopeInput) => void }) {
  const [f, setF] = useState({ ...suggested, dns1: suggested.dns[0] ?? '', dns2: suggested.dns[1] ?? '' })
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const bad = [f.start, f.end, f.router, f.dns1].some((v) => !ip4.test(v.trim())) || (f.dns2.trim() !== '' && !ip4.test(f.dns2.trim())) || !(f.lease_hours >= 1 && f.lease_hours <= 720)
  const field = (id: string, label: string, v: string, on: (v: string) => void, ph?: string) => (
    <div><label htmlFor={id} className={LABEL}>{label}</label><input id={id} className={`${INPUT} font-mono`} value={v} placeholder={ph} onChange={(e) => on(e.target.value)} spellCheck={false} /></div>
  )
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!bad) onSave({ name: suggested.name, start: f.start.trim(), end: f.end.trim(), mask: suggested.mask, router: f.router.trim(), dns: [f.dns1.trim(), f.dns2.trim()].filter(Boolean), domain: f.domain.trim() || 'home', lease_hours: f.lease_hours, exclusions: [], ping_check: f.ping_check, reserve_known: f.reserve_known }) }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('ts-start', 'First address', f.start, (v) => set({ start: v }))}
        {field('ts-end', 'Last address', f.end, (v) => set({ end: v }))}
        {field('ts-router', 'Gateway (the router)', f.router, (v) => set({ router: v }))}
        <div><label htmlFor="ts-domain" className={LABEL}>Domain</label><input id="ts-domain" className={INPUT} value={f.domain} onChange={(e) => set({ domain: e.target.value })} /></div>
        {field('ts-dns1', 'DNS: the primary', f.dns1, (v) => set({ dns1: v }), '192.168.2.53')}
        {field('ts-dns2', 'DNS: the secondary', f.dns2, (v) => set({ dns2: v }), '192.168.2.207')}
        <div><label htmlFor="ts-lease" className={LABEL}>Lease, hours</label><input id="ts-lease" type="number" min={1} max={720} className={INPUT} value={f.lease_hours} onChange={(e) => set({ lease_hours: Number(e.target.value) })} /></div>
      </div>
      <ToggleRow label="Keep every known device on its current address" help={`A reservation for each of the ${devices} device${devices === 1 ? '' : 's'} with a MAC, named or not, so nothing changes address at the flip. Machines with an address set by hand never ask and are not affected.`} checked={f.reserve_known} onChange={(v) => set({ reserve_known: v })} />
      <ToggleRow label="Check an address is free before offering it" help="A ping first: an address something answers on is not offered." checked={f.ping_check} onChange={(v) => set({ ping_check: v })} />
      <p className={HINT}>The scope is made off: nothing changes on the network until step 4.</p>
      <button type="submit" disabled={busy || bad} className={BTN_TOOLBAR_PRIMARY}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Network size={14} />} Create the scope (off)</button>
    </form>
  )
}

/** step 5: pick a device, renew it, see whether its lease came from Technitium and which DNS it was given */
function RenewCheck({ data, onRefresh }: { data: TechnitiumDhcp; onRefresh: () => Promise<void> }) {
  const dir = useDeviceDirectory()
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const devices = useMemo(() => (dir.data?.devices ?? []).filter((d) => d.mac && !d.hub), [dir.data])
  const dev = devices.find((d) => d.id === id)
  const lease = dev ? data.leases.find((l) => l.mac === dev.mac) : undefined
  const ours = lease && data.resolvers.primary ? lease.dns.includes(data.resolvers.primary) : !!lease
  const check = useCallback(async () => { setBusy(true); try { await onRefresh() } finally { setBusy(false) } }, [onRefresh])
  useEffect(() => { if (!id && devices[0]) setId(devices[0].id) }, [devices, id])
  return (
    <div className="space-y-3">
      <p className={TEXT_META}>Turn the device's Wi-Fi off and on (or reconnect it), then check.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Device to check" className={`${INPUT} w-auto min-w-[14rem]`} value={id} onChange={(e) => setId(e.target.value)}>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.nickname ?? d.hostname ?? d.ip} · {d.ip}</option>)}
        </select>
        <button type="button" disabled={busy} className={BTN_TOOLBAR_QUIET} onClick={() => void check()}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Check</button>
      </div>
      {dev && (lease
        ? <StatusLine tone={ours ? 'ok' : 'problem'} icon={ours ? CheckCircle2 : XCircle} title={ours ? `${dev.nickname ?? dev.hostname ?? dev.ip} uses Technitium` : 'Its lease names other DNS servers'}>
            Address {lease.ip} from Technitium ({lease.type.toLowerCase()}), DNS {lease.dns.join(', ') || 'none'}, until {until(lease.expires)}.
          </StatusLine>
        : <StatusLine tone="problem" icon={XCircle} title="No lease from Technitium yet">
            {dev.nickname ?? dev.hostname ?? dev.ip} still has the router's lease (and its DNS). Renew it and check again; if it keeps failing, is the router's DHCP off?
          </StatusLine>)}
    </div>
  )
}

function ScopePanel({ scope: s, isAdmin, onChanged }: { scope: TechnitiumDhcp['scopes'][number]; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const flip = async () => {
    if (s.enabled && !await confirm({ title: `Stop handing out addresses from ${s.name}?`, message: 'Devices keep their leases until they end; then they need another DHCP server: turn the router\'s back on first.', confirmLabel: 'Turn DHCP off', danger: true })) return
    if (!s.enabled && !await confirm({ title: `Hand out addresses from ${s.name}?`, message: 'Only with the router\'s DHCP off: two DHCP servers hand out the same addresses. Both resolvers must stay up.', confirmLabel: 'Turn DHCP on' })) return
    setBusy(true)
    try { const r = await switchTechnitiumDhcp(!s.enabled, s.name); addToast({ type: 'success', message: r.message }); await onChanged() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  const rows: [string, React.ReactNode][] = [
    ['Range', <span key="r" className="font-mono">{s.start} – {s.end}</span>],
    ['Gateway', <span key="g" className="font-mono">{s.router ?? '—'}</span>],
    ['DNS', <span key="d" className="font-mono">{s.dns.join(', ') || '—'}</span>],
    ['Domain · lease', `${s.domain || '—'} · ${s.lease_hours} h`],
    ['Kept out', s.exclusions.length ? s.exclusions.map((x) => `${x.startingAddress} – ${x.endingAddress}`).join(', ') : 'nothing'],
    ['Ping check', s.ping_check ? 'on' : 'off'],
  ]
  return (
    <Panel icon={Network} title={`Scope ${s.name}`} badge={s.enabled ? <Pill tone="ok" dot>Hands out addresses</Pill> : <Pill tone="neutral" dot>Off</Pill>}
      actions={isAdmin ? <button type="button" disabled={busy} className={s.enabled ? BTN_TOOLBAR_QUIET : BTN_TOOLBAR_OK} onClick={() => void flip()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} {s.enabled ? 'Turn off' : 'Turn on'}</button> : undefined}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-300 min-w-0 break-words">{v}</dd></div>)}
      </dl>
      {s.reservations.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">{s.reservations.length} reserved address{s.reservations.length === 1 ? '' : 'es'}</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-xs">
            {s.reservations.map((r) => (
              <li key={r.mac} className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-slate-300 w-28 shrink-0">{r.ip}</span>
                <span className="truncate text-slate-400">{r.nickname ?? r.hostname ?? r.mac}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  )
}

function LeasesPanel({ data, isAdmin, onChanged }: { data: TechnitiumDhcp; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const end = async (mac: string, name: string) => {
    if (!await confirm({ title: `End the lease of ${name}?`, message: 'It asks for an address again (a reserved one stays its).', confirmLabel: 'End lease', danger: true })) return
    try { await endTechnitiumLease(mac); addToast({ type: 'success', message: `${name}: the lease is ended` }); await onChanged() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
  }
  if (data.leases.length === 0) {
    return <EmptyState compact icon={<Network size={28} />} title="No leases from Technitium" hint={data.enabled ? 'Devices ask as their leases from the router end, or when they reconnect.' : 'The router still hands out addresses.'} />
  }
  return (
    <Panel icon={Network} title="Leases" badge={<Pill tone="neutral">{data.leases.length}</Pill>} sub="What each device was given: its address and the DNS servers it uses." flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-white/5">
            <th className="pl-4 py-2 font-medium">Device</th><th className="py-2 font-medium">Address</th><th className="py-2 font-medium hidden md:table-cell">MAC</th>
            <th className="py-2 font-medium">DNS given</th><th className="py-2 font-medium hidden sm:table-cell">Until</th><th className="pr-3 py-2"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {data.leases.map((l) => {
              const name = l.nickname ?? l.hostname ?? l.mac
              const ours = data.resolvers.primary ? l.dns.includes(data.resolvers.primary) : true
              return (
                <tr key={l.mac} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="pl-4 py-2"><div className="flex items-center gap-2 min-w-0"><DeviceIcon icon={l.icon} size="sm" /><span className="truncate text-slate-300 max-w-[12rem]">{name}</span>{l.type === 'Reserved' && <Pill size="xs" tone="info">reserved</Pill>}</div></td>
                  <td className="py-2 font-mono text-xs text-slate-300 whitespace-nowrap">{l.ip}</td>
                  <td className="py-2 font-mono text-xs text-slate-500 hidden md:table-cell">{l.mac}</td>
                  <td className="py-2"><span className={`font-mono text-xs ${ours ? 'text-emerald-400' : 'text-rose-400'}`}>{l.dns.join(', ') || '—'}</span></td>
                  <td className="py-2 text-xs text-slate-500 hidden sm:table-cell whitespace-nowrap">{until(l.expires)}</td>
                  <td className="pr-3 py-2 text-right">{isAdmin && <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`End the lease of ${name}`} title="End lease" onClick={() => void end(l.mac, name)}><Trash2 size={14} /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
