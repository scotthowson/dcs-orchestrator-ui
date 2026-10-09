// =============================================================================
// Overview: what has been happening (and where from), whether the bans are
// enforced, how the engine is doing. The window switch (24 h, 7 d, 30 d) drives
// the timeline, the countries, the kinds of attack and the busiest sources.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Globe2, Crosshair, Radar, Network, ShieldCheck, Users, Cpu, Ban, RotateCw, RefreshCw, ArrowRight, Plug, UserCheck, Loader2, CircleAlert, CircleCheck, Info, Clock, TriangleAlert, ShieldOff, KeyRound } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecMetrics, crowdsecAlerts, crowdsecCommunity, crowdsecService, crowdsecRegisterTraefikBouncer, fetchRoutes } from '../../api/endpoints'
import { useSettingsStore } from '../../stores/settingsStore'
import type { CrowdSecMetricsResponse } from '../../../shared/types'
import { BTN_DANGER, BTN_PRIMARY, BTN_QUIET, CARD, Chip, Country, Dot, SectionHead, Segmented, Skel, countryName, errMsg, familyTone, fmtAgo, fmtNum, fmtTime, useCs, useNow, type Tone } from './kit'
import { BarRow, TimelineChart } from './charts'
import BanSheet from './BanSheet'
import { AlertSheet } from './AlertsTab'
import WorldMap from './WorldMap'
import { CheckNowButton, PAUSED_TEXT, REFUSED_TEXT, RegisterAgainButton, capiState, focusEnrolOnOpen, lastContact } from './CommunityActions'

type Win = '24h' | '7d' | '30d'
const WIN_LABEL: Record<Win, string> = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days' }
const WIN_KEY = 'dcs-crowdsec-window'
function loadWin(): Win {
  try { const v = localStorage.getItem(WIN_KEY); return v === '7d' || v === '30d' ? v : '24h' } catch { return '24h' }
}

function Panel({ title, icon, right, children, className = '' }: { title: string; icon: React.ElementType; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`${CARD} p-4 min-w-0 ${className}`} aria-label={title}>
      <SectionHead icon={icon} title={title} right={right} className="mb-3 min-h-[36px]" />
      {children}
    </section>
  )
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-500 py-6 text-center leading-relaxed">{children}</p>
}

