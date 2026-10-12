// =============================================================================
// The VPN page's panels beyond the status (GET /vpn/traffic, GET /vpn/history, POST /vpn/speed-test, POST /vpn/server):
// what goes through the tunnel (the rates now, 24 hours, today and this month, each container's share), the server
// and its speed, and what the tunnel did (drops with their reason, reconnects, the forwarded port, tests, uptime).
// =============================================================================

import { useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  ArrowDown, ArrowUp, Activity, History, Gauge, Loader2, Zap, Server, CalendarDays, Sun, Radar, Plug, Unplug, RotateCcw, Pause, Play,
  ArrowDownUp, Square, CircleDot, ShieldCheck, ShieldAlert, Repeat,
} from 'lucide-react'
import StatTile from '../common/StatTile'
import Notice from '../common/Notice'
import { Pill } from '../common/Pill'
import { EmptyState } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { Panel } from '../dashboard/cardShared'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { apiErrorMessage } from '../../api/errors'
import { formatBytes } from '../../api/fleetScopedOps'
import { fetchVpnTraffic, fetchVpnHistory, fetchVpnRegions, vpnSpeedTest, vpnChangeServer } from '../../api/endpoints'
import type { VpnStatus, VpnEvent, VpnBytes } from '../../../shared/types'
import { TONE_HEX, TONE_FILL } from '../../lib/tone'
import { BTN_CARD_QUIET, TEXT_META } from '../../lib/ui'
import { INPUT, LABEL } from '../../lib/fieldStyles'

/** bytes per second as the network says it (bits): 12.3 Mbps */
export function rate(bps: number | null | undefined): string {
  if (bps == null) return '—'
  const b = bps * 8
  if (b < 1e3) return `${Math.round(b)} bps`
  if (b < 1e6) return `${Math.round(b / 1e3)} kbps`
  if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} Mbps`
  return `${(b / 1e9).toFixed(2)} Gbps`
}
export function duration(s: number | null | undefined): string {
  if (s == null) return '—'
  if (s < 90) return `${Math.max(0, Math.round(s))} s`
  if (s < 7200) return `${Math.round(s / 60)} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}
