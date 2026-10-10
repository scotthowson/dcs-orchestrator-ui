// The Technitium page's Devices tab: the device directory (every device of the house: its icon, nickname, name on
// the network, address, MAC and vendor, group, a pinned address, when it was last seen, its queries and blocked ones
// in the last 24 hours). A table from md up, cards on a phone; search, filters, sort; the icon picker and the nickname
// edited in place; a row menu; the drawer with every field, the notes, its latest queries, the group and a block until
// a time. "Scan the network" fills it. A viewer reads it all and changes nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Menu } from '@mantine/core'
import {
  Radar, MoreHorizontal, Pencil, Pin, PinOff, Ban, Trash2, Loader2, MonitorSmartphone, Tags, Undo2, Clock, ListChecks, ShieldOff,
} from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import Sheet from '../common/Sheet'
import Segmented from '../common/Segmented'
import SearchInput from '../common/SearchInput'
import Notice from '../common/Notice'
import Hint from '../common/Hint'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import {
  scanTechnitiumDevices, updateTechnitiumDevice, forgetTechnitiumDevice, clearForgottenTechnitiumDevices, updateTechnitiumVendors,
  fetchTechnitiumGroups, fetchTechnitiumActivity,
} from '../../api/endpoints'
import type { TechnitiumDeviceChange, TechnitiumIcon, TechnitiumNetDevice, TechnitiumSource } from '../../../shared/types'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR_PRIMARY, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST, TEXT_META, SECTION_LABEL, FOCUS_RING } from '../../lib/ui'
import { INPUT, FIELD_SM, LABEL, HINT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'
import { DEVICE_ICONS, DeviceIcon, IconGrid, IconPicker, ago, deviceName, exact, useDeviceDirectory } from './deviceKit'

type Filter = 'all' | 'unnamed' | 'new' | 'offline' | 'blocked'
type Sort = 'activity' | 'name' | 'seen' | 'address'
const SOURCE_LABEL: Record<TechnitiumSource, string> = { dhcp: 'DHCP', arp: 'Neighbours', mdns: 'mDNS', rdns: 'Reverse DNS', querylog: 'Query log', manual: 'Edited' }
const ipNum = (ip: string | null) => (ip ? ip.split('.').reduce((a, x) => a * 256 + Number(x), 0) : Infinity)
const WEEK = 7 * 86400

export default function DevicesTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, loading, refresh } = useDeviceDirectory()
  const { data: groups } = usePolling(fetchTechnitiumGroups, 60000, { key: 'technitium-groups' })
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState<Sort>('activity')
  const [scanning, setScanning] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const now = data?.now ?? Date.now() / 1000

  const scan = async () => {
    setScanning(true)
    try { const r = await scanTechnitiumDevices(); addToast({ type: 'success', message: r.message }); await refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setScanning(false) }
  }
  const change = useCallback(async (d: TechnitiumNetDevice, c: TechnitiumDeviceChange, ok?: string) => {
    try {
      const r = await updateTechnitiumDevice(d.id, c)
      addToast({ type: r.warning || (r.sync && !r.sync.ok) ? 'warning' : 'success', message: r.warning ?? (r.sync && !r.sync.ok ? `${ok ?? 'Saved'}; the secondary did not follow: ${r.sync.message}` : ok ?? `${deviceName(r.device)} is saved`) })
      await refresh()
      return true
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }); return false }
  }, [addToast, refresh])
  const forget = async (d: TechnitiumNetDevice) => {
    if (!await confirm({ title: `Forget ${deviceName(d)}?`, message: 'It leaves the list. Seen on the network again, it comes back with its nickname, icon and notes.', confirmLabel: 'Forget device', danger: true })) return
    try { await forgetTechnitiumDevice(d.id); addToast({ type: 'success', message: `${deviceName(d)} is forgotten` }); setOpen(null); await refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
  }

  const all = useMemo(() => data?.devices ?? [], [data])
  const counts = useMemo(() => ({
    unnamed: all.filter((d) => !d.nickname).length,
    new: all.filter((d) => now - d.first_seen < 86400).length,
    offline: all.filter((d) => now - d.last_seen > WEEK).length,
    blocked: all.filter((d) => d.blocked).length,
  }), [all, now])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = all.filter((d) => {
      if (filter === 'unnamed' && d.nickname) return false
      if (filter === 'new' && now - d.first_seen >= 86400) return false
      if (filter === 'offline' && now - d.last_seen <= WEEK) return false
      if (filter === 'blocked' && !d.blocked) return false
      if (group === 'none' ? !!d.group_id : group && d.group_id !== group) return false
      return !needle || [d.nickname, d.hostname, d.ip, d.mac, d.vendor, d.group_name, d.notes].some((x) => x?.toLowerCase().includes(needle))
    })
    const by: Record<Sort, (a: TechnitiumNetDevice, b: TechnitiumNetDevice) => number> = {
      activity: (a, b) => b.queries_today - a.queries_today || b.last_seen - a.last_seen,
      name: (a, b) => deviceName(a).localeCompare(deviceName(b)),
      seen: (a, b) => b.last_seen - a.last_seen,
      address: (a, b) => ipNum(a.ip) - ipNum(b.ip),
    }
    return [...list].sort(by[sort])
  }, [all, q, filter, group, sort, now])
  const max = Math.max(1, ...all.map((d) => d.queries_today))
  const current = open ? all.find((d) => d.id === open) ?? null : null

  if (loading && !data) return <Skeleton rows={8} />
  if (error && !data) return <ErrorState title="Could not read the devices" error={error} onRetry={() => void refresh()} />
  if (!data) return null

  const scanButton = (primary: boolean) => (
    <button type="button" disabled={scanning} onClick={() => void scan()} className={primary ? BTN_TOOLBAR_PRIMARY : BTN_TOOLBAR_QUIET}>
      {scanning ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />} {scanning ? 'Scanning…' : 'Scan the network'}
    </button>
  )
  if (all.length === 0) {
    return (
      <EmptyState icon={<MonitorSmartphone size={28} />} title="No devices yet"
        hint={isAdmin
          ? 'Scan the network: DCS asks Technitium for its DHCP leases and its query log, looks at who answers on the hub\'s own network, and asks each device its name. Then give them names and icons.'
          : 'An admin scans the network to fill this list.'}
        action={isAdmin ? scanButton(true) : undefined} />
    )
  }

  const ls = data.last_scan
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="flex-1 min-w-[12rem]" size="sm" value={q} onChange={setQ} placeholder="Search devices" label="Search the devices" />
        <select aria-label="Group" className={`${FIELD_SM} w-auto`} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Every group</option>
          <option value="none">In no group</option>
          {(groups?.groups ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select aria-label="Sort" className={`${FIELD_SM} w-auto`} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="activity">Busiest first</option>
          <option value="name">By name</option>
          <option value="seen">Last seen</option>
          <option value="address">By address</option>
        </select>
        {isAdmin && scanButton(false)}
        {isAdmin && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target><button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label="More device actions"><MoreHorizontal size={14} /></button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Tags size={14} />} onClick={async () => {
                try { const r = await updateTechnitiumVendors(); addToast({ type: 'success', message: r.message }); await scan() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
              }}>Update the vendor list (IEEE)</Menu.Item>
              <Menu.Item leftSection={<Undo2 size={14} />} disabled={!data.forgotten} onClick={async () => {
                if (!await confirm({ title: 'Clear the forgotten devices?', message: `DCS keeps the nickname, icon and notes of ${data.forgotten} forgotten device${data.forgotten === 1 ? '' : 's'}, in case they come back. They go for good.`, confirmLabel: 'Clear', danger: true })) return
                try { await clearForgottenTechnitiumDevices(); addToast({ type: 'success', message: 'The forgotten devices are cleared' }); await refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
              }}>Clear the forgotten ({data.forgotten})</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </div>
      <Segmented ariaLabel="Show" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: all.length },
        { value: 'unnamed', label: 'Unnamed', count: counts.unnamed || undefined },
        { value: 'new', label: 'New today', count: counts.new || undefined },
        { value: 'offline', label: 'Away 7 days+', count: counts.offline || undefined },
        ...(counts.blocked ? [{ value: 'blocked' as const, label: 'Blocked', count: counts.blocked }] : []),
      ]} />
      <p className={TEXT_META}>
        {all.length} device{all.length === 1 ? '' : 's'}, {all.length - counts.unnamed} named
        {ls && <> · scanned <span title={exact(ls.at)}>{ago(ls.at, now)}</span>{data.dhcp ? ` · ${data.dhcp.serving ? 'Technitium hands out addresses' : 'the router hands out addresses'}` : ''}</>}
      </p>

      {rows.length === 0 ? (
        <EmptyState compact icon={<MonitorSmartphone size={28} />} title="No device matches" hint="Clear the search or pick another filter." />
      ) : (
        <>
          {/* md and up: a table */}
          <div className="hidden md:block surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-white/5">
                  <th className="pl-4 py-2.5 font-medium w-12"><span className="sr-only">Icon</span></th>
                  <th className="py-2.5 font-medium">Device</th>
                  <th className="py-2.5 font-medium">Address</th>
                  <th className="py-2.5 font-medium hidden lg:table-cell">MAC · vendor</th>
                  <th className="py-2.5 font-medium">Group</th>
                  <th className="py-2.5 font-medium">Last seen</th>
                  <th className="py-2.5 font-medium w-36">24 hours</th>
                  <th className="pr-3 py-2.5 w-10"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] align-middle">
                    <td className="pl-4 py-2"><IconPicker device={d} canEdit={isAdmin} onPick={(icon) => void change(d, { icon }, `${deviceName(d)}: ${DEVICE_ICONS[icon].label.toLowerCase()}`)} /></td>
                    <td className="py-2 pr-3 min-w-0 max-w-[16rem]">
                      <Nickname device={d} canEdit={isAdmin} onSave={(nickname) => change(d, { nickname }, nickname ? `${nickname} is named` : 'The nickname is cleared')} onOpen={() => setOpen(d.id)} />
                      <div className="text-xs text-slate-500 truncate" title={d.hostname ?? undefined}>{subline(d)}</div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-slate-300">{d.ip ?? '—'}</span>
                      <div className="flex gap-1 mt-0.5">
                        {d.static && <Pill size="xs" tone="info" icon={<Pin size={10} />} title="Its address is reserved in Technitium's DHCP">static</Pill>}
                        {d.blocked && <Pill size="xs" tone="problem" icon={<Ban size={10} />} title={`Blocked until ${exact(d.blocked_until)}`}>blocked</Pill>}
                        {d.hub && <Pill size="xs" tone="neutral">hub</Pill>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 hidden lg:table-cell min-w-0">
                      <span className="font-mono text-xs text-slate-400">{d.mac ?? '—'}</span>
                      <div className="text-xs text-slate-500 truncate max-w-[12rem]" title={d.vendor ?? undefined}>{d.vendor ?? 'vendor unknown'}</div>
                    </td>
                    <td className="py-2 pr-3">{d.group_name ? <Pill tone="fleet">{d.group_name}</Pill> : <span className="text-xs text-slate-600">—</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-400" title={exact(d.last_seen)}>{ago(d.last_seen, now)}</td>
                    <td className="py-2 pr-3"><Activity d={d} max={max} /></td>
                    <td className="pr-3 py-2 text-right"><RowMenu d={d} isAdmin={isAdmin} onOpen={() => setOpen(d.id)} onChange={change} onForget={forget} now={now} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* a phone: cards */}
          <ul className="md:hidden space-y-2">
            {rows.map((d) => (
              <li key={d.id} className="surface p-3 flex items-start gap-3 min-w-0">
                <IconPicker device={d} canEdit={isAdmin} onPick={(icon) => void change(d, { icon })} />
                <div className="min-w-0 flex-1">
                  <Nickname device={d} canEdit={isAdmin} onSave={(nickname) => change(d, { nickname })} onOpen={() => setOpen(d.id)} />
                  <div className="text-xs text-slate-500 truncate">{subline(d)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-slate-300">{d.ip ?? '—'}</span>
                    <span className="text-xs text-slate-500" title={exact(d.last_seen)}>{ago(d.last_seen, now)}</span>
                    {d.static && <Pill size="xs" tone="info">static</Pill>}
                    {d.blocked && <Pill size="xs" tone="problem">blocked</Pill>}
                    {d.group_name && <Pill size="xs" tone="fleet">{d.group_name}</Pill>}
                  </div>
                  <div className="mt-2"><Activity d={d} max={max} /></div>
                </div>
                <RowMenu d={d} isAdmin={isAdmin} onOpen={() => setOpen(d.id)} onChange={change} onForget={forget} now={now} />
              </li>
            ))}
          </ul>
        </>
      )}
      {current && <DeviceSheet device={current} isAdmin={isAdmin} now={now} groups={(groups?.groups ?? []).map((g) => ({ id: g.id, name: g.name }))}
        onClose={() => setOpen(null)} onChange={change} onForget={forget} />}
    </div>
  )
}

