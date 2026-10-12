// =============================================================================
// VPN — the containers chosen to go through a WireGuard tunnel to Private Internet Access (Gluetun), with a kill
// switch and PIA's forwarded port in qBittorrent; nothing else on the server goes through it. The API is /vpn/* and
// PUT /containers/{name}/vpn (.lib/vpn.sh on the server, docs/VPN.md).
// =============================================================================

import { useMemo, useState } from 'react'
import {
  RefreshCw, Lock, Plug, Pause, Play, Loader2, ShieldCheck, Globe, Clock, ArrowDownUp, Plus, Settings2, Radar, Smartphone, Unlock,
} from 'lucide-react'
import PageHeader from '../components/common/PageHeader'
import StatTile from '../components/common/StatTile'
import Notice from '../components/common/Notice'
import Sheet from '../components/common/Sheet'
import { Pill } from '../components/common/Pill'
import { Toggle } from '../components/common/Toggle'
import { EmptyState, ErrorState, Skeleton } from '../components/common/PageState'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useConfirm } from '../components/common/ConfirmDialog'
import { useToast } from '../components/common/Toast'
import { Panel } from '../components/dashboard/cardShared'
import { useContainerVpnSwitch } from '../components/containers/VpnButton'
import { useVpnEnabled } from '../hooks/useTechnitiumEnabled'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { pageLabel } from '../constants/pageTitles'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { apiErrorData, apiErrorMessage } from '../api/errors'
import {
  fetchVpnStatus, fetchVpnRegions, vpnConnect, vpnPause, vpnResume, vpnLeakTest, setVpnWireguardClients, deployTemplate, fetchContainers,
} from '../api/endpoints'
import type { VpnLeakResult, VpnStatus } from '../../shared/types'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR_PRIMARY, BTN_TOOLBAR_ATTN, BTN_SHEET_PRIMARY, BTN_CARD_QUIET, TEXT_META } from '../lib/ui'
import { PAGE_STACK } from '../lib/pageKit'
import { INPUT, LABEL, HINT } from '../lib/fieldStyles'

function uptime(s: number | null): string {
  if (s == null) return '—'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}
const VERDICT: Record<VpnLeakResult['verdict'], { tone: 'ok' | 'problem' | 'neutral' | 'attention'; text: string }> = {
  tunnel: { tone: 'ok', text: 'Tunnel' },
  leak: { tone: 'problem', text: 'Home address!' },
  offline: { tone: 'neutral', text: 'No internet' },
  unknown: { tone: 'attention', text: 'Unknown address' },
}

