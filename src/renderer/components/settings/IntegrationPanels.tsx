// =============================================================================
// Settings panels for the integrations that talk to other machines:
//   ProxmoxTestPanel  — "Test connection" for the Proxmox card (no save needed)
//   TraefikFeedPanel  — status of the feed a Traefik elsewhere pulls, with the
//                       token, the snippet to paste, and a rotate button
//   HomarrPanel       — the Homarr dashboard on this server: tiles on the home
//                       board with a stored API key, library only without one;
//                       the key, and a sync of every route onto it
// =============================================================================

import { useState } from 'react'
import { CheckCircle2, XCircle, Loader2, PlugZap, RefreshCw, Copy, Check, Radio, Store, KeyRound, Eye, EyeOff, Trash2 } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { proxmoxTest, fetchTraefikFeedStatus, rotateTraefikFeedToken } from '../../api/endpoints'
import { fetchHomarrIntegration, saveHomarrKey, removeHomarrKey, syncHomarrRoutes, homarrMode } from '../../api/integrations'
import { ApiError } from '../../api/client'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import Hint from '../common/Hint'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD_QUIET, TONE_OK, TONE_DANGER, FOCUS_RING } from '../../lib/ui'
import type { ProxmoxStatus } from '../../../shared/types'

import { CopyButton } from '../common/CopyButton'
export function ProxmoxTestPanel({ url, tokenId, tokenSecret, verifyTls, secretSource = '', onOpenSecrets }: { url: string; tokenId: string; tokenSecret: string; verifyTls: boolean; secretSource?: string; onOpenSecrets?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<ProxmoxStatus | null>(null)
  const [err, setErr] = useState('')
  const run = async () => {
    setBusy(true); setErr(''); setRes(null)
    try {
      setRes(await proxmoxTest({ url: url || undefined, token_id: tokenId || undefined, token_secret: tokenSecret || undefined, verify_tls: verifyTls }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The test failed')
    } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-slate-400">
          Tests the values above without saving them (a secret you typed is used; an empty one means the saved secret).
          {secretSource === 'secret' && onOpenSecrets && <> The saved secret lives in the secret store — <button type="button" onClick={onOpenSecrets} className={`h-auto rounded text-emerald-400 hover:text-emerald-300 underline underline-offset-2 ${FOCUS_RING}`}>manage it on the {pageLabel('secrets')} page</button>.</>}
          {secretSource === 'env' && <span className="text-amber-300/90"> The saved secret sits in .env; save it once more to move it to the secret store.</span>}
        </div>
        <button type="button" onClick={run} disabled={busy} className={BTN_TOOLBAR_QUIET}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test connection
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-rose-300 flex items-center gap-1.5"><XCircle size={13} /> {err}</div>}
      {res && (
        <div className={`mt-2 text-xs flex items-start gap-1.5 ${res.reachable ? 'text-emerald-300' : 'text-rose-300'}`}>
          {res.reachable ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
          <span>{res.reachable ? `Connected: Proxmox VE ${res.version}, ${res.nodes} node${res.nodes === 1 ? '' : 's'}, ${res.vms.total} guests (${res.vms.running} running)` : (res.error || res.hints?.[0] || 'Not reachable')}</span>
        </div>
      )}
    </div>
  )
}

function ago(epoch: number): string {
  if (!epoch) return 'never'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function TraefikFeedPanel({ enabled }: { enabled: boolean }) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const feed = usePolling(fetchTraefikFeedStatus, 15000, { enabled: isConnected })
  const confirm = useConfirm()
  const [rotating, setRotating] = useState(false)
  const f = feed.data
  const rotate = async () => {
    if (!(await confirm({ title: 'Mint a new feed token', message: 'Mint a new feed token? The Traefik that pulls the feed keeps failing until you paste the new one.', confirmLabel: 'Mint token' }))) return
    setRotating(true)
    try { await rotateTraefikFeedToken(); feed.refresh() } finally { setRotating(false) }
  }
  if (!f) return null
  const fresh = f.last_poll > 0 && Date.now() / 1000 - f.last_poll < 60
  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <Radio size={13} className={enabled && f.ready ? (fresh ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-500'} />
          <span className="text-slate-300">
            {!enabled ? 'Feed is off — save with the toggle on to mint a token.' : !f.ready ? 'Feed is on but has no token yet — save once more.' : fresh ? `Pulled ${ago(f.last_poll)} by ${f.last_client}` : f.last_poll ? `Last pulled ${ago(f.last_poll)} by ${f.last_client}` : 'Never pulled yet — paste the snippet into the other Traefik'}
          </span>
        </div>
        <div className="text-[11px] text-slate-500">{f.routes} route{f.routes === 1 ? '' : 's'} served{f.skipped.length ? ` · ${f.skipped.length} skipped` : ''}{f.local_traefik ? ' · local Traefik too' : ' · no local Traefik'}</div>
      </div>
      {enabled && f.ready && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] font-mono text-slate-300 bg-black/30 rounded-lg px-2 py-1 break-all">{f.token}</code>
            <CopyButton variant="chip" text={f.token} label="Copy token" />
            <button type="button" onClick={rotate} disabled={rotating} className={BTN_CARD_QUIET}>
              <RefreshCw size={12} className={rotating ? 'animate-spin' : ''} /> Rotate
            </button>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-400">Paste into that Traefik's static config (traefik.yml), then restart it:</span>
              <CopyButton variant="chip" text={f.snippet} label="Copy snippet" />
            </div>
            <pre className="text-[11px] font-mono text-slate-300 bg-black/30 rounded-lg p-2.5 overflow-x-auto whitespace-pre">{f.snippet}</pre>
            <div className="text-[11px] text-slate-500 mt-1">Through the dashboard instead of the API port: <code className="font-mono">https://&lt;dashboard&gt;/api/traefik/dynamic?token=…</code>. Traefik v3 can send the token as a header instead: <code className="font-mono">headers: {'{'} Authorization: "Bearer …" {'}'}</code>.</div>
          </div>
          {f.skipped.length > 0 && (
            <div className="text-[11px] text-amber-300/90">
              Not offered: {f.skipped.map((s) => `${s.service} (${s.reason})`).join('; ')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** An API that predates the endpoint the panel just called (a 404 is "not there yet", not a fault) */
function missingOnServer(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404
}

const HOMARR_WORDS = {
  board: 'Tiles on the home board',
  library: 'Library only — tiles need an API key',
  stopped: 'Homarr is stopped',
  none: 'Homarr is not deployed here',
} as const

export function HomarrPanel({ onOpenSecrets }: { onOpenSecrets?: () => void }) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const poll = usePolling(fetchHomarrIntegration, 30000, { enabled: isConnected })
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const s = poll.data

  const save = async () => {
    const k = key.trim()
    if (!k || saving) return
    setSaving(true)
    try {
      const r = await saveHomarrKey(k)
      addToast({ type: 'success', message: `Key accepted — ${r.boards} board${r.boards === 1 ? '' : 's'}` })
      setKey(''); setShowKey(false); poll.refresh()
    } catch (e) {
      if (missingOnServer(e)) addToast({ type: 'warning', message: 'This server cannot store a Homarr key yet — update DCS first' })
      else addToast({ type: 'error', message: e instanceof Error ? e.message : 'Homarr refused the key' })
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!(await confirm({ title: 'Remove the Homarr key', message: 'Remove the stored API key? Apps deployed from now on land in Homarr\'s library only, without a tile on the board.', confirmLabel: 'Remove key', danger: true }))) return
    setRemoving(true)
    try {
      await removeHomarrKey()
      addToast({ type: 'success', message: 'Key removed — new apps land in the library only' })
      poll.refresh()
    } catch (e) {
      if (missingOnServer(e)) addToast({ type: 'warning', message: 'This server cannot manage the Homarr key yet — update DCS first' })
      else addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not remove the key' })
    } finally { setRemoving(false) }
  }

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await syncHomarrRoutes()
      const already = r.skipped ? ` · ${r.skipped} already on Homarr` : ''
      addToast(r.queued
        ? { type: 'success', message: `Registering ${r.queued} app${r.queued === 1 ? '' : 's'} on Homarr${already}` }
        : { type: 'info', message: `Nothing to add — Homarr has every routed app${already}` })
      poll.refresh()
    } catch (e) {
      if (missingOnServer(e)) addToast({ type: 'warning', message: 'This server cannot sync routes onto Homarr yet — update DCS first' })
      else addToast({ type: 'error', message: e instanceof Error ? e.message : 'The sync failed' })
    } finally { setSyncing(false) }
  }

  if (!s) {
    if (!poll.error) {
      return poll.loading && isConnected
        ? <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex items-center gap-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Reading the Homarr status…</div>
        : null
    }
    // an API without the integration, or one that did not answer: a quiet line, not a fault
    return (
      <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex items-center gap-2 text-xs">
        <Store size={13} className="text-slate-500 shrink-0" />
        <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
        <span className="text-slate-400">
          {missingOnServer(poll.error) ? 'The Homarr integration is not available on this server — update DCS to register deployed apps on a Homarr dashboard.' : `Could not read the Homarr status — ${poll.error.message}`}
        </span>
      </div>
    )
  }

  const mode = homarrMode(s)
  // stopped is amber like library: Homarr is there, something needs doing before tiles land
  const tone = mode === 'board' ? 'emerald' : mode === 'library' || mode === 'stopped' ? 'amber' : 'slate'
  // Homarr in a VM of the fleet (where = the member id): say so, the address alone looks like the hub's
  const inVm = s.where && s.where !== 'hub' ? `in the VM ${s.where_name || s.where}` : ''
  const where = s.active
    ? [inVm, s.url, s.port && !s.url.endsWith(`:${s.port}`) ? `port ${s.port}` : '', s.has_api_key && s.boards !== undefined ? `${s.boards} board${s.boards === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
    : ''
  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <Store size={13} className={tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : 'text-slate-500'} />
          <span className={`w-2 h-2 rounded-full shrink-0 ${tone === 'emerald' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-slate-600'}`} />
          <span className="text-slate-300">{HOMARR_WORDS[mode]}</span>
        </div>
        {where && <div className="text-[11px] text-slate-500 break-all">{where}</div>}
      </div>
      {mode === 'none' || mode === 'stopped' ? (
        // the server's own sentence when it has one (the panel below says the rest itself once Homarr runs);
        // a stopped Homarr gets the server's hint too (start it on the Containers page), not a key form it cannot test
        <div className="text-[11px] text-slate-500">{s.hint || (mode === 'stopped' ? `Homarr is stopped: start it on the ${pageLabel('containers')} page and apps land on it again.` : 'Deploy the Homarr template and DCS registers every routed app on it — as a tile on the home board with an API key, in the app library without one.')}</div>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); void save() }} className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[12rem]">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={s.has_api_key ? 'Paste a new key to replace the stored one' : 'Paste the API key from Homarr'}
                autoComplete="off"
                spellCheck={false}
                aria-label="Homarr API key"
                className="w-full h-9 pl-3 pr-10 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-600 placeholder:font-sans focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
              />
              <Hint label={showKey ? 'Hide the key' : 'Show the key'}>
                <button type="button" onClick={() => setShowKey((v) => !v)} className={`absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 sm:h-7 sm:w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 ${FOCUS_RING}`} aria-label={showKey ? 'Hide the key' : 'Show the key'}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </Hint>
            </div>
            <button type="submit" disabled={saving || !key.trim()} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Save and test
            </button>
            {s.has_api_key && (
              <button type="button" onClick={remove} disabled={removing} className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
                {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove key
              </button>
            )}
            <button type="button" onClick={sync} disabled={syncing} title="Register every routed service — the hub's own and the VMs' — that Homarr does not have yet" className={BTN_TOOLBAR_QUIET}>
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> Sync routes now
            </button>
          </form>
          <div className="text-[11px] text-slate-500">
            {s.has_api_key
              ? <>The key is kept as the secret <code className="font-mono text-slate-400">HOMARR_API_KEY</code>{onOpenSecrets && <> (<button type="button" onClick={onOpenSecrets} className={`h-auto rounded text-emerald-400 hover:text-emerald-300 underline underline-offset-2 ${FOCUS_RING}`}>{pageLabel('secrets')} page</button>)</>}. A deploy with "Add to Homarr" creates the app and a tile on the home board.</>
              : <>Without a key a deploy with "Add to Homarr" only adds the app to Homarr's library — you drag it onto a board yourself.</>}
          </div>
          <ol className="text-[11px] text-slate-500 space-y-0.5 list-decimal pl-4 marker:text-slate-600">
            <li>In Homarr open your avatar → Manage → Tools → API keys → Create.</li>
            <li>Copy the key once — Homarr shows it only at that moment.</li>
            <li>Paste it here and press Save and test.</li>
          </ol>
        </>
      )}
    </div>
  )
}