/** the line under a device's name: the name it gives itself once it has a nickname; else what it still lacks */
function subline(d: TechnitiumNetDevice): string {
  if (d.nickname) return d.hostname ?? d.vendor ?? (d.hub ? 'this server' : '')
  return d.hub ? 'this server · no nickname yet' : 'no nickname yet'
}

/** queries in the last 24 hours as a number and a small bar, the blocked share of it in rose */
function Activity({ d, max }: { d: TechnitiumNetDevice; max: number }) {
  const w = d.queries_today ? Math.max(4, Math.round((d.queries_today / max) * 100)) : 0
  const b = d.queries_today ? Math.min(100, Math.round((d.blocked_today / d.queries_today) * 100)) : 0
  return (
    <div className="min-w-[6rem]" aria-label={`${d.queries_today} queries in the last 24 hours, ${d.blocked_today} blocked`} role="img">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className="text-slate-300">{d.queries_today.toLocaleString()}</span>
        {d.blocked_today > 0 && <span className="text-rose-400">{d.blocked_today.toLocaleString()} blocked</span>}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full bg-cyan-500 relative overflow-hidden" style={{ width: `${w}%` }}>
          {b > 0 && <div className="absolute inset-y-0 right-0 bg-rose-400" style={{ width: `${b}%` }} />}
        </div>
      </div>
    </div>
  )
}

