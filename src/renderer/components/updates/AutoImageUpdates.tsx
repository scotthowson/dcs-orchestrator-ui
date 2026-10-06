// =============================================================================
// AutoImageUpdates — the server-side "image-update" schedule as one dropdown:
// off, every night, every Sunday or the 1st of the month, at 03:00, on the
// servers the "Images on" chips select (everywhere, the hub alone or one VM).
// The schedule runs on each server itself, with this page closed: it pulls the
// newer image of everything that runs and recreates the containers that run
// the old copy (or only pulls). The outcome goes to the notification channels
// and to the "Unattended updates" list.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Select, Switch } from '@mantine/core'
import { CalendarClock, Loader2, Play, DownloadCloud } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD_QUIET } from '../../lib/ui'
import { CardIcon } from './updateBits'
import { createSchedule, deleteSchedule, fetchSchedules, runSchedule, updateSchedule, updateAllImages } from '../../api/endpoints'
import { scopeMember, type FleetScope, type ScopeMember } from '../../hooks/useFleetScope'
import type { Schedule } from '../../../shared/types'

const NAME = 'Automatic image updates'
const PRESETS = [
  { id: 'daily', label: 'Every night at 03:00', cron: '0 3 * * *' },
  { id: 'weekly', label: 'Every Sunday at 03:00', cron: '0 3 * * 0' },
  { id: 'monthly', label: 'The 1st of each month at 03:00', cron: '0 3 1 * *' },
] as const

const presetOf = (s: Schedule) => PRESETS.find((p) => p.cron === (s.cron ?? s.schedule ?? '').trim())?.id ?? 'custom'
/** '' = pull and recreate, 'pull' = pull only (the server's schedule target) */
const recreates = (s: Schedule) => s.target !== 'pull'

