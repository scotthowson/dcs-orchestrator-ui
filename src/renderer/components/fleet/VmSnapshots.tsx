// =============================================================================
// A guest's snapshots, on the Proxmox page: the list in its details sheet (name,
// note, age, RAM, the one it runs from) with Roll back and Delete for an admin,
// and the sheet that takes one (name, note, include RAM). The server waits for
// Proxmox, so an answer means it is done; its errors are already in words.
// =============================================================================

import { useState } from 'react'
import { Camera, Loader2, RotateCcw, Trash2, History } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { fetchProxmoxSnapshots, takeProxmoxSnapshot, rollbackProxmoxSnapshot, deleteProxmoxSnapshot } from '../../api/endpoints'
import { ApiTimeoutError } from '../../api/client'
import { apiErrorMessage } from '../../api/errors'
import type { ProxmoxSnapshot, ProxmoxVm, FleetMemberBase } from '../../../shared/types'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { Pill } from '../common/Pill'
import Hint from '../common/Hint'
import Sheet from '../common/Sheet'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { INPUT_FLEET, LABEL, HINT } from '../../lib/fieldStyles'
import { BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_DANGER, TONE_GHOST_DANGER } from '../../lib/ui'
import { ago } from './fleetShared'

const SNAP_POLL = 30_000
/** Proxmox's rule for a snapshot name */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

type Guest = Pick<ProxmoxVm, 'vmid' | 'name' | 'type' | 'status'>

