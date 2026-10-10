// =============================================================================
// MoveToHubSheet — a VM's stack back to the hub, with its data. The hub checks
// first (its free ports, cores and memory, room for the data, the images, the
// folders and secrets the stack uses, whether it runs it already) and every
// check is a green, amber or red row with its reason; then a confirm that says
// what stops while it moves; then the job's steps until the stack runs on the
// hub (or runs in the VM again, the job says why). The server does the work
// (POST …/move-to-hub); the sheet asks, explains and follows. The move goes on
// when the sheet is closed: the Fleet page shows the job.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, X, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { fetchMoveToHubPreflight, moveStackToHub, fetchFleetJob } from '../../api/endpoints'
import { apiErrorData, apiErrorMessage } from '../../api/errors'
import { usePolling } from '../../hooks/usePolling'
import type { FleetJob, MoveToHubCheck, MoveToHubPreflight } from '../../../shared/types'
import { BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, BTN_SHEET_DANGER } from '../../lib/ui'
import Sheet from '../common/Sheet'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { FleetJobCard } from './FleetJobsPanel'

interface Props {
  /** the member (VM) the stack runs in */
  member: string
  memberName?: string
  stack: string
  onClose: () => void
  /** the stack runs on the hub now: the page reads its lists again */
  onDone?: () => void
}

function size(kb: number): string {
  if (kb >= 1048576) return `${Math.round((kb / 1048576) * 10) / 10} GB`
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`
  return `${kb} KB`
}

function CheckRow({ c }: { c: MoveToHubCheck }) {
  const icon = c.state === 'ok' ? <Check size={14} className="text-emerald-400" /> : c.state === 'warn' ? <AlertTriangle size={14} className="text-amber-400" /> : <X size={14} className="text-rose-400" />
  const edge = c.state === 'ok' ? 'border-emerald-500/15 bg-emerald-500/[0.04]' : c.state === 'warn' ? 'border-amber-500/20 bg-amber-500/[0.06]' : 'border-rose-500/25 bg-rose-500/[0.06]'
  return (
    <li className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${edge}`}>
      <span className="mt-0.5 shrink-0" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{c.label}<span className="sr-only"> — {c.state === 'ok' ? 'passes' : c.state === 'warn' ? 'a warning' : 'fails'}</span></span>
        <span className="block text-[11px] text-slate-400 break-words">{c.detail}</span>
      </span>
    </li>
  )
}

