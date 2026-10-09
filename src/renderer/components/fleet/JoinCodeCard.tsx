// =============================================================================
// JoinCodeCard — mints and shows a join code with the one line that makes any VM
// a node of this hub (the API alone: the hub's dashboard manages it) and, for a
// VM that already runs a full DCS, the join command. Used by the wizard and the
// Proxmox page.
// =============================================================================

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { createFleetJoinToken, fetchFleetJoinTokens, revokeFleetJoinToken } from '../../api/endpoints'
import type { FleetJoinToken } from '../../../shared/types'
import Hint from '../common/Hint'
import { BTN_CARD_QUIET } from '../../lib/ui'

import { CopyButton } from '../common/CopyButton'
export default function JoinCodeCard({ compact = false, autoMint = true }: { compact?: boolean; autoMint?: boolean }) {
  const [hubUrl, setHubUrl] = useState('')
  const [tokens, setTokens] = useState<FleetJoinToken[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = async () => {
    try {
      const r = await fetchFleetJoinTokens()
      setHubUrl(r.hub_url); setTokens(r.tokens)
      return r.tokens
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read the join codes'); return [] }
  }
  const mint = async () => {
    setBusy(true); setErr('')
    try { await createFleetJoinToken(24); await load() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not mint a join code') } finally { setBusy(false) }
  }
  useEffect(() => {
    void (async () => { const t = await load(); if (autoMint && t.length === 0) await mint() })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const latest = tokens[tokens.length - 1]
  // the API composes the node line (GET /fleet/bootstrap with this code); an older hub without it gets the same shape built here
  const nodeCmd = latest ? (latest.node_command || `curl -fsSL '${hubUrl}/fleet/bootstrap?token=${latest.token}' | bash`) : ''
  const joinCmd = latest ? `./setup.sh --join ${hubUrl} ${latest.token}` : ''
  return (
    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.04] p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-200"><KeyRound size={13} /> Join code for the other VMs</div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={mint} disabled={busy} className={BTN_CARD_QUIET}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} New code
          </button>
        </div>
      </div>
      {err && <p role="alert" className="text-[11px] text-rose-300">{err}</p>}
      {latest ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-mono tracking-wider text-slate-100 bg-black/30 rounded-lg px-2.5 py-1">{latest.token}</code>
            <CopyButton variant="chip" text={latest.token} label="Copy" />
            <span className="text-[11px] text-slate-500">valid until {new Date(latest.expires_at * 1000).toLocaleString()}{latest.uses ? ` · used ${latest.uses}×` : ''}</span>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400">On any Debian, Ubuntu, Fedora or Arch VM, as a user with sudo — installs Docker and DCS as a node of this hub and joins it:</p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 min-w-0 text-[11px] font-mono text-slate-300 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all">{nodeCmd}</pre>
              <CopyButton variant="chip" text={nodeCmd} label="Copy" />
            </div>
            {!compact && (
              <>
                <p className="text-[11px] text-slate-400">On a VM that already runs a full DCS (it keeps its own dashboard and accounts):</p>
                <div className="flex items-start gap-2">
                  <pre className="flex-1 min-w-0 text-[11px] font-mono text-slate-300 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all">{joinCmd}</pre>
                  <CopyButton variant="chip" text={joinCmd} label="Copy" />
                </div>
              </>
            )}
            <p className="text-[10px] text-slate-500">A node is the API alone: no dashboard, no accounts of its own, no wizard. The join creates the account this hub uses on it and hands it over once; the hub reaches it at http://&lt;its address&gt;:9876 and this dashboard manages it from then on.</p>
          </div>
          {tokens.length > 1 && !compact && (
            <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
              Older codes still valid: {tokens.slice(0, -1).map((t) => (
                <span key={t.token} className="inline-flex items-center gap-1 font-mono text-slate-400">{t.token}
                  <Hint label="Revoke this code"><button type="button" onClick={() => revokeFleetJoinToken(t.token).then(load).catch(() => {})} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors" aria-label={`Revoke ${t.token}`}><Trash2 size={11} /></button></Hint>
                </span>
              ))}
            </div>
          )}
        </>
      ) : busy ? <p className="text-[11px] text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Minting a join code…</p>
        : <p className="text-[11px] text-slate-400">No join code yet.</p>}
    </div>
  )
}
