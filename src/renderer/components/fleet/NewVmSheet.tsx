// =============================================================================
// NewVmSheet — "a stack in its own VM": the hub creates a VM on Proxmox for the
// stack named here (cloud image, cloud-init, static address, ssh bootstrap,
// unattended member setup, join). The VM settings (node, storage, bridge,
// network) come prefilled from /fleet/provision/defaults and are remembered.
// =============================================================================

import { useConnectionStore } from '../../stores/connectionStore'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Select, Switch, type ComboboxItem, type ComboboxParsedItem, type OptionsFilter } from '@mantine/core'
import { Check, Layers, Loader2, Rocket, Server } from 'lucide-react'
import { fetchFleetProvisionDefaults, provisionFleet, bakeFleetTemplate, fetchFleetMoveCheck, fetchDomains } from '../../api/endpoints'
import type { FleetMoveCheck, FleetProvisionDefaults, FleetVmPlan, ProxmoxCapabilities , FleetProvisionRequest, DomainsResponse } from '../../../shared/types'
import { HubFirewallNote } from './fleetShared'
import { VmSizeControl } from './VmSizeControl'
import { isMobile } from '../../hooks/useMobile'
import { BTN_SHEET_PRIMARY, BTN_SHEET_QUIET } from '../../lib/ui'

import Sheet from '../common/Sheet'
import { INPUT_FLEET, LABEL } from '../../lib/fieldStyles'
export interface VmSettings { node: string; storage: string; image_storage: string; bridge: string; cidr: number; gateway: string; dns: string; ip_start: string; /** what the VMs are built from: cat:<id> (catalogue), url, pve:<file> (imported already), iso:<volid> (installer, by hand) */ os: string; image_url: string; /** bake a DCS template first when the chosen image has none, then clone it for every VM */ bake: boolean }

export interface OsChoice {
  value: string
  label: string
  group: string
  byHand?: boolean
  /** the short name the picker shows ("DCS Fedora 44", "Debian 13 (trixie)", a file) */
  name: string
  /** the facts the picker shows muted on the right, read from the data: size, SELinux, apt/dnf, storage */
  hint?: string
}

const gbOf = (bytes: number) => `${(bytes / 1073741824).toFixed(1)} GB`
/** "DCS Fedora 44 — purpose-built, …" → "DCS Fedora 44"; "Debian 13 (trixie) cloud image, tools and …" → "Debian 13 (trixie)" */
const shortName = (label: string) => label.replace(/ — .*$/, '').replace(/ cloud image\b.*$/, '')
/** what a catalogue label says in passing: SELinux, its size "(400 MB)" */
const labelFacts = (label: string) => [/selinux/i.test(label) ? 'SELinux' : '', /\((\d[\d.,]* ?[KMGT]B)\)\s*$/.exec(label)?.[1] ?? ''].filter(Boolean).join(' · ')

