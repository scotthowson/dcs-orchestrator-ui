// The Technitium page's Devices tab: the device directory (every device of the house: its icon, nickname, name on
// the network, address, MAC and vendor, group, a pinned address, when it was last seen, its queries and blocked ones
// in the last 24 hours). A table from md up, cards on a phone (the card opens the drawer); search, filters, sort; the icon picker and the nickname
// edited in place; a row menu; the drawer with every field, the notes, its latest queries, the group and a block until
// a time; the house and its own rules: whether it follows the house's rules, its own allow and block lists, its own
// categories, YouTube and window. "Scan the network" fills it. A viewer reads it all and changes nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Menu } from '@mantine/core'
import {
  Radar, MoreHorizontal, Pencil, Pin, PinOff, Ban, Trash2, Loader2, MonitorSmartphone, Tags, Undo2, Clock, ListChecks, ShieldOff, House, UserX, Plus,
} from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import Sheet from '../common/Sheet'
import Segmented from '../common/Segmented'
import SearchInput from '../common/SearchInput'
import Notice from '../common/Notice'
import Hint from '../common/Hint'
import { ToggleRow } from '../common/Toggle'
import { CopyButton } from '../common/CopyButton'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { refreshPoll } from '../../lib/poll'
import { apiErrorMessage } from '../../api/errors'
import {
  scanTechnitiumDevices, updateTechnitiumDevice, forgetTechnitiumDevice, clearForgottenTechnitiumDevices, updateTechnitiumVendors,
  fetchTechnitiumGroups, fetchTechnitiumActivity,
} from '../../api/endpoints'
import type { TechnitiumDeviceChange, TechnitiumDeviceOverride, TechnitiumGroups, TechnitiumIcon, TechnitiumNetDevice, TechnitiumSource, TechnitiumWindow } from '../../../shared/types'
import { NameList, WindowEditor, YoutubeChoice } from './GroupSheet'
import { AllowForAnHour } from './ActivityTab'
import { NEW_WINDOW } from './kidsKit'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR_PRIMARY, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST, TEXT_META, SECTION_LABEL, FOCUS_RING } from '../../lib/ui'
import { INPUT, FIELD_SM, LABEL, HINT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'
import { DEVICE_ICONS, DeviceIcon, GroupMark, IconGrid, IconPicker, TAP, ago, deviceName, exact, useDeviceDirectory } from './deviceKit'

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
      void refreshPoll('technitium-groups')   // a group, the house's exempt devices
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
                  <th className="pl-4 pr-4 py-2.5 font-medium w-[4.25rem]"><span className="sr-only">Icon</span></th>
                  <th className="pr-4 py-2.5 font-medium">Device</th>
                  <th className="pr-4 py-2.5 font-medium">Address</th>
                  <th className="pr-4 py-2.5 font-medium hidden lg:table-cell">MAC · vendor</th>
                  <th className="pr-4 py-2.5 font-medium">Group</th>
                  <th className="pr-4 py-2.5 font-medium">Last seen</th>
                  <th className="pr-4 py-2.5 font-medium w-40">24 hours</th>
                  <th className="pr-3 py-2.5 w-11"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="group/row border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] align-middle">
                    <td className="pl-4 pr-4 py-3"><IconPicker device={d} canEdit={isAdmin} onPick={(icon) => void change(d, { icon }, `${deviceName(d)}: ${DEVICE_ICONS[icon].label.toLowerCase()}`)} /></td>
                    <td className="pr-4 py-3 min-w-0 max-w-[18rem]">
                      <Nickname device={d} canEdit={isAdmin} onSave={(nickname) => change(d, { nickname }, nickname ? `${nickname} is named` : 'The nickname is cleared')} onOpen={() => setOpen(d.id)} />
                      {subline(d) && <div className="text-xs text-slate-500 truncate" title={d.hostname ?? undefined}>{subline(d)}</div>}
                      <HomeName d={d} />
                    </td>
                    <td className="pr-4 py-3 whitespace-nowrap">
                      <span className="font-mono text-xs text-slate-300">{d.ip ?? '—'}</span>
                      {(d.static || d.blocked || d.hub) && (
                        <div className="flex gap-1">
                          {d.static && <Pill size="xs" tone="info" icon={<Pin size={10} />} title="Its address is reserved in Technitium's DHCP">static</Pill>}
                          {d.blocked && <Pill size="xs" tone="problem" icon={<Ban size={10} />} title={`Blocked until ${exact(d.blocked_until)}`}>blocked</Pill>}
                          {d.hub && <Pill size="xs" tone="neutral">hub</Pill>}
                        </div>
                      )}
                    </td>
                    <td className="pr-4 py-3 hidden lg:table-cell min-w-0">
                      <span className="font-mono text-xs text-slate-400">{d.mac ?? '—'}</span>
                      <div className="text-xs text-slate-500 truncate max-w-[12rem]" title={d.vendor ?? undefined}>{d.vendor ?? 'vendor unknown'}</div>
                    </td>
                    <td className="pr-4 py-3"><GroupCell d={d} houseOn={!!data?.house_on} /></td>
                    <td className="pr-4 py-3 whitespace-nowrap text-xs text-slate-400" title={exact(d.last_seen)}>{ago(d.last_seen, now)}</td>
                    <td className="pr-4 py-3"><Activity d={d} max={max} /></td>
                    {/* the row menu shows on hover or focus where there is a pointer that hovers; always on a touch screen */}
                    <td className="pr-3 py-3 text-right [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 transition-opacity">
                      <RowMenu d={d} isAdmin={isAdmin} onOpen={() => setOpen(d.id)} onChange={change} onForget={forget} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* a phone: cards (the icon, the name, then address · vendor · last seen and the 24 hours); the card opens the drawer */}
          <ul className="md:hidden space-y-2">
            {rows.map((d) => {
              const title = rowTitle(d)
              const vendor = d.vendor && d.vendor !== 'Private address' && d.vendor !== title ? shortVendor(d.vendor) : null
              return (
                <li key={d.id} className="surface pl-3 pr-1.5 py-3 flex items-start gap-3 min-w-0">
                  <span className="pt-0.5"><IconPicker device={d} canEdit={isAdmin} onPick={(icon) => void change(d, { icon })} /></span>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setOpen(d.id)} aria-label={`${title}: details`} className={`block w-full min-w-0 text-left rounded ${FOCUS_RING}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`truncate text-sm font-medium ${d.nickname ? 'text-slate-200' : 'text-slate-400 italic'}`}>{title}</span>
                        {d.hub && <Pill size="xs" tone="neutral">hub</Pill>}
                        {d.static && <Pill size="xs" tone="info">static</Pill>}
                        {d.blocked && <Pill size="xs" tone="problem">blocked</Pill>}
                        {d.group_name && <Pill size="xs" tone="fleet" icon={<GroupMark color={d.group_color} icon={d.group_icon} size="xs" />}>{d.group_name}</Pill>}
                        {d.house_exempt && data?.house_on && <Pill size="xs" tone="neutral" title="Does not follow the house rules">no house</Pill>}
                        {d.own_rules && <Pill size="xs" tone="info" title="Has rules of its own">own rules</Pill>}
                      </span>
                      {/* address · vendor · last seen: a long vendor gives way, the address and the time stay whole */}
                      <span className="mt-0.5 flex min-w-0 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                        {d.ip && <span className="shrink-0">{d.ip}&nbsp;·&nbsp;</span>}
                        {vendor && <span className="truncate">{vendor}</span>}
                        <span className="shrink-0">{vendor ? '\u00a0·\u00a0' : ''}{ago(d.last_seen, now)}</span>
                      </span>
                      <span className="mt-2 block"><Activity d={d} max={max} /></span>
                    </button>
                    <HomeName d={d} />
                  </div>
                  <RowMenu d={d} isAdmin={isAdmin} onOpen={() => setOpen(d.id)} onChange={change} onForget={forget} now={now} />
                </li>
              )
            })}
          </ul>
        </>
      )}
      {current && <DeviceSheet device={current} isAdmin={isAdmin} now={now} kids={groups ?? null}
        onClose={() => setOpen(null)} onChange={change} onForget={forget} />}
    </div>
  )
}

/** "Samsung Electronics Co.,Ltd" as "Samsung" for the phone's one line (the drawer has the whole name) */
const shortVendor = (v: string) => v.replace(/[\s,]+(electronics|corporate|corporation|corp\.?|inc\.?|co\.?|ltd\.?|llc|gmbh|technologies|international|interactive|trading|broadband)\b.*$/i, '') || v

/** a row's name: the nickname, the name it gives itself, its vendor, else "Unnamed device" (its address is in the row already) */
function rowTitle(d: TechnitiumNetDevice): string {
  const n = deviceName(d)
  return n === d.ip || n === d.id ? 'Unnamed device' : n
}
/** the line under the name in the table: what the name does not say already (its own name, its vendor); a missing
 *  nickname shows by the italic name alone, never a line per row */
function subline(d: TechnitiumNetDevice): string {
  const title = rowTitle(d)
  const host = d.hostname?.replace(/\.(local|home|lan)\.?$/i, '')
  const vendor = d.vendor && d.vendor !== 'Private address' ? d.vendor : null
  const extra = host && host !== title ? host : vendor && vendor !== title ? vendor : ''
  return d.hub ? ['this server', extra].filter(Boolean).join(' · ') : extra
}

/** the name it answers to at home ("reach it as toms-tablet.home"), with a copy button */
function HomeName({ d }: { d: TechnitiumNetDevice }) {
  if (!d.home_name) return null
  return (
    <div className="flex items-center gap-1 min-w-0 text-xs">
      <span className="text-slate-500 shrink-0">reach it as</span>
      <span className="font-mono text-cyan-300 truncate" title={d.home_name}>{d.home_name}</span>
      <CopyButton text={d.home_name} label={`Copy ${d.home_name}`} />
    </div>
  )
}

/** the name a nickname gives (the server's rule: lower case, a dash for anything else, 63 at most) */
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '')

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

/** the nickname in the table, edited where it is (Enter or leaving the field saves, Escape cancels); the name opens the drawer. On a phone the drawer names it */
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
        {rowTitle(device)}
      </button>
      {canEdit && (
        <button type="button" onClick={() => { setV(device.nickname ?? ''); setEditing(true) }} className={`${BTN_ICON_SM} -my-1.5 ${TONE_GHOST} [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100`} aria-label={`Rename ${deviceName(device)}`} title="Rename">
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

/** the device's group (its colour and icon), and whether it follows the house or has rules of its own */
function GroupCell({ d, houseOn }: { d: TechnitiumNetDevice; houseOn: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {d.group_name ? <Pill tone="fleet" icon={<GroupMark color={d.group_color} icon={d.group_icon} size="xs" />}>{d.group_name}</Pill> : <span className="text-xs text-slate-600">{houseOn && !d.house_exempt ? 'the house' : '—'}</span>}
      {d.house_exempt && houseOn && <Pill size="xs" tone="neutral" title="Does not follow the house rules">no house</Pill>}
      {d.own_rules && <Pill size="xs" tone="info" title="Has rules of its own: its exceptions win">own rules</Pill>}
    </div>
  )
}

function RowMenu({ d, isAdmin, onOpen, onChange, onForget, now }: {
  d: TechnitiumNetDevice; isAdmin: boolean; now: number; onOpen: () => void
  onChange: (d: TechnitiumNetDevice, c: TechnitiumDeviceChange, ok?: string) => Promise<boolean>; onForget: (d: TechnitiumNetDevice) => void
}) {
  const name = deviceName(d)
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target><button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} aria-label={`Actions for ${name}`}><MoreHorizontal size={14} /></button></Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Pencil size={14} />} onClick={onOpen}>{isAdmin ? 'Edit' : 'Details'}</Menu.Item>
        {isAdmin && (d.static
          ? <Menu.Item leftSection={<PinOff size={14} />} onClick={() => void onChange(d, { static: false }, `${name}: its address is no longer reserved`)}>Unpin address</Menu.Item>
          : <Menu.Item leftSection={<Pin size={14} />} disabled={!d.mac || !d.ip} onClick={() => void onChange(d, { static: true }, `${name} keeps ${d.ip}`)}>Pin address</Menu.Item>)}
        {isAdmin && (d.house_exempt
          ? <Menu.Item leftSection={<House size={14} />} disabled={!d.ip} onClick={() => void onChange(d, { house_exempt: false }, `${name} follows the house rules`)}>Follow the house rules</Menu.Item>
          : <Menu.Item leftSection={<UserX size={14} />} disabled={!d.ip} onClick={() => void onChange(d, { house_exempt: true }, `${name} no longer follows the house rules`)}>Leave out of the house rules</Menu.Item>)}
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
function DeviceSheet({ device: d, isAdmin, now, kids, onClose, onChange, onForget }: {
  device: TechnitiumNetDevice; isAdmin: boolean; now: number; kids: TechnitiumGroups | null
  onClose: () => void; onChange: (d: TechnitiumNetDevice, c: TechnitiumDeviceChange, ok?: string) => Promise<boolean>; onForget: (d: TechnitiumNetDevice) => void
}) {
  const [nickname, setNickname] = useState(d.nickname ?? '')
  const [icon, setIcon] = useState<TechnitiumIcon | null>(d.icon_guessed ? null : d.icon)
  const [notes, setNotes] = useState(d.notes ?? '')
  const [groupId, setGroupId] = useState(d.group_id ?? '')
  const [stat, setStat] = useState(!!d.static)
  const [block, setBlock] = useState<number | null>(d.blocked ? d.blocked_until ?? null : null)
  const [answer, setAnswer] = useState(d.home_answer !== false)
  const [follows, setFollows] = useState(!d.house_exempt)
  const [allowed, setAllowed] = useState<string[]>(d.allowed ?? [])
  const [blockedNames, setBlockedNames] = useState<string[]>(d.blocked_names ?? [])
  const [own, setOwn] = useState<TechnitiumDeviceOverride>(d.override ?? { categories: [], youtube: null, window: null })
  const [busy, setBusy] = useState(false)
  const groups = kids?.groups ?? []
  const name = deviceName(d)
  const diff: TechnitiumDeviceChange = {}
  if (nickname.trim() !== (d.nickname ?? '')) diff.nickname = nickname.trim() || null
  if (icon && (icon !== d.icon || d.icon_guessed)) diff.icon = icon
  if (notes.trim() !== (d.notes ?? '')) diff.notes = notes.trim() || null
  if (groupId !== (d.group_id ?? '')) diff.group_id = groupId || null
  if (stat !== !!d.static) diff.static = stat
  if ((block ?? null) !== (d.blocked ? d.blocked_until ?? null : null)) diff.blocked_until = block
  if (answer !== (d.home_answer !== false)) diff.home_answer = answer
  if (follows === !!d.house_exempt) diff.house_exempt = !follows
  if (allowed.join() !== (d.allowed ?? []).join()) diff.allowed = allowed
  if (blockedNames.join() !== (d.blocked_names ?? []).join()) diff.blocked_names = blockedNames
  const ownEmpty = own.categories.length === 0 && !own.youtube && !own.window
  if (JSON.stringify(ownEmpty ? null : own) !== JSON.stringify(d.override ?? null)) diff.override = ownEmpty ? null : own
  // the zone of the house's names: the one its current name is in (home unless the scope says otherwise)
  const zone = d.home_name?.split('.').slice(1).join('.') || 'home'
  const asName = slug(nickname.trim()) ? `${slug(nickname.trim())}.${zone}` : ''
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
        <fieldset className="space-y-3">
          <legend className={`${SECTION_LABEL} mb-2`}>Its rules</legend>
          <ToggleRow label="Follows the house rules" checked={follows} disabled={!isAdmin || !d.ip} onChange={setFollows}
            help={follows ? 'The house rules apply to it (with its group’s, when it is in one).' : 'Left out of the house rules: for your own PC and phone. Its group’s rules still apply; Technitium’s own ad and threat lists too.'} />
          <div>
            <label htmlFor="td-group" className={LABEL}>In group</label>
            <select id="td-group" className={INPUT} value={groupId} disabled={!isAdmin || !d.ip} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">No group: {follows ? 'the house rules alone' : 'nothing of DCS’s'}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <p className={HINT}>A group follows the device when its address changes.</p>
          </div>
          {isAdmin && kids && <OwnRules d={d} kids={kids} allowed={allowed} setAllowed={setAllowed} blockedNames={blockedNames} setBlockedNames={setBlockedNames} own={own} setOwn={setOwn} />}
        </fieldset>
        <ToggleRow label={asName ? `Also answer ${asName}` : 'Also answer its nickname as a name'} checked={answer && !!asName} disabled={!isAdmin || !asName || !d.ip} onChange={setAnswer}
          help={asName ? `Devices at home reach it by this name (${d.ip ?? 'its address'}), on both resolvers.` : 'Give it a nickname first: Tom’s tablet answers tom-s-tablet.home.'} />
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
                          {e.blocked && <AllowForAnHour name={e.name} device={d} />}
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

/** a device's own rules: its exceptions (they win over the house and its group), its own blocked names, extra categories,
 *  a YouTube setting and one window of its own (a group of its own in Technitium) */
function OwnRules({ d, kids, allowed, setAllowed, blockedNames, setBlockedNames, own, setOwn }: {
  d: TechnitiumNetDevice; kids: TechnitiumGroups
  allowed: string[]; setAllowed: (v: string[]) => void; blockedNames: string[]; setBlockedNames: (v: string[]) => void
  own: TechnitiumDeviceOverride; setOwn: (o: TechnitiumDeviceOverride) => void
}) {
  const [open, setOpen] = useState(allowed.length + blockedNames.length > 0 || !!d.override)
  const setWindow = (p: Partial<TechnitiumWindow>) => own.window && setOwn({ ...own, window: { ...own.window, ...p } })
  if (!open) return <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setOpen(true)}><Plus size={14} /> Rules of its own</button>
  return (
    <div className="space-y-4 rounded-lg border border-white/5 p-3">
      <p className={TEXT_META}>On top of its group and the house. Its exceptions win over every block (a bedtime too); <em>Block this device</em> still wins over them.</p>
      <NameList id="td-allowed" label="Always allowed for it" hint="A site and its subdomains, for this device alone." names={allowed} onChange={setAllowed} />
      <NameList id="td-blocked" label="Also blocked for it" hint="A site and its subdomains, blocked all day for this device." names={blockedNames} onChange={setBlockedNames} />
      <div role="group" aria-label="Its own categories" className="space-y-2">
        <p className={LABEL}>Also blocked all day</p>
        <div className="flex flex-wrap gap-1.5">
          {kids.categories.map((c) => {
            const on = own.categories.includes(c.id)
            return <button key={c.id} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`}
              onClick={() => setOwn({ ...own, categories: on ? own.categories.filter((x) => x !== c.id) : [...own.categories, c.id] })}>{c.name}</button>
          })}
        </div>
      </div>
      <YoutubeChoice label="Its YouTube" none="As its group" value={own.youtube} onChange={(v) => setOwn({ ...own, youtube: (v === 'off' ? null : v) as TechnitiumDeviceOverride['youtube'] })} />
      <div className="space-y-2">
        <p className={LABEL}>A window of its own</p>
        {own.window
          ? <>
              <WindowEditor w={own.window} i={99} data={kids} onChange={setWindow} />
              <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setOwn({ ...own, window: null })}><Trash2 size={14} /> Remove its window</button>
            </>
          : <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setOwn({ ...own, window: { ...NEW_WINDOW, name: 'Its own' } })}><Plus size={14} /> Add a window</button>}
      </div>
    </div>
  )
}
