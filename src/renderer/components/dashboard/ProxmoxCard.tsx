// =============================================================================
// ProxmoxCard — the Proxmox host at a glance: node load and every VM/LXC with
// its state. Read-only here; the Proxmox page has the power buttons.
// =============================================================================

import { Server, Cpu, MemoryStick, Satellite } from 'lucide-react'
import { Badge } from '@mantine/core'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD, TONE_OK } from '../../lib/ui'
import { fetchProxmoxStatus, fetchProxmoxVms, fetchProxmoxNodes, fetchFleetStatus, fetchFleetOverview } from '../../api/endpoints'
import { Card, CardBody } from './cardShared'
import { pctTone, TONE_FILL } from '../../lib/tone'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
function fmtGb(n: number): string { return n ? `${(n / 1073741824).toFixed(n >= 10737418240 ? 0 : 1)} GB` : '0' }

export default function ProxmoxCard() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const status = usePolling(fetchProxmoxStatus, 30000, { enabled: isConnected })
  const ready = !!status.data?.configured && !!status.data?.reachable
  const vms = usePolling(fetchProxmoxVms, 15000, { enabled: isConnected && ready })
  const nodes = usePolling(fetchProxmoxNodes, 15000, { enabled: isConnected && ready })
  // the fleet (3.9): members and what they run
  const fleet = usePolling(fetchFleetStatus, 30000, { enabled: isConnected })
  const overview = usePolling(fetchFleetOverview, 15000, { enabled: isConnected && (fleet.data?.members ?? 0) > 0 })
  const s = status.data
  const memberByVm = new Map((overview.data?.members ?? []).filter((m) => m.vmid).map((m) => [m.vmid as number, m]))

  return (
    <Card
      card="proxmox"
      meta={s?.reachable ? `${s.vms.running}/${s.vms.total} running` : undefined}
      open="proxmox"
      clickable={false}
      badge={ready && s?.version ? <Badge component="span" color="slate">PVE {s.version}</Badge> : undefined}
    >
      {status.error && !s ? (
        <ErrorState card title={`Could not reach ${pageLabel('proxmox')}`} error={status.error} onRetry={status.refresh} />
      ) : !s ? (
        <Skeleton label="Checking Proxmox…" rows={4} />
      ) : !s.configured ? (
        <EmptyState card
          icon={<Server size={20} />}
          title="Not linked"
          hint={`Add the Proxmox URL and an API token in ${pageLabel('config')} → Proxmox`}
          action={<button type="button" onClick={() => setCurrentPage('config')} className={`${BTN_CARD} ${TONE_OK}`}>Open {pageLabel('config')}</button>}
        />
      ) : !s.reachable ? (
        <EmptyState card
          icon={<Server size={20} />}
          title="Proxmox does not answer"
          hint={s.error || s.hints?.[0] || ''}
          action={<button type="button" onClick={() => setCurrentPage('proxmox')} className={`${BTN_CARD} ${TONE_OK}`}>Open {pageLabel('proxmox')}</button>}
        />
      ) : (
        <CardBody className="space-y-2">
          {overview.data && overview.data.totals.members > 0 && (
            <button type="button" onClick={() => setCurrentPage('proxmox')} className="w-full rounded-xl bg-violet-500/[0.06] border border-violet-500/15 px-3 py-2 text-[11px] text-left flex items-center gap-2 hover:bg-violet-500/10 transition-colors">
              <Satellite size={11} className="text-violet-400 shrink-0" aria-hidden />
              <span className="text-slate-300 truncate">Fleet: {overview.data.totals.reachable}/{overview.data.totals.members} members answering · {overview.data.totals.stacks} stack{overview.data.totals.stacks === 1 ? '' : 's'} · {overview.data.totals.containers_running + (overview.data.totals.containers_sleeping ?? 0)}/{overview.data.totals.containers_total} containers up{overview.data.totals.containers_sleeping ? ` (${overview.data.totals.containers_sleeping} asleep)` : ''}</span>
            </button>
          )}
          {fleet.data?.role === 'member' && fleet.data.hub && (
            <div className="rounded-xl bg-violet-500/[0.06] border border-violet-500/15 px-3 py-2 text-[11px] text-slate-300 flex items-center gap-2"><Satellite size={11} className="text-violet-400 shrink-0" aria-hidden /> Member of {fleet.data.hub.name || fleet.data.hub.url}</div>
          )}
          {(nodes.data?.nodes ?? []).map((n) => (
            <div key={n.node} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200 truncate">{n.node}</span>
                <span className={`text-[10px] ${n.status === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}>{n.status}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-1.5 text-slate-400"><Cpu size={10} aria-label="CPU" /><div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className={`h-full ${TONE_FILL[pctTone(n.cpu)]}`} style={{ width: `${Math.min(100, n.cpu)}%` }} /></div><span className="tabular-nums w-9 text-right text-slate-300">{n.cpu}%</span></div>
                <div className="flex items-center gap-1.5 text-slate-400"><MemoryStick size={10} aria-label="Memory" /><div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className={`h-full ${TONE_FILL[pctTone(n.mem_pct)]}`} style={{ width: `${Math.min(100, n.mem_pct)}%` }} /></div><span className="tabular-nums w-9 text-right text-slate-300">{n.mem_pct}%</span></div>
              </div>
            </div>
          ))}
          <div className="divide-y divide-white/[0.04]">
            {(vms.data?.vms ?? []).slice(0, 60).map((v) => (
              <button key={`${v.node}/${v.type}/${v.vmid}`} type="button" onClick={() => setCurrentPage('proxmox')} className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-white/[0.03] rounded-lg px-1">
                <span className={`w-2 h-2 rounded-full shrink-0 ${v.status === 'running' ? 'bg-emerald-400' : v.status === 'paused' ? 'bg-amber-400' : 'bg-slate-500'}`} aria-hidden />
                <span className="text-xs text-slate-200 truncate flex-1 min-w-0">{v.name}{memberByVm.get(v.vmid) ? <span className="text-[10px] text-violet-300 ml-1">· {memberByVm.get(v.vmid)!.stacks_total} stack{memberByVm.get(v.vmid)!.stacks_total === 1 ? '' : 's'}</span> : null}</span>
                <Badge component="span" color={v.type === 'qemu' ? 'violet' : 'slate'}>{v.type === 'qemu' ? 'VM' : 'LXC'}</Badge>
                <span className="text-[10px] text-slate-500 tabular-nums w-16 text-right">{v.status === 'running' ? `${v.cpu}% · ${fmtGb(v.mem)}` : v.status}</span>
              </button>
            ))}
            {(vms.data?.vms.length ?? 0) > 60 && <button type="button" onClick={() => setCurrentPage('proxmox')} className="w-full text-[11px] text-slate-400 hover:text-slate-200 py-1.5">and {(vms.data?.vms.length ?? 0) - 60} more…</button>}
          </div>
        </CardBody>
      )}
    </Card>
  )
}
