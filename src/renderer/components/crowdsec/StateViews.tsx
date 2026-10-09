// =============================================================================
// The states of CrowdSec that are not "healthy": not deployed (an invitation
// with a pre-flight and a one-click deploy that follows the deployment), and
// stopped / restarting / unhealthy / API unreachable / Docker down (the honest
// reason, the log, the one-click fix). Plus the notes a healthy CrowdSec adds.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldOff, ShieldAlert, ShieldCheck, Rocket, Loader2, FileText, Radar, Ban, MessageSquare, AlertTriangle, XCircle, Info, Play, RotateCw, ScrollText, ExternalLink, Container, Network, Boxes, RefreshCw, ArrowRight, ArrowDown, PackageOpen } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { useToast } from '../common/Toast'
import { useSettingsStore } from '../../stores/settingsStore'
import { deployTemplate, fetchStackActivity, crowdsecStatus, crowdsecLogs, crowdsecRunFix } from '../../api/endpoints'
import type { CrowdSecFix, CrowdSecIssue, CrowdSecPreflight, CrowdSecStatusResponse, StackActivityResponse } from '../../../shared/types'
import { errMsg, useCs } from './kit'
import { BTN_TOOLBAR_ATTN, BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET, SECTION_LABEL } from '../../lib/ui'
import { HINT, INPUT, LABEL } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { type Tone } from '../../lib/tone'
import { Pill } from '../common/Pill'
import { Toggle } from '../common/Toggle'
import StatusLine from '../common/StatusLine'
// ---------------------------------------------------------------------------
// Fix buttons
// ---------------------------------------------------------------------------

/** runs the fixes a status or an issue offers: api ones call the endpoint, ui ones go somewhere */
export function useFixRunner(member: string | null, onDone: () => void, onUi?: (fix: CrowdSecFix) => void) {
  const { addToast } = useToast()
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const [busy, setBusy] = useState('')
  const run = async (fix: CrowdSecFix) => {
    if (fix.kind === 'ui') {
      if (fix.id === 'deploy') setCurrentPage('templates', { search: 'crowdsec' })
      else onUi?.(fix)
      return
    }
    setBusy(fix.id)
    try {
      const r = await crowdsecRunFix(fix, member)
      addToast({ type: 'success', message: r.message || `${fix.label}: done` })
      onDone()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, `${fix.label} failed`), duration: 8000 })
    } finally { setBusy('') }
  }
  return { run, busy }
}

function fixIcon(id: string) {
  if (id === 'start' || id === 'start_stack') return <Play size={13} />
  if (id === 'restart' || id === 'register_bouncer') return <RotateCw size={13} />
  if (id === 'logs') return <ScrollText size={13} />
  if (id === 'deploy') return <Rocket size={13} />
  return <ArrowRight size={13} />
}

