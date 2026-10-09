// =============================================================================
// Networks — Docker networks: the cards, what is connected to each, create,
// rebuild (Docker cannot change a network in place), connect and disconnect.
// On a hub: the hub's networks, a VM's, or both in one list.
// =============================================================================

import { useState, useEffect, useMemo, type ReactNode, useCallback, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import {
  Network, RefreshCw, Plus, Trash2, X, Check,
  Globe, Lock, AlertCircle, Loader2, Unplug, Plug, Eye,
  Search, ChevronDown, ChevronUp, Pencil, Tag, Link2,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import {
  fetchNetworks, fetchNetworkDetail,
  createNetwork, deleteNetwork, recreateNetwork,
  connectToNetwork, disconnectFromNetwork,
} from '../api/endpoints'
import { fetchContainersScoped } from '../api/fleetScopedOps'
import { useNetworkStore } from '../stores/networkStore'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import type {
  NetworkListResponse,
  NetworkInfo, NetworkDetail,
} from '../../shared/types'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { CopyButton } from '../components/common/CopyButton'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { LoadingState, ErrorState, EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_QUIET, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_DANGER, FOCUS_RING } from '../lib/ui'
import { CARD, REVEAL } from '../lib/pageKit'
import { SEARCH_FIELD, INPUT } from '../lib/fieldStyles'
import StatTile from '../components/common/StatTile'
import { Pill } from '../components/common/Pill'
import SearchInput from '../components/common/SearchInput'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILTIN_NETWORKS = ['bridge', 'host', 'none']

// ---------------------------------------------------------------------------
// Network form — create a network, or rebuild an existing one with new settings
// ---------------------------------------------------------------------------

const DRIVERS = ['bridge', 'overlay', 'macvlan', 'ipvlan'] as const
const CIDR_RE = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$|^[0-9a-fA-F:]+\/\d{1,3}$/
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/
const LABEL_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const isComposeLabel = (key: string) => key.startsWith('com.docker.compose.')
/** the round X that closes a dialog */
const CLOSE_BTN = `${BTN_ICON} text-slate-400 hover:text-slate-200 hover:bg-white/5 ${FOCUS_RING}`

function OptionToggle({ on, onToggle, icon, label, hint }: {
  on: boolean
  onToggle: () => void
  icon: ReactNode
  label: string
  hint: string
}) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className={`flex items-start gap-3 text-left w-full group rounded-lg ${FOCUS_RING}`}>
      <span className={`mt-0.5 flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0 ${on ? 'bg-emerald-500 border-emerald-500' : 'bg-white/5 border-white/20 group-hover:border-white/30'}`}>
        {on && <Check size={12} className="text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs text-slate-300">{icon}{label}</span>
        <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>
      </span>
    </button>
  )
}

function NetworkFormModal({ initial, onClose, onSaved }: {
  /** Set when editing: Docker cannot change a network in place, so it is rebuilt */
  initial?: NetworkDetail
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const editing = !!initial
  const [name, setName] = useState(initial?.name ?? '')
  const [driver, setDriver] = useState(initial?.driver ?? 'bridge')
  const [subnet, setSubnet] = useState(initial?.subnet ?? '')
  const [gateway, setGateway] = useState(initial?.gateway ?? '')
  const [ipRange, setIpRange] = useState(initial?.ip_range ?? '')
  const [internal, setInternal] = useState(initial?.internal ?? false)
  const [attachable, setAttachable] = useState(initial?.attachable ?? false)
  const [ipv6, setIpv6] = useState(initial?.ipv6 ?? false)
  const userLabels = Object.entries(initial?.labels ?? {}).filter(([k]) => !isComposeLabel(k))
  const [labels, setLabels] = useState<{ key: string; value: string }[]>(userLabels.map(([key, value]) => ({ key, value })))
  const [showAdvanced, setShowAdvanced] = useState(!!(initial?.ip_range || initial?.attachable || initial?.ipv6 || userLabels.length > 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const uid = useId()
  const composeProject = initial?.compose_project || initial?.labels?.['com.docker.compose.project'] || ''
  const memberCount = initial?.containers.length ?? 0

  const problems: string[] = []
  if (name.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name.trim())) problems.push('Name: letters, digits, dot, dash and underscore only')
  if (subnet.trim() && !CIDR_RE.test(subnet.trim())) problems.push('Subnet must be CIDR notation, e.g. 172.20.0.0/16')
  if (gateway.trim() && !IP_RE.test(gateway.trim())) problems.push('Gateway must be an IP address, e.g. 172.20.0.1')
  if (ipRange.trim() && !CIDR_RE.test(ipRange.trim())) problems.push('IP range must be CIDR notation, e.g. 172.20.5.0/24')
  if ((gateway.trim() || ipRange.trim()) && !subnet.trim()) problems.push('A gateway or IP range needs a subnet')
  for (const l of labels) if (l.key.trim() && !LABEL_KEY_RE.test(l.key.trim())) problems.push(`Label key "${l.key}" is not valid`)
  const isValid = name.trim().length > 0 && problems.length === 0

  const cleanLabels = labels.filter((l) => l.key.trim()).map((l) => [l.key.trim(), l.value] as [string, string])
  const changed = !editing
    || driver !== initial?.driver
    || subnet.trim() !== (initial?.subnet ?? '')
    || gateway.trim() !== (initial?.gateway ?? '')
    || ipRange.trim() !== (initial?.ip_range ?? '')
    || internal !== !!initial?.internal
    || attachable !== !!initial?.attachable
    || ipv6 !== !!initial?.ipv6
    || JSON.stringify(cleanLabels) !== JSON.stringify(userLabels)

  const { scope: fleetScope, member: scopeMember } = useFleetScope()
  const handleSave = async () => {
    if (!isValid || saving || !changed) return
    if (fleetScope === 'all') { setError('Everywhere is a view: pick the hub or one VM above, then create or change networks there'); return }
    setSaving(true)
    setError('')
    const labelMap: Record<string, string> = {}
    for (const [k, v] of cleanLabels) labelMap[k] = v
    const opts = {
      driver,
      subnet: subnet.trim() || undefined,
      gateway: gateway.trim() || undefined,
      ip_range: ipRange.trim() || undefined,
      internal,
      attachable,
      ipv6,
      labels: labelMap,
    }
    try {
      if (initial) {
        const res = await recreateNetwork(initial.name, opts, initial.member ?? scopeMember)
        onSaved(res.failed?.length
          ? `${initial.name} rebuilt — ${res.failed.join(', ')} could not be reconnected`
          : `${initial.name} rebuilt${res.reconnected?.length ? `, ${res.reconnected.length} container${res.reconnected.length === 1 ? '' : 's'} reconnected` : ''}`)
      } else {
        await createNetwork({ name: name.trim(), ...opts }, scopeMember)
        onSaved(`Network ${name.trim()} created`)
      }
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : editing ? 'Failed to rebuild the network' : 'Failed to create the network')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin glass rounded-2xl p-5 sm:p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-5">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${editing ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
            {editing ? <Pencil size={18} className="text-cyan-400" /> : <Network size={18} className="text-emerald-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-100">{editing ? 'Edit network' : 'Create Docker network'}</h3>
            <p className="text-sm text-slate-400 mt-0.5">{editing ? `${initial?.name} is rebuilt with the settings below` : 'Configure a new isolated network'}</p>
          </div>
          <CloseButton onClick={onClose} className="-mr-1 -mt-1" />
        </div>

        {editing && (
          <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3.5 py-3 text-xs text-amber-200/90 leading-relaxed">
            <p className="font-semibold text-amber-300 mb-1">Docker cannot change a network in place.</p>
            <p>
              Saving disconnects {memberCount} container{memberCount === 1 ? '' : 's'}, removes the network, creates it again with these settings and reconnects them.
              The containers keep running; their link on this network drops for a moment and addresses on it may change.
            </p>
            {composeProject && (
              <p className="mt-1.5">
                Owned by the <span className="font-mono text-amber-100">{composeProject}</span> stack: update its compose file to match, or its next <span className="font-mono">up</span> may rebuild the network again.
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label htmlFor={`${uid}-name`} className="block text-xs font-medium text-slate-400 mb-1.5">Network name *</label>
            <input
              id={`${uid}-name`}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              placeholder="my-network"
              autoFocus={!editing}
              disabled={editing}
              spellCheck={false}
              className={`${INPUT} font-mono disabled:opacity-60 disabled:cursor-not-allowed`}
            />
          </div>

          <div>
            <span id={`${uid}-driver`} className="block text-xs font-medium text-slate-400 mb-1.5">Driver</span>
            <div role="group" aria-labelledby={`${uid}-driver`} className="flex flex-wrap gap-2">
              {DRIVERS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={driver === d}
                  onClick={() => setDriver(d)}
                  className={`${BTN_TOOLBAR} ${FOCUS_RING} ${driver === d ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : TONE_QUIET}`}
                >
                  {d}
                </button>
              ))}
              {!(DRIVERS as readonly string[]).includes(driver) && (
                <span className={`${BTN_TOOLBAR} bg-emerald-500/15 border border-emerald-500/30 text-emerald-300`}>{driver}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-subnet`} className="block text-xs font-medium text-slate-400 mb-1.5">Subnet <span className="text-slate-500">(optional)</span></label>
              <input id={`${uid}-subnet`} type="text" value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="172.20.0.0/16" spellCheck={false} className={`${INPUT} font-mono`} />
            </div>
            <div>
              <label htmlFor={`${uid}-gateway`} className="block text-xs font-medium text-slate-400 mb-1.5">Gateway <span className="text-slate-500">(optional)</span></label>
              <input id={`${uid}-gateway`} type="text" value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="172.20.0.1" spellCheck={false} className={`${INPUT} font-mono`} />
            </div>
          </div>

          <OptionToggle on={internal} onToggle={() => setInternal(!internal)} icon={<Lock size={12} className="text-slate-500" />} label="Internal network" hint="No route to the outside world; containers on it only reach each other" />

          <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)} className={`flex h-8 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors ${FOCUS_RING}`}>
            <ChevronDown size={12} className={`transition-transform duration-200 ${showAdvanced ? '' : '-rotate-90'}`} />
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-4 animate-fade-in rounded-lg border border-white/5 bg-white/[0.02] p-4">
              <div>
                <label htmlFor={`${uid}-range`} className="block text-xs font-medium text-slate-400 mb-1.5">IP range <span className="text-slate-500">(optional)</span></label>
                <input id={`${uid}-range`} type="text" value={ipRange} onChange={(e) => setIpRange(e.target.value)} placeholder="172.20.5.0/24" spellCheck={false} className={`${INPUT} font-mono`} />
                <p className="text-[11px] text-slate-500 mt-1">Containers get addresses from this part of the subnet only</p>
              </div>
              <OptionToggle on={attachable} onToggle={() => setAttachable(!attachable)} icon={<Link2 size={12} className="text-slate-500" />} label="Attachable" hint="Standalone containers may join with docker network connect (overlay networks need this)" />
              <OptionToggle on={ipv6} onToggle={() => setIpv6(!ipv6)} icon={<Globe size={12} className="text-slate-500" />} label="IPv6" hint="Enable IPv6 addressing on the network" />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400"><Tag size={12} className="text-slate-500" />Labels</span>
                  <button type="button" onClick={() => setLabels((prev) => [...prev, { key: '', value: '' }])} className={`${BTN_CARD} ${TONE_OK} ${FOCUS_RING}`}><Plus size={12} />Add label</button>
                </div>
                {labels.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No labels{editing && Object.keys(initial?.labels ?? {}).some(isComposeLabel) ? ' of your own; the Compose ownership labels are kept' : ''}</p>
                ) : (
                  <div className="space-y-1.5">
                    {labels.map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input aria-label={`Label ${i + 1} key`} type="text" value={l.key} onChange={(e) => setLabels((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="key" spellCheck={false} className={`${INPUT} font-mono !py-1.5 !text-xs`} />
                        <span className="text-slate-500">=</span>
                        <input aria-label={`Label ${i + 1} value`} type="text" value={l.value} onChange={(e) => setLabels((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="value" spellCheck={false} className={`${INPUT} font-mono !py-1.5 !text-xs`} />
                        <Hint label="Remove label">
                          <button type="button" aria-label={`Remove label ${i + 1}`} onClick={() => setLabels((prev) => prev.filter((_, j) => j !== i))} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} ${FOCUS_RING}`}><X size={12} /></button>
                        </Hint>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-300/90">
              {problems.map((p) => <li key={p} className="flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" />{p}</li>)}
            </ul>
          )}

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
              <AlertCircle size={14} className="text-rose-400 shrink-0" />
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3 mt-6">
          <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} sm:flex-1 ${FOCUS_RING}`}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isValid || saving || !changed}
            title={editing && !changed ? 'Nothing changed yet' : undefined}
            className={`${BTN_SHEET_PRIMARY} sm:flex-1 disabled:cursor-not-allowed ${FOCUS_RING}`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : editing ? <RefreshCw size={16} /> : <Plus size={16} />}
            {saving ? (editing ? 'Rebuilding…' : 'Creating…') : editing ? 'Rebuild network' : 'Create network'}
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Network Detail Panel
// ---------------------------------------------------------------------------

function formatCreated(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function NetworkDetailPanel({ network, onClose, onRefresh, onEdit, isAdmin }: {
  network: NetworkInfo
  onClose: () => void
  onRefresh: () => void
  onEdit: (detail: NetworkDetail) => void
  isAdmin: boolean
}) {
  const [detail, setDetail] = useState<NetworkDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [allContainers, setAllContainers] = useState<string[]>([])
  const [connectTarget, setConnectTarget] = useState('')
  const [connecting, setConnecting] = useState(false)

  const isBuiltIn = BUILTIN_NETWORKS.includes(network.name)
  const canEdit = isAdmin && !isBuiltIn

  // the server the network lives on: the card's own (Everywhere lists the hub's and every VM's), else the one chosen above
  const { member: scopeMember } = useFleetScope()
  const netMember = network.member ?? scopeMember

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetchNetworkDetail(network.name, netMember)
      .then((d) => { if (mounted) setDetail(d) })
      .catch(() => { if (mounted) setError('Failed to load details') })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [network.name, netMember])

  // Candidates for the connect control: the containers of that same server (a hub's own list also carries its VMs' — those are not its to connect)
  useEffect(() => {
    if (!canEdit) return
    let mounted = true
    fetchContainersScoped(netMember)
      .then((r) => { if (mounted) setAllContainers(r.containers.filter((c) => netMember || !c.member).map((c) => c.name).sort()) })
      .catch(() => { /* the control just stays empty */ })
    return () => { mounted = false }
  }, [canEdit, netMember])

  const connectable = allContainers.filter((n) => !detail?.containers.some((c) => c.name === n))

  const handleDisconnect = async (containerName: string) => {
    setDisconnecting(containerName)
    setError('')
    try {
      await disconnectFromNetwork(network.name, containerName, netMember)
      onRefresh()
      setDetail(await fetchNetworkDetail(network.name, netMember))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(null)
    }
  }

  const handleConnect = async () => {
    if (!connectTarget || connecting) return
    setConnecting(true)
    setError('')
    try {
      await connectToNetwork(network.name, connectTarget, netMember)
      setConnectTarget('')
      onRefresh()
      setDetail(await fetchNetworkDetail(network.name, netMember))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
    } finally {
      setConnecting(false)
    }
  }

  const labelEntries = Object.entries(detail?.labels ?? {})
  const prop = (label: string, value: ReactNode) => (
    <div className={`${CARD} p-4 min-w-0`}>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      {value}
    </div>
  )

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto scrollbar-thin glass rounded-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-6 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`hidden sm:flex items-center justify-center w-11 h-11 rounded-xl ring-1 shrink-0 ${
              isBuiltIn ? 'bg-slate-500/10 ring-slate-500/20' : 'bg-cyan-500/10 ring-cyan-500/20'
            }`}>
              {detail?.internal ? <Lock size={20} className="text-cyan-400" /> : <Network size={20} className={isBuiltIn ? 'text-slate-400' : 'text-cyan-400'} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-100 font-mono break-all sm:break-normal sm:truncate">{network.name}</h2>
              <p className="text-xs text-slate-500 font-mono">{network.id.slice(0, 12)}{detail?.compose_project ? ` · ${detail.compose_project} stack` : isBuiltIn ? ' · built-in' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canEdit && detail && (
              <button
                type="button"
                onClick={() => onEdit(detail)}
                className={`${BTN_CARD_QUIET} ${FOCUS_RING}`}
                title="Change driver, subnet, gateway, labels… (the network is rebuilt)"
              >
                <Pencil size={12} />
                Edit
              </button>
            )}
            <CloseButton onClick={onClose} />
          </div>
        </div>

        {loading ? (
          <LoadingState label="Inspecting the network…" />
        ) : !detail ? (
          <div className="p-5 sm:p-8">
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3">
              <AlertCircle size={16} className="text-rose-400" />
              <p className="text-sm text-rose-300">{error || 'Failed to load details'}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x divide-white/[0.06]">
            {/* Left column — Network properties */}
            <div className="p-5 sm:p-8 space-y-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Network properties</h3>

              <div className="grid grid-cols-2 gap-4">
                {prop('Driver', <Pill tone="info">{detail.driver}</Pill>)}
                {prop('Scope', <p className="text-sm font-medium text-slate-200">{detail.scope}</p>)}
                {prop('Subnet', <p className="text-sm text-slate-200 font-mono break-all">{detail.subnet || 'Auto-assigned'}</p>)}
                {prop('Gateway', <p className="text-sm text-slate-200 font-mono break-all">{detail.gateway || 'Auto-assigned'}</p>)}
                {detail.ip_range && prop('IP range', <p className="text-sm text-slate-200 font-mono break-all">{detail.ip_range}</p>)}
                {prop('Attachable', <p className={`text-sm font-medium ${detail.attachable ? 'text-emerald-400' : 'text-slate-400'}`}>{detail.attachable ? 'Yes' : 'No'}</p>)}
                {prop('IPv6', <p className={`text-sm font-medium ${detail.ipv6 ? 'text-emerald-400' : 'text-slate-400'}`}>{detail.ipv6 ? 'Enabled' : 'Off'}</p>)}
                {detail.created && prop('Created', <p className="text-sm text-slate-200">{formatCreated(detail.created)}</p>)}
              </div>

              {/* Internal badge */}
              {detail.internal && (
                <div className="flex items-center gap-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-4 py-3">
                  <Lock size={14} className="text-cyan-400" />
                  <span className="text-xs text-cyan-300 font-medium">Internal network — no external connectivity</span>
                </div>
              )}

              {/* Labels */}
              {labelEntries.length > 0 && (
                <div className={`${CARD} p-4`}>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Tag size={10} />Labels</p>
                  <div className="space-y-1">
                    {labelEntries.map(([k, v]) => (
                      <div key={k} className={`flex items-baseline gap-2 text-[11px] font-mono ${isComposeLabel(k) ? 'text-slate-500' : 'text-slate-300'}`}>
                        <span className="truncate" title={k}>{k}</span>
                        <span className="text-slate-500">=</span>
                        <span className="truncate" title={v}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full ID */}
              <div className={`${CARD} p-4`}>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Full network ID</p>
                <p className="text-xs text-slate-300 font-mono break-all">{detail.id}</p>
              </div>
            </div>

            {/* Right column — Connected containers */}
            <div className="p-5 sm:p-8">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Plug size={12} className="text-slate-500" />
                Connected containers ({detail.containers.length})
              </h3>

              {detail.containers.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Unplug size={28} />}
                  title="No containers connected"
                  hint={!canEdit ? 'Connect containers to this network from a stack\'s compose file' : undefined}
                />
              ) : (
                <div className="space-y-2">
                  {detail.containers.map((c) => (
                    <div
                      key={c.id}
                      className={`${CARD} flex items-center justify-between gap-2 px-4 py-3 hover:bg-white/5 transition-colors`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200 font-mono truncate">{c.name}</p>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[11px] text-slate-500 font-mono">{c.ipv4 || 'No IP assigned'}</span>
                            {c.ipv4 && <CopyButton text={c.ipv4} label="Copy the address" />}
                          </span>
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDisconnect(c.name)}
                          disabled={disconnecting === c.name}
                          aria-label={`Disconnect ${c.name} from ${network.name}`}
                          className={`${BTN_CARD} ${TONE_DANGER} ${FOCUS_RING}`}
                        >
                          {disconnecting === c.name ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Unplug size={12} />
                          )}
                          Disconnect
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Connect a running container */}
              {canEdit && (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Connect a container</p>
                  <div className="flex items-center gap-2">
                    <select aria-label="Connect a container"
                      value={connectTarget}
                      onChange={(e) => setConnectTarget(e.target.value)}
                      disabled={connectable.length === 0}
                      className={`${INPUT} flex-1 min-w-0 !px-3 !py-2 !text-xs disabled:opacity-60`}
                    >
                      <option value="">{connectable.length ? 'Choose a container…' : 'Every container is already connected'}</option>
                      {connectable.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={handleConnect}
                      disabled={!connectTarget || connecting}
                      className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0 ${FOCUS_RING}`}
                    >
                      {connecting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                      Connect
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">Takes effect right away; a stack's next <span className="font-mono">up</span> only keeps connections its compose file declares.</p>
                </div>
              )}

              {error && (
                <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3">
                  <AlertCircle size={14} className="text-rose-400 shrink-0" />
                  <p className="text-xs text-rose-300">{error}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Network Card
// ---------------------------------------------------------------------------

function NetworkCard({ net, onInspect, onDelete, isAdmin }: {
  net: NetworkInfo
  onInspect: () => void
  onDelete: () => void
  isAdmin: boolean
}) {
  const isBuiltIn = BUILTIN_NETWORKS.includes(net.name)
  const containerCount = net.containers.length

  return (
    <div
      className={`
        group ${CARD} hover:border-white/10 cursor-pointer overflow-hidden transition-colors
        border-l-2 ${
          isBuiltIn ? 'border-l-slate-600/50' :
          containerCount > 0 ? 'border-l-emerald-500/70' : 'border-l-cyan-500/50'
        }
      `}
      onClick={onInspect}
    >
      <div className="relative p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {net.driver === 'host' ? (
                <Globe size={14} className="text-cyan-400 shrink-0" aria-hidden />
              ) : net.name === 'none' ? (
                <Unplug size={14} className="text-slate-500 shrink-0" aria-hidden />
              ) : (
                <Network size={14} className={`shrink-0 ${isBuiltIn ? 'text-slate-400' : 'text-cyan-400'}`} aria-hidden />
              )}
              <h3 className="text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors font-mono min-w-0">
                {net.name}
              </h3>
              {net.member !== undefined && <VmCapsule member={net.member} name={net.member_name} vmid={net.vmid} size="xs" />}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">{net.id.slice(0, 12)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isBuiltIn && isAdmin && (
              <Hint label="Delete network">
                <button
                  type="button"
                  aria-label={`Delete the network ${net.name}`}
                  onClick={(e) => { e.stopPropagation(); onDelete() }}
                  className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} ${REVEAL} ${FOCUS_RING}`}
                >
                  <Trash2 size={12} />
                </button>
              </Hint>
            )}
            <Hint label="Inspect">
              <button
                type="button"
                aria-label={`Inspect ${net.name}`}
                onClick={(e) => { e.stopPropagation(); onInspect() }}
                className={`${BTN_ICON_SM} ${TONE_GHOST} ${REVEAL} ${FOCUS_RING}`}
              >
                <Eye size={12} />
              </button>
            </Hint>
          </div>
        </div>

        {/* Driver + scope tags */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Pill tone="info">{net.driver}</Pill>
          <Pill tone="neutral">{net.scope}</Pill>
          {isBuiltIn && <Pill tone="neutral">built-in</Pill>}
        </div>

        {/* Connected containers */}
        <div className="pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 mb-2">
            <Plug size={11} className="text-slate-500" aria-hidden />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {containerCount} container{containerCount !== 1 ? 's' : ''}
            </span>
          </div>
          {containerCount > 0 ? (
            <div className="flex flex-wrap gap-1">
              {net.containers.slice(0, 5).map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] font-mono text-slate-300 border border-white/5"
                >
                  <span className="w-1 h-1 rounded-full bg-emerald-400" aria-hidden />
                  {c}
                </span>
              ))}
              {containerCount > 5 && (
                <span className="text-[11px] text-slate-500">+{containerCount - 5} more</span>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">No containers connected</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** a card's shape while the list loads */
function NetworkCardSkeleton() {
  return (
    <div className={`${CARD} border-l-2 border-l-slate-600/40 p-4 sm:p-5`} aria-hidden>
      <div className="flex items-center gap-2">
        <div className="skeleton h-3.5 w-3.5 rounded" />
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton h-[18px] w-10 rounded-full" />
      </div>
      <div className="skeleton h-3 w-24 rounded mt-2" />
      <div className="flex gap-1.5 mt-3">
        <div className="skeleton h-[18px] w-14 rounded-full" />
        <div className="skeleton h-[18px] w-12 rounded-full" />
      </div>
      <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="flex gap-1"><div className="skeleton h-5 w-16 rounded-md" /><div className="skeleton h-5 w-20 rounded-md" /></div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'driver' | 'containers'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'driver', label: 'Driver' },
  { key: 'containers', label: 'Containers' },
]

export default function Networks() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [inspectNetwork, setInspectNetwork] = useState<NetworkInfo | null>(null)
  const [editTarget, setEditTarget] = useState<NetworkDetail | null>(null)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)

  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'

  const setNetworksStore = useNetworkStore((s) => s.setNetworks)
  const isConnected = useConnectionStore((s) => s.status) === 'connected'

  // a hub: everywhere (the hub and every VM), the hub alone, or one VM — the choice every fleet-aware page shares
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const fetchScopedNetworks = useCallback(() => fetchNetworks(scope), [scope])
  const {
    data: networksData,
    loading: networksLoading,
    error: networksError,
    refresh: refreshNetworks,
  } = usePolling<NetworkListResponse>(fetchScopedNetworks, 30000, { enabled: isConnected })
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; refreshNetworks() } }, [scope, refreshNetworks])

  useEffect(() => {
    if (networksData) setNetworksStore(networksData.networks)
  }, [networksData, setNetworksStore])

  const networks: NetworkInfo[] = networksData?.networks ?? []

  // Filter & sort networks
  const filteredNetworks = useMemo(() => {
    let list = [...networks]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((n) =>
        n.name.toLowerCase().includes(q) ||
        n.driver.toLowerCase().includes(q) ||
        n.containers.some((c) => c.toLowerCase().includes(q))
      )
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'driver') cmp = a.driver.localeCompare(b.driver)
      else cmp = b.containers.length - a.containers.length
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [networks, searchQuery, sortBy, sortAsc])

  const userNetworks = networks.filter((n) => !BUILTIN_NETWORKS.includes(n.name))
  const totalContainers = networks.reduce((sum, n) => sum + n.containers.length, 0)

  // Delete: ask first, then do it — the same question every page asks with
  const requestDelete = useCallback(async (name: string) => {
    if (scope === 'all') {
      addToast({ type: 'warning', message: 'Everywhere is a view: pick the hub or one VM above, then delete the network there' })
      return
    }
    const where = scopeMember ? ` on the VM ${memberName}` : ''
    const ok = await confirm({
      title: 'Delete network',
      message: `Delete the network ${name}${where}? This cannot be undone.`,
      confirmLabel: 'Delete network',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteNetwork(name, scopeMember)
      addToast({ type: 'success', message: `Network ${name} deleted` })
      refreshNetworks()
    } catch (err: unknown) {
      addToast({ type: 'error', message: `Could not delete ${name}: ${err instanceof Error ? err.message : 'Failed to delete network'}`, duration: 6000 })
    }
  }, [scope, scopeMember, memberName, confirm, addToast, refreshNetworks])

  const chooseSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc)
    else { setSortBy(key); setSortAsc(true) }
  }

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />
      {/* Modals */}
      {showCreateModal && (
        <NetworkFormModal
          onClose={() => setShowCreateModal(false)}
          onSaved={(message) => { addToast({ type: 'success', message }); refreshNetworks() }}
        />
      )}
      {editTarget && (
        <NetworkFormModal
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(message) => { addToast({ type: 'success', message, duration: 8000 }); setInspectNetwork(null); refreshNetworks() }}
        />
      )}
      {inspectNetwork && (
        <NetworkDetailPanel
          network={inspectNetwork}
          onClose={() => setInspectNetwork(null)}
          onRefresh={refreshNetworks}
          onEdit={(detail) => setEditTarget(detail)}
          isAdmin={isAdmin}
        />
      )}

      <PageHeader
        page="networks"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        actions={<>
          {isAdmin && (
            <button type="button" onClick={() => setShowCreateModal(true)} className={`${BTN_TOOLBAR} ${TONE_OK} ${FOCUS_RING}`}>
              <Plus size={14} />
              New network
            </button>
          )}
          <button type="button" onClick={refreshNetworks} disabled={networksLoading} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={networksLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={networksLoading && !!networksData} />}
      </PageHeader>

      {/* Stats row — 3 columns */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile icon={Network} label="Total networks" short="Total" value={networks.length} />
        <StatTile icon={Plus} label="Custom networks" short="Custom" value={userNetworks.length} />
        <StatTile icon={Plug} label="Connections" short="Links" value={totalContainers} />
      </div>

      {/* Search + sort bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchInput value={searchQuery} onChange={setSearchQuery} label="Search networks" placeholder="Search by network, driver or container…" />
        </div>
        <div role="group" aria-label="Sort the networks" className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1" aria-hidden>Sort</span>
          {SORTS.map(({ key, label }) => {
            const active = sortBy === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                aria-label={active ? `${label}, ${sortAsc ? 'ascending' : 'descending'}` : label}
                onClick={() => chooseSort(key)}
                className={`${BTN_TOOLBAR} ${FOCUS_RING} border ${active ? 'bg-white/[0.06] border-white/10 text-slate-200' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                {label}
                {active && (sortAsc ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Network cards */}
      {networksLoading && networks.length === 0 ? (
        <div role="status" aria-label="Reading the networks" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2, 3].map((i) => <NetworkCardSkeleton key={i} />)}
        </div>
      ) : networksError && !networksData ? (
        <ErrorState title="Failed to load networks" error={networksError} onRetry={refreshNetworks} />
      ) : filteredNetworks.length === 0 ? (
        <div className={`${CARD} px-6 py-10 text-center`}>
          <Network size={26} className="mx-auto text-slate-500" aria-hidden />
          <p className="mt-2 text-sm text-slate-300">{searchQuery ? 'No network matches' : 'No networks found'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {searchQuery
              ? `None of the ${networks.length} network${networks.length === 1 ? '' : 's'} has “${searchQuery.trim()}” in its name, driver or containers.`
              : isAdmin
                ? 'Docker creates its built-in networks on its own. Use New network to make one, or deploy a stack that declares its own.'
                : 'Docker networks appear here once a stack creates one.'}
          </p>
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING} mx-auto mt-4`}>
              <X size={14} /> Clear the search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {filteredNetworks.map((net) => (
            <NetworkCard
              key={`${net.member ?? ''}|${net.id}`}
              net={net}
              onInspect={() => setInspectNetwork(net)}
              onDelete={() => requestDelete(net.name)}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  )
}
