// =============================================================================
// StorageEverywhere — the Disk Analysis page beyond this server: every Proxmox
// node (its physical disks with type, health and wear, its storage pools, its
// ZFS pools) and the VMs' own disks, from GET /storage/overview. The totals
// count real capacity once: this server's drives and the Proxmox pools. A VM's
// disk lives in a pool, so it is shown but not added again.
// =============================================================================

import { Boxes, HardDrive, Layers, Server, ShieldCheck, ShieldAlert, Cpu, Database, Network } from 'lucide-react'
import type { StorageOverview, PveNodeStorage, PveDisk, PveStorage, StorageDrive } from '../../../shared/types'
import { CARD } from '../../lib/pageKit'
import VmCapsule from '../fleet/VmCapsule'

import { Pill } from '../common/Pill'
/** bytes in the units the rest of the page uses (1024-based, as df and Proxmox count) */
export function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

const pctOf = (used: number, total: number) => (total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0)
const tone = (pct: number) => (pct >= 90
  ? { bar: 'from-rose-500 to-red-500', text: 'text-rose-400' }
  : pct >= 75 ? { bar: 'from-amber-500 to-orange-500', text: 'text-amber-400' }
    : { bar: 'from-emerald-500 to-cyan-500', text: 'text-emerald-400' })

