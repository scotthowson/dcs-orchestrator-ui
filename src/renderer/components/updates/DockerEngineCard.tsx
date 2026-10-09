// =============================================================================
// DockerEngineCard — the Docker Engine on this server and, from a hub, on every
// VM: version, package source, the newest version that source offers, a
// one-click update (unattended where the API has passwordless sudo, otherwise
// with the Linux account like the OS updates) and the last update's outcome
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Container, Loader2, Download, RefreshCw, AlertTriangle, CheckCircle, KeyRound, ChevronDown, ChevronUp } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useToast } from '../common/Toast'
import { useAuthStore } from '../../stores/authStore'
import VmCapsule from '../fleet/VmCapsule'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK } from '../../lib/ui'
import { Fact, CardIcon, FreshnessLine } from './updateBits'
import { fetchDockerEngine, fetchDockerEngineStatus, updateDockerEngine, updateFleetDockerEngine, terminalAuth } from '../../api/endpoints'
import type { DockerEngineInfo, DockerEngineFleet, DockerEngineStatus } from '../../../shared/types'

import { Pill } from '../common/Pill'
import { CopyButton } from '../common/CopyButton'
const SOURCE_LABEL: Record<string, string> = {
  'docker-ce': "Docker's packages",
  'docker.io': "Debian's packages",
  'moby-engine': "Fedora's packages",
  'docker-arch': "Arch Linux's packages",
  unknown: 'not from a package',
}

