// =============================================================================
// Technitium — the home's DNS (Technitium DNS Server, a primary and a secondary)
// run from DCS: what is asked and blocked, pausing the blocking, the kids'
// groups and their bedtime, a device's queries, the lists, both servers in
// step. The API is /dns/technitium/* (.lib/technitium.sh on the server).
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Menu } from '@mantine/core'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  RefreshCw, Pause, Play, ChevronDown, Plug, Wand2, Server, ShieldCheck, Users, Activity as ActivityIcon, ListChecks,
  ArrowLeftRight, Search, Ban, Globe, MonitorSmartphone, CheckCircle2, Loader2,
} from 'lucide-react'
import PageHeader from '../components/common/PageHeader'
import StatTile from '../components/common/StatTile'
import StatusLine from '../components/common/StatusLine'
import Notice from '../components/common/Notice'
import Sheet from '../components/common/Sheet'
import Segmented from '../components/common/Segmented'
import { Pill } from '../components/common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../components/common/PageState'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useConfirm } from '../components/common/ConfirmDialog'
import { useToast } from '../components/common/Toast'
import { Panel } from '../components/dashboard/cardShared'
import KidsTab from '../components/technitium/KidsTab'
import { ActivityTab, ListsTab } from '../components/technitium/ActivityTab'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { apiErrorMessage } from '../api/errors'
import { useAuthStore } from '../stores/authStore'
import {
  fetchTechnitiumStatus, fetchTechnitiumStats, technitiumPause, technitiumResume, technitiumSync, technitiumListName,
  connectTechnitium, bootstrapTechnitium,
} from '../api/endpoints'
import type { TechnitiumInstance, TechnitiumRange, TechnitiumRole, TechnitiumStatus, TechnitiumStats } from '../../shared/types'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR_OK, BTN_TOOLBAR_ATTN, BTN_TOOLBAR_PRIMARY, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST_OK, TEXT_META } from '../lib/ui'
import { PAGE_STACK } from '../lib/pageKit'
import { INPUT, LABEL, HINT } from '../lib/fieldStyles'
import { TONE_HEX } from '../lib/tone'

type Tab = 'overview' | 'kids' | 'activity' | 'lists'
const RANGES: { value: TechnitiumRange; label: string }[] = [
  { value: 'lastHour', label: 'Last hour' }, { value: 'lastDay', label: 'Last day' }, { value: 'lastWeek', label: 'Last week' },
]
const BASELINE = [
  'Forwarders: Quad9 (9.9.9.9, 149.112.112.112) and Mullvad (194.242.2.2), over TLS, one at a time',
  'DNSSEC validation on, IPv6 not preferred',
  'Blocklists: Hagezi Pro, Threat Intelligence Feeds and DoH bypass, updated daily (lists you added stay)',
  'The query log for 30 days (installs the Query Logs (Sqlite) app)',
  'The Advanced Blocking app for the kids\' groups',
  'Names dns1 and dns2, a cache of 20 000 entries',
]