/** a row in the protection / community cards: a dot, a headline, a line of explanation, an optional action */
function StatusRow({ tone, title, children, action, icon }: { tone: Tone; title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ElementType }) {
  const Icon = icon ?? (tone === 'good' ? CircleCheck : tone === 'mute' ? Info : CircleAlert)
  const cls = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-rose-400' : tone === 'info' ? 'text-cyan-400' : 'text-slate-500'
  return (
    <div className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon size={16} className={`${cls} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 leading-snug">{title}</p>
        {children && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{children}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

/** one line of the protection checklist: a tick, what was checked, what it says */
function CheckLine({ state, label, children }: { state: 'ok' | 'warn' | 'bad' | 'mute'; label: string; children?: React.ReactNode }) {
  const Icon = state === 'ok' ? CircleCheck : state === 'mute' ? Info : state === 'bad' ? CircleAlert : TriangleAlert
  const cls = state === 'ok' ? 'text-emerald-400' : state === 'warn' ? 'text-amber-400' : state === 'bad' ? 'text-rose-400' : 'text-slate-500'
  return (
    <li className="flex items-start gap-2 py-1">
      <Icon size={13} className={`${cls} shrink-0 mt-0.5`} aria-hidden="true" />
      <p className="text-xs text-slate-300 min-w-0 leading-snug"><span className="sr-only">{state === 'ok' ? 'Fine: ' : state === 'mute' ? 'Note: ' : 'Needs attention: '}</span>{label}{children ? <span className="text-slate-500"> · {children}</span> : null}</p>
    </li>
  )
}

export default function OverviewTab() {
  const { member, isAdmin, status: s, refreshStatus, goTab } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const now = useNow()
  const [win, setWinState] = useState<Win>(loadWin)
  const setWin = (w: Win) => { setWinState(w); try { localStorage.setItem(WIN_KEY, w) } catch { /* private window */ } }
  const [srcView, setSrcView] = useState<'addresses' | 'networks'>('addresses')
  const [allCountries, setAllCountries] = useState(false)
  const [banning, setBanning] = useState<string | null>(null)
  const [alertId, setAlertId] = useState<number | null>(null)
  const [busy, setBusy] = useState('')

  const winRef = useRef(win); winRef.current = win
  const metrics = usePolling<CrowdSecMetricsResponse>(() => crowdsecMetrics(winRef.current, member), 30000)
  const mRefresh = metrics.refresh
  useEffect(() => { mRefresh() }, [win, member, mRefresh])
  // manual bans are alerts too, but they are not detections: ask for a few more and leave them out
  const recent = usePolling(() => crowdsecAlerts({ window: '24h', limit: 16, simulated: 'any' }, member), 20000)
  const latest = useMemo(() => (recent.data?.alerts ?? []).filter((a) => a.kind !== 'cscli').slice(0, 6), [recent.data])
  const community = usePolling(() => crowdsecCommunity(member), 60000, { key: pollKeys.crowdsecCommunity(member) })
  const routes = usePolling(fetchRoutes, 45000, { key: pollKeys.routes, enabled: !member })
  const bypass = useMemo(() => (routes.data?.routes ?? []).filter((r) => r.crowdsec === 'bypass'), [routes.data])
  const checked = useMemo(() => (routes.data?.routes ?? []).filter((r) => r.crowdsec === 'protected').length, [routes.data])
  const setPage = useSettingsStore((st) => st.setCurrentPage)

  const m = metrics.data
  // the metrics of the window that was asked for; while another window loads, show the old numbers dimmed instead of a flash of skeleton
  const stale = !!m && m.window !== win
  const maxCountry = useMemo(() => Math.max(1, ...(m?.countries ?? []).map((c) => c.alerts)), [m])
  const bansBy = useMemo(() => new Map((m?.bans_by_country ?? []).map((b) => [b.code, b.count])), [m])
  const countries = m?.countries ?? []
  const shownCountries = allCountries ? countries : countries.slice(0, 7)
  const maxScen = Math.max(1, ...(m?.scenarios ?? []).map((x) => x.alerts))
  const maxSrc = Math.max(1, ...(m?.sources ?? []).map((x) => x.alerts))
  const maxNet = Math.max(1, ...(m?.networks ?? []).map((x) => x.alerts))
  const t = m?.totals

  const runService = async (action: 'reload' | 'restart') => {
    if (action === 'restart' && !(await confirm({ title: 'Restart CrowdSec?', message: 'Detection pauses for a few seconds while the container restarts. Bans stay in place.', confirmLabel: 'Restart' }))) return
    setBusy(action)
    try {
      const r = await crowdsecService(action, member)
      addToast({ type: 'success', message: r.message || (action === 'reload' ? 'Configuration reloaded' : 'CrowdSec restarted') })
      refreshStatus(); mRefresh()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, `Could not ${action} CrowdSec`), duration: 7000 }) } finally { setBusy('') }
  }
  const registerBouncer = async () => {
    setBusy('bouncer')
    try {
      const r = await crowdsecRegisterTraefikBouncer(member)
      addToast({ type: 'success', message: r.message || 'The Traefik bouncer is registered' })
      refreshStatus()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not register the bouncer'), duration: 7000 }) } finally { setBusy('') }
  }

  const bouncer = s?.bouncer
  const enf = s?.enforcement
  const traefikPresent = !!s?.traefik?.present
  const pullAge = bouncer?.last_pull ? (now - Date.parse(bouncer.last_pull)) / 1000 : null
  const acq = s?.acquisition
  const c = s?.counts
  const clientIp = s?.client_ip
  const covered = !!clientIp && ((s?.whitelist?.addresses ?? []).includes(clientIp) || (s?.trusted ?? []).includes(clientIp))
  const cm = community.data
  // the community link: null on an older server (the rows read needs_register and the flags as before)
  const capi = capiState(cm)
  const refused = capi ? capi === 'refused' : !!cm?.needs_register

  const activityHead = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-200">What has been happening</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {t ? <>Over {WIN_LABEL[win]}: <span className="text-slate-300 tabular-nums">{fmtNum(t.alerts)}</span> detection{t.alerts === 1 ? '' : 's'} from <span className="text-slate-300 tabular-nums">{fmtNum(t.sources)}</span> address{t.sources === 1 ? '' : 'es'} in <span className="text-slate-300 tabular-nums">{fmtNum(t.countries)}</span> countr{t.countries === 1 ? 'y' : 'ies'}{t.manual > 0 ? <> · <span className="tabular-nums">{fmtNum(t.manual)}</span> manual ban{t.manual === 1 ? '' : 's'}</> : null}</> : 'Reading what CrowdSec saw…'}
        </p>
      </div>
      <Segmented<Win> value={win} onChange={setWin} ariaLabel="Time window" options={[{ value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
    </div>
  )

  return (
    <div className="space-y-4">
      {activityHead}
      {m && !m.window_supported && (
        <p className="text-xs text-amber-300 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <Info size={14} className="shrink-0 mt-0.5" /> CrowdSec keeps {m.retention_days} day{m.retention_days === 1 ? '' : 's'} of alerts, so this window shows {m.retention_days === 1 ? 'a day' : `${m.retention_days} days`} at most.
        </p>
      )}

      {!m && !metrics.error && (
        <div className="grid lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading">
          <Skel className="h-64 lg:col-span-2" /><Skel className="h-64" /><Skel className="h-56" /><Skel className="h-56" /><Skel className="h-56" />
        </div>
      )}
      {!m && metrics.error && <p className={`${CARD} p-4 text-sm text-rose-300`} role="alert">{metrics.error.message}</p>}

      {m && (
        <div className={`space-y-4 transition-opacity ${stale ? 'opacity-60' : ''}`}>
          <div className="grid lg:grid-cols-3 gap-4">
            <Panel title="Detections over time" icon={Activity} className="lg:col-span-2" right={t && t.alerts > 0 ? <span className="text-[11px] text-slate-500 tabular-nums">{fmtNum(t.events)} suspicious requests</span> : undefined}>
              {t && t.alerts === 0
                ? <Quiet>Quiet. CrowdSec detected nothing in {WIN_LABEL[win]}.<br />That is the normal state of a well-behaved server, not a fault.</Quiet>
                : <TimelineChart points={m.timeline} bucketSeconds={m.bucket_seconds} />}
              {m.map_points.length > 0 && <div className="mt-4 pt-3 border-t border-white/5"><WorldMap points={m.map_points} /></div>}
            </Panel>

            <Panel title="Where attacks come from" icon={Globe2} right={countries.length > 7 ? <button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300" onClick={() => setAllCountries((v) => !v)}>{allCountries ? 'Show fewer' : `All ${countries.length}`}</button> : undefined}>
              {countries.length === 0 && m.unknown_country === 0
                ? <Quiet>No detections, so no countries yet.</Quiet>
                : (
                  <div className="space-y-0.5">
                    {shownCountries.map((cn) => (
                      <BarRow key={cn.code} tone="bad" value={cn.alerts} max={maxCountry}
                        label={<Country code={cn.code} name />}
                        valueLabel={<>{cn.alerts}<span className="text-slate-500 font-normal"> · {cn.sources} src</span></>}
                        extra={bansBy.get(cn.code) ? <Chip tone="bad" title={`${bansBy.get(cn.code)} address${bansBy.get(cn.code) === 1 ? '' : 'es'} from ${countryName(cn.code)} banned right now`}>{bansBy.get(cn.code)} banned</Chip> : undefined}
                        title={`Detections from ${countryName(cn.code)}: open the alerts`} onClick={() => goTab('alerts', cn.code)} />
                    ))}
                    {m.unknown_country > 0 && <BarRow tone="mute" value={m.unknown_country} max={maxCountry} label={<span className="text-xs text-slate-500">Country not known</span>} title="Private or unlisted addresses have no country" />}
                  </div>
                )}
              {(countries.length > 0 || m.unknown_country > 0) && <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">The country comes from the address, as CrowdSec reads it. Bans work on addresses and networks: the Traefik bouncer cannot block a whole country.</p>}
            </Panel>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Panel title="Kinds of attack" icon={Crosshair}>
              {m.scenarios.length === 0 ? <Quiet>Nothing detected in {WIN_LABEL[win]}.</Quiet> : (
                <div className="space-y-0.5">
                  {m.scenarios.slice(0, 7).map((sc) => (
                    <BarRow key={sc.scenario} tone={familyTone(sc.family)} value={sc.alerts} max={maxScen}
                      label={<span className="text-sm text-slate-200 truncate" title={sc.scenario}>{sc.label || sc.scenario}</span>}
                      valueLabel={<>{sc.alerts}<span className="text-slate-500 font-normal"> · {sc.sources} src</span></>}
                      title={`${sc.scenario}: open these alerts`} onClick={() => goTab('alerts', sc.scenario)} />
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={srcView === 'addresses' ? 'Busiest sources' : 'Busiest networks'} icon={srcView === 'addresses' ? Radar : Network}
              right={<Segmented<'addresses' | 'networks'> value={srcView} onChange={setSrcView} ariaLabel="Sources by" options={[{ value: 'addresses', label: 'Addresses' }, { value: 'networks', label: 'Networks' }]} />}>
              {srcView === 'addresses' ? (
                m.sources.length === 0 ? <Quiet>No attacking addresses in {WIN_LABEL[win]}.</Quiet> : (
                  <div className="space-y-0.5">
                    {m.sources.slice(0, 6).map((src) => (
                      <BarRow key={src.value} tone={src.banned ? 'bad' : 'warn'} value={src.alerts} max={maxSrc}
                        label={<><span className="font-mono text-[13px] text-slate-100 truncate">{src.value}</span><Country code={src.country} /></>}
                        sub={<>{src.as_name ? `AS${src.as_number} · ${src.as_name}` : 'Network not known'} · {fmtAgo(src.last_seen, now)}</>}
                        valueLabel={src.alerts}
                        extra={src.banned
                          ? <Chip tone="bad">banned</Chip>
                          : isAdmin ? <button type="button" className="h-6 px-2 rounded-md text-[11px] font-medium border bg-rose-500/10 border-rose-500/20 text-rose-300 hover:bg-rose-500/20 inline-flex items-center gap-1" onClick={(e) => { e.stopPropagation(); setBanning(src.value) }} aria-label={`Ban ${src.value}`}><Ban size={10} /> Ban</button>
                          : <Chip tone="mute">not banned</Chip>}
                        title={`${src.scenarios.join(', ')}`} />
                    ))}
                  </div>
                )
              ) : (
                m.networks.length === 0 ? <Quiet>No networks to show yet.</Quiet> : (
                  <div className="space-y-0.5">
                    {m.networks.slice(0, 6).map((n) => (
                      <BarRow key={n.as_number || n.as_name} tone="info" value={n.alerts} max={maxNet}
                        label={<span className="text-sm text-slate-200 truncate">{n.as_name || 'Network not known'}</span>}
                        sub={n.as_number ? `AS${n.as_number}` : undefined}
                        valueLabel={<>{n.alerts}<span className="text-slate-500 font-normal"> · {n.sources} src</span></>} />
                    ))}
                  </div>
                )
              )}
            </Panel>

            <Panel title="Latest detections" icon={Clock} right={<button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1" onClick={() => goTab('alerts')}>All alerts <ArrowRight size={11} /></button>}>
              {!recent.data ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-9" />)}</div>
                : latest.length === 0 ? <Quiet>No detections in the last 24 hours.</Quiet> : (
                  <ul className="divide-y divide-white/5">
                    {latest.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => setAlertId(a.id)} className="w-full text-left py-2 flex items-center gap-3 hover:bg-white/[0.03] rounded-lg -mx-2 px-2 transition-colors" aria-label={`Alert ${a.id}: ${a.label} from ${a.source.value}`}>
                          <Dot tone={familyTone(a.family)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-200 truncate">{a.label}</span>
                            <span className="block text-[11px] text-slate-500 truncate font-mono">{a.source.value}</span>
                          </span>
                          <Country code={a.source.country} />
                          <span className="text-[11px] text-slate-500 tabular-nums shrink-0 w-14 text-right">{fmtAgo(a.created_at, now)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </Panel>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Protection" icon={ShieldCheck}>
          <div className="divide-y divide-white/5">
            {!traefikPresent ? (
              <StatusRow tone="warn" title="Traefik was not found on this server">CrowdSec still detects attacks, but nothing in front of your services blocks them. Deploy or start Traefik to enforce the bans.</StatusRow>
            ) : !bouncer?.registered ? (
              <StatusRow tone="warn" title="Bans are not enforced yet" action={isAdmin ? <button type="button" className={BTN_PRIMARY} disabled={busy === 'bouncer'} onClick={registerBouncer}>{busy === 'bouncer' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Register the Traefik bouncer</button> : undefined}>No bouncer is registered, so a ban is only a note in CrowdSec&rsquo;s database. The bouncer is what makes Traefik refuse the address.</StatusRow>
            ) : enf && !enf.in_chain ? (
              <StatusRow tone="warn" title="The bouncer is registered but Traefik is not using it" action={isAdmin ? <button type="button" className={BTN_PRIMARY} disabled={busy === 'bouncer'} onClick={registerBouncer}>{busy === 'bouncer' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Add it to the Traefik chain</button> : undefined}>The middleware is not part of the chain your services use.</StatusRow>
            ) : pullAge === null ? (
              <StatusRow tone="warn" title="Traefik has not asked CrowdSec yet">Nothing has come from Traefik since the bouncer was registered. It starts with the first request that goes through the middleware.</StatusRow>
            ) : pullAge > 1800 ? (
              <StatusRow tone="warn" title={`Traefik last asked CrowdSec ${fmtAgo(bouncer.last_pull, now)}`}>The plugin reports in at least every ten minutes while Traefik runs it. Check that Traefik is running and loaded the plugin.</StatusRow>
            ) : (
              <StatusRow tone="good" title="Traefik enforces the bans">Traefik last asked CrowdSec {fmtAgo(bouncer.last_pull, now)}. It blocks addresses and networks before a request reaches a service.</StatusRow>
            )}
            {traefikPresent && enf && (
              <div className="pt-2.5 first:pt-0">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">How the bouncer is wired</p>
                <ul>
                  <CheckLine state={enf.plugin?.declared ? (enf.plugin.loaded === false ? 'warn' : 'ok') : 'bad'} label={enf.plugin?.declared ? `Plugin ${enf.plugin.name} ${enf.plugin.version} is declared in Traefik` : 'The plugin is not declared in Traefik\u2019s static configuration'}>
                    {enf.plugin?.declared ? (enf.plugin.loaded === false ? 'Traefik has not been restarted since' : enf.plugin.loaded ? 'loaded' : undefined) : 'Traefik refuses the middleware until it is'}
                  </CheckLine>
                  <CheckLine state={enf.middleware_present ? 'ok' : 'bad'} label={enf.middleware_present ? 'The middleware file crowdsec-bouncer.yml exists' : 'The middleware file crowdsec-bouncer.yml is missing'} />
                  <CheckLine state={enf.in_chain ? 'ok' : 'bad'} label={enf.in_chain ? 'crowdsec-bouncer is in traefik-chain' : 'crowdsec-bouncer is not in traefik-chain'}>{enf.in_chain ? 'every route that uses the chain is checked' : 'no route is checked'}</CheckLine>
                  <CheckLine state={!bouncer?.registered ? 'bad' : (s?.issues ?? []).some((i) => i.code === 'bouncer_key_stale') ? 'bad' : enf.plugin?.key_present ? 'ok' : 'warn'} label={!bouncer?.registered ? 'CrowdSec knows no bouncer for Traefik' : (s?.issues ?? []).some((i) => i.code === 'bouncer_key_stale') ? 'The key in the middleware file is out of date' : 'The bouncer is registered and the file holds its key'} />
                  <CheckLine state={pullAge === null ? 'warn' : pullAge > 1800 ? 'warn' : 'ok'} label={pullAge === null ? 'Traefik has not asked CrowdSec yet' : `Traefik last asked CrowdSec ${fmtAgo(bouncer?.last_pull, now)}`} />
                  {enf.plugin?.mode && (
                    <CheckLine state="mute" label={`Mode: ${enf.plugin.mode}`}>
                      {isAdmin ? <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => goTab('settings')}>change it in Settings</button> : (enf.plugin.mode === 'live' ? 'asks CrowdSec per visitor' : 'downloads the ban list')}
                    </CheckLine>
                  )}
                </ul>
              </div>
            )}
            {!member && routes.data && enf?.in_chain !== undefined && (checked > 0 || bypass.length > 0) && (
              bypass.length > 0
                ? <StatusRow tone="warn" title={`${bypass.length} of ${checked + bypass.length} route${checked + bypass.length === 1 ? '' : 's'} bypass${bypass.length === 1 ? 'es' : ''} the bouncer`} action={<button type="button" className={BTN_QUIET} onClick={() => setPage('dns')}><ShieldOff size={13} /> Open DNS &amp; Routes</button>}>
                    {bypass.slice(0, 4).map((r) => r.subdomain).join(', ')}{bypass.length > 4 ? ` and ${bypass.length - 4} more` : ''}: they do not use Traefik&rsquo;s traefik-chain, so a banned address can still reach them.
                  </StatusRow>
                : <StatusRow tone="good" title={`All ${checked} route${checked === 1 ? '' : 's'} go through the bouncer`}>Routes of your VMs pass through this Traefik&rsquo;s chain too.</StatusRow>
            )}
            {/* the address you connect from (on a VM it would be the hub's, so it is left out, as the allowlist does) */}
            {!member && clientIp && (
              s?.client_banned
                ? <StatusRow tone="bad" title={`You are banned right now (${clientIp})`} action={<button type="button" className={BTN_QUIET} onClick={() => goTab('bans', clientIp)}>Open your ban</button>}>Requests from this address are refused by Traefik.</StatusRow>
                : covered
                  ? <StatusRow tone="good" title={`Your address ${clientIp} is never banned`}>It is on the allowlist.</StatusRow>
                  : <StatusRow tone="mute" title={`You are connecting from ${clientIp}`} action={<button type="button" className={BTN_QUIET} onClick={() => goTab('allowlist')}><UserCheck size={13} /> Open the allowlist</button>}>This address can be banned like any other. Allowlist it if it is yours.</StatusRow>
            )}
          </div>
        </Panel>

        <Panel title="Community" icon={Users} right={<button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1" onClick={() => goTab('bouncers')}>Details <ArrowRight size={11} /></button>}>
          {!cm ? <div className="space-y-2"><Skel className="h-10" /><Skel className="h-10" /><Skel className="h-10" /></div> : (
            <div className="divide-y divide-white/5">
              {refused ? (
                <StatusRow tone="bad" title="CrowdSec can’t reach the community service"
                  action={isAdmin ? <div className="flex flex-wrap items-start gap-2"><div><RegisterAgainButton onDone={community.refresh} /></div>{capi && <CheckNowButton onDone={community.refresh} availableAt={cm.capi.check_available_at} />}</div> : undefined}>
                  {cm.hint || REFUSED_TEXT}
                </StatusRow>
              ) : capi === 'disabled' ? (
                <StatusRow tone="mute" title="The community connection is switched off">CrowdSec is set to run without the community service, so it neither receives the community blocklist nor shares what it sees.</StatusRow>
              ) : capi === 'paused' ? (
                <StatusRow tone="warn" icon={Clock} title="Community service pausing this engine">
                  {cm.hint || PAUSED_TEXT}<span className="block mt-1 text-slate-400">{lastContact(cm, now)}</span>
                </StatusRow>
              ) : capi === 'unknown' && cm.capi.registered ? (
                <StatusRow tone="mute" title="Not checked yet" action={isAdmin ? <CheckNowButton onDone={community.refresh} availableAt={cm.capi.check_available_at} /> : undefined}>
                  DCS Orchestrator asks the community service only when you check, so it adds no logins of its own.{cm.capi.pulling && (cm.community_decisions || c?.community) ? ` CrowdSec holds ${fmtNum(cm.community_decisions || c?.community)} community addresses.` : ''}
                </StatusRow>
              ) : (
                <StatusRow tone={cm.capi.registered && cm.capi.pulling ? 'good' : cm.capi.registered ? 'warn' : 'mute'}
                  title={cm.capi.registered ? (cm.capi.pulling ? `Community blocklist: ${fmtNum(cm.community_decisions || c?.community)} known bad addresses` : 'Community blocklist is not being pulled') : 'Not connected to the community'}
                  action={!isAdmin ? undefined : !cm.capi.registered ? <RegisterAgainButton onDone={community.refresh} label="Register" /> : capi ? <CheckNowButton onDone={community.refresh} availableAt={cm.capi.check_available_at} /> : undefined}>
                  {cm.capi.error ? cm.capi.error : cm.capi.registered ? 'CrowdSec downloads addresses other people already caught attacking, and the bouncer blocks them too.' : 'Register with CrowdSec’s central API to receive the community blocklist.'}
                </StatusRow>
              )}
              {!refused && capi !== 'disabled' && (
                <StatusRow tone={cm.capi.sharing ? 'good' : 'mute'} title={cm.capi.sharing ? 'Sharing your detections' : 'Not sharing your detections'}>
                  {cm.capi.sharing ? 'Attackers you catch are reported (address and scenario only) so others can block them.' : 'Nothing leaves this server. You can turn sharing on with cscli.'}
                </StatusRow>
              )}
              {cm.console.known === false && !cm.console.enrolled ? (
                <StatusRow tone="mute" title="Enrolment not checked yet"
                  action={isAdmin ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckNowButton onDone={community.refresh} availableAt={cm.capi.check_available_at} />
                      <button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300" onClick={() => { focusEnrolOnOpen(); goTab('bouncers') }}>Enrol anyway</button>
                    </div>
                  ) : undefined}>
                  Whether this engine is in the CrowdSec Console is known after a check, an enrolment or a line in CrowdSec’s log.
                </StatusRow>
              ) : (
              <StatusRow tone={cm.console.enrolled ? 'good' : 'mute'} title={cm.console.enrolled ? 'Enrolled in the CrowdSec Console' : 'Not enrolled in the CrowdSec Console'}
                action={!cm.console.enrolled && isAdmin ? <button type="button" className={BTN_QUIET} onClick={() => { focusEnrolOnOpen(); goTab('bouncers') }}><KeyRound size={13} /> Enrol in the console</button> : undefined}>
                {cm.console.enrolled ? 'Your alerts also appear in the online console.' : 'Optional: a free web console with more blocklists, enrolled with a key from app.crowdsec.net.'}
              </StatusRow>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Engine" icon={Cpu}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-slate-500">Version</dt><dd className="text-slate-200 tabular-nums">{s?.version_number ? `v${s.version_number}` : '—'}</dd>
            <dt className="text-slate-500">Container</dt><dd className="text-slate-200 truncate" title={s?.image}>{s?.container ?? 'CrowdSec'}{s?.image ? <span className="text-slate-500"> · {s.image.split('/').pop()}</span> : null}</dd>
            <dt className="text-slate-500">Running since</dt><dd className="text-slate-200">{s?.started_at ? <span title={fmtTime(s.started_at)}>{fmtAgo(s.started_at, now).replace(' ago', '')}</span> : '—'}{s && (s.restart_count ?? 0) > 0 ? <span className="text-amber-400"> · {s.restart_count} restart{s.restart_count === 1 ? '' : 's'}</span> : null}</dd>
            <dt className="text-slate-500">Reads</dt>
            <dd className="text-slate-200 min-w-0">
              {acq && acq.reads > 0
                ? <><span className="tabular-nums">{fmtNum(acq.reads)}</span> log lines, <span className="tabular-nums">{acq.parse_rate !== null ? Math.round(acq.parse_rate * 100) : '—'}%</span> understood</>
                : <span className="text-amber-400">no log lines since start</span>}
            </dd>
            {(acq?.sources ?? []).slice(0, 3).map((src) => (
              <FragmentRow key={src.name} name={src.name.replace(/^file:/, '')} reads={src.reads} parsed={src.parsed} />
            ))}
            <dt className="text-slate-500">Bouncers</dt><dd className="text-slate-200 tabular-nums">{c?.bouncers ?? '—'} <span className="text-slate-500">· {c?.machines ?? '—'} machine{c?.machines === 1 ? '' : 's'}</span></dd>
            <dt className="text-slate-500">Hub</dt><dd className="text-slate-200 tabular-nums">{c ? `${c.collections} collections, ${c.scenarios} scenarios` : '—'}{c && c.updates > 0 ? <button type="button" className="ml-2 text-cyan-400 hover:text-cyan-300" onClick={() => goTab('hub')}>{c.updates} update{c.updates === 1 ? '' : 's'}</button> : null}</dd>
          </dl>
          {isAdmin && (
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/5 flex-wrap">
              <button type="button" className={BTN_QUIET} disabled={busy !== ''} onClick={() => runService('reload')} title="Ask CrowdSec to re-read its parsers and allowlists without restarting">{busy === 'reload' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reload</button>
              <button type="button" className={BTN_DANGER} disabled={busy !== ''} onClick={() => runService('restart')} title="Restart the container">{busy === 'restart' ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Restart</button>
            </div>
          )}
        </Panel>
      </div>

      {banning && <BanSheet initialValue={banning} onClose={() => setBanning(null)} onDone={() => { refreshStatus(); mRefresh() }} />}
      {alertId !== null && <AlertSheet id={alertId} onClose={() => setAlertId(null)} />}
    </div>
  )
}

function FragmentRow({ name, reads, parsed }: { name: string; reads: number; parsed: number }) {
  return (
    <>
      <dt className="text-slate-500 pl-3 truncate" title={name}>↳</dt>
      <dd className="text-slate-500 truncate min-w-0" title={name}><span className="font-mono text-[11px]">{name.split('/').pop()}</span> <span className="tabular-nums text-slate-500">· {fmtNum(reads)} read, {fmtNum(parsed)} understood</span></dd>
    </>
  )
}
