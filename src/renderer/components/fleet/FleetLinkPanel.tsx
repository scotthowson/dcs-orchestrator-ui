// =============================================================================
// FleetLinkPanel — the hub side of the fleet, driven by the progress card:
// connect to Proxmox → check the token → take the inventory → scan the guests
// for DCS installs → show what was found, with one-click "Link" for installs
// and the join code for VMs that have none. Used by the setup wizard (with the
// Proxmox values typed there, before they are saved) and by the Proxmox page.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@mantine/core'
import { Radar, Loader2, Link2, CheckCircle2, Server, RefreshCw } from 'lucide-react'
import { proxmoxTest, runFleetDiscover, fetchFleetMembers } from '../../api/endpoints'
import type { FleetGuestScan, FleetMember, ProxmoxStatus, ProxmoxVm } from '../../../shared/types'
import ProgressCard, { type ProgressLine, type ProgressState } from '../common/ProgressCard'
import MemberSheet, { type MemberSheetPrefill } from './MemberSheet'
import JoinCodeCard from './JoinCodeCard'
import { BTN_CARD, BTN_CARD_QUIET, TONE_ATTN } from '../../lib/ui'
import { pageLabel } from '../../constants/pageTitles'

const STEPS = [
  { label: 'Connect', hint: 'Proxmox API' },
  { label: 'Token', hint: 'privileges' },
  { label: 'Inventory', hint: 'nodes, guests' },
  { label: 'Scan', hint: 'DCS on the VMs' },
  { label: 'Members', hint: 'linked' },
  { label: 'Ready', hint: '' },
] as const

export interface PveValues { url: string; token_id: string; token_secret: string; verify_tls: boolean }

interface Props {
  /** Proxmox values to use before they are saved (the wizard); omitted = the saved link */
  pve?: PveValues
  autoRun?: boolean
  showJoinCode?: boolean
  compact?: boolean
  /** Guests known to the page, for the member sheet's "runs in" list */
  vms?: ProxmoxVm[]
  onChanged?: () => void
}