const num = (n: number | undefined) => (n ?? 0).toLocaleString()
function since(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}
function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function Technitium() {
  const isAdmin = useAuthStore((s) => s.userRole === 'admin')
  const [tab, setTab] = useState<Tab>('overview')
  const [connectOpen, setConnectOpen] = useState(false)
  const { data: status, error, loading, refresh, fetching } = usePolling(fetchTechnitiumStatus, 15000, { key: pollKeys.technitiumStatus })

  const tabs = [
    { value: 'overview' as const, label: 'Overview', icon: Globe },
    { value: 'kids' as const, label: 'Kids', icon: Users, count: status?.groups || undefined },
    ...(isAdmin ? [{ value: 'activity' as const, label: 'Devices', icon: ActivityIcon }] : []),
    { value: 'lists' as const, label: 'Lists', icon: ListChecks },
  ]

  return (
    <div className={`${PAGE_STACK} animate-fade-in`}>
      <DisconnectedBanner />
      <PageHeader
        page="technitium"
        badge={status?.configured ? <SyncPill status={status} /> : undefined}
        actions={<>
          <button type="button" onClick={() => void refresh()} className={BTN_TOOLBAR_QUIET} aria-label="Refresh">
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span>
          </button>
          {status?.configured && isAdmin && <PauseControl status={status} onDone={refresh} />}
          {status?.configured && isAdmin && status.secondary?.configured && <SyncButton onDone={refresh} />}
          {isAdmin && (
            <button type="button" onClick={() => setConnectOpen(true)} className={status?.configured ? BTN_TOOLBAR_QUIET : BTN_TOOLBAR_PRIMARY}>
              <Plug size={14} /> {status?.configured ? 'Servers' : 'Connect'}
            </button>
          )}
        </>}
      />

      {loading && !status && <Skeleton variant="tiles" rows={4} />}
      {error && !status && <ErrorState title="Could not read Technitium's status" error={error} onRetry={() => void refresh()} />}

      {status && !status.configured && (
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="No Technitium is connected"
          hint={isAdmin
            ? 'Give DCS the address of your Technitium server (http://192.168.2.53:5380) and an API token made in Technitium: your name at the top right → Create API Token. A second server can follow it.'
            : 'An admin connects the Technitium servers here.'}
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_PRIMARY} onClick={() => setConnectOpen(true)}><Plug size={14} /> Connect Technitium</button> : undefined}
        />
      )}

      {status?.configured && (
        <>
          <Segmented ariaLabel="Technitium view" value={tab} onChange={setTab} options={tabs} />
          {tab === 'overview' && <Overview status={status} isAdmin={isAdmin} onChanged={refresh} />}
          {tab === 'kids' && <KidsTab isAdmin={isAdmin} onChanged={refresh} />}
          {tab === 'activity' && isAdmin && <ActivityTab />}
          {tab === 'lists' && <ListsTab isAdmin={isAdmin} />}
        </>
      )}

      {connectOpen && <ConnectSheet status={status ?? null} onClose={() => setConnectOpen(false)} onChanged={refresh} />}
    </div>
  )
}

function SyncPill({ status }: { status: TechnitiumStatus }) {
  if (status.in_sync === null) return <Pill tone="neutral" dot>One server</Pill>
  return status.in_sync
    ? <Pill tone="ok" dot title={status.last_sync?.message}>In sync</Pill>
    : <Pill tone="attention" dot title={status.last_sync?.message ?? 'The secondary differs from the primary'}>Out of sync</Pill>
}

// ---- Pause blocking: a split button (5 min, or 15 / 60 from its menu), a countdown while paused ----
function PauseControl({ status, onDone }: { status: TechnitiumStatus; onDone: () => Promise<void> }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const until = status.primary.paused_until ? Date.parse(status.primary.paused_until) : 0
  const paused = until > now
  useEffect(() => {
    if (!paused) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [paused])
  useEffect(() => { setNow(Date.now()) }, [status])
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); addToast({ type: 'success', message: ok }); await onDone() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  if (paused) {
    return (
      <button type="button" disabled={busy} onClick={() => void run(technitiumResume, 'Blocking is back on')} className={BTN_TOOLBAR_ATTN} aria-label={`Blocking paused, ${countdown(until - now)} left: resume now`}>
        <Play size={14} /> Paused · <span className="tabular-nums">{countdown(until - now)}</span> · Resume
      </button>
    )
  }
  const pause = (m: 5 | 15 | 60) => void run(() => technitiumPause(m), `Blocking paused for ${m} minutes on every server`)
  return (
    <div className="inline-flex" role="group" aria-label="Pause blocking">
      <button type="button" disabled={busy} onClick={() => pause(5)} className={`${BTN_TOOLBAR_QUIET} rounded-r-none`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause 5 min
      </button>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <button type="button" disabled={busy} className={`${BTN_TOOLBAR_QUIET} rounded-l-none border-l-0 px-2`} aria-label="Pause for longer"><ChevronDown size={14} /></button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => pause(15)}>Pause 15 minutes</Menu.Item>
          <Menu.Item onClick={() => pause(60)}>Pause 1 hour</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}

function SyncButton({ onDone }: { onDone: () => Promise<void> }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} className={BTN_TOOLBAR_QUIET} onClick={async () => {
      setBusy(true)
      try { const r = await technitiumSync(); addToast({ type: 'success', message: r.message }); await onDone() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
    }}>
      <ArrowLeftRight size={14} className={busy ? 'animate-pulse' : ''} /> Sync now
    </button>
  )
}