function when(epoch: number | null): string {
  return epoch ? new Date(epoch * 1000).toLocaleString() : 'the snapshot was taken'
}
function nameProblem(name: string, taken: string[]): string {
  if (!name) return 'Give it a name'
  if (!/^[A-Za-z]/.test(name)) return 'Start with a letter'
  if (name.length > 40) return '40 characters at most'
  if (!NAME_RE.test(name)) return 'Letters, digits, - and _ only (no spaces)'
  if (/^(current|vzdump)$/i.test(name)) return 'Proxmox keeps that name for itself'
  if (taken.includes(name)) return 'A snapshot of that name exists already'
  return ''
}
/** a name nobody has to type: snap-20261009-1530 */
function suggestedName(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0')
  return `snap-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** The Snapshots section of a guest's details sheet */
export function SnapshotsPanel({ vm, member, isAdmin, onTake, onChanged }: {
  vm: Guest
  member?: FleetMemberBase
  isAdmin: boolean
  /** opens the sheet that takes one (the page draws it, so the row's quick action opens the same) */
  onTake: () => void
  /** after a rollback or a delete: the page reads the guests again */
  onChanged: () => void
}) {
  const list = usePolling(() => fetchProxmoxSnapshots(vm.vmid), SNAP_POLL)
  const confirm = useConfirm()
  const { addToast } = useToast()
  const [busy, setBusy] = useState('')   // "rollback:<name>" | "delete:<name>"
  const snaps = list.data?.snapshots ?? []
  const kind = vm.type === 'qemu' ? 'VM' : 'container'

  const rollback = async (s: ProxmoxSnapshot) => {
    const lost = `Everything changed since ${when(s.created_at)} on that ${kind} is lost.`
    const how = s.vmstate
      ? ` It comes back running, where it was then (its RAM was saved).`
      : vm.status === 'running' ? ` Proxmox stops it for the rollback and DCS starts it again.` : ''
    const fleet = member ? ` ${member.name} is a member of this hub: its DCS goes back too (stacks, settings and App-Data as they were), and the hub checks it again.` : ''
    if (!(await confirm({ title: `Roll ${vm.name} back to '${s.name}'?`, message: `${lost}${how}${fleet}`, confirmLabel: 'Roll back', danger: true }))) return
    setBusy(`rollback:${s.name}`)
    try {
      const r = await rollbackProxmoxSnapshot(vm.vmid, s.name)
      addToast({ type: 'success', message: r.message, duration: 9000 })
      onChanged()
    } catch (e) {
      addToast({ type: e instanceof ApiTimeoutError ? 'warning' : 'error', message: e instanceof ApiTimeoutError ? `Proxmox is still rolling ${vm.name} back: the list follows when it is done` : apiErrorMessage(e, 'The rollback failed'), duration: 12000 })
    } finally { setBusy(''); list.refresh() }
  }
  const remove = async (s: ProxmoxSnapshot) => {
    if (!(await confirm({ title: `Delete the snapshot '${s.name}'?`, message: `${vm.name} stays as it is now; only the way back to ${when(s.created_at)} is gone.`, confirmLabel: 'Delete snapshot', danger: true }))) return
    setBusy(`delete:${s.name}`)
    try {
      const r = await deleteProxmoxSnapshot(vm.vmid, s.name)
      addToast({ type: 'success', message: r.message })
    } catch (e) {
      addToast({ type: e instanceof ApiTimeoutError ? 'warning' : 'error', message: e instanceof ApiTimeoutError ? `Proxmox is still deleting '${s.name}': the list follows when it is done` : apiErrorMessage(e, 'The snapshot was not deleted'), duration: 9000 })
    } finally { setBusy(''); list.refresh() }
  }

  return (
    <section aria-label="Snapshots" className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300 min-w-0">
          <History size={12} className="shrink-0" /> Snapshots
          {list.data && <span className="text-slate-500 font-normal tabular-nums">· {list.data.total}</span>}
          {list.data?.current && <span className="text-slate-500 font-normal truncate">· runs from {list.data.current}</span>}
        </span>
        {isAdmin && <button type="button" onClick={onTake} disabled={!!busy} className={BTN_CARD_QUIET}><Camera size={12} /> Take snapshot</button>}
      </div>
      <div className="mt-2.5">
        {list.error && !list.data ? (
          <ErrorState card title="Could not read the snapshots" error={list.error} onRetry={() => list.refresh()} />
        ) : !list.data ? (
          <Skeleton rows={2} label="Reading the snapshots" />
        ) : snaps.length === 0 ? (
          <EmptyState card icon={<History size={22} />} title="No snapshots yet"
            hint={isAdmin ? 'Take one before an upgrade or a big change: rolling back to it brings the guest back to that moment.' : 'An admin takes them from here.'} />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {[...snaps].reverse().map((s) => {
              const rolling = busy === `rollback:${s.name}`, deleting = busy === `delete:${s.name}`
              return (
                <li key={s.name} className="py-2 flex items-start gap-2.5 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-xs font-medium text-slate-100 font-mono break-all">{s.name}</span>
                      {s.current && <Pill tone="ok" dot title="The guest runs from this snapshot">current</Pill>}
                      {s.vmstate && <Pill tone="fleet" title="The VM's RAM was saved with it: a rollback brings it back running">RAM</Pill>}
                      <Hint label={when(s.created_at)}><span className="text-[11px] text-slate-500 tabular-nums">{s.created_at ? ago(s.created_at) : ''}</span></Hint>
                    </div>
                    {s.description && <p className="text-[11px] text-slate-400 mt-0.5 whitespace-pre-line break-words">{s.description}</p>}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => void rollback(s)} disabled={!!busy} aria-label={`Roll back to ${s.name}`} className={`${BTN_CARD} ${TONE_DANGER}`}>
                        {rolling ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} <span className="hidden sm:inline">{rolling ? 'Rolling back…' : 'Roll back'}</span>
                      </button>
                      <Hint label={`Delete ${s.name}`}>
                        <button type="button" onClick={() => void remove(s)} disabled={!!busy} aria-label={`Delete ${s.name}`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
                          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </Hint>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Take a snapshot: a name, a note and, for a running VM, its RAM too */
export function TakeSnapshotSheet({ vm, onClose, onTaken }: { vm: Guest; onClose: () => void; onTaken: () => void }) {
  const { addToast } = useToast()
  const existing = usePolling(() => fetchProxmoxSnapshots(vm.vmid), SNAP_POLL)
  const [name, setName] = useState(suggestedName)
  const [note, setNote] = useState('')
  const [ram, setRam] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canRam = existing.data ? existing.data.can_save_ram : vm.type === 'qemu' && vm.status === 'running'
  const problem = nameProblem(name.trim(), (existing.data?.snapshots ?? []).map((s) => s.name))
  const submit = async () => {
    if (busy || problem) return
    setBusy(true); setError('')
    try {
      const r = await takeProxmoxSnapshot(vm.vmid, { name: name.trim(), ...(note.trim() ? { description: note.trim() } : {}), vmstate: canRam && ram })
      addToast({ type: 'success', message: r.message, duration: 6000 })
      onTaken(); onClose()
    } catch (e) {
      if (e instanceof ApiTimeoutError) { addToast({ type: 'warning', message: `Proxmox is still taking '${name.trim()}': it shows in the list when it is done`, duration: 9000 }); onTaken(); onClose(); return }
      setError(apiErrorMessage(e, 'The snapshot was not taken'))
    } finally { setBusy(false) }
  }
  const kind = vm.type === 'qemu' ? 'VM' : 'container'
  return (
    <Sheet tone="fleet" title={`Snapshot of ${vm.name}`} subtitle={`${kind} ${vm.vmid} · a way back to this moment`} icon={<Camera size={18} />} onClose={busy ? () => {} : onClose} keepOnBackdrop={busy}
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !!problem} className={`${BTN_SHEET_PRIMARY} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {busy ? 'Taking the snapshot…' : 'Take snapshot'}
          </button>
        </div>
      }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div>
          <label htmlFor="snap-name" className={LABEL}>Name</label>
          <input id="snap-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy}
            aria-invalid={!!problem} aria-describedby="snap-name-help" className={`${INPUT_FLEET} font-mono`} placeholder="before-upgrade" />
          <p id="snap-name-help" className={`${HINT} ${problem && name ? 'text-rose-300' : ''}`}>{problem && name ? problem : 'A letter first, then letters, digits, - and _ (40 at most), like before-upgrade.'}</p>
        </div>
        <div>
          <label htmlFor="snap-note" className={LABEL}>Note <span className="text-slate-500 font-normal">(optional)</span></label>
          <textarea id="snap-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} disabled={busy} className={`${INPUT_FLEET} resize-y`} placeholder="Before the Jellyfin 11 update" />
        </div>
        <ToggleRow id="snap-ram" label="Include RAM" checked={canRam && ram} onChange={setRam} disabled={busy || !canRam}
          help={canRam
            ? 'Saves what the VM has in memory too: a rollback brings it back running, exactly where it was. Takes longer and needs room for the memory on the storage.'
            : vm.type === 'qemu' ? 'The VM is not running, so there is no memory to save: the snapshot holds its disks.' : 'A container snapshot holds its disks only.'} />
        {error && <Notice tone="problem" role="alert" title="The snapshot was not taken">{error}</Notice>}
      </form>
    </Sheet>
  )
}
