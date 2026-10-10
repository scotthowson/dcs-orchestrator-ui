// The Technitium page's Kids tab: the house's SafeSearch and YouTube switch, the groups as cards (devices, category
// lists, bedtime, "in bedtime now", a 30-minute pause), the add / edit sheet and the delete confirmation. A group's
// devices are picked from the device directory (their icon and nickname); an address typed by hand still works.

import { useMemo, useState } from 'react'
import { Users, Plus, Pencil, Trash2, Moon, MoonStar, Loader2, Search as SearchIcon, X, Youtube } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import Sheet from '../common/Sheet'
import Segmented from '../common/Segmented'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import SearchInput from '../common/SearchInput'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import { DeviceIcon, deviceName, useDeviceDirectory } from './deviceKit'
import {
  fetchTechnitiumGroups, saveTechnitiumGroup, deleteTechnitiumGroup, pauseTechnitiumBedtime, technitiumSafeSearch,
} from '../../api/endpoints'
import type { TechnitiumCategory, TechnitiumGroup, TechnitiumGroupInput, TechnitiumGroups, TechnitiumHouse, TechnitiumYoutube } from '../../../shared/types'
import { BTN_TOOLBAR_OK, BTN_CARD_QUIET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TEXT_META, SECTION_LABEL } from '../../lib/ui'
import { INPUT, LABEL, HINT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function daysLabel(days: number[]): string {
  const d = [...days].sort()
  if (d.length === 7) return 'every night'
  if (d.join() === '1,2,3,4,5') return 'school nights (Mon–Fri)'
  if (d.join() === '1,2,3,4,7') return 'school nights (Sun–Thu)'
  if (d.join() === '6,7') return 'weekends'
  return d.map((x) => DAYS[x - 1]).join(', ')
}
const until = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const NIGHTS: { label: string; days: number[] }[] = [
  { label: 'Every night', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'School nights (Sun–Thu)', days: [1, 2, 3, 4, 7] },
  { label: 'Fri & Sat', days: [5, 6] },
]
/** how long a bedtime lasts, "10 h" or "9 h 30" */
function length(from: string, to: string): string {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm }
  const d = (m(to) - m(from) + 1440) % 1440
  return d === 0 ? '—' : `${Math.floor(d / 60)} h${d % 60 ? ` ${String(d % 60).padStart(2, '0')}` : ''}`
}

