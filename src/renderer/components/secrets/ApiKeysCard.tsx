// =============================================================================
// API keys — for a dashboard (Homarr), a script or Home Assistant: something that
// can only send a fixed header, for months. A key is made here, shown once, and
// kept on the server as a hash. "Read" looks; "operate" also starts, stops,
// restarts and updates. A key is never an admin.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react'
import { KeyRound, Copy, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { fetchApiKeys, createApiKey, deleteApiKey } from '../../api/endpoints'
import type { ApiKeyInfo } from '../../../shared/types'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK, TONE_GHOST_DANGER } from '../../lib/ui'

const ago = (t: number) => {
  if (!t) return 'never used'
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t)
  if (s < 120) return 'used just now'
  if (s < 7200) return `used ${Math.floor(s / 60)} min ago`
  if (s < 172800) return `used ${Math.floor(s / 3600)} h ago`
  return `used ${Math.floor(s / 86400)} days ago`
}
const until = (t: number) => (!t ? 'does not expire' : `expires ${new Date(t * 1000).toLocaleDateString()}`)

export default function ApiKeysCard() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null)
  const [missing, setMissing] = useState(false)   // a server from before API keys existed
  const [busy, setBusy] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'read' | 'operate'>('read')
  const [days, setDays] = useState(0)
  const [made, setMade] = useState<{ name: string; key: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    fetchApiKeys().then((r) => { setKeys(Array.isArray(r.keys) ? r.keys : []); setMissing(false) }).catch(() => setMissing(true))
  }, [])
  useEffect(() => { load() }, [load])
  if (missing || keys === null) return null

  const fail = (e: unknown, fallback: string) => addToast({ type: 'error', message: e instanceof Error ? e.message : fallback })
  const make = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy('make')
    try { const r = await createApiKey(name.trim(), role, days); setMade({ name: r.name, key: r.key }); setCopied(false); setName(''); load() }
    catch (err) { fail(err, 'Could not make the key') } finally { setBusy('') }
  }
  const remove = async (k: ApiKeyInfo) => {
    if (!(await confirm({ title: `Remove the key "${k.name}"?`, message: 'It stops working at once: whatever uses it gets nothing until you give it a new one.', confirmLabel: 'Remove', danger: true }))) return
    setBusy(k.id)
    try { await deleteApiKey(k.id); if (made?.name === k.name) setMade(null); load() }
    catch (err) { fail(err, 'Could not remove the key') } finally { setBusy('') }
  }
  const copy = () => { if (made) navigator.clipboard?.writeText(made.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }

  return (
    <section aria-label="API keys" className="glass rounded-xl border border-white/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0"><KeyRound size={16} className="text-sky-400" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-200">API keys</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            For a dashboard, a script or Home Assistant: something that sends a fixed header instead of signing in. <span className="text-slate-300">Read</span> looks;
            {' '}<span className="text-slate-300">operate</span> also starts, stops, restarts and updates. A key is never an admin: no users, secrets, terminal or settings.
          </p>
        </div>
      </div>

      {made && (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/[0.06] p-3 space-y-2 animate-fade-in">
          <p className="text-xs text-sky-200">The key for "{made.name}" is shown once. Send it as <span className="font-mono">Authorization: Bearer …</span> or as <span className="font-mono">X-API-Key: …</span></p>
          <div className="flex items-center gap-2 min-w-0">
            <code className="text-[11px] font-mono text-slate-200 truncate min-w-0 flex-1 select-all">{made.key}</code>
            <button type="button" aria-label="Copy the key" className={BTN_CARD_QUIET} onClick={copy}>{copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} Copy</button>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-100 truncate">{k.name}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${k.role === 'operate' ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'border-sky-500/25 bg-sky-500/10 text-sky-300'}`}>{k.role}</span>
                  {k.expired && <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-rose-500/25 bg-rose-500/10 text-rose-300">expired</span>}
                </p>
                <p className="text-[11px] text-slate-500 truncate"><span className="font-mono">{k.prefix}…</span> · {ago(k.last_used_at)} · {until(k.expires_at)} · made by {k.created_by}</p>
              </div>
              <button type="button" aria-label={`Remove the key ${k.name}`} disabled={!!busy} className={`${BTN_CARD_QUIET} ${TONE_GHOST_DANGER}`} onClick={() => void remove(k)}>
                {busy === k.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={make} className="flex items-end gap-2 flex-wrap">
        <label className="flex-1 min-w-[10rem] text-[11px] text-slate-500">What it is for
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Homarr" className="mt-1 w-full rounded-md bg-black/20 border border-white/10 px-2 py-1.5 text-xs text-slate-200" />
        </label>
        <label className="text-[11px] text-slate-500">May
          <select value={role} onChange={(e) => setRole(e.target.value === 'operate' ? 'operate' : 'read')} className="mt-1 block rounded-md bg-black/20 border border-white/10 px-2 py-1.5 text-xs text-slate-200">
            <option value="read">read</option>
            <option value="operate">operate</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-500">Expires
          <select value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} className="mt-1 block rounded-md bg-black/20 border border-white/10 px-2 py-1.5 text-xs text-slate-200">
            <option value={0}>never</option>
            <option value={30}>in 30 days</option>
            <option value={90}>in 90 days</option>
            <option value={365}>in a year</option>
          </select>
        </label>
        <button type="submit" disabled={!!busy || !name.trim()} className={`${BTN_CARD} ${TONE_OK}`}>{busy === 'make' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Make a key</button>
      </form>
    </section>
  )
}