function ago(iso?: string | null): string {
  const ms = iso ? Date.parse(iso) : 0
  if (!ms) return 'never'
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export default function AutoImageUpdates({ scope, members }: { scope: FleetScope; members: ScopeMember[] }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [list, setList] = useState<Schedule[] | null>(null)
  const [silent, setSilent] = useState<string[]>([])   // servers that did not answer the schedule list
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recreateNew, setRecreateNew] = useState(true)   // a new schedule pulls and recreates unless told otherwise

  // every server the choice above reaches: null = the hub, otherwise a VM
  const targets = useMemo<(string | null)[]>(() => (scope === 'all' ? [null, ...members.map((m) => m.id)] : [scopeMember(scope)]), [scope, members])
  const nameOf = useCallback((t: string | null) => (t === null ? 'the hub' : (members.find((m) => m.id === t)?.name ?? t)), [members])

  const load = useCallback(async () => {
    try {
      const r = await fetchSchedules(scope)
      setList((r.schedules ?? []).filter((s) => s.action === 'image-update'))
      setSilent((r.members ?? []).filter((m) => !m.reachable).map((m) => m.name))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The schedules could not be read')
    }
  }, [scope])
  useEffect(() => {
    setList(null)
    void load()
    const t = setInterval(() => { void load() }, 60000)
    return () => clearInterval(t)
  }, [load])

  // the schedule each server has (one is enough: the panel creates exactly one)
  const byTarget = useMemo(() => {
    const m = new Map<string | null, Schedule>()
    for (const s of list ?? []) {
      const t = scope === 'all' ? (s.member ?? null) : scopeMember(scope)
      if (!m.has(t)) m.set(t, s)
    }
    return m
  }, [list, scope])
  const active = useMemo(() => targets.filter((t) => byTarget.get(t)?.enabled !== false && byTarget.has(t)), [targets, byTarget])
  const kinds = new Set(active.map((t) => presetOf(byTarget.get(t) as Schedule)))
  const value: string = active.length === 0 ? 'off' : active.length === targets.length && kinds.size === 1 ? [...kinds][0] : 'mixed'
  const modes = new Set(active.map((t) => recreates(byTarget.get(t) as Schedule)))
  const recreateOn = active.length === 0 ? recreateNew : modes.size === 1 ? [...modes][0] : true
  const lastRun = active.map((t) => byTarget.get(t)?.last_run ?? null).filter(Boolean).sort().pop() ?? null
  const runs = active.reduce((n, t) => n + (byTarget.get(t)?.run_count ?? 0), 0)

  const report = useCallback((what: string, errs: string[], count: number) => {
    if (errs.length === 0) addToast({ type: 'success', message: `${what}${count > 1 ? ` on ${count} servers` : ''}`, duration: 5000 })
    else addToast({ type: 'warning', message: `${what} on ${count - errs.length} of ${count} servers — ${errs.join('; ')}`, duration: 9000 })
  }, [addToast])

  // one write per server, all at once; a server that does not answer is named, not fatal
  const applyAll = useCallback(async (what: string, job: (t: string | null, existing: Schedule | undefined) => Promise<unknown>) => {
    setBusy(true)
    const errs = (await Promise.all(targets.map(async (t) => {
      try { await job(t, byTarget.get(t)); return '' } catch (e) { return `${nameOf(t)}: ${e instanceof Error ? e.message : 'failed'}` }
    }))).filter(Boolean)
    report(what, errs, targets.length)
    await load()
    setBusy(false)
  }, [targets, byTarget, nameOf, report, load])

  const choose = (v: string) => {
    if (busy) return
    const preset = PRESETS.find((p) => p.id === v)
    if (!preset) {
      void applyAll('Automatic image updates are off', async (t, ex) => { if (ex) await deleteSchedule(ex.id, t) })
      return
    }
    const target = recreateNew ? '' : 'pull'
    void applyAll(`Images update ${preset.label.charAt(0).toLowerCase()}${preset.label.slice(1)}`, async (t, ex) => {
      if (ex) await updateSchedule(ex.id, { schedule: preset.cron, cron: preset.cron, target, enabled: true }, t)
      else await createSchedule({ name: NAME, schedule: preset.cron, action: 'image-update', target }, t)
    })
  }
  const setMode = (on: boolean) => {
    setRecreateNew(on)
    if (busy || active.length === 0) return
    void applyAll(on ? 'Automatic runs recreate the containers' : 'Automatic runs only pull', async (t, ex) => { if (ex) await updateSchedule(ex.id, { target: on ? '' : 'pull' }, t) })
  }
  const runNow = () => {
    if (busy || active.length === 0) return
    void applyAll('Image update started', async (t, ex) => { if (ex) await runSchedule(ex.id, t) })
  }
  // every server the chips reach, schedule or not: each pulls what runs and recreates the containers on the old copy
  const updateEverything = async () => {
    if (busy) return
    const ok = await confirm({
      title: 'Update every image now?',
      message: `${where.charAt(0).toUpperCase()}${where.slice(1)} pull${targets.length === 1 ? 's' : ''} the newer image of everything that runs and recreate${targets.length === 1 ? 's' : ''} the containers on the old copy, in the background. Apps restart briefly while their container is recreated.`,
      confirmLabel: 'Update everything',
    })
    if (!ok) return
    void applyAll('Updating every image in the background', async (t) => { await updateAllImages(t) })
  }

  const where = scope === 'all' ? `the hub and its ${members.length} VM${members.length === 1 ? '' : 's'}` : scope === 'hub' ? 'the hub' : (members.find((m) => m.id === scope)?.name ?? scope)
  const sub = value === 'off'
    ? `Images are updated only when you press Update. Turn it on for ${where}.`
    : value === 'mixed'
      ? `${active.length} of ${targets.length} servers have it, not all the same — choose a time to set ${where} alike.`
      : `On ${where} · last run ${ago(lastRun)}${runs ? ` · ${runs} run${runs === 1 ? '' : 's'}` : ''}`

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.03]">
      <div className="flex items-center gap-3 flex-wrap">
        <CardIcon><CalendarClock size={15} /></CardIcon>
        <div className="flex-1 min-w-[12rem]">
          <h3 className="text-xs font-medium text-slate-300">Automatic image updates</h3>
          <p className="text-[10px] text-slate-500 mt-0.5">{list === null && !error ? 'Reading the schedules…' : error ? <span className="text-rose-300">{error}</span> : sub}</p>
        </div>
        {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
        <Select
          size="xs"
          className="w-full sm:w-64"
          aria-label="Automatic image updates"
          value={value}
          disabled={busy || list === null}
          onChange={(v) => { if (v !== null && v !== value) choose(v) }}
          data={[
            { value: 'off', label: 'Off' },
            ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
            ...(value === 'custom' ? [{ value: 'custom', label: `A custom time (see ${pageLabel('automations')})`, disabled: true }] : []),
            ...(value === 'mixed' ? [{ value: 'mixed', label: 'Different on some servers', disabled: true }] : []),
          ]}
        />
      </div>
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap pl-12 text-slate-400">
        <Hint label="On: the containers that run the old copy are recreated right after the pull. Off: the images are pulled and the containers keep running on the old copy until someone recreates them.">
          <span className="inline-flex">
            <Switch size="xs" checked={recreateOn} disabled={busy || list === null} onChange={(e) => setMode(e.currentTarget.checked)} label="Recreate the containers after pulling" styles={{ label: { fontSize: 11 } }} />
          </span>
        </Hint>
        {active.length > 0 && (
          <button type="button" onClick={runNow} disabled={busy} className={BTN_CARD_QUIET}>
            <Play size={12} /> Run now
          </button>
        )}
        <Hint label={`Pull the newer image of everything that runs on ${where} and recreate the containers on the old copy, now — schedule or not. The result goes to your notification channels.`}>
          <button type="button" onClick={() => { void updateEverything() }} disabled={busy} className={`${BTN_CARD_QUIET} text-emerald-300 hover:bg-emerald-500/10`}>
            <DownloadCloud size={12} /> Update everything
          </button>
        </Hint>
        {silent.length > 0 && <span className="text-[10px] text-amber-300">Not answering: {silent.join(', ')}</span>}
      </div>
      <p className="text-[10px] text-slate-500 pl-12 leading-relaxed">
        Each server does it by itself, with this page closed: it pulls the newer image of everything that runs{recreateOn ? ', then recreates the containers on the old copy' : ' and leaves the containers as they are'}. The result goes to your notification channels and the Unattended updates list; the log is logs/image-update.log.
      </p>
    </div>
  )
}
