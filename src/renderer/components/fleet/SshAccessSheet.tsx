// =============================================================================
// SSH into the VMs — a key of your own. Tick the VMs, type your dashboard
// password, and the hub makes a key, puts its public half on those VMs and hands
// you the private half once, with an ssh config that names every VM like its
// stack (`ssh media-services`) and jumps through the hub. Nothing is kept on the
// hub but the public half: removing the key takes it off every VM again.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TerminalSquare, Loader2, Check, X, Download, Trash2, KeyRound, Plus, AlertTriangle } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { useAuthStore } from '../../stores/authStore'
import { fetchSshAccess, createSshKey, deleteSshKey, fetchSshKeyConfig, addSshKeyVms } from '../../api/endpoints'
import { apiErrorMessage } from '../../api/errors'
import type { SshAccess, SshKeyCreated, SshKeyInfo } from '../../../shared/types'
import { BTN_SHEET_PRIMARY, BTN_CARD, BTN_CARD_QUIET, TONE_OK, TONE_GHOST_DANGER } from '../../lib/ui'

import Sheet from '../common/Sheet'
import { INPUT_FLEET, LABEL } from '../../lib/fieldStyles'
import { CopyBlock } from '../common/CopyButton'
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/
const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/
const checkCls = 'h-4 w-4 rounded border-white/20 bg-slate-800 accent-emerald-500 shrink-0'

