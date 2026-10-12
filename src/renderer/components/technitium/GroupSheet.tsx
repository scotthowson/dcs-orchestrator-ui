// The kids' group editor (the Kids tab): one sheet in sections: devices, colour and icon, SafeSearch and YouTube, categories,
// time windows (from/to/days or a week grid painted with the mouse or a finger; a YouTube of their own), allow-list mode and
// its sites, exceptions. A group's devices are picked from the device directory (their icon and nickname); an address
// typed by hand still works. The same sheet edits the house's rules (house: no name, devices, colour or allow-list mode).
// WindowEditor and NameList also serve the device drawer (a device's own window and lists).

import { useMemo, useRef, useState } from 'react'
import { Users, Plus, X, Loader2, Clock, Trash2, ChevronDown, ChevronUp, House, Grid3x3, Eraser } from 'lucide-react'
import Sheet from '../common/Sheet'
import Segmented from '../common/Segmented'
import Notice from '../common/Notice'
import { Toggle, ToggleRow } from '../common/Toggle'
import SearchInput from '../common/SearchInput'
import { apiErrorMessage } from '../../api/errors'
import { saveTechnitiumGroup, saveTechnitiumHouse } from '../../api/endpoints'
import { DeviceIcon, GroupMark, TAP, deviceName } from './deviceKit'
import {
  DAYS, GROUP_COLORS, GROUP_ICONS, GROUP_SWATCH, NEW_WINDOW, YOUTUBE_CEILING, YOUTUBE_HELP, YOUTUBE_LABEL, YOUTUBE_MODES, emptyGrid, gridFrom,
  windowEffect, windowLength, windowWhen,
} from './kidsKit'
import type { TechnitiumGroup, TechnitiumGroupIcon, TechnitiumGroupInput, TechnitiumGroups, TechnitiumNetDevice, TechnitiumWindow, TechnitiumYoutube } from '../../../shared/types'
import { BTN_CARD_QUIET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TEXT_META, FOCUS_RING } from '../../lib/ui'
import { INPUT, LABEL, HINT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'

// min-w-0: a fieldset is as wide as its widest content by default (the week grid would push the sheet sideways on a phone)
const SECTION = 'min-w-0 space-y-3 border-t border-white/5 pt-5'
const DOMAIN = /^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** a window as the editor keeps it (what GET adds about now left out) */
const editable = ({ active: _a, paused_until: _p, forced_until: _f, ...w }: TechnitiumWindow): TechnitiumWindow => ({ ...w })

export default function GroupSheet({ group, house = false, data, directory, taken, onClose, onSaved }: {
  group: TechnitiumGroup | null
  /** edit the house's rules instead of a group */
  house?: boolean
  data: TechnitiumGroups
  directory: TechnitiumNetDevice[]
  taken: string[]
  onClose: () => void
  onSaved: (msg: string, sync: { ok: boolean; message: string } | null) => Promise<void>
}) {
  const [g, setG] = useState<TechnitiumGroupInput>(() => house
    ? {
        name: 'House', devices: [], mode: 'filter', categories: [...(data.house.categories ?? [])], safe_search: data.house.safe_search, youtube: data.house.youtube,
        allowed: [...(data.house.allowed ?? [])], blocked: [...(data.house.blocked ?? [])], sites: [], windows: (data.house.windows ?? []).map(editable),
      }
    : group
    ? {
        id: group.id, name: group.name, devices: group.devices.map((d) => ({ ...d })), mode: group.mode, categories: [...group.categories],
        safe_search: group.safe_search, youtube: group.youtube, allowed: [...group.allowed], blocked: [...group.blocked], sites: [...group.sites],
        windows: group.windows.map(editable), color: group.color ?? null, icon: group.icon ?? null,
      }
    // a new group: what the house's boys have (SafeSearch, YouTube strict, adult, gambling and the ways around, bedtime 21:00–07:00)
    : { name: '', devices: [], mode: 'filter', categories: ['adult', 'gambling', 'proxy-vpn'], safe_search: true, youtube: 'strict', allowed: [], blocked: [], sites: [], windows: [{ ...NEW_WINDOW }], color: 'blue', icon: 'child' })
  const [ip, setIp] = useState('')
  const [label, setLabel] = useState('')
  const [find, setFind] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<TechnitiumGroupInput>) => setG((x) => ({ ...x, ...p }))
  const setWindow = (i: number, p: Partial<TechnitiumWindow>) => set({ windows: g.windows.map((w, j) => (j === i ? { ...w, ...p } : w)) })
  const ipOk = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]{2,39}(\/\d{1,3})?$/i.test(ip.trim())
  const addDevice = (d: { ip: string; label: string; mac?: string | null; id?: string | null }) => {
    if (g.devices.some((x) => x.ip === d.ip)) return
    set({ devices: [...g.devices, d] }); setIp(''); setLabel('')
  }
  // the directory's devices that can join: not in this group, not in another one
  const pickable = useMemo(() => {
    const needle = find.trim().toLowerCase()
    return directory.filter((d) => d.ip && !d.hub && !g.devices.some((x) => x.ip === d.ip) && !taken.includes(d.ip!)
      && (!needle || [d.nickname, d.hostname, d.ip, d.vendor].some((x) => x?.toLowerCase().includes(needle))))
  }, [directory, g.devices, taken, find])
  const dirOf = (ipAddr: string, id?: string | null) => directory.find((d) => (id && d.id === id) || d.ip === ipAddr)
  const toggleIn = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id))
  const allowlist = g.mode === 'allowlist'
  const preset = data.allowlist_presets[0]

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      if (house) {
        const r = await saveTechnitiumHouse({ safe_search: g.safe_search, youtube: g.youtube, categories: g.categories, windows: g.windows, allowed: g.allowed, blocked: g.blocked })
        await onSaved('The house rules are saved', r.sync)
      } else {
        const r = await saveTechnitiumGroup({ ...g, name: g.name.trim() })
        await onSaved(`${r.group.name} is saved`, r.sync)
      }
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={house ? 'The house rules' : group ? `Edit ${group.name}` : 'Add a group'}
      subtitle={house ? 'For every device that follows the house; a kids group adds its own' : 'Its devices, what they reach, and when'}
      icon={house ? <House size={16} /> : <Users size={16} />} wide onClose={onClose} keepOnBackdrop
      footer={<div className="flex gap-2">
        <button type="button" className={BTN_SHEET_QUIET} onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || !g.name.trim()} className={`${BTN_SHEET_PRIMARY} flex-1`} onClick={() => void save()}>{busy && <Loader2 size={16} className="animate-spin" />} Save</button>
      </div>}>
      <div className="space-y-5">
        {house ? (
          <Notice tone="info">Every device that is in no kids group gets these rules, and so does every kids group, on top of its own (a group can only add). A device whose <em>Follows the house rules</em> switch is off (the Devices tab) is left out: your own PC and phone, say. Technitium&apos;s own ad and threat lists stay for every device.</Notice>
        ) : <>
        <div>
          <label htmlFor="tg-name" className={LABEL}>Name</label>
          <input id="tg-name" className={INPUT} value={g.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Boys" />
        </div>
        <ColourIcon value={g} onChange={set} />
        </>}

        {!house && <fieldset className={SECTION}>
          <legend className={LABEL}>Devices</legend>
          {g.devices.length > 0 && (
            <ul className="space-y-1">
              {g.devices.map((d, i) => (
                <li key={d.ip} className="flex items-center gap-3">
                  <DeviceIcon icon={dirOf(d.ip, d.id)?.icon ?? 'unknown'} guessed={!dirOf(d.ip, d.id) || dirOf(d.ip, d.id)!.icon_guessed} size="sm" />
                  <input aria-label={`Label of ${d.ip}`} className={`${INPUT} flex-1 min-w-0`} value={d.label} maxLength={40} placeholder="Tablet, Switch…"
                    onChange={(e) => set({ devices: g.devices.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <span className="font-mono text-xs text-slate-400 w-32 max-sm:w-24 truncate">{d.ip}</span>
                  <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${d.label || d.ip}`} onClick={() => set({ devices: g.devices.filter((_, j) => j !== i) })}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          {directory.length > 0 && (
            <div className="space-y-2">
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
          <div className="flex flex-wrap gap-2">
            <input aria-label="Device address" className={`${INPUT} font-mono flex-1 min-w-[10rem]`} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.2.50" />
            <input aria-label="Device label" className={`${INPUT} flex-1 min-w-[8rem]`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
            <button type="button" className={BTN_CARD_QUIET} disabled={!ipOk || taken.includes(ip.trim())} onClick={() => addDevice({ ip: ip.trim(), label: label.trim() })}><Plus size={12} /> Add</button>
          </div>
          {taken.includes(ip.trim()) && <p className={`${HINT} text-rose-400`}>That device is in another group: a device is in one group at a time.</p>}
          <p className={HINT}>Keep consoles in a group of their own without the games block: an Xbox or a PlayStation needs its makers' services.</p>
        </fieldset>}

        <fieldset className={SECTION}>
          <legend className={LABEL}>SafeSearch and YouTube</legend>
          <ToggleRow label="SafeSearch" help={`Google, Bing and DuckDuckGo answer with their safe results, for ${house ? 'every device that follows the house' : "this group's devices only"} (${data.forced_names.safe_search.join(', ')}).`}
            checked={g.safe_search} onChange={(v) => set({ safe_search: v })} />
          <YoutubeChoice value={g.youtube} onChange={(v) => set({ youtube: v ?? "off" })} label="YouTube" />
        </fieldset>

        {!house && <fieldset className={SECTION}>
          <legend className={LABEL}>Allow-list mode</legend>
          <ToggleRow label="Allow-list mode" help="For the youngest: every name is blocked but the sites below, what the tablet needs to work, and the exceptions."
            checked={allowlist} onChange={(v) => set({ mode: v ? 'allowlist' : 'filter', sites: v && g.sites.length === 0 && preset ? [...preset.sites] : g.sites })} />
          {allowlist && (
            <div className="space-y-3 pl-1">
              {preset && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={TEXT_META}>{preset.name}: {preset.description}</p>
                  <button type="button" className={BTN_CARD_QUIET} onClick={() => set({ sites: [...preset.sites] })}>Use {preset.name}</button>
                </div>
              )}
              {data.allowlist_sites.map((s) => (
                <ToggleRow key={s.id} label={s.name} help={`${s.description} (${s.domains.join(', ')})`} checked={g.sites.includes(s.id)} onChange={(v) => set({ sites: toggleIn(g.sites, s.id, v) })} />
              ))}
              <details className="text-sm">
                <summary className={`${HINT} cursor-pointer`}>Always allowed: what the tablet needs ({data.essentials.domains.length} names)</summary>
                <p className={`${TEXT_META} mt-1`}>{data.essentials.description}: {data.essentials.domains.join(', ')}.</p>
              </details>
            </div>
          )}
        </fieldset>}

        {!allowlist && <fieldset className={SECTION}>
          <legend className={LABEL}>Blocked all day</legend>
          {data.categories.map((c) => (
            <ToggleRow key={c.id} label={c.name} help={c.description} checked={g.categories.includes(c.id)}
              onChange={(v) => set({ categories: toggleIn(g.categories, c.id, v) })} />
          ))}
          <p className={HINT}>{house ? 'For every device that follows the house, kids groups included.' : 'On top of what the house rules block.'} Hagezi&apos;s and The Block List Project&apos;s lists, and the services&apos; own names where there is no good list.</p>
        </fieldset>}

        <fieldset className={SECTION}>
          <legend className={LABEL}>Time windows</legend>
          {g.windows.length === 0 && <p className={TEXT_META}>No window: the group's blocks hold all day, every day.</p>}
          <ul className="space-y-2">
            {g.windows.map((w, i) => (
              <li key={w.id ?? `new-${i}`} className="rounded-lg border border-white/5 p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <Toggle checked={w.enabled} onChange={(v) => setWindow(i, { enabled: v })} label={`${w.name || 'Window'} on`} />
                  <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                    <span className={`block text-sm truncate ${w.enabled ? 'text-slate-200' : 'text-slate-500'}`}>{w.grid ? <Grid3x3 size={12} className="inline mr-1.5 -mt-0.5" aria-hidden /> : <Clock size={12} className="inline mr-1.5 -mt-0.5" aria-hidden />}{w.name || 'Window'}: {windowWhen(w)}</span>
                    <span className={`${TEXT_META} block truncate`}>Blocks {windowEffect(w, data.categories)}{w.enabled ? '' : ' · off'}</span>
                  </button>
                  <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} aria-label={`${open === i ? 'Close' : 'Edit'} ${w.name || 'the window'}`} onClick={() => setOpen(open === i ? null : i)}>{open === i ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                  <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${w.name || 'the window'}`} onClick={() => { set({ windows: g.windows.filter((_, j) => j !== i) }); setOpen(null) }}><Trash2 size={14} /></button>
                </div>
                {open === i && <WindowEditor w={w} i={i} data={data} onChange={(p) => setWindow(i, p)} />}
              </li>
            ))}
          </ul>
          <div role="group" aria-label="Add a window" className="flex flex-wrap gap-1.5">
            <button type="button" className={BTN_CARD_QUIET} disabled={g.windows.length >= 12} onClick={() => { set({ windows: [...g.windows, { ...NEW_WINDOW, name: g.windows.length ? 'Window' : 'Bedtime' }] }); setOpen(g.windows.length) }}><Plus size={12} /> Add a window</button>
            {data.window_presets.map((p) => (
              <button key={p.id} type="button" className={BTN_CARD_QUIET} disabled={g.windows.length >= 12} title="Added off: switch it on when it suits"
                onClick={() => set({ windows: [...g.windows, { name: p.name, enabled: p.enabled, from: p.from, to: p.to, days: [...p.days], scope: p.scope, categories: [...p.categories] }] })}>
                <Plus size={12} /> {p.title}
              </button>
            ))}
          </div>
          <p className={HINT}>A window from 20:30 to 07:00 runs into the next morning; a week grid holds any shape (school nights, weekend mornings). Every name blocked is bedtime&apos;s rule: this server&apos;s own sites still answer. In the server&apos;s time.</p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className={LABEL}>Exceptions</legend>
          <NameList id="tg-allowed" label="Always allowed" hint={house ? 'A site and its subdomains, over the house blocks (a kids group that blocks it still does).' : 'A site and its subdomains, over every block of the group (not over a window that blocks everything, nor over a house block).'} names={g.allowed} onChange={(v) => set({ allowed: v })} />
          <NameList id="tg-blocked" label="Also blocked" hint={house ? 'A site and its subdomains, blocked all day for every device that follows the house.' : 'A site and its subdomains, blocked all day for this group.'} names={g.blocked} onChange={(v) => set({ blocked: v })} />
        </fieldset>
        {err && <Notice tone="problem" role="alert">{err}</Notice>}
      </div>
    </Sheet>
  )
}

/** YouTube's five settings as choices, what the chosen one does, and what DNS cannot do */
export function YoutubeChoice({ value, onChange, label, none }: { value: TechnitiumYoutube | null; onChange: (v: TechnitiumYoutube | null) => void; label: string; none?: string }) {
  const modes: (TechnitiumYoutube | null)[] = none ? [null, ...YOUTUBE_MODES.filter((m) => m !== 'off')] : YOUTUBE_MODES
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-200">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {modes.map((m) => {
          const on = value === m
          return <button key={m ?? 'none'} type="button" role="radio" aria-checked={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`} onClick={() => onChange(m)}>{m ? YOUTUBE_LABEL[m] : none}</button>
        })}
      </div>
      <p className={TEXT_META}>{value ? YOUTUBE_HELP[value] : 'As the group has it.'} {YOUTUBE_CEILING}</p>
    </div>
  )
}

/** a group's colour and icon */
function ColourIcon({ value, onChange }: { value: TechnitiumGroupInput; onChange: (p: Partial<TechnitiumGroupInput>) => void }) {
  return (
    <div className="space-y-2">
      <p className={LABEL}>Colour and icon <span className="ml-1 align-middle"><GroupMark color={value.color} icon={value.icon} /></span></p>
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
        {GROUP_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value.color === c} aria-label={c} title={c} onClick={() => onChange({ color: c })}
            className={`h-8 w-8 rounded-full inline-flex items-center justify-center border ${TAP} ${value.color === c ? 'border-white/60' : 'border-transparent'}`}>
            <span className={`h-5 w-5 rounded-full ${GROUP_SWATCH[c]}`} />
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
        {(Object.keys(GROUP_ICONS) as TechnitiumGroupIcon[]).map((k) => {
          const { icon: I, label } = GROUP_ICONS[k]
          const on = value.icon === k
          return <button key={k} type="button" role="radio" aria-checked={on} aria-label={label} title={label} onClick={() => onChange({ icon: k })}
            className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF} !px-2`}><I size={14} /></button>
        })}
      </div>
    </div>
  )
}

