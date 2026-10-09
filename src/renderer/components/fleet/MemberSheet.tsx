// =============================================================================
// MemberSheet — add a member by address + an account on it (a VM set up before
// the hub existed, or one the scan found), or edit an existing member: name,
// address, account, and the guest it is mapped to. Runs with the progress card.
// =============================================================================

import { useId, useState } from 'react'
import { Link2, Loader2, PlugZap } from 'lucide-react'
import { addFleetMember, updateFleetMember } from '../../api/endpoints'
import type { FleetMember, FleetMemberBase, ProxmoxVm } from '../../../shared/types'
import ProgressCard, { type ProgressLine, type ProgressState } from '../common/ProgressCard'
import { MATCH_LABEL } from './fleetShared'
import { BTN_SHEET_PRIMARY, BTN_SHEET_QUIET } from '../../lib/ui'
import { pageLabel } from '../../constants/pageTitles'

import Sheet from '../common/Sheet'
import { INPUT_FLEET, LABEL } from '../../lib/fieldStyles'
const ADD_STEPS = [
  { label: 'Reach', hint: 'the member' },
  { label: 'Sign in', hint: 'with the account' },
  { label: 'Identify', hint: 'hostname, uuid' },
  { label: 'Match', hint: 'the guest' },
  { label: 'Keep', hint: 'in the fleet' },
] as const

export interface MemberSheetPrefill {
  name?: string
  url?: string
  vmid?: number | null
  node?: string | null
  type?: 'qemu' | 'lxc' | null
}

interface Props {
  member?: FleetMemberBase | null
  prefill?: MemberSheetPrefill
  vms?: ProxmoxVm[]
  onClose: () => void
  onSaved: (m: FleetMember) => void
}