export default function MoveToHubSheet({ member, memberName, stack, onClose, onDone }: Props) {
  const vm = memberName || 'the VM'
  const [report, setReport] = useState<MoveToHubPreflight | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkErr, setCheckErr] = useState('')
  const [start, setStart] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const check = useCallback(async () => {
    setChecking(true); setCheckErr('')
    try { setReport(await fetchMoveToHubPreflight(member, stack)) }
    catch (e) { setCheckErr(apiErrorMessage(e, 'The hub could not check the move')) }
    finally { setChecking(false) }
  }, [member, stack])
  useEffect(() => { void check() }, [check])
  // the confirm takes the focus and comes into view (on a phone it opens below the fold)
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => { confirmRef.current?.focus(); confirmRef.current?.scrollIntoView({ block: 'nearest' }) }, 0)
    return () => clearTimeout(t)
  }, [confirming])

  // the job, every two seconds while it runs (the step it is on, its log), then rarely
  const [finished, setFinished] = useState(false)
  const job = usePolling<FleetJob>(() => fetchFleetJob(jobId as string), finished ? 15000 : 2000, { key: jobId ? `fleet-job:${jobId}` : undefined, enabled: !!jobId })
  const j = job.data && job.data.id === jobId ? job.data : null
  const told = useRef(false)
  useEffect(() => {
    if (!j) return
    setFinished(j.status === 'done' || j.status === 'failed')
    if (j.status === 'done' && !told.current) { told.current = true; onDone?.() }
    if (j.status !== 'done') told.current = false
  }, [j?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const move = async () => {
    setSending(true); setSendErr('')
    try {
      const r = await moveStackToHub(member, stack, start)
      setConfirming(false); setJobId(r.job)
    } catch (e) {
      // a refusal carries the preflight as the hub sees it now: the rows say what changed
      const d = apiErrorData(e)
      if (d.preflight && typeof d.preflight === 'object') setReport(d.preflight as MoveToHubPreflight)
      setConfirming(false); setSendErr(apiErrorMessage(e, 'The move could not start'))
    } finally { setSending(false) }
  }

  const fails = report ? report.checks.filter((c) => c.state === 'fail').length : 0
  const warns = report ? report.checks.filter((c) => c.state === 'warn').length : 0
  const running = !!j && (j.status === 'running' || j.status === 'queued')
  const result = j?.result ?? null

  const footer = jobId ? (
    <div className="flex items-center gap-3">
      <p className="text-[11px] text-slate-500 flex-1 min-w-0">{running ? 'You can close this: the move goes on, the Fleet page shows it.' : ''}</p>
      <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} shrink-0`}>Close</button>
    </div>
  ) : confirming ? undefined : (
    <div className="flex gap-2">
      <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
      <button type="button" onClick={() => void check()} disabled={checking || sending} className={`${BTN_SHEET_QUIET} flex-1`}>
        {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check again
      </button>
      <button type="button" onClick={() => setConfirming(true)} disabled={!report?.movable || checking || sending} className={`${BTN_SHEET_PRIMARY} flex-1`}>
        <ArrowDownToLine size={16} /> Move to the hub
      </button>
    </div>
  )

  return (
    <Sheet tone="fleet" wide icon={<ArrowDownToLine size={18} />} onClose={onClose} keepOnBackdrop={sending || running}
      title={`Move ${stack} to the hub`}
      subtitle={<>From {vm} back to the hub, with its App-Data, its volumes and its routes</>}
      footer={footer}
    >
      {!jobId && (
        <div className="space-y-3">
          {checking && !report && (
            <div role="status" aria-live="polite" className="space-y-2">
              <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> The hub asks {vm} and checks itself…</p>
              {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-11 rounded-lg" aria-hidden />)}
            </div>
          )}
          {checkErr && <Notice tone="problem" role="alert" title="The hub could not check the move">{checkErr}</Notice>}
          {sendErr && <Notice tone="problem" role="alert" title="The move did not start">{sendErr}</Notice>}
          {report && (
            <>
              <div className="flex items-center gap-2 flex-wrap" aria-live="polite">
                {report.movable
                  ? <Pill tone="ok" dot>{warns ? `Ready, ${warns} to note` : 'Ready to move'}</Pill>
                  : <Pill tone="problem" dot>{fails} check{fails === 1 ? '' : 's'} stop{fails === 1 ? 's' : ''} the move</Pill>}
                <span className="text-[11px] text-slate-500">
                  {size(report.data_kb)} in {report.files} file{report.files === 1 ? '' : 's'}
                  {` · ${report.folders.length} folder${report.folders.length === 1 ? '' : 's'}`}
                  {` · ${report.volumes.length} volume${report.volumes.length === 1 ? '' : 's'}`}
                  {report.routes.length > 0 && ` · ${report.routes.length} route${report.routes.length === 1 ? '' : 's'}`}
                  {` · ${report.containers_up} container${report.containers_up === 1 ? '' : 's'} up in ${vm}`}
                </span>
                {checking && <Loader2 size={12} className="animate-spin text-slate-500" aria-label="Checking again" />}
              </div>
              <ul aria-label="What the hub checked" className="space-y-1.5">
                {report.checks.map((c) => <CheckRow key={c.id} c={c} />)}
              </ul>
              {(report.folders.length > 0 || report.volumes.length > 0) && (
                <p className="text-[11px] text-slate-500 break-words">
                  Copied with owners and permissions as they are: {[...report.folders.map((f) => `${f.name}${f.path ? ` (${f.path})` : ''} ${size(f.kb)}`), ...report.volumes.map((v) => `volume ${v.volume || v.name} ${size(v.kb)}`)].join(' · ')}
                </p>
              )}
              {report.movable && (
                <>
                  <ToggleRow label="Start it on the hub once its data is there" checked={start} onChange={setStart} disabled={sending}
                    help="Off: the stack becomes the hub's and stays stopped until you start it." def="on" />
                  <Notice tone="attention" title="It is down while it moves">
                    {report.downtime} {vm} keeps its copy for {report.backup_days} days (its folder and named volumes), then the hub removes it.
                  </Notice>
                </>
              )}
            </>
          )}
          {confirming && report && (
            <div role="group" aria-label="Confirm the move" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-3 animate-fade-in">
              <p className="text-xs text-amber-200">Stop <span className="font-mono">{stack}</span> on {vm} and move it to the hub now? It is down until it runs on the hub{start ? '' : ' and you start it'}. If anything fails before it runs here, it starts in {vm} again.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} disabled={sending} className={`${BTN_SHEET_QUIET} flex-1`}>Not now</button>
                <button ref={confirmRef} type="button" onClick={() => void move()} disabled={sending} className={`${BTN_SHEET_DANGER} flex-1`}>
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowDownToLine size={16} />} Stop it and move
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {jobId && (
        <div className="space-y-3">
          {!j && <p role="status" className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> The move is queued…</p>}
          {j && <FleetJobCard job={j} onChanged={() => void job.refresh()} compact />}
          {j?.status === 'done' && (
            <Notice tone="ok" role="status" title={`${stack} runs on the hub`}>
              {result?.started === false ? 'It is the hub\'s now and stopped (it was not started). ' : `${result?.containers_up ?? 0} container${result?.containers_up === 1 ? '' : 's'} up. `}
              {result?.vm_backup
                ? <>{vm} keeps its copy at <span className="font-mono break-all">{result.vm_backup.path}</span> until {new Date(result.vm_backup.expires_at * 1000).toLocaleDateString()}{result.vm_backup.volumes.length > 0 ? <> with its volumes {result.vm_backup.volumes.join(', ')}</> : null}.</>
                : null}
              {result?.hub_set_aside ? <> What the hub had of it before is set aside in <span className="font-mono break-all">{result.hub_set_aside}</span>.</> : null}
              {result?.warning ? <span className="block mt-1 text-amber-200">{result.warning}</span> : null}
            </Notice>
          )}
          {j?.status === 'failed' && (
            <Notice tone="problem" role="alert" title="The stack did not move">
              {j.error} What the move had done is undone and the stack is back in {vm} as it was (the log names each step). Retry on the card once the reason is fixed.
            </Notice>
          )}
        </div>
      )}
    </Sheet>
  )
}