export default function Vpn() {
  const isAdmin = useAuthStore((s) => s.userRole === 'admin')
  const on = useVpnEnabled()
  const setPage = useSettingsStore((s) => s.setCurrentPage)
  const { data: st, error, loading, refresh, fetching } = usePolling(fetchVpnStatus, 15000, { key: pollKeys.vpnStatus, enabled: on === true })
  const off = on === false || apiErrorData(error)?.code === 'feature_off'
  const [connectOpen, setConnectOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [leaks, setLeaks] = useState<{ exit_ip: string | null; results: VpnLeakResult[] } | null>(null)
  const { addToast } = useToast()
  const confirm = useConfirm()

  const run = async (what: string, fn: () => Promise<{ message?: string } | unknown>, ok?: string) => {
    setBusy(what)
    try {
      const r = await fn() as { message?: string }
      addToast({ type: 'success', message: ok ?? r?.message ?? 'Done' })
      await refresh()
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }

  if (off) {
    return (
      <div className={`${PAGE_STACK} animate-fade-in`}>
        <PageHeader page="vpn" />
        <EmptyState icon={<Lock size={28} />} title="The VPN is off"
          hint={isAdmin ? `Turn it on in ${pageLabel('config')} → Integrations: the containers you choose (qBittorrent) go through a WireGuard tunnel to Private Internet Access, nothing else.` : 'An admin turns it on in Config → Integrations.'}
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_PRIMARY} onClick={() => setPage('config')}><Settings2 size={14} /> Open {pageLabel('config')}</button> : undefined} />
      </div>
    )
  }

  const setup = async () => {
    const ok = await confirm({
      title: 'Set up the VPN?',
      message: 'DCS adds Gluetun (the vpn-gluetun template) to the networking-security stack, not started yet. Then you connect it with your Private Internet Access account.',
      confirmLabel: 'Set up',
    })
    if (!ok) return
    await run('setup', () => deployTemplate('vpn-gluetun', { target_stack: 'networking-security', auto_start: false, routes: false }), 'Gluetun is in networking-security: now connect it')
    setConnectOpen(true)
  }
  const pause = async () => {
    const names = st?.attached.map((a) => a.container) ?? []
    const ok = await confirm({
      title: 'Pause the VPN?',
      message: names.length
        ? `Gluetun stops. ${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} no network at all until you resume it (the kill switch). Nothing else on the server is affected.`
        : 'Gluetun stops until you resume it.',
      confirmLabel: 'Pause', danger: true,
    })
    if (ok) await run('pause', vpnPause)
  }
  const leakTest = async () => {
    setBusy('leak')
    try { const r = await vpnLeakTest(); setLeaks(r); addToast({ type: r.leaks ? 'error' : 'success', message: r.leaks ? `${r.leaks} container${r.leaks === 1 ? '' : 's'} showed the home address` : 'No leak: nothing behind the VPN shows the home address' }); await refresh() }
    catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }

  return (
    <div className={`${PAGE_STACK} animate-fade-in`}>
      <DisconnectedBanner />
      <PageHeader
        page="vpn"
        badge={st?.deployed && st.configured ? <TunnelPill st={st} /> : undefined}
        actions={<>
          <button type="button" onClick={() => void refresh()} className={BTN_TOOLBAR_QUIET} aria-label="Refresh">
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span>
          </button>
          {isAdmin && st?.configured && st.attached.length > 0 && (
            <button type="button" disabled={!!busy} onClick={() => void leakTest()} className={BTN_TOOLBAR_QUIET}>
              {busy === 'leak' ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />} Test for leaks
            </button>
          )}
          {isAdmin && st?.configured && (st.paused
            ? <button type="button" disabled={!!busy} onClick={() => void run('resume', vpnResume)} className={BTN_TOOLBAR_ATTN}>{busy === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Resume</button>
            : <button type="button" disabled={!!busy} onClick={() => void pause()} className={BTN_TOOLBAR_QUIET}>{busy === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Pause</button>)}
          {isAdmin && st?.deployed && (
            <button type="button" onClick={() => setConnectOpen(true)} className={st.configured ? BTN_TOOLBAR_QUIET : BTN_TOOLBAR_PRIMARY}>
              <Plug size={14} /> {st.configured ? 'Account & region' : 'Connect'}
            </button>
          )}
        </>}
      />

      {(loading || on === null) && !st && <Skeleton variant="tiles" rows={4} />}
      {error && !st && <ErrorState title="Could not read the VPN's status" error={error} onRetry={() => void refresh()} />}

      {st && !st.deployed && (
        <EmptyState icon={<Lock size={28} />} title="The VPN is not set up"
          hint={isAdmin ? 'DCS adds Gluetun to the networking-security stack, you connect it with your Private Internet Access account, then choose the containers that go through it.' : 'An admin sets it up here.'}
          action={isAdmin ? <button type="button" disabled={!!busy} className={BTN_TOOLBAR_PRIMARY} onClick={() => void setup()}>{busy === 'setup' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Set up the VPN</button> : undefined} />
      )}
      {st?.deployed && !st.configured && (
        <EmptyState icon={<Plug size={28} />} title="Connect your Private Internet Access account"
          hint={isAdmin ? 'DCS registers a WireGuard key with PIA on the fastest server that forwards a port (or the region you pick). Your user name and password stay in DCS\'s secrets.' : 'An admin connects it here.'}
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_PRIMARY} onClick={() => setConnectOpen(true)}><Plug size={14} /> Connect</button> : undefined} />
      )}

      {st?.deployed && st.configured && <Overview st={st} isAdmin={isAdmin} leaks={leaks} onChanged={refresh} />}

      {connectOpen && st && <ConnectSheet st={st} onClose={() => setConnectOpen(false)} onChanged={refresh} />}
    </div>
  )
}

function TunnelPill({ st }: { st: VpnStatus }) {
  if (st.paused) return <Pill tone="attention" dot>Paused</Pill>
  if (st.connected) return <Pill tone="ok" dot>Connected</Pill>
  return <Pill tone="problem" dot>Down</Pill>
}

function Overview({ st, isAdmin, leaks, onChanged }: { st: VpnStatus; isAdmin: boolean; leaks: { exit_ip: string | null; results: VpnLeakResult[] } | null; onChanged: () => Promise<void> }) {
  const behind = st.attached
  const tunnelTone = st.paused ? 'attention' : st.connected ? 'ok' : 'problem'
  const qbit = behind.find((a) => a.qbittorrent)
  return (
    <div className={PAGE_STACK}>
      {st.paused && <Notice tone="attention" title="The VPN is paused">{behind.length ? `${behind.map((a) => a.container).join(', ')} ${behind.length === 1 ? 'has' : 'have'} no network until you resume it.` : 'Resume it to bring the tunnel back.'}</Notice>}
      {st.alerts.map((a) => <Notice key={a.key} tone="problem" title={a.headline}>{a.message}</Notice>)}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={ShieldCheck} label="Tunnel" short="Tunnel" tone={tunnelTone}
          value={st.paused ? 'Paused' : st.connected ? 'Connected' : 'Down'}
          sub={[st.region_name, st.server_name].filter(Boolean).join(' · ') || undefined} />
        <StatTile icon={Globe} label="Exit address" short="Exit" tone="info" value={<span className="font-mono text-base">{st.public_ip ?? '—'}</span>}
          sub={[st.city, st.country].filter(Boolean).join(', ') || undefined} />
        <StatTile icon={ArrowDownUp} label="Forwarded port" short="Port" tone={st.port_forwarding && !st.forwarded_port && st.connected ? 'attention' : 'neutral'}
          value={st.forwarded_port ?? (st.port_forwarding ? '…' : 'Off')}
          sub={qbit ? (st.qbittorrent_error ? 'qBittorrent: not set' : st.qbittorrent_port && st.qbittorrent_port === st.forwarded_port ? 'qBittorrent listens on it' : 'qBittorrent: on its way') : undefined} />
        <StatTile icon={Clock} label="Up" short="Up" tone="neutral" value={st.running ? uptime(st.uptime_s) : 'Stopped'} sub="Gluetun" />
      </div>
      {qbit && st.qbittorrent_error && <Notice tone="attention" title="qBittorrent did not take the forwarded port">{st.qbittorrent_error}</Notice>}
      <BehindPanel st={st} isAdmin={isAdmin} leaks={leaks} onChanged={onChanged} />
      <WireguardPanel st={st} isAdmin={isAdmin} onChanged={onChanged} />
    </div>
  )
}

function BehindPanel({ st, isAdmin, leaks, onChanged }: { st: VpnStatus; isAdmin: boolean; leaks: { exit_ip: string | null; results: VpnLeakResult[] } | null; onChanged: () => Promise<void> }) {
  const toggle = useContainerVpnSwitch()
  const [busy, setBusy] = useState<string | null>(null)
  const [pick, setPick] = useState('')
  const { data: list } = usePolling(() => fetchContainers(null), 60000, { key: pollKeys.containers(null), enabled: isAdmin })
  const behindNames = useMemo(() => new Set(st.attached.map((a) => a.container)), [st.attached])
  // any running container of a stack on this server, not already behind it, not Gluetun itself
  const candidates = useMemo(() => (list?.containers ?? [])
    .filter((c) => !c.member && c.state === 'running' && !!c.stack && c.name !== st.container && !behindNames.has(c.name))
    .map((c) => c.name).sort((a, b) => a.localeCompare(b)), [list, behindNames, st.container])
  const flip = async (name: string, on: boolean) => {
    setBusy(name)
    try { if (await toggle(name, on)) { setPick(''); await onChanged() } } finally { setBusy(null) }
  }
  return (
    <Panel icon={Lock} title="Behind the VPN" sub="Everything these containers send leaves through the tunnel; when it is down they reach nothing">
      {st.attached.length === 0
        ? <p className={TEXT_META}>No container goes through the VPN yet.{isAdmin ? ' Add qBittorrent below.' : ''}</p>
        : (
          <ul className="divide-y divide-white/5">
            {st.attached.map((a) => {
              const leak = leaks?.results.find((r) => r.container === a.container) ?? a.leak_test
              return (
                <li key={a.container} className="flex flex-wrap items-center gap-3 py-2.5 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm text-slate-200 font-medium">{a.container}</span>
                      {!a.running && <Pill tone="attention" size="xs">Stopped</Pill>}
                      {a.qbittorrent && <Pill tone="info" size="xs">Forwarded port</Pill>}
                    </div>
                    <p className={TEXT_META}>{a.stack}/{a.service}{a.targets.length ? ` · ports ${a.targets.join(', ')} on Gluetun` : ''}</p>
                  </div>
                  {leak && <Pill tone={VERDICT[leak.verdict].tone} size="xs" title={leak.ip ? `The outside world saw ${leak.ip}` : 'It could not reach the outside world'}>{VERDICT[leak.verdict].text}{leak.ip ? ` · ${leak.ip}` : ''}</Pill>}
                  {isAdmin && (
                    <span className="inline-flex items-center gap-2">
                      {busy === a.container && <Loader2 size={14} className="animate-spin text-slate-400" />}
                      <Toggle checked label={`${a.container} through the VPN`} disabled={!!busy} onChange={(v) => void flip(a.container, v)} />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 sm:flex-none sm:w-72">
            <label htmlFor="vpn-add" className={LABEL}>Add a container</label>
            <select id="vpn-add" className={INPUT} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a running container…</option>
              {candidates.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="button" disabled={!pick || !!busy} className={BTN_CARD_QUIET} onClick={() => void flip(pick, true)}>
            {busy === pick && pick ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Through the VPN
          </button>
        </div>
      )}
    </Panel>
  )
}

function WireguardPanel({ st, isAdmin, onChanged }: { st: VpnStatus; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const w = st.wireguard_clients
  const flip = async (on: boolean) => {
    if (on && !await confirm({
      title: 'Route your WireGuard clients through the VPN?',
      message: 'Your phones keep connecting to this home\'s address, and still reach the home network; what they do on the internet leaves through the VPN. Their speed is limited by your home\'s upload (every byte crosses it twice). When the tunnel is down, their internet stops too.',
      confirmLabel: 'Route them through the VPN',
    })) return
    setBusy(true)
    try { const r = await setVpnWireguardClients(on, w.container ?? undefined); addToast({ type: 'success', message: r.message }); await onChanged() }
    catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Panel icon={Smartphone} title="WireGuard clients" sub={`The WireGuard server${w.container ? ` (${w.container})` : ''} keeps the home address; its clients' internet can leave through the VPN`}
      badge={w.on ? <Pill tone="ok" dot>Through the VPN</Pill> : undefined}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-200">Route my WireGuard clients through the VPN</p>
          <p className={TEXT_META}>{w.on && w.subnet ? `Clients ${w.subnet} leave through the tunnel; the server stays reachable at home. ` : ''}Speed: limited by your home&apos;s upload, since every byte crosses it twice.</p>
        </div>
        {isAdmin && <span className="inline-flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin text-slate-400" />}<Toggle checked={w.on} label="Route my WireGuard clients through the VPN" disabled={busy} onChange={(v) => void flip(v)} /></span>}
      </div>
    </Panel>
  )
}

function ConnectSheet({ st, onClose, onChanged }: { st: VpnStatus; onClose: () => void; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const { data, error } = usePolling(fetchVpnRegions, 3600000, { key: 'vpn-regions' })
  const [region, setRegion] = useState('auto')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const needAccount = !st.account_set
  const typed = user.trim() !== '' || pass !== ''
  const canGo = !busy && (needAccount ? user.trim() !== '' && pass !== '' : !typed || (user.trim() !== '' && pass !== ''))
  const go = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await vpnConnect({ region, ...(typed ? { username: user.trim(), password: pass } : {}) })
      setResult({ ok: true, text: r.message }); addToast({ type: 'success', message: r.message }); setPass('')
      await onChanged()
    } catch (e) { setResult({ ok: false, text: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Private Internet Access" subtitle="Your account and where the tunnel comes out" icon={<Plug size={16} />} onClose={onClose}
      footer={<button type="button" disabled={!canGo} className={`${BTN_SHEET_PRIMARY} w-full`} onClick={() => void go()}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />} {st.configured ? 'Connect again' : 'Connect'}
      </button>}>
      <div className="space-y-4">
        <div>
          <label htmlFor="vpn-region" className={LABEL}>Region</label>
          <select id="vpn-region" className={INPUT} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="auto">Fastest that forwards a port</option>
            {(data?.regions ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <p className={HINT}>{error ? 'PIA\'s list of regions could not be read; the fastest is picked when you connect.' : 'Only the regions that forward a port (for qBittorrent), Canada\'s first.'}{st.region_name ? ` Now: ${st.region_name}${st.server_name ? ` (${st.server_name})` : ''}.` : ''}</p>
        </div>
        <div>
          <label htmlFor="vpn-user" className={LABEL}>PIA user name</label>
          <input id="vpn-user" className={`${INPUT} font-mono`} value={user} onChange={(e) => setUser(e.target.value)} placeholder={st.account_set ? 'Stored: leave empty to keep it' : 'p1234567'} autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <label htmlFor="vpn-pass" className={LABEL}>Password</label>
          <input id="vpn-pass" type="password" className={INPUT} value={pass} onChange={(e) => setPass(e.target.value)} placeholder={st.account_set ? 'Stored: leave empty to keep it' : 'Your PIA password'} autoComplete="off" />
          <p className={HINT}>Kept in DCS&apos;s secrets once PIA accepts it, and never shown again. DCS uses it to register a WireGuard key and for the forwarded port.</p>
        </div>
        {result && <Notice tone={result.ok ? 'ok' : 'problem'} role="status">{result.text}</Notice>}
      </div>
    </Sheet>
  )
}