/** The operating-system choices: the purpose-built DCS images first, the baked templates, the other cloud images, what Proxmox already holds, a URL */
export function osChoices(d: FleetProvisionDefaults | null): OsChoice[] {
  const out: OsChoice[] = []
  const catalogue = d?.images?.catalogue ?? []
  for (const c of catalogue.filter((c) => c.prebuilt)) out.push({ value: `cat:${c.id}`, label: c.label, group: 'DCS images — purpose-built for the fleet (recommended)', name: shortName(c.label), hint: labelFacts(c.label) })
  for (const tp of d?.images?.templates ?? []) {
    const base = catalogue.find((c) => c.id === tp.image_id)?.label.replace(/ — .*$/, '') ?? tp.image_id
    const baked = new Date(tp.baked_at * 1000).toLocaleDateString()
    out.push({ value: `tpl:${tp.image_id}`, label: `${base} — DCS template VM ${tp.vmid}, baked ${baked}`, group: 'Baked DCS templates — cloned in about half a minute', name: shortName(base), hint: `VM ${tp.vmid} · ${baked}` })
  }
  for (const c of catalogue.filter((c) => !c.prebuilt)) out.push({ value: `cat:${c.id}`, label: `${c.label}${c.family === 'dnf' ? ' · dnf' : ''}`, group: 'Cloud images — tools and Docker installed by the hub', name: shortName(c.label), hint: c.family })
  for (const i of d?.images?.on_proxmox?.imports ?? []) out.push({ value: `pve:${i.file}`, label: `${i.file} (${gbOf(i.size)}, on ${i.storage})`, group: 'On Proxmox already — cloud images', name: i.file, hint: `${gbOf(i.size)} · ${i.storage}` })
  for (const i of d?.images?.on_proxmox?.isos ?? []) out.push({ value: `iso:${i.volid}`, label: `${i.file} (${gbOf(i.size)}) — install by hand, then join`, group: 'On Proxmox already — installer ISOs', byHand: true, name: i.file, hint: `${gbOf(i.size)} · by hand` })
  out.push({ value: 'url', label: 'A cloud image from a URL…', group: 'Anything else', name: 'A cloud image from a URL…' })
  return out
}
/** how long a build takes, in the words the docs use: a VM built from a DCS image or cloned from a baked template about half a minute; a cloud image installs everything, a minute and a half (an installer ISO is done by hand: no time to give) */
export function buildTimeNote(os: string, bake: boolean): string {
  if (os.startsWith('iso:')) return 'You install the system in the Proxmox console'
  if (os.startsWith('cat:dcs-') || os.startsWith('tpl:')) return 'The VM is ready in about half a minute'
  return bake ? 'The first build bakes the template (about two minutes), then the VM is ready in about half a minute' : 'The VM is ready in a minute and a half'
}
export function osLabel(s: VmSettings | null, d: FleetProvisionDefaults | null): string {
  if (!s) return ''
  if (s.os === 'url') return s.image_url ? s.image_url.split('/').pop() ?? s.image_url : 'a URL'
  const c = osChoices(d).find((o) => o.value === s.os)
  if (c) return c.name
  return s.os.replace(/^(cat|pve|iso):/, '')
}

/** an option of a picker: its name, and its facts muted on the right */
function OptionRow({ label, hint, checked }: { label: string; hint?: ReactNode; checked?: boolean }) {
  return (
    <span className="flex items-center gap-3 w-full min-w-0">
      <span className="truncate flex-1">{label}</span>
      {hint ? <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{hint}</span> : null}
      <Check size={13} className={`shrink-0 ${checked ? '' : 'invisible'}`} aria-hidden />
    </span>
  )
}

/** A picker in a Proxmox form: the choices (grouped when they carry a group), searched by name, fact and group on a
 *  keyboard (a phone gets the plain list, without its keyboard popping up), each fact muted on the right */
function FleetSelect({ id, value, onChange, choices, disabled, empty }: { id: string; value: string; onChange: (v: string) => void; choices: { value: string; name: string; hint?: string; group?: string }[]; disabled?: boolean; empty: string }) {
  const byValue = new Map(choices.map((o) => [o.value, o]))
  const groups = Array.from(new Set(choices.map((o) => o.group ?? '')))
  const item = (o: { value: string; name: string }): ComboboxItem => ({ value: o.value, label: o.name })
  const data = groups.some(Boolean)
    ? groups.map((g) => ({ group: g, items: choices.filter((o) => (o.group ?? '') === g).map(item) }))
    : choices.map(item)
  const filter: OptionsFilter = ({ options, search }) => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    const hit = (o: ComboboxItem) => { const c = byValue.get(o.value); return `${o.label} ${c?.hint ?? ''} ${c?.group ?? ''}`.toLowerCase().includes(q) }
    const found: ComboboxParsedItem[] = []
    for (const x of options) {
      if ('group' in x) { const items = x.items.filter(hit); if (items.length) found.push({ ...x, items }) }
      else if (hit(x)) found.push(x)
    }
    return found
  }
  return (
    <Select
      id={id}
      variant="fleet"
      data={data}
      value={value}
      onChange={(v) => { if (v !== null) onChange(v) }}
      disabled={disabled}
      searchable={!isMobile && choices.length > 6}
      spellCheck={false}
      autoComplete="off"
      filter={filter}
      nothingFoundMessage={empty}
      renderOption={({ option, checked }) => <OptionRow label={option.label} hint={byValue.get(option.value)?.hint} checked={checked} />}
    />
  )
}
/** The request fields the settings stand for (the hub takes image | image_url | image_file | iso) */
export function vmSettingsToRequest(s: VmSettings): Omit<FleetProvisionRequest, 'vms'> {
  const { os, image_url, bake, ...rest } = s
  const pick: Partial<FleetProvisionRequest> = os.startsWith('cat:') ? { image: os.slice(4), bake: bake && !os.startsWith('cat:dcs-') } : os.startsWith('tpl:') ? { image: os.slice(4), from_template: true } : os === 'url' ? { image_url, bake } : os.startsWith('pve:') ? { image_file: os.slice(4), bake } : os.startsWith('iso:') ? { iso: os.slice(4) } : {}
  return { ...rest, ...pick }
}
// remembered per hub (another hub has other storages and another network)
const settingsKey = () => `dcs-fleet-vm-settings:${useConnectionStore.getState().serverUrl || 'default'}`