export function FixButton({ fix, busy, onRun }: { fix: CrowdSecFix; busy: boolean; onRun: () => void }) {
  const { isAdmin } = useCs()
  const needsAdmin = fix.kind === 'api'
  // a fix the server runs is an admin's: a viewer is not offered it
  if (needsAdmin && !isAdmin) return null
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={busy}
      className={fix.primary ? BTN_TOOLBAR_OK : BTN_TOOLBAR_QUIET}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : fixIcon(fix.id)} {fix.label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Issues a healthy CrowdSec still has
// ---------------------------------------------------------------------------

export function IssueBanners({ issues, onOpenTab }: { issues: CrowdSecIssue[]; onOpenTab: (tab: string) => void }) {
  const { member, refreshStatus } = useCs()
  const { run, busy } = useFixRunner(member, refreshStatus, (fix) => { if (fix.id === 'open_hub') onOpenTab('hub'); if (fix.id === 'open_bouncers') onOpenTab('bouncers') })
  if (!issues.length) return null
  return (
    <div className="space-y-2" role="region" aria-label="Things that need attention">
      {issues.map((i) => {
        const tone: Tone = i.severity === 'warning' ? 'attention' : i.severity === 'error' ? 'problem' : 'info'
        const Icon = i.severity === 'info' ? Info : AlertTriangle
        return (
          <div key={i.code} className={`rounded-xl border px-4 py-3 flex items-start gap-3 flex-wrap ${tone === 'attention' ? 'bg-amber-500/[0.06] border-amber-500/20' : tone === 'problem' ? 'bg-rose-500/[0.06] border-rose-500/20' : 'bg-cyan-500/[0.05] border-cyan-500/15'}`}>
            <Icon size={16} className={`shrink-0 mt-0.5 ${tone === 'attention' ? 'text-amber-400' : tone === 'problem' ? 'text-rose-400' : 'text-cyan-400'}`} />
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium text-slate-100">{i.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{i.detail}</p>
            </div>
            {i.fix && <FixButton fix={{ ...i.fix, primary: false }} busy={busy === i.fix.id} onRun={() => run(i.fix as CrowdSecFix)} />}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Docker is down, CrowdSec is stopped, keeps restarting, is unhealthy, or its API does not answer
// ---------------------------------------------------------------------------

const PROBLEM_LOOK: Record<string, { icon: React.ElementType; tone: Tone; hint: string }> = {
  docker_unavailable: { icon: Container, tone: 'problem', hint: 'DCS talks to Docker to see and manage CrowdSec. Start the Docker service on this server (or check that DCS may use the Docker socket), then check again.' },
  stopped: { icon: ShieldOff, tone: 'attention', hint: 'Nothing is watching the logs while CrowdSec is stopped. The bouncer in Traefik keeps enforcing the bans it already has until they expire.' },
  crash_loop: { icon: ShieldAlert, tone: 'problem', hint: 'A container that keeps restarting almost always has a configuration problem. The log below shows the last thing it said before it died.' },
  starting: { icon: Loader2, tone: 'info', hint: 'This page refreshes on its own and opens as soon as CrowdSec reports healthy.' },
  unhealthy: { icon: ShieldAlert, tone: 'attention', hint: 'The container runs, but Docker cannot get an answer from cscli. A restart usually clears it.' },
  lapi_unreachable: { icon: Network, tone: 'attention', hint: 'CrowdSec is up but its local API does not answer, so bans cannot be listed or changed. The bouncer keeps its cached decisions in the meantime.' },
}

export function ProblemView({ s, onRefresh, onDeploy }: { s: CrowdSecStatusResponse; onRefresh: () => void; onDeploy: () => void }) {
  const { member } = useCs()
  const state = s.state ?? 'stopped'
  const look = PROBLEM_LOOK[state] ?? PROBLEM_LOOK.stopped
  const Icon = look.icon
  const [showLog, setShowLog] = useState(state === 'crash_loop' || state === 'lapi_unreachable')
  const { run, busy } = useFixRunner(member, onRefresh, (fix) => { if (fix.id === 'logs') setShowLog(true); if (fix.id === 'deploy') onDeploy() })
  const tile = look.tone === 'problem' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : look.tone === 'attention' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
  const log = s.log_tail ?? []
  return (
    <div className="space-y-4">
      <div className={`${CARD} p-4 md:p-5`}>
        <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${tile}`}><Icon size={22} className={state === 'starting' ? 'animate-spin' : ''} /></div>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-lg font-semibold text-slate-100">{s.title}</h2>
            {s.detail && <p className="text-sm text-slate-300 mt-1 break-words">{s.detail}</p>}
            <p className="text-xs text-slate-500 mt-2">{look.hint}</p>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {(s.fixes ?? []).map((f) => f.id === 'retry'
                ? <button key={f.id} type="button" onClick={onRefresh} className={f.primary ? BTN_TOOLBAR_OK : BTN_TOOLBAR_QUIET}><RefreshCw size={14} /> {f.label}</button>
                : <FixButton key={f.id} fix={f} busy={busy === f.id} onRun={() => run(f)} />)}
              {state !== 'docker_unavailable' && !(s.fixes ?? []).some((f) => f.id === 'logs') && (
                <button type="button" onClick={() => setShowLog((v) => !v)} className={BTN_TOOLBAR_QUIET}><ScrollText size={14} /> {showLog ? 'Hide the log' : 'Show the log'}</button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-white/5 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
          {s.container && <span>Container <span className="font-mono text-slate-500">{s.container}</span></span>}
          {s.container_state && <span>State <span className="text-slate-500">{s.container_state}</span></span>}
          {s.health && <span>Health <span className="text-slate-500">{s.health}</span></span>}
          {typeof s.restart_count === 'number' && s.restart_count > 0 && <span>Restarts <span className="text-slate-500 tabular-nums">{s.restart_count}</span></span>}
          {s.exit_code ? <span>Exit code <span className="text-slate-500 tabular-nums">{s.exit_code}</span></span> : null}
          {s.image && <span>Image <span className="font-mono text-slate-500">{s.image}</span></span>}
          {s.docker?.version && <span>Docker <span className="text-slate-500">{s.docker.version}</span></span>}
        </div>
      </div>
      {showLog && <LogPanel initial={log} onRefresh={onRefresh} />}
    </div>
  )
}

/** the last lines of CrowdSec's log, for a state where the page cannot show the Logs tab */
function LogPanel({ initial, onRefresh }: { initial: string[]; onRefresh: () => void }) {
  const { member } = useCs()
  const [lines, setLines] = useState<string[]>(initial)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const r = await crowdsecLogs({ lines: 80, lapi: false }, member)
      setLines(r.lines.map((l) => `${l.time ? l.time.replace('T', ' ').replace('Z', '') + '  ' : ''}${l.level.toUpperCase().padEnd(5)} ${l.module ? `[${l.module}] ` : ''}${l.message}`))
      onRefresh()
    } catch { /* the status log tail stays */ } finally { setLoading(false) }
  }
  useEffect(() => { void load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500 flex items-center gap-2"><ScrollText size={13} /> CrowdSec log <span className="text-slate-500 font-normal">last {lines.length} lines</span></p>
        <button type="button" onClick={load} disabled={loading} className="text-[11px] text-slate-500 hover:text-slate-200 inline-flex items-center gap-1"><RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Reload</button>
      </div>
      <pre className="p-4 text-[11px] leading-relaxed font-mono text-slate-300 overflow-x-auto max-h-80 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words">{lines.length ? lines.join('\n') : 'No log lines yet.'}</pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Not deployed
// ---------------------------------------------------------------------------

function Step({ icon: Icon, title, text, tone }: { icon: React.ElementType; title: string; text: string; tone: Tone }) {
  const tile = tone === 'problem' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : tone === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : tone === 'attention' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
  return (
    <div className="flex-1 min-w-0 surface p-3.5">
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${tile}`}><Icon size={16} /></div>
      <p className="text-sm font-medium text-slate-100 mt-2.5">{title}</p>
      <p className="text-xs text-slate-500 mt-0.5">{text}</p>
    </div>
  )
}

type Phase = 'idle' | 'deploying' | 'waiting' | 'failed'

export function NotDeployed({ s, onRefresh }: { s: CrowdSecStatusResponse; onRefresh: () => void }) {
  const { isAdmin, member } = useCs()
  const setCurrentPage = useSettingsStore((st) => st.setCurrentPage)
  const { addToast } = useToast()
  const pre: CrowdSecPreflight | null = s.preflight ?? null
  const [stack, setStack] = useState('')
  const [bouncer, setBouncer] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [activity, setActivity] = useState<StackActivityResponse | null>(null)
  const started = useRef(0)
  const progressRef = useRef<HTMLDivElement>(null)
  // the progress card sits under the fold on a laptop: bring it into view when a deployment starts or fails
  useEffect(() => { if (phase === 'deploying' || phase === 'failed') progressRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }) }, [phase])
  useEffect(() => { if (pre && !stack) setStack(pre.target_stack) }, [pre, stack])
  useEffect(() => { if (pre) setBouncer(pre.enforcement) }, [pre?.enforcement]) // eslint-disable-line react-hooks/exhaustive-deps

  const deploying = phase === 'deploying' || phase === 'waiting'
  // while a deployment runs: follow the stack's activity, and look at the status often — the page opens by itself when CrowdSec is healthy
  const act = usePolling(async () => (stack ? fetchStackActivity(stack, member).catch(() => null) : null), 2500, { enabled: deploying && !!stack })
  const st = usePolling(() => crowdsecStatus(member), 3000, { key: pollKeys.crowdsecStatus(member), enabled: deploying })
  useEffect(() => { if (act.data) setActivity(act.data) }, [act.data])
  useEffect(() => {
    if (!deploying || !st.data) return
    if (st.data.state && st.data.state !== 'not_deployed') { onRefresh() }
  }, [st.data, deploying, onRefresh])
  // a deployment that ended without CrowdSec appearing is a failure worth saying
  useEffect(() => {
    if (phase !== 'waiting' || !activity) return
    if (!activity.active && activity.success === false) { setPhase('failed'); setError(activity.error || 'The start did not complete. The output below has the details.') }
    else if (!activity.active && Date.now() - started.current > 240000) { setPhase('failed'); setError('CrowdSec did not come up within four minutes. Look at the output below, and at the stack on the Stacks page.') }
  }, [activity, phase])

  const deploy = async () => {
    if (!pre || !stack) return
    setPhase('deploying'); setError(''); setActivity(null); started.current = Date.now()
    try {
      const res = await deployTemplate('crowdsec', {
        target_stack: stack,
        variables: { ENABLE_TRAEFIK_BOUNCER: bouncer ? 'true' : 'false' },
        auto_start: true,
        replace_services: true,
      }, member)
      if (!res.success) throw new Error(res.message || 'The deployment was refused')
      if (res.started === false) throw new Error(res.warning || 'CrowdSec was added to the stack but not started')
      addToast({ type: 'success', message: 'CrowdSec is being deployed…' })
      setPhase('waiting')
    } catch (e) {
      setPhase('failed'); setError(errMsg(e, 'The deployment failed'))
    }
  }

  const traefik = pre?.traefik
  const output = activity?.output ?? []
  const canDeploy = !!pre?.can_deploy && isAdmin

  return (
    <div className="space-y-4">
      <div className={`${CARD} overflow-hidden`}>
        <div className="p-5 sm:p-7 flex items-start gap-4 flex-wrap sm:flex-nowrap">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-white/5 flex items-center justify-center shrink-0"><ShieldOff size={26} className="text-emerald-400" /></div>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-xl font-semibold text-slate-100">CrowdSec is not deployed yet</h2>
            <p className="text-sm text-slate-300 mt-1.5 max-w-2xl">
              CrowdSec reads Traefik&apos;s access log, recognises scanners and brute-forcers by how they behave, and bans them. Deploy it and this page becomes the place to see who is knocking, ban or allow addresses, and decide how long a ban lasts.
            </p>
          </div>
        </div>
        <div className="px-5 sm:px-7 pb-5 sm:pb-7">
          <div className="flex flex-col md:flex-row items-stretch gap-2 md:gap-1">
            <Step icon={FileText} tone="info" title="It reads the log" text="Traefik's access log is mounted read-only; nothing in your apps changes." />
            <div className="flex items-center justify-center text-slate-500 shrink-0"><ArrowRight size={16} className="hidden md:block" /><ArrowDown size={16} className="md:hidden" /></div>
            <Step icon={Radar} tone="attention" title="It decides" text="Scenarios spot probing, brute force and exploits; the community blocklist adds known bad addresses." />
            <div className="flex items-center justify-center text-slate-500 shrink-0"><ArrowRight size={16} className="hidden md:block" /><ArrowDown size={16} className="md:hidden" /></div>
            <Step icon={Ban} tone="problem" title="Traefik blocks" text="DCS registers a bouncer, so a ban is enforced at the door before any app sees the request." />
            <div className="flex items-center justify-center text-slate-500 shrink-0"><ArrowRight size={16} className="hidden md:block" /><ArrowDown size={16} className="md:hidden" /></div>
            <Step icon={MessageSquare} tone="ok" title="You hear about it" text="Every ban can post to Discord, in words a person understands (when a webhook is set)." />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className={`${CARD} p-4 md:p-5 lg:col-span-3`}>
          <h3 className={SECTION_LABEL}>Before it deploys</h3>
          {!pre ? <div className="mt-3 space-y-2"><div className="skeleton h-5 rounded" /><div className="skeleton h-5 rounded w-2/3" /></div> : (
            <ul className="mt-2 divide-y divide-white/[0.04]">
              <StatusLine as="li" tone={pre.docker.ok ? 'ok' : 'problem'} title="Docker answers">{pre.docker.version ? `Docker ${pre.docker.version}` : undefined}</StatusLine>
              <StatusLine as="li" tone={pre.template ? 'ok' : 'problem'} title="The CrowdSec template is available">{pre.template ? `${pre.template.title} template, part of this DCS` : undefined}</StatusLine>
              <StatusLine as="li" tone={traefik?.present && traefik?.running ? 'ok' : traefik?.present ? 'attention' : 'problem'} title={traefik?.present ? 'Traefik is here' : 'Traefik was not found'}>
                {traefik?.present ? `${traefik.container} is ${traefik.state}${traefik.project ? ` in ${traefik.project}` : ''}` : 'Without Traefik CrowdSec still detects and alerts, but nothing enforces a ban.'}
              </StatusLine>
              <StatusLine as="li" tone={pre.discord.configured ? 'ok' : 'attention'} title={pre.discord.configured ? 'A Discord webhook is set' : 'No Discord webhook yet'}>
                {pre.discord.configured ? 'Bans will be posted with the server\'s webhook.' : 'Optional: add a webhook later on the Discord tab.'}
              </StatusLine>
              {pre.blockers.map((b) => <StatusLine as="li" key={b} tone="problem" title={b} />)}
            </ul>
          )}
          {pre?.warnings.length ? (
            <div className="mt-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/20 px-3 py-2 text-[11px] text-amber-300 space-y-1">
              {pre.warnings.slice(0, 3).map((w) => <p key={w} className="flex gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}</p>)}
            </div>
          ) : null}
        </div>

        <div className={`${CARD} p-4 md:p-5 lg:col-span-2 flex flex-col`}>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Deploy</p>
          {/* a viewer is not offered the deployment (the server answers 403): the form is an admin's */}
          {!isAdmin ? <p className="mt-3 text-sm text-slate-400">Only an admin can deploy CrowdSec. Once it runs, this page shows its bans and alerts to every account.</p> : <>
          <div className="mt-3 space-y-3 flex-1">
            <div>
              <label className={LABEL} htmlFor="cs-stack">Stack</label>
              <select id="cs-stack" className={INPUT} value={stack} onChange={(e) => setStack(e.target.value)} disabled={deploying || !pre || pre.stacks.length === 0}>
                {(pre?.stacks ?? []).map((n) => <option key={n} value={n}>{n}{n === pre?.target_stack ? ' (recommended)' : ''}</option>)}
              </select>
              <p className={HINT}>{pre?.target_reason ?? ''}</p>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <label className="text-sm text-slate-200" htmlFor="cs-bouncer">Block bans at Traefik</label>
                <p className={HINT}>Registers a bouncer and puts its middleware in Traefik&apos;s chain.{!pre?.enforcement && ' Needs Traefik in the same stack.'}</p>
              </div>
              <Toggle id="cs-bouncer" checked={bouncer} onChange={setBouncer} label="Block bans at Traefik" disabled={deploying || !pre?.enforcement} />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <button type="button" onClick={deploy} disabled={!canDeploy || deploying || !stack} className={`${BTN_TOOLBAR_OK} w-full h-11 text-sm`}>
              {deploying ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} {deploying ? 'Deploying…' : 'Deploy CrowdSec'}
            </button>
            <button type="button" onClick={() => setCurrentPage('templates', { search: 'crowdsec' })} className="w-full text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center justify-center gap-1"><ExternalLink size={11} /> Prefer the Templates page? Open the template there</button>
          </div>
          </>}
        </div>
      </div>

      {(deploying || phase === 'failed') && (
        <div ref={progressRef} className={`${CARD} overflow-hidden scroll-mb-6 ${phase === 'failed' ? 'border-rose-500/20' : ''}`} role="status" aria-live="polite">
          <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2.5 flex-wrap">
            {phase === 'failed' ? <XCircle size={16} className="text-rose-400" /> : <Loader2 size={16} className="animate-spin text-emerald-400" />}
            <p className="text-sm font-medium text-slate-100">{phase === 'failed' ? 'The deployment did not finish' : phase === 'deploying' ? 'Sending the deployment…' : 'CrowdSec is starting. This page opens when it is healthy.'}</p>
            {activity && activity.services.length > 0 && activity.services.map((sv) => (
              <Pill key={sv.service} tone={sv.state === 'running' ? (sv.health === 'unhealthy' ? 'problem' : 'ok') : sv.state === 'exited' || sv.state === 'dead' ? 'problem' : 'info'}>{sv.service} · {sv.state === 'running' && sv.health && sv.health !== 'none' ? sv.health : sv.state}</Pill>
            ))}
            {phase === 'failed' && <button type="button" onClick={deploy} className={`${BTN_TOOLBAR_ATTN} ml-auto`}><RotateCw size={14} /> Try again</button>}
          </div>
          {error && <p className="px-4 py-3 text-sm text-rose-300 break-words">{error}</p>}
          {output.length > 0 && <pre className="px-4 py-3 text-[11px] leading-relaxed font-mono text-slate-500 overflow-x-auto max-h-56 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-words">{output.slice(-40).join('\n')}</pre>}
        </div>
      )}
    </div>
  )
}

export function TooOld() {
  const setCurrentPage = useSettingsStore((st) => st.setCurrentPage)
  return (
    <div className={`${CARD} p-4 md:p-5 text-center`}>
      <PackageOpen size={30} className="mx-auto text-amber-400" />
      <h2 className="mt-3 text-lg font-semibold text-slate-100">This DCS is older than the CrowdSec page</h2>
      <p className="mt-1.5 text-sm text-slate-500 max-w-lg mx-auto">The server did not report a CrowdSec state, so it predates the API this page uses. Update DCS on that server and come back.</p>
      <button type="button" onClick={() => setCurrentPage('updates')} className={`${BTN_TOOLBAR_QUIET} mt-4`}><Boxes size={14} /> Open Updates</button>
    </div>
  )
}

/** a small memo so the header can show a state's look */
export function stateLook(state: string | undefined): { tone: Tone; Icon: React.ElementType } {
  if (state === 'healthy') return { tone: 'ok', Icon: ShieldCheck }
  if (state === 'not_deployed') return { tone: 'neutral', Icon: ShieldOff }
  if (state === 'crash_loop' || state === 'docker_unavailable') return { tone: 'problem', Icon: ShieldAlert }
  if (state === 'starting') return { tone: 'info', Icon: ShieldAlert }
  return { tone: 'attention', Icon: ShieldAlert }
}

export function useStateLook(s: CrowdSecStatusResponse | null) {
  return useMemo(() => stateLook(s?.state), [s?.state])
}