export default function DockerEngineCard({ enabled, isHub }: { enabled: boolean; isHub: boolean }) {
  const { addToast } = useToast()
  // anyone reads the engine; updating it is an admin's (the API refuses the POSTs to anyone else)
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const fetcher = useCallback(() => fetchDockerEngine(isHub), [isHub])
  const { data, refresh, loading, error } = usePolling<DockerEngineInfo | DockerEngineFleet>(fetcher, 120000, { enabled })
  const [status, setStatus] = useState<DockerEngineStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [fleetBusy, setFleetBusy] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [authErr, setAuthErr] = useState('')
  const [showOutput, setShowOutput] = useState(false)
  const [checkedAt, setCheckedAt] = useState(0)
  const pollRef = useRef<number | null>(null)

  useEffect(() => { if (data) setCheckedAt(Date.now()) }, [data])

  const fleet = data && 'fleet' in data && data.fleet ? (data as DockerEngineFleet) : null
  const own = data ?? null
  const last = status ?? own?.last_update ?? null
  const running = last?.status === 'running'

  // follow an update in progress (the daemon restarts under us: a failed poll is just "not yet")
  const follow = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await fetchDockerEngineStatus()
        setStatus(st)
        if (st.status !== 'running') {
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
          addToast({
            type: st.status === 'done' ? 'success' : 'error',
            message: st.status === 'done' ? `Docker Engine is now ${st.version || 'up to date'}` : `The engine update failed (exit ${st.exit_code ?? '?'}) — see the output`,
            duration: 8000,
          })
          refresh()
        }
      } catch { /* keep polling */ }
    }, 3000)
  }, [addToast, refresh])
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])
  useEffect(() => { if (own?.last_update?.status === 'running' && !pollRef.current) follow() }, [own?.last_update?.status, follow])

  const start = useCallback(async (token?: string, password?: string) => {
    setBusy(true)
    try {
      await updateDockerEngine(token, password)
      setStatus({ status: 'running', started_at: new Date().toISOString() })
      setShowAuth(false)
      setPw('')
      addToast({ type: 'info', message: 'Docker Engine update started — every container comes back on its restart policy', duration: 6000 })
      follow()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The update did not start'
      if (/\b401\b|\b403\b|sudo|terminal/i.test(msg)) {
        setShowAuth(true)
        setAuthErr(/\b403\b|password/i.test(msg) && token ? 'Wrong sudo password' : '')
      } else {
        addToast({ type: 'error', message: msg })
      }
    } finally { setBusy(false) }
  }, [addToast, follow])

  const startWithAccount = useCallback(async () => {
    if (!user.trim() || !pw) return
    setBusy(true)
    setAuthErr('')
    try {
      const res = await terminalAuth(user.trim(), pw)
      if (!res.success || !res.token) throw new Error('Sign-in failed')
      await start(res.token, pw)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed'
      setAuthErr(/\b401\b/.test(msg) ? 'Invalid Linux username or password' : msg)
      setBusy(false)
    }
  }, [user, pw, start])

  const updateVms = useCallback(async () => {
    if (!fleet) return
    const ids = fleet.members.filter((m) => m.id && m.reachable && m.upgradable).map((m) => m.id as string)
    if (!ids.length) return
    setFleetBusy(true)
    try {
      const r = await updateFleetDockerEngine(ids)
      addToast({
        type: r.failed ? 'warning' : 'success',
        message: `${r.started} VM${r.started === 1 ? '' : 's'} updating the engine${r.failed ? `, ${r.failed} did not start` : ''}`,
        duration: 8000,
      })
      window.setTimeout(() => refresh(), 25000)
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'The fleet update did not start' })
    } finally { setFleetBusy(false) }
  }, [fleet, addToast, refresh])

  const upgradableVms = fleet ? fleet.members.filter((m) => m.id && m.reachable && m.upgradable).length : 0
  const uptodate = !!own && !!own.version && !own.upgradable
  const warnSource = !!own && (own.apparmor_issue || own.source === 'docker.io')

  return (
    <div className={`rounded-xl border p-5 transition-all duration-300 ${own?.upgradable || (fleet && fleet.upgradable_count > 0) ? 'bg-cyan-500/[0.05] border-cyan-500/15' : 'bg-white/[0.03] border-white/5'}`}>
      <div className="flex items-center gap-3 mb-4">
        <CardIcon><Container size={16} /></CardIcon>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-200">Docker Engine</h3>
          <p className="text-[10px] text-slate-500 truncate">{own ? `${SOURCE_LABEL[own.source] ?? own.source}${own.package_manager && own.package_manager !== 'unknown' ? ` · ${own.package_manager}` : ''}` : 'the container runtime'}</p>
        </div>
      </div>

      {!own ? (
        <div className="space-y-3">
          {error ? (
            <p className="text-xs text-rose-300 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {/404|not found/i.test(error instanceof Error ? error.message : String(error))
                  ? 'This server\'s DCS is older than the dashboard: update the framework (the card above) and this card fills in.'
                  : `Could not read the engine: ${error instanceof Error ? error.message : String(error)}`}
              </span>
            </p>
          ) : (
            <div role="status" aria-label="Reading the engine" className="space-y-3">
              <div className="skeleton h-3 w-2/3 rounded" aria-hidden />
              <div className="skeleton h-3 w-1/2 rounded" aria-hidden />
              <p className="text-[10px] text-slate-500">Reading the engine…</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Fact label="Installed"><span className="text-xs font-mono text-slate-300">{own.version || 'not running'}</span></Fact>
          {own.upgradable && (
            <Fact label="Available"><span className="text-xs font-mono text-cyan-300">{own.candidate}</span></Fact>
          )}
          {!own.upgradable && own.checking && (
            <Fact label="Available">
              <span className="text-xs text-slate-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> asking the package source…</span>
            </Fact>
          )}
          <Fact label="Updates">
            <span className="text-xs text-slate-300 text-right">{own.sudo_ready ? 'Unattended (passwordless sudo)' : 'With your Linux account'}</span>
          </Fact>
          <Fact label="Status">
            {running ? (
              <Pill tone="info" icon={<Loader2 size={10} className="animate-spin" />}>Updating</Pill>
            ) : own.upgradable ? (
              <Pill tone="info" icon={<Download size={10} />}>Update available</Pill>
            ) : own.version ? (
              <Pill tone="ok" icon={<CheckCircle size={10} />}>Current</Pill>
            ) : (
              <Pill tone="problem" icon={<AlertTriangle size={10} />}>Not answering</Pill>
            )}
          </Fact>

          {/* the one-line status, like the other cards: up to date · checked · last updated */}
          <FreshnessLine
            ok={uptodate}
            okText={own.checking ? 'Engine running' : 'Engine up to date'}
            warnText={own.version ? `${own.candidate || 'A newer engine'} available` : 'Docker is not answering'}
            tone={own.version ? 'info' : 'problem'}
            checkedAt={checkedAt || null}
            updatedAt={last && last.status !== 'running' ? last.finished_at : null}
            updatedLabel={last?.status === 'failed' ? 'Last update failed' : 'Last updated'}
          />

          {warnSource && (
            <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/15 p-2.5 space-y-2">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">{own.note}</p>
              {own.switch_command && (
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono text-slate-300 bg-black/30 rounded px-2 py-1 truncate">{own.switch_command}</code>
                  <CopyButton variant="chip" text={own.switch_command} label="Copy" />
                </div>
              )}
            </div>
          )}

          {last && last.status !== 'running' && last.status !== 'idle' && last.output && (
            <div>
              <button type="button" aria-expanded={showOutput} onClick={() => setShowOutput((v) => !v)} className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                {showOutput ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Last update's output
              </button>
              {showOutput && <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/30 p-2.5 text-[10px] font-mono text-slate-400 whitespace-pre-wrap">{last.output}</pre>}
            </div>
          )}

          {isAdmin && showAuth && !own.sudo_ready && (
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
              <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><KeyRound size={12} /> The API needs sudo for this: your Linux account (used once, like the OS updates on the {pageLabel('system')} page)</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input value={user} onChange={(e) => setUser(e.target.value)} aria-label="Linux username" placeholder="Linux username" autoComplete="username"
                  className="flex-1 min-w-0 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40" />
                <input value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Linux password" placeholder="Password" type="password" autoComplete="current-password" onKeyDown={(e) => { if (e.key === 'Enter') void startWithAccount() }}
                  className="flex-1 min-w-0 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40" />
                <button type="button" onClick={() => void startWithAccount()} disabled={busy || !user.trim() || !pw}
                  className={`${BTN_CARD} ${TONE_OK} justify-center`}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Update
                </button>
              </div>
              {authErr && <p className="text-[11px] text-rose-300">{authErr}</p>}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            {isAdmin && own.upgradable && !running && !showAuth && (
              <button type="button" onClick={() => (own.sudo_ready ? void start() : setShowAuth(true))} disabled={busy}
                className={`${BTN_CARD} ${TONE_OK}`}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Update engine
              </button>
            )}
            <button type="button" onClick={() => refresh()} disabled={loading} className={BTN_CARD_QUIET}>
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Check
            </button>
          </div>

          {fleet && fleet.members.length > 1 && (
            <div className="pt-3 mt-1 border-t border-white/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                  The VMs · {fleet.versions.length <= 1 ? 'one engine version everywhere' : `${fleet.versions.length} engine versions`}
                </p>
                {isAdmin && upgradableVms > 0 && (
                  <button type="button" onClick={() => void updateVms()} disabled={fleetBusy}
                    className={`${BTN_CARD} ${TONE_OK}`}>
                    {fleetBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Update {upgradableVms} VM{upgradableVms === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {fleet.members.filter((m) => m.id).map((m) => (
                  <li key={m.id ?? 'hub'} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
                    <VmCapsule member={m.id} name={m.name} vmid={m.vmid} size="xs" />
                    <span className="flex flex-wrap items-center gap-2 min-w-0">
                      {!m.reachable ? (
                        <span className="text-slate-500 truncate" title={m.error}>no answer</span>
                      ) : (
                        <>
                          <span className="font-mono text-slate-300">{m.version || '—'}</span>
                          {m.upgradable ? (
                            <Pill tone="info">{m.candidate} available</Pill>
                          ) : m.source === 'docker.io' ? (
                            <Pill tone="attention" title={m.note}>Debian's docker.io</Pill>
                          ) : (
                            <Pill tone="ok">Current</Pill>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
