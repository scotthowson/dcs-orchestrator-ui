// =============================================================================
// Dashboard feed — the token that lets a dashboard which cannot sign in (Homarr,
// Home Assistant, a wall display) read two things from this server: the server at
// a glance and what CrowdSec has been seeing. Read-only; off until a token exists.
// The token is shown once, when it is made.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Radio, Copy, Check, Loader2, Power, RefreshCw } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { fetchDashboardFeedStatus, createDashboardFeedToken, deleteDashboardFeedToken } from '../../api/endpoints'
import type { DashboardFeedStatus } from '../../../shared/types'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK, TONE_DANGER } from '../../lib/ui'

import { CopyButton } from '../common/CopyButton'
function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] text-slate-500 w-20 shrink-0">{label}</span>
      <code className="text-[11px] font-mono text-slate-300 truncate min-w-0 flex-1" title={value}>{value}</code>
      <CopyButton text={value} label={`Copy the ${label.toLowerCase()}`} />
    </div>
  )
}

export default function DashboardFeedCard() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<DashboardFeedStatus | null>(null)
  const [missing, setMissing] = useState(false)   // a server from before the feed existed
  const [busy, setBusy] = useState('')
  const [token, setToken] = useState('')

  const load = useCallback(() => {
    fetchDashboardFeedStatus().then((s) => { setStatus(s); setMissing(false) }).catch(() => setMissing(true))
  }, [])
  useEffect(() => { load() }, [load])
  if (missing || !status) return null

  const make = async () => {
    if (status.enabled && !(await confirm({ title: 'Make a new token', message: 'The token in use stops working at once: every dashboard that has it needs the new one.', confirmLabel: 'Make a new token', danger: true }))) return
    setBusy('make')
    try { const r = await createDashboardFeedToken(); setToken(r.token); load() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not make a token' }) }
    finally { setBusy('') }
  }
  const off = async () => {
    if (!(await confirm({ title: 'Switch the dashboard feed off', message: 'The token is removed: dashboards that read the feed get nothing until you make a new one.', confirmLabel: 'Switch off', danger: true }))) return
    setBusy('off')
    try { await deleteDashboardFeedToken(); setToken(''); load() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not switch the feed off' }) }
    finally { setBusy('') }
  }

  return (
    <section aria-label="Dashboard feed" className="glass rounded-xl border border-white/5 p-4 space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0"><Radio size={16} className="text-emerald-400" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">Dashboard feed
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${status.enabled ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>{status.enabled ? 'on' : 'off'}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">A token for a dashboard that cannot sign in (Homarr, Home Assistant, a wall display). It can read the server at a glance and what CrowdSec has been seeing, and nothing else.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={make} disabled={!!busy} className={`${BTN_CARD} ${TONE_OK}`}>{busy === 'make' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {status.enabled ? 'New token' : 'Switch on'}</button>
          {status.enabled && <button type="button" onClick={off} disabled={!!busy} className={`${BTN_CARD} ${TONE_DANGER}`}>{busy === 'off' ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} Switch off</button>}
        </div>
      </div>
      {token && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3 space-y-2 animate-fade-in">
          <p className="text-xs text-emerald-200">This token is shown once. Give it to the dashboard as a Bearer token.</p>
          <CopyLine label="Token" value={token} />
        </div>
      )}
      {status.enabled && (
        <div className="space-y-1.5">
          <CopyLine label="Server" value={status.summary_url} />
          <CopyLine label="CrowdSec" value={status.crowdsec_url} />
          <p className="text-[11px] text-slate-500">Send the token as <span className="font-mono">Authorization: Bearer …</span> (or <span className="font-mono">?token=…</span>).</p>
        </div>
      )}
    </section>
  )
}