export default function MemberSheet({ member, prefill, vms = [], onClose, onSaved }: Props) {
  const editing = !!member
  const uid = useId()
  const [name, setName] = useState(member?.name ?? prefill?.name ?? '')
  const [url, setUrl] = useState(member?.url ?? prefill?.url ?? 'http://')
  const [username, setUsername] = useState(member?.username ?? 'admin')
  const [password, setPassword] = useState('')
  const [insecure, setInsecure] = useState(member?.insecure ?? false)
  const [vmKey, setVmKey] = useState<string>(() => {
    const v = member?.vmid ?? prefill?.vmid
    const n = member?.node ?? prefill?.node
    const t = member?.type ?? prefill?.type
    return v && n && t ? `${n}/${t}/${v}` : ''
  })
  const [state, setState] = useState<ProgressState>('idle')
  const [current, setCurrent] = useState(0)
  const [lines, setLines] = useState<ProgressLine[]>([])
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')
  const busy = state === 'running'
  const push = (text: string, tone?: ProgressLine['tone']) => setLines((l) => [...l, { text, tone }])

  const mapping = () => {
    if (!vmKey) return { vmid: null, node: null, type: null }
    const [node, type, vmid] = vmKey.split('/')
    return { vmid: Number(vmid), node, type }
  }

  const run = async () => {
    setErr(''); setLines([]); setState('running'); setCurrent(0)
    const u = url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^/\s]+$/.test(u)) { setErr('The address must look like http://192.168.1.50:9876'); setState('idle'); return }
    try {
      if (editing && member) {
        setStatus(`Saving ${member.name}…`); push(`Checking ${u} with the account ${username}…`)
        const body: Parameters<typeof updateFleetMember>[1] = { name: name.trim() || undefined, url: u, username: username.trim(), insecure }
        if (password) body.password = password
        // "Keep the current guest" (no choice): vmid/node/type stay out of the request — sent as null they would unmap the guest
        if (vmKey) {
          const m = mapping()
          if ((m.vmid ?? null) !== (member.vmid ?? null) || (m.node ?? null) !== (member.node ?? null) || (m.type ?? null) !== (member.type ?? null)) { body.vmid = m.vmid; body.node = m.node; body.type = m.type }
        }
        setCurrent(1)
        const r = await updateFleetMember(member.id, body)
        setCurrent(4); setState('done'); setStatus(`Saved ${r.member.name}.`); push(`Kept: ${r.member.name} at ${r.member.url}`, 'ok')
        setTimeout(() => onSaved(r.member), 400)
        return
      }
      setStatus(`Reaching ${u}…`); push(`Signing in to ${u} as ${username}…`)
      setCurrent(1)
      const m = mapping()
      const r = await addFleetMember({ url: u, username: username.trim(), password, name: name.trim() || undefined, vmid: m.vmid, node: m.node, type: m.type, insecure })
      const mm = r.member
      setCurrent(2); push(`Signed in as ${mm.username} (${mm.role || 'admin'})${mm.version ? ` — DCS ${mm.version}` : ''}`, 'ok')
      push(`Identity: ${mm.identity?.hostname || 'unknown host'}${mm.identity?.ips?.length ? ` · ${mm.identity.ips.join(', ')}` : ''}${mm.identity?.role === 'node' ? ' · a node (the API alone: this dashboard manages it)' : ''}`)
      setCurrent(3)
      if (mm.vmid) push(`Guest ${mm.vmid}${mm.node ? ` on ${mm.node}` : ''} — ${MATCH_LABEL[mm.matched_by ?? ''] ?? mm.matched_by}`, 'ok')
      else push('No guest matched: map it by hand from the member\'s menu (the hub needs the VM\'s guest agent, a shared address or the same name)', 'warn')
      setCurrent(4); setState('done'); setStatus(`${mm.name} is a member of this hub.`)
      setTimeout(() => onSaved(mm), 600)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The request failed'
      setState('failed'); setStatus(msg); push(msg, 'bad')
    }
  }

  return (
    <Sheet tone="fleet"
      title={editing ? `Edit ${member?.name}` : 'Add a member'}
      subtitle={editing ? 'Name, address, account and the guest this member runs in' : 'A DCS on another VM, reached by address with an account that exists there'}
      icon={<Link2 size={18} />}
      onClose={busy ? () => {} : onClose}
      wide
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${BTN_SHEET_QUIET} flex-1`}>{state === 'done' ? 'Close' : 'Cancel'}</button>
          <button type="button" onClick={run} disabled={busy || state === 'done' || (!editing && !password)} className={`${BTN_SHEET_PRIMARY} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />} {editing ? 'Save' : 'Link this server'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-name`} className={LABEL}>Name</label>
          <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="media-services" className={INPUT_FLEET} disabled={busy} />
        </div>
        <div>
          <label htmlFor={`${uid}-url`} className={LABEL}>API address</label>
          <input id={`${uid}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.50:9876" className={`${INPUT_FLEET} font-mono`} disabled={busy} />
        </div>
        <div>
          <label htmlFor={`${uid}-user`} className={LABEL}>Username on that server</label>
          <input id={`${uid}-user`} value={username} onChange={(e) => setUsername(e.target.value)} className={INPUT_FLEET} disabled={busy} autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${uid}-password`} className={LABEL}>Password{editing ? ' (leave empty to keep)' : ''}</label>
          <input id={`${uid}-password`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT_FLEET} disabled={busy} autoComplete="new-password" />
        </div>
        {vms.length > 0 && (
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-guest`} className={LABEL}>Runs in</label>
            <select id={`${uid}-guest`} value={vmKey} onChange={(e) => setVmKey(e.target.value)} className={INPUT_FLEET} disabled={busy}>
              <option value="">{editing ? 'Keep the current guest' : 'Let the hub match the guest'}</option>
              {vms.map((v) => <option key={`${v.node}/${v.type}/${v.vmid}`} value={`${v.node}/${v.type}/${v.vmid}`}>{v.name} · {v.type === 'qemu' ? 'VM' : 'LXC'} {v.vmid} on {v.node}</option>)}
            </select>
          </div>
        )}
        <label className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} className="accent-violet-500" disabled={busy} />
          The address uses https with a self-signed certificate
        </label>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">The password is kept in this hub's secret store. A VM can also join by itself with a join code (the Join code button on the {pageLabel('proxmox')} page) — then no account is typed here.</p>
      {err && <p role="alert" className="text-xs text-rose-300 mt-2">{err}</p>}
      {(state !== 'idle') && <ProgressCard steps={ADD_STEPS} current={current} state={state} status={status} lines={lines} className="mt-3" compact />}
    </Sheet>
  )
}