export default function KidsTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumGroups, 30000, { key: 'technitium-groups' })
  const dir = useDeviceDirectory()
  const [editing, setEditing] = useState<TechnitiumGroup | 'new' | null>(null)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const after = async (msg: string, sync?: { ok: boolean; message: string } | null) => {
    addToast({ type: sync && !sync.ok ? 'warning' : 'success', message: sync && !sync.ok ? `${msg}; the secondary did not follow: ${sync.message}` : msg })
    await Promise.all([refresh(), onChanged()])
  }
  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try { await fn() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }
  const remove = (g: TechnitiumGroup) => act(g.id, async () => {
    if (!await confirm({ title: `Delete the group ${g.name}?`, message: `Its ${g.devices.length} device${g.devices.length === 1 ? '' : 's'} go back to the house's blocking alone: no category lists, no bedtime.`, confirmLabel: 'Delete group', danger: true })) return
    const r = await deleteTechnitiumGroup(g.id)
    await after(`${g.name} is deleted`, r.sync)
  })
  const pause = (g: TechnitiumGroup, minutes: number) => act(g.id, async () => {
    const r = await pauseTechnitiumBedtime(g.id, minutes)
    await after(minutes ? `${g.name}: bedtime paused until ${r.paused_until ? until(r.paused_until) : '—'}` : `${g.name}: bedtime is back`, r.sync)
  })

  if (loading && !data) return <Skeleton variant="cards" rows={2} />
  if (error && !data) return <ErrorState title="Could not read the groups" error={error} onRetry={() => void refresh()} />
  if (!data) return null
  return (
    <div className="space-y-4">
      <HouseSafeSearch data={data} isAdmin={isAdmin} onChanged={() => after('SafeSearch saved', null)} />
      <div className="flex items-center justify-between gap-3">
        <h2 className={SECTION_LABEL}>Groups</h2>
        {isAdmin && <button type="button" className={BTN_TOOLBAR_OK} onClick={() => setEditing('new')}><Plus size={14} /> Add group</button>}
      </div>
      {data.groups.length === 0 ? (
        <EmptyState compact icon={<Users size={28} />} title="No groups yet"
          hint="A group is a child, or all the boys: their tablets and consoles, the categories they cannot reach and a bedtime when nothing answers."
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_OK} onClick={() => setEditing('new')}><Plus size={14} /> Add group</button> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.groups.map((g) => (
            <Panel key={g.id} icon={Users} title={g.name}
              badge={g.in_bedtime ? <Pill tone="attention" icon={<Moon size={10} />}>In bedtime now</Pill> : g.bedtime_paused_until ? <Pill tone="info">Bedtime paused until {until(g.bedtime_paused_until)}</Pill> : undefined}
              actions={isAdmin ? <>
                <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST}`} onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`} title="Edit"><Pencil size={14} /></button>
                <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} onClick={() => void remove(g)} aria-label={`Delete ${g.name}`} title="Delete"><Trash2 size={14} /></button>
              </> : undefined}>
              <div className="space-y-3">
                <div>
                  <p className={SECTION_LABEL}>Devices</p>
                  {g.devices.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {g.devices.map((d) => {
                        const known = (d.id ? dir.byId.get(d.id) : undefined) ?? dir.byIp.get(d.ip)
                        const name = known?.nickname || d.label || (known ? deviceName(known) : d.ip)
                        return (
                          <li key={d.ip} className="text-sm text-slate-300 flex items-center gap-2 min-w-0">
                            <DeviceIcon icon={known?.icon ?? 'unknown'} guessed={!known || known.icon_guessed} size="sm" />
                            <span className="truncate">{name}</span>{name !== d.ip && <span className="font-mono text-xs text-slate-500 shrink-0">{d.ip}</span>}
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p className={TEXT_META}>None yet: the group does nothing until a device is in it.</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.lists.length ? g.lists.map((l) => <Pill key={l} tone="neutral">{data.categories.find((c) => c.id === l)?.name ?? l}</Pill>) : <span className={TEXT_META}>No category lists</span>}
                </div>
                <p className="text-sm text-slate-300 flex items-center gap-2">
                  <MoonStar size={14} className="text-slate-500 shrink-0" aria-hidden />
                  {g.bedtime.enabled ? <>Bedtime {g.bedtime.from}–{g.bedtime.to}, {daysLabel(g.bedtime.days)}</> : <span className="text-slate-500">No bedtime</span>}
                </p>
                {isAdmin && g.bedtime.enabled && (g.in_bedtime || g.bedtime_paused_until) && (
                  <button type="button" disabled={busy === g.id} className={BTN_CARD_QUIET} onClick={() => void pause(g, g.bedtime_paused_until ? 0 : 30)}>
                    {busy === g.id ? <Loader2 size={12} className="animate-spin" /> : <Moon size={12} />} {g.bedtime_paused_until ? 'End the pause' : 'Pause bedtime 30 min'}
                  </button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {editing && <GroupSheet group={editing === 'new' ? null : editing} categories={data.categories} house={data.house} directory={dir.data?.devices ?? []} taken={data.groups.filter((g) => editing === 'new' || g.id !== editing.id).flatMap((g) => g.devices.map((d) => d.ip))}
        onClose={() => setEditing(null)} onSaved={async (msg, sync) => { setEditing(null); await after(msg, sync) }} />}
    </div>
  )
}

// SafeSearch and YouTube are the whole house's: Technitium's Advanced Blocking cannot rewrite a name for one group
function HouseSafeSearch({ data, isAdmin, onChanged }: { data: TechnitiumGroups; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const save = async (house: { safe_search?: boolean; youtube?: TechnitiumYoutube }) => {
    setBusy(true)
    try { await technitiumSafeSearch(house); await onChanged() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Panel icon={SearchIcon} title="SafeSearch for the whole house" sub="Technitium cannot force SafeSearch for one group: it is on for every device, grown-ups included. For the kids alone, add “Search engines without SafeSearch” to their group.">
      <div className="space-y-4">
        <ToggleRow label="Force SafeSearch" help={`Google, Bing and DuckDuckGo answer with their safe results (${data.forced_names.safe_search.join(', ')}).`} checked={data.house.safe_search} disabled={!isAdmin || busy} onChange={(v) => void save({ safe_search: v })} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-200 flex items-center gap-2"><Youtube size={14} className="text-slate-500" aria-hidden /> YouTube restricted mode</p>
            <p className={TEXT_META}>Moderate hides most mature videos; strict hides more, and comments.</p>
          </div>
          <Segmented ariaLabel="YouTube restricted mode" value={data.house.youtube} onChange={(v) => isAdmin && !busy && void save({ youtube: v })}
            options={[{ value: 'off', label: 'Off', disabled: !isAdmin }, { value: 'moderate', label: 'Moderate', disabled: !isAdmin }, { value: 'strict', label: 'Strict', disabled: !isAdmin }]} />
        </div>
      </div>
    </Panel>
  )
}

function GroupSheet({ group, categories, house, directory, taken, onClose, onSaved }: {
  group: TechnitiumGroup | null
  categories: TechnitiumCategory[]
  house: TechnitiumHouse
  directory: import('../../../shared/types').TechnitiumNetDevice[]
  taken: string[]
  onClose: () => void
  onSaved: (msg: string, sync: { ok: boolean; message: string } | null) => Promise<void>
}) {
  const [g, setG] = useState<TechnitiumGroupInput>(() => group
    ? { id: group.id, name: group.name, devices: group.devices.map((d) => ({ ...d })), lists: [...group.lists], bedtime: { ...group.bedtime } }
    // a new group: the house's usual one (the boys: 21:00 to 07:00 every night)
    : { name: '', devices: [], lists: ['adult', 'gambling', 'proxy-vpn'], bedtime: { enabled: true, from: '21:00', to: '07:00', days: [1, 2, 3, 4, 5, 6, 7] } })
  const [ip, setIp] = useState('')
  const [label, setLabel] = useState('')
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const houseStrict = house.safe_search && house.youtube === 'strict'
  const [alsoHouse, setAlsoHouse] = useState(!group && !houseStrict)
  const set = (p: Partial<TechnitiumGroupInput>) => setG((x) => ({ ...x, ...p }))
  const ipOk = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]{2,39}(\/\d{1,3})?$/i.test(ip.trim())
  const addDevice = (d: { ip: string; label: string; mac?: string | null; id?: string | null }) => {
    if (g.devices.some((x) => x.ip === d.ip)) return
    set({ devices: [...g.devices, d] }); setIp(''); setLabel('')
  }
  // the directory's devices that can join: not in this group, not in another one; busiest first
  const pickable = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return directory.filter((d) => d.ip && !d.hub && !g.devices.some((x) => x.ip === d.ip) && !taken.includes(d.ip!)
      && (!needle || [d.nickname, d.hostname, d.ip, d.vendor].some((x) => x?.toLowerCase().includes(needle))))
  }, [directory, g.devices, taken, find])
  const dirOf = (ipAddr: string, id?: string | null) => directory.find((d) => (id && d.id === id) || d.ip === ipAddr)
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await saveTechnitiumGroup({ ...g, name: g.name.trim() })
      if (alsoHouse) await technitiumSafeSearch({ safe_search: true, youtube: 'strict' })
      await onSaved(`${r.group.name} is saved${alsoHouse ? '; SafeSearch and YouTube strict are on for the house' : ''}`, r.sync)
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={group ? `Edit ${group.name}` : 'Add a group'} subtitle="Devices, what they cannot reach, and their bedtime" icon={<Users size={16} />} wide onClose={onClose} keepOnBackdrop
      footer={<div className="flex gap-2">
        <button type="button" className={BTN_SHEET_QUIET} onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || !g.name.trim()} className={`${BTN_SHEET_PRIMARY} flex-1`} onClick={() => void save()}>{busy && <Loader2 size={16} className="animate-spin" />} Save</button>
      </div>}>
      <div className="space-y-5">
        <div>
          <label htmlFor="tg-name" className={LABEL}>Name</label>
          <input id="tg-name" className={INPUT} value={g.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Boys" />
        </div>

        <fieldset>
          <legend className={LABEL}>Devices</legend>
          {g.devices.length > 0 && (
            <ul className="mb-2 space-y-1">
              {g.devices.map((d, i) => (
                <li key={d.ip} className="flex items-center gap-2">
                  <DeviceIcon icon={dirOf(d.ip, d.id)?.icon ?? 'unknown'} guessed={!dirOf(d.ip, d.id) || dirOf(d.ip, d.id)!.icon_guessed} size="sm" />
                  <input aria-label={`Label of ${d.ip}`} className={`${INPUT} flex-1`} value={d.label} maxLength={40} placeholder="Tablet, Switch…"
                    onChange={(e) => set({ devices: g.devices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <span className="font-mono text-xs text-slate-400 w-32 truncate">{d.ip}</span>
                  <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${d.label || d.ip}`} onClick={() => set({ devices: g.devices.filter((_, j) => j !== i) })}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          {directory.length > 0 && (
            <div className="mb-3 space-y-2">
              <p className={HINT}>From the devices of the house:</p>
              {directory.length > 12 && <SearchInput size="sm" value={find} onChange={setFind} placeholder="Find a device" label="Find a device to add" />}
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                {pickable.slice(0, 40).map((d) => (
                  <button key={d.id} type="button" className={`${CHOICE_SM} ${CHOICE_OFF} !h-auto py-1`} aria-label={`Add ${deviceName(d)} (${d.ip})`}
                    onClick={() => addDevice({ ip: d.ip!, label: (d.nickname ?? deviceName(d)).slice(0, 40), mac: d.mac, id: d.id })}>
                    <DeviceIcon icon={d.icon} guessed={d.icon_guessed} size="sm" /> <span className="truncate max-w-[10rem]">{deviceName(d)}</span> <span className="font-mono text-slate-500">{d.ip}</span>
                  </button>
                ))}
                {pickable.length === 0 && <span className={TEXT_META}>{find ? 'No device matches.' : 'Every device is in a group already.'}</span>}
              </div>
            </div>
          )}
          <p className={HINT}>Or an address by hand (a device not seen yet, or a small network like 192.168.2.48/29):</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <input aria-label="Device address" className={`${INPUT} font-mono flex-1 min-w-[10rem]`} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.2.50" />
            <input aria-label="Device label" className={`${INPUT} flex-1 min-w-[8rem]`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
            <button type="button" className={BTN_CARD_QUIET} disabled={!ipOk || taken.includes(ip.trim())} onClick={() => addDevice({ ip: ip.trim(), label: label.trim() })}><Plus size={12} /> Add</button>
          </div>
          {taken.includes(ip.trim()) && <p className={`${HINT} text-rose-400`}>That device is in another group: a device is in one group at a time.</p>}
          <p className={HINT}>A device picked from the list stays in the group when its address changes; pin its address (Devices tab) to keep the logs tidy.</p>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={LABEL}>Blocked for this group</legend>
          {categories.map((c) => (
            <ToggleRow key={c.id} label={c.name} checked={g.lists.includes(c.id)} onChange={(v) => set({ lists: v ? [...g.lists, c.id] : g.lists.filter((x) => x !== c.id) })} />
          ))}
          <p className={HINT}>Hagezi's lists, on top of what the whole house blocks. There is no dating list to offer.</p>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={LABEL}>Bedtime</legend>
          <ToggleRow label="Bedtime" help="Every name stops answering for these devices (this server's own sites still work)." checked={g.bedtime.enabled} onChange={(v) => set({ bedtime: { ...g.bedtime, enabled: v } })} />
          {g.bedtime.enabled && (
            <>
              <p className="text-sm text-slate-200 flex items-center gap-2" aria-live="polite">
                <MoonStar size={14} className="text-slate-500 shrink-0" aria-hidden />
                {g.bedtime.from} → {g.bedtime.to}, {g.bedtime.days.length ? daysLabel(g.bedtime.days) : 'no night picked'} <span className="text-slate-500">· {length(g.bedtime.from, g.bedtime.to)}</span>
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div><label htmlFor="tg-from" className={LABEL}>From</label><input id="tg-from" type="time" className={INPUT} value={g.bedtime.from} onChange={(e) => set({ bedtime: { ...g.bedtime, from: e.target.value } })} /></div>
                <div><label htmlFor="tg-to" className={LABEL}>Until</label><input id="tg-to" type="time" className={INPUT} value={g.bedtime.to} onChange={(e) => set({ bedtime: { ...g.bedtime, to: e.target.value } })} /></div>
              </div>
              <div role="group" aria-label="Quick nights" className="flex flex-wrap gap-1.5">
                {NIGHTS.map((n) => {
                  const on = [...g.bedtime.days].sort().join() === [...n.days].sort().join()
                  return <button key={n.label} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`} onClick={() => set({ bedtime: { ...g.bedtime, days: n.days } })}>{n.label}</button>
                })}
              </div>
              <div role="group" aria-label="Nights" className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const on = g.bedtime.days.includes(i + 1)
                  return <button key={d} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`}
                    onClick={() => set({ bedtime: { ...g.bedtime, days: on ? g.bedtime.days.filter((x) => x !== i + 1) : [...g.bedtime.days, i + 1] } })}>{d}</button>
                })}
              </div>
              <p className={HINT}>The night it starts: a bedtime from 20:30 to 07:00 on Sunday ends on Monday morning. In the server's time.</p>
            </>
          )}
        </fieldset>
        {!group && !houseStrict && (
          <ToggleRow label="Also for the whole house: SafeSearch on, YouTube strict" help="Technitium cannot do these per group: they apply to every device, grown-ups included." checked={alsoHouse} onChange={setAlsoHouse} />
        )}
        {err && <Notice tone="problem" role="alert">{err}</Notice>}
      </div>
    </Sheet>
  )
}
