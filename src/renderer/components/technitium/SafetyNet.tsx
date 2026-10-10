// The Technitium page's safety net (.lib/technitium-alerts.sh on the server): each blocklist's health with "Update lists now"
// (the Lists tab), the notice that Technitium has a newer version with the command that installs it, and the backups with
// "Back up now" and a restore that asks first (the Servers sheet).

import { useState } from 'react'
import { Archive, Download, HeartPulse, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import StatusLine from '../common/StatusLine'
import Notice from '../common/Notice'
import { CopyBlock } from '../common/CopyButton'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { apiErrorMessage } from '../../api/errors'
import { backupTechnitium, fetchTechnitiumBackups, fetchTechnitiumStatus, restoreTechnitium, updateTechnitiumLists } from '../../api/endpoints'
import type { TechnitiumBackup, TechnitiumInstance, TechnitiumListState } from '../../../shared/types'
import { BTN_CARD_QUIET, BTN_TOOLBAR_QUIET, TEXT_META } from '../../lib/ui'
import type { Tone } from '../../lib/tone'

export const TECHNITIUM_UPDATE_COMMAND = 'curl -sSL https://download.technitium.com/dns/install.sh | sudo bash'
const STALE_MS = 48 * 3600 * 1000

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
const listName = (url: string) => url.replace(/^https?:\/\//, '').replace(/^raw\.githubusercontent\.com\//, '')

function listTone(l: TechnitiumListState): Tone {
  if (l.error) return 'problem'
  if (l.last_updated && Date.now() - Date.parse(l.last_updated) > STALE_MS) return 'attention'
  return 'ok'
}

// ---- Lists tab: each server's blocklists, how many names, when, and why one failed ----
export function ListsHealth({ isAdmin }: { isAdmin: boolean }) {
  const { data: status, refresh } = usePolling(fetchTechnitiumStatus, 15000, { key: pollKeys.technitiumStatus })
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const servers = [status?.primary, status?.secondary].filter((s): s is TechnitiumInstance => !!s?.configured && !!s.reachable && !!s.lists)
  if (!servers.length) return null
  const failing = servers.reduce((n, s) => n + (s.lists?.lists.filter((l) => l.error).length ?? 0), 0)
  const update = async () => {
    setBusy(true)
    try { const r = await updateTechnitiumLists(); addToast({ type: 'success', message: r.message }); await refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Panel icon={HeartPulse} title="List health" sub="Read from Technitium's own log: each list's names, its last update, and why a download failed."
      badge={failing ? <Pill tone="problem" dot>{failing} failing</Pill> : <Pill tone="ok" dot>Updating</Pill>}
      actions={isAdmin ? <button type="button" disabled={busy} className={BTN_TOOLBAR_QUIET} onClick={() => void update()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Update lists now</button> : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        {servers.map((s) => { const h = s.lists!; return (
          <div key={s.role} className="min-w-0">
            <p className="text-xs font-semibold text-slate-300">
              <span className="capitalize">{s.role}</span> <span className="font-normal text-slate-500">· {h.total != null ? `${h.total.toLocaleString()} names blocked` : 'total unknown'}{h.updated_at ? ` · updated ${ago(h.updated_at)}` : ''}</span>
            </p>
            {h.lists.length ? (
              <ul className="mt-1">
                {h.lists.map((l) => (
                  <StatusLine key={l.url} as="li" dense tone={listTone(l)} title={<span className="font-mono break-all">{listName(l.url)}</span>}>
                    {l.error ?? `${l.entries != null ? `${l.entries.toLocaleString()} names` : 'size not in the log'} · ${l.last_updated ? `updated ${ago(l.last_updated)}` : 'no update in the last 3 days of the log'}`}
                  </StatusLine>
                ))}
              </ul>
            ) : <p className={TEXT_META}>No blocklists.</p>}
            {h.note && <p className={`${TEXT_META} mt-1`}>{h.note}.</p>}
          </div>
        ) })}
      </div>
    </Panel>
  )
}

// ---- Servers sheet: Technitium has a newer version ----
export function UpdateNotice({ inst }: { inst: TechnitiumInstance | null | undefined }) {
  if (!inst?.reachable || !inst.version) return null
  if (!inst.update_available) return <p className={TEXT_META}>Technitium {inst.version}: the newest version.</p>
  return (
    <Notice tone="info" icon={Download} title={`Technitium ${inst.update_version} is out (this server runs ${inst.version})`}>
      <p className="mb-2">Update it on that machine (the LXC or the Pi) with Technitium's install script: it keeps the settings and restarts the server.</p>
      <CopyBlock text={TECHNITIUM_UPDATE_COMMAND} label="The update command" />
    </Notice>
  )
}

// ---- Servers sheet: the backups (an admin's) ----
export function BackupsPanel() {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumBackups, 60000, { key: 'technitium-backups' })
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState('')
  const backup = async () => {
    setBusy('backup')
    try {
      const r = await backupTechnitium()
      addToast({ type: r.errors.length ? 'warning' : 'success', message: r.errors.length ? `${r.message}; ${r.errors.map((e) => e.error).join('; ')}` : r.message })
      await refresh()
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy('') }
  }
  const restore = async (b: TechnitiumBackup) => {
    const ok = await confirm({
      title: `Restore this backup onto the ${b.server}?`,
      message: `${b.file}${b.created_at ? ` (${new Date(b.created_at).toLocaleString()})` : ''}\n\nIts settings, zones and allowed and blocked names replace what the ${b.server} has now${b.server === 'primary' ? ', with the DHCP scopes' : ''}. Technitium restarts its DNS service: a few seconds without answers. Its own accounts and tokens stay as they are.`,
      confirmLabel: 'Restore backup', danger: true,
    })
    if (!ok) return
    setBusy(b.file)
    try { const r = await restoreTechnitium(b.server, b.file); addToast({ type: r.warning ? 'warning' : 'success', message: r.message, duration: 8000 }) } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy('') }
  }
  return (
    <section aria-label="Backups" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-200">Backups</p>
          <p className={TEXT_META}>{data?.nightly_hour != null ? `Every night at ${String(data.nightly_hour).padStart(2, '0')}:00` : 'Nightly backups are off'}, {data?.keep ?? 14} kept per server.</p>
        </div>
        <button type="button" disabled={!!busy} className={BTN_CARD_QUIET} onClick={() => void backup()}>
          {busy === 'backup' ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />} Back up now
        </button>
      </div>
      {loading && !data && <Skeleton rows={3} />}
      {error && !data && <ErrorState card title="Could not list the backups" error={error} onRetry={() => void refresh()} />}
      {data && !data.backups.length && <EmptyState compact icon={<Archive size={22} />} title="No backup yet" hint="Back up now, or wait for the night." />}
      {data && data.backups.length > 0 && (
        <ul className="divide-y divide-white/5 max-h-64 overflow-y-auto scrollbar-thin">
          {data.backups.map((b) => (
            <li key={b.file} className="flex items-center gap-2 py-1.5 min-w-0">
              <Pill tone="neutral" size="xs">{b.server}</Pill>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-300 truncate">{b.created_at ? new Date(b.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : b.file}</p>
                <p className="text-[11px] text-slate-500 truncate">{(b.bytes / 1024).toFixed(1)} KB{b.version ? ` · Technitium ${b.version}` : ''} · {b.block_lists} list{b.block_lists === 1 ? '' : 's'}</p>
              </div>
              <button type="button" disabled={!!busy} className={BTN_CARD_QUIET} onClick={() => void restore(b)} aria-label={`Restore ${b.file}`}>
                {busy === b.file ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