// ---- Overview ----
function Overview({ status, isAdmin, onChanged }: { status: TechnitiumStatus; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const [range, setRange] = useState<TechnitiumRange>('lastHour')
  const fetchStats = useCallback(() => fetchTechnitiumStats(range), [range])
  const { data: stats, error, loading, refresh } = usePolling(fetchStats, 30000, { key: `technitium-stats:${range}` })
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const allow = async (domain: string) => {
    try { const r = await technitiumListName('allow', domain); addToast({ type: 'success', message: r.message }); void refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
  }
  const baseline = async () => {
    const ok = await confirm({
      title: 'Apply the baseline?',
      message: `On ${status.secondary?.configured ? 'both servers' : 'the server'}:\n• ${BASELINE.join('\n• ')}\nOnly what differs is changed; running it again changes nothing.`,
      confirmLabel: 'Apply baseline',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await bootstrapTechnitium('both')
      const n = Object.values(r.roles).reduce((a, x) => a + (x?.changed.length ?? 0) + (x?.installed.length ?? 0), 0)
      addToast({ type: 'success', message: r.unchanged ? 'The baseline was already there: nothing changed' : `Baseline applied: ${n} change${n === 1 ? '' : 's'}` })
      await onChanged()
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  const blockedPct = stats && stats.totals.queries ? Math.round((stats.totals.blocked / stats.totals.queries) * 100) : 0
  const chart = useMemo(() => (stats?.series.labels ?? []).map((t, i) => ({
    t: new Date(t).toLocaleTimeString([], range === 'lastHour' ? { hour: '2-digit', minute: '2-digit' } : { weekday: range === 'lastWeek' ? 'short' : undefined, hour: '2-digit' }),
    queries: stats?.series.queries[i] ?? 0, blocked: stats?.series.blocked[i] ?? 0,
  })), [stats, range])

  return (
    <div className={PAGE_STACK}>
      <div className="grid gap-3 md:grid-cols-2">
        <InstancePanel inst={status.primary} title="Primary" />
        {status.secondary
          ? <InstancePanel inst={status.secondary} title="Secondary" />
          : <Panel icon={Server} title="Secondary"><p className={TEXT_META}>No second server. Connect one (Servers) and DCS keeps it equal to the primary, so the house keeps its DNS while one restarts.</p></Panel>}
      </div>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => void baseline()} className={BTN_TOOLBAR_OK}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Apply baseline
          </button>
          <span className={TEXT_META}>Quad9 and Mullvad over TLS, DNSSEC, Hagezi lists, a 30-day query log, the kids' app.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented ariaLabel="Range" value={range} onChange={setRange} options={RANGES} />
        {stats && stats.unreachable.length > 0 && <Pill tone="attention" dot>{stats.unreachable.map((u) => u.role).join(', ')} not counted</Pill>}
      </div>
      {error && !stats && <ErrorState title="Could not read the numbers" error={error} onRetry={() => void refresh()} />}
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={Search} label="Queries" value={num(stats?.totals.queries)} loading={loading && !stats} tone="info" />
        <StatTile icon={Ban} label="Blocked" value={num(stats?.totals.blocked)} sub={stats ? `${blockedPct} % of them` : undefined} loading={loading && !stats} tone="neutral" />
        <StatTile icon={MonitorSmartphone} label="Clients" value={num(stats?.totals.clients)} loading={loading && !stats} tone="neutral" />
      </div>
      {chart.length > 1 && (
        <Panel icon={ActivityIcon} title="Queries and blocked" sub={RANGES.find((r) => r.value === range)?.label}>
          <div className="h-36" aria-label={`Queries over the ${range === 'lastHour' ? 'last hour' : range === 'lastDay' ? 'last day' : 'last week'}: ${num(stats?.totals.queries)}, of which ${num(stats?.totals.blocked)} blocked`} role="img">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: TONE_HEX.neutral }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: TONE_HEX.neutral }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(255 255 255 / 0.1)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="queries" name="Queries" stroke={TONE_HEX.info} fill={TONE_HEX.info} fillOpacity={0.12} strokeWidth={1.5} />
                <Area type="monotone" dataKey="blocked" name="Blocked" stroke={TONE_HEX.attention} fill={TONE_HEX.attention} fillOpacity={0.15} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
      {stats && <TopLists stats={stats} isAdmin={isAdmin} onAllow={allow} />}
    </div>
  )
}

function InstancePanel({ inst, title }: { inst: TechnitiumInstance; title: string }) {
  let badge = <Pill tone="ok" dot>Blocking</Pill>
  if (!inst.reachable) badge = <Pill tone="problem" dot>Not answering</Pill>
  else if (inst.blocking === false) badge = <Pill tone="attention" dot>Blocking paused</Pill>
  return (
    <Panel icon={Server} title={title} badge={badge}
      sub={<span className="font-mono break-all">{inst.url}{inst.domain ? ` · ${inst.domain}` : ''}</span>}>
      {!inst.reachable
        ? <Notice tone="problem" title="DCS cannot reach this server">{inst.error}</Notice>
        : (
          <ul className="space-y-0">
            <StatusLine as="li" dense tone="ok" title={`Technitium ${inst.version}`}>up {since(inst.up_since)}</StatusLine>
            <StatusLine as="li" dense tone={inst.forwarders?.length ? 'ok' : 'attention'} title={inst.forwarders?.length ? `${inst.forwarders.length} forwarders over ${inst.forwarder_protocol?.toUpperCase()}` : 'No forwarders: it resolves by itself'}>{inst.dnssec ? 'DNSSEC validated' : 'DNSSEC off'}</StatusLine>
            <StatusLine as="li" dense tone={inst.block_lists ? 'ok' : 'attention'} title={`${inst.block_lists ?? 0} blocklist${inst.block_lists === 1 ? '' : 's'}`}>{inst.lists_last_update ? `updated ${since(inst.lists_last_update)} ago` : 'not downloaded yet'}</StatusLine>
            <StatusLine as="li" dense tone={inst.apps?.query_logs && inst.apps?.advanced_blocking ? 'ok' : 'attention'} title={`Query log ${inst.apps?.query_logs ? 'on' : 'missing'} · kids' app ${inst.apps?.advanced_blocking ? 'installed' : 'missing'}`}>{inst.zones ?? 0} zones · {inst.allowed ?? 0} allowed · {inst.blocked ?? 0} blocked name{inst.blocked === 1 ? '' : 's'}</StatusLine>
          </ul>
        )}
    </Panel>
  )
}

function TopLists({ stats, isAdmin, onAllow }: { stats: TechnitiumStats; isAdmin: boolean; onAllow: (d: string) => void }) {
  const Row = ({ k, name, count, action }: { k: string; name: React.ReactNode; count: number; action?: React.ReactNode }) => (
    <li key={k} className="flex items-center gap-2 py-1.5 min-w-0">
      <div className="min-w-0 flex-1 text-sm text-slate-300 truncate">{name}</div>
      <span className="text-xs text-slate-500 tabular-nums">{count.toLocaleString()}</span>
      {action}
    </li>
  )
  const empty = <p className={TEXT_META}>Nothing yet in this range.</p>
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel icon={MonitorSmartphone} title="Top clients">
        {stats.top_clients.length ? <ul>{stats.top_clients.map((c) => <Row key={c.ip} k={c.ip} count={c.count} name={<>{c.name ?? c.ip}{c.name && <span className="ml-2 font-mono text-xs text-slate-500">{c.ip}</span>}</>} />)}</ul> : empty}
      </Panel>
      <Panel icon={Globe} title="Top domains">
        {stats.top_domains.length ? <ul>{stats.top_domains.map((d) => <Row key={d.domain} k={d.domain} count={d.count} name={<span className="font-mono text-xs">{d.domain}</span>} />)}</ul> : empty}
      </Panel>
      <Panel icon={Ban} title="Top blocked">
        {stats.top_blocked.length ? <ul>{stats.top_blocked.map((d) => (
          <Row key={d.domain} k={d.domain} count={d.count} name={<span className="font-mono text-xs">{d.domain}</span>}
            action={isAdmin ? <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`} onClick={() => onAllow(d.domain)} aria-label={`Allow ${d.domain} for everyone`} title="Allow for everyone"><CheckCircle2 size={14} /></button> : undefined} />
        ))}</ul> : empty}
      </Panel>
    </div>
  )
}

// ---- Connect: the address and the API token of each server ----
function ConnectSheet({ status, onClose, onChanged }: { status: TechnitiumStatus | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [role, setRole] = useState<TechnitiumRole>('primary')
  const current = role === 'primary' ? status?.primary : status?.secondary
  const [url, setUrl] = useState(current?.url ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { setUrl((role === 'primary' ? status?.primary : status?.secondary)?.url ?? ''); setToken(''); setResult(null) }, [role]) // eslint-disable-line react-hooks/exhaustive-deps
  const urlOk = /^https?:\/\/[^\s/]+$/.test(url.trim().replace(/\/$/, ''))
  const hasToken = !!current?.configured
  const save = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await connectTechnitium(role, url.trim().replace(/\/$/, ''), token.trim() || undefined)
      setResult({ ok: !!r.reachable, text: r.message ?? (r.reachable ? 'Connected' : r.error ?? 'Saved') })
      if (r.reachable) { addToast({ type: 'success', message: r.message ?? 'Connected' }); setToken('') }
      await onChanged()
    } catch (e) { setResult({ ok: false, text: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  const disconnect = async () => {
    if (!await confirm({ title: `Disconnect the ${role}?`, message: 'DCS forgets its address and its token. Technitium itself keeps running as it is.', confirmLabel: 'Disconnect', danger: true })) return
    setBusy(true)
    try { await connectTechnitium(role, ''); addToast({ type: 'success', message: `The ${role} is disconnected` }); await onChanged(); onClose() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Technitium servers" subtitle="Each server's web console address and an API token" icon={<Plug size={16} />} onClose={onClose}
      footer={<div className="flex gap-2">
        {current?.configured && <button type="button" disabled={busy} className={BTN_SHEET_QUIET} onClick={() => void disconnect()}>Disconnect</button>}
        <button type="button" disabled={busy || !urlOk || (!hasToken && !token.trim())} className={`${BTN_SHEET_PRIMARY} flex-1`} onClick={() => void save()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Save and test
        </button>
      </div>}>
      <div className="space-y-4">
        <Segmented ariaLabel="Server" value={role} onChange={setRole} fullWidth options={[
          { value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary', disabled: !status?.primary.configured },
        ]} />
        <div>
          <label htmlFor="tt-url" className={LABEL}>Address</label>
          <input id="tt-url" className={`${INPUT} font-mono`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={role === 'primary' ? 'http://192.168.2.53:5380' : 'http://192.168.2.207:5380'} autoComplete="off" spellCheck={false} />
          <p className={HINT}>Technitium's web console: http, the server's address and port 5380.</p>
        </div>
        <div>
          <label htmlFor="tt-token" className={LABEL}>API token</label>
          <input id="tt-token" type="password" className={`${INPUT} font-mono`} value={token} onChange={(e) => setToken(e.target.value)} placeholder={hasToken ? 'Stored: leave empty to keep it' : 'Paste the token'} autoComplete="off" />
          <p className={HINT}>In Technitium: your name at the top right → Create API Token. DCS keeps it in its secrets store and never shows it again.</p>
        </div>
        {result && <Notice tone={result.ok ? 'ok' : 'problem'} role="status">{result.text}</Notice>}
      </div>
    </Sheet>
  )
}

