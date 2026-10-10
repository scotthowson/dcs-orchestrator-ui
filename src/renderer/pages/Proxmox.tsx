// =============================================================================
// Proxmox — the VM area of DCS: the Proxmox configurator and the fleet's control
// room on one page. On a hub every stack lives in its own VM ("the VM is the
// stack"): an overview row (the nodes, this server, the baked DCS templates,
// the builds in flight), then every guest with the DCS it runs — its stacks
// and containers with their controls, CPU and RAM, power actions with a
// confirmation, a details sheet with memory ballooning — as same-shaped cards
// (every card keeps the same slots; a member's containers fold out of it) or as
// a table. A member shows the hub it belongs to. Works on phones (one column,
// bottom sheets, 36 px targets).
// =============================================================================

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl, Tooltip } from '@mantine/core'
import { RotateCcw, Server, Cpu, MemoryStick, HardDrive, Clock, Play, Power, Square, RotateCw, Zap, Pause, PlayCircle, RefreshCw, AlertTriangle, Settings2, ShieldCheck, Boxes, Box, Tag, ListChecks, X, Loader2, Satellite, Link2, KeyRound, Radar, Rocket, MoreHorizontal, PlugZap, Pencil, Trash2, Layers, ExternalLink, Home, Info, LayoutGrid, LayoutList, Hammer, LayoutDashboard, ChevronDown, ChevronUp, FolderSync, FolderInput, TerminalSquare, Globe, Moon, Camera, ArrowDownToLine } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { EmptyState, ErrorState } from '../components/common/PageState'
import {
  fetchProxmoxStatus, fetchProxmoxNodes, fetchProxmoxVms, fetchProxmoxVm, fetchProxmoxTasks, proxmoxVmAction, proxmoxVmBalloon,
  fetchFleetStatus, fetchFleetOverview, fetchFleetDiscover, fetchStacks, startStack, stopStack, restartStack,
  startContainer, stopContainer, restartContainer,
  testFleetMember, relinkFleetMember, removeFleetMember, syncFleetMember, fetchFleetJobs, deleteFleetJob, fetchFleetProvisionDefaults, fetchProxmoxCapabilities, fetchFleetTemplates, deleteFleetTemplate, fetchProxmoxSelf, tagProxmoxSelf, fetchDomains, setMemberDomain,
} from '../api/endpoints'
import type { ProxmoxVm, ProxmoxNode, ProxmoxTask, ProxmoxVmAction, FleetMemberBase, FleetMemberLive, FleetGuestScan, FleetStatus, FleetTemplate, FleetJob, FleetProvisionDefaults, StackInfo, ContainerInfo, ProxmoxSelf } from '../../shared/types'
import FleetLinkPanel from '../components/fleet/FleetLinkPanel'
import JoinHubPanel from '../components/fleet/JoinHubPanel'
import JoinCodeCard from '../components/fleet/JoinCodeCard'
import MemberSheet, { type MemberSheetPrefill } from '../components/fleet/MemberSheet'
import { MATCH_LABEL, hostOf } from '../components/fleet/fleetShared'
import { proxmoxVmResize } from '../api/endpoints'
import { FleetJobCard, JobsSummary, orderJobs } from '../components/fleet/FleetJobsPanel'
import MoveToHubSheet from '../components/fleet/MoveToHubSheet'
import NewVmSheet, { CapabilityNote, settingsFromDefaults, loadVmSettings, osLabel } from '../components/fleet/NewVmSheet'
import VmCapsule from '../components/fleet/VmCapsule'
import HostFoldersSheet from '../components/fleet/HostFoldersSheet'
import SshAccessSheet from '../components/fleet/SshAccessSheet'
import { SnapshotsPanel, TakeSnapshotSheet } from '../components/fleet/VmSnapshots'
import PageHeader from '../components/common/PageHeader'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON, BTN_ICON_SM, BTN_ICON_QUIET, BTN_ICON_SM_QUIET, BTN_SHEET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_SHEET_DANGER, TONE_QUIET, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER, TONE_ATTN } from '../lib/ui'
import { useModalA11y } from '../hooks/useModalA11y'
import Hint from '../components/common/Hint'
import { StateDot, StackDot, AsleepCount } from '../components/common/StateChip'
import { containerState, countStates, countsFrom, statesLine, fineCount, problemCount, stackIsFine, stackState, STATE_META, STACK_META, type StateCounts } from '../lib/containerState'

import Sheet from '../components/common/Sheet'
import { INPUT_FLEET, LABEL } from '../lib/fieldStyles'
import { Pill } from '../components/common/Pill'
import { type Tone } from '../lib/tone'
import SearchInput from '../components/common/SearchInput'
import CloseButton from '../components/common/CloseButton'
const STATUS_POLL = 20_000
const LIST_POLL = 15_000
const TASK_POLL = 30_000
const VIEW_KEY = 'dcs-proxmox-view'

type View = 'cards' | 'table'
type Show = 'all' | 'running' | 'stopped' | 'qemu' | 'lxc' | 'dcs'
type StackAct = 'start' | 'stop' | 'restart'

// the house card; its buttons are the shared scale (lib/ui)
const CARD = 'surface'
const HOST_VIEW_HINT = "Proxmox shows the host's view of this VM's memory: without a balloon device the whole allocation fills with page cache. Open the details to enable ballooning."

function loadView(): View { try { return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards' } catch { return 'cards' } }
function saveView(v: View) { try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }

function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}
function fmtUptime(s: number): string {
  if (!s) return '—'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function ago(epoch: number): string {
  if (!epoch) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function fmtPct(p: number): string { return Number.isInteger(p) ? String(p) : p.toFixed(1) }
/** one guest, told apart across nodes and types */
function guestKey(v: Pick<ProxmoxVm, 'node' | 'type' | 'vmid'>): string { return `${v.node}/${v.type}/${v.vmid}` }
function pctColor(p: number): string {
  return p >= 90 ? 'bg-rose-500' : p >= 75 ? 'bg-amber-500' : 'bg-emerald-500'
}
/** the VM (or container) in the Proxmox web UI, which lives at the API's origin */
function proxmoxLink(base: string, vm: Pick<ProxmoxVm, 'type' | 'vmid'>): string {
  return `${base.replace(/\/api2\/(json|extjs)\/?$/, '').replace(/\/+$/, '')}/#v1:0:=${encodeURIComponent(`${vm.type}/${vm.vmid}`)}`
}

function Bar({ pct, className = '' }: { pct: number; className?: string }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className={`h-1.5 rounded-full bg-white/[0.06] overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-700 ${pctColor(p)}`} style={{ width: `${p}%` }} />
    </div>
  )
}
function StatusDot({ status, className = '' }: { status: string; className?: string }) {
  const cls = status === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.6)]' : status === 'paused' || status === 'suspended' ? 'bg-amber-400' : 'bg-slate-500'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${cls} ${className}`} aria-label={status} />
}
/** a VM wears the fleet's violet, like every capsule of a VM; a container (LXC) is told apart in cyan */
function TypeChip({ type }: { type: ProxmoxVm['type'] }) {
  return <Pill tone={type === 'qemu' ? 'fleet' : 'info'}>{type === 'qemu' ? 'VM' : 'LXC'}</Pill>
}
/** Proxmox tags as pills (the ones DCS wants in emerald); past `max`, a +N that names the rest */
function TagChips({ tags, max, wanted = [] }: { tags: string[]; max?: number; wanted?: string[] }) {
  const shown = max && tags.length > max ? tags.slice(0, max) : tags
  const rest = tags.slice(shown.length)
  return (
    <>
      {shown.map((t) => <Pill key={t} tone={wanted.includes(t) ? 'ok' : 'neutral'}>{t}</Pill>)}
      {rest.length > 0 && <Tooltip label={`Also tagged ${rest.join(', ')}`}><Pill tone="neutral">+{rest.length}</Pill></Tooltip>}
    </>
  )
}
function SectionLabel({ icon: Icon, children, className = '' }: { icon: React.ElementType; children: ReactNode; className?: string }) {
  return <h2 className={`text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 min-w-0 ${className}`}><Icon size={12} className="shrink-0" /> {children}</h2>
}
/** the small label row an overview card opens with */
function CardHead({ icon: Icon, title, right }: { icon: React.ElementType; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 min-w-0 truncate"><Icon size={11} className="shrink-0" /> {title}</p>
      {right}
    </div>
  )
}
function Meter({ icon: Icon, label, pct, note }: { icon?: React.ElementType; label: string; pct: number; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-slate-400 mb-1"><span className="flex items-center gap-1">{Icon && <Icon size={11} />} {label}</span><span className="tabular-nums text-slate-300">{fmtPct(pct)}%</span></div>
      <Bar pct={pct} />
      {note && <div className="text-slate-600 mt-1 truncate tabular-nums">{note}</div>}
    </div>
  )
}
function HostViewMark({ onClick }: { onClick?: () => void }) {
  return <Hint label={HOST_VIEW_HINT}><button type="button" onClick={onClick} className="text-[10px] text-amber-300/90 hover:text-amber-200 cursor-help leading-none">host view?</button></Hint>
}

const ACTION_META: Record<ProxmoxVmAction, { label: string; icon: React.ElementType; danger: boolean; question: (v: ProxmoxVm) => string; note?: string }> = {
  start:    { label: 'Start',     icon: Play,       danger: false, question: (v) => `Start ${v.name}?` },
  shutdown: { label: 'Shut down', icon: Power,      danger: true,  question: (v) => `Shut down ${v.name} cleanly?`, note: 'Sends ACPI power-off (VM) or a clean stop (container); the guest gets time to close.' },
  stop:     { label: 'Stop',      icon: Square,     danger: true,  question: (v) => `Stop ${v.name} now?`, note: 'Like pulling the plug: nothing inside gets to save. Use Shut down unless it hangs.' },
  reboot:   { label: 'Reboot',    icon: RotateCw,   danger: false, question: (v) => `Reboot ${v.name}?` },
  reset:    { label: 'Reset',     icon: Zap,        danger: true,  question: (v) => `Hard-reset ${v.name}?`, note: 'A hardware reset. Only for a VM that no longer answers.' },
  suspend:  { label: 'Suspend',   icon: Pause,      danger: false, question: (v) => `Suspend ${v.name}?` },
  resume:   { label: 'Resume',    icon: PlayCircle, danger: false, question: (v) => `Resume ${v.name}?` },
}

function actionsFor(vm: ProxmoxVm): ProxmoxVmAction[] {
  if (vm.status === 'running') return vm.type === 'qemu' ? ['shutdown', 'reboot', 'stop', 'reset', 'suspend'] : ['shutdown', 'reboot', 'stop']
  if (vm.status === 'paused' || vm.status === 'suspended') return ['resume', 'stop']
  return ['start']
}

/** one power action: an icon button with its name as the hint (Start and Resume keep their label — the one thing a stopped guest offers) */
function ActionButton({ a, onClick, labeled = false, small = false }: { a: ProxmoxVmAction; onClick: () => void; labeled?: boolean; small?: boolean }) {
  const meta = ACTION_META[a]; const Icon = meta.icon
  const tone = meta.danger ? TONE_DANGER : a === 'start' || a === 'resume' ? TONE_OK : TONE_QUIET
  if (labeled) return <button type="button" onClick={onClick} className={`${small ? BTN_CARD : 'h-9 sm:h-8 px-2.5 rounded-lg text-xs shrink-0 flex items-center gap-1.5 transition-colors'} font-medium ${tone}`}><Icon size={small ? 12 : 14} /> {meta.label}</button>
  return <Hint label={meta.label}><button type="button" onClick={onClick} aria-label={meta.label} className={`${small ? BTN_ICON_SM : BTN_ICON} ${tone}`}><Icon size={small ? 12 : 14} /></button></Hint>
}

function ConfirmSheet({ vm, action, onClose, onDone }: { vm: ProxmoxVm; action: ProxmoxVmAction; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { addToast } = useToast()
  const meta = ACTION_META[action]
  const Icon = meta.icon
  const ids = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const runRef = useRef<HTMLButtonElement>(null)
  // like every confirmation: Cancel has the focus when the action is destructive, so Enter does not run it
  useModalA11y(panelRef, onClose, { initialFocus: meta.danger ? cancelRef : runRef })
  const run = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await proxmoxVmAction(vm.node, vm.type, vm.vmid, action)
      addToast({ type: 'success', message: `${r.message || `${meta.label} sent`}${r.upid ? ` · task ${r.upid.split(':')[5] || ''}` : ''}` })
      onDone(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed')
      setBusy(false)
    }
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={`${ids}-q`} aria-describedby={`${ids}-d`} className="w-full sm:max-w-md glass rounded-t-3xl sm:rounded-2xl p-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl ${meta.danger ? 'bg-rose-500/15 text-rose-400' : 'bg-emerald-500/15 text-emerald-400'}`}><Icon size={18} /></div>
          <div className="min-w-0 flex-1">
            <h3 id={`${ids}-q`} className="text-base font-semibold text-slate-100">{meta.question(vm)}</h3>
            <p id={`${ids}-d`} className="text-sm text-slate-400 mt-1">{vm.type === 'qemu' ? 'VM' : 'Container'} {vm.vmid} on {vm.node}{meta.note ? ` — ${meta.note}` : ''}</p>
            {error && <p role="alert" className="text-sm text-rose-400 mt-2">{error}</p>}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="mt-5 flex gap-2">
          <button ref={cancelRef} onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          <button ref={runRef} onClick={run} disabled={busy} className={`${meta.danger ? BTN_SHEET_DANGER : BTN_SHEET_PRIMARY} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />} {meta.label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// -----------------------------------------------------------------------------
// The overview row: the nodes, this server, the DCS templates, the builds
// -----------------------------------------------------------------------------

/** one small square per guest on a node — green running, amber paused, grey off, ringed in violet when a DCS member lives in it; a click finds it in the list */
function GuestMap({ guests, memberVmids, onPick, loading = false }: { guests: ProxmoxVm[]; memberVmids: Set<number>; onPick: (vm: ProxmoxVm) => void; loading?: boolean }) {
  if (loading) return <span className="skeleton h-2.5 w-16 rounded" aria-label="Reading the guests" />
  if (guests.length === 0) return <span className="text-[10px] text-slate-600">no guests</span>
  return (
    <div className="flex flex-wrap gap-1 min-w-0">
      {guests.map((v) => {
        const tone = v.status === 'running' ? 'bg-emerald-400/80 hover:bg-emerald-300' : v.status === 'paused' || v.status === 'suspended' ? 'bg-amber-400/80 hover:bg-amber-300' : 'bg-slate-600/70 hover:bg-slate-400'
        const member = memberVmids.has(v.vmid)
        return (
          <Hint key={`${v.type}/${v.vmid}`} label={`${v.name} · #${v.vmid} · ${v.status}${member ? ' · runs a DCS member' : ''}`}>
            <button type="button" onClick={() => onPick(v)} aria-label={`${v.name}, ${v.status}`}
              className={`w-2.5 h-2.5 rounded-[3px] transition-all hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${tone} ${member ? 'ring-1 ring-violet-400/60' : ''}`} />
          </Hint>
        )
      })}
    </div>
  )
}

