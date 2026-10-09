// =============================================================================
// DNS & Routes — Traefik routes and the Cloudflare zone, managed together.
// Routes are what DCS creates for services; records are what Cloudflare serves.
// The page links the two, creates what is missing and protects what is in use.
// =============================================================================

import { useState, useCallback, useMemo, useEffect, useId, useRef } from 'react'
import { SegmentedControl, Switch } from '@mantine/core'
import {
  Globe,
  Search,
  RefreshCw,
  Loader2,
  Pencil,
  Check,
  X,
  Trash2,
  AlertTriangle,
  Shield,
  ExternalLink,
  ArrowRight,
  Network,
  CheckCircle,
  XCircle,
  CloudOff,
  Cloud,
  Plus,
  KeyRound,
  Link2,
  Wand2,
  Lock,
  Route,
  ShieldOff,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import type { RouteCertificatesResponse } from '../../shared/types'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../components/common/Toast'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import VmCapsule from '../components/fleet/VmCapsule'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_SHEET_DANGER, TONE_OK, TONE_GHOST_OK, TONE_ATTN } from '../lib/ui'
import { apiClient } from '../api/client'
import { memberPath } from '../api/endpoints'
// a route the hub's Traefik serves for a VM (from fleet-members.yml): the file lives on that VM
type FleetRoute = RouteEntry & { member?: string; member_name?: string; vmid?: number | null; fleet?: boolean }
import { LoadingState, EmptyState, ErrorState } from '../components/common/PageState'
import {
  fetchRoutes, fetchDnsRecords, fetchDnsStatus, fetchDnsZones, checkSubdomain, updateRoute, deleteRoute, fetchRouteCertificates,
  fetchTraefikStatus, createDnsRecord, updateDnsRecord, deleteDnsRecord, syncDnsRecords, fetchDomains,
} from '../api/endpoints'
import type { RouteEntry, DnsRecord, DnsRecordInput, DnsZone } from '../../shared/types'
import ModalOverlay from '../components/common/ModalOverlay'
import DomainsPanel from '../components/dns/DomainsPanel'

import { Pill } from '../components/common/Pill'
import SearchInput from '../components/common/SearchInput'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EDITABLE_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'] as const
type EditableType = typeof EDITABLE_TYPES[number]
const PROXIABLE_TYPES = new Set(['A', 'AAAA', 'CNAME'])
const TTL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Auto' }, { value: 60, label: '1 min' }, { value: 300, label: '5 min' }, { value: 1800, label: '30 min' },
  { value: 3600, label: '1 hour' }, { value: 43200, label: '12 hours' }, { value: 86400, label: '1 day' },
]

/** the record type, drawn the same for every type: which one it is stands in the letters — the colours of this dashboard mean state (violet is the fleet's) */
function TypeBadge({ type }: { type: string }) {
  return <Pill tone="neutral" className="font-mono">{type}</Pill>
}

