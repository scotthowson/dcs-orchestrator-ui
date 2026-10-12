// The kids' group editor (the Kids tab): one sheet in sections: devices, SafeSearch and YouTube, categories, time windows,
// allow-list mode and its sites, exceptions. A group's devices are picked from the device directory (their icon and
// nickname); an address typed by hand still works.

import { useMemo, useState } from 'react'
import { Users, Plus, X, Loader2, Clock, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import Sheet from '../common/Sheet'
import Segmented from '../common/Segmented'
import Notice from '../common/Notice'
import { Toggle, ToggleRow } from '../common/Toggle'
import SearchInput from '../common/SearchInput'
import { apiErrorMessage } from '../../api/errors'
import { saveTechnitiumGroup } from '../../api/endpoints'
import { DeviceIcon, TAP, deviceName } from './deviceKit'
import { DAYS, NEW_WINDOW, daysLabel, windowBlocks, windowLength } from './kidsKit'
import type { TechnitiumGroup, TechnitiumGroupInput, TechnitiumGroups, TechnitiumNetDevice, TechnitiumWindow, TechnitiumYoutube } from '../../../shared/types'
import { BTN_CARD_QUIET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TEXT_META } from '../../lib/ui'
import { INPUT, LABEL, HINT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'

const SECTION = 'space-y-3 border-t border-white/5 pt-5'
const DOMAIN = /^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export default function GroupSheet({ group, data, directory, taken, onClose, onSaved }: {
  group: TechnitiumGroup | null
  data: TechnitiumGroups
  directory: TechnitiumNetDevice[]
  taken: string[]
  onClose: () => void
  onSaved: (msg: string, sync: { ok: boolean; message: string } | null) => Promise<void>
}) {
  const [g, setG] = useState<TechnitiumGroupInput>(() => group
    ? {
        id: group.id, name: group.name, devices: group.devices.map((d) => ({ ...d })), mode: group.mode, categories: [...group.categories],
        safe_search: group.safe_search, youtube: group.youtube, allowed: [...group.allowed], blocked: [...group.blocked], sites: [...group.sites],
        windows: group.windows.map(({ active: _a, paused_until: _p, ...w }) => ({ ...w })),
      }
    // a new group: what the house's boys have (SafeSearch, YouTube strict, adult, gambling and the ways around, bedtime 21:00–07:00)
    : { name: '', devices: [], mode: 'filter', categories: ['adult', 'gambling', 'proxy-vpn'], safe_search: true, youtube: 'strict', allowed: [], blocked: [], sites: [], windows: [{ ...NEW_WINDOW }] })
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
      const r = await saveTechnitiumGroup({ ...g, name: g.name.trim() })
      await onSaved(`${r.group.name} is saved`, r.sync)
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={group ? `Edit ${group.name}` : 'Add a group'} subtitle="Its devices, what they reach, and when" icon={<Users size={16} />} wide onClose={onClose} keepOnBackdrop
      footer={<div className="flex gap-2">
        <button type="button" className={BTN_SHEET_QUIET} onClick={onClose}>Cancel</button>
        <button type="button" disabled={busy || !g.name.trim()} className={`${BTN_SHEET_PRIMARY} flex-1`} onClick={() => void save()}>{busy && <Loader2 size={16} className="animate-spin" />} Save</button>
      </div>}>
      <div className="space-y-5">
        <div>
          <label htmlFor="tg-name" className={LABEL}>Name</label>
          <input id="tg-name" className={INPUT} value={g.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Boys" />
        </div>

        <fieldset className={SECTION}>
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
        </fieldset>

        <fieldset className={SECTION}>
          <legend className={LABEL}>SafeSearch and YouTube</legend>
          <ToggleRow label="SafeSearch" help={`Google, Bing and DuckDuckGo answer with their safe results, for this group's devices only (${data.forced_names.safe_search.join(', ')}).`}
            checked={g.safe_search} onChange={(v) => set({ safe_search: v })} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-200">YouTube restricted mode</p>
              <p className={TEXT_META}>Moderate hides most mature videos; strict hides more, and the comments.</p>
            </div>
            <Segmented<TechnitiumYoutube> ariaLabel="YouTube restricted mode" value={g.youtube} onChange={(v) => set({ youtube: v })}
              options={[{ value: 'off', label: 'Off' }, { value: 'moderate', label: 'Moderate' }, { value: 'strict', label: 'Strict' }]} />
          </div>
        </fieldset>

        <fieldset className={SECTION}>
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
        </fieldset>

        {!allowlist && <fieldset className={SECTION}>
          <legend className={LABEL}>Blocked all day</legend>
          {data.categories.map((c) => (
            <ToggleRow key={c.id} label={c.name} help={c.description} checked={g.categories.includes(c.id)}
              onChange={(v) => set({ categories: toggleIn(g.categories, c.id, v) })} />
          ))}
          <p className={HINT}>On top of what the whole house blocks. Hagezi's and The Block List Project's lists, and the services' own names where there is no good list.</p>
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
                    <span className={`block text-sm truncate ${w.enabled ? 'text-slate-200' : 'text-slate-500'}`}><Clock size={12} className="inline mr-1.5 -mt-0.5" aria-hidden />{w.name || 'Window'}: {w.from}–{w.to}, {w.days.length ? daysLabel(w.days) : 'no day picked'}</span>
                    <span className={`${TEXT_META} block truncate`}>Blocks {windowBlocks(w, data.categories)}{w.enabled ? '' : ' · off'}</span>
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
          <p className={HINT}>A window from 20:30 to 07:00 runs into the next morning. Every name blocked is bedtime's rule: this server's own sites still answer. In the server's time.</p>
        </fieldset>

        <fieldset className={SECTION}>
          <legend className={LABEL}>Exceptions</legend>
          <NameList id="tg-allowed" label="Always allowed" hint="A site and its subdomains, over every block of the group (not over a window that blocks everything)." names={g.allowed} onChange={(v) => set({ allowed: v })} />
          <NameList id="tg-blocked" label="Also blocked" hint="A site and its subdomains, blocked all day for this group." names={g.blocked} onChange={(v) => set({ blocked: v })} />
        </fieldset>
        {err && <Notice tone="problem" role="alert">{err}</Notice>}
      </div>
    </Sheet>
  )
}

function WindowEditor({ w, i, data, onChange }: { w: TechnitiumWindow; i: number; data: TechnitiumGroups; onChange: (p: Partial<TechnitiumWindow>) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[8rem]"><label htmlFor={`tw-name-${i}`} className={LABEL}>Name</label><input id={`tw-name-${i}`} className={INPUT} value={w.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} /></div>
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
      <Segmented<'all' | 'categories'> ariaLabel="What the window blocks" value={w.scope} onChange={(v) => onChange({ scope: v })}
        options={[{ value: 'all', label: 'Every name' }, { value: 'categories', label: 'Some categories' }]} />
      {w.scope === 'categories' && (
        <div role="group" aria-label="Categories the window blocks" className="flex flex-wrap gap-1.5">
          {data.categories.map((c) => {
            const on = w.categories.includes(c.id)
            return <button key={c.id} type="button" aria-pressed={on} className={`${CHOICE_SM} ${on ? CHOICE_ON : CHOICE_OFF}`}
              onClick={() => onChange({ categories: on ? w.categories.filter((x) => x !== c.id) : [...w.categories, c.id] })}>{c.name}</button>
          })}
        </div>
      )}
    </div>
  )
}

function NameList({ id, label, hint, names, onChange }: { id: string; label: string; hint: string; names: string[]; onChange: (v: string[]) => void }) {
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