function NodesCard({ nodes, vms, version, memberVmids, onPick, loading = false }: { nodes: ProxmoxNode[]; vms: ProxmoxVm[]; version: string; memberVmids: Set<number>; onPick: (vm: ProxmoxVm) => void; loading?: boolean }) {
  const online = nodes.filter((n) => n.status === 'online').length
  const up = vms.filter((v) => v.status === 'running').length
  const qemu = vms.filter((v) => v.type === 'qemu').length
  return (
    <div className={`${CARD} p-4 h-full flex flex-col`}>
      <CardHead icon={Boxes} title={nodes.length === 1 ? 'Node' : 'Nodes'} right={<span className="text-[10px] text-slate-500 tabular-nums shrink-0">{online}/{nodes.length} online</span>} />
      <div className="space-y-4 flex-1">
        {nodes.map((n) => {
          const guests = vms.filter((v) => v.node === n.node)
          const up = guests.filter((v) => v.status === 'running').length
          return (
            <div key={n.node}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot status={n.status === 'online' ? 'running' : 'stopped'} />
                  <span className="text-sm font-semibold text-slate-100 truncate">{n.node}</span>
                  {nodes.length > 1 && <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{up}/{guests.length} guests up</span>}
                  {n.level && <span className="text-[10px] text-slate-600 shrink-0" title="Subscription level">{n.level}</span>}
                </div>
                <span className="text-[11px] text-slate-500 flex items-center gap-1 shrink-0 tabular-nums" title="Node uptime"><Clock size={11} /> {fmtUptime(n.uptime)}</span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-3 text-[11px]">
                <Meter icon={Cpu} label="CPU" pct={n.cpu} note={`${n.maxcpu} cores`} />
                <Meter icon={MemoryStick} label="RAM" pct={n.mem_pct} note={`${fmtBytes(n.mem)} / ${fmtBytes(n.maxmem)}`} />
                <Meter icon={HardDrive} label="Root" pct={n.disk_pct} note={`${fmtBytes(n.disk)} / ${fmtBytes(n.maxdisk)}`} />
              </div>
              <div className="mt-3 flex items-start gap-2.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0 leading-[10px] pt-px">Guests</span>
                <GuestMap guests={guests} memberVmids={memberVmids} onPick={onPick} loading={loading} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between gap-x-2 gap-y-1 flex-wrap text-[10px] text-slate-600 tabular-nums">
        <span className="truncate">Proxmox VE {version}</span>
        {!loading && <span className="truncate">{up}/{vms.length} guests up · {qemu} VM{qemu === 1 ? '' : 's'} · {vms.length - qemu} LXC</span>}
      </div>
    </div>
  )
}

function HubCard({ fleet, stacks, isHub, memberCount, onStacks, onStack, pveSelf, isAdmin, tagging, onTag }: { fleet: FleetStatus | null; stacks: StackInfo[]; isHub: boolean; memberCount: number; onStacks: () => void; onStack: (name: string) => void; pveSelf?: ProxmoxSelf | null; isAdmin: boolean; tagging: boolean; onTag: () => void }) {
  // a stack asleep on demand is fine: it counts with the running ones, and its asleep containers are said apart
  const running = stacks.filter((s) => stackIsFine(s)).length
  const containers = stacks.reduce((a, s) => a + (s.running_containers || 0), 0)
  const asleep = stacks.reduce((a, s) => a + (s.sleeping_containers || 0), 0)
  const role = fleet?.role
  return (
    <div className={`${CARD} p-4 h-full flex flex-col`}>
      <CardHead icon={Home} title="This server" right={<VmCapsule />} />
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-slate-100 truncate">{fleet?.server_name || fleet?.hostname || 'DCS'}</span>
        {isHub && <Pill tone="fleet">hub</Pill>}
        {role === 'member' && <Pill tone="fleet">member</Pill>}
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5 truncate">
        DCS {fleet?.version || '…'}{fleet?.hostname ? ` · ${fleet.hostname}` : ''}
        {isHub ? ` · ${memberCount} member${memberCount === 1 ? '' : 's'}` : role === 'member' && fleet?.hub ? ` · under ${fleet.hub.name || fleet.hub.url}` : ''}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Stacks</p>
          <p className="text-base font-semibold text-slate-100 tabular-nums leading-tight mt-0.5">{running}<span className="text-slate-600 font-normal text-xs"> / {stacks.length}</span></p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Containers</p>
          <p className="text-base font-semibold text-slate-100 tabular-nums leading-tight mt-0.5">{containers}<span className="text-slate-600 font-normal text-xs"> running</span>{asleep > 0 && <span className="font-normal text-xs"> <AsleepCount n={asleep} /></span>}</p>
        </div>
      </div>
      {pveSelf?.guest && (
        <div className="mt-3 flex items-center gap-1.5 flex-wrap min-w-0">
          <Tag size={11} className="text-slate-500 shrink-0" />
          <Tooltip label={`${pveSelf.guest.type === 'lxc' ? 'Container' : 'VM'} ${pveSelf.guest.vmid} (${pveSelf.guest.name}) on ${pveSelf.guest.node} — the Proxmox guest this server runs in, ${MATCH_LABEL[pveSelf.guest.matched_by] ?? `matched by ${pveSelf.guest.matched_by}`}`}>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 shrink-0 cursor-help">Proxmox tags</span>
          </Tooltip>
          <TagChips tags={pveSelf.tags} wanted={pveSelf.wanted} />
          {pveSelf.missing.length > 0 && (isAdmin
            ? <Hint label={`Give ${pveSelf.guest.type === 'lxc' ? 'container' : 'VM'} ${pveSelf.guest.vmid} the tag${pveSelf.missing.length > 1 ? 's' : ''} ${pveSelf.missing.join(' and ')} in Proxmox (the API token needs VM.Config.Options on it)`}>
                <button type="button" onClick={onTag} disabled={tagging} className={BTN_CARD_QUIET}>
                  {tagging ? <Loader2 size={12} className="animate-spin" /> : <Tag size={12} />} Add {pveSelf.missing.join(', ')}
                </button>
              </Hint>
            : <span className="text-[10px] text-amber-300">missing: {pveSelf.missing.join(', ')}</span>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5 flex-1 content-start">
        {stacks.map((st) => (
          <Hint key={st.name} label={`${st.name}: ${STACK_META[stackState(st)].label.toLowerCase()} — on the ${pageLabel('stacks')} page`}><button type="button" onClick={() => onStack(st.name)} className="h-7 px-2 rounded-lg bg-white/[0.03] border border-white/5 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1.5 max-w-full">
            <StackDot stack={st} /><span className="truncate">{st.name}</span><span className="text-slate-600 tabular-nums">{st.running_containers}</span>
          </button></Hint>
        ))}
        {stacks.length === 0 && <span className="text-[11px] text-slate-500">No stacks run on this server itself{isHub ? ' — they live in the VMs' : ''}.</span>}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-600 leading-snug min-w-0">{isHub ? 'The hub keeps stacks like any member' : role === 'member' ? 'Managed from the hub' : ''}</span>
        <button type="button" onClick={onStacks} className={BTN_CARD_QUIET}><Layers size={12} /> {pageLabel('stacks')} page</button>
      </div>
    </div>
  )
}

/** the templates the hub baked, and how the next VM gets built (the settings the New VM sheet remembers) */
function TemplatesCard({ templates, defaults, isAdmin, removing, onRemove, onBake, onFind }: { templates: FleetTemplate[]; defaults: FleetProvisionDefaults | null; isAdmin: boolean; removing: number | null; onRemove: (t: FleetTemplate) => void; onBake: () => void; onFind: (vmid: number) => void }) {
  const next = defaults ? settingsFromDefaults(defaults, loadVmSettings()) : null
  const memGb = defaults ? Math.round((defaults.defaults.memory_mb / 1024) * 10) / 10 : 0
  const facts: [string, string][] = next && defaults ? [
    ['Image', osLabel(next, defaults)],
    ['Size', `${defaults.defaults.cores} core${defaults.defaults.cores === 1 ? '' : 's'} · ${memGb} GB · ${defaults.defaults.disk_gb} GB disk`],
    ['Node · storage', `${next.node} · ${next.storage}`],
    ['Network', `${next.bridge} · /${next.cidr} from ${next.ip_start || '?'}`],
    ['Gateway · DNS', `${next.gateway || '?'} · ${next.dns || '?'}`],
  ] : []
  return (
    <div className={`${CARD} p-4 h-full flex flex-col`}>
      <CardHead icon={Layers} title="DCS templates" right={<span className="text-[10px] text-slate-500 tabular-nums shrink-0">{templates.length} baked</span>} />
      {templates.length === 0 ? (
        <p className="text-[11px] text-slate-500">No template yet. A VM cloned from a baked DCS template builds in about half a minute instead of a minute and a half — bake one from the New VM sheet.</p>
      ) : (
        <div className="divide-y divide-white/[0.04] -mt-1">
          {templates.map((t) => (
            <div key={t.vmid} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{t.image_id}</p>
                  <VmCapsule member="template" vmid={t.vmid} size="xs" onClick={() => onFind(t.vmid)} />
                </div>
                <p className="text-[10px] text-slate-500 truncate tabular-nums">DCS {t.dcs_version || '?'} · baked {t.baked_at ? new Date(t.baked_at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}{t.family ? ` · ${t.family}` : ''} · {t.node}</p>
              </div>
              {isAdmin && (
                <Hint label="Remove this template with its VM"><button type="button" onClick={() => onRemove(t)} disabled={removing === t.vmid} aria-label={`Remove the template ${t.image_id}`} className={`${BTN_ICON_SM} text-slate-500 hover:text-rose-300 hover:bg-rose-500/10`}>
                  {removing === t.vmid ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button></Hint>
              )}
            </div>
          ))}
        </div>
      )}
      {facts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.04] flex-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5"><Hammer size={10} /> Next VM build <span className="normal-case tracking-normal text-slate-600">— as the New VM sheet remembers it</span></p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-x-3 gap-y-1 text-[11px]">
            {facts.map(([k, v]) => <div key={k} className="flex items-baseline gap-2 min-w-0"><dt className="text-slate-500 shrink-0">{k}</dt><dd className="text-slate-300 truncate tabular-nums" title={v}>{v}</dd></div>)}
          </dl>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-600 truncate">A clone builds in about half a minute</span>
        {isAdmin && <Hint label="Open the New VM sheet: pick a cloud image and press “Bake only” — or build a VM with “Bake a DCS template first” on"><button type="button" onClick={onBake} className={BTN_CARD_QUIET}><Rocket size={12} /> Bake one</button></Hint>}
      </div>
    </div>
  )
}

/** the VMs the hub is building, built, or failed to build: a summary while any is active, then one wide card per job */
function BuildsPanel({ jobs, onChanged }: { jobs: FleetJob[]; onChanged: () => void }) {
  return (
    <section className="space-y-3">
      <JobsSummary jobs={jobs} onChanged={onChanged} compact title="Built one at a time — each joins this hub by itself" />
      <div className="space-y-2.5">
        {orderJobs(jobs).map((j) => <FleetJobCard key={j.id} job={j} onChanged={onChanged} compact />)}
      </div>
    </section>
  )
}

function BuildsQuiet({ canBuild, onNew }: { canBuild: boolean; onNew: () => void }) {
  return (
    <div className={`${CARD} p-4 h-full flex flex-col`}>
      <CardHead icon={Hammer} title="VM builds" right={<span className="text-[10px] text-slate-500 tabular-nums shrink-0">0 active</span>} />
      <p className="text-[11px] text-slate-500 flex-1">Nothing is being built. A new VM stack is created on Proxmox, installed and joined by the hub without a hand on it; follow it here.</p>
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-600 truncate">Built one at a time</span>
        {canBuild && <button type="button" onClick={onNew} className={`${BTN_CARD} ${TONE_OK}`}><Rocket size={12} /> New VM stack</button>}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// The DCS inside a guest: its stack's containers, or its stacks
// -----------------------------------------------------------------------------

/** the containers of one stack as the member's snapshot lists them (containers Compose does not manage count for the VM's only stack) */
function stackContainers(live: FleetMemberLive, stack: StackInfo): ContainerInfo[] {
  return (live.containers ?? []).filter((c) => !c.stack || c.stack === stack.name)
}
function isRunningContainer(c: ContainerInfo): boolean { return String(c.state ?? '').startsWith('running') }
/** "3 containers · 2 running · 1 asleep": the folded containers block's one line, and the header the open block keeps */
function containersLine(n: StateCounts): string {
  return n.total === 0 ? 'No containers yet — deploy a template here' : statesLine(n)
}
/** a member's containers by state: from its snapshot rows when it sent them, else its counts */
function memberCounts(live: FleetMemberLive): StateCounts {
  return live.containers ? countStates(live.containers) : countsFrom(live.containers_total, live.containers_running, live.containers_sleeping, live.containers_stuck)
}
/** "2 stacks · 7 containers · 5 running · 1 asleep": the same line for a member with more than one stack */
function stacksLine(live: FleetMemberLive): string {
  const n = live.stacks.length
  return `${n} stack${n === 1 ? '' : 's'} · ${statesLine(memberCounts(live))}`
}
/** "4/5 containers" for a guest — asleep on demand counts as up (it wakes on the first request); the rest is said in the tooltip */
function memberRatio(live: FleetMemberLive): { text: string; hint: string; problem: boolean } {
  const n = memberCounts(live)
  return { text: `${fineCount(n) + n.unhealthy}/${n.total} containers`, hint: statesLine(n), problem: problemCount(n) > 0 }
}
/** "1 stack · 2/2 containers · ☾ 1 asleep" — asleep on demand counts as up, and is said apart in its own calm colour */
function MemberCounts({ live, className = 'text-slate-400' }: { live: FleetMemberLive; className?: string }) {
  const n = memberCounts(live)
  const r = memberRatio(live)
  return (
    <span className={`${className} tabular-nums inline-flex items-center gap-1.5 min-w-0`} title={r.hint}>
      <span className={r.problem ? 'text-amber-300' : ''}>{live.stacks_total} stack{live.stacks_total === 1 ? '' : 's'} · {r.text}</span>
      <AsleepCount n={n.asleep} stuck={n.stuck} />
    </span>
  )
}
/** the small chevron that folds an open block back to its one line */
function CollapseButton({ onClick }: { onClick: () => void }) {
  return <Hint label="Collapse"><button type="button" onClick={onClick} aria-label="Collapse" className={`${BTN_ICON_SM} text-slate-500 hover:text-slate-200 hover:bg-white/10`}><ChevronUp size={12} /></button></Hint>
}

// The VM is the stack: a member that runs exactly one stack shows the containers running in it,
// with start/stop/restart per container, Open (the Stacks page), Edit compose and the stack's own controls.
// onCollapse (the card): a chevron in the header folds the block back to its one line.
function VmContainers({ member, live, stack, isAdmin, onStackAction, busyKey, onOpen, onCollapse }: { member: FleetMemberBase; live: FleetMemberLive; stack: StackInfo; isAdmin: boolean; onStackAction: (m: FleetMemberBase, stack: string, a: StackAct) => void; busyKey: string; onOpen: (stack: string, edit: boolean) => void; onCollapse?: () => void }) {
  const { addToast } = useToast()
  const [cbusy, setCbusy] = useState('')
  const containers = stackContainers(live, stack)
  const busy = busyKey === `${member.id}/${stack.name}`
  const isRunning = isRunningContainer
  const act = async (name: string, a: 'start' | 'stop' | 'restart') => {
    setCbusy(`${name}:${a}`)
    try {
      const fn = a === 'start' ? startContainer : a === 'stop' ? stopContainer : restartContainer
      await fn(name, member.id)
      addToast({ type: 'success', message: `${name}: ${a} sent to ${member.name}` })
    } catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : `${a} failed` }) } finally { setCbusy('') }
  }
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.04]">
        <StackDot stack={stack} size={8} />
        <p className="text-[11px] font-medium text-slate-200 flex-1 truncate tabular-nums">{containersLine(countStates(containers))}</p>
        {isAdmin && (busy ? <Loader2 size={13} className="animate-spin text-cyan-400" /> : (
          <div className="flex items-center gap-0.5">
            {stack.status !== 'running' && <Hint label="Start the stack"><button aria-label="Start the stack" type="button" onClick={() => onStackAction(member, stack.name, 'start')} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Play size={12} /></button></Hint>}
            {stack.status === 'running' && <Hint label="Restart the stack"><button aria-label="Restart the stack" type="button" onClick={() => onStackAction(member, stack.name, 'restart')} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><RotateCcw size={12} /></button></Hint>}
            {stack.status === 'running' && <Hint label="Stop the stack"><button aria-label="Stop the stack" type="button" onClick={() => onStackAction(member, stack.name, 'stop')} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}><Square size={12} /></button></Hint>}
          </div>
        ))}
        {onCollapse && <CollapseButton onClick={onCollapse} />}
      </div>
      {containers.length > 0 && (
        <div className="divide-y divide-white/[0.04] max-h-56 overflow-y-auto scrollbar-thin">
          {containers.map((c) => {
            const running = isRunning(c)
            const cs = containerState(c)
            const sleepy = cs === 'asleep' || cs === 'stuck'
            return (
              <div key={c.name} className="flex items-center gap-2.5 px-2.5 py-1.5">
                <StateDot state={cs} size={6} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-slate-200 truncate">{c.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{sleepy ? <span className={STATE_META[cs].text} title={STATE_META[cs].hint}>{cs === 'asleep' ? 'asleep · wakes on the first request' : "on demand, but Sablier is not running"}</span> : c.image}{c.uptime_seconds ? ` · up ${fmtUptime(c.uptime_seconds)}` : ''}{c.health && c.health !== 'none' && !sleepy ? ` · ${c.health}` : ''}</p>
                </div>
                {isAdmin && (cbusy.startsWith(`${c.name}:`) ? <Loader2 size={12} className="animate-spin text-cyan-400" /> : (
                  <div className="flex items-center gap-0.5">
                    {!running && <Hint label={sleepy ? 'Wake it now (Sablier puts it back to sleep when idle)' : 'Start'}><button aria-label={`${sleepy ? 'Wake' : 'Start'} ${c.name}`} type="button" onClick={() => act(c.name, 'start')} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Play size={12} /></button></Hint>}
                    {running && <Hint label="Restart"><button aria-label={`Restart ${c.name}`} type="button" onClick={() => act(c.name, 'restart')} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><RotateCcw size={12} /></button></Hint>}
                    {running && <Hint label="Stop"><button aria-label={`Stop ${c.name}`} type="button" onClick={() => act(c.name, 'stop')} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}><Square size={12} /></button></Hint>}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-white/[0.04] flex-wrap">
        <button type="button" onClick={() => onOpen(stack.name, false)} className={BTN_CARD_QUIET}><Layers size={12} /> Open</button>
        {isAdmin && <button type="button" onClick={() => onOpen(stack.name, true)} className={BTN_CARD_QUIET}><Pencil size={12} /> Edit compose</button>}
      </div>
    </div>
  )
}

function MemberStacks({ member, live, isAdmin, onStackAction, busyKey, onCollapse }: { member: FleetMemberBase; live?: FleetMemberLive; isAdmin: boolean; onStackAction: (m: FleetMemberBase, stack: string, a: StackAct) => void; busyKey: string; onCollapse?: () => void }) {
  const stacks = live?.stacks ?? []
  if (!live) return <p className="text-[11px] text-slate-500 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Reading {member.name}'s stacks…</p>
  if (!live.reachable) return <p className="text-[11px] text-rose-300/90">{member.name} did not answer{live.error ? `: ${live.error}` : ''}</p>
  if (stacks.length === 0) return <p className="text-[11px] text-slate-500">No stacks on {member.name} yet — deploy a template here.</p>
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] divide-y divide-white/[0.04]">
      {onCollapse && (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${stacks.some((st) => st.status === 'running') ? 'bg-emerald-400' : stacks.some((st) => stackIsFine(st)) ? 'bg-indigo-400' : 'bg-slate-500'}`} />
          <p className="text-[11px] font-medium text-slate-200 flex-1 truncate tabular-nums">{stacksLine(live)}</p>
          <CollapseButton onClick={onCollapse} />
        </div>
      )}
      {stacks.map((st: StackInfo) => {
        const key = `${member.id}/${st.name}`
        const busy = busyKey === key
        return (
          <div key={st.name} className="flex items-center gap-2.5 px-2.5 py-1.5">
            <StackDot stack={st} size={8} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-200 truncate">{st.name}</p>
              <p className="text-[10px] text-slate-500">{st.status === 'running'
                ? <>{st.running_containers} container{st.running_containers === 1 ? '' : 's'} running{(st.sleeping_containers ?? 0) > 0 && <> · <AsleepCount n={st.sleeping_containers ?? 0} /></>}</>
                : stackState(st) === 'asleep' ? <span className="text-indigo-300" title={STACK_META.asleep.hint}>asleep · wakes on the first request</span>
                : stackState(st) === 'stuck' ? <span className="text-amber-400" title={STACK_META.stuck.hint}>on demand, but Sablier is not running</span>
                : 'stopped'}</p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-0.5">
                {busy ? <Loader2 size={13} className="animate-spin text-cyan-400" /> : (
                  <>
                    {st.status !== 'running' && <Hint label="Start"><button aria-label={`Start ${st.name}`} type="button" onClick={() => onStackAction(member, st.name, 'start')} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Play size={12} /></button></Hint>}
                    {st.status === 'running' && <Hint label="Restart"><button aria-label={`Restart ${st.name}`} type="button" onClick={() => onStackAction(member, st.name, 'restart')} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><RotateCw size={12} /></button></Hint>}
                    {st.status === 'running' && <Hint label="Stop"><button aria-label={`Stop ${st.name}`} type="button" onClick={() => onStackAction(member, st.name, 'stop')} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}><Square size={12} /></button></Hint>}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// -----------------------------------------------------------------------------
// One guest: as a card, as a table row, and its details sheet
// -----------------------------------------------------------------------------

interface VmRowProps {
  vm: ProxmoxVm
  isAdmin: boolean
  isHub: boolean
  member?: FleetMemberBase
  live?: FleetMemberLive
  scan?: FleetGuestScan
  /** this guest is the machine the dashboard runs on (the hub's own VM or container): it has no member of its own */
  isSelf?: boolean
  busyKey: string
  /** the card shows its containers block open (the page remembers this per guest for the visit) */
  expanded: boolean
  onToggleExpand: () => void
  /** the Proxmox web UI (the API's origin), for "Open in Proxmox" */
  pveUrl: string
  onAction: (vm: ProxmoxVm, a: ProxmoxVmAction) => void
  onStackAction: (m: FleetMemberBase, stack: string, a: StackAct) => void
  onDeploy: (m: FleetMemberBase) => void
  /** the folders of the Proxmox host this VM has (a hub's member VM) */
  onFolders: (m: FleetMemberBase) => void
  /** an ssh key for this VM (the ssh sheet with it ticked) */
  onSsh: (m: FleetMemberBase) => void
  onLink: (p: MemberSheetPrefill) => void
  onMemberMenu: (m: FleetMemberBase) => void
  onDetails: (vm: ProxmoxVm) => void
  /** take a snapshot of this guest (the sheet that asks for its name) */
  onSnapshot: (vm: ProxmoxVm) => void
  /** open the stack on the Stacks page (edit: straight into its compose) */
  onOpen: (stack: string, edit: boolean) => void
  /** the table shows its Node column only where there is more than one node to tell apart */
  showNode?: boolean
}

/** the DCS chip a member row wears, in the fleet's violet: version, and the member's name when it differs from the guest's (offline: the guest is off, so the recorded version in grey; a member that does not answer, in rose) */
function DcsChip({ vm, member, live, offline = false }: { vm: ProxmoxVm; member: FleetMemberBase; live?: FleetMemberLive; offline?: boolean }) {
  const tone: Tone = offline ? 'neutral' : live && !live.reachable ? 'problem' : 'fleet'
  return (
    <Tooltip label={`${member.name} at ${member.url}${member.matched_by ? ` — ${MATCH_LABEL[member.matched_by]}` : ''}`}>
      <Pill tone={tone} icon={<Satellite size={10} />}>
        DCS {member.version || '?'}{member.name !== vm.name ? ` · ${member.name}` : ''}{offline ? ' · offline' : ''}
      </Pill>
    </Tooltip>
  )
}

/** what the scan found in a guest that has no member yet, with the link button */
/** amber where a DCS answers that nobody linked yet (a to-do); violet for the hub itself */
function ScanLine({ vm, scan, onLink, isSelf = false, wrap = false }: { vm: ProxmoxVm; scan?: FleetGuestScan; onLink: (p: MemberSheetPrefill) => void; isSelf?: boolean; wrap?: boolean }) {
  // a card's line truncates; a table cell wraps (its column would otherwise be as wide as the sentence)
  const fit = wrap ? 'min-w-0' : 'min-w-0 truncate'
  if (isSelf) return <span className={`text-violet-300 flex items-center gap-1.5 ${fit}`}><Satellite size={11} className="shrink-0" /> This hub — the dashboard you are looking at runs here</span>
  const found = scan?.dcs && !scan.member ? scan.dcs : null
  return found ? (
    <>
      <span className={`text-amber-200 flex items-center gap-1.5 ${fit}`}><Radar size={11} className="shrink-0" /> DCS {found.version} answers at {found.ip}:{found.port}</span>
      <button type="button" onClick={() => onLink({ name: vm.name, url: found.url, vmid: vm.vmid, node: vm.node, type: vm.type })} className={`${BTN_CARD} ${TONE_ATTN} font-medium`}><Link2 size={12} /> Link</button>
    </>
  ) : (
    <>
      <span className={`text-slate-500 ${wrap ? '' : 'truncate'}`}>No DCS linked{scan && scan.ips.length === 0 ? ' · address unknown (no guest agent)' : ''}</span>
      <button type="button" onClick={() => onLink({ name: vm.name, vmid: vm.vmid, node: vm.node, type: vm.type })} className={BTN_CARD_QUIET}><Link2 size={12} /> Link…</button>
    </>
  )
}

/** one of a card's two meters: label, value, its note and the bar — the bar empty and the numbers grey while the guest is off */
function GuestMeter({ label, value, note, pct, live, mark }: { label: string; value: string; note: string; pct: number; live: boolean; mark?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`flex items-center justify-between gap-2 mb-1 ${live ? 'text-slate-400' : 'text-slate-600'}`}>
        <span className="flex items-center gap-1.5 shrink-0">{label}{mark}</span>
        <span className={`tabular-nums truncate ${live ? 'text-slate-300' : 'text-slate-500'}`}>{value} <span className="text-slate-600">{note}</span></span>
      </div>
      <Bar pct={live ? pct : 0} />
    </div>
  )
}

/** the containers block of a member's card: one line folded (what runs, a chevron), the stack's controls when open;
 *  a member that is off, unread or not answering keeps the slot with one line, so every card reads the same */
function ContainersBlock({ vm, member, live, isAdmin, busyKey, expanded, onToggle, onStackAction, onOpen }: { vm: ProxmoxVm; member: FleetMemberBase; live?: FleetMemberLive; isAdmin: boolean; busyKey: string; expanded: boolean; onToggle: () => void; onStackAction: VmRowProps['onStackAction']; onOpen: VmRowProps['onOpen'] }) {
  const quiet = 'min-h-8 flex items-center gap-1.5 text-[11px] text-slate-500 min-w-0'
  if (!live) return <p className={quiet}><Loader2 size={11} className="animate-spin shrink-0" /> <span className="truncate">Reading {member.name}'s stacks…</span></p>
  if (!live.reachable) {
    if (vm.status !== 'running') return <p className={quiet}><span className="truncate">Offline — its containers show once it runs</span></p>
    const msg = `${member.name} did not answer${live.error ? `: ${live.error}` : ''}`
    return <p className="min-h-8 flex items-center text-[11px] text-rose-300/90 min-w-0" title={msg}><span className="truncate">{msg}</span></p>
  }
  const stacks = live.stacks
  if (stacks.length === 0) return <p className={quiet}><span className="truncate">No stacks on {member.name} yet — deploy a template here.</span></p>
  const single = stacks.length === 1 ? stacks[0] : null
  if (expanded) {
    return single
      ? <VmContainers member={member} live={live} stack={single} isAdmin={isAdmin} onStackAction={onStackAction} busyKey={busyKey} onOpen={onOpen} onCollapse={onToggle} />
      : <MemberStacks member={member} live={live} isAdmin={isAdmin} onStackAction={onStackAction} busyKey={busyKey} onCollapse={onToggle} />
  }
  const inStack = single ? stackContainers(live, single) : []
  const text = single ? containersLine(countStates(inStack)) : stacksLine(live)
  const up = stacks.some((st) => st.status === 'running')
  const asleepOnly = !up && stacks.some((st) => stackIsFine(st))
  return (
    <Hint label="Show the containers and their controls">
      <button type="button" onClick={onToggle} aria-expanded={false} className="w-full h-8 px-2.5 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] text-[11px] flex items-center gap-2 min-w-0 transition-colors">
        {asleepOnly ? <Moon size={11} className="text-indigo-300 shrink-0" aria-label="asleep" /> : <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${up ? 'bg-emerald-400' : 'bg-slate-500'}`} />}
        <span className="flex-1 truncate text-left font-medium text-slate-200 tabular-nums">{text}</span>
        <ChevronDown size={12} className="text-slate-500 shrink-0" />
      </button>
    </Hint>
  )
}

// Every card has the same slots in the same order: (a) who it is, (b) the facts, (c) the meters, (d) the DCS inside,
// (e) the containers (a member only; folded to one line), (f) the actions on the bottom edge. The grid stretches
// the cards of a row to the tallest, so the actions line up.
function VmCard(p: VmRowProps) {
  const { vm, isAdmin, isHub, member, live, scan, busyKey, pveUrl, expanded, onToggleExpand, onAction, onStackAction, onDeploy, onFolders, onSsh, onLink, onMemberMenu, onDetails, onSnapshot, onOpen } = p
  const acts = actionsFor(vm)
  const running = vm.status === 'running'
  return (
    <div className={`${CARD} p-3.5 h-full flex flex-col gap-2.5 min-w-0 ${member ? 'border-violet-500/15' : ''}`}>
      <div className="flex items-start gap-2.5">
        <StatusDot status={vm.status} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Hint label="Details, memory and ballooning"><button type="button" onClick={() => onDetails(vm)} className="font-semibold text-slate-100 truncate min-w-0 text-left hover:text-violet-200 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">{vm.name}</button></Hint>
            <TypeChip type={vm.type} />
            <span className="text-[11px] text-slate-500 font-mono shrink-0">#{vm.vmid}</span>
            {vm.intended && <span className="text-[10px] text-violet-300/90 shrink-0" title="DCS asked for the last change">by DCS</span>}
            {vm.lock && <span className="text-[10px] text-amber-400/80 shrink-0">locked: {vm.lock}</span>}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-x-2 min-w-0 whitespace-nowrap">
            <span className="flex items-center gap-1 shrink-0"><Server size={10} /> {vm.node}</span>
            <span className="capitalize shrink-0">{vm.status}</span>
            <span className="flex items-center gap-1 tabular-nums shrink-0" title="Uptime"><Clock size={10} /> {running ? fmtUptime(vm.uptime) : '—'}</span>
            {vm.tags.length > 0 && <span className="flex items-center gap-1 min-w-0 overflow-hidden"><TagChips tags={vm.tags} max={2} /></span>}
          </div>
        </div>
        {member && isAdmin && (
          <Hint label={`Manage ${member.name}`}><button aria-label={`Manage ${member.name}`} type="button" onClick={() => onMemberMenu(member)} className={BTN_ICON_QUIET}><MoreHorizontal size={14} /></button></Hint>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <GuestMeter label="CPU" live={running} pct={vm.cpu} value={running ? `${fmtPct(vm.cpu)}%` : '—'} note={`of ${vm.maxcpu}`} />
        <GuestMeter label="RAM" live={running} pct={vm.mem_pct} value={running ? fmtBytes(vm.mem) : '—'} note={`/ ${fmtBytes(vm.maxmem)}`} mark={running && vm.mem_pct >= 95 ? <HostViewMark onClick={() => onDetails(vm)} /> : null} />
      </div>
      {/* the DCS inside this guest: a member's chip and counts, what the scan found, or none */}
      <div className="min-h-8 flex items-center gap-x-2 text-[11px] min-w-0">
        {member ? (
          <>
            <DcsChip vm={vm} member={member} live={live} offline={!running} />
            {live?.reachable && <MemberCounts live={live} className="text-slate-400 shrink-0" />}
            <span className="text-slate-600 font-mono truncate min-w-0">{hostOf(member.url)}</span>
          </>
        ) : isHub && running && isAdmin ? (
          <div className="flex-1 flex items-center justify-between gap-2 min-w-0"><ScanLine vm={vm} scan={scan} onLink={onLink} isSelf={p.isSelf} /></div>
        ) : (
          <span className="text-slate-600">no DCS</span>
        )}
      </div>
      {member && <ContainersBlock vm={vm} member={member} live={live} isAdmin={isAdmin} busyKey={busyKey} expanded={expanded} onToggle={onToggleExpand} onStackAction={onStackAction} onOpen={onOpen} />}
      <div className="mt-auto flex items-center gap-1.5 flex-wrap pt-0.5">
        {isAdmin && acts.map((a) => <ActionButton key={a} a={a} onClick={() => onAction(vm, a)} labeled={a === 'start' || a === 'resume'} />)}
        <span className="flex-1" />
        {member && isAdmin && <Hint label="Deploy a template into this VM"><button type="button" onClick={() => onDeploy(member)} aria-label="Deploy a template into this VM" className={`${BTN_ICON} ${TONE_OK}`}><Rocket size={14} /></button></Hint>}
        {member && isAdmin && isHub && vm.type === 'qemu' && <Hint label="Host folders: give this VM a folder of the Proxmox host (media for Jellyfin, Sonarr, Radarr)"><button type="button" onClick={() => onFolders(member)} aria-label={`Host folders of ${member.name}`} className={BTN_ICON_QUIET}><FolderInput size={14} /></button></Hint>}
        {member && isAdmin && isHub && vm.type === 'qemu' && <Hint label="SSH: a key of your own for this VM"><button type="button" onClick={() => onSsh(member)} aria-label={`SSH into ${member.name}`} className={BTN_ICON_QUIET}><TerminalSquare size={14} /></button></Hint>}
        {isAdmin && <Hint label="Take a snapshot (the list is in the details)"><button type="button" onClick={() => onSnapshot(vm)} aria-label={`Snapshot ${vm.name}`} className={BTN_ICON_QUIET}><Camera size={14} /></button></Hint>}
        {/* the two outbound links stay in the details sheet on a phone, where the row would wrap */}
        {member && member.identity?.dashboard !== false && <Hint label="Its own dashboard (port 3000)"><a aria-label="Its own dashboard (port 3000)" href={member.url.replace(/:\d+$/, ':3000')} target="_blank" rel="noreferrer" className={`${BTN_ICON_QUIET} hidden sm:flex`}><LayoutDashboard size={14} /></a></Hint>}
        {pveUrl && <Hint label="Open in Proxmox"><a aria-label="Open in Proxmox" href={proxmoxLink(pveUrl, vm)} target="_blank" rel="noreferrer" className={`${BTN_ICON_QUIET} hidden sm:flex`}><ExternalLink size={14} /></a></Hint>}
        <Hint label="Details, memory and ballooning"><button aria-label="Details, memory and ballooning" type="button" onClick={() => onDetails(vm)} className={BTN_ICON_QUIET}><Info size={14} /></button></Hint>
      </div>
    </div>
  )
}

/** a guest card's shape while the list loads: the name line, the facts, two meters, the DCS line, the actions */
function GuestCardSkeleton() {
  const meter = <div className="space-y-1.5"><div className="skeleton h-3 w-full rounded" /><div className="skeleton h-1.5 w-full rounded-full" /></div>
  return (
    <div className={`${CARD} p-3.5 flex flex-col gap-3 min-h-[13rem]`} aria-hidden>
      <div className="flex items-center gap-2.5"><div className="skeleton w-2.5 h-2.5 rounded-full" /><div className="skeleton h-4 w-32 rounded" /><div className="skeleton h-[18px] w-9 rounded-full" /></div>
      <div className="skeleton h-3 w-44 rounded" />
      <div className="grid grid-cols-2 gap-3">{meter}{meter}</div>
      <div className="skeleton h-5 w-40 rounded-full" />
      <div className="mt-auto flex gap-1.5"><div className="skeleton h-8 w-8" /><div className="skeleton h-8 w-8" /><div className="skeleton h-8 w-8" /><span className="flex-1" /><div className="skeleton h-8 w-8" /></div>
    </div>
  )
}

/** an overview card's shape while the nodes are read: its label row, a title, three meters, a note and its footer */
function OverviewCardSkeleton() {
  return (
    <div className={`${CARD} p-4 min-h-[15rem] flex flex-col gap-3`} aria-hidden>
      <div className="flex items-center justify-between"><div className="skeleton h-3 w-20 rounded" /><div className="skeleton h-3 w-14 rounded" /></div>
      <div className="skeleton h-4 w-32 rounded" />
      <div className="grid grid-cols-3 gap-3"><div className="skeleton h-9 rounded" /><div className="skeleton h-9 rounded" /><div className="skeleton h-9 rounded" /></div>
      <div className="skeleton h-3 w-2/3 rounded" />
      <div className="mt-auto skeleton h-3 w-1/2 rounded" />
    </div>
  )
}

function MiniMeter({ pct, text, note, hostView, onHostView }: { pct: number; text: string; note?: string; hostView?: boolean; onHostView?: () => void }) {
  return (
    <div className="min-w-[7rem]">
      <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-slate-300 whitespace-nowrap">{text}{note && <span className="text-slate-600">{note}</span>}{hostView && <HostViewMark onClick={onHostView} />}</div>
      <Bar pct={pct} className="mt-1 w-24" />
    </div>
  )
}

function VmTableRow(p: VmRowProps) {
  const { vm, isAdmin, isHub, member, live, scan, pveUrl, onAction, onDeploy, onFolders, onSsh, onLink, onMemberMenu, onDetails, onSnapshot, showNode = true } = p
  const acts = actionsFor(vm)
  const running = vm.status === 'running'
  const th = 'px-3 py-2 align-middle'
  return (
    <tr className={`hover:bg-white/[0.02] transition-colors ${member ? 'bg-violet-500/[0.03]' : ''}`}>
      <td className={th}>
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={vm.status} />
          <Hint label="Details, memory and ballooning"><button type="button" onClick={() => onDetails(vm)} className="text-sm font-medium text-slate-100 hover:text-violet-200 truncate text-left transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">{vm.name}</button></Hint>
          <TypeChip type={vm.type} />
          {vm.intended && <span className="text-[10px] text-violet-300/90" title="DCS asked for the last change">by DCS</span>}
          {vm.lock && <span className="text-[10px] text-amber-400/80">locked</span>}
        </div>
        {vm.tags.length > 0 && <div className="mt-1 flex items-center gap-1 pl-[1.125rem]"><TagChips tags={vm.tags} max={3} /></div>}
      </td>
      <td className={`${th} font-mono text-xs text-slate-400 tabular-nums`}>#{vm.vmid}</td>
      <td className={`${th} text-xs whitespace-nowrap`}><span className="capitalize text-slate-300">{vm.status}</span>{running && <span className="text-slate-500 tabular-nums"> · {fmtUptime(vm.uptime)}</span>}</td>
      {showNode && <td className={`${th} text-xs text-slate-400`}>{vm.node}</td>}
      <td className={th}><MiniMeter pct={running ? vm.cpu : 0} text={running ? `${fmtPct(vm.cpu)}%` : '—'} note={`${vm.maxcpu} vCPU`} /></td>
      <td className={th}><MiniMeter pct={running ? vm.mem_pct : 0} text={running ? `${fmtBytes(vm.mem)} / ${fmtBytes(vm.maxmem)}` : fmtBytes(vm.maxmem)} hostView={running && vm.mem_pct >= 95} onHostView={() => onDetails(vm)} /></td>
      <td className={`${th} text-[11px]`}>
        {member ? (
          <div className="flex items-center gap-2 flex-wrap">
            <DcsChip vm={vm} member={member} live={live} />
            {live?.reachable ? <MemberCounts live={live} /> : live ? <span className="text-rose-300/90">no answer</span> : <Loader2 size={11} className="animate-spin text-slate-500" />}
          </div>
        ) : isHub && running && isAdmin ? (
          <div className="flex items-center gap-2 flex-wrap"><ScanLine vm={vm} scan={scan} onLink={onLink} isSelf={p.isSelf} wrap /></div>
        ) : <span className="text-slate-600">—</span>}
      </td>
      <td className={th}>
        <div className="flex items-center justify-end gap-1">
          {isAdmin && acts.map((a) => <ActionButton key={a} a={a} onClick={() => onAction(vm, a)} small />)}
          {member && isAdmin && <Hint label="Deploy a template into this VM"><button aria-label="Deploy a template into this VM" type="button" onClick={() => onDeploy(member)} className={`${BTN_ICON_SM} ${TONE_OK}`}><Rocket size={12} /></button></Hint>}
          {member && isAdmin && isHub && vm.type === 'qemu' && <Hint label="Host folders: give this VM a folder of the Proxmox host"><button aria-label={`Host folders of ${member.name}`} type="button" onClick={() => onFolders(member)} className={BTN_ICON_SM_QUIET}><FolderInput size={12} /></button></Hint>}
          {member && isAdmin && isHub && vm.type === 'qemu' && <Hint label="SSH: a key of your own for this VM"><button aria-label={`SSH into ${member.name}`} type="button" onClick={() => onSsh(member)} className={BTN_ICON_SM_QUIET}><TerminalSquare size={12} /></button></Hint>}
          {isAdmin && <Hint label="Take a snapshot (the list is in the details)"><button aria-label={`Snapshot ${vm.name}`} type="button" onClick={() => onSnapshot(vm)} className={BTN_ICON_SM_QUIET}><Camera size={12} /></button></Hint>}
          {pveUrl && <Hint label="Open in Proxmox"><a aria-label="Open in Proxmox" href={proxmoxLink(pveUrl, vm)} target="_blank" rel="noreferrer" className={BTN_ICON_SM_QUIET}><ExternalLink size={12} /></a></Hint>}
          <Hint label="Details, memory and ballooning"><button aria-label="Details" type="button" onClick={() => onDetails(vm)} className={BTN_ICON_SM_QUIET}><Info size={12} /></button></Hint>
          {member && isAdmin && <Hint label={`Manage ${member.name}`}><button aria-label={`Manage ${member.name}`} type="button" onClick={() => onMemberMenu(member)} className={BTN_ICON_SM_QUIET}><MoreHorizontal size={12} /></button></Hint>}
        </div>
      </td>
    </tr>
  )
}

function VmTable({ rows, render, showNode = true }: { rows: ProxmoxVm[]; render: (vm: ProxmoxVm) => ReactNode; showNode?: boolean }) {
  const head = 'px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap'
  return (
    <div className={`${CARD} overflow-x-auto scrollbar-thin`}>
      <table className="w-full min-w-[68rem] text-left border-collapse">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {['Name', 'VMID', 'Status', ...(showNode ? ['Node'] : []), 'CPU', 'RAM', 'DCS'].map((h) => <th key={h} scope="col" className={head}>{h}</th>)}
            <th scope="col" className={`${head} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">{rows.map(render)}</tbody>
      </table>
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-100 tabular-nums mt-0.5 truncate">{value}</p>
      {note && <p className="text-[10px] text-slate-500 truncate tabular-nums">{note}</p>}
    </div>
  )
}

/** A guest's details: live load, memory with its balloon state, the configuration, the DCS inside, the power actions */
function VmSheet({ vm, member, live, isAdmin, busyKey, pveUrl, refreshTick = 0, snapTick = 0, onClose, onAction, onStackAction, onOpen, onChanged, onPaused, onSnapshot }: {
  vm: ProxmoxVm; member?: FleetMemberBase; live?: FleetMemberLive; isAdmin: boolean; busyKey: string; pveUrl: string
  /** bumped by the page after a power action went through: the sheet reads the guest again right away instead of at its next poll */
  refreshTick?: number
  /** bumped by the page after a snapshot was taken: the Snapshots section reads its list again */
  snapTick?: number
  onSnapshot: (vm: ProxmoxVm) => void
  onClose: () => void; onAction: (vm: ProxmoxVm, a: ProxmoxVmAction) => void; onStackAction: (m: FleetMemberBase, stack: string, a: StackAct) => void; onOpen: (stack: string, edit: boolean) => void; onChanged: () => void
  /** Proxmox's list keeps "running" for a paused VM; the sheet reads the QEMU state and tells the page, so the card shows it while the sheet is open */
  onPaused: (key: string, paused: boolean) => void
}) {
  const detail = usePolling(() => fetchProxmoxVm(vm.node, vm.type, vm.vmid), LIST_POLL)
  const confirm = useConfirm()
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const d = detail.data
  const { refresh: refreshDetail } = detail
  useEffect(() => { if (refreshTick) refreshDetail() }, [refreshTick, refreshDetail])
  // after Suspend the list still says "running": only the detail's qmpstatus says paused — the state shown and the actions
  // offered (Resume) follow it, and the page hears about it for the card
  const paused = vm.type === 'qemu' && d?.qmpstatus === 'paused'
  const shown: ProxmoxVm = paused ? { ...vm, status: 'paused' } : vm
  const key = guestKey(vm)
  useEffect(() => { onPaused(key, paused); return () => onPaused(key, false) }, [key, paused, onPaused])
  const running = (d?.status ?? vm.status) === 'running'
  const mem = d?.mem ?? vm.mem, maxmem = d?.maxmem ?? vm.maxmem
  const pct = maxmem > 0 ? Math.round((mem / maxmem) * 1000) / 10 : 0
  // the API emits the balloon floor in MiB (the VM's config value as is)
  const balloonBytes = (d?.balloon ?? 0) * 1048576
  const agentOn = /^(1|enabled=1)/.test(d?.agent ?? '')
  const enableBalloon = async () => {
    // the floor the API sets: the memory minus a quarter, at most 512 MB — three quarters or more stay with the guest
    if (!(await confirm({ title: 'Enable ballooning?', message: `Give ${vm.name} a memory balloon with three quarters or more of its memory as the floor? Proxmox then reports the guest's real memory use and can reclaim idle memory. It takes effect at the next reboot.`, confirmLabel: 'Enable ballooning' }))) return
    setBusy(true)
    try { const r = await proxmoxVmBalloon(vm.node, vm.vmid); addToast({ type: 'success', message: r.message || `Balloon set to ${r.balloon} MB of ${r.memory} MB` }); detail.refresh(); onChanged() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'Ballooning could not be enabled' }) }
    finally { setBusy(false) }
  }
  const facts: [string, ReactNode][] = []
  if (d) {
    if (d.qmpstatus && d.qmpstatus !== d.status) facts.push(['QEMU state', d.qmpstatus])
    if (d.config.cores) facts.push(['Cores', `${d.config.cores}${d.config.sockets && d.config.sockets > 1 ? ` × ${d.config.sockets} sockets` : ''}`])
    if (d.config.memory) facts.push(['Memory', `${d.config.memory} MB`])
    // what runs in it: the guest's own answer first, then the DCS in it, then Proxmox's OS type
    const osName = d.os?.name || member?.identity?.os || ''
    if (osName) facts.push(['Operating system', <span>{osName}{d.os?.kernel ? <span className="text-slate-500"> · kernel {d.os.kernel.replace(/[+-].*$/, '')}</span> : null}</span>])
    else if (d.config.ostype) facts.push(['OS type', vm.type === 'lxc' ? d.config.ostype : `${d.config.ostype} (start the VM with its guest agent to see the system)`])
    if (d.image) facts.push(['Built from', <span>{d.image.label}{d.image.template_vmid ? <span className="text-slate-500"> · cloned from the DCS template VM {d.image.template_vmid}</span> : null}</span>])
    if (vm.type === 'qemu' && d.config.bios !== undefined) facts.push(['Firmware', `${d.config.bios === 'ovmf' ? 'UEFI (OVMF)' : 'BIOS (SeaBIOS)'}${d.config.machine ? ` · ${d.config.machine.replace(/^pc-(i440fx|q35)-.*/, (_m, t: string) => (t === 'q35' ? 'q35' : 'i440fx'))}` : ''}`])
    // Proxmox starts every VM with -boot menu=on: the firmware then waits about 2.6 s for an ESC key, at every boot. Only root can switch it off.
    if (vm.type === 'qemu') facts.push(['Boot menu wait', /menu=off/.test(d.config.args ?? '') ? 'off' : <span>on <span className="text-slate-500">· 2.6 s at every boot; on the node: <code className="font-mono">qm set {vm.vmid} --args '-boot menu=off,strict=on,reboot-timeout=1000'</code></span></span>])
    if (d.config.created) facts.push(['Created', new Date(d.config.created * 1000).toLocaleDateString()])
    if (vm.type === 'qemu') facts.push(['Guest agent', agentOn ? 'enabled' : 'off'])
    facts.push(['Starts with the host', d.config.onboot === '1' ? 'yes' : 'no'])
    if (d.config.bootdisk) facts.push(['Boot disk', d.config.bootdisk])
    if (d.config.net0) facts.push(['net0', <span className="font-mono break-all">{d.config.net0}</span>])
    if (d.config.hostname) facts.push(['Hostname', d.config.hostname])
    if (running && (d.diskread || d.diskwrite)) facts.push(['Disk I/O', `${fmtBytes(d.diskread)} read · ${fmtBytes(d.diskwrite)} written`])
    if (d.lock) facts.push(['Lock', d.lock])
    if (d.config.description) facts.push(['Description', <span className="whitespace-pre-line break-words">{d.config.description}</span>])
  }
  return (
    <Sheet tone="fleet" title={vm.name} subtitle={<>
      {`${vm.type === 'qemu' ? 'VM' : 'Container'} ${vm.vmid} on ${vm.node} · ${shown.status}${running ? ` · up ${fmtUptime(d?.uptime ?? vm.uptime)}` : ''}`}
      {vm.tags.length > 0 && <span className="flex flex-wrap items-center gap-1 mt-1.5"><TagChips tags={vm.tags} /></span>}
    </>} icon={<Server size={18} />} onClose={onClose} wide footer={(isAdmin || pveUrl) ? (
      <div className="flex items-center gap-1.5 flex-wrap">
        {isAdmin && actionsFor(shown).map((a) => <ActionButton key={a} a={a} onClick={() => onAction(shown, a)} labeled />)}
        <span className="flex-1" />
        {pveUrl && <a href={proxmoxLink(pveUrl, vm)} target="_blank" rel="noreferrer" className={BTN_TOOLBAR_QUIET}><ExternalLink size={14} /> Open in Proxmox</a>}
      </div>
    ) : undefined}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label="CPU" value={running ? `${fmtPct(d?.cpu || vm.cpu)}%` : '—'} note={`${d?.cpus || vm.maxcpu} vCPU`} />
          <Tile label="Memory" value={running ? fmtBytes(mem) : fmtBytes(maxmem)} note={running ? `of ${fmtBytes(maxmem)}` : 'allocated'} />
          <Tile label="Disk" value={(d?.maxdisk ?? vm.maxdisk) ? fmtBytes(d?.maxdisk ?? vm.maxdisk) : '—'} note={d?.config.bootdisk || (vm.type === 'lxc' ? 'rootfs' : 'boot disk')} />
          <Tile label="Network" value={running ? `↓ ${fmtBytes(d?.netin ?? 0)}` : '—'} note={running ? `↑ ${fmtBytes(d?.netout ?? 0)}` : 'since boot'} />
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5 font-medium text-slate-300"><MemoryStick size={12} /> Memory</span>
            <span className="tabular-nums">{running ? `${fmtBytes(mem)} / ${fmtBytes(maxmem)} · ${fmtPct(pct)}%` : `${fmtBytes(maxmem)} allocated`}</span>
          </div>
          {running && <Bar pct={pct} className="mt-1.5" />}
          {vm.type !== 'qemu' ? (
            <p className="text-[11px] text-slate-500 mt-2">A container's memory is what its processes use — no balloon needed.</p>
          ) : !d ? (
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Reading the balloon state…</p>
          ) : balloonBytes > 0 ? (
            <p className="text-[11px] text-slate-400 mt-2">Balloon device on — floor {fmtBytes(balloonBytes)}{d.guest_mem_total ? ` · the guest sees ${fmtBytes(d.guest_mem_total)} with ${fmtBytes(d.guest_mem_free)} free` : ''}. Proxmox reports the guest's real use and can reclaim idle memory.</p>
          ) : (
            <div className="mt-2 flex items-start gap-2 flex-wrap">
              <p className="text-[11px] text-amber-200/90 flex-1 min-w-[14rem] flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-px" /><span>{running
                ? `Proxmox shows the host's view of this VM's memory — ${isAdmin ? 'enable ballooning (takes effect at the next reboot)' : 'an admin can enable ballooning for the real figure'}`
                : `No balloon device is reported while the VM is off${isAdmin ? ' — enabling ballooning now takes effect at the next boot' : ''}`}</span></p>
              {isAdmin && <button type="button" onClick={enableBalloon} disabled={busy} className={`${BTN_CARD} ${TONE_ATTN}`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <MemoryStick size={12} />} Enable ballooning</button>}
            </div>
          )}
        </div>

        {isAdmin && vm.type === 'qemu' && <VmDomainPanel vmid={vm.vmid} onDone={onChanged} />}
        {isAdmin && d && <ResizePanel vm={vm} running={running} cores={d.config.cores ?? d.cpus ?? 1} memoryMb={Number(String(d.config.memory ?? Math.round(maxmem / 1048576)).split(',')[0]) || 0} diskBytes={d.maxdisk ?? vm.maxdisk} onDone={() => { detail.refresh(); onChanged() }} />}
        <SnapshotsPanel key={snapTick} vm={shown} member={member} isAdmin={isAdmin} onTake={() => onSnapshot(shown)} onChanged={() => { detail.refresh(); onChanged() }} />
        {detail.error && !d && <p className="text-xs text-rose-300">{detail.error.message}</p>}
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[11px]">
            {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-slate-200 mt-0.5 break-words">{v}</dd></div>)}
          </dl>
        )}

        {member && (
          <div className="space-y-2">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px]">
              <DcsChip vm={vm} member={member} live={live} />
              {live?.reachable && <MemberCounts live={live} />}
              <span className="text-slate-600 font-mono truncate">{member.url}</span>
              {member.identity?.dashboard !== false && <a href={member.url.replace(/:\d+$/, ':3000')} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-200 flex items-center gap-1"><LayoutDashboard size={11} /> its dashboard</a>}
            </div>
            {live?.reachable && live.stacks.length === 1
              ? <VmContainers member={member} live={live} stack={live.stacks[0]} isAdmin={isAdmin} onStackAction={onStackAction} busyKey={busyKey} onOpen={onOpen} />
              : <MemberStacks member={member} live={live} isAdmin={isAdmin} onStackAction={onStackAction} busyKey={busyKey} />}
          </div>
        )}

      </div>
    </Sheet>
  )
}

/** More room for a guest: disk added on top (the filesystem of a fleet VM grows at once), cores and memory (a reboot applies them) */
// The domain a VM of the fleet answers under: one of the hub's domains (Settings → DNS & Routes), the hub's own by
// default. Changing it moves the VM's routes there at once (sonarr.howson.dev becomes sonarr.howson.lol).
function VmDomainPanel({ vmid, onDone }: { vmid: number; onDone: () => void }) {
  const { addToast } = useToast()
  const domains = usePolling(fetchDomains, 60000)
  const [busy, setBusy] = useState(false)
  const data = domains.data
  const entry = data?.domains.find((d) => d.vms.some((v) => v.vmid === vmid))
  const member = entry?.vms.find((v) => v.vmid === vmid)
  if (!data || !entry || !member || data.domains.length < 2) return null
  const change = async (to: string) => {
    if (to === entry.domain) return
    setBusy(true)
    try {
      const r = await setMemberDomain(member.id, to === data.primary ? '' : to)
      addToast({ type: 'success', message: r.message, duration: 9000 }); domains.refresh(); onDone()
    } catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'The VM did not take the domain', duration: 9000 }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"><Globe size={12} /> Domain <span className="text-slate-500 font-normal">· its apps answer under *.{entry.domain}</span></span>
      <span className="flex items-center gap-2">
        {busy && <Loader2 size={12} className="animate-spin text-cyan-400" aria-label="Moving its routes" />}
        <select value={entry.domain} disabled={busy} onChange={(e) => void change(e.target.value)} aria-label={`The domain ${member.name} answers under`}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/40">
          {data.domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}{d.primary ? ' (the hub)' : ''}</option>)}
        </select>
      </span>
    </div>
  )
}

function ResizePanel({ vm, running, cores, memoryMb, diskBytes, onDone }: { vm: ProxmoxVm; running: boolean; cores: number; memoryMb: number; diskBytes: number; onDone: () => void }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [addGb, setAddGb] = useState('0')
  const [c, setC] = useState(String(cores))
  const [memGb, setMemGb] = useState(String(Math.round((memoryMb / 1024) * 10) / 10))
  const [restart, setRestart] = useState(false)
  const [busy, setBusy] = useState(false)
  const add = Math.max(0, Math.floor(Number(addGb) || 0))
  const newCores = Math.floor(Number(c) || 0)
  const newMem = Math.round((Number(memGb) || 0) * 1024)
  const coresChanged = newCores > 0 && newCores !== cores
  const memChanged = newMem >= 512 && Math.abs(newMem - memoryMb) >= 64
  const valid = add <= 4096 && (!coresChanged || (newCores >= 1 && newCores <= 128)) && (!memChanged || newMem <= 1048576)
  const anything = add > 0 || coresChanged || memChanged
  const submit = async () => {
    if (!anything || !valid) return
    const parts = [add > 0 ? `${add} GB more disk (a disk never shrinks again)` : '', coresChanged ? `${newCores} cores` : '', memChanged ? `${Math.round(newMem / 102.4) / 10} GB of memory` : ''].filter(Boolean)
    if (!(await confirm({ title: `Resize ${vm.name}?`, message: `${parts.join(', ')}.${(coresChanged || memChanged) && running ? (restart ? ' The VM reboots to apply the cores and memory.' : ' The cores and memory apply at the next reboot.') : ''}`, confirmLabel: 'Resize' }))) return
    setBusy(true)
    try {
      const r = await proxmoxVmResize(vm.node, vm.type === 'lxc' ? 'lxc' : 'qemu', vm.vmid, { ...(add > 0 ? { disk_add_gb: add } : {}), ...(coresChanged ? { cores: newCores } : {}), ...(memChanged ? { memory_mb: newMem } : {}), restart })
      addToast({ type: 'success', message: r.message, duration: 9000 }); setAddGb('0'); setOpen(false); onDone()
    } catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'The resize failed', duration: 9000 }) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300"><HardDrive size={12} /> Size <span className="text-slate-500 font-normal">· {fmtBytes(diskBytes)} disk · {cores} cores · {Math.round((memoryMb / 1024) * 10) / 10} GB memory</span></span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={BTN_CARD_QUIET}>{open ? 'Close' : 'Resize'}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label htmlFor={`rs-disk-${vm.vmid}`} className={LABEL}>Add disk (GB)</label><input id={`rs-disk-${vm.vmid}`} type="number" min={0} max={4096} value={addGb} onChange={(e) => setAddGb(e.target.value)} className={`${INPUT_FLEET} tabular-nums`} disabled={busy} /></div>
            <div><label htmlFor={`rs-cores-${vm.vmid}`} className={LABEL}>Cores</label><input id={`rs-cores-${vm.vmid}`} type="number" min={1} max={128} value={c} onChange={(e) => setC(e.target.value)} className={`${INPUT_FLEET} tabular-nums`} disabled={busy} /></div>
            <div><label htmlFor={`rs-mem-${vm.vmid}`} className={LABEL}>Memory (GB)</label><input id={`rs-mem-${vm.vmid}`} type="number" min={0.5} step={0.5} value={memGb} onChange={(e) => setMemGb(e.target.value)} className={`${INPUT_FLEET} tabular-nums`} disabled={busy} /></div>
          </div>
          <p className="text-[11px] text-slate-500">A disk only grows. The filesystem of a VM the hub manages grows at once; other guests grow theirs at the next boot. Cores and memory take effect after a reboot.</p>
          {running && (coresChanged || memChanged) && (
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"><input type="checkbox" checked={restart} onChange={(e) => setRestart(e.target.checked)} className="h-4 w-4 accent-emerald-500" disabled={busy} /> Reboot now to apply the cores and memory</label>
          )}
          <button type="button" onClick={() => void submit()} disabled={busy || !anything || !valid} className={`${BTN_CARD} ${TONE_ATTN}`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <HardDrive size={12} />} Resize</button>
        </div>
      )}
    </div>
  )
}

function MemberMenuSheet({ member, vms, stacks = [], onClose, onEdit, onChanged, onSnapshot }: { member: FleetMemberBase; vms: ProxmoxVm[]; stacks?: string[]; onClose: () => void; onEdit: () => void; onChanged: () => void; onSnapshot: (vm: ProxmoxVm) => void }) {
  const { addToast } = useToast()
  // a stack of this VM moving back to the hub (its own sheet, over this one)
  const [moving, setMoving] = useState<string | null>(null)
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'test' | 'sync' | 'relink' | 'remove' | ''>('')
  const [note, setNote] = useState('')
  // destroying the VM asks for its name first, here in the sheet (a native prompt is not drawn by every window)
  const [destroying, setDestroying] = useState(false)
  const [typed, setTyped] = useState('')
  const destroyRef = useRef<HTMLButtonElement>(null)
  const cancelDestroy = () => { setDestroying(false); setTyped(''); requestAnimationFrame(() => destroyRef.current?.focus()) }
  const test = async () => {
    setBusy('test'); setNote('')
    try {
      const r = await testFleetMember(member.id)
      if (!r.reachable) { setNote(`Not reachable: ${r.error}`); return }
      setNote(`Answers as ${r.identity?.hostname || member.url}${r.version ? ` (DCS ${r.version})` : ''}${r.match ? ` · guest ${r.match.vmid} ${r.match.name} — ${MATCH_LABEL[r.match.matched_by]}` : ' · no guest matched'}`)
      onChanged()
    } catch (e) { setNote(e instanceof Error ? e.message : 'The test failed') } finally { setBusy('') }
  }
  // the hub lost the VM's password (the secret was deleted, the account changed) or is locked out of it: the VM joins again
  const relink = async () => {
    if (!(await confirm({ title: `Relink ${member.name}?`, message: `The hub opens ${member.name} over its ssh key, lifts its own lock-out there and has the VM join the hub again with a new password. Stacks, placement and settings stay as they are.`, confirmLabel: 'Relink' }))) return
    setBusy('relink'); setNote('')
    try {
      const r = await relinkFleetMember(member.id)
      addToast({ type: 'success', message: r.message, duration: 6000 }); onChanged()
    } catch (e) { setNote(e instanceof Error ? e.message : 'The relink failed') } finally { setBusy('') }
  }
  // the hub keeps a copy of every stack a VM runs: pull what the VM has now (a change made inside the VM, a stack
  // the hub never saw); the answer names what moved and what did not
  const sync = async () => {
    setBusy('sync'); setNote('')
    try {
      const r = await syncFleetMember(member.id, { direction: 'pull' })
      addToast({ type: r.success ? 'success' : 'warning', message: `${member.name}: ${r.message}`, duration: r.success ? 4000 : 8000 })
      if (r.failed.length > 0) setNote(r.failed.map((f) => `${f.name}: ${f.error}`).join(' · '))
      onChanged()
    } catch (e) { setNote(e instanceof Error ? e.message : 'The sync failed') } finally { setBusy('') }
  }
  const remove = async () => {
    if (!(await confirm({ title: 'Forget this member?', message: `Forget ${member.name}? Its stacks keep running; only the hub stops managing it.`, confirmLabel: 'Forget', danger: true }))) return
    setBusy('remove')
    try { await removeFleetMember(member.id); addToast({ type: 'success', message: `${member.name} removed from the fleet` }); onChanged(); onClose() }
    catch (e) { setNote(e instanceof Error ? e.message : 'Could not remove'); setBusy('') }
  }
  const destroy = async () => {
    if (typed !== member.name) return
    setBusy('remove')
    try { await removeFleetMember(member.id, true); addToast({ type: 'success', message: `VM ${member.vmid} (${member.name}) destroyed` }); onChanged(); onClose() }
    catch (e) { setNote(e instanceof Error ? e.message : 'Could not destroy the VM'); setBusy('') }
  }
  const guest = vms.find((v) => v.vmid === member.vmid)
  const canDestroy = !!member.vmid && member.type !== 'lxc'
  return (
    <Sheet tone="fleet" title={member.name} subtitle={`${member.url} · account ${member.username}${guest ? ` · ${guest.type === 'qemu' ? 'VM' : 'LXC'} ${guest.vmid} ${guest.name}` : member.vmid ? ` · guest ${member.vmid}` : ' · no guest yet'}`} icon={<Satellite size={18} />} onClose={onClose}>
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">Added {new Date(member.added_at * 1000).toLocaleString()} by {member.added_by} ({member.source === 'join' ? 'joined with a code' : 'added by address'}) · last answered {member.last_seen ? ago(member.last_seen) : 'never'}{member.last_error ? ` · ${member.last_error}` : ''}</p>
        {note && <p className="text-xs text-slate-300 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">{note}</p>}
        <button type="button" onClick={test} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}>{busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />} Test the link and re-match the guest</button>
        <button type="button" onClick={sync} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}>{busy === 'sync' ? <Loader2 size={16} className="animate-spin" /> : <FolderSync size={16} />} Sync stack files from the VM</button>
        <button type="button" onClick={() => void relink()} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}>{busy === 'relink' ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} Relink to the hub (password lost, or "rate limiting login")</button>
        {stacks.map((st) => (
          <button key={st} type="button" onClick={() => setMoving(st)} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}><ArrowDownToLine size={16} /> <span className="min-w-0 truncate">Move <span className="font-mono">{st}</span> to the hub</span></button>
        ))}
        <button type="button" onClick={onEdit} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}><Pencil size={16} /> Edit name, address, account or guest</button>
        {guest && <button type="button" onClick={() => onSnapshot(guest)} disabled={!!busy} className={`${BTN_SHEET} ${TONE_QUIET} w-full`}><Camera size={16} /> Take a snapshot of the {guest.type === 'qemu' ? 'VM' : 'container'}</button>}
        <button type="button" onClick={remove} disabled={!!busy} className={`${BTN_SHEET} ${TONE_DANGER} w-full`}>{busy === 'remove' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Remove from the fleet</button>
        {canDestroy && <button ref={destroyRef} type="button" onClick={() => setDestroying(true)} disabled={!!busy || destroying} aria-expanded={destroying} className={`${BTN_SHEET} ${TONE_DANGER} w-full`}><Trash2 size={16} /> Stop and destroy the VM on Proxmox</button>}
        {canDestroy && destroying && (
          <div role="group" aria-label="Confirm destroying the VM" className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 space-y-3 animate-fade-in">
            <p className="text-xs text-rose-200">Stop and destroy VM {member.vmid} ({member.name}) on Proxmox, with its disks? Everything in it is lost.</p>
            <div>
              <label htmlFor="destroy-vm-name" className={LABEL}>Type the stack name <span className="font-mono text-slate-200">{member.name}</span> to confirm</label>
              <input id="destroy-vm-name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={member.name} autoComplete="off" spellCheck={false} autoFocus disabled={busy === 'remove'} className={`${INPUT_FLEET} font-mono`} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={cancelDestroy} disabled={busy === 'remove'} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
              <button type="button" onClick={() => void destroy()} disabled={typed !== member.name || busy === 'remove'} className={`${BTN_SHEET_DANGER} flex-1`}>{busy === 'remove' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Destroy the VM</button>
            </div>
          </div>
        )}
      </div>
      {moving && <MoveToHubSheet member={member.id} memberName={member.name} stack={moving} onClose={() => setMoving(null)} onDone={onChanged} />}
    </Sheet>
  )
}

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

const SHOW_LABEL: Record<Show, string> = { all: 'All', running: 'Running', stopped: 'Stopped', qemu: 'VMs', lxc: 'LXC', dcs: 'DCS' }

export default function Proxmox() {
  const isAdmin = useAuthStore((s) => s.userRole === 'admin')
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const status = usePolling(fetchProxmoxStatus, STATUS_POLL, { key: pollKeys.proxmoxStatus })
  const configured = !!status.data?.configured
  const reachable = !!status.data?.reachable
  const nodes = usePolling(fetchProxmoxNodes, LIST_POLL, { key: pollKeys.proxmoxNodes, enabled: configured && reachable })
  const vms = usePolling(fetchProxmoxVms, LIST_POLL, { key: pollKeys.proxmoxVms, enabled: configured && reachable })
  const tasks = usePolling(fetchProxmoxTasks, TASK_POLL, { enabled: configured && reachable })
  // the fleet: what this server is, the members and what they run, the last scan
  const fleet = usePolling(fetchFleetStatus, STATUS_POLL, { key: pollKeys.fleetStatus })
  const role = fleet.data?.role ?? 'standalone'
  const memberCount = fleet.data?.members ?? 0
  const isHub = role === 'hub' || memberCount > 0
  const overview = usePolling(fetchFleetOverview, LIST_POLL, { key: pollKeys.fleetOverview, enabled: memberCount > 0 })
  const scan = usePolling(fetchFleetDiscover, 60_000, { enabled: isAdmin && configured && reachable && isHub })
  const localStacks = usePolling(fetchStacks, LIST_POLL, { key: pollKeys.stacks, enabled: isHub || role === 'member' })
  // the VM this server runs in, and the Proxmox tags it has (dcs, and hub on a hub)
  const pveSelf = usePolling(fetchProxmoxSelf, 60_000, { enabled: configured && reachable && role !== 'member' })
  const [tagging, setTagging] = useState(false)
  const tagSelf = async () => {
    setTagging(true)
    try {
      const r = await tagProxmoxSelf()
      addToast({ type: r.tagged ? 'success' : 'warning', message: r.message, duration: r.tagged ? 5000 : 9000 })
      pveSelf.refresh(); vms.refresh()
    } catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'The tags could not be set' }) } finally { setTagging(false) }
  }
  // the hub's own stacks only: GET /stacks also carries the members' stacks (placement "vm")
  const hubOwn = (localStacks.data?.stacks ?? []).filter((s) => s.placement !== 'vm')
  // VMs being built by the hub, and what creating one needs
  const jobs = usePolling(fetchFleetJobs, 5000, { key: pollKeys.fleetJobs, enabled: isAdmin && configured && reachable })
  const provDefaults = usePolling(fetchFleetProvisionDefaults, 60_000, { key: pollKeys.fleetProvisionDefaults, enabled: isAdmin && configured && reachable })
  const caps = usePolling(fetchProxmoxCapabilities, 60_000, { key: pollKeys.proxmoxCapabilities, enabled: isAdmin && configured && reachable })
  // the baked DCS templates: a VM cloned from one builds in about half a minute
  const templates = usePolling(fetchFleetTemplates, 60_000, { enabled: isAdmin && configured && reachable && isHub })
  const [removingTemplate, setRemovingTemplate] = useState<number | null>(null)
  const removeTemplate = async (t: FleetTemplate) => {
    if (!(await confirm({ title: 'Remove the template?', message: `Remove the DCS template ${t.image_id} (VM ${t.vmid})? The next build from that image installs everything again (a minute and a half) until a new one is baked.`, confirmLabel: 'Remove', danger: true }))) return
    setRemovingTemplate(t.vmid)
    try { await deleteFleetTemplate(t.vmid); addToast({ type: 'success', message: `Template ${t.image_id} removed` }); templates.refresh(); vms.refresh() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'The template could not be removed' }) }
    finally { setRemovingTemplate(null) }
  }
  const [newVm, setNewVm] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // A search result ("VM X") lands here with the guest pre-filtered
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (p && typeof p.search === 'string') { setQuery(p.search); useSettingsStore.getState().consumeNavigationPayload() }
  }, [navigationPayload])
  const [show, setShow] = useState<Show>('all')
  const [view, setView] = useState<View>(loadView)
  const changeView = (v: View) => { setView(v); saveView(v) }
  const [pending, setPending] = useState<{ vm: ProxmoxVm; action: ProxmoxVmAction } | null>(null)
  const [sheet, setSheet] = useState<'link' | 'code' | null>(null)
  const [adding, setAdding] = useState<MemberSheetPrefill | null>(null)
  const [editing, setEditing] = useState<FleetMemberBase | null>(null)
  const [menu, setMenu] = useState<FleetMemberBase | null>(null)
  const [foldersOf, setFoldersOf] = useState<FleetMemberBase | null>(null)
  const [sshFor, setSshFor] = useState<string | null>(null)   // the ssh sheet: '' = all VMs, an id = that VM ticked
  // the sheet that takes a snapshot (from a row, the member menu or the details), and a tick the open details read again on
  const [snapFor, setSnapFor] = useState<ProxmoxVm | null>(null)
  const [snapTick, setSnapTick] = useState(0)
  const [details, setDetails] = useState<{ node: string; type: ProxmoxVm['type']; vmid: number } | null>(null)
  // a paused VM: Proxmox's list keeps saying "running" — the open details sheet reads the QEMU state and reports it here,
  // so that guest's card shows "paused" (and offers Resume) while the sheet knows it
  const [pausedGuest, setPausedGuest] = useState<string | null>(null)
  const reportPaused = useCallback((key: string, paused: boolean) => setPausedGuest((cur) => (paused ? key : cur === key ? null : cur)), [])
  const withState = (v: ProxmoxVm): ProxmoxVm => (pausedGuest === guestKey(v) ? { ...v, status: 'paused' } : v)
  // bumped after a power action went through: the open sheet reads its guest again
  const [refreshTick, setRefreshTick] = useState(0)
  const [busyKey, setBusyKey] = useState('')
  // the cards whose containers block is open, per guest, for this visit
  const [openCards, setOpenCards] = useState<Record<number, boolean>>({})
  const toggleCard = (vmid: number) => setOpenCards((o) => ({ ...o, [vmid]: !o[vmid] }))

  const members = overview.data?.members ?? []
  const liveById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const memberByVm = useMemo(() => { const m = new Map<number, FleetMemberLive>(); for (const x of members) if (x.vmid) m.set(x.vmid, x); return m }, [members])
  const scanByVm = useMemo(() => new Map((scan.data?.guests ?? []).map((g) => [g.vmid, g])), [scan.data])
  const unmapped = members.filter((m) => !m.vmid)
  const all = vms.data?.vms ?? []
  const multiNode = (nodes.data?.nodes.length ?? 0) > 1

  const counts = useMemo<Record<Show, number>>(() => ({
    all: all.length,
    running: all.filter((v) => v.status === 'running').length,
    stopped: all.filter((v) => v.status !== 'running').length,
    qemu: all.filter((v) => v.type === 'qemu').length,
    lxc: all.filter((v) => v.type === 'lxc').length,
    dcs: all.filter((v) => memberByVm.has(v.vmid)).length,
  }), [all, memberByVm])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((v) => {
      if (show === 'running' && v.status !== 'running') return false
      if (show === 'stopped' && v.status === 'running') return false
      if (show === 'qemu' && v.type !== 'qemu') return false
      if (show === 'lxc' && v.type !== 'lxc') return false
      if (show === 'dcs' && !memberByVm.has(v.vmid)) return false
      const m = memberByVm.get(v.vmid)
      const hay = `${v.name} ${v.vmid} ${v.node} ${v.tags.join(' ')} ${m ? `${m.name} ${m.url} ${m.stacks.map((st) => st.name).join(' ')}` : ''}`.toLowerCase()
      if (q && !hay.includes(q)) return false
      return true
    })
  }, [all, query, show, memberByVm])

  // the scan and the builds are an admin's to read (the server refuses them to anyone else): a refresh asks for them only then
  const refreshAdminReads = () => { if (isAdmin) { scan.refresh(); jobs.refresh() } }
  const refreshAll = () => { status.refresh(); nodes.refresh(); vms.refresh(); tasks.refresh(); fleet.refresh(); overview.refresh(); localStacks.refresh(); refreshAdminReads() }
  const refreshFleet = () => { fleet.refresh(); overview.refresh(); refreshAdminReads(); vms.refresh() }
  const s = status.data
  const pveUrl = s?.url ?? ''
  // the guest whose details sheet is open, kept fresh from the list
  const detailsRaw = details ? all.find((v) => v.vmid === details.vmid && v.node === details.node && v.type === details.type) ?? null : null
  const detailsVm = detailsRaw && withState(detailsRaw)
  const showFilters = show !== 'all' || !!query.trim()

  const stackAction = async (m: FleetMemberBase, stack: string, a: StackAct) => {
    const key = `${m.id}/${stack}`
    setBusyKey(key)
    try {
      const fn = a === 'start' ? startStack : a === 'stop' ? stopStack : restartStack
      const r = await fn(stack, m.id)
      addToast({ type: r.success === false ? 'error' : 'success', message: (r as { message?: string }).message || `${stack} on ${m.name}: ${a}` })
    } catch (e) {
      addToast({ type: 'error', message: `${stack} on ${m.name}: ${e instanceof Error ? e.message : 'failed'}` })
    } finally { setBusyKey(''); setTimeout(() => overview.refresh(), 1200) }
  }
  // "Deploy here": the VM is the stack — open Templates with that stack preselected and the member named, so the deploy
  // goes to that VM through the hub (a stack the hub never placed there is unknown to it: by the stack name alone the
  // deploy would land on the hub)
  const deployTo = (m: FleetMemberBase & { stacks?: unknown[] }) => {
    const first = Array.isArray(m.stacks) && m.stacks.length ? m.stacks[0] : null
    const stack = typeof first === 'string' ? first : first && typeof first === 'object' && 'name' in first ? String((first as { name: string }).name) : m.name
    setCurrentPage('templates', { targetStack: stack, member: { id: m.id, name: m.name } })
  }
  const openStack = (st: string, edit: boolean) => setCurrentPage('stacks', edit ? { highlight: st, editCompose: true } : { highlight: st })
  const rowProps = (raw: ProxmoxVm): VmRowProps => {
    const vm = withState(raw)
    const m = memberByVm.get(vm.vmid)
    return {
      vm, isAdmin, isHub: isHub || role === 'standalone', member: m, live: m ? liveById.get(m.id) : undefined, scan: scanByVm.get(vm.vmid), isSelf: !!pveSelf.data?.guest && pveSelf.data.guest.vmid === vm.vmid && pveSelf.data.guest.node === vm.node, busyKey, pveUrl,
      expanded: !!openCards[vm.vmid], onToggleExpand: () => toggleCard(vm.vmid),
      onAction: (v, a) => setPending({ vm: v, action: a }), onStackAction: stackAction, onDeploy: deployTo, onLink: (p) => setAdding(p), onMemberMenu: (mm) => setMenu(mm), onFolders: (mm) => setFoldersOf(mm), onSsh: (mm) => setSshFor(mm.id),
      onDetails: (v) => setDetails({ node: v.node, type: v.type, vmid: v.vmid }), onSnapshot: (v) => setSnapFor(v), onOpen: openStack, showNode: multiNode,
    }
  }

  // the fleet's violet, as on every capsule: this server is the hub, or a member of one
  const roleChip = role === 'member'
    ? <Pill tone="fleet" icon={<Satellite size={10} />}>member of {fleet.data?.hub?.name || fleet.data?.hub?.url}</Pill>
    : isHub ? <Pill tone="fleet" icon={<Satellite size={10} />}>hub · {memberCount} member{memberCount === 1 ? '' : 's'}</Pill>
    : null

  // the overview row: the cards that apply here, side by side; the builds take a full row of their own while any exist
  const hasJobs = !!jobs.data && jobs.data.jobs.length > 0
  const canBuild = isAdmin && role !== 'member'
  const overviewCards: { key: string; node: ReactNode }[] = []
  const findGuest = (text: string) => { setShow('all'); setQuery(text) }
  if (nodes.data && nodes.data.nodes.length > 0) overviewCards.push({ key: 'nodes', node: <NodesCard nodes={nodes.data.nodes} vms={all} loading={!vms.data} version={s?.version ?? ''} memberVmids={new Set(memberByVm.keys())} onPick={(v) => findGuest(v.name)} /> })
  if ((isHub || role === 'member') && localStacks.data) overviewCards.push({ key: 'hub', node: <HubCard fleet={fleet.data} stacks={hubOwn} isHub={isHub} memberCount={memberCount} pveSelf={pveSelf.data} isAdmin={isAdmin} tagging={tagging} onTag={tagSelf} onStacks={() => setCurrentPage('stacks')} onStack={(name) => setCurrentPage('stacks', { highlight: name })} /> })
  if (isHub && templates.data) overviewCards.push({ key: 'templates', node: <TemplatesCard templates={templates.data.templates} defaults={provDefaults.data ?? null} isAdmin={isAdmin} removing={removingTemplate} onRemove={removeTemplate} onBake={() => setNewVm('')} onFind={(vmid) => findGuest(String(vmid))} /> })
  if (canBuild && jobs.data && !hasJobs) overviewCards.push({ key: 'builds', node: <BuildsQuiet canBuild={canBuild && configured && reachable} onNew={() => setNewVm('')} /> })
  const n = overviewCards.length
  const overviewGrid = n >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : n === 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2'

  return (
    <div className="space-y-4 md:space-y-6">
      <DisconnectedBanner />
      <PageHeader
        page="proxmox"
        badge={roleChip}
        subtitle={<>
          {!s ? 'Checking the link…' : !configured ? 'Not linked yet.' : !reachable ? 'Linked, but Proxmox does not answer.' : `Proxmox VE ${s.version} · ${s.nodes_online}/${s.nodes} node${s.nodes === 1 ? '' : 's'} online · ${s.vms.running} of ${s.vms.total} guests running`}
          {overview.data && memberCount > 0 && ` · ${overview.data.totals.reachable}/${overview.data.totals.members} members answering · ${overview.data.totals.stacks} stack${overview.data.totals.stacks === 1 ? '' : 's'} · ${overview.data.totals.containers_running + (overview.data.totals.containers_sleeping ?? 0)}/${overview.data.totals.containers_total} containers up${overview.data.totals.containers_sleeping ? ` (${overview.data.totals.containers_sleeping} asleep on demand)` : ''}`}
        </>}
        actions={<>
          {isAdmin && configured && reachable && role !== 'member' && (
            <>
              {/* on a phone "New VM" (the name stays "New VM stack"): the six buttons then fit one row */}
              <button aria-label="New VM stack" onClick={() => setNewVm('')} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Rocket size={14} /> <span>New VM<span className="hidden sm:inline"> stack</span></span></button>
              <Hint label="Scan the guests for DCS installs and link them"><button aria-label="Link VMs" onClick={() => setSheet('link')} className={BTN_TOOLBAR_QUIET}><Radar size={14} /> <span className="hidden sm:inline">Link VMs</span></button></Hint>
              <Hint label="What a Docker VM runs to become a member"><button aria-label="Join code" onClick={() => setSheet('code')} className={BTN_TOOLBAR_QUIET}><KeyRound size={14} /> <span className="hidden sm:inline">Join code</span></button></Hint>
              <Hint label="A key of your own to ssh into the VMs"><button aria-label="SSH keys" onClick={() => setSshFor('')} className={BTN_TOOLBAR_QUIET}><TerminalSquare size={14} /> <span className="hidden sm:inline">SSH</span></button></Hint>
              <Hint label="A DCS on another VM, reached by address"><button aria-label="Add member" onClick={() => setAdding({})} className={BTN_TOOLBAR_QUIET}><Link2 size={14} /> <span className="hidden sm:inline">Add member</span></button></Hint>
            </>
          )}
          {isAdmin && <Hint label={`${pageLabel('config')} → Proxmox`}><button aria-label="Settings" onClick={() => setCurrentPage('config')} className={BTN_TOOLBAR_QUIET}><Settings2 size={14} /> <span className="hidden sm:inline">Settings</span></button></Hint>}
          <button aria-label="Refresh" onClick={refreshAll} className={BTN_TOOLBAR_QUIET}><RefreshCw size={14} className={vms.loading || overview.loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button>
        </>}
      />

      {/* a member: the hub it belongs to (leaving and joining are an admin's: the API answers 403 to anyone else) */}
      {fleet.data && role === 'member' && (
        <JoinHubPanel hub={fleet.data.hub} readOnly={!isAdmin} onLeft={() => { addToast({ type: 'success', message: 'Left the hub' }); refreshFleet() }} />
      )}
      {fleet.data?.pending_join && role !== 'member' && (
        <div className={`${CARD} p-4`}>
          <p className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Satellite size={15} className="text-violet-300" /> setup.sh saved a join to {fleet.data.pending_join.hub_url}</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">{isAdmin ? 'It runs here, on the progress card.' : 'An admin runs it from this page.'}</p>
          {isAdmin && <JoinHubPanel pending={fleet.data.pending_join} onJoined={() => refreshFleet()} />}
        </div>
      )}

      {s && !configured && (
        <div className="glass-card rounded-2xl p-6">
          <div className="text-center">
            <Server size={36} className="mx-auto text-slate-500" />
            <h2 className="mt-3 text-lg font-semibold text-slate-100">Link DCS to your Proxmox host</h2>
            <p className="mt-2 text-sm text-slate-400 max-w-xl mx-auto">On Proxmox open <b>Datacenter → Permissions → API Tokens</b>, add a token for a user (untick <i>Privilege Separation</i>, or give the token the roles <code>VM.Audit</code>, <code>VM.PowerMgmt</code> and <code>Sys.Audit</code> on <code>/</code>). Then enter the URL, token ID and secret in {pageLabel('config')} → Proxmox and press <i>Test connection</i>.</p>
            {isAdmin && <button onClick={() => setCurrentPage('config')} className={`${BTN_SHEET_PRIMARY} mt-4 mx-auto w-fit px-5`}>Open {pageLabel('config')}</button>}
            <p className="mt-3 text-[11px] text-slate-500">Full walkthrough: docs/PROXMOX.md in the DCS repository</p>
          </div>
          {isAdmin && role !== 'member' && (
            <div className="mt-6 pt-5 border-t border-white/5">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><Satellite size={14} className="text-violet-300" /> Or: this VM runs stacks under a hub</h3>
              <p className="text-xs text-slate-400 mt-1 mb-3">The hub (the DCS linked to Proxmox) shows this server's stacks under its VM and deploys here. Enter the hub's address and a join code from its Proxmox page.</p>
              <JoinHubPanel onJoined={() => refreshFleet()} compact />
            </div>
          )}
        </div>
      )}

      {s && configured && !reachable && (
        <div className="glass-card rounded-2xl p-5 border border-rose-500/20">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-rose-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-slate-100">Proxmox did not answer</div>
              <div className="text-sm text-slate-400 mt-1 break-words">{s.error || s.hints?.[0]}</div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono break-all">{s.url} · {s.token_id}</div>
            </div>
          </div>
        </div>
      )}

      {configured && reachable && (
        <>
          {isAdmin && caps.data && !caps.data.can_provision && (
            <div className={`${CARD} p-4 border-amber-500/20`}><CapabilityNote caps={caps.data} /></div>
          )}

          {/* the overview: nodes · this server · templates · builds, side by side (cards shaped like them while the nodes are read) */}
          {n > 0 && (
            <div className={`grid grid-cols-1 ${overviewGrid} gap-3`}>
              {overviewCards.map((c, i) => <div key={c.key} className={`min-w-0 ${n === 3 && i === 2 ? 'md:col-span-2 xl:col-span-1' : ''}`}>{c.node}</div>)}
            </div>
          )}
          {n === 0 && !nodes.data && !nodes.error && (
            <div role="status" aria-label="Reading the nodes" className="grid grid-cols-1 md:grid-cols-2 gap-3">{[0, 1].map((i) => <OverviewCardSkeleton key={i} />)}</div>
          )}
          {hasJobs && jobs.data && <BuildsPanel jobs={jobs.data.jobs} onChanged={refreshFleet} />}

          {/* the guests, each with the DCS it runs */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <SectionLabel icon={Box}>
                <span>Guests</span>
                {vms.data ? <span className="text-slate-600 tabular-nums">{showFilters ? `${list.length}/${vms.data.total}` : vms.data.total}</span> : null}
                {isHub && <span className="text-slate-600 normal-case tracking-normal font-normal hidden sm:inline">· each with the DCS it runs</span>}
              </SectionLabel>
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <div className="relative w-full sm:w-auto">
                  <SearchInput size="sm" value={query} onChange={setQuery} label="Search the guests" placeholder="Search name, id, node, tag, stack" className="sm:w-72" />
                </div>
                {/* a phone swipes the filters sideways; the counts show from sm up */}
                <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
                  <SegmentedControl
                    aria-label="Show"
                    value={show}
                    onChange={(v) => setShow(v as Show)}
                    data={(['all', 'running', 'stopped', 'qemu', 'lxc', ...(isHub ? ['dcs' as const] : [])] as Show[]).map((k) => ({
                      value: k,
                      label: <span className="flex items-center gap-1">{SHOW_LABEL[k]}{vms.data && <span className="tabular-nums text-[10px] opacity-80 hidden sm:inline">{counts[k]}</span>}</span>,
                    }))}
                  />
                </div>
                <SegmentedControl
                  aria-label="View"
                  value={view}
                  onChange={(v) => changeView(v as View)}
                  data={[
                    { value: 'cards', label: <Tooltip label="Cards"><span className="flex py-0.5"><LayoutGrid size={14} aria-hidden /><span className="sr-only">Cards</span></span></Tooltip> },
                    { value: 'table', label: <Tooltip label="Table"><span className="flex py-0.5"><LayoutList size={14} aria-hidden /><span className="sr-only">Table</span></span></Tooltip> },
                  ]}
                />
              </div>
            </div>
            {vms.error && !vms.data ? (
              <ErrorState title="Could not read the guests" error={vms.error} onRetry={() => vms.refresh()} />
            ) : !vms.data ? (
              <div role="status" aria-label="Reading the guests" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <GuestCardSkeleton key={i} />)}</div>
            ) : list.length === 0 ? (
              <div className={CARD}>
                <EmptyState
                  compact
                  icon={<Box size={28} />}
                  title={all.length === 0 ? 'No guests on this Proxmox yet' : 'No guest matches'}
                  hint={all.length === 0
                    ? (canBuild ? 'New VM stack builds one; the VMs and containers made in Proxmox show here too.' : 'The VMs and containers made in Proxmox show here.')
                    : `${SHOW_LABEL[show]}${query.trim() ? ` · “${query.trim()}”` : ''} — none of the ${all.length} guest${all.length === 1 ? '' : 's'}`}
                  action={showFilters
                    ? <button type="button" onClick={() => { setShow('all'); setQuery('') }} className={BTN_TOOLBAR_QUIET}><X size={14} /> Clear the filters</button>
                    : all.length === 0 && canBuild ? <button type="button" onClick={() => setNewVm('')} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Rocket size={14} /> New VM stack</button> : undefined}
                />
              </div>
            ) : view === 'table' ? (
              <VmTable rows={list} showNode={multiNode} render={(vm) => <VmTableRow key={`${vm.node}/${vm.type}/${vm.vmid}`} {...rowProps(vm)} />} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-stretch">
                {list.map((vm) => <VmCard key={`${vm.node}/${vm.type}/${vm.vmid}`} {...rowProps(vm)} />)}
              </div>
            )}
          </section>

          {unmapped.length > 0 && (
            <section className="space-y-2">
              <SectionLabel icon={Satellite}>Members without a guest <span className="text-slate-600 tabular-nums">{unmapped.length}</span></SectionLabel>
              <div className={`${CARD} divide-y divide-white/[0.04]`}>
                {unmapped.map((m) => (
                  <div key={m.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`inline-block w-2 h-2 rounded-full ${m.reachable ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200">{m.name} <span className="text-[11px] text-slate-500 font-mono">{m.url}</span></p>
                        <p className="text-[11px] text-slate-500">{m.reachable ? `${m.stacks_total} stack${m.stacks_total === 1 ? '' : 's'} · ${statesLine(memberCounts(m))}` : m.error || 'no answer'} · the hub could not tell which guest this is</p>
                      </div>
                      {isAdmin && <button type="button" onClick={() => setEditing(m)} className={`${BTN_CARD} ${TONE_ATTN} font-medium`}><Pencil size={12} /> Pick the guest</button>}
                      {isAdmin && <Hint label={`Manage ${m.name}`}><button aria-label={`Manage ${m.name}`} type="button" onClick={() => setMenu(m)} className={BTN_ICON_QUIET}><MoreHorizontal size={14} /></button></Hint>}
                    </div>
                    <MemberStacks member={m} live={m} isAdmin={isAdmin} onStackAction={stackAction} busyKey={busyKey} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {tasks.data && tasks.data.tasks.length > 0 && (
            <section className="space-y-2">
              <SectionLabel icon={ListChecks}>Recent tasks <span className="text-slate-600 normal-case tracking-normal font-normal">· what Proxmox did lately</span></SectionLabel>
              <div className={`${CARD} divide-y divide-white/[0.04]`}>
                {tasks.data.tasks.slice(0, 12).map((t: ProxmoxTask) => {
                  const guest = /^\d+$/.test(t.id) ? all.find((v) => String(v.vmid) === t.id) : undefined
                  return (
                    <div key={t.upid} className="px-3 sm:px-4 py-2 flex items-center gap-2.5 text-xs">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'OK' ? 'bg-emerald-400' : t.status === 'running' ? 'bg-cyan-400 animate-pulse' : 'bg-rose-400'}`} />
                      <span className="font-mono text-[11px] text-slate-300 w-20 sm:w-24 shrink-0 truncate">{t.type}</span>
                      {guest ? <span className="min-w-0 truncate shrink"><VmCapsule member={guest.name} vmid={guest.vmid} name={guest.name} size="xs" onClick={() => findGuest(guest.name)} /></span> : t.id ? <span className="text-slate-400 font-mono text-[11px] truncate">{t.id}</span> : null}
                      <span className="text-slate-500 truncate flex-1 min-w-0 hidden sm:inline">{t.user ? t.user : ''}{t.node ? ` · ${t.node}` : ''}</span>
                      <span className="flex-1 sm:hidden" />
                      {t.status && t.status !== 'OK' && t.status !== 'running' && <span className="text-[11px] text-rose-300 truncate max-w-[40%]" title={t.status}>{t.status}</span>}
                      <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">{ago(t.starttime)}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <p className="text-[11px] text-slate-600 flex items-center gap-1"><ShieldCheck size={11} /> Power actions are audited and reach your webhooks; a guest that stops on its own raises a VM alert{isHub ? '; a member that stops answering raises a fleet alert' : ''}.</p>
        </>
      )}

      {detailsVm && (() => {
        const m = memberByVm.get(detailsVm.vmid)
        return <VmSheet key={guestKey(detailsVm)} vm={detailsVm} member={m} live={m ? liveById.get(m.id) : undefined} isAdmin={isAdmin} busyKey={busyKey} pveUrl={pveUrl} refreshTick={refreshTick} snapTick={snapTick} onSnapshot={(v) => setSnapFor(v)} onClose={() => setDetails(null)} onAction={(v, a) => setPending({ vm: v, action: a })} onStackAction={stackAction} onOpen={openStack} onChanged={() => { vms.refresh(); tasks.refresh(); if (m) overview.refresh() }} onPaused={reportPaused} />
      })()}
      {pending && <ConfirmSheet vm={pending.vm} action={pending.action} onClose={() => setPending(null)} onDone={() => { setTimeout(() => { vms.refresh(); tasks.refresh(); status.refresh(); setRefreshTick((t) => t + 1) }, 1500) }} />}
      {sheet === 'link' && (
        <Sheet tone="fleet" title="Link the VMs" subtitle="Scan the guests for DCS installs and link them; VMs without one get the join code" icon={<Radar size={18} />} onClose={() => setSheet(null)} wide>
          <FleetLinkPanel vms={vms.data?.vms} onChanged={refreshFleet} />
        </Sheet>
      )}
      {sheet === 'code' && (
        <Sheet tone="fleet" title="Join code" subtitle="What a Docker VM runs to become a member of this hub" icon={<KeyRound size={18} />} onClose={() => setSheet(null)} wide>
          <JoinCodeCard />
        </Sheet>
      )}
      {adding && <MemberSheet prefill={adding} vms={vms.data?.vms ?? []} onClose={() => setAdding(null)} onSaved={(m) => { setAdding(null); addToast({ type: 'success', message: `${m.name} joined the fleet` }); refreshFleet() }} />}
      {editing && <MemberSheet member={editing} vms={vms.data?.vms ?? []} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); addToast({ type: 'success', message: `${m.name} saved` }); refreshFleet() }} />}
      {foldersOf && <HostFoldersSheet member={foldersOf} onClose={() => { setFoldersOf(null); refreshFleet() }} />}
      {sshFor !== null && <SshAccessSheet focus={sshFor || undefined} onClose={() => setSshFor(null)} />}
      {menu && <MemberMenuSheet member={menu} vms={vms.data?.vms ?? []} stacks={(localStacks.data?.stacks ?? []).filter((s) => s.placement === 'vm' && s.member === menu.id).map((s) => s.name)} onClose={() => setMenu(null)} onEdit={() => { setEditing(menu); setMenu(null) }} onChanged={refreshFleet} onSnapshot={(v) => { setMenu(null); setSnapFor(v) }} />}
      {snapFor && <TakeSnapshotSheet vm={snapFor} onClose={() => setSnapFor(null)} onTaken={() => { setSnapTick((t) => t + 1); tasks.refresh() }} />}
      {newVm !== null && <NewVmSheet defaults={provDefaults.data ?? null} caps={caps.data ?? null} initialStack={newVm} onClose={() => setNewVm(null)} onQueued={() => { addToast({ type: 'success', message: 'The VM is being built — follow it on the card' }); refreshFleet() }} onBaked={(image) => { addToast({ type: 'success', message: `Baking a DCS template from ${image} — follow it on the card` }); refreshFleet(); templates.refresh() }} />}
    </div>
  )
}