function ttlLabel(ttl: number): string {
  if (ttl === 1) return 'Auto'
  const hit = TTL_OPTIONS.find((o) => o.value === ttl)
  if (hit) return hit.label
  if (ttl % 3600 === 0) return `${ttl / 3600} h`
  if (ttl % 60 === 0) return `${ttl / 60} min`
  return `${ttl} s`
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const HOST_RE = /^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.?$/i
const LABEL_RE = /^(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i

/** Mirror of the server's checks, so mistakes are caught before the request */
function validateRecordInput(type: EditableType, name: string, content: string, priority: string, comment: string): string | null {
  const n = name.trim()
  if (n && n !== '@' && !LABEL_RE.test(n)) return 'Name must be a hostname label such as app or _acme-challenge.app'
  const c = content.trim()
  if (!c) return 'Content is required'
  switch (type) {
    case 'A': if (!IPV4_RE.test(c)) return 'Content must be an IPv4 address'; break
    case 'AAAA': if (!/^[0-9a-f:]+$/i.test(c) || !c.includes(':')) return 'Content must be an IPv6 address'; break
    case 'CNAME': case 'NS': case 'MX': if (!HOST_RE.test(c)) return 'Content must be a hostname'; break
    case 'TXT': if (c.length > 2048) return 'TXT content is limited to 2048 characters'; break
  }
  if (priority && !/^\d+$/.test(priority)) return 'Priority must be a number'
  if (priority && Number(priority) > 65535) return 'Priority must be 65535 or less'
  if (comment.length > 100) return 'Comment is limited to 100 characters'
  return null
}

function isApex(rec: DnsRecord): boolean {
  return rec.subdomain === '@' && PROXIABLE_TYPES.has(rec.type)
}

function displayName(rec: DnsRecord, zone: string): { head: string; tail: string } {
  if (rec.subdomain === '@') return { head: zone, tail: '' }
  if (rec.name.endsWith(`.${zone}`)) return { head: rec.subdomain, tail: `.${zone}` }
  return { head: rec.name, tail: '' }
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function DeleteRouteModal({ route, onConfirm, onCancel, busy }: {
  route: RouteEntry
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  // a destructive question: Cancel has the focus, so Enter does not delete
  const cancelRef = useRef<HTMLButtonElement>(null)
  // a VM's route is deleted on the VM (its route file); the hub drops it from its proxy on the next route sync and
  // never removes a Cloudflare record for it — only the hub's own routes lose their record with the file
  const fr = route as FleetRoute
  const vm = fr.member ? (fr.member_name || fr.member) : ''
  return createPortal(
    <ModalOverlay onClose={onCancel} initialFocus={cancelRef} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="relative w-full max-w-md mx-4 bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/10">
            <Trash2 size={18} className="text-rose-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Delete route</h3>
            <p className="text-[10px] text-slate-500">{vm ? `Removes the route file on the VM ${vm}` : 'Removes the Traefik route file and its Cloudflare record'}</p>
          </div>
        </div>
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 mb-4">
          <p className="text-xs text-rose-300">
            <span className="font-semibold text-rose-400">{route.subdomain}</span>{' '}
            {vm
              ? 'will stop answering once the hub syncs the VM\'s routes (within half a minute). The route file is removed on the VM; its Cloudflare record stays — delete it on the Records tab if it is no longer wanted. The service keeps running.'
              : 'will stop answering. The route file and the DNS record are removed; the service keeps running.'}
          </p>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.03] p-3 mb-5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Service</span><span className="text-slate-300 font-mono">{route.service}</span></div>
          <div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Stack</span><span className="text-slate-300 font-mono">{route.stack}</span></div>
          <div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">Backend</span><span className="text-slate-300 font-mono truncate ml-4">{route.target}</span></div>
        </div>
        <div className="flex items-center gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`${BTN_SHEET_DANGER} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete route
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

function RecordModal({ zone, zoneId, initial, onClose, onSaved }: {
  zone: string
  /** the zone chosen on the Records tab ('' = the server's own zone): the record is written there, not in the default zone */
  zoneId: string
  initial: DnsRecord | null
  onClose: () => void
  onSaved: (rec: DnsRecord, created: boolean) => void
}) {
  const editing = !!initial
  const uid = useId()
  const [type, setType] = useState<EditableType>((initial && (EDITABLE_TYPES as readonly string[]).includes(initial.type) ? initial.type : 'A') as EditableType)
  const [name, setName] = useState(initial ? initial.subdomain : '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [ttl, setTtl] = useState<number>(initial?.ttl ?? 1)
  const [proxied, setProxied] = useState<boolean>(initial?.proxied ?? PROXIABLE_TYPES.has(type))
  const [priority, setPriority] = useState(initial?.priority != null ? String(initial.priority) : '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proxiable = PROXIABLE_TYPES.has(type)
  const fqdn = !name.trim() || name.trim() === '@' ? zone : name.trim().endsWith(`.${zone}`) ? name.trim() : `${name.trim()}.${zone}`

  const placeholder: Record<EditableType, string> = {
    A: '203.0.113.10', AAAA: '2001:db8::10', CNAME: zone, TXT: 'v=spf1 -all', MX: `mail.${zone}`, NS: 'ns1.example.net',
  }

  const submit = useCallback(async () => {
    const problem = validateRecordInput(type, name, content, priority, comment)
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)
    const input: DnsRecordInput = {
      // the zone picked above the list: without it the API wrote to (or looked the id up in) its default zone
      zone: zoneId || undefined,
      type, name: name.trim() || '@', content: content.trim(), ttl: proxiable && proxied ? 1 : ttl,
      proxied: proxiable ? proxied : false, comment: comment.trim(),
      ...(type === 'MX' ? { priority: priority ? Number(priority) : 10 } : {}),
    }
    try {
      const res = editing ? await updateDnsRecord(initial!.id, input) : await createDnsRecord(input)
      onSaved(res.record, !editing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }, [zoneId, type, name, content, priority, comment, ttl, proxied, proxiable, editing, initial, onSaved])

  // Ctrl+Enter saves (Escape is the overlay's: it closes the dialog and gives the focus back)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [submit])

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-slate-950/60 border border-white/10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 transition-all'
  const lbl = 'block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1'
  const proxyOn = proxied && proxiable

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg mx-4 bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 animate-scale-in max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/10">
              {editing ? <Pencil size={16} className="text-cyan-400" /> : <Plus size={16} className="text-cyan-400" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">{editing ? 'Edit record' : 'Add record'}</h3>
              <p className="text-[10px] text-slate-500 font-mono">{fqdn}</p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        <div className="px-6 pb-4 space-y-4 overflow-y-auto scrollbar-thin">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <div>
              <label htmlFor={`${uid}-type`} className={lbl}>Type</label>
              <select id={`${uid}-type`} value={type} onChange={(e) => { const t = e.target.value as EditableType; setType(t); setProxied(PROXIABLE_TYPES.has(t) ? proxied : false) }} className={inputCls} disabled={editing}>
                {EDITABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-name`} className={lbl}>Name</label>
              <div className="relative">
                <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="@ for the root, or app" className={`${inputCls} font-mono pr-32`} data-autofocus />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-600 font-mono pointer-events-none truncate max-w-[45%]">.{zone}</span>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor={`${uid}-content`} className={lbl}>
              {type === 'A' || type === 'AAAA' ? 'Address' : type === 'CNAME' ? 'Target' : type === 'MX' ? 'Mail server' : type === 'NS' ? 'Name server' : 'Content'}
            </label>
            {type === 'TXT' ? (
              <textarea id={`${uid}-content`} value={content} onChange={(e) => setContent(e.target.value)} placeholder={placeholder[type]} rows={3} className={`${inputCls} font-mono resize-y`} />
            ) : (
              <input id={`${uid}-content`} value={content} onChange={(e) => setContent(e.target.value)} placeholder={placeholder[type]} className={`${inputCls} font-mono`} />
            )}
          </div>

          <div className={`grid gap-3 ${type === 'MX' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div>
              <label htmlFor={`${uid}-ttl`} className={lbl}>TTL</label>
              <select id={`${uid}-ttl`} value={proxyOn ? 1 : ttl} onChange={(e) => setTtl(Number(e.target.value))} className={inputCls} disabled={proxyOn} title={proxyOn ? 'Proxied records always use the automatic TTL' : undefined}>
                {TTL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {type === 'MX' && (
              <div>
                <label htmlFor={`${uid}-priority`} className={lbl}>Priority</label>
                <input id={`${uid}-priority`} value={priority} onChange={(e) => setPriority(e.target.value.replace(/[^0-9]/g, ''))} placeholder="10" className={`${inputCls} font-mono`} />
              </div>
            )}
            <div>
              <span className={lbl}>Proxy status</span>
              <Hint label={proxiable ? 'Proxied records hide the origin address behind Cloudflare' : 'Only A, AAAA and CNAME records can be proxied'}>
                <div className={`flex items-center h-[38px] px-3 rounded-lg border ${proxiable ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.02] border-white/5'}`}>
                  <Switch
                    size="sm"
                    checked={proxyOn}
                    onChange={(e) => proxiable && setProxied(e.currentTarget.checked)}
                    disabled={!proxiable}
                    label={<span className="flex items-center gap-1.5 h-5">{proxyOn ? <Cloud size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />}{proxyOn ? 'Proxied' : 'DNS only'}</span>}
                    aria-label={`Proxy status: ${proxyOn ? 'proxied' : 'DNS only'}`}
                  />
                </div>
              </Hint>
            </div>
          </div>

          <div>
            <label htmlFor={`${uid}-comment`} className={lbl}>Comment <span className="normal-case text-slate-600">(optional, shown in Cloudflare)</span></label>
            <input id={`${uid}-comment`} value={comment} onChange={(e) => setComment(e.target.value.slice(0, 100))} placeholder="What this record is for" className={inputCls} />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
              <XCircle size={13} className="text-rose-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-300">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-white/5">
          <span className="text-[10px] text-slate-600 hidden sm:inline">Ctrl+Enter saves · Esc closes</span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={saving} className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {editing ? 'Save changes' : 'Create record'}
            </button>
          </div>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

function DeleteRecordModal({ record, zone, onConfirm, onCancel, busy }: {
  record: DnsRecord
  zone: string
  onConfirm: (force: boolean) => void
  onCancel: () => void
  busy: boolean
}) {
  const protectedReason = isApex(record)
    ? `${record.name} is the root of the zone — every DCS route points at it.`
    : record.route && PROXIABLE_TYPES.has(record.type)
      ? `The DCS route ${record.route} answers on this name.`
      : null
  const [typed, setTyped] = useState('')
  const canDelete = !protectedReason || typed.trim().toLowerCase() === record.name.toLowerCase()
  const { head, tail } = displayName(record, zone)
  // a destructive question: Cancel has the focus (a protected record asks for its name first, so the field has it)
  const cancelRef = useRef<HTMLButtonElement>(null)
  return createPortal(
    <ModalOverlay onClose={onCancel} initialFocus={protectedReason ? undefined : cancelRef} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="relative w-full max-w-md mx-4 bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/10"><Trash2 size={18} className="text-rose-400" /></div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Delete DNS record</h3>
            <p className="text-[10px] text-slate-500">Removed from Cloudflare immediately</p>
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.03] p-3 mb-4 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between"><span className="text-slate-500">Record</span><span className="font-mono text-slate-200 flex items-center gap-2"><TypeBadge type={record.type} /><span>{head}<span className="text-slate-500">{tail}</span></span></span></div>
          <div className="flex items-center justify-between"><span className="text-slate-500">Content</span><span className="font-mono text-slate-300 truncate ml-4" title={record.content}>{record.content}</span></div>
        </div>
        {protectedReason ? (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 mb-4 space-y-2">
            <p className="text-xs text-rose-300 flex items-start gap-2"><Lock size={13} className="shrink-0 mt-0.5" />{protectedReason} Deleting it takes the service offline.</p>
            <p className="text-[10px] text-rose-400/70">Type <span className="font-mono text-rose-300">{record.name}</span> to delete it anyway.</p>
            <input aria-label={`Type ${record.name} to delete it`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={record.name} autoComplete="off" spellCheck={false} className="w-full px-3 py-2 rounded-lg bg-slate-950/60 border border-rose-500/30 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500/60 focus:ring-1 focus:ring-rose-500/30" autoFocus />
          </div>
        ) : (
          <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/15 p-3 mb-4">
            <p className="text-xs text-amber-200/80">Resolvers stop answering for this name once their cache expires{record.managed ? '. DCS created this record; a matching route will show as missing DNS afterwards' : ''}.</p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          <button type="button" onClick={() => onConfirm(!!protectedReason)} disabled={busy || !canDelete} className={`${BTN_SHEET_DANGER} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete record
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type Tab = 'routes' | 'records'

export default function DNS() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const setCurrentPage = useSettingsStore.getState().setCurrentPage
  const { addToast } = useToast()

  // ---- Zone selection (only matters when the token sees several zones) ----
  const [zoneId, setZoneId] = useState<string>('')
  const [zones, setZones] = useState<DnsZone[]>([])

  // ---- Data ----
  const { data: routesData, loading: routesLoading, error: routesError, refresh: refreshRoutes } = usePolling(fetchRoutes, 30000, { key: pollKeys.routes })
  const { data: dnsStatus, refresh: refreshStatus } = usePolling(fetchDnsStatus, 60000)
  const fetchRecords = useCallback(() => fetchDnsRecords(zoneId ? { zone: zoneId } : {}), [zoneId])
  const { data: dnsData, loading: dnsLoading, error: dnsError, refresh: refreshDns } = usePolling(fetchRecords, 60000)
  const { data: traefikStatus } = usePolling(fetchTraefikStatus, 60000)
  const { data: certs, loading: certsLoading, error: certsError, refresh: refreshCerts } = usePolling(fetchRouteCertificates, 120000, { enabled: !!traefikStatus?.active })
  const { data: domainsData, refresh: refreshDomains } = usePolling(fetchDomains, 60000, { enabled: !!traefikStatus?.active })

  const routes = routesData?.routes ?? []
  const domain = routesData?.domain ?? dnsStatus?.domain ?? traefikStatus?.domain ?? ''
  const cfConfigured = dnsStatus?.cf_configured ?? dnsData?.cf_configured ?? false
  const records = dnsData?.records ?? []
  const zoneName = dnsData?.zone?.name || dnsStatus?.zone?.name || domain
  const missingDns = dnsData?.routes_without_dns ?? []

  // Refetch the records when another zone is picked (not on mount)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    refreshDns()
  }, [zoneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Zones are fetched once the token is known to work
  useEffect(() => {
    if (!isConnected || !cfConfigured || !isAdmin || zones.length > 0) return
    fetchDnsZones().then((res) => setZones(res.zones ?? [])).catch(() => {})
  }, [isConnected, cfConfigured, isAdmin, zones.length])

  // ---- UI state ----
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = localStorage.getItem('dcs-dns-tab'); if (t === 'records' || t === 'routes') return t } catch {}
    return 'routes'
  })
  const switchTab = useCallback((t: Tab) => { setTab(t); try { localStorage.setItem('dcs-dns-tab', t) } catch {} }, [])
  const [searchQuery, setSearchQuery] = useState('')
  // A search result lands here with the record or route pre-filtered
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (p && typeof p.search === 'string') { setSearchQuery(p.search); useSettingsStore.getState().consumeNavigationPayload() }
  }, [navigationPayload])
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [editingRoute, setEditingRoute] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingRoute, setDeletingRoute] = useState<RouteEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [checkingSubdomain, setCheckingSubdomain] = useState(false)
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null)
  const [recordModal, setRecordModal] = useState<{ open: boolean; record: DnsRecord | null }>({ open: false, record: null })
  const [deletingRecord, setDeletingRecord] = useState<DnsRecord | null>(null)
  const [busyRecord, setBusyRecord] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [creatingFor, setCreatingFor] = useState<string | null>(null)

  // ---- Derived ----
  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes
    const q = searchQuery.toLowerCase()
    return routes.filter((r) => r.subdomain.toLowerCase().includes(q) || r.service.toLowerCase().includes(q) || r.stack.toLowerCase().includes(q))
  }, [routes, searchQuery])

  const routesByStack = useMemo(() => {
    const map: Record<string, RouteEntry[]> = {}
    for (const r of filteredRoutes) { (map[r.stack] ||= []).push(r) }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredRoutes])

  const missingByFqdn = useMemo(() => new Set(missingDns.map((m) => m.fqdn)), [missingDns])
  const recordByName = useMemo(() => {
    const map = new Map<string, DnsRecord>()
    for (const r of records) if (PROXIABLE_TYPES.has(r.type) && !map.has(r.name)) map.set(r.name, r)
    return map
  }, [records])

  const orphanedRecords = useMemo(() => records.filter((r) => r.managed && r.points_to_dcs && !r.route), [records])
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of records) c[r.type] = (c[r.type] || 0) + 1
    return c
  }, [records])

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return records.filter((r) => (!typeFilter || r.type === typeFilter) && (!q || `${r.name} ${r.content} ${r.comment}`.toLowerCase().includes(q)))
  }, [records, typeFilter, searchQuery])

  const refreshAll = useCallback(() => { refreshRoutes(); refreshDns(); refreshStatus() }, [refreshRoutes, refreshDns, refreshStatus])

  // ---- Route handlers ----
  const handleCheckSubdomain = useCallback(async (sub: string) => {
    if (!sub.trim()) return
    setCheckingSubdomain(true); setSubdomainAvailable(null)
    try {
      const result = await checkSubdomain(sub.trim())
      setSubdomainAvailable(result.available)
      if (!result.available) addToast({ type: 'warning', message: `${sub} is already used by ${result.existing_service} in ${result.existing_stack}` })
    } catch {
      addToast({ type: 'error', message: 'Failed to check subdomain' })
    } finally {
      setCheckingSubdomain(false)
    }
  }, [addToast])

  const handleRenameStart = useCallback((route: RouteEntry) => {
    setEditingRoute(`${route.stack}/${route.service}`)
    setEditValue(route.subdomain.split('.')[0])
    setSubdomainAvailable(null)
  }, [])

  const handleRenameSave = useCallback(async (route: RouteEntry) => {
    const newSub = editValue.trim().toLowerCase()
    if (!newSub || newSub === route.subdomain.split('.')[0]) { setEditingRoute(null); return }
    setSaving(true)
    try {
      const fr = route as FleetRoute
      if (fr.member) await apiClient.put(memberPath(fr.member, `/routes/${encodeURIComponent(route.stack)}/${encodeURIComponent(route.service)}`), { subdomain: newSub })
      else await updateRoute(route.stack, route.service, newSub)
      // the hub moves the Cloudflare record of its own route with the file; a VM's route is rewritten on the VM, the
      // hub's proxy picks the new name up on its next route sync and its DNS record is not moved for it
      addToast(fr.member
        ? { type: 'success', duration: 8000, message: `Route renamed to ${newSub}.${domain} on the VM ${fr.member_name || fr.member} — the hub follows on its next route sync. Its DNS record is not moved: Sync on the Records tab creates the new one, the old one stays there` }
        : { type: 'success', message: `Route renamed to ${newSub}.${domain} — the DNS record follows` })
      setEditingRoute(null)
      refreshAll()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update route' })
    } finally {
      setSaving(false)
    }
  }, [editValue, domain, addToast, refreshAll])

  const handleDeleteRoute = useCallback(async (route: RouteEntry) => {
    setDeleting(true)
    try {
      const fr = route as FleetRoute
      if (fr.member) await apiClient.delete(memberPath(fr.member, `/routes/${encodeURIComponent(route.stack)}/${encodeURIComponent(route.service)}`))
      else await deleteRoute(route.stack, route.service)
      // a VM's route: the file is gone on the VM, the hub's proxy drops it on its next route sync, its record stays
      addToast(fr.member
        ? { type: 'success', duration: 8000, message: `Route deleted on the VM ${fr.member_name || fr.member}: ${route.subdomain} — the hub drops it on its next route sync; its DNS record stays on the Records tab` }
        : { type: 'success', message: `Route deleted: ${route.subdomain}` })
      setDeletingRoute(null)
      refreshAll()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete route' })
    } finally {
      setDeleting(false)
    }
  }, [addToast, refreshAll])

  const handleCreateForRoute = useCallback(async (fqdn: string) => {
    if (!domain) return
    setCreatingFor(fqdn)
    try {
      await createDnsRecord({ type: 'CNAME', name: fqdn, content: domain, ttl: 1, proxied: true, comment: 'Auto-created by DCS' })
      addToast({ type: 'success', message: `CNAME ${fqdn} → ${domain} created (proxied)` })
      refreshDns()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to create the record' })
    } finally {
      setCreatingFor(null)
    }
  }, [domain, addToast, refreshDns])

  // ---- Record handlers ----
  const handleRecordSaved = useCallback((rec: DnsRecord, created: boolean) => {
    setRecordModal({ open: false, record: null })
    addToast({ type: 'success', message: `${created ? 'Created' : 'Updated'} ${rec.type} ${rec.name}` })
    refreshDns()
  }, [addToast, refreshDns])

  const handleToggleProxy = useCallback(async (rec: DnsRecord) => {
    setBusyRecord(rec.id)
    try {
      // the record lives in the zone picked above the list: without it the API looked its id up in the default zone
      await updateDnsRecord(rec.id, { proxied: !rec.proxied, zone: zoneId || undefined })
      addToast({ type: 'success', message: `${rec.name} is now ${rec.proxied ? 'DNS only' : 'proxied through Cloudflare'}` })
      refreshDns()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to change the proxy status' })
    } finally {
      setBusyRecord(null)
    }
  }, [zoneId, addToast, refreshDns])

  const handleDeleteRecord = useCallback(async (rec: DnsRecord, force: boolean) => {
    setBusyRecord(rec.id)
    try {
      await deleteDnsRecord(rec.id, { force, zone: zoneId || undefined })
      addToast({ type: 'success', message: `Deleted ${rec.type} ${rec.name}` })
      setDeletingRecord(null)
      refreshDns()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete the record' })
    } finally {
      setBusyRecord(null)
    }
  }, [zoneId, addToast, refreshDns])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await syncDnsRecords()
      const created = res.created?.length ?? 0
      const failed = res.failed?.length ?? 0
      addToast({
        type: failed ? 'warning' : 'success',
        message: created || failed ? `${created} record${created === 1 ? '' : 's'} created${failed ? `, ${failed} failed: ${res.failed.map((f) => `${f.name} (${f.error})`).join('; ')}` : ''}` : 'Every route already has a record',
        duration: 6000,
      })
      refreshDns()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }, [addToast, refreshDns])

  // ---- Status pill: the token's state, beside the page's name ----
  const tokenPill = (() => {
    if (!dnsStatus) return { tone: 'neutral', icon: <Loader2 size={11} className="animate-spin" />, label: 'Cloudflare' } as const
    if (!dnsStatus.cf_configured) return { tone: 'neutral', icon: <CloudOff size={11} />, label: 'Cloudflare not configured' } as const
    if (dnsStatus.token_status === 'active') return { tone: 'ok', icon: <CheckCircle size={11} />, label: `Cloudflare token active · ${dnsStatus.token_source === 'secret' ? 'from the secret store' : dnsStatus.token_source === 'env' ? 'from .env' : 'from a stack .env'}` } as const
    if (dnsStatus.token_status === 'unreachable') return { tone: 'attention', icon: <AlertTriangle size={11} />, label: 'Cloudflare unreachable' } as const
    return { tone: 'problem', icon: <XCircle size={11} />, label: `Cloudflare token ${dnsStatus.token_status}` } as const
  })()

  // ---- Render ----
  return (
    <div className="space-y-3 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />

      {deletingRoute && <DeleteRouteModal route={deletingRoute} busy={deleting} onConfirm={() => handleDeleteRoute(deletingRoute)} onCancel={() => setDeletingRoute(null)} />}
      {recordModal.open && <RecordModal zone={zoneName} zoneId={zoneId} initial={recordModal.record} onClose={() => setRecordModal({ open: false, record: null })} onSaved={handleRecordSaved} />}
      {deletingRecord && <DeleteRecordModal record={deletingRecord} zone={zoneName} busy={busyRecord === deletingRecord.id} onConfirm={(force) => handleDeleteRecord(deletingRecord, force)} onCancel={() => setDeletingRecord(null)} />}

      {/* ---- Page Header ---- */}
      <PageHeader
        page="dns"
        badge={<Pill tone={tokenPill.tone} icon={tokenPill.icon} title={dnsStatus?.hint || undefined}>{tokenPill.label}</Pill>}
        subtitle={domain ? (
          <>
            <span className="text-slate-300 font-medium">*.{domain}</span>
            {' — '}{routes.length} route{routes.length !== 1 ? 's' : ''}
            {cfConfigured && dnsData ? <>, {dnsData.all_total ?? records.length} DNS record{(dnsData.all_total ?? records.length) !== 1 ? 's' : ''}</> : null}
          </>
        ) : undefined}
        actions={<>
          <button aria-label="Refresh" onClick={refreshAll} disabled={routesLoading || dnsLoading} className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={routesLoading || dnsLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {isAdmin && cfConfigured && (
            <button onClick={() => { switchTab('records'); setRecordModal({ open: true, record: null }) }} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              <Plus size={14} /> Add record
            </button>
          )}
        </>}
      />

      {/* ---- Not configured: how to fix it ---- */}
      {isConnected && dnsStatus && !dnsStatus.cf_configured && (
        <div className="surface border-cyan-500/15 p-5 flex flex-col md:flex-row md:items-center gap-4 animate-fade-in">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/15 flex items-center justify-center shrink-0"><KeyRound size={18} className="text-cyan-400" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 font-medium">Connect Cloudflare to manage DNS from here</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Create an API token in Cloudflare with <span className="text-slate-300">Zone → DNS → Edit</span> for your zone and store it as the secret <span className="font-mono text-slate-300">CF_DNS_API_TOKEN</span>. Traefik&apos;s DNS challenge, dynamic DNS and this page all read it from there; nothing is written in plain text.
              {!domain && <> Deploy the Traefik template first so DCS knows the domain.</>}
            </p>
          </div>
          {isAdmin && (
            <button onClick={() => setCurrentPage('secrets')} className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0`}>
              <KeyRound size={14} /> Open {pageLabel('secrets')}
            </button>
          )}
        </div>
      )}
      {isConnected && dnsStatus?.cf_configured && dnsStatus.hint && (
        <div className="surface border-amber-500/15 p-4 flex items-center gap-3 animate-fade-in">
          <AlertTriangle size={16} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-200/80">{dnsStatus.hint}</p>
        </div>
      )}

      {/* ---- Status Cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
        <StatCard icon={<Network size={16} className="text-cyan-400" />} label="Routes" value={String(routes.length)} />
        <StatCard icon={<Globe size={16} className="text-emerald-400" />} label="DNS records" value={cfConfigured ? String(dnsData?.all_total ?? records.length) : '—'} sub={dnsStatus?.zone?.status ? `zone ${dnsStatus.zone.status}` : undefined} />
        <StatCard icon={<Link2 size={16} className={missingDns.length ? 'text-amber-400' : 'text-slate-500'} />} label="Missing DNS" value={cfConfigured ? String(missingDns.length) : '—'} sub={missingDns.length ? 'routes without a record' : undefined} tone={missingDns.length ? 'warn' : undefined} />
        <StatCard icon={<Shield size={16} className={traefikStatus?.active ? 'text-emerald-400' : 'text-slate-500'} />} label="Traefik" value={traefikStatus?.active ? 'Active' : 'Inactive'} tone={traefikStatus?.active ? 'ok' : undefined} />
      </div>

      {/* Hidden when the API predates the endpoint (older AIO) */}
      {traefikStatus?.active && (certs || !certsError) && <CertificatesPanel data={certs ?? null} loading={certsLoading} onRefresh={refreshCerts} />}

      {/* the domains this server answers for (hidden when the API predates them) */}
      {domainsData && domainsData.primary && <DomainsPanel data={domainsData} isAdmin={isAdmin} onChanged={() => { void refreshDomains(); refreshCerts() }} />}

      {/* ---- Tabs + search ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <SegmentedControl
            aria-label="Show"
            value={tab}
            onChange={(v) => switchTab(v as Tab)}
            data={[
              { value: 'routes', label: <span className="flex items-center gap-1.5"><Route size={13} aria-hidden /> Routes ({routes.length})</span> },
              { value: 'records', label: <span className="flex items-center gap-1.5"><Globe size={13} aria-hidden /> DNS records{cfConfigured && dnsData ? ` (${dnsData.all_total ?? records.length})` : ''}</span> },
            ]}
          />
        </div>
        <div className="relative flex-1">
          <SearchInput value={searchQuery} onChange={setSearchQuery} label={tab === 'routes' ? 'Search the routes' : 'Search the records'} placeholder={tab === 'routes' ? 'Search routes by subdomain, service or stack…' : 'Search records by name, content or comment…'} />
        </div>
      </div>

      {tab === 'routes' ? (
        <RoutesPanel
          domain={domain} routes={routes} filteredRoutes={filteredRoutes} routesByStack={routesByStack} loading={routesLoading} error={routesError}
          onRetry={refreshRoutes} searchQuery={searchQuery} isAdmin={isAdmin} cfConfigured={cfConfigured}
          editingRoute={editingRoute} editValue={editValue} setEditValue={setEditValue} saving={saving}
          checkingSubdomain={checkingSubdomain} subdomainAvailable={subdomainAvailable}
          onRenameStart={handleRenameStart} onRenameSave={handleRenameSave} onRenameCancel={() => setEditingRoute(null)} onCheckSubdomain={handleCheckSubdomain}
          onDelete={setDeletingRoute} recordByName={recordByName} missingByFqdn={missingByFqdn} creatingFor={creatingFor} onCreateRecord={handleCreateForRoute}
          setSubdomainAvailable={setSubdomainAvailable}
        />
      ) : (
        <RecordsPanel
          zoneName={zoneName} zones={zones} zoneId={zoneId} setZoneId={setZoneId} records={records} filtered={filteredRecords} typeCounts={typeCounts}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter} loading={dnsLoading} error={dnsError} dataError={dnsData?.error} onRetry={refreshDns}
          cfConfigured={cfConfigured} isAdmin={isAdmin} busyRecord={busyRecord} orphaned={orphanedRecords} missing={missingDns} syncing={syncing}
          onSync={handleSync} onAdd={() => setRecordModal({ open: true, record: null })} onEdit={(r) => setRecordModal({ open: true, record: r })}
          onDelete={setDeletingRecord} onToggleProxy={handleToggleProxy} searchQuery={searchQuery}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * Certificates — what Traefik holds and why it might not: challenge in use,
 * ACME account, every certificate with its expiry, the last ACME errors and
 * the hints the API derives from them. The panel answers "why is my site's
 * certificate invalid?" without a shell.
 */
function CertificatesPanel({ data, loading, onRefresh }: { data: RouteCertificatesResponse | null; loading: boolean; onRefresh: () => void }) {
  const certs = data?.certificates ?? []
  const problems = (data?.hints?.length ?? 0) + (data?.errors?.length ?? 0)
  const tone = !data ? 'text-slate-500' : problems > 0 || certs.length === 0 ? 'text-amber-400' : 'text-emerald-400'
  const challengeLabel = data?.challenge === 'dns' ? 'DNS-01 via Cloudflare' : data?.challenge === 'http' ? 'HTTP-01 on port 80' : data?.challenge === 'none' ? 'no resolver' : 'unknown'
  return (
    <div className="surface p-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Lock size={15} className={tone} />
          <h3 className="text-sm font-semibold text-slate-200">Proxy health</h3>
          {data && (
            <Pill tone="neutral" className="truncate" title="ACME challenge Traefik is configured for">{challengeLabel}</Pill>
          )}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className={BTN_CARD_QUIET}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Recheck
        </button>
      </div>
      {!data ? (
        <p className="text-xs text-slate-500">Reading Traefik's certificate store…</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><span className="text-slate-500 block">Account</span><span className="text-slate-200 font-mono truncate block" title={data.email}>{data.email || '—'}</span></div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><span className="text-slate-500 block">Cloudflare token</span><span className={data.token_set ? 'text-emerald-400' : data.challenge === 'dns' ? 'text-rose-400' : 'text-slate-400'}>{data.token_set ? 'stored' : 'not set'}</span></div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><span className="text-slate-500 block">acme.json</span><span className={data.acme_file.exists ? (data.acme_file.mode_ok ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}>{data.acme_file.exists ? `mode ${data.acme_file.mode}${data.acme_file.mode_ok ? '' : ' (must be 600)'}` : 'missing'}</span></div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><span className="text-slate-500 block">Issued</span><span className={certs.length ? 'text-emerald-400' : 'text-amber-400'}>{certs.length} certificate{certs.length === 1 ? '' : 's'}</span></div>
          </div>
          {data.probe && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-500">Live probe through Traefik:</span>
              <span className="text-emerald-400">{data.probe.passing} passing</span>
              {data.probe.skipped_target_down > 0 && <span className="text-slate-400">{data.probe.skipped_target_down} target down</span>}
              {data.probe.backend_down.map((d) => <Pill key={d} tone="attention" className="font-mono" title="Traefik routed it but the app did not answer">{d}</Pill>)}
              {data.probe.dead.map((d) => <Pill key={d} tone="problem" className="font-mono" title="No router answered for this name">{d}</Pill>)}
              {data.domain && <span className="ml-auto text-slate-500">domain <span className="font-mono text-slate-300">{data.domain}</span></span>}
            </div>
          )}
          {certs.length > 0 && (
            <div className="divide-y divide-white/[0.04] rounded-lg border border-white/5 overflow-hidden">
              {certs.map((c) => {
                const exp = c.days_left < 0 ? 'text-rose-400' : c.days_left < 14 ? 'text-amber-400' : 'text-slate-400'
                return (
                  <div key={`${c.resolver}-${c.domain}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <span className="text-slate-200 font-mono truncate block">{c.domain}</span>
                      {c.sans.length > 1 && <span className="text-[10px] text-slate-500">{c.sans.length} names · {c.sans.filter((n) => n !== c.domain).slice(0, 3).join(', ')}{c.sans.length > 4 ? '…' : ''}</span>}
                    </div>
                    <span className={`shrink-0 text-[11px] ${exp}`} title={c.not_after}>{c.days_left < 0 ? `expired ${-c.days_left}d ago` : `${c.days_left}d left`}</span>
                  </div>
                )
              })}
            </div>
          )}
          {data.hints.length > 0 && (
            <ul className="space-y-1.5">
              {data.hints.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-200/80"><AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" /><span>{h}</span></li>
              ))}
            </ul>
          )}
          {data.errors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Last ACME errors from Traefik's log ({data.errors.length})</summary>
              <pre className="mt-2 p-3 rounded-lg bg-black/30 border border-white/5 text-[10px] text-rose-300/90 whitespace-pre-wrap break-all">{data.errors.join('\n')}</pre>
            </details>
          )}
          {(data.log?.length ?? 0) > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Traefik errors and warnings, last 24 h ({data.log!.length})</summary>
              <pre className="mt-2 p-3 rounded-lg bg-black/30 border border-white/5 text-[10px] text-amber-200/80 whitespace-pre-wrap break-all">{data.log!.join('\n')}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="bg-slate-900/60 backdrop-blur-md border border-white/5 hover:border-white/10 rounded-xl p-4 flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
        <p className={`text-xl font-bold ${tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-slate-100'}`}>{value}</p>
        {sub && <p className="text-[10px] text-slate-500 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function RoutesPanel(props: {
  domain: string; routes: RouteEntry[]; filteredRoutes: RouteEntry[]; routesByStack: [string, RouteEntry[]][]
  loading: boolean; error: Error | null | undefined; onRetry: () => void; searchQuery: string; isAdmin: boolean; cfConfigured: boolean
  editingRoute: string | null; editValue: string; setEditValue: (v: string) => void; saving: boolean
  checkingSubdomain: boolean; subdomainAvailable: boolean | null; setSubdomainAvailable: (v: boolean | null) => void
  onRenameStart: (r: RouteEntry) => void; onRenameSave: (r: RouteEntry) => void; onRenameCancel: () => void; onCheckSubdomain: (s: string) => void
  onDelete: (r: RouteEntry) => void; recordByName: Map<string, DnsRecord>; missingByFqdn: Set<string>; creatingFor: string | null; onCreateRecord: (fqdn: string) => void
}) {
  const { domain, routes, filteredRoutes, routesByStack, loading, error, onRetry, searchQuery, isAdmin, cfConfigured, editingRoute, editValue, setEditValue, saving,
    checkingSubdomain, subdomainAvailable, setSubdomainAvailable, onRenameStart, onRenameSave, onRenameCancel, onCheckSubdomain, onDelete, recordByName, missingByFqdn, creatingFor, onCreateRecord } = props
  const setCurrentPage = useSettingsStore.getState().setCurrentPage

  return (
    <div className="surface overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-2.5">
          <Globe size={14} className="text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">{domain || 'No domain configured'}</span>
          <Pill tone="neutral">{routes.length} route{routes.length !== 1 ? 's' : ''}</Pill>
        </div>
        {domain && <span className="text-[10px] text-slate-600 font-mono hidden sm:block">TRAEFIK_DOMAIN</span>}
      </div>

      {loading && routes.length === 0 ? (
        <LoadingState label="Loading routes…" />
      ) : error && routes.length === 0 ? (
        <ErrorState title="Routes could not be loaded" error={error} onRetry={onRetry} />
      ) : routes.length === 0 ? (
        <EmptyState
          icon={<Globe size={28} className="text-slate-500" />}
          title="No routes yet"
          hint="Deploy a template while Traefik is active and its route appears here"
          action={isAdmin ? <button type="button" onClick={() => setCurrentPage('templates')} className={BTN_TOOLBAR_QUIET}>Open {pageLabel('templates')}</button> : undefined}
        />
      ) : filteredRoutes.length === 0 ? (
        <EmptyState icon={<Search size={28} className="text-slate-500" />} title={`No routes match "${searchQuery}"`} />
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {routesByStack.map(([stack, stackRoutes]) => (
            <div key={stack}>
              <div className="px-5 py-2 bg-white/[0.02] flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{stack}</span>
                <span className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-slate-600">{stackRoutes.length}</span>
              </div>
              {stackRoutes.map((route) => {
                const routeKey = `${route.stack}/${route.service}`
                const isEditing = editingRoute === routeKey
                const sub = route.subdomain.split('.')[0]
                const rec = recordByName.get(route.subdomain)
                const missing = cfConfigured && (missingByFqdn.has(route.subdomain) || (!rec && route.subdomain.endsWith(`.${domain}`)))
                return (
                  <div key={routeKey} className="group/row flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 px-4 sm:px-5 py-3 hover:bg-white/[0.03] transition-colors">
                    <span className="hidden sm:inline text-[10px] font-mono text-slate-700 shrink-0" aria-hidden>├─</span>
                    {/* Phones: the name on its own line, the target and actions on the next */}
                    <div className="flex items-center gap-1 min-w-0 flex-1 basis-full sm:basis-auto">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            type="text" value={editValue}
                            aria-label={`New subdomain for ${route.service}`}
                            onChange={(e) => { setEditValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setSubdomainAvailable(null) }}
                            onKeyDown={(e) => { if (e.key === 'Enter') onRenameSave(route); if (e.key === 'Escape') onRenameCancel(); if (e.key === 'Tab') { e.preventDefault(); onCheckSubdomain(editValue) } }}
                            autoFocus className="w-32 bg-slate-900/60 border border-cyan-500/30 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30" placeholder={sub}
                          />
                          <span className="text-[10px] text-slate-600 font-mono">.{domain}</span>
                          {checkingSubdomain ? <Loader2 size={11} className="animate-spin text-slate-500" /> : subdomainAvailable === true ? <CheckCircle size={11} className="text-emerald-400" aria-label="Available" /> : subdomainAvailable === false ? <XCircle size={11} className="text-rose-400" aria-label="Taken" /> : null}
                          <Hint label="Save"><button type="button" aria-label="Save" onClick={() => onRenameSave(route)} disabled={saving} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}>{saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</button></Hint>
                          <Hint label="Cancel"><button type="button" aria-label="Cancel" onClick={onRenameCancel} className={`${BTN_ICON_SM} text-slate-500 hover:text-slate-200 hover:bg-white/10`}><X size={12} /></button></Hint>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 flex-1">
                          <span className="text-sm font-mono text-cyan-400 truncate max-w-full" title={route.subdomain}>{sub}</span>
                          <span className="text-[10px] text-slate-600 font-mono shrink-0">.{domain}</span>
                          {(route as FleetRoute).member && <VmCapsule member={(route as FleetRoute).member} name={(route as FleetRoute).member_name} vmid={(route as FleetRoute).vmid} size="xs" />}
                          {route.conflict && <Pill tone="problem" icon={<AlertTriangle size={10} />} title="Two routes claim this subdomain">conflict</Pill>}
                          {route.crowdsec === 'bypass' && <Pill tone="attention" icon={<ShieldOff size={10} />} title="CrowdSec's bouncer never checks this route: it does not use Traefik's traefik-chain, so an address CrowdSec has banned can still reach it.">unprotected</Pill>}
                          {cfConfigured && rec && (
                            <Pill tone={rec.proxied ? 'ok' : 'neutral'} icon={rec.proxied ? <Cloud size={9} /> : <Globe size={9} />} title={`${rec.type} → ${rec.content}${rec.proxied ? ' (proxied)' : ' (DNS only)'}`}>{rec.type}</Pill>
                          )}
                          {missing && <Pill tone="attention" icon={<AlertTriangle size={10} />} title="No A, AAAA or CNAME record answers for this name">no DNS</Pill>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none basis-full sm:basis-auto sm:w-[20rem] lg:w-[32rem]">
                    <ArrowRight size={12} className="text-slate-700 shrink-0" aria-hidden />
                    <span className="text-xs text-slate-300 font-medium truncate min-w-0 sm:w-24 sm:shrink-0" title={route.service}>{route.service}</span>
                    <span className="text-[10px] text-slate-500 font-mono truncate hidden lg:block w-[180px] shrink-0" title={route.target}>{route.target}</span>
                    <div className="ml-auto flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                      {isAdmin && missing && !isEditing && (
                        <Hint label="Create a proxied CNAME pointing at the domain">
                          <button type="button" onClick={() => onCreateRecord(route.subdomain)} disabled={creatingFor === route.subdomain} className={`${BTN_CARD} ${TONE_OK}`}>
                            {creatingFor === route.subdomain ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add DNS
                          </button>
                        </Hint>
                      )}
                      {isAdmin && !isEditing && (
                        <>
                          <Hint label="Rename the subdomain"><button type="button" aria-label={`Rename the subdomain of ${route.service}`} onClick={() => onRenameStart(route)} className={`${BTN_ICON_SM} text-slate-500 hover:text-slate-200 hover:bg-white/10`}><Pencil size={12} /></button></Hint>
                          <Hint label="Delete the route"><button type="button" aria-label={`Delete the route of ${route.service}`} onClick={() => onDelete(route)} className={`${BTN_ICON_SM} text-slate-500 hover:text-rose-300 hover:bg-rose-500/10`}><Trash2 size={12} /></button></Hint>
                        </>
                      )}
                      <Hint label={`Open https://${route.subdomain}`}><a href={`https://${route.subdomain}`} target="_blank" rel="noopener noreferrer" aria-label={`Open https://${route.subdomain}`} className={`${BTN_ICON_SM} text-slate-500 hover:text-slate-200 hover:bg-white/10`}><ExternalLink size={12} /></a></Hint>
                    </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RecordsPanel(props: {
  zoneName: string; zones: DnsZone[]; zoneId: string; setZoneId: (id: string) => void; records: DnsRecord[]; filtered: DnsRecord[]
  typeCounts: Record<string, number>; typeFilter: string; setTypeFilter: (t: string) => void
  loading: boolean; error: Error | null | undefined; dataError?: string; onRetry: () => void; cfConfigured: boolean; isAdmin: boolean; busyRecord: string | null
  orphaned: DnsRecord[]; missing: { fqdn: string; route: string }[]; syncing: boolean; onSync: () => void; onAdd: () => void
  onEdit: (r: DnsRecord) => void; onDelete: (r: DnsRecord) => void; onToggleProxy: (r: DnsRecord) => void; searchQuery: string
}) {
  const { zoneName, zones, zoneId, setZoneId, records, filtered, typeCounts, typeFilter, setTypeFilter, loading, error, dataError, onRetry, cfConfigured, isAdmin, busyRecord,
    orphaned, missing, syncing, onSync, onAdd, onEdit, onDelete, onToggleProxy, searchQuery } = props
  const types = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', ...Object.keys(typeCounts).filter((t) => !['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'].includes(t)).sort()]
  const chip = 'h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'
  const chipOn = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  const chipOff = 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-white/5'
  const th = 'px-4 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider'

  if (!cfConfigured) {
    return (
      <div className="surface">
        <EmptyState icon={<CloudOff size={28} className="text-slate-500" />} title="DNS records appear here once Cloudflare is connected" hint="Store the API token as the secret CF_DNS_API_TOKEN" />
      </div>
    )
  }

  return (
    <div className="surface overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 md:px-5 py-3 border-b border-white/5 bg-slate-900/40 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={14} className="text-emerald-400 shrink-0" />
          {zones.length > 1 ? (
            <select aria-label="Zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30">
              <option value="">{zoneName} (DCS domain)</option>
              {zones.filter((z) => z.name !== zoneName).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          ) : (
            <span className="text-sm font-semibold text-slate-200 truncate">{zoneName}</span>
          )}
          <Pill tone="neutral" className="whitespace-nowrap">{records.length} record{records.length !== 1 ? 's' : ''}</Pill>
        </div>
        <div role="group" aria-label="Record type" className="flex items-center gap-1 flex-wrap">
          <button type="button" aria-pressed={!typeFilter} onClick={() => setTypeFilter('')} className={`${chip} ${!typeFilter ? chipOn : chipOff}`}>All</button>
          {types.map((t) => (
            <button key={t} type="button" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(typeFilter === t ? '' : t)} className={`${chip} ${typeFilter === t ? chipOn : chipOff}`}>
              {t}{typeCounts[t] ? <span className="ml-1 opacity-70">{typeCounts[t]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          {orphaned.length > 0 && <Pill tone="attention" title="Records DCS created whose route no longer exists">{orphaned.length} orphaned</Pill>}
          {isAdmin && missing.length > 0 && (
            <Hint label={missing.map((m) => m.fqdn).join(', ')}>
              <button type="button" onClick={onSync} disabled={syncing} className={`${BTN_CARD} ${TONE_ATTN}`}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Create {missing.length} missing
              </button>
            </Hint>
          )}
          {isAdmin && (
            <button type="button" onClick={onAdd} className={`${BTN_CARD} ${TONE_OK} font-semibold`}>
              <Plus size={12} /> Add
            </button>
          )}
        </div>
      </div>

      {loading && records.length === 0 && !dataError ? (
        <LoadingState label="Loading records from Cloudflare…" />
      ) : dataError ? (
        <ErrorState title="Cloudflare zone unavailable" error={dataError} onRetry={onRetry} />
      ) : error && records.length === 0 ? (
        <ErrorState title="Records could not be loaded" error={error} onRetry={onRetry} />
      ) : records.length === 0 ? (
        <EmptyState icon={<Globe size={28} className="text-slate-500" />} title="The zone has no records" hint="Add one, or deploy a template to create routes" action={isAdmin ? <button type="button" onClick={onAdd} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Plus size={14} /> Add record</button> : undefined} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search size={28} className="text-slate-500" />} title={searchQuery ? `No records match "${searchQuery}"` : `No ${typeFilter} records`} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-white/5">
                <th scope="col" className={`text-left w-20 ${th}`}>Type</th>
                <th scope="col" className={`text-left ${th}`}>Name</th>
                <th scope="col" className={`text-left ${th}`}>Content</th>
                <th scope="col" className={`text-left w-20 ${th}`}>TTL</th>
                <th scope="col" className={`text-left w-32 ${th}`}>Proxy</th>
                <th scope="col" className={`text-right w-24 ${th}`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {filtered.map((rec) => {
                const { head, tail } = displayName(rec, zoneName)
                const busy = busyRecord === rec.id
                const canProxy = rec.editable && PROXIABLE_TYPES.has(rec.type) && rec.proxiable
                const editHint = rec.editable ? 'Edit the record' : rec.locked ? 'Locked by Cloudflare' : `${rec.type} records are read-only here`
                const deleteHint = rec.editable ? 'Delete the record' : 'Read-only here'
                return (
                  <tr key={rec.id} className="hover:bg-white/[0.03] transition-colors group/rec">
                    <td className="px-4 py-2.5 whitespace-nowrap"><TypeBadge type={rec.type} /></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="text-xs font-mono text-cyan-300 break-all">{head}</span>
                        {tail && <span className="text-[10px] text-slate-600 font-mono">{tail}</span>}
                        {rec.subdomain === '@' && <Pill tone="neutral">root</Pill>}
                        {rec.route && <Pill tone="info" icon={<Route size={10} />} title={`Traefik route ${rec.route}`}>{rec.route.split('/')[1]}</Pill>}
                        {rec.managed && !rec.route && rec.points_to_dcs && <Pill tone="attention" title="DCS created this record but no route uses it any more">orphaned</Pill>}
                        {rec.managed && rec.route && <Pill tone="ok">DCS</Pill>}
                        {rec.locked && <Lock size={9} className="text-slate-500" aria-label="Locked" />}
                      </div>
                      {rec.comment && !rec.managed && <p className="text-[10px] text-slate-600 truncate max-w-[280px]" title={rec.comment}>{rec.comment}</p>}
                    </td>
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <span className="text-xs text-slate-300 font-mono truncate block" title={rec.content}>{rec.type === 'MX' && rec.priority != null ? <span className="text-slate-500">{rec.priority} </span> : null}{rec.content}</span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap"><span className="text-[11px] text-slate-400">{ttlLabel(rec.ttl)}</span></td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {PROXIABLE_TYPES.has(rec.type) ? (
                        busy ? <Loader2 size={14} className="animate-spin text-slate-500" aria-label="Changing the proxy status" /> : (
                          <Hint label={!isAdmin ? undefined : !canProxy ? 'This record cannot be proxied' : rec.proxied ? 'Switch to DNS only' : 'Proxy through Cloudflare'}>
                            <span className="inline-flex">
                              <Switch
                                size="xs"
                                checked={rec.proxied}
                                onChange={() => { if (canProxy && isAdmin) onToggleProxy(rec) }}
                                disabled={!canProxy || !isAdmin}
                                label={rec.proxied ? 'Proxied' : 'DNS only'}
                                aria-label={`${rec.proxied ? 'Proxied' : 'DNS only'} — ${rec.name}`}
                              />
                            </span>
                          </Hint>
                        )
                      ) : <span className="text-[10px] text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {isAdmin && (
                        <div className="inline-flex items-center gap-1 opacity-60 group-hover/rec:opacity-100 focus-within:opacity-100 transition-opacity">
                          <Hint label={editHint}><span className="inline-flex"><button type="button" onClick={() => onEdit(rec)} disabled={!rec.editable || busy} aria-label={`Edit ${rec.type} ${rec.name}`} className={`${BTN_ICON_SM} text-slate-500 hover:text-slate-200 hover:bg-white/10 disabled:hover:bg-transparent`}><Pencil size={12} /></button></span></Hint>
                          <Hint label={deleteHint}><span className="inline-flex"><button type="button" onClick={() => onDelete(rec)} disabled={!rec.editable || busy} aria-label={`Delete ${rec.type} ${rec.name}`} className={`${BTN_ICON_SM} text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 disabled:hover:bg-transparent`}><Trash2 size={12} /></button></span></Hint>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
