// The Technitium page's Kids tab: the groups as cards (what is in force at a glance: bedtime, a categories window, the
// allow-list mode, a pause; the devices, SafeSearch and YouTube, the categories or sites, the windows, today's lookups),
// the editor (GroupSheet), the delete confirmation, what the move to per-group controls did, and the optional
// whole-house SafeSearch switch.

import { useState } from 'react'
import { Users, Plus, Pencil, Trash2, Moon, MoonStar, Loader2, Search as SearchIcon, Youtube, Clock, ListChecks, Pause, Info } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import Segmented from '../common/Segmented'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import { DeviceIcon, TAP, deviceName, useDeviceDirectory } from './deviceKit'
import GroupSheet from './GroupSheet'
import { activeLabels, clock, daysLabel, windowBlocks } from './kidsKit'
import {
  fetchTechnitiumGroups, deleteTechnitiumGroup, pauseTechnitiumGroup, technitiumSafeSearch, fetchTechnitiumGroupReport,
} from '../../api/endpoints'
import type { TechnitiumGroup, TechnitiumGroups, TechnitiumYoutube } from '../../../shared/types'
import { BTN_TOOLBAR_OK, BTN_CARD_QUIET, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TEXT_META, SECTION_LABEL } from '../../lib/ui'

const NOTE_KEY = 'dcs.technitium.kids-migration-seen'
const fmt = (n: number) => n.toLocaleString()

export default function KidsTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumGroups, 30000, { key: 'technitium-groups' })
  const dir = useDeviceDirectory()
  const [editing, setEditing] = useState<TechnitiumGroup | 'new' | null>(null)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [noteSeen, setNoteSeen] = useState(() => { try { return localStorage.getItem(NOTE_KEY) } catch { return null } })
  const after = async (msg: string, sync?: { ok: boolean; message: string } | null) => {
    addToast({ type: sync && !sync.ok ? 'warning' : 'success', message: sync && !sync.ok ? `${msg}; the secondary did not follow: ${sync.message}` : msg })
    await Promise.all([refresh(), onChanged()])
  }
  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try { await fn() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(null) }
  }
  const remove = (g: TechnitiumGroup) => act(g.id, async () => {
    if (!await confirm({ title: `Delete the group ${g.name}?`, message: `Its ${g.devices.length} device${g.devices.length === 1 ? '' : 's'} go back to the house's blocking alone: no categories, no SafeSearch, no time windows.`, confirmLabel: 'Delete group', danger: true })) return
    const r = await deleteTechnitiumGroup(g.id)
    await after(`${g.name} is deleted`, r.sync)
  })
  const pause = (g: TechnitiumGroup, minutes: number, window?: string) => act(g.id, async () => {
    const r = await pauseTechnitiumGroup(g.id, minutes, window)
    const what = window ? g.windows.find((w) => w.id === window)?.name ?? 'The window' : 'Its windows'
    await after(minutes ? `${g.name}: ${what.toLowerCase()} paused until ${r.paused_until ? clock(r.paused_until) : '—'}` : `${g.name}: the pause is over`, r.sync)
  })

  if (loading && !data) return <Skeleton variant="cards" rows={2} />
  if (error && !data) return <ErrorState title="Could not read the groups" error={error} onRetry={() => void refresh()} />
  if (!data) return null
  const notes = data.migration?.notes ?? []
  const showNote = notes.length > 0 && noteSeen !== String(data.migration?.at)
  return (
    <div className="space-y-4">
      {showNote && (
        <Notice tone="info" icon={Info} title="The kids' controls are per group now"
          onDismiss={() => { try { localStorage.setItem(NOTE_KEY, String(data.migration?.at)) } catch { /* a private window */ } setNoteSeen(String(data.migration?.at)) }}>
          <ul className="list-disc pl-4 space-y-1">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Notice>
      )}
      <div className="flex items-center justify-between gap-3">
        <h2 className={SECTION_LABEL}>Groups</h2>
        {isAdmin && <button type="button" className={BTN_TOOLBAR_OK} onClick={() => setEditing('new')}><Plus size={14} /> Add group</button>}
      </div>
      {data.groups.length === 0 ? (
        <EmptyState compact icon={<Users size={28} />} title="No groups yet"
          hint="A group is a child, or all the boys: their tablets, SafeSearch and YouTube for them alone, what they cannot reach, and when (bedtime, homework)."
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_OK} onClick={() => setEditing('new')}><Plus size={14} /> Add group</button> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.groups.map((g) => (
            <GroupCard key={g.id} g={g} data={data} dir={dir} isAdmin={isAdmin} busy={busy === g.id}
              onEdit={() => setEditing(g)} onDelete={() => void remove(g)} onPause={(m, w) => void pause(g, m, w)} />
          ))}
        </div>
      )}
      <HouseSafeSearch data={data} isAdmin={isAdmin} onChanged={() => after('SafeSearch for the house saved', null)} />
      {editing && <GroupSheet group={editing === 'new' ? null : editing} data={data} directory={dir.data?.devices ?? []}
        taken={data.groups.filter((g) => editing === 'new' || g.id !== editing.id).flatMap((g) => g.devices.map((d) => d.ip))}
        onClose={() => setEditing(null)} onSaved={async (msg, sync) => { setEditing(null); await after(msg, sync) }} />}
    </div>
  )
}