/** a file to the person's Downloads folder */
function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function SshAccessSheet({ focus, onClose }: { focus?: string; onClose: () => void }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const me = useAuthStore((s) => s.currentUser)
  const [data, setData] = useState<SshAccess | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [hubHost, setHubHost] = useState('')
  const [hubAccess, setHubAccess] = useState(false)
  const [direct, setDirect] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [made, setMade] = useState<SshKeyCreated | null>(null)

  const load = useCallback(() => {
    fetchSshAccess().then((d) => {
      setData(d)
      setHubHost((h) => h || d.hub.host)
      setPicked((p) => (p.size ? p : new Set(focus ? [focus] : d.vms.filter((v) => v.reachable).map((v) => v.id))))
      setName((n) => n || `${(me || 'me').replace(/[^A-Za-z0-9._-]/g, '-')}-key`.slice(0, 32))
    }).catch((e) => setLoadErr(apiErrorMessage(e, 'Could not read the VMs')))
  }, [focus, me])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const nameTaken = !!data?.keys.some((k) => k.name === name)
  const canMake = !!data && picked.size > 0 && NAME_RE.test(name) && !nameTaken && HOST_RE.test(hubHost) && password.length > 0 && !busy

  const make = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canMake) return
    setBusy('make'); setErr('')
    try {
      const r = await createSshKey({ name, members: [...picked], password, hub_access: hubAccess, via: direct ? 'direct' : 'hub', hub_host: hubHost })
      setMade(r); setPassword(''); load()
    } catch (ex) { setErr(apiErrorMessage(ex, 'Could not make the key')); setPassword('') } finally { setBusy('') }
  }
  const removeKey = async (k: SshKeyInfo) => {
    if (!(await confirm({ title: `Remove the key "${k.name}"?`, message: `It is taken off ${k.members.length} VM${k.members.length === 1 ? '' : 's'}${k.hub ? ' and the hub' : ''} at once: whoever holds it can no longer sign in.`, confirmLabel: 'Remove', danger: true }))) return
    setBusy(k.id)
    try { await deleteSshKey(k.id); addToast({ type: 'success', message: `The key "${k.name}" no longer opens anything` }); load() }
    catch (ex) { addToast({ type: 'error', message: apiErrorMessage(ex, 'Could not remove the key') }) } finally { setBusy('') }
  }
  const downloadConfig = async (k: SshKeyInfo) => {
    setBusy(`cfg-${k.id}`)
    try { const r = await fetchSshKeyConfig(k.id, direct ? 'direct' : 'hub', hubHost || data?.hub.host || ''); saveText(r.config_file, r.config) }
    catch (ex) { addToast({ type: 'error', message: apiErrorMessage(ex, 'Could not get the config') }) } finally { setBusy('') }
  }
  const addMore = async (k: SshKeyInfo) => {
    const missing = (data?.vms ?? []).filter((v) => v.reachable && !k.members.includes(v.id)).map((v) => v.id)
    if (!missing.length) return
    setBusy(`add-${k.id}`)
    try {
      const r = await addSshKeyVms(k.id, missing)
      const bad = r.results.filter((x) => !x.ok)
      addToast({ type: bad.length ? 'error' : 'success', message: bad.length ? `Not on ${bad.map((b) => b.name).join(', ')}` : `The key "${k.name}" is on ${missing.length} more VM${missing.length === 1 ? '' : 's'}: download the config again` })
      load()
    } catch (ex) { addToast({ type: 'error', message: apiErrorMessage(ex, 'Could not put the key on the VMs') }) } finally { setBusy('') }
  }

  const setup = useMemo(() => made ? [
    `mkdir -p ~/.ssh && mv ~/Downloads/${made.key_file} ~/Downloads/${made.config_file} ~/.ssh/ && chmod 600 ~/.ssh/${made.key_file}`,
    `{ printf 'Include ~/.ssh/${made.config_file}\\n\\n'; cat ~/.ssh/config 2>/dev/null; } > ~/.ssh/config.new && mv ~/.ssh/config.new ~/.ssh/config && chmod 600 ~/.ssh/config`,
  ].join('\n') : '', [made])

  // ─── the key is made: download it, set it up, connect ──────────────────────
  if (made) {
    const first = made.results.find((r) => r.ok)?.name
    return (
      <Sheet tone="fleet" title="Your key is ready" subtitle="It is shown once: the hub keeps no copy of the private half" icon={<KeyRound size={18} />} onClose={onClose} wide
        footer={<button type="button" onClick={onClose} className={`${BTN_SHEET_PRIMARY} w-full`}>Done</button>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onClick={() => saveText(made.key_file, made.private_key)} className={`${BTN_CARD} ${TONE_OK} justify-center py-2.5`}><Download size={12} /> 1 · Download the key <span className="font-mono text-[11px] opacity-80">{made.key_file}</span></button>
            <button type="button" onClick={() => saveText(made.config_file, made.config)} className={`${BTN_CARD} ${TONE_OK} justify-center py-2.5`}><Download size={12} /> 2 · Download the ssh config <span className="font-mono text-[11px] opacity-80">{made.config_file}</span></button>
          </div>
          <div>
            <p className={LABEL}>3 · Put them in place (paste into a terminal on your computer)</p>
            <CopyBlock text={setup} label="the setup commands" />
          </div>
          <div>
            <p className={LABEL}>4 · Connect</p>
            <CopyBlock text={`ssh ${first ?? '<stack>'}`} label="the ssh command" />
          </div>
          <ul className="rounded-lg border border-white/5 divide-y divide-white/5">
            {made.results.map((r) => (
              <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                {r.ok ? <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" /> : <X size={14} className="text-rose-400 mt-0.5 shrink-0" />}
                <span className="min-w-0"><span className="font-mono text-slate-200">{r.name}</span>{r.ok ? <span className="text-slate-500"> · the key is on it</span> : <span className="text-rose-300"> · {r.error}</span>}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500">Key fingerprint <span className="font-mono">{made.fingerprint}</span>. The key opens the VMs above as <span className="font-mono">{data?.vm_user ?? 'dcs'}</span>, which can <span className="font-mono">sudo</span> without a password: keep the file private. Lost it? Remove the key here and make another.</p>
        </div>
      </Sheet>
    )
  }

  // ─── the form ──────────────────────────────────────────────────────────────
  return (
    <Sheet tone="fleet" title="SSH into your VMs" subtitle="A key of your own: the hub makes it, puts its public half on the VMs you tick and gives you the private half once" icon={<TerminalSquare size={18} />} onClose={busy ? () => {} : onClose} wide
      footer={<>
        {err && <p role="alert" className="text-xs text-rose-300 mb-3">{err}</p>}
        <button type="submit" form="ssh-make" disabled={!canMake} className={`${BTN_SHEET_PRIMARY} w-full`}>
          {busy === 'make' ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Make my key and set up {picked.size} VM{picked.size === 1 ? '' : 's'}
        </button>
      </>}>
      {loadErr && <p role="alert" className="text-xs text-rose-300">{loadErr}</p>}
      {!data && !loadErr && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading the VMs…</p>}
      {data && data.vms.length === 0 && <p className="text-sm text-slate-400">No VM is linked to this hub yet: build one, or link one, on this page first.</p>}
      {data && data.vms.length > 0 && (
        <form id="ssh-make" onSubmit={make} className="space-y-4">
          <div>
            <p className={LABEL}>Which VMs <span className="normal-case font-normal text-slate-500">· you sign in as <span className="font-mono">{data.vm_user}</span></span></p>
            <ul className="rounded-lg border border-white/5 divide-y divide-white/5">
              {data.vms.map((v) => (
                <li key={v.id}>
                  <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/[0.03]">
                    <input type="checkbox" className={checkCls} checked={picked.has(v.id)} onChange={() => toggle(v.id)} disabled={!!busy} />
                    <span className="font-mono text-sm text-slate-100 min-w-0 truncate">{v.name}</span>
                    <span className="font-mono text-[11px] text-slate-500">{v.address}</span>
                    {!v.reachable && <span className="ml-auto text-[10px] text-amber-300">not answering</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ssh-name" className={LABEL}>Name of the key</label>
              <input id="ssh-name" value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={!!busy} autoComplete="off" />
              {name && !NAME_RE.test(name) && <p className="mt-1 text-[11px] text-rose-300">Letters, digits, dots, dashes and underscores.</p>}
              {nameTaken && <p className="mt-1 text-[11px] text-rose-300">A key with that name exists already.</p>}
            </div>
            <div>
              <label htmlFor="ssh-hub" className={LABEL}>The hub's address, as you reach it</label>
              <input id="ssh-hub" value={hubHost} onChange={(e) => setHubHost(e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={!!busy || direct} placeholder={data.hub.host} autoComplete="off" />
            </div>
          </div>
          <div className="space-y-2 text-xs text-slate-300">
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className={`${checkCls} mt-0.5`} checked={!direct} onChange={(e) => setDirect(!e.target.checked)} disabled={!!busy} />
              <span>Connect <b>through the hub</b> (works from anywhere you can reach the hub, even when the VMs are on a private network). Untick for a direct connection to each VM.</span></label>
            <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" className={`${checkCls} mt-0.5`} checked={hubAccess} onChange={(e) => setHubAccess(e.target.checked)} disabled={!!busy || direct} />
              <span>Let this key into the hub too, as <span className="font-mono">{data.hub.user}</span> (one key for the whole way). A shell on the hub holds every VM's key: leave it off if you already have a way in.</span></label>
          </div>
          <div>
            <label htmlFor="ssh-pw" className={LABEL}>Your dashboard password <span className="normal-case font-normal text-slate-500">· asked again before a key is made</span></label>
            <input id="ssh-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT_FLEET} disabled={!!busy} autoComplete="current-password" />
          </div>
        </form>
      )}

      {data && data.keys.length > 0 && (
        <div className="mt-5">
          <p className={LABEL}>Keys made so far</p>
          <ul className="rounded-lg border border-white/5 divide-y divide-white/5">
            {data.keys.map((k) => {
              const missing = data.vms.filter((v) => v.reachable && !k.members.includes(v.id)).length
              return (
                <li key={k.id} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound size={13} className="text-slate-500 shrink-0" />
                    <span className="font-mono text-sm text-slate-100 truncate">{k.name}</span>
                    <span className="text-[11px] text-slate-500 truncate">{k.owner} · {new Date(k.created_at * 1000).toLocaleDateString()}{k.hub ? ' · also the hub' : ''}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono truncate" title={k.fingerprint}>{k.members.length} VM{k.members.length === 1 ? '' : 's'} · {k.fingerprint}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" className={BTN_CARD_QUIET} disabled={!!busy} onClick={() => void downloadConfig(k)}>{busy === `cfg-${k.id}` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} ssh config</button>
                    {missing > 0 && <button type="button" className={BTN_CARD_QUIET} disabled={!!busy} onClick={() => void addMore(k)}>{busy === `add-${k.id}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Put it on {missing} more VM{missing === 1 ? '' : 's'}</button>}
                    <button type="button" className={`${BTN_CARD_QUIET} ${TONE_GHOST_DANGER} ml-auto`} disabled={!!busy} onClick={() => void removeKey(k)}>{busy === k.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove</button>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500 flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0" /> The private half of a key cannot be shown again. If it is lost, remove the key and make another.</p>
        </div>
      )}
    </Sheet>
  )
}
