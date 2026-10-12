// The Technitium page's Kids tab: the house's quick actions (pause the house, Bedtime now, the exceptions for a while), the
// house's rules as a card (for every device that follows the house, the devices that do not), the groups as cards (what is in
// force at a glance: bedtime, a categories window, the allow-list mode, a pause; the devices, SafeSearch and YouTube, the
// categories or sites, the windows, today's lookups; colour and icon; clone), the editor (GroupSheet, also the house's), the
// delete confirmation, and what the move to per-group controls did.

import { useState } from 'react'
import { Users, Plus, Pencil, Trash2, Moon, MoonStar, Loader2, Search as SearchIcon, Youtube, Clock, ListChecks, Pause, Info, Copy, House, Play, Undo2, Grid3x3, X, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import Notice from '../common/Notice'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import { DeviceIcon, TAP, deviceName, useDeviceDirectory } from './deviceKit'
import GroupSheet from './GroupSheet'
import { GROUP_ICONS, GROUP_TEXT, YOUTUBE_LABEL, activeLabels, clock, windowEffect, windowWhen } from './kidsKit'
import {
  fetchTechnitiumGroups, deleteTechnitiumGroup, pauseTechnitiumGroup, fetchTechnitiumGroupReport, cloneTechnitiumGroup,
  pauseTechnitiumHouse, technitiumBedtimeNow, allowTechnitiumFor,
} from '../../api/endpoints'
import type { TechnitiumGroup, TechnitiumGroups, TechnitiumWindow } from '../../../shared/types'
import { BTN_TOOLBAR_OK, BTN_CARD_QUIET, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TEXT_META, SECTION_LABEL } from '../../lib/ui'

const NOTE_KEY = 'dcs.technitium.kids-migration-seen'
const fmt = (n: number) => n.toLocaleString()

export default function KidsTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumGroups, 30000, { key: 'technitium-groups' })
  const dir = useDeviceDirectory()
  const [editing, setEditing] = useState<TechnitiumGroup | 'new' | 'house' | null>(null)
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
  const pause = (g: Pick<TechnitiumGroup, 'id' | 'name' | 'windows'>, minutes: number, window?: string) => act(g.id, async () => {
    const r = await pauseTechnitiumGroup(g.id, minutes, window)
    const what = window ? g.windows.find((w) => w.id === window)?.name ?? 'The window' : 'Its windows'
    await after(minutes ? `${g.name}: ${what.toLowerCase()} paused until ${r.paused_until ? clock(r.paused_until) : '—'}` : `${g.name}: the pause is over`, r.sync)
  })
  const clone = (g: TechnitiumGroup) => act(g.id, async () => {
    const r = await cloneTechnitiumGroup(g.id)
    await after(`${r.group.name} is a copy of ${g.name}: add its devices`, r.sync)
  })
  // the quick actions: each says what it did and offers its undo
  const housePause = (minutes: number) => act('house-pause', async () => {
    const r = await pauseTechnitiumHouse(minutes)
    await after(minutes ? `The house is paused until ${r.paused_until ? clock(r.paused_until) : '—'}: no rule for anyone` : 'The house rules are back', r.sync)
  })
  const bedtime = (cancel: boolean) => act('house-bedtime', async () => {
    const r = await technitiumBedtimeNow(cancel)
    await after(cancel ? 'Bedtime now is undone: every group is back to its schedule' : `Bedtime now: ${r.forced.map((f) => `${f.owner} until ${clock(f.until)}`).join(', ')}`, r.sync)
  })
  const endAllow = (name: string, device: string | null) => act(`allow-${name}`, async () => {
    const r = await allowTechnitiumFor(name, { device_id: device ?? undefined, remove: true })
    await after(`${name}: the exception ended`, r.sync)
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
      <QuickActions data={data} isAdmin={isAdmin} busy={busy} onPause={(m) => void housePause(m)} onBedtime={(c) => void bedtime(c)} onEndAllow={(n, d) => void endAllow(n, d)} />
      <HouseCard data={data} isAdmin={isAdmin} busy={busy === 'house'} onEdit={() => setEditing('house')} onPause={(m, w) => void pause({ id: 'house', name: 'The house', windows: data.house.windows ?? [] }, m, w)} />
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
              onEdit={() => setEditing(g)} onDelete={() => void remove(g)} onClone={() => void clone(g)} onPause={(m, w) => void pause(g, m, w)} />
          ))}
        </div>
      )}
      {editing && <GroupSheet group={editing === 'new' || editing === 'house' ? null : editing} house={editing === 'house'} data={data} directory={dir.data?.devices ?? []}
        taken={data.groups.filter((g) => editing === 'new' || editing === 'house' || g.id !== editing.id).flatMap((g) => g.devices.map((d) => d.ip))}
        onClose={() => setEditing(null)} onSaved={async (msg, sync) => { setEditing(null); await after(msg, sync) }} />}
    </div>
  )
}