/** the nickname, edited where it is (Enter or leaving the field saves, Escape cancels); the name opens the drawer */
function Nickname({ device, canEdit, onSave, onOpen }: { device: TechnitiumNetDevice; canEdit: boolean; onSave: (v: string | null) => Promise<boolean>; onOpen: () => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(device.nickname ?? '')
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { if (editing) { done.current = false; ref.current?.focus(); ref.current?.select() } }, [editing])
  const commit = async () => {
    if (done.current) return
    done.current = true
    const next = v.trim()
    setEditing(false)
    if (next !== (device.nickname ?? '')) await onSave(next || null)
  }
  if (editing) {
    return (
      <input ref={ref} className={`${FIELD_SM} w-full max-w-[14rem]`} value={v} maxLength={40} aria-label={`Nickname of ${deviceName(device)}`} placeholder="A name for it"
        onChange={(e) => setV(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') { done.current = true; setV(device.nickname ?? ''); setEditing(false) } }} />
    )
  }
  return (
    <div className="flex items-center gap-1 min-w-0 group">
      <button type="button" onClick={onOpen} className={`min-w-0 truncate text-left text-sm font-medium rounded ${FOCUS_RING} ${device.nickname ? 'text-slate-200' : 'text-slate-400 italic'} hover:underline`} title="Details">
        {device.nickname ?? deviceName(device)}
      </button>
      {canEdit && (
        <button type="button" onClick={() => { setV(device.nickname ?? ''); setEditing(true) }} className={`${BTN_ICON_SM} ${TONE_GHOST} opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100`} aria-label={`Rename ${deviceName(device)}`} title="Rename">
          <Pencil size={12} />
        </button>
      )}
    </div>
  )
}

/** "until" choices for a block: half an hour, an hour, tomorrow 07:00, until turned off (a year) */
function blockChoices(now: number): { label: string; until: number }[] {
  const m = new Date(now * 1000); m.setHours(7, 0, 0, 0)
  if (m.getTime() / 1000 <= now + 60) m.setDate(m.getDate() + 1)
  return [
    { label: '30 min', until: Math.round(now + 1800) },
    { label: '1 hour', until: Math.round(now + 3600) },
    { label: `Until ${m.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${m.getDate() === new Date(now * 1000).getDate() ? 'today' : 'tomorrow'}`, until: Math.round(m.getTime() / 1000) },
    { label: 'Until I unblock it', until: Math.round(now + 365 * 86400) },
  ]
}
const blockedLabel = (until: number | null | undefined, now: number) => (!until ? '' : until - now > 300 * 86400 ? 'until you unblock it' : `until ${new Date(until * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`)

function RowMenu({ d, isAdmin, onOpen, onChange, onForget, now }: {
  d: TechnitiumNetDevice; isAdmin: boolean; now: number; onOpen: () => void
  onChange: (d: TechnitiumNetDevice, c: TechnitiumDeviceChange, ok?: string) => Promise<boolean>; onForget: (d: TechnitiumNetDevice) => void
}) {
  const name = deviceName(d)
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target><button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Actions for ${name}`}><MoreHorizontal size={14} /></button></Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Pencil size={14} />} onClick={onOpen}>{isAdmin ? 'Edit' : 'Details'}</Menu.Item>
        {isAdmin && (d.static
          ? <Menu.Item leftSection={<PinOff size={14} />} onClick={() => void onChange(d, { static: false }, `${name}: its address is no longer reserved`)}>Unpin address</Menu.Item>
          : <Menu.Item leftSection={<Pin size={14} />} disabled={!d.mac || !d.ip} onClick={() => void onChange(d, { static: true }, `${name} keeps ${d.ip}`)}>Pin address</Menu.Item>)}
        {isAdmin && (d.blocked
          ? <Menu.Item leftSection={<ShieldOff size={14} />} onClick={() => void onChange(d, { blocked_until: null }, `${name} is unblocked`)}>Unblock</Menu.Item>
          : <Menu.Item leftSection={<Ban size={14} />} disabled={!d.ip} onClick={() => void onChange(d, { blocked_until: Math.round(now + 3600) }, `${name} is blocked for an hour`)}>Block for an hour</Menu.Item>)}
        {isAdmin && <Menu.Divider />}
        {isAdmin && <Menu.Item color="rose" leftSection={<Trash2 size={14} />} onClick={() => onForget(d)}>Forget</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  )
}

/** every field of a device; what it asked lately (an admin's); the group; a block until a time */
function DeviceSheet({ device: d, isAdmin, now, groups, onClose, onChange, onForget }: {
  device: TechnitiumNetDevice; isAdmin: boolean; now: number; groups: { id: string; name: string }[]
  onClose: () => void; onChange: (d: TechnitiumNetDevice, c: TechnitiumDeviceChange, ok?: string) => Promise<boolean>; onForget: (d: TechnitiumNetDevice) => void
}) {
  const [nickname, setNickname] = useState(d.nickname ?? '')
  const [icon, setIcon] = useState<TechnitiumIcon | null>(d.icon_guessed ? null : d.icon)
  const [notes, setNotes] = useState(d.notes ?? '')
  const [groupId, setGroupId] = useState(d.group_id ?? '')
  const [stat, setStat] = useState(!!d.static)
  const [block, setBlock] = useState<number | null>(d.blocked ? d.blocked_until ?? null : null)
  const [busy, setBusy] = useState(false)
  const name = deviceName(d)
  const diff: TechnitiumDeviceChange = {}
  if (nickname.trim() !== (d.nickname ?? '')) diff.nickname = nickname.trim() || null
  if (icon && (icon !== d.icon || d.icon_guessed)) diff.icon = icon
  if (notes.trim() !== (d.notes ?? '')) diff.notes = notes.trim() || null
  if (groupId !== (d.group_id ?? '')) diff.group_id = groupId || null
  if (stat !== !!d.static) diff.static = stat
  if ((block ?? null) !== (d.blocked ? d.blocked_until ?? null : null)) diff.blocked_until = block
  const dirty = Object.keys(diff).length > 0
  const save = async () => { setBusy(true); if (await onChange(d, diff)) onClose(); setBusy(false) }
  const choices = blockChoices(now)
  const fetchLog = useCallback(() => fetchTechnitiumActivity({ client: d.ip ?? '', limit: 50 }), [d.ip])
  const { data: log, error: logError } = usePolling(fetchLog, 30000, { key: `technitium-activity:${d.ip}:50`, enabled: isAdmin && !!d.ip })
  const facts: [string, React.ReactNode][] = [
    ['Address', <span key="a" className="font-mono">{d.ip ?? '—'}{d.static && d.reserved_ip ? ' · reserved' : ''}</span>],
    ['MAC', <span key="m" className="font-mono">{d.mac ?? 'not known yet'}{d.mac_random ? ' · private (random)' : ''}</span>],
    ['Vendor', d.vendor ?? 'unknown'],
    ['Its name on the network', d.hostname ?? '—'],
    ['First seen', <span key="f" title={exact(d.first_seen)}>{ago(d.first_seen, now)}</span>],
    ['Last seen', <span key="l" title={exact(d.last_seen)}>{ago(d.last_seen, now)}</span>],
    ['Last 24 hours', `${d.queries_today.toLocaleString()} queries, ${d.blocked_today.toLocaleString()} blocked`],
  ]
  return (
    <Sheet title={name} subtitle={d.hostname && d.nickname ? d.hostname : d.vendor ?? undefined} icon={<DeviceIcon icon={icon ?? d.icon} guessed={!icon} size="sm" />} tone="info" placement="side" onClose={onClose} keepOnBackdrop={dirty}
      footer={isAdmin ? (
        <div className="flex gap-2">
          <button type="button" className={BTN_SHEET_QUIET} onClick={() => onForget(d)} aria-label={`Forget ${name}`}><Trash2 size={16} /></button>
          <button type="button" className={BTN_SHEET_QUIET} onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy || !dirty} className={`${BTN_SHEET_PRIMARY} flex-1`} onClick={() => void save()}>{busy && <Loader2 size={16} className="animate-spin" />} Save</button>
        </div>
      ) : undefined}>
      <div className="space-y-5">
        <div>
          <label htmlFor="td-nick" className={LABEL}>Nickname</label>
          <input id="td-nick" className={INPUT} value={nickname} maxLength={40} disabled={!isAdmin} placeholder={d.hostname ?? 'Tom’s tablet, the Xbox…'} onChange={(e) => setNickname(e.target.value)} />
          <p className={HINT}>Shown everywhere the page names it: the top clients, its queries, the groups.</p>
        </div>
        <div>
          <p className={LABEL} id="td-icon">Icon {d.icon_guessed && !icon && <span className="text-slate-500 font-normal">· {DEVICE_ICONS[d.icon].label.toLowerCase()} is a guess</span>}</p>
          <IconGrid value={icon} onPick={setIcon} label="Icon" disabled={!isAdmin} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-300 min-w-0 break-words">{v}</dd></div>)}
          <dt className="text-slate-500">Seen by</dt>
          <dd className="flex flex-wrap gap-1">{(Object.keys(d.sources ?? {}) as TechnitiumSource[]).map((s) => <Pill key={s} size="xs" tone="neutral" title={exact(d.sources[s])}>{SOURCE_LABEL[s] ?? s}</Pill>)}</dd>
        </dl>
        <div>
          <label htmlFor="td-group" className={LABEL}>Kids' group</label>
          <select id="td-group" className={INPUT} value={groupId} disabled={!isAdmin || !d.ip} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group: the house's blocking alone</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <p className={HINT}>A group follows the device when its address changes.</p>
        </div>
        <ToggleRow label="Pin its address" help={d.mac ? `Reserves ${d.ip ?? 'its address'} for it in Technitium's DHCP, so the groups and the logs keep following it. Needs Technitium to hand out addresses (the DHCP tab).` : 'DCS does not know its MAC address yet: scan while it is on.'}
          checked={stat} disabled={!isAdmin || !d.mac || !d.ip} onChange={setStat} />
        <div className="space-y-2">
          <ToggleRow label="Block this device entirely" help={block ? `Every name stops answering for it ${blockedLabel(block, now)}, as at bedtime.` : 'Every name stops answering for it until the time you pick, as at bedtime.'}
            checked={block !== null} disabled={!isAdmin || !d.ip} onChange={(v) => setBlock(v ? choices[1].until : null)} />
          {block !== null && isAdmin && (
            <div role="group" aria-label="Blocked until" className="flex flex-wrap gap-1.5">
              {choices.map((c) => <button key={c.label} type="button" aria-pressed={Math.abs((block ?? 0) - c.until) < 90} className={`${CHOICE_SM} ${Math.abs((block ?? 0) - c.until) < 90 ? CHOICE_ON : CHOICE_OFF}`} onClick={() => setBlock(c.until)}><Clock size={12} /> {c.label}</button>)}
            </div>
          )}
        </div>
        <div>
          <label htmlFor="td-notes" className={LABEL}>Notes</label>
          <textarea id="td-notes" className={`${INPUT} min-h-[5rem]`} value={notes} maxLength={280} disabled={!isAdmin} placeholder="Where it is, whose it is…" onChange={(e) => setNotes(e.target.value)} />
          <p className={`${HINT} text-right tabular-nums`}>{notes.length} / 280</p>
        </div>
        {isAdmin && d.ip && (
          <div>
            <h3 className={`${SECTION_LABEL} flex items-center gap-1.5 mb-2`}><ListChecks size={12} /> Latest queries</h3>
            {logError && !log ? <Notice tone="attention">{apiErrorMessage(logError)}</Notice>
              : !log ? <Skeleton rows={4} />
                : log.entries.length === 0 ? <p className={TEXT_META}>Nothing in the query log for {d.ip}.</p>
                  : (
                    <ul className="divide-y divide-white/5 text-xs">
                      {log.entries.slice(0, 50).map((e, i) => (
                        <li key={`${e.time}-${i}`} className={`flex items-center gap-2 py-1 ${e.blocked ? 'text-rose-400' : 'text-slate-300'}`}>
                          <span className="text-slate-500 tabular-nums shrink-0">{new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="font-mono truncate flex-1" title={e.name}>{e.name}</span>
                          {e.blocked && <Pill size="xs" tone="problem">blocked</Pill>}
                        </li>
                      ))}
                    </ul>
                  )}
          </div>
        )}
        {!isAdmin && <Hint label="A viewer reads the device; an admin changes it"><p className={TEXT_META}>Read only.</p></Hint>}
      </div>
    </Sheet>
  )
}