export default function FleetLinkPanel({ pve, autoRun = true, showJoinCode = true, compact = false, vms, onChanged }: Props) {
  const [state, setState] = useState<ProgressState>('idle')
  const [current, setCurrent] = useState(0)
  const [status, setStatus] = useState('')
  const [lines, setLines] = useState<ProgressLine[]>([])
  const [guests, setGuests] = useState<FleetGuestScan[]>([])
  const [members, setMembers] = useState<FleetMember[]>([])
  const [linking, setLinking] = useState<MemberSheetPrefill | null>(null)
  const push = useCallback((text: string, tone?: ProgressLine['tone']) => setLines((l) => [...l, { text, tone }]), [])

  const run = useCallback(async () => {
    setState('running'); setCurrent(0); setLines([]); setGuests([])
    setStatus(`Connecting to ${pve?.url || 'Proxmox'}…`)
    let st: ProxmoxStatus
    try {
      st = await proxmoxTest(pve ? { url: pve.url, token_id: pve.token_id, token_secret: pve.token_secret, verify_tls: pve.verify_tls } : {})
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The connection failed'
      setState('failed'); setStatus(msg); push(msg, 'bad'); return
    }
    if (!st.reachable) {
      const msg = st.error || st.hints?.[0] || 'Proxmox did not answer'
      const tokenProblem = /token|privilege|permission|403|401/i.test(msg)
      setCurrent(tokenProblem ? 1 : 0); setState('failed'); setStatus(msg); push(msg, 'bad')
      // the hints repeat the error itself on some failures: only the extra ones are worth a line
      for (const h of [...new Set(st.hints ?? [])]) { if (h !== msg) push(h, 'muted') }
      return
    }
    push(`Proxmox VE ${st.version} answered at ${st.url || pve?.url || ''}`, 'ok')
    setCurrent(1); setStatus('Checking the token…')
    push(`Token ${st.token_id || pve?.token_id || ''} accepted (VM.Audit, VM.PowerMgmt, Sys.Audit)`, 'ok')
    setCurrent(2); setStatus('Taking the inventory…')
    push(`${st.nodes_online ?? st.nodes}/${st.nodes} node${st.nodes === 1 ? '' : 's'} online · ${st.vms.total} guest${st.vms.total === 1 ? '' : 's'} (${st.vms.running} running)`)
    setCurrent(3); setStatus('Scanning the running guests for DCS installs…')
    let scan
    try {
      scan = await runFleetDiscover(pve)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'The scan failed'
      setState('failed'); setStatus(msg); push(msg, 'bad'); return
    }
    if (scan.error) { setState('failed'); setStatus(scan.error); push(scan.error, 'bad'); return }
    setGuests(scan.guests)
    for (const g of scan.guests) {
      const kind = g.type === 'qemu' ? 'VM' : 'LXC'
      if (g.member) push(`${g.name} (${kind} ${g.vmid}): linked as ${g.member.name}`, 'ok')
      else if (g.dcs) push(`${g.name} (${kind} ${g.vmid}): DCS ${g.dcs.version} answers at ${g.dcs.ip}:${g.dcs.port}`, 'ok')
      else if (g.status !== 'running') push(`${g.name} (${kind} ${g.vmid}): ${g.status}`, 'muted')
      else if (g.ips.length === 0) push(`${g.name} (${kind} ${g.vmid}): address unknown — ${g.type === 'qemu' ? 'install the QEMU guest agent in the VM' : 'the container reports no address'}`, 'warn')
      else push(`${g.name} (${kind} ${g.vmid}): no DCS at ${g.ips.join(', ')} — join it with the code below`, 'muted')
    }
    push(`${scan.found} DCS install${scan.found === 1 ? '' : 's'} found on ${scan.scanned} guest${scan.scanned === 1 ? '' : 's'}`)
    setCurrent(4); setStatus('Reading the members…')
    try {
      const m = await fetchFleetMembers()
      setMembers(m.members)
      push(m.total === 0 ? 'No member linked yet' : `${m.total} member${m.total === 1 ? '' : 's'} linked: ${m.members.map((x) => x.name).join(', ')}`, m.total ? 'ok' : 'muted')
    } catch { setMembers([]) }
    setCurrent(5); setState('done')
    const unlinked = scan.guests.filter((g) => g.dcs && !g.member).length
    setStatus(unlinked > 0 ? `Ready — ${unlinked} install${unlinked === 1 ? '' : 's'} can be linked now.` : scan.found === 0 ? 'Ready — no DCS answered on the guests yet; use the join code on each VM.' : 'Ready — every DCS found is linked.')
  }, [pve, push])

  // once per mount: the wizard hands in a fresh pve object on every render
  const ranRef = useRef(false)
  useEffect(() => { if (autoRun && !ranRef.current) { ranRef.current = true; void run() } }, [autoRun, run])

  const vmList: ProxmoxVm[] = vms ?? guests.map((g) => ({ vmid: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status, cpu: 0, maxcpu: 0, mem: 0, maxmem: 0, mem_pct: 0, disk: 0, maxdisk: 0, uptime: 0, tags: [], lock: '', hastate: '', intended: false }))
  const linkable = guests.filter((g) => g.dcs && !g.member)
  const linked = guests.filter((g) => g.member)
  const others = guests.filter((g) => !g.dcs && !g.member)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-400 flex items-center gap-2"><Radar size={13} className="text-violet-300" /> The hub asks Proxmox for each guest's addresses and looks for a DCS API there.</div>
        <button type="button" onClick={() => void run()} disabled={state === 'running'} className={BTN_CARD_QUIET}>
          {state === 'running' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {state === 'idle' ? 'Scan the VMs' : 'Scan again'}
        </button>
      </div>
      {state !== 'idle' && <ProgressCard steps={STEPS} current={current} state={state} status={status} lines={lines} compact={compact} />}
      {state === 'done' && guests.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] divide-y divide-white/[0.04]">
          {[...linkable, ...linked, ...others].map((g) => {
            const kind = g.type === 'qemu' ? 'VM' : 'LXC'
            return (
              <div key={`${g.node}/${g.type}/${g.vmid}`} className="flex items-center gap-3 px-3 py-2">
                <Server size={13} className={g.member ? 'text-emerald-400' : g.dcs ? 'text-amber-400' : 'text-slate-600'} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 truncate">{g.name} <span className="text-slate-500 font-normal">· {kind} {g.vmid} · {g.node}</span></p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {g.member ? `Linked as ${g.member.name} · ${g.member.url}` : g.dcs ? `DCS ${g.dcs.version} at ${g.dcs.url}` : g.status !== 'running' ? g.status : g.ips.length ? `${g.ips.join(', ')} · no DCS answered` : 'address unknown (no guest agent)'}
                  </p>
                </div>
                {g.member ? (
                  <Badge component="span" color="emerald" leftSection={<CheckCircle2 size={10} />}>linked</Badge>
                ) : g.dcs ? (
                  <button type="button" onClick={() => setLinking({ name: g.name, url: g.dcs!.url, vmid: g.vmid, node: g.node, type: g.type })} className={`${BTN_CARD} ${TONE_ATTN} font-medium`}>
                    <Link2 size={12} /> Link
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {showJoinCode && state === 'done' && <JoinCodeCard compact={compact} />}
      {linking && (
        <MemberSheet prefill={linking} vms={vmList} onClose={() => setLinking(null)} onSaved={(m) => {
          setLinking(null)
          setMembers((ms) => [...ms.filter((x) => x.id !== m.id), m])
          setGuests((gs) => gs.map((g) => (g.vmid === m.vmid || (g.dcs && g.dcs.url === m.url) ? { ...g, member: { id: m.id, name: m.name, url: m.url } } : g)))
          push(`Linked ${m.name} (${m.url})${m.vmid ? ` — guest ${m.vmid}` : ''}`, 'ok')
          setStatus(`Linked ${m.name}.`)
          onChanged?.()
        }} />
      )}
      {members.length > 0 && state === 'done' && guests.every((g) => !g.member) && (
        <p className="text-[11px] text-slate-500">Members without a guest match: {members.filter((m) => !m.vmid).map((m) => m.name).join(', ') || 'none'} — map them from the member menu on the {pageLabel('proxmox')} page.</p>
      )}
    </div>
  )
}