export const ago = (t: number | null | undefined) => (t ? `${duration(Date.now() / 1000 - t)} ago` : 'never')
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const when = (t: number) => {
  const d = new Date(t * 1000)
  return d.toDateString() === new Date().toDateString() ? clock(t) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const both = (b: VpnBytes | undefined) => (b ? `↓ ${formatBytes(b.rx)} · ↑ ${formatBytes(b.tx)}` : '—')

// ---- Traffic ----
export function TrafficPanel() {
  const { data: tr } = usePolling(fetchVpnTraffic, 10000, { key: pollKeys.vpnTraffic })
  const chart = useMemo(() => (tr?.per_5min ?? []).map(([t, rx, tx]) => ({ t: clock(t), down: +(rx * 8 / 300 / 1e6).toFixed(2), up: +(tx * 8 / 300 / 1e6).toFixed(2) })), [tr])
  const monthTotal = (tr?.totals.month.rx ?? 0) + (tr?.totals.month.tx ?? 0)
  const rows = [
    ...(tr?.containers ?? []).map((c) => ({ name: c.container, today: c.today, month: c.month, share: c.share, measured: c.measured })),
    ...(tr?.wireguard_clients ? [{ name: 'WireGuard clients', today: tr.wireguard_clients.today, month: tr.wireguard_clients.month, share: monthTotal ? (tr.wireguard_clients.month.rx + tr.wireguard_clients.month.tx) / monthTotal : null, measured: true }] : []),
  ]
  const peak = Math.max(0, ...chart.map((p) => Math.max(p.down, p.up)))
  return (
    <Panel icon={Activity} title="Traffic" sub="Everything that went through the tunnel, counted inside Gluetun every minute (down is what came in)">
      {!tr || (!tr.measured && chart.length === 0)
        ? <EmptyState compact icon={<Activity size={22} />} title="Nothing counted yet" hint="The count starts within a minute of the tunnel being up." />
        : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile icon={ArrowDown} label="Download now" short="Down" tone="info" value={rate(tr.live?.rx_bps)} sub={tr.live ? `over ${Math.round(tr.live.window_s)} s` : 'no sample yet'} />
              <StatTile icon={ArrowUp} label="Upload now" short="Up" tone="ok" value={rate(tr.live?.tx_bps)} sub={tr.live ? `over ${Math.round(tr.live.window_s)} s` : undefined} />
              <StatTile icon={Sun} label="Today" short="Today" tone="neutral" value={formatBytes(tr.totals.today.rx + tr.totals.today.tx)} sub={both(tr.totals.today)} />
              <StatTile icon={CalendarDays} label="This month" short="Month" tone="neutral" value={formatBytes(monthTotal)} sub={both(tr.totals.month)} />
            </div>
            {chart.length > 1 && (
              <div>
                <p className={`${TEXT_META} mb-1`}>Last 24 hours, Mbps (5-minute average{peak ? `, peak ${peak} Mbps` : ''})</p>
                <div className="h-32" role="img" aria-label={`Traffic over the last 24 hours: ${both(tr.totals.last_24h)}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: TONE_HEX.neutral }} tickLine={false} axisLine={false} minTickGap={32} />
                      <YAxis tick={{ fontSize: 10, fill: TONE_HEX.neutral }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(255 255 255 / 0.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v} Mbps`} />
                      <Area type="monotone" dataKey="down" name="Down" stroke={TONE_HEX.info} fill={TONE_HEX.info} fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                      <Area type="monotone" dataKey="up" name="Up" stroke={TONE_HEX.ok} fill={TONE_HEX.ok} fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {rows.length > 0 && (
              <div>
                <p className={`${TEXT_META} mb-1`}>Who used it this month</p>
                <ul className="divide-y divide-white/5">
                  {rows.map((r) => (
                    <li key={r.name} className="py-2 min-w-0">
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <span className="truncate text-sm text-slate-200">{r.name}</span>
                        {r.measured
                          ? <span className="shrink-0 text-xs tabular-nums text-slate-300">{formatBytes(r.month.rx + r.month.tx)}{r.share != null ? ` · ${Math.round(r.share * 100)} %` : ''}</span>
                          : <Pill tone="neutral" size="xs" title={tr.counting_error ?? 'Counted from the next minute'}>Not counted</Pill>}
                      </div>
                      {r.measured && (
                        <>
                          <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden" aria-hidden><div className={`h-full ${TONE_FILL.info}`} style={{ width: `${Math.min(100, Math.round((r.share ?? 0) * 100))}%` }} /></div>
                          <p className={`${TEXT_META} mt-1`}>Today {both(r.today)}</p>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tr.counting_error && <Notice tone="neutral" title="Each container's share is not counted">{tr.counting_error}</Notice>}
          </div>
        )}
    </Panel>
  )
}

// ---- The server and its speed ----
export function ServerPanel({ st, isAdmin, onChanged }: { st: VpnStatus; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const { data: regions, refresh: refreshRegions } = usePolling(fetchVpnRegions, 3600000, { key: 'vpn-regions', enabled: isAdmin })
  const [region, setRegion] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [now] = useState(() => Date.now() / 1000)
  const last = st.last_speed_test
  const wait = last?.at ? Math.max(0, 300 - (now - last.at)) : 0
  const move = async (target: string) => {
    const name = target === 'fastest' ? 'the fastest server (measured now)' : regions?.regions.find((r) => r.id === target)?.name ?? target
    const behind = st.attached.map((a) => a.container)
    if (!await confirm({
      title: `Move the tunnel to ${name}?`,
      message: `DCS registers a new key there with your stored PIA account and restarts Gluetun.${behind.length ? ` ${behind.join(', ')} ${behind.length === 1 ? 'is' : 'are'} offline for a few seconds.` : ''} The forwarded port changes.`,
      confirmLabel: 'Move',
    })) return
    setBusy(target === 'fastest' ? 'fastest' : 'move')
    try { const r = await vpnChangeServer(target); addToast({ type: 'success', message: r.message }); setRegion(''); await onChanged(); await refreshRegions() }
    catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }
  const speed = async () => {
    setBusy('speed')
    try { const r = await vpnSpeedTest(); addToast({ type: 'success', message: r.message }); await onChanged() }
    catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }
  const options = (regions?.regions ?? []).filter((r) => r.name !== st.region_name)
  return (
    <Panel icon={Server} title="Server and speed" sub="Where the tunnel comes out, how far away it is, and how fast it goes">
      <div className="grid grid-cols-2 gap-3">
        <StatTile icon={Server} label="Server" tone="neutral" value={<span className="text-base">{st.region_name ?? '—'}</span>}
          sub={[st.server_name, st.server_latency_ms != null ? `${st.server_latency_ms} ms` : null].filter(Boolean).join(' · ') || undefined} />
        <StatTile icon={Gauge} label="Speed" tone="neutral" value={last?.mbps != null ? `${last.mbps} Mbps` : '—'}
          sub={last?.mbps != null ? [last.latency_ms != null ? `${last.latency_ms} ms` : null, ago(last.at)].filter(Boolean).join(' · ') : 'not measured yet'} />
      </div>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 w-full sm:w-72">
            <label htmlFor="vpn-move" className={LABEL}>Change server</label>
            <select id="vpn-move" className={INPUT} value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Choose a region…</option>
              {options.map((r) => <option key={r.id} value={r.id}>{r.name}{r.latency_ms != null ? ` · ${r.latency_ms} ms` : ''}</option>)}
            </select>
          </div>
          <button type="button" disabled={!region || !!busy} className={BTN_CARD_QUIET} onClick={() => void move(region)}>
            {busy === 'move' ? <Loader2 size={12} className="animate-spin" /> : <Repeat size={12} />} Move
          </button>
          <button type="button" disabled={!!busy} className={BTN_CARD_QUIET} onClick={() => void move('fastest')} title="Measures every region that forwards a port and moves to the quickest">
            {busy === 'fastest' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Fastest now
          </button>
          <button type="button" disabled={!!busy || !st.connected || wait > 0} className={BTN_CARD_QUIET} onClick={() => void speed()}
            title={wait > 0 ? `One test every 5 minutes: ${Math.ceil(wait / 60)} min to go` : 'Downloads a test file through the tunnel (20 MB)'}>
            {busy === 'speed' ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />} {busy === 'speed' ? 'Testing…' : 'Test speed'}
          </button>
        </div>
      )}
    </Panel>
  )
}

// ---- History ----
const KIND: Record<string, { icon: typeof Plug; tone: 'ok' | 'problem' | 'attention' | 'info' | 'neutral' }> = {
  connect: { icon: Plug, tone: 'ok' }, reconnect: { icon: RotateCcw, tone: 'ok' }, disconnect: { icon: Unplug, tone: 'problem' },
  restart: { icon: RotateCcw, tone: 'attention' }, server_change: { icon: Repeat, tone: 'info' }, pause: { icon: Pause, tone: 'attention' },
  resume: { icon: Play, tone: 'ok' }, rekey: { icon: RotateCcw, tone: 'attention' }, port: { icon: ArrowDownUp, tone: 'info' },
  speed_test: { icon: Gauge, tone: 'info' }, speed_test_failed: { icon: Gauge, tone: 'attention' }, leak_test: { icon: Radar, tone: 'info' },
  policy_stop: { icon: Square, tone: 'attention' }, policy_start: { icon: Play, tone: 'ok' }, policy_kept: { icon: Square, tone: 'neutral' },
  attach: { icon: Plug, tone: 'neutral' }, detach: { icon: Unplug, tone: 'neutral' },
}
const TONE_ICON = { ok: 'text-emerald-400', problem: 'text-rose-400', attention: 'text-amber-400', info: 'text-cyan-400', neutral: 'text-slate-400' }

function EventRow({ e }: { e: VpnEvent }) {
  const k = KIND[e.kind] ?? { icon: CircleDot, tone: 'neutral' as const }
  const Icon = e.kind === 'leak_test' && e.leaks ? ShieldAlert : k.icon
  return (
    <li className="flex items-start gap-2.5 py-2 min-w-0">
      <Icon size={14} className={`mt-0.5 shrink-0 ${TONE_ICON[k.tone]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 break-words">{e.message}</p>
        <p className={TEXT_META}>{when(e.t)}</p>
      </div>
    </li>
  )
}

export function HistoryPanel() {
  const { data: h } = usePolling(fetchVpnHistory, 30000, { key: pollKeys.vpnHistory })
  const [all, setAll] = useState(false)
  const events = h?.events ?? []
  const shown = all ? events : events.slice(0, 8)
  const pctTone = (p: number | null | undefined) => (p == null ? 'neutral' : p >= 99.5 ? 'ok' : p >= 97 ? 'attention' : 'problem') as 'ok' | 'attention' | 'problem' | 'neutral'
  const leak = h?.last_leak_test
  return (
    <Panel icon={History} title="History" sub="What the tunnel did: drops with their reason, reconnects, server moves, the forwarded port, tests">
      {!h ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile icon={ShieldCheck} label="Up, 24 hours" short="24 h" tone={pctTone(h.uptime.last_24h)} value={h.uptime.last_24h != null ? `${h.uptime.last_24h} %` : '—'} sub={`${h.reconnects_24h} reconnect${h.reconnects_24h === 1 ? '' : 's'}`} />
            <StatTile icon={CalendarDays} label="Up, 30 days" short="30 d" tone={pctTone(h.uptime.last_30d)} value={h.uptime.last_30d != null ? `${h.uptime.last_30d} %` : '—'} sub="paused time not counted" />
            <StatTile icon={Activity} label="This session" short="Session" tone="neutral" value={h.session.up ? duration(h.session.length_s) : h.session.paused ? 'Paused' : 'Down'} sub={h.session.since ? `since ${when(h.session.since)}` : undefined} />
            <StatTile icon={Radar} label="Last leak test" short="Leaks" tone={leak ? (leak.leaks ? 'problem' : 'ok') : 'neutral'} value={leak ? (leak.leaks ? `${leak.leaks} leak${leak.leaks === 1 ? '' : 's'}` : 'No leak') : '—'}
              sub={leak ? `${leak.tested} container${leak.tested === 1 ? '' : 's'} · ${ago(leak.at)}` : 'never run'} />
          </div>
          {h.ports.length > 0 && (
            <div>
              <p className={`${TEXT_META} mb-1`}>Forwarded port</p>
              <div className="flex flex-wrap gap-1.5">
                {h.ports.slice(0, 6).map((p, i) => <Pill key={`${p.port}-${p.from}`} tone={i === 0 && !p.to ? 'info' : 'neutral'} size="xs" title={`${when(p.from)} → ${p.to ? when(p.to) : 'now'}`}>{p.port} · {p.to ? `until ${when(p.to)}` : `since ${when(p.from)}`}</Pill>)}
              </div>
            </div>
          )}
          {events.length === 0
            ? <p className={TEXT_META}>Nothing yet: the minute clock writes here as soon as the tunnel does something.</p>
            : (
              <>
                <ul className="divide-y divide-white/5">{shown.map((e, i) => <EventRow key={`${e.t}-${i}`} e={e} />)}</ul>
                {events.length > 8 && <button type="button" className={BTN_CARD_QUIET} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${events.length}`}</button>}
              </>
            )}
        </div>
      )}
    </Panel>
  )
}