export function WindowEditor({ w, i, data, onChange }: { w: TechnitiumWindow; i: number; data: TechnitiumGroups; onChange: (p: Partial<TechnitiumWindow>) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[8rem]"><label htmlFor={`tw-name-${i}`} className={LABEL}>Name</label><input id={`tw-name-${i}`} className={INPUT} value={w.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} /></div>
        <Segmented<'times' | 'grid'> ariaLabel="When the window runs" value={w.grid ? 'grid' : 'times'} onChange={(v) => onChange({ grid: v === 'grid' ? gridFrom(w) : null })}
          options={[{ value: 'times', label: 'From–until' }, { value: 'grid', label: 'Week grid' }]} />
      </div>
      {w.grid ? <WeekGrid grid={w.grid} onChange={(grid) => onChange({ grid })} /> : <>
        <div className="flex flex-wrap items-end gap-3">
          <div><label htmlFor={`tw-from-${i}`} className={LABEL}>From</label><input id={`tw-from-${i}`} type="time" className={INPUT} value={w.from} onChange={(e) => onChange({ from: e.target.value })} /></div>
          <div><label htmlFor={`tw-to-${i}`} className={LABEL}>Until</label><input id={`tw-to-${i}`} type="time" className={INPUT} value={w.to} onChange={(e) => onChange({ to: e.target.value })} /></div>
          <span className={`${TEXT_META} pb-2.5`}>{windowLength(w.from, w.to)}</span>
        </div>
        <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
          {DAYS.map((d, k) => {
            const on = w.days.includes(k + 1)
            return <button key={d} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`}
              onClick={() => onChange({ days: on ? w.days.filter((x) => x !== k + 1) : [...w.days, k + 1] })}>{d}</button>
          })}
        </div>
      </>}
      <Segmented<'all' | 'categories'> ariaLabel="What the window blocks" value={w.scope} onChange={(v) => onChange({ scope: v })}
        options={[{ value: 'all', label: 'Every name' }, { value: 'categories', label: 'Some categories' }]} />
      {w.scope === 'categories' && <>
        <div role="group" aria-label="Categories the window blocks" className="flex flex-wrap gap-1.5">
          {data.categories.map((c) => {
            const on = w.categories.includes(c.id)
            return <button key={c.id} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`}
              onClick={() => onChange({ categories: on ? w.categories.filter((x) => x !== c.id) : [...w.categories, c.id] })}>{c.name}</button>
          })}
        </div>
        <YoutubeChoice label="YouTube while it is in force" none="As the group" value={w.youtube ?? null} onChange={(v) => onChange({ youtube: (v === 'off' ? null : v) as TechnitiumWindow['youtube'] })} />
      </>}
    </div>
  )
}