export function loadVmSettings(): Partial<VmSettings> {
  try { const raw = localStorage.getItem(settingsKey()); return raw ? (JSON.parse(raw) as Partial<VmSettings>) : {} } catch { return {} }
}
export function saveVmSettings(s: VmSettings) { try { localStorage.setItem(settingsKey(), JSON.stringify(s)) } catch { /* private window */ } }

/** the hub's defaults, with what was remembered on top — but only where it still exists on this Proxmox */
export function settingsFromDefaults(d: FleetProvisionDefaults, saved: Partial<VmSettings> = {}): VmSettings {
  const has = (name?: string) => !!name && d.storages.some((s) => s.storage === name)
  return {
    node: saved.node && (!d.node || saved.node === d.node) ? saved.node : d.node,
    storage: has(saved.storage) ? (saved.storage as string) : d.storage,
    image_storage: has(saved.image_storage) ? (saved.image_storage as string) : (d.image_storage || 'local'),
    os: saved.os && osChoices(d).some((o) => o.value === saved.os) ? saved.os : (d.images?.templates?.[0] ? `tpl:${d.images.templates[0].image_id}` : `cat:${d.images?.catalogue?.[0]?.id ?? 'debian-13'}`),
    image_url: saved.image_url || '',
    bake: saved.bake ?? true,
    bridge: saved.bridge || d.bridge || 'vmbr0',
    cidr: saved.cidr || d.cidr || 24,
    gateway: saved.gateway || d.gateway,
    dns: saved.dns || d.dns,
    ip_start: saved.ip_start || d.ip_start,
  }
}