/** the house's quick actions (the admin's), and what they hold now: the pause, Bedtime now, the exceptions for a while */
function QuickActions({ data, isAdmin, busy, onPause, onBedtime, onEndAllow }: {
  data: TechnitiumGroups; isAdmin: boolean; busy: string | null
  onPause: (minutes: number) => void; onBedtime: (cancel: boolean) => void; onEndAllow: (name: string, device: string | null) => void
}) {
  const paused = data.house_paused_until ?? null
  const bed = data.bedtime_now ?? []
  const allows = data.temp_allows ?? []
  const spin = (k: string, I: LucideIcon) => (busy === k ? <Loader2 size={14} className="animate-spin" /> : <I size={14} />)
  if (!isAdmin && !paused && bed.length === 0 && allows.length === 0) return null
  return (
    <section aria-label="The house's quick actions" className="surface p-3 md:p-4 space-y-3">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {paused
            ? <button type="button" className={BTN_TOOLBAR_OK} disabled={busy !== null} onClick={() => onPause(0)}>{spin('house-pause', Play)} End the pause</button>
            : <button type="button" className={BTN_CARD_QUIET} disabled={busy !== null} onClick={() => onPause(30)}>{spin('house-pause', Pause)} Pause the house 30 min</button>}
          {bed.length
            ? <button type="button" className={BTN_CARD_QUIET} disabled={busy !== null} onClick={() => onBedtime(true)}>{spin('house-bedtime', Undo2)} Undo bedtime now</button>
            : <button type="button" className={BTN_CARD_QUIET} disabled={busy !== null} onClick={() => onBedtime(false)}>{spin('house-bedtime', Moon)} Bedtime now</button>}
        </div>
      )}
      {(paused || bed.length > 0 || allows.length > 0) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="In force now for the house">
          {paused && <li><Pill tone="attention" icon={<Pause size={10} />}>House paused until {clock(paused)}: no rule for anyone</Pill></li>}
          {bed.length > 0 && <li><Pill tone="attention" icon={<Moon size={10} />}>Bedtime now: {bed.map((b) => b.name).join(', ')} until {clock(bed[0].until)}</Pill></li>}
          {allows.map((a) => (
            <li key={`${a.name}-${a.device ?? 'house'}`} className="inline-flex items-center gap-1">
              <Pill tone="info" icon={<Check size={10} />}>{a.name} allowed for {a.label ?? 'the house'} until {clock(a.until)}</Pill>
              {isAdmin && <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} aria-label={`End the exception for ${a.name}`} onClick={() => onEndAllow(a.name, a.device)}><X size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && <p className={TEXT_META}>Each ends by itself. <em>Allow a site for an hour</em> is on a blocked name in the Activity tab or in a device&apos;s drawer.</p>}
    </section>
  )
}

/** the windows of a group or of the house, one line each */
function WindowLines({ windows, data }: { windows: TechnitiumWindow[]; data: TechnitiumGroups }) {
  return (
    <ul className="space-y-1">
      {windows.length === 0 && <li className={TEXT_META}>No time window</li>}
      {windows.map((w) => (
        <li key={w.id} className={`text-sm flex items-start gap-2 ${w.enabled ? 'text-slate-300' : 'text-slate-500'}`}>
          {w.grid ? <Grid3x3 size={14} className="text-slate-500 shrink-0 mt-0.5" aria-hidden /> : w.scope === 'all' ? <MoonStar size={14} className="text-slate-500 shrink-0 mt-0.5" aria-hidden /> : <Clock size={14} className="text-slate-500 shrink-0 mt-0.5" aria-hidden />}
          <span className="min-w-0">{w.name} {windowWhen(w)}: {windowEffect(w, data.categories)}{w.enabled ? '' : ' (off)'}</span>
        </li>
      ))}
    </ul>
  )
}

/** the house's rules: for every device that follows the house (a kids group adds its own) */
function HouseCard({ data, isAdmin, busy, onEdit, onPause }: { data: TechnitiumGroups; isAdmin: boolean; busy: boolean; onEdit: () => void; onPause: (minutes: number, window?: string) => void }) {
  const h = data.house
  const windows = h.windows ?? []
  const active = activeLabels({ windows, active: h.active }, data.categories)
  const exempt = h.exempt ?? []
  return (
    <Panel icon={House} title="The house rules"
      sub="For every device in no group, and for every kids group on top of its own. A device whose Follows the house rules switch is off (the Devices tab) is left out."
      actions={isAdmin ? <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} onClick={onEdit} aria-label="Edit the house rules" title="Edit"><Pencil size={14} /></button> : undefined}>
      {!h.on ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={TEXT_META}>Nothing set: a device in no group browses with Technitium&apos;s own blocking alone.</p>
          {isAdmin && <button type="button" className={BTN_CARD_QUIET} onClick={onEdit}><Plus size={12} /> Set the house rules</button>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" aria-label="The house now">
            {active.map((a) => <Pill key={a.key} tone="attention" icon={a.all ? <Moon size={10} /> : <Clock size={10} />}>{a.text}</Pill>)}
            {h.paused_until && <Pill tone="info" icon={<Pause size={10} />}>Windows paused until {clock(h.paused_until)}</Pill>}
            <Pill tone={h.safe_search ? 'ok' : 'neutral'} icon={<SearchIcon size={10} />}>SafeSearch {h.safe_search ? 'on' : 'off'}</Pill>
            <Pill tone={h.youtube === 'off' ? 'neutral' : 'ok'} icon={<Youtube size={10} />}>YouTube {YOUTUBE_LABEL[h.youtube].toLowerCase()}</Pill>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(h.categories ?? []).length ? (h.categories ?? []).map((c) => <Pill key={c} tone="neutral">{data.categories.find((x) => x.id === c)?.name ?? c}</Pill>) : <span className={TEXT_META}>No category blocked</span>}
            {(h.allowed ?? []).length + (h.blocked ?? []).length > 0 && <span className={TEXT_META}>· {(h.allowed ?? []).length} allowed, {(h.blocked ?? []).length} blocked by hand</span>}
          </div>
          <WindowLines windows={windows} data={data} />
          {isAdmin && active.length > 0 && !h.paused_until && <button type="button" disabled={busy} className={BTN_CARD_QUIET} onClick={() => onPause(30)}><Pause size={12} /> Pause its windows 30 min</button>}
        </div>
      )}
      <p className={`${TEXT_META} mt-3`}>{exempt.length ? `Not following the house: ${exempt.map((e) => e.name).join(', ')}.` : 'Every device follows the house.'}</p>
    </Panel>
  )
}