function Meter({ used, total, label, thin = false }: { used: number; total: number; label: string; thin?: boolean }) {
  const pct = pctOf(used, total)
  return (
    <div className={`relative ${thin ? 'h-1.5' : 'h-2.5'} rounded-full bg-slate-800/80 overflow-hidden`} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent used`}>
      <div className={`h-full rounded-full bg-gradient-to-r ${tone(pct).bar} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function SectionLabel({ icon, children, aside }: { icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{icon}{children}</span>
      {aside}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The summary: one bar for everything, a segment per machine
// ---------------------------------------------------------------------------

// each machine keeps its colour in the bar and the legend (the hub cyan, the Proxmox nodes the fleet's violets)
const SEGMENTS = [
  { bar: 'bg-cyan-400', dot: 'bg-cyan-400' },
  { bar: 'bg-violet-400', dot: 'bg-violet-400' },
  { bar: 'bg-fuchsia-400', dot: 'bg-fuchsia-400' },
  { bar: 'bg-indigo-400', dot: 'bg-indigo-400' },
  { bar: 'bg-sky-400', dot: 'bg-sky-400' },
  { bar: 'bg-purple-400', dot: 'bg-purple-400' },
]

interface Part { key: string; name: string; kind: string; used: number; total: number; color: number }

export function StorageSummary({ data }: { data: StorageOverview }) {
  const parts: Part[] = []
  if (data.hub.counted) {
    const seen = new Set<string>()
    let used = 0; let total = 0
    for (const d of data.hub.drives) { if (seen.has(d.device)) continue; seen.add(d.device); used += d.used; total += d.total }
    if (total > 0) parts.push({ key: 'hub', name: data.hub.name, kind: 'This server', used, total, color: 0 })
  }
  // a shared store (NFS, Ceph) belongs to every node: it is shown once, under the first node that has it
  const sharedSeen = new Set<string>()
  data.proxmox.nodes.forEach((n, i) => {
    let used = 0; let total = 0
    for (const s of n.storages) {
      if (s.shared) { if (sharedSeen.has(s.storage)) continue; sharedSeen.add(s.storage) }
      used += s.used; total += s.total
    }
    // the Proxmox nodes take the violets, whether this server is counted or not
    parts.push({ key: `pve:${n.node}`, name: n.node, kind: 'Proxmox', used, total, color: 1 + (i % (SEGMENTS.length - 1)) })
  })
  const { total, used, avail } = data.totals
  const pct = pctOf(used, total)
  return (
    <div className={`${CARD} p-4 md:p-5 animate-fade-in`} style={{ animationDelay: '60ms' }}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">All storage</span>
          <Pill tone="neutral">{data.totals.devices} machine{data.totals.devices !== 1 ? 's' : ''}</Pill>
          <Pill tone="neutral">{data.totals.drives} drive{data.totals.drives !== 1 ? 's' : ''}</Pill>
          {data.totals.pools > 0 && <Pill tone="fleet">{data.totals.pools} Proxmox pool{data.totals.pools !== 1 ? 's' : ''}</Pill>}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-500"><span className="text-slate-300 font-medium">{fmtBytes(used)}</span><span className="mx-0.5">/</span>{fmtBytes(total)}</span>
          <span className="text-slate-500" aria-hidden>|</span>
          <span><span className="text-slate-300 font-medium">{fmtBytes(avail)}</span> <span className="text-slate-500">free</span></span>
          <span className={`font-semibold tabular-nums ${tone(pct).text}`}>{pct}%</span>
        </div>
      </div>
      {/* one bar, each machine's used space in its own colour, the free space after them */}
      <div className="flex h-4 rounded-full bg-slate-800 overflow-hidden ring-1 ring-white/5" role="meter" aria-label="All storage used"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent used across every machine`}>
        {parts.map((p) => (
          <div key={p.key} className={`h-full ${SEGMENTS[p.color].bar} transition-all duration-700 first:rounded-l-full border-r border-slate-900/60 last:border-r-0`}
            style={{ width: `${total > 0 ? (p.used / total) * 100 : 0}%` }} title={`${p.name}: ${fmtBytes(p.used)} used of ${fmtBytes(p.total)}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-1.5">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-xs min-w-0">
            <span className={`h-2 w-2 rounded-full shrink-0 ${SEGMENTS[p.color].dot}`} aria-hidden />
            <span className="text-slate-200 font-medium truncate">{p.name}</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0">{p.kind}</span>
            <span className="ml-auto tabular-nums text-slate-400 shrink-0">{fmtBytes(p.used)} <span className="text-slate-600">/</span> {fmtBytes(p.total)}</span>
          </div>
        ))}
      </div>
      {data.hub.note && <p className="mt-3 text-[11px] text-slate-500">{data.hub.note}.</p>}
      {data.proxmox.error && <p className="mt-3 text-[11px] text-amber-300/90">Proxmox did not answer: {data.proxmox.error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A Proxmox node: its disks, its pools, its ZFS pools
// ---------------------------------------------------------------------------

const DISK_KIND: Record<string, { label: string; cls: string }> = {
  nvme: { label: 'NVMe', cls: 'bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20' },
  ssd: { label: 'SSD', cls: 'bg-sky-500/10 text-sky-300 ring-sky-500/20' },
  hdd: { label: 'HDD', cls: 'bg-amber-500/10 text-amber-300 ring-amber-500/20' },
  usb: { label: 'USB', cls: 'bg-slate-500/10 text-slate-300 ring-slate-500/20' },
}
const POOL_TYPE: Record<string, string> = {
  lvmthin: 'LVM-thin', lvm: 'LVM', dir: 'Directory', zfspool: 'ZFS', btrfs: 'Btrfs', nfs: 'NFS', cifs: 'SMB', pbs: 'Backup Server',
  cephfs: 'CephFS', rbd: 'Ceph RBD', iscsi: 'iSCSI', iscsidirect: 'iSCSI', glusterfs: 'Gluster', esxi: 'ESXi',
}

function diskKind(d: PveDisk) {
  const t = (d.type || '').toLowerCase()
  if (d.devpath.startsWith('/dev/nvme')) return DISK_KIND.nvme
  return DISK_KIND[t] ?? { label: t && t !== 'unknown' ? t.toUpperCase() : 'Disk', cls: 'bg-slate-500/10 text-slate-300 ring-slate-500/20' }
}

function Health({ health }: { health: string }) {
  const h = health.toUpperCase()
  const ok = h === 'OK' || h === 'PASSED' || h === 'ONLINE'
  if (!h || h === 'UNKNOWN') return <span className="text-[10px] text-slate-500">health unknown</span>
  return ok
    ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300" title={`SMART: ${health}`}><ShieldCheck size={11} aria-hidden />Healthy</span>
    : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-300" title={`SMART: ${health}`}><ShieldAlert size={11} aria-hidden />{health}</span>
}

function DiskRow({ d }: { d: PveDisk }) {
  const k = diskKind(d)
  const name = [d.vendor && !d.model.toLowerCase().startsWith(d.vendor.toLowerCase()) ? d.vendor : '', d.model].filter(Boolean).join(' ') || d.devpath
  return (
    <li className="flex items-center gap-3 py-2 min-w-0">
      <span className={`inline-flex items-center justify-center h-6 min-w-[3rem] px-2 rounded-md text-[10px] font-semibold ring-1 shrink-0 ${k.cls}`}>{k.label}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 truncate" title={d.serial ? `${name} · serial ${d.serial}` : name}>{name}</p>
        <p className="text-[10px] text-slate-500 font-mono truncate">
          {d.devpath}{d.used ? <span className="font-sans text-slate-600"> · {d.used}</span> : null}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtBytes(d.size)}</p>
        <div className="flex items-center justify-end gap-2">
          {d.wearout != null && (
            <span className={`text-[10px] tabular-nums ${d.wearout < 20 ? 'text-rose-300' : d.wearout < 50 ? 'text-amber-300' : 'text-slate-400'}`} title="Life left (SSD wear indicator)">{d.wearout}% life</span>
          )}
          <Health health={d.health} />
        </div>
      </div>
    </li>
  )
}

function PoolRow({ s }: { s: PveStorage }) {
  const pct = pctOf(s.used, s.total)
  return (
    <li className="py-2">
      <div className="flex items-center gap-2 mb-1.5 min-w-0">
        {s.network ? <Network size={12} className="text-sky-400 shrink-0" aria-hidden /> : <Layers size={12} className="text-violet-300 shrink-0" aria-hidden />}
        <span className="text-sm font-medium text-slate-200 truncate">{s.storage}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 shrink-0">{POOL_TYPE[s.type] ?? s.type}</span>
        {s.shared && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 shrink-0">shared</span>}
        <span className="ml-auto text-[11px] tabular-nums text-slate-400 shrink-0">
          <span className="text-slate-300 font-medium">{fmtBytes(s.used)}</span><span className="text-slate-600 mx-0.5">/</span>{fmtBytes(s.total)}
          <span className={`ml-2 font-semibold ${tone(pct).text}`}>{pct}%</span>
        </span>
      </div>
      <Meter used={s.used} total={s.total} label={`${s.storage} used`} thin />
    </li>
  )
}

function NodeCard({ n, index }: { n: PveNodeStorage; index: number }) {
  const used = n.storages.reduce((a, s) => a + s.used, 0)
  const total = n.storages.reduce((a, s) => a + s.total, 0)
  const raw = n.disks.reduce((a, d) => a + d.size, 0)
  const online = n.status === 'online'
  return (
    <div className={`${CARD} relative overflow-hidden p-4 md:p-5 animate-fade-in`} style={{ animationDelay: `${120 + index * 40}ms` }}>
      {/* a thin violet edge marks a Proxmox machine */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/60 to-transparent" aria-hidden />
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Boxes size={18} className="text-violet-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-100 truncate">
              {n.node}
              <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} title={online ? 'online' : n.status} aria-hidden />
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Proxmox node</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-slate-200 tabular-nums">{fmtBytes(used)} <span className="text-slate-500 font-normal">of</span> {fmtBytes(total)}</p>
          <p className="text-[10px] text-slate-500">{n.disks.length > 0 ? `${n.disks.length} disk${n.disks.length !== 1 ? 's' : ''} · ${fmtBytes(raw)} raw` : 'in its pools'}</p>
        </div>
      </div>

      {total > 0 && <div className="mb-4"><Meter used={used} total={total} label={`${n.node} pools used`} /></div>}

      <SectionLabel icon={<HardDrive size={11} aria-hidden />} aside={n.disks.length > 0 ? <span className="text-[10px] text-slate-500">{n.disks.filter((d) => ['OK', 'PASSED'].includes(d.health.toUpperCase())).length} of {n.disks.length} healthy</span> : undefined}>Disks</SectionLabel>
      {n.disks_error
        ? <p className="text-[11px] text-amber-300/90 mb-4">{n.disks_error}</p>
        : n.disks.length === 0
          ? <p className="text-[11px] text-slate-500 mb-4">No disks reported.</p>
          : <ul className="divide-y divide-white/[0.04] mb-4">{n.disks.map((d) => <DiskRow key={d.devpath} d={d} />)}</ul>}

      {n.storages.length > 0 && (
        <>
          <SectionLabel icon={<Database size={11} aria-hidden />}>Storage pools</SectionLabel>
          <ul className="divide-y divide-white/[0.04]">{[...n.storages].sort((a, b) => b.total - a.total).map((s) => <PoolRow key={s.storage} s={s} />)}</ul>
        </>
      )}

      {n.zfs.length > 0 && (
        <div className="mt-4">
          <SectionLabel icon={<Cpu size={11} aria-hidden />}>ZFS pools</SectionLabel>
          <ul className="divide-y divide-white/[0.04]">
            {n.zfs.map((z) => (
              <li key={z.name} className="flex items-center gap-3 py-2 text-xs">
                <span className="font-medium text-slate-200">{z.name}</span>
                <Health health={z.health} />
                {z.frag != null && <span className="text-[10px] text-slate-500">{z.frag}% fragmented</span>}
                <span className="ml-auto tabular-nums text-slate-400">{fmtBytes(z.alloc)} <span className="text-slate-600">/</span> {fmtBytes(z.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ProxmoxStorage({ data }: { data: StorageOverview }) {
  if (data.proxmox.nodes.length === 0) return null
  return (
    <div className={`grid grid-cols-1 ${data.proxmox.nodes.length > 1 ? 'xl:grid-cols-2' : ''} gap-4`}>
      {data.proxmox.nodes.map((n, i) => <NodeCard key={n.node} n={n} index={i} />)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The VMs' own disks
// ---------------------------------------------------------------------------

function rootDrive(drives: StorageDrive[]): StorageDrive | null {
  return drives.find((d) => d.mount === '/') ?? drives[0] ?? null
}

export function VmDisks({ data }: { data: StorageOverview }) {
  if (data.vms.length === 0) return null
  return (
    <div className={`${CARD} p-4 md:p-5 animate-fade-in`} style={{ animationDelay: '160ms' }}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-violet-300" aria-hidden />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Virtual machines</h2>
        </div>
        <Pill tone="fleet">{data.vms.length} VM{data.vms.length !== 1 ? 's' : ''}</Pill>
      </div>
      <p className="text-[11px] text-slate-500 mb-4">Their disks live in the Proxmox pools above, so they are not counted again.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.vms.map((vm) => {
          const drives = vm.drives ?? []
          const d = rootDrive(drives)
          const used = drives.reduce((a, x) => a + x.used, 0)
          const total = drives.reduce((a, x) => a + x.total, 0)
          const pct = pctOf(used, total)
          return (
            <div key={vm.id} className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
              <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                <VmCapsule member={vm.id} name={vm.name} vmid={vm.vmid} size="xs" />
                {d
                  ? <span className={`text-xs font-semibold tabular-nums ${tone(pct).text}`}>{pct}%</span>
                  : <span className="text-[10px] text-slate-500">{vm.reachable ? 'no answer' : 'not answering'}</span>}
              </div>
              {d && (
                <>
                  <Meter used={used} total={total} label={`${vm.name} disk used`} thin />
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono truncate">{drives.length > 1 ? `${drives.length} file systems` : `${d.device} · ${d.fstype || 'disk'}`}</span>
                    <span className="tabular-nums shrink-0"><span className="text-slate-300">{fmtBytes(used)}</span> / {fmtBytes(total)}</span>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