function GroupCard({ g, data, dir, isAdmin, busy, onEdit, onDelete, onPause }: {
  g: TechnitiumGroup
  data: TechnitiumGroups
  dir: ReturnType<typeof useDeviceDirectory>
  isAdmin: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onPause: (minutes: number, window?: string) => void
}) {
  // today's lookups: the admin's (a device's queries are not a viewer's)
  const report = usePolling(() => fetchTechnitiumGroupReport(g.id, 'lastDay'), 300000, { key: `technitium-report-${g.id}`, enabled: isAdmin })
  const active = activeLabels(g, data.categories)
  const pausedWindows = g.windows.filter((w) => w.paused_until)
  const enabledWindows = g.windows.filter((w) => w.enabled)
  const r = report.data
  return (
    <Panel icon={Users} title={g.name}
      actions={isAdmin ? <>
        <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} onClick={onEdit} aria-label={`Edit ${g.name}`} title="Edit"><Pencil size={14} /></button>
        <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST_DANGER}`} onClick={onDelete} aria-label={`Delete ${g.name}`} title="Delete"><Trash2 size={14} /></button>
      </> : undefined}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" aria-label="In force now">
          {active.map((a) => <Pill key={a.key} tone="attention" icon={a.all ? <Moon size={10} /> : <Clock size={10} />}>{a.text}</Pill>)}
          {g.paused_until && <Pill tone="info" icon={<Pause size={10} />}>Paused until {clock(g.paused_until)}</Pill>}
          {pausedWindows.map((w) => <Pill key={w.id} tone="info" icon={<Pause size={10} />}>{w.name} paused until {clock(w.paused_until!)}</Pill>)}
          {g.mode === 'allowlist' && <Pill tone="info" icon={<ListChecks size={10} />}>Allow-list</Pill>}
          <Pill tone={g.safe_search ? 'ok' : 'neutral'} icon={<SearchIcon size={10} />}>SafeSearch {g.safe_search ? 'on' : 'off'}</Pill>
          <Pill tone={g.youtube === 'off' ? 'neutral' : 'ok'} icon={<Youtube size={10} />}>YouTube {g.youtube}</Pill>
        </div>
        <div>
          <p className={SECTION_LABEL}>Devices</p>
          {g.devices.length ? (
            <ul className="mt-2 space-y-2">
              {g.devices.map((d) => {
                const known = (d.id ? dir.byId.get(d.id) : undefined) ?? dir.byIp.get(d.ip)
                const name = known?.nickname || d.label || (known ? deviceName(known) : d.ip)
                return (
                  <li key={d.ip} className="text-sm text-slate-300 flex items-center gap-3 min-w-0">
                    <DeviceIcon icon={known?.icon ?? 'unknown'} guessed={!known || known.icon_guessed} size="sm" />
                    <span className="truncate">{name}</span>{name !== d.ip && <span className="font-mono text-xs text-slate-500 shrink-0">{d.ip}</span>}
                  </li>
                )
              })}
            </ul>
          ) : <p className={TEXT_META}>None yet: the group does nothing until a device is in it.</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {g.mode === 'allowlist'
            ? (g.sites.length ? g.sites.map((s) => <Pill key={s} tone="neutral">{data.allowlist_sites.find((x) => x.id === s)?.name ?? s}</Pill>) : <span className={TEXT_META}>No site allowed yet</span>)
            : (g.categories.length ? g.categories.map((c) => <Pill key={c} tone="neutral">{data.categories.find((x) => x.id === c)?.name ?? c}</Pill>) : <span className={TEXT_META}>No category blocked</span>)}
          {g.allowed.length + g.blocked.length > 0 && <span className={TEXT_META}>· {g.allowed.length} allowed, {g.blocked.length} blocked by hand</span>}
        </div>
        <ul className="space-y-1">
          {g.windows.length === 0 && <li className={TEXT_META}>No time window</li>}
          {g.windows.map((w) => (
            <li key={w.id} className={`text-sm flex items-start gap-2 ${w.enabled ? 'text-slate-300' : 'text-slate-500'}`}>
              {w.scope === 'all' ? <MoonStar size={14} className="text-slate-500 shrink-0 mt-0.5" aria-hidden /> : <Clock size={14} className="text-slate-500 shrink-0 mt-0.5" aria-hidden />}
              <span className="min-w-0">{w.name} {w.from}–{w.to}, {daysLabel(w.days)}: {windowBlocks(w, data.categories)}{w.enabled ? '' : ' (off)'}</span>
            </li>
          ))}
        </ul>
        {isAdmin && r && (
          <p className={TEXT_META}>Today: {fmt(r.lookups)} lookups, {fmt(r.blocked)} blocked{r.top[0] ? `, top: ${r.top[0].name}` : ''}{r.top_blocked[0] ? `; most blocked: ${r.top_blocked[0].name}` : ''}</p>
        )}
        {isAdmin && (active.length > 0 || g.paused_until || pausedWindows.length > 0) && enabledWindows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {g.paused_until || pausedWindows.length > 0
              ? <button type="button" disabled={busy} className={BTN_CARD_QUIET} onClick={() => onPause(0, g.paused_until ? undefined : pausedWindows[0].id)}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} End the pause</button>
              : <>
                  <button type="button" disabled={busy} className={BTN_CARD_QUIET} onClick={() => onPause(30)}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} Pause 30 min</button>
                  {active.length > 1 && active.map((a) => {
                    const w = g.windows.find((x) => x.id === a.key)
                    return <button key={a.key} type="button" disabled={busy} className={BTN_CARD_QUIET} onClick={() => onPause(30, a.key)}><Pause size={12} /> Pause {w?.name ?? 'it'} 30 min</button>
                  })}
                </>}
          </div>
        )}
      </div>
    </Panel>
  )
}

// SafeSearch and YouTube for every device of the house, grown-ups included: optional, off by default (a group has its own)
function HouseSafeSearch({ data, isAdmin, onChanged }: { data: TechnitiumGroups; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  const save = async (house: { safe_search?: boolean; youtube?: TechnitiumYoutube }) => {
    setBusy(true)
    try { await technitiumSafeSearch(house); await onChanged() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) } finally { setBusy(false) }
  }
  return (
    <Panel icon={SearchIcon} title="SafeSearch for the whole house (optional)" sub="Every device, yours too. Off is usual: each kids' group has its own SafeSearch and YouTube setting.">
      <div className="space-y-4">
        <ToggleRow label="Force SafeSearch for every device" help={`Google, Bing and DuckDuckGo answer with their safe results (${data.forced_names.safe_search.join(', ')}).`} def="off" checked={data.house.safe_search} disabled={!isAdmin || busy} onChange={(v) => void save({ safe_search: v })} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-200 flex items-center gap-2"><Youtube size={14} className="text-slate-500" aria-hidden /> YouTube restricted mode for every device</p>
            <p className={TEXT_META}>Moderate hides most mature videos; strict hides more, and comments.</p>
          </div>
          <Segmented ariaLabel="YouTube restricted mode for the house" value={data.house.youtube} onChange={(v) => isAdmin && !busy && void save({ youtube: v })}
            options={[{ value: 'off', label: 'Off', disabled: !isAdmin }, { value: 'moderate', label: 'Moderate', disabled: !isAdmin }, { value: 'strict', label: 'Strict', disabled: !isAdmin }]} />
        </div>
      </div>
    </Panel>
  )
}
