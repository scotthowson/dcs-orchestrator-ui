// =============================================================================
// Host folders — folders of the Proxmox host inside a VM of the fleet, so its
// containers read (and write) data that lives outside the VM's own disk: a
// media library for Jellyfin, Sonarr and Radarr, say. The hub does every step
// (the mapping on Proxmox, the virtiofs device on the VM, the VM's fstab, the
// restart, the mount, the containers that use it) and this sheet follows them:
// what the VM has, share one more, mount, hand it to a container, take it away.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderInput, FolderPlus, Loader2, Check, X, Minus, AlertTriangle, HardDrive, Trash2, Container, RefreshCw, Circle } from 'lucide-react'
import { useToast } from '../common/Toast'
import { fetchMemberFolders, fetchMemberFolderOperation, shareMemberFolder, removeMemberFolder, mountMemberFolder, attachMemberFolder } from '../../api/endpoints'
import type { FleetMemberBase, MemberFolders, HostFolder, HostFolderOperation } from '../../../shared/types'
import { BTN_SHEET, BTN_SHEET_PRIMARY, BTN_SHEET_DANGER, BTN_CARD, BTN_CARD_QUIET, TONE_QUIET, TONE_OK, TONE_DANGER, TONE_ATTN } from '../../lib/ui'
import { CopyButton } from '../common/CopyButton'
import Sheet from '../common/Sheet'
import { INPUT_FLEET, LABEL } from '../../lib/fieldStyles'
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,35}$/
const MOUNT_RE = /^\/(mnt|srv|media|data)(\/[A-Za-z0-9_-]+)+$/
const HOST_PATH_RE = /^\/[A-Za-z0-9/._@+-]+$/
const TARGET_RE = /^\/[A-Za-z0-9/._-]+$/
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)
const checkCls = 'h-4 w-4 rounded border-white/20 bg-slate-800 accent-emerald-500 shrink-0'

function StepIcon({ state }: { state: string }) {
  if (state === 'running') return <Loader2 size={14} className="animate-spin text-sky-300 shrink-0" />
  if (state === 'done') return <Check size={14} className="text-emerald-400 shrink-0" />
  if (state === 'failed') return <X size={14} className="text-rose-400 shrink-0" />
  if (state === 'skipped') return <Minus size={14} className="text-slate-600 shrink-0" />
  return <Circle size={10} className="text-slate-600 shrink-0 mx-0.5" />
}

/** the steps of the change under way, or how the last one ended */
function OperationCard({ op, onDismiss }: { op: HostFolderOperation; onDismiss?: () => void }) {
  const tone = op.state === 'failed' ? 'border-rose-500/25 bg-rose-500/[0.06]' : op.state === 'done' ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-sky-500/20 bg-sky-500/[0.05]'
  return (
    <div role="status" aria-live="polite" className={`rounded-xl border ${tone} p-3 space-y-2`}>
      <div className="flex items-center gap-2 text-sm text-slate-200">
        {op.state === 'running' ? <Loader2 size={15} className="animate-spin text-sky-300" /> : op.state === 'done' ? <Check size={15} className="text-emerald-400" /> : <AlertTriangle size={15} className="text-rose-400" />}
        <span className="font-medium min-w-0 truncate">{op.action === 'add' ? 'Sharing' : 'Removing'} <span className="font-mono">{op.folder}</span>{op.state === 'done' ? ' — done' : op.state === 'failed' ? ' — stopped' : '…'}</span>
        <span className="flex-1" />
        {onDismiss && op.state !== 'running' && <button type="button" onClick={onDismiss} aria-label="Hide these steps" className="text-slate-500 hover:text-slate-300"><X size={14} /></button>}
      </div>
      <ol className="space-y-1">
        {op.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            <span className="h-4 flex items-center"><StepIcon state={s.state} /></span>
            <span className={`min-w-0 ${s.state === 'pending' || s.state === 'skipped' ? 'text-slate-500' : 'text-slate-300'}`}>{s.label}{s.detail ? <span className="text-slate-500"> — {s.detail}</span> : null}</span>
          </li>
        ))}
      </ol>
      {op.error && <p className="text-xs text-rose-200 break-words">{op.error}</p>}
      {op.note && <p className="text-xs text-slate-300 break-words">{op.note}</p>}
    </div>
  )
}

