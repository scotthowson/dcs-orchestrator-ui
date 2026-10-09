// =============================================================================
// FleetJobsPanel — the VMs the hub is building (or built, or failed to build):
// a summary with a progress ring, then one wide card per job (the Proxmox page's compact cards wear its own card, the wizard's the glass one) — its name, size
// and address, the nine steps as a segmented bar (hover a segment for the step),
// what it is doing now. Open a card for the step checklist and the log; Retry
// for a failed one, Dismiss for a finished one. Progress bars, rings and
// tooltips come from Mantine (lib/mantine.tsx).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { Progress, RingProgress, Text, Tooltip } from '@mantine/core'
import { Loader2, RefreshCw, Trash2, ChevronDown, CheckCircle2, XCircle, Clock, Server, Layers, Circle, MinusCircle } from 'lucide-react'
import { retryFleetJob, deleteFleetJob, fetchFleetJob } from '../../api/endpoints'
import type { FleetJob, FleetJobStep } from '../../../shared/types'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import { ago } from './fleetShared'
import { BTN_CARD, BTN_CARD_QUIET, BTN_ICON_QUIET, TONE_OK } from '../../lib/ui'

import { CopyButton } from '../common/CopyButton'
import { Pill } from '../common/Pill'
import { type Tone } from '../../lib/tone'
// the theme's status colours (lib/themeEngine sets them; the fallbacks are the stock dark look); a template's own
// steps wear the fleet's violet (Mantine's violet, which every theme keeps)
const C = { done: 'var(--dcs-success, #34d399)', running: 'var(--dcs-info, #22d3ee)', failed: 'var(--dcs-danger, #fb7185)', pending: 'color-mix(in srgb, var(--dcs-text-muted, #94a3b8) 20%, transparent)', template: 'var(--mantine-color-violet-5)' }

function jobCurrent(j: FleetJob): number {
  const i = j.steps.findIndex((s) => s.state === 'running' || s.state === 'failed')
  if (i >= 0) return i
  const lastDone = j.steps.map((s) => s.state).lastIndexOf('done')
  return Math.min(j.steps.length - 1, lastDone + 1)
}
function jobStatus(j: FleetJob): string {
  if (j.status === 'queued') return 'Waiting for its turn — VMs are built one at a time'
  if (j.status === 'failed') return j.error || 'Failed'
  if (j.kind === 'bake' && j.status === 'done') return `DCS template VM ${j.vmid} for ${j.template_for ?? j.image_id} is baked — a VM cloned from it builds in about half a minute`
  if (j.status === 'done' && j.manual && !j.member_id) return `VM ${j.vmid} boots the installer — install the system in its Proxmox console, then join with the code below`
  if (j.status === 'done' && j.manual) return `VM ${j.vmid} at ${j.ip} was installed by hand and joined as ${j.stack}`
  if (j.status === 'done') return `VM ${j.vmid} at ${j.ip} runs the stack ${j.stack}`
  const st = j.steps.find((s) => s.id === j.current) ?? j.steps[jobCurrent(j)]
  return st ? `${st.label}${st.hint ? ` — ${st.hint}` : ''}${st.detail ? ` · ${st.detail}` : ''}` : 'Working…'
}