function GroupCard({ g, data, dir, isAdmin, busy, onEdit, onDelete, onClone, onPause }: {
  g: TechnitiumGroup
  data: TechnitiumGroups
  dir: ReturnType<typeof useDeviceDirectory>
  isAdmin: boolean
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onClone: () => void
  onPause: (minutes: number, window?: string) => void
}) {
  // today's lookups: the admin's (a device's queries are not a viewer's)
  const report = usePolling(() => fetchTechnitiumGroupReport(g.id, 'lastDay'), 300000, { key: `technitium-report-${g.id}`, enabled: isAdmin })
  const active = activeLabels(g, data.categories)
  const pausedWindows = g.windows.filter((w) => w.paused_until)
  const enabledWindows = g.windows.filter((w) => w.enabled)
  const r = report.data
  return (
    <Panel icon={groupIcon(g)} title={g.name}
      actions={isAdmin ? <>
        <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} onClick={onEdit} aria-label={`Edit ${g.name}`} title="Edit"><Pencil size={14} /></button>
        <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST}`} onClick={onClone} disabled={busy} aria-label={`Clone ${g.name}`} title="Clone: the same rules, no devices"><Copy size={14} /></button>
        <button type="button" className={`${BTN_ICON_SM} ${TAP} ${TONE_GHOST_DANGER}`} onClick={onDelete} aria-label={`Delete ${g.name}`} title="Delete"><Trash2 size={14} /></button>
      </> : undefined}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" aria-label="In force now">
          {active.map((a) => <Pill key={a.key} tone="attention" icon={a.all ? <Moon size={10} /> : <Clock size={10} />}>{a.text}</Pill>)}
          {g.paused_until && <Pill tone="info" icon={<Pause size={10} />}>Paused until {clock(g.paused_until)}</Pill>}
          {pausedWindows.map((w) => <Pill key={w.id} tone="info" icon={<Pause size={10} />}>{w.name} paused until {clock(w.paused_until!)}</Pill>)}
          {g.mode === 'allowlist' && <Pill tone="info" icon={<ListChecks size={10} />}>Allow-list</Pill>}
          <Pill tone={g.safe_search ? 'ok' : 'neutral'} icon={<SearchIcon size={10} />}>SafeSearch {g.safe_search ? 'on' : 'off'}</Pill>
          <Pill tone={g.youtube === 'off' ? 'neutral' : 'ok'} icon={<Youtube size={10} />}>YouTube {YOUTUBE_LABEL[g.youtube].toLowerCase()}</Pill>
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
        <WindowLines windows={g.windows} data={data} />
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

/** a group's icon in its colour, as the card header draws an icon */
const ICON_CACHE = new Map<string, LucideIcon>()
function groupIcon(g: TechnitiumGroup): LucideIcon {
  const key = `${g.icon ?? 'users'}-${g.color ?? 'gray'}`
  let C = ICON_CACHE.get(key)
  if (!C) {
    const I = GROUP_ICONS[g.icon ?? 'users'].icon
    const tint = GROUP_TEXT[g.color ?? 'gray']
    C = ((p: { size?: number }) => <I size={p.size ?? 16} className={`shrink-0 ${tint}`} aria-hidden />) as unknown as LucideIcon
    ICON_CACHE.set(key, C)
  }
  return C
}