/** the week grid: 7 days × 24 hours, painted by dragging (mouse, pen or finger: the first cell decides on or off), the arrow keys
 *  and Space for the keyboard */
export function WeekGrid({ grid, onChange }: { grid: boolean[][]; onChange: (g: boolean[][]) => void }) {
  const paint = useRef<boolean | null>(null)
  const [focus, setFocus] = useState<[number, number]>([0, 0])
  const set = (d: number, h: number, v: boolean) => { if (grid[d][h] !== v) onChange(grid.map((row, i) => (i === d ? row.map((x, j) => (j === h ? v : x)) : row))) }
  const cellAt = (x: number, y: number): [number, number] | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const d = el?.dataset.d, h = el?.dataset.h
    return d != null && h != null ? [Number(d), Number(h)] : null
  }
  const hours = grid.flat().filter(Boolean).length
  return (
    <div className="space-y-2">
      <div role="grid" aria-label="Week grid: the hours the window is in force" className="select-none touch-none overflow-x-auto"
        onPointerMove={(e) => { if (paint.current === null) return; const c = cellAt(e.clientX, e.clientY); if (c) set(c[0], c[1], paint.current) }}
        onPointerUp={() => { paint.current = null }} onPointerCancel={() => { paint.current = null }} onPointerLeave={() => { paint.current = null }}>
        <div role="row" className="flex items-end gap-px pl-9" aria-hidden>
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="flex-1 min-w-[10px] text-center text-[9px] text-slate-500 tabular-nums">{h % 3 === 0 ? h : ''}</span>)}
        </div>
        {grid.map((row, d) => (
          <div key={d} role="row" className="flex items-center gap-px mt-px">
            <span role="rowheader" className="w-9 shrink-0 text-[11px] text-slate-400">{DAYS[d]}</span>
            {row.map((on, h) => {
              const here = focus[0] === d && focus[1] === h
              return (
                <button key={h} type="button" role="gridcell" aria-selected={on} aria-label={`${DAYS[d]} ${String(h).padStart(2, '0')}:00`} tabIndex={here ? 0 : -1}
                  data-d={d} data-h={h}
                  className={`flex-1 min-w-[10px] h-6 rounded-[3px] ${FOCUS_RING} ${on ? 'bg-emerald-500/70' : 'bg-white/[0.06] hover:bg-white/10'}`}
                  onPointerDown={(e) => { e.preventDefault(); paint.current = !on; setFocus([d, h]); set(d, h, !on) }}
                  onKeyDown={(e) => {
                    const mv: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
                    if (mv[e.key]) {
                      e.preventDefault()
                      const n: [number, number] = [(d + mv[e.key][0] + 7) % 7, (h + mv[e.key][1] + 24) % 24]
                      setFocus(n)
                      ;(e.currentTarget.closest('[role=grid]')?.querySelector(`[data-d="${n[0]}"][data-h="${n[1]}"]`) as HTMLElement | null)?.focus()
                    } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(d, h, !on) }
                  }} />
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={TEXT_META}>{hours} h a week. Drag to paint (the first hour decides on or off); arrows and Space with the keyboard.</span>
        <button type="button" className={BTN_CARD_QUIET} onClick={() => onChange(emptyGrid())}><Eraser size={12} /> Clear</button>
      </div>
    </div>
  )
}

export function NameList({ id, label, hint, names, onChange }: { id: string; label: string; hint: string; names: string[]; onChange: (v: string[]) => void }) {
  const [v, setV] = useState('')
  const name = v.trim().toLowerCase().replace(/\.$/, '')
  const ok = DOMAIN.test(name) && !names.includes(name)
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="flex gap-2">
        <input id={id} className={`${INPUT} font-mono flex-1 min-w-0`} value={v} onChange={(e) => setV(e.target.value)} placeholder="example.com"
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) { e.preventDefault(); onChange([...names, name]); setV('') } }} />
        <button type="button" className={BTN_CARD_QUIET} disabled={!ok} onClick={() => { onChange([...names, name]); setV('') }}><Plus size={12} /> Add</button>
      </div>
      <p className={HINT}>{hint}</p>
      {names.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={label}>
          {names.map((n) => (
            <li key={n} className={`${CHOICE_SM} ${CHOICE_OFF} gap-1 font-mono`}>{n}
              <button type="button" className={`${TAP} text-slate-500 hover:text-rose-400`} aria-label={`Remove ${n}`} onClick={() => onChange(names.filter((x) => x !== n))}><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