/** what a build is called and drawn as: `cls` tints its icon tile, `color` is the Mantine colour of its pill */
type JobLook = { text: string; cls: string; tone: Tone }
function look(j: FleetJob): JobLook {
  if (j.kind === 'bake' && j.status === 'done') return { text: 'template ready', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', tone: 'ok' }
  if (j.kind === 'bake' && j.status === 'running') return { text: 'baking', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25', tone: 'info' }
  if (j.status === 'queued') return { text: 'waiting', cls: 'bg-white/5 text-slate-400 border-white/10', tone: 'neutral' }
  if (j.status === 'running') return { text: 'building', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25', tone: 'info' }
  if (j.status === 'failed') return { text: 'failed', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/25', tone: 'problem' }
  if (j.manual && !j.member_id) return { text: 'install by hand', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/25', tone: 'attention' }
  return { text: 'ready', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', tone: 'ok' }
}
function took(j: FleetJob): string {
  if (j.started_at && j.finished_at) { const s = j.finished_at - j.started_at; return s >= 120 ? `took ${Math.round(s / 60)} min` : `took ${s} s` }
  if (j.started_at && j.status === 'running') return `started ${ago(j.started_at)}`
  return ''
}
function sizeText(j: FleetJob): string {
  const ram = j.memory_mb >= 1024 ? `${Math.round((j.memory_mb / 1024) * 10) / 10} GB` : `${j.memory_mb} MB`
  return `${j.cores} ${j.cores === 1 ? 'core' : 'cores'} · ${ram} RAM · ${j.disk_gb} GB disk`
}
/** The one line that makes the VM a node of this hub carrying the build's stack: GET /fleet/bootstrap serves the installer with this code's values */
function joinLine(j: FleetJob): string {
  return `curl -fsSL '${j.hub_url ?? ''}/fleet/bootstrap?token=${j.join_token ?? ''}&stack=${j.stack}' | bash`
}

function StepIcon({ state, size = 13 }: { state: FleetJobStep['state'] | 'skipped'; size?: number }) {
  if (state === 'done') return <CheckCircle2 size={size} className="text-emerald-400" />
  if (state === 'running') return <Loader2 size={size} className="text-cyan-400 animate-spin" />
  if (state === 'failed') return <XCircle size={size} className="text-rose-400" />
  if (state === 'skipped') return <MinusCircle size={size - 1} className="text-slate-600" />
  return <Circle size={size - 3} className="text-slate-600" />
}

/** The steps as one segmented bar: done, the one running (striped, moving), a failed one, the rest as a track */
function StepBar({ job }: { job: FleetJob }) {
  const n = Math.max(1, job.steps.length)
  return (
    <Progress.Root size={7} radius="xl" transitionDuration={400} styles={{ root: { gap: 3, background: 'transparent', overflow: 'visible' } }} aria-label={`${job.stack}: ${job.steps.filter((s) => s.state === 'done').length} of ${n} steps done`}>
      {job.steps.map((st, i) => {
        const color = st.state === 'done' ? (job.kind === 'bake' ? C.template : C.done) : st.state === 'running' ? C.running : st.state === 'failed' ? C.failed : C.pending
        return (
          <Tooltip key={st.id} withArrow openDelay={120} position="top" label={<span><b>{i + 1}. {st.label}</b>{st.hint ? ` — ${st.hint}` : ''}{st.detail ? ` · ${st.detail}` : ''}</span>}>
            <Progress.Section value={100 / n} color={color} striped={st.state === 'running'} animated={st.state === 'running'} style={{ borderRadius: 99 }} />
          </Tooltip>
        )
      })}
    </Progress.Root>
  )
}

function StepChecklist({ job }: { job: FleetJob }) {
  const failedAt = job.steps.findIndex((s) => s.state === 'failed')
  return (
    <ol className="space-y-1">
      {job.steps.map((st) => {
        const skipped = failedAt >= 0 && st.state === 'pending' && job.steps.indexOf(st) > failedAt
        return (
          <li key={st.id} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0"><StepIcon state={skipped ? 'skipped' : st.state} /></span>
            <span className="min-w-0">
              <span className={st.state === 'done' ? 'text-slate-300' : st.state === 'running' ? 'text-cyan-400 font-medium' : st.state === 'failed' ? 'text-rose-300 font-medium' : 'text-slate-500'}>{st.label}</span>
              <span className="block text-[10px] text-slate-500 break-words">{st.detail || st.hint}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function LogView({ lines }: { lines: FleetJob['log'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [lines.length])
  if (lines.length === 0) return <p className="text-[11px] text-slate-500 italic">Nothing logged yet.</p>
  return (
    <div ref={ref} className="rounded-lg bg-slate-950/70 border border-white/5 px-3 py-2 max-h-56 overflow-y-auto scrollbar-thin space-y-0.5">
      {lines.map((l, i) => (
        <p key={i} className={`text-[11px] font-mono leading-relaxed break-words ${l.text.startsWith('✗') ? 'text-rose-300' : l.text.startsWith('✓') ? 'text-emerald-300' : l.text.startsWith('→') ? 'text-slate-300' : 'text-slate-500'}`}>{l.text}</p>
      ))}
    </div>
  )
}

export function FleetJobCard({ job, onChanged, compact = false }: { job: FleetJob; onChanged: () => void; compact?: boolean }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'retry' | 'dismiss' | ''>('')
  const [open, setOpen] = useState(job.status === 'failed')
  const wasFailed = useRef(job.status === 'failed')
  // a build that fails opens by itself: the reason is what the person needs to see
  useEffect(() => { if (job.status === 'failed' && !wasFailed.current) setOpen(true); wasFailed.current = job.status === 'failed' }, [job.status])
  // GET /fleet/jobs trims every log to its last 60 lines: an open card reads the whole job, and again as the build moves on
  const [full, setFull] = useState<FleetJob | null>(null)
  const lastLogAt = job.log?.[job.log.length - 1]?.t ?? 0
  useEffect(() => {
    if (!open) return
    let alive = true
    fetchFleetJob(job.id).then((j) => { if (alive) setFull(j) }).catch(() => { /* the trimmed log stays */ })
    return () => { alive = false }
  }, [open, job.id, job.updated_at, lastLogAt])
  const log = (full && full.id === job.id && full.updated_at >= job.updated_at ? full.log : job.log) ?? []
  const t = look(job)
  const cur = jobCurrent(job)
  const doneCount = job.steps.filter((s) => s.state === 'done').length
  const retry = async () => { setBusy('retry'); try { await retryFleetJob(job.id); onChanged() } finally { setBusy('') } }
  const dismiss = async () => {
    // a failed build, or a by-hand install whose VM never joined, may have left a VM behind: offer to take it with the job
    // (the API destroys it on ?destroy=true in both cases)
    const leftover = !!job.vmid && (job.status === 'failed' || (!!job.manual && !job.member_id))
    let destroy = false
    if (leftover) {
      destroy = await confirm({
        title: 'Forget this build?',
        message: job.status === 'failed'
          ? `Also destroy VM #${job.vmid} on Proxmox? Cancel keeps the VM and only forgets the job.`
          : `VM #${job.vmid} never joined — also destroy it on Proxmox? Cancel keeps the VM and only forgets the build.`,
        confirmLabel: 'Destroy VM', danger: true,
      })
    }
    setBusy('dismiss')
    try { await deleteFleetJob(job.id, destroy); onChanged() } finally { setBusy('') }
  }
  const statusIcon = job.status === 'done' ? <CheckCircle2 size={20} /> : job.status === 'failed' ? <XCircle size={20} /> : job.status === 'queued' ? <Clock size={20} /> : <Loader2 size={20} className="animate-spin" />
  const title = job.kind === 'bake' ? `DCS template for ${job.template_for ?? job.image_id}` : job.stack
  const os = job.image_kind === 'iso' ? `installer ${(job.iso ?? '').split('/').pop()}` : (job.image_id && job.image_id !== 'url' && job.image_id !== 'proxmox' ? job.image_id : job.image_file)
  return (
    <div className={`${compact ? 'rounded-xl bg-white/[0.03] border border-white/5 p-3.5' : 'glass-card rounded-2xl p-4'} ${job.status === 'running' ? 'ring-1 ring-cyan-400/20' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`grid place-items-center shrink-0 rounded-xl border ${t.cls} ${compact ? 'w-9 h-9' : 'w-10 h-10'}`}>{statusIcon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-100 truncate max-w-full">{title}</p>
            {job.kind !== 'bake' && <span className="text-[11px] text-violet-300/90 inline-flex items-center gap-1"><Server size={11} />VM{job.vmid ? ` #${job.vmid}` : ''}</span>}
            {job.cloned_from ? <span className="text-[11px] text-violet-300/90">cloned from template {job.cloned_from}</span> : null}
            <Pill tone={t.tone}>{t.text}</Pill>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5 break-words">
            <span className="text-slate-300">{os}</span> · {sizeText(job)} · <span className="font-mono">{job.ip}</span>{took(job) ? ` · ${took(job)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {job.status === 'failed' && <button type="button" onClick={retry} disabled={!!busy} className={`${BTN_CARD} ${TONE_OK} font-medium`}>{busy === 'retry' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Retry</button>}
          {(job.status === 'failed' || job.status === 'done') && <Hint label="Dismiss"><button type="button" onClick={dismiss} disabled={!!busy} className={BTN_ICON_QUIET} aria-label={`Dismiss ${title}`}><Trash2 size={14} /></button></Hint>}
          <Hint label={open ? 'Hide the steps and log' : 'Show the steps and log'}><button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={BTN_ICON_QUIET} aria-label={open ? `Hide details of ${title}` : `Show details of ${title}`}><ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></button></Hint>
        </div>
      </div>

      <div className="mt-3.5 space-y-1.5">
        <StepBar job={job} />
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className={`min-w-0 break-words ${job.status === 'failed' ? 'text-rose-300' : job.status === 'done' ? 'text-emerald-300' : job.status === 'running' ? 'text-cyan-400' : 'text-slate-400'}`}>{jobStatus(job)}</span>
          {job.status !== 'queued' && <span className="text-slate-500 shrink-0 tabular-nums">{job.status === 'done' ? `${job.steps.length}/${job.steps.length}` : `${Math.min(cur + 1, job.steps.length)}/${job.steps.length}`} · {doneCount} done</span>}
        </div>
      </div>

      {job.manual && !job.member_id && job.status === 'done' && (
        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
          <p className="text-xs text-amber-300 font-medium">Finish by hand: open VM #{job.vmid} in the Proxmox console and install the system — give it {job.ip}/{job.cidr} via {job.gateway}. Then run on the VM, as a user with sudo (it installs Docker and DCS as a node of this hub and joins):</p>
          <div className="flex items-start gap-2">
            <code className="text-[11px] font-mono text-slate-200 bg-black/30 rounded-lg px-2 py-1.5 break-all flex-1 select-all">{joinLine(job)}</code>
            <CopyButton variant="chip" text={joinLine(job)} label="Copy" />
          </div>
          <p className="text-[10px] text-slate-500">The join code is valid 48 h; the build closes by itself when the VM joins.</p>
        </div>
      )}

      {open && (
        <div className="mt-3.5 pt-3.5 border-t border-white/5 grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <StepChecklist job={job} />
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Log</p>
            <LogView lines={log} />
          </div>
        </div>
      )}
    </div>
  )
}

/** The order the builds run in: the DCS template first (the VMs are cloned from it), then the VMs as they were queued */
export function orderJobs(jobs: FleetJob[]): FleetJob[] {
  return [...jobs].sort((a, b) => (a.kind === 'bake' ? 0 : 1) - (b.kind === 'bake' ? 0 : 1))
}

/** The builds at a glance: a ring with the overall progress, what is done / building / waiting / failed, the time left */
export function JobsSummary({ jobs, onChanged, compact = false, title = 'VMs being built' }: { jobs: FleetJob[]; onChanged: () => void; compact?: boolean; title?: string }) {
  const [clearing, setClearing] = useState(false)
  if (jobs.length === 0) return null
  const done = jobs.filter((j) => j.status === 'done'), failed = jobs.filter((j) => j.status === 'failed')
  const running = jobs.filter((j) => j.status === 'running'), queued = jobs.filter((j) => j.status === 'queued')
  const active = running.length + queued.length
  const vmJobs = jobs.filter((j) => j.kind !== 'bake'), templateJobs = jobs.filter((j) => j.kind === 'bake')
  // a build takes about as long as the ones that finished (or a minute and a half until one has)
  const durations = done.filter((j) => j.started_at && j.finished_at).map((j) => (j.finished_at as number) - (j.started_at as number))
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 90
  const now = Date.now() / 1000
  const runningLeft = running.reduce((a, j) => a + Math.max(10, avg - (j.started_at ? now - j.started_at : 0)), 0)
  const eta = Math.round((runningLeft + queued.length * avg) / 60)
  const pct = Math.round(((done.length + failed.length + running.reduce((a, j) => a + (j.steps.filter((s) => s.state === 'done').length / Math.max(1, j.steps.length)), 0)) / jobs.length) * 100)
  // finished builds are cleared together; a failed one and a by-hand install still waiting for its join stay (that one is
  // dismissed on its own card, which asks about the VM it left behind)
  const clearable = done.filter((j) => !(j.manual && !j.member_id))
  const clearFinished = async () => { setClearing(true); try { for (const j of clearable) await deleteFleetJob(j.id); onChanged() } finally { setClearing(false) } }
  const what = `${vmJobs.length} VM${vmJobs.length === 1 ? '' : 's'}${templateJobs.length ? ` and ${templateJobs.length === 1 ? 'a template' : `${templateJobs.length} templates`}` : ''}`
  const ringColor = failed.length && active === 0 ? C.failed : active === 0 ? C.done : C.running
  return (
    <div className={`${compact ? 'rounded-xl bg-white/[0.03] border border-white/5' : 'glass-card rounded-2xl'} px-4 py-3.5 flex items-center gap-4 flex-wrap`}>
      <RingProgress size={compact ? 58 : 64} thickness={6} roundCaps sections={[{ value: Math.max(pct, active > 0 ? 2 : 0), color: ringColor }]}
        label={<Text ta="center" fw={700} size="xs" c="dimmed" style={{ lineHeight: 1 }}>{pct}%</Text>} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Layers size={14} className="text-violet-300 shrink-0" />{active > 0 ? `Building ${what}` : failed.length ? `${what}: ${failed.length} failed` : `${what} ready`}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{title}{eta > 0 && active > 0 ? ` · about ${eta} min left` : ''}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          {([
            { n: done.length, text: 'done', tone: 'ok' },
            { n: running.length, text: 'building', tone: 'info' },
            { n: queued.length, text: 'waiting', tone: 'neutral' },
            { n: failed.length, text: 'failed', tone: 'problem' },
          ] as const).filter((c) => c.n > 0).map((c) => <Pill key={c.text} tone={c.tone} className="tabular-nums">{c.n} {c.text}</Pill>)}
        </div>
      </div>
      {clearable.length > 0 && active === 0 && (
        <button type="button" onClick={clearFinished} disabled={clearing} className={BTN_CARD_QUIET}>
          {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Clear finished
        </button>
      )}
    </div>
  )
}

export default function FleetJobsPanel({ jobs, onChanged, compact = false, title = 'VMs being built' }: { jobs: FleetJob[]; onChanged: () => void; compact?: boolean; title?: string }) {
  if (jobs.length === 0) return null
  return (
    <section className="space-y-3">
      <JobsSummary jobs={jobs} onChanged={onChanged} compact={compact} title={title} />
      <div className="space-y-2.5">
        {orderJobs(jobs).map((j) => <FleetJobCard key={j.id} job={j} onChanged={onChanged} compact={compact} />)}
      </div>
    </section>
  )
}