/** The VM settings block shared by the wizard's layout step and the New VM sheet */
export function VmSettingsFields({ value, onChange, defaults, disabled = false }: { value: VmSettings; onChange: (v: VmSettings) => void; defaults: FleetProvisionDefaults | null; disabled?: boolean }) {
  const set = (k: keyof VmSettings, v: string | number) => onChange({ ...value, [k]: k === 'bake' ? Boolean(v) : v })
  const storages = defaults?.storages ?? []
  const id = useId()
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="col-span-2 sm:col-span-4">
        <label htmlFor={`${id}-os`} className={LABEL}>Operating system</label>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[16rem]">
            <FleetSelect id={`${id}-os`} value={value.os} onChange={(v) => set('os', v)} choices={osChoices(defaults)} disabled={disabled} empty="No image matches" />
          </div>
          {value.os === 'url' && <input value={value.image_url} onChange={(e) => set('image_url', e.target.value)} className={`${INPUT_FLEET} flex-[2] min-w-[16rem]`} disabled={disabled} placeholder="https://…/image.qcow2 (cloud-init, apt or dnf)" aria-label="Image URL" />}
        </div>
        {!value.os.startsWith('iso:') && !value.os.startsWith('tpl:') && !value.os.startsWith('cat:dcs-') && (
          <div className="mt-2.5 text-slate-300">
            <Switch
              size="sm"
              color="violet"
              checked={value.bake}
              onChange={(e) => set('bake', e.currentTarget.checked ? 1 : 0)}
              disabled={disabled}
              label="Bake a DCS template first (once, about two minutes), then clone it for every VM — a clone builds in about half a minute instead of a minute and a half, and the template stays for the next builds."
              styles={{ label: { fontSize: 11, lineHeight: 1.5 } }}
            />
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-1">
          {value.os.startsWith('cat:dcs-') ? 'A purpose-built DCS image: a Docker host and nothing else, with the tools, Docker and the guest agent already in place — nothing to install or bake. The VM boots in seconds; only the fresh DCS code and the join run.' : value.os.startsWith('tpl:') ? 'A baked DCS template: the VM is a clone with the tools, Docker and the guest agent already in place; only cloud-init, the fresh DCS code and the join run.' : value.os.startsWith('iso:') ? 'An installer: the hub creates the VM with the ISO attached and shows the join code; you install in the Proxmox console, then join.' : 'A cloud image: Proxmox downloads it once (or the hub uploads it), the VM is installed, joined and running without a hand on it. Ubuntu, Debian, Fedora and AlmaLinux are covered; any cloud-init image with apt or dnf works.'}
        </p>
        {(() => {
          const hardware = defaults?.images?.catalogue?.find((c) => `cat:${c.id}` === value.os)?.hardware
          return hardware ? <p className="text-[10px] text-slate-500 mt-1">{hardware}.</p> : null
        })()}
      </div>
      <div>
        <label htmlFor={`${id}-node`} className={LABEL}>Node</label>
        <input id={`${id}-node`} value={value.node} onChange={(e) => set('node', e.target.value)} className={INPUT_FLEET} disabled={disabled} placeholder="pve" />
      </div>
      <div>
        <label htmlFor={`${id}-storage`} className={LABEL}>Disk storage</label>
        {storages.length ? (
          <FleetSelect id={`${id}-storage`} value={value.storage} onChange={(v) => set('storage', v)} disabled={disabled} empty="No storage holds VM disks"
            choices={storages.filter((s) => s.images).map((s) => ({ value: s.storage, name: s.storage, hint: `${s.type} · ${Math.round(s.avail / 1073741824)} GB free` }))} />
        ) : <input id={`${id}-storage`} value={value.storage} onChange={(e) => set('storage', e.target.value)} className={INPUT_FLEET} disabled={disabled} placeholder="local-lvm" />}
      </div>
      <div>
        <label htmlFor={`${id}-images`} className={LABEL}>Image storage</label>
        {storages.length ? (
          <FleetSelect id={`${id}-images`} value={value.image_storage} onChange={(v) => set('image_storage', v)} disabled={disabled} empty="No directory storage"
            choices={storages.filter((s) => s.dir).map((s) => ({ value: s.storage, name: s.storage, hint: s.import_ready ? undefined : 'import switched on by the hub' }))} />
        ) : <input id={`${id}-images`} value={value.image_storage} onChange={(e) => set('image_storage', e.target.value)} className={INPUT_FLEET} disabled={disabled} placeholder="local" />}
      </div>
      <div>
        <label htmlFor={`${id}-bridge`} className={LABEL}>Bridge</label>
        <input id={`${id}-bridge`} value={value.bridge} onChange={(e) => set('bridge', e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={disabled} placeholder="vmbr0" />
      </div>
      <div>
        <label htmlFor={`${id}-first`} className={LABEL}>First address</label>
        <input id={`${id}-first`} value={value.ip_start} onChange={(e) => set('ip_start', e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={disabled} placeholder="192.168.1.200" />
      </div>
      <div>
        <label htmlFor={`${id}-prefix`} className={LABEL}>Prefix</label>
        <input id={`${id}-prefix`} type="number" min={8} max={30} value={value.cidr} onChange={(e) => set('cidr', Number(e.target.value) || 24)} className={`${INPUT_FLEET} font-mono`} disabled={disabled} />
      </div>
      <div>
        <label htmlFor={`${id}-gateway`} className={LABEL}>Gateway</label>
        <input id={`${id}-gateway`} value={value.gateway} onChange={(e) => set('gateway', e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={disabled} placeholder="192.168.1.1" />
      </div>
      <div>
        <label htmlFor={`${id}-dns`} className={LABEL}>DNS</label>
        <input id={`${id}-dns`} value={value.dns} onChange={(e) => set('dns', e.target.value)} className={`${INPUT_FLEET} font-mono`} disabled={disabled} placeholder="192.168.1.1" />
      </div>
    </div>
  )
}

export function CapabilityNote({ caps }: { caps: ProxmoxCapabilities | null }) {
  if (!caps) return null
  if (caps.can_provision) return <p className="text-[11px] text-emerald-300/90">{caps.hint}</p>
  return <p className="text-[11px] text-amber-300">The token cannot create VMs yet — missing {caps.missing.join(', ')}. {caps.hint}</p>
}

interface Props {
  defaults: FleetProvisionDefaults | null
  caps: ProxmoxCapabilities | null
  onClose: () => void
  onQueued: () => void
  /** given: the sheet also offers "Bake only" — a DCS template from the chosen cloud image, no VM (the image's name for the toast) */
  onBaked?: (image: string) => void
  initialStack?: string
  /** given: the sheet moves this stack of the hub into the VM with what it holds (its name is fixed) */
  moveStack?: string
}

const sizeOfKb = (kb: number) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : kb >= 1024 ? `${Math.round(kb / 1024)} MB` : `${kb} KB`)

// What changes for the stack in a VM, said before anything moves: nothing here stops the move, but each needs a look after it
function MoveNotes({ check }: { check: FleetMoveCheck }) {
  const notes: { key: string; text: ReactNode }[] = []
  const ports = check.ports ?? []
  if (ports.length > 0) notes.push({ key: 'ports', text: <>Ports it opens on the host move to the VM&apos;s address: <span className="font-mono">{ports.map((p) => `${p.port}/${p.protocol}`).join(', ')}</span> — whatever reaches them by this server&apos;s address needs the VM&apos;s.</> })
  if ((check.devices ?? []).length > 0) notes.push({ key: 'dev', text: <>It uses host devices (<span className="font-mono">{(check.devices ?? []).join(', ')}</span>): the move waits until the VM has them (PCI passthrough).</> })
  if ((check.docker_socket ?? []).length > 0) notes.push({ key: 'sock', text: <>{(check.docker_socket ?? []).join(', ')} drive{(check.docker_socket ?? []).length === 1 ? 's' : ''} Docker: in the VM {(check.docker_socket ?? []).length === 1 ? 'it sees' : 'they see'} the VM&apos;s containers, not the hub&apos;s.</> })
  const out = check.links_out ?? []
  if (out.length > 0) notes.push({ key: 'out', text: <>Its settings reach other stacks by name ({[...new Set(out.map((l) => l.name))].join(', ')}): from the VM those names go through the hub&apos;s address instead — check them after the move.</> })
  const inn = check.links_in ?? []
  if (inn.length > 0) notes.push({ key: 'in', text: <>Other stacks reach it by name ({[...new Set(inn.map((l) => `${l.stack} → ${l.name}`))].join(', ')}): point them at its route or the VM&apos;s address after the move.</> })
  if (notes.length === 0) return null
  return (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/[0.05] p-2">
      <p className="text-[11px] font-medium text-sky-200">Good to know</p>
      <ul className="mt-1 text-[11px] text-sky-100/85 space-y-1 list-disc pl-4">{notes.map((n) => <li key={n.key}>{n.text}</li>)}</ul>
    </div>
  )
}

export default function NewVmSheet({ defaults, caps, onClose, onQueued, onBaked, initialStack = '', moveStack }: Props) {
  const uid = useId()
  const moving = !!moveStack
  const [stack, setStack] = useState(moveStack || initialStack)
  // a move: what the stack holds, read once when the sheet opens
  const [check, setCheck] = useState<FleetMoveCheck | null>(null)
  const [checkErr, setCheckErr] = useState('')
  useEffect(() => {
    if (!moveStack) return
    let alive = true
    fetchFleetMoveCheck(moveStack)
      .then((c) => {
        if (!alive) return
        setCheck(c); setDiskGb((d) => Math.max(d, c.suggested_disk_gb))
        // a service with cpus: 4 is refused by Docker on a VM of fewer cores, and memory limits want room
        if (c.min_cores) setCores((n) => Math.max(n, c.min_cores ?? 0))
        if (c.memory_limits_mb) setMemGb((g) => Math.max(g, Math.min(64, Math.ceil(((c.memory_limits_mb ?? 0) + 1024) / 1024))))
      })
      .catch((e) => { if (alive) setCheckErr(e instanceof Error ? e.message : 'Could not read what the stack holds') })
    return () => { alive = false }
  }, [moveStack])
  // the domain its apps answer under: offered when the hub has more than one (default: the one for new VMs)
  const [domains, setDomains] = useState<DomainsResponse | null>(null)
  const [domain, setDomain] = useState('')
  useEffect(() => {
    let alive = true
    fetchDomains().then((d) => { if (alive) { setDomains(d); setDomain(d.vm_default ?? d.primary ?? '') } }).catch(() => { /* an older hub: one domain */ })
    return () => { alive = false }
  }, [])
  const [cores, setCores] = useState(defaults?.defaults.cores ?? 2)
  const [memGb, setMemGb] = useState(Math.round((defaults?.defaults.memory_mb ?? 4096) / 1024))
  const [diskGb, setDiskGb] = useState(defaults?.defaults.disk_gb ?? 32)
  const [ip, setIp] = useState('')
  const [settings, setSettings] = useState<VmSettings>(() => defaults ? settingsFromDefaults(defaults, loadVmSettings()) : { node: '', storage: '', image_storage: 'local', bridge: 'vmbr0', cidr: 24, gateway: '', dns: '', ip_start: '', os: 'cat:debian-13', image_url: '', bake: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (defaults) setSettings((s) => (s.node ? s : settingsFromDefaults(defaults, loadVmSettings()))) }, [defaults])
  const ok = /^[a-z0-9][a-z0-9-]{0,40}$/.test(stack) && settings.node && settings.storage && settings.gateway && (ip || settings.ip_start) && !(moving && (check?.earlier_vm || check?.movable === false || cores < (check?.min_cores ?? 0)))
  // a template is baked from a cloud image alone: a DCS image needs none, a baked template is one, an installer cannot be
  const bakeable = !!onBaked && !settings.os.startsWith('iso:') && !settings.os.startsWith('tpl:') && !settings.os.startsWith('cat:dcs-') && (settings.os !== 'url' || /^https?:\/\//.test(settings.image_url))
  const okBake = bakeable && settings.node && settings.storage && settings.gateway && settings.ip_start
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      const vm: FleetVmPlan = { stack, cores, memory_mb: memGb * 1024, disk_gb: diskGb }
      if (moving) vm.move = true
      if (domains && domains.domains.length > 1 && domain) vm.domain = domain
      if (ip.trim()) vm.ip = ip.trim()
      await provisionFleet({ ...vmSettingsToRequest(settings), vms: [vm] })
      saveVmSettings(settings)
      onQueued(); onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : 'The request failed') } finally { setBusy(false) }
  }
  // "Bake only": POST /fleet/templates takes the VM settings without vms and queues the one bake job (no stack name needed)
  const bakeOnly = async () => {
    setErr(''); setBusy(true)
    try {
      await bakeFleetTemplate(vmSettingsToRequest({ ...settings, bake: true }))
      saveVmSettings(settings)
      onBaked?.(osLabel(settings, defaults) || 'the image'); onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : 'The request failed') } finally { setBusy(false) }
  }
  return (
    <Sheet tone="fleet"
      title={moving ? `Move ${moveStack} into its own VM` : 'A stack in its own VM'}
      subtitle={moving
        ? 'The VM is built while the stack keeps running here; then the stack is stopped, its data is copied and it starts in the VM'
        : 'The hub creates the VM on Proxmox, installs Docker and DCS in it and joins it; the stack then lives there'}
      icon={<Server size={18} />}
      onClose={busy ? () => {} : onClose}
      wide
      footer={<>
        {err && <p role="alert" className="text-xs text-rose-300 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
          {bakeable && !moving && (
            <button type="button" onClick={bakeOnly} disabled={busy || !okBake || (caps ? !caps.can_provision : false)} title="Bake a DCS template from this image now, without building a VM" className={`${BTN_SHEET_QUIET} flex-1`}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />} Bake only
            </button>
          )}
          <button type="button" onClick={submit} disabled={busy || !ok || (caps ? !caps.can_provision : false)} className={`${BTN_SHEET_PRIMARY} flex-1`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />} {moving ? 'Move it' : 'Build the VM'}
          </button>
        </div>
      </>}
    >
      <div className="space-y-4">
        <HubFirewallNote fw={defaults?.hub_firewall} />
        <div>
          <label htmlFor={`${uid}-stack`} className={LABEL}>Stack = VM name</label>
          <input id={`${uid}-stack`} value={stack} onChange={(e) => setStack(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="media-services" className={`${INPUT_FLEET} font-mono sm:max-w-xs`} disabled={busy || moving} />
        </div>
        {moving && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3 space-y-2">
            <p className="text-xs font-medium text-violet-200">What goes with it</p>
            {checkErr && <p role="alert" className="text-xs text-rose-300">{checkErr}</p>}
            {!check && !checkErr && <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading what the stack holds…</p>}
            {check && (
              <>
                <ul className="text-xs text-slate-300 space-y-0.5">
                  {check.folders.map((f) => <li key={f.name}><span className="font-mono">{f.name}</span> · {sizeOfKb(f.kb)} in {f.files.toLocaleString()} files</li>)}
                  {check.volumes.map((v) => <li key={v.name}>volume <span className="font-mono">{v.volume}</span> · {sizeOfKb(v.kb)} in {v.files.toLocaleString()} files</li>)}
                  {check.folders.length + check.volumes.length === 0 && <li>No data folders or volumes: the configuration alone moves.</li>}
                  {check.routes > 0 && <li>{check.routes} route{check.routes === 1 ? '' : 's'}: the same addresses reach it in the VM</li>}
                </ul>
                <p className="text-[11px] text-slate-400">
                  Owners and permissions are kept, and every copy is counted on both sides. The hub keeps its own copy of the data, and if the stack does not come up
                  in the VM it is started here again. {check.containers_up > 0 ? `It is down for the time of the copy (${sizeOfKb(check.data_kb)}).` : ''}
                </p>
                {check.outside_paths.length > 0 && (
                  <div className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-2">
                    <p className="text-[11px] text-amber-200">These folders are not part of the stack and stay on this server. The VM needs them at the same path (a host folder of the Proxmox host, or a network share):</p>
                    <ul className="mt-1 text-[11px] font-mono text-amber-100/90 space-y-0.5">{check.outside_paths.map((o) => <li key={o} className="truncate">{o}</li>)}</ul>
                  </div>
                )}
                {diskGb < check.suggested_disk_gb && <p className="text-[11px] text-amber-300">The data needs a disk of at least {check.suggested_disk_gb} GB.</p>}
                {check.earlier_vm && <p role="alert" className="text-[11px] text-rose-300">{check.earlier_vm}</p>}
                {(check.blockers ?? []).length > 0 && (
                  <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/[0.07] p-2">
                    <p className="text-[11px] font-medium text-rose-200">This stack stays on the hub:</p>
                    <ul className="mt-1 text-[11px] text-rose-100/90 space-y-0.5 list-disc pl-4">{(check.blockers ?? []).map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                )}
                {cores < (check.min_cores ?? 0) && (
                  <p role="alert" className="text-[11px] text-rose-300">
                    Give the VM at least {check.min_cores} cores: {(check.cpu_limits ?? []).filter((c) => c.cpus > cores).map((c) => `${c.service} (cpus: ${c.cpus})`).join(', ')} — Docker refuses a container whose limit is above the machine's cores.
                  </p>
                )}
                <MoveNotes check={check} />
              </>
            )}
          </div>
        )}
        {domains && domains.domains.length > 1 && (
          <div>
            <label htmlFor={`${uid}-domain`} className={LABEL}>Domain</label>
            <select id={`${uid}-domain`} value={domain} onChange={(e) => setDomain(e.target.value)} disabled={busy} className={`${INPUT_FLEET} font-mono`}>
              {domains.domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}{d.primary ? ' (the hub)' : ''}</option>)}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">Its apps answer under *.{domain || domains.primary}{moving ? ' (its routes move there with it)' : ''}. Change it later on the VM.</p>
          </div>
        )}
        <div>
          <p className={LABEL}>Size</p>
          <VmSizeControl value={{ cores, memGb, diskGb }} disabled={busy}
            limits={{ maxCores: defaults?.capacity?.cores, maxMemGb: defaults?.capacity?.memory_gb, minDiskGb: 10 }}
            onChange={(v) => { setCores(v.cores); setMemGb(v.memGb); setDiskGb(v.diskGb) }} />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">VM settings <span className="normal-case tracking-normal font-normal text-slate-500">— remembered for the next VM</span></p>
          <VmSettingsFields value={settings} onChange={setSettings} defaults={defaults} disabled={busy} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div>
              <label htmlFor={`${uid}-ip`} className={LABEL}>Address for this VM</label>
              <input id={`${uid}-ip`} value={ip} onChange={(e) => setIp(e.target.value)} placeholder={`next free from ${settings.ip_start || '…'}`} className={`${INPUT_FLEET} font-mono`} disabled={busy} />
            </div>
          </div>
        </div>
        <CapabilityNote caps={caps} />
        <p className="text-[11px] text-slate-500">{osLabel(settings, defaults) || 'The image'}, imported once · user {defaults?.vm_user || 'dcs'} with the hub's ssh key · the VM's admin is {defaults?.admin_user || 'your account'} with a generated password kept in the hub's secret store · {buildTimeNote(settings.os, settings.bake)}; watch it on the card.</p>
      </div>
    </Sheet>
  )
}