function FolderState({ f, vmRunning }: { f: HostFolder; vmRunning: boolean }) {
  const chip = 'px-1.5 py-0.5 rounded-md text-[10px] font-medium border'
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {f.removing ? <span className={`${chip} border-amber-500/25 bg-amber-500/10 text-amber-200`}>goes at the next restart</span>
        : f.mounted ? <span className={`${chip} border-emerald-500/25 bg-emerald-500/10 text-emerald-300`}>mounted</span>
        : f.pending ? <span className={`${chip} border-amber-500/25 bg-amber-500/10 text-amber-200`}>waits for a VM restart</span>
        : !vmRunning ? <span className={`${chip} border-white/10 bg-white/5 text-slate-400`}>VM is off</span>
        : <span className={`${chip} border-amber-500/25 bg-amber-500/10 text-amber-200`}>not mounted</span>}
      {f.readonly && <span className={`${chip} border-white/10 bg-white/5 text-slate-400`}>read-only</span>}
    </span>
  )
}

/** one volume line more on a service of one of the VM's stacks */
function UseForm({ member, folder, data, onDone, onCancel }: { member: FleetMemberBase; folder: HostFolder; data: MemberFolders; onDone: (msg: string) => void; onCancel: () => void }) {
  const stacks = Object.keys(data.services ?? {}).filter((s) => (data.services?.[s] ?? []).length > 0)
  const [stack, setStack] = useState(stacks[0] ?? '')
  const services = data.services?.[stack] ?? []
  const [service, setService] = useState(services[0] ?? '')
  const [target, setTarget] = useState(`/${folder.id}`)
  const [sub, setSub] = useState('')
  const [ro, setRo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (!services.includes(service)) setService(services[0] ?? '') }, [stack]) // eslint-disable-line react-hooks/exhaustive-deps
  const ok = !!stack && !!service && TARGET_RE.test(target)
  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const r = await attachMemberFolder(member.id, folder.id, { stack, service, target, subfolder: sub.trim() || undefined, readonly: ro })
      onDone(r.message)
    } catch (e) { setErr(errText(e, 'The container could not be given the folder')) } finally { setBusy(false) }
  }
  if (stacks.length === 0) return <p className="text-xs text-slate-400">The hub has no compose file of this VM’s stacks yet: deploy a stack into the VM first (or press “Sync stack files from the VM” in its menu).</p>
  return (
    <div role="group" aria-label={`Use ${folder.id} in a container`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`hf-stack-${folder.id}`} className={LABEL}>Stack</label>
          <select id={`hf-stack-${folder.id}`} value={stack} onChange={(e) => setStack(e.target.value)} className={INPUT_FLEET}>{stacks.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div>
          <label htmlFor={`hf-svc-${folder.id}`} className={LABEL}>Container (service)</label>
          <select id={`hf-svc-${folder.id}`} value={service} onChange={(e) => setService(e.target.value)} className={INPUT_FLEET}>{services.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <div>
          <label htmlFor={`hf-target-${folder.id}`} className={LABEL}>Path inside the container</label>
          <input id={`hf-target-${folder.id}`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="/media" spellCheck={false} autoComplete="off" className={`${INPUT_FLEET} font-mono`} />
        </div>
        <div>
          <label htmlFor={`hf-sub-${folder.id}`} className={LABEL}>Only a subfolder (optional)</label>
          <input id={`hf-sub-${folder.id}`} value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Movies" spellCheck={false} autoComplete="off" className={`${INPUT_FLEET} font-mono`} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={ro} onChange={(e) => setRo(e.target.checked)} className={checkCls} /> Read-only for this container (enough for Jellyfin; Sonarr and Radarr need to write)</label>
      <p className="text-[11px] text-slate-500 font-mono break-all">{folder.mount}{sub.trim() ? `/${sub.trim().replace(/^\/+|\/+$/g, '')}` : ''}:{target || '…'}{ro ? ':ro' : ''}</p>
      {err && <p className="text-xs text-rose-300 break-words">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={`${BTN_CARD_QUIET}`}>Cancel</button>
        <button type="button" onClick={submit} disabled={!ok || busy} className={`${BTN_CARD} ${TONE_OK}`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Container size={12} />} Add the volume and restart the stack</button>
      </div>
    </div>
  )
}

export default function HostFoldersSheet({ member, onClose }: { member: FleetMemberBase; onClose: () => void }) {
  const { addToast } = useToast()
  const [data, setData] = useState<MemberFolders | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [op, setOp] = useState<HostFolderOperation | null>(null)
  const [opHidden, setOpHidden] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [using, setUsing] = useState('')
  const [removing, setRemoving] = useState('')
  const [rmRestart, setRmRestart] = useState(true)
  const [rmMapping, setRmMapping] = useState(false)
  // the share form
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')          // an existing mapping's id, or '' for a new folder
  const [name, setName] = useState('media')
  const [path, setPath] = useState('')
  const [mount, setMount] = useState('')
  const [ro, setRo] = useState(false)
  const [restart, setRestart] = useState(true)
  const alive = useRef(true)
  const first = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    try {
      const d = await fetchMemberFolders(member.id)
      if (!alive.current) return
      setData(d); setOp(d.operation); setLoadErr('')
      // steps that ended before the sheet was opened are old news
      if (first.current) { first.current = false; if (d.operation && d.operation.state !== 'running') setOpHidden(d.operation.id) }
    } catch (e) { if (alive.current) setLoadErr(errText(e, 'Could not read the folders of this VM')) } finally { if (alive.current) setLoading(false) }
  }, [member.id])
  useEffect(() => { void load() }, [load])

  // while steps are under way: follow them, then read everything again
  const running = op?.state === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(async () => {
      try {
        const r = await fetchMemberFolderOperation(member.id)
        if (!alive.current) return
        setOp(r.operation)
        if (r.operation?.state !== 'running') {
          if (r.operation?.state === 'done') addToast({ type: 'success', message: `${member.name}: ${r.operation.action === 'add' ? 'shared' : 'removed'} ${r.operation.folder}` })
          else if (r.operation?.state === 'failed') addToast({ type: 'error', message: `${member.name}: ${r.operation.error || 'the steps stopped'}`, duration: 9000 })
          void load()
        }
      } catch { /* the hub's API restarts with the VM when the hub is the VM's neighbour: keep asking */ }
    }, 2000)
    return () => clearInterval(t)
  }, [running, member.id, member.name, addToast, load])

  const vmRunning = data?.vm_status === 'running'
  const attached = new Set((data?.folders ?? []).map((f) => f.id))
  const free = (data?.mappings ?? []).filter((m) => !attached.has(m.id))
  const canShare = !!data?.supported && !!data.can?.attach && (pick ? true : !!data.can?.create)
  const effName = pick || name.trim()
  const effMount = mount.trim() || (effName ? `/mnt/${effName}` : '')
  const nameTaken = !pick && (data?.mappings ?? []).some((m) => m.id === effName)
  const formOk = NAME_RE.test(effName) && !attached.has(effName) && MOUNT_RE.test(effMount) && (pick ? true : HOST_PATH_RE.test(path.trim()) && !nameTaken)

  const share = async () => {
    setBusy('share'); setErr('')
    try {
      const r = await shareMemberFolder(member.id, { name: effName, path: pick ? undefined : path.trim().replace(/\/+$/, ''), mount: effMount, readonly: ro, restart: vmRunning ? restart : false })
      setOp(r.operation); setOpHidden(''); setAdding(false)
    } catch (e) { setErr(errText(e, 'The folder could not be shared')) } finally { setBusy('') }
  }
  const doMount = async (f: HostFolder) => {
    setBusy(`mount:${f.id}`); setErr('')
    try { const r = await mountMemberFolder(member.id, f.id); addToast({ type: 'success', message: `${member.name}: ${r.message}` }); await load() }
    catch (e) { setErr(errText(e, 'The folder could not be mounted')) } finally { setBusy('') }
  }
  const doRemove = async (f: HostFolder) => {
    setBusy(`remove:${f.id}`); setErr('')
    try {
      const r = await removeMemberFolder(member.id, f.id, { restart: vmRunning ? rmRestart : false, mapping: rmMapping })
      setOp(r.operation); setOpHidden(''); setRemoving('')
    } catch (e) { setErr(errText(e, 'The folder could not be removed')) } finally { setBusy('') }
  }
  const pveum = data?.hint ? /pveum .*$/.exec(data.hint)?.[0] ?? '' : ''
  const locked = running || !!busy

  return (
    <Sheet tone="fleet" wide title="Host folders" subtitle={`${member.name} · folders of the Proxmox host inside this VM, for its containers`} icon={<FolderInput size={18} />} onClose={onClose}>
      <div className="space-y-3">
        {loading && <p className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Asking Proxmox and the VM…</p>}
        {!loading && loadErr && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 text-xs text-rose-200 space-y-2">
            <p className="break-words">{loadErr}</p>
            <button type="button" onClick={() => { setLoading(true); void load() }} className={BTN_CARD_QUIET}><RefreshCw size={12} /> Try again</button>
          </div>
        )}
        {data && !data.supported && <p className="text-sm text-slate-300 rounded-xl border border-white/10 bg-white/[0.03] p-3">{data.reason || 'This member is not a Proxmox VM the hub knows.'}</p>}
        {op && op.id !== opHidden && <OperationCard op={op} onDismiss={() => setOpHidden(op.id)} />}
        {err && <p role="alert" className="text-xs text-rose-200 rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 break-words">{err}</p>}

        {data?.supported && (
          <>
            {data.hint && (
              <div className={`rounded-xl p-3 text-xs space-y-2 ${TONE_ATTN} hover:bg-amber-500/10`}>
                <p className="flex items-start gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>The Proxmox API token lacks {data.missing?.join(', ') || 'a permission'}. It needs the role <span className="font-semibold">PVEMappingAdmin</span> on <span className="font-mono">/mapping/dir</span> (Datacenter → Permissions → Add), or run this on the Proxmox host:</span></p>
                {pveum && <div className="flex items-center gap-2 flex-wrap"><code className="font-mono text-[11px] text-amber-100 break-all min-w-0">{pveum}</code><CopyButton variant="chip" text={pveum} label="Copy" /></div>}
              </div>
            )}
            {data.restart_needed && !running && (
              <p className="text-xs text-amber-200 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">A change waits for the VM to be shut down and started again (a reboot from inside the VM is not enough): use Shutdown and Start on its card.</p>
            )}

            {data.folders.length === 0 && !adding && (
              <p className="text-sm text-slate-400 py-2">This VM has no folder of the host yet. Share one and its containers can use data that lives on the Proxmox host’s own drives, without filling the VM’s disk.</p>
            )}
            <ul className="space-y-2">
              {data.folders.map((f) => (
                <li key={f.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <div className="flex items-start gap-2 flex-wrap">
                    <HardDrive size={15} className="text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100 font-medium flex items-center gap-2 flex-wrap"><span className="font-mono">{f.id}</span><FolderState f={f} vmRunning={vmRunning} /></p>
                      <p className="text-[11px] text-slate-400 font-mono break-all">{f.host_path || 'a mapping this token cannot read'} <span className="text-slate-600">on the host →</span> {f.mount || 'not mounted'} <span className="text-slate-600">in the VM</span></p>
                    </div>
                  </div>
                  {f.used_by.length > 0 && (
                    <ul className="text-[11px] text-slate-400 space-y-0.5 pl-6">
                      {f.used_by.map((u) => <li key={`${u.stack}/${u.service}/${u.target}`} className="break-all"><span className="text-slate-200">{u.stack} / {u.service}</span> <span className="font-mono">{u.source} → {u.target}{u.readonly ? ' (ro)' : ''}</span></li>)}
                    </ul>
                  )}
                  {!f.removing && (
                    <div className="flex items-center gap-1.5 flex-wrap pl-6">
                      {!f.mounted && vmRunning && !f.pending && <button type="button" onClick={() => doMount(f)} disabled={locked} className={`${BTN_CARD} ${TONE_OK}`}>{busy === `mount:${f.id}` ? <Loader2 size={12} className="animate-spin" /> : <HardDrive size={12} />} Mount</button>}
                      {f.mount && <button type="button" onClick={() => { setUsing(using === f.id ? '' : f.id); setRemoving('') }} disabled={locked} aria-expanded={using === f.id} className={BTN_CARD_QUIET}><Container size={12} /> Use in a container</button>}
                      <button type="button" onClick={() => { setRemoving(removing === f.id ? '' : f.id); setUsing(''); setRmRestart(true); setRmMapping(false) }} disabled={locked} aria-expanded={removing === f.id} className={`${BTN_CARD} ${TONE_DANGER}`}><Trash2 size={12} /> Remove</button>
                    </div>
                  )}
                  {using === f.id && <UseForm member={member} folder={f} data={data} onCancel={() => setUsing('')} onDone={(msg) => { setUsing(''); if (op && op.state !== 'running') setOpHidden(op.id); addToast({ type: 'success', message: `${member.name}: ${msg}`, duration: 6000 }); void load() }} />}
                  {removing === f.id && (
                    <div role="group" aria-label={`Remove ${f.id} from the VM`} className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 space-y-2 animate-fade-in">
                      <p className="text-xs text-rose-100">Take <span className="font-mono">{f.id}</span> from this VM? Nothing is deleted on the host.{f.used_by.length > 0 ? ` ${f.used_by.length === 1 ? 'One container still names' : `${f.used_by.length} containers still name`} it in a compose file: it will see an empty folder.` : ''}</p>
                      {vmRunning && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={rmRestart} onChange={(e) => setRmRestart(e.target.checked)} className={checkCls} /> Restart the VM now so the device is gone (its containers stop for about a minute)</label>}
                      {data.can?.create && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={rmMapping} onChange={(e) => setRmMapping(e.target.checked)} className={checkCls} /> Also remove the mapping from Proxmox (when no other VM uses it)</label>}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setRemoving('')} disabled={!!busy} className={BTN_CARD_QUIET}>Cancel</button>
                        <button type="button" onClick={() => doRemove(f)} disabled={locked} className={`${BTN_CARD} ${TONE_DANGER}`}>{busy === `remove:${f.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove from the VM</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {!adding ? (
              <button type="button" onClick={() => { setAdding(true); setPick(free[0]?.id ?? ''); setErr(''); if ((data.mappings ?? []).some((m) => m.id === name.trim())) setName('') }} disabled={locked || !data.can?.attach} className={`${BTN_SHEET} ${TONE_OK} w-full`}><FolderPlus size={16} /> Share a folder of the host</button>
            ) : (
              <div role="group" aria-label="Share a folder of the host" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-3 animate-fade-in">
                {free.length > 0 && (
                  <div>
                    <label htmlFor="hf-pick" className={LABEL}>Folder</label>
                    <select id="hf-pick" value={pick} onChange={(e) => setPick(e.target.value)} className={INPUT_FLEET}>
                      {free.map((m) => <option key={m.id} value={m.id}>{m.id} — {m.path}</option>)}
                      {data.can?.create && <option value="">A new folder…</option>}
                    </select>
                  </div>
                )}
                {!pick && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="hf-name" className={LABEL}>Name</label>
                      <input id="hf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="media" spellCheck={false} autoComplete="off" className={`${INPUT_FLEET} font-mono`} />
                      {name && !NAME_RE.test(name.trim()) && <p className="text-[11px] text-rose-300 mt-1">A letter, then letters, digits, - or _</p>}
                      {(nameTaken || attached.has(effName)) && <p className="text-[11px] text-rose-300 mt-1">Proxmox already has a folder with this name</p>}
                    </div>
                    <div>
                      <label htmlFor="hf-path" className={LABEL}>Folder on the Proxmox host</label>
                      <input id="hf-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/mnt/media" spellCheck={false} autoComplete="off" className={`${INPUT_FLEET} font-mono`} />
                      {path && !HOST_PATH_RE.test(path.trim()) && <p className="text-[11px] text-rose-300 mt-1">An absolute path without spaces or commas</p>}
                    </div>
                    {data.suggestions.length > 0 && (
                      <p className="sm:col-span-2 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">Storage on the host:
                        {data.suggestions.map((s) => <button key={s} type="button" onClick={() => setPath(s)} className="px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 font-mono">{s}</button>)}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <label htmlFor="hf-mount" className={LABEL}>Where the VM mounts it</label>
                  <input id="hf-mount" value={mount} onChange={(e) => setMount(e.target.value)} placeholder={effName ? `/mnt/${effName}` : '/mnt/media'} spellCheck={false} autoComplete="off" className={`${INPUT_FLEET} font-mono`} />
                  {mount.trim() && !MOUNT_RE.test(mount.trim()) && <p className="text-[11px] text-rose-300 mt-1">Below /mnt, /srv, /media or /data — letters, digits, - and _</p>}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={ro} onChange={(e) => setRo(e.target.checked)} className={checkCls} /> Read-only for the whole VM (leave off when Sonarr or Radarr must write)</label>
                {vmRunning
                  ? <label className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} className={`${checkCls} mt-0.5`} /><span>Restart the VM now — a new folder only appears after a full stop and start; its containers are down for about a minute. Off: it mounts by itself the next time you shut the VM down and start it.</span></label>
                  : <p className="text-xs text-slate-400">The VM is off: the folder is there at its next start. Press Mount here afterwards.</p>}
                {!canShare && <p className="text-xs text-amber-200">The token may not {pick ? 'give a folder to a VM' : 'make a new mapping'} yet (see above).</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAdding(false)} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} flex-1`}>Cancel</button>
                  <button type="button" onClick={share} disabled={!formOk || !canShare || locked} className={`${vmRunning && restart ? BTN_SHEET_DANGER : BTN_SHEET_PRIMARY} flex-[2]`}>{busy === 'share' ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />} {vmRunning && restart ? 'Share and restart the VM' : 'Share'}</button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-500">Shared with virtiofs (Proxmox 8.4 or newer): the VM reads the host’s folder directly, nothing is copied. The folder must already exist on the Proxmox host — a drive mounted there, or a ZFS dataset.</p>
          </>
        )}
      </div>
    </Sheet>
  )
}
