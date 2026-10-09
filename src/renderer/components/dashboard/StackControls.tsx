// =============================================================================
// StackControls — every stack with its state and the four actions, inline
// =============================================================================

import React, { useCallback, useState } from 'react'
import { Boxes, Play, Square, RotateCw, ArrowUpCircle, Loader2, ChevronRight } from 'lucide-react'
import type { StackInfo } from '../../../shared/types'
import { startStack, stopStack, restartStack, updateStack } from '../../api/endpoints'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useContainerStore } from '../../stores/containerStore'
import { pageLabel } from '../../constants/pageTitles'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import { BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER, TONE_GHOST_OK } from '../../lib/ui'
import { activityOutcome, opGerund, startedInBackground, waitForStackActivity, type StackOp } from '../../lib/stackActivity'
import { Card, CardBody } from './cardShared'
import { StackDot } from '../common/StateChip'
import { stackIsFine, stackLine, stackLineTone, stackState, STACK_META } from '../../lib/containerState'

import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
type Op = StackOp

export default function StackControls({ stacks, error, onRetry, onRefresh }: {
  stacks: StackInfo[] | null
  error?: Error | null
  onRetry?: () => void
  onRefresh?: () => void
}) {
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const refreshContainers = useContainerStore((s) => s.refresh)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(async (stack: string, op: Op) => {
    if (busy) return
    if (op === 'stop' && !(await confirm({ title: 'Stop the stack?', message: `Stop every container of ${stack}?`, confirmLabel: 'Stop', danger: true }))) return
    if (op === 'restart' && !(await confirm({ title: 'Restart the stack?', message: `Restart ${stack}?`, confirmLabel: 'Restart' }))) return
    if (op === 'update' && !(await confirm({ title: 'Update the stack?', message: `Pull the images of ${stack} and recreate what changed?`, confirmLabel: 'Update' }))) return
    setBusy(`${stack}:${op}`)
    try {
      const fn = { start: startStack, stop: stopStack, restart: restartStack, update: updateStack }[op]
      const res = await fn(stack)
      const output = (res as { output?: string }).output
      if (res.success && startedInBackground(output)) {
        // the API answered before anything ran: follow the stack's activity, then say how it ended
        addToast({ type: 'info', message: `${stack}: ${opGerund(op).toLowerCase()}…`, duration: 4000 })
        onRefresh?.()
        addToast(activityOutcome(await waitForStackActivity(stack), stack, op))
      } else {
        addToast({ type: res.success ? 'success' : 'error', message: res.success ? `${stack}: ${op} done` : `${stack}: ${op} failed — ${output || 'see the stack activity'}`, duration: res.success ? 3500 : 8000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: `${stack}: ${err instanceof Error ? err.message : 'request failed'}` })
    } finally {
      setBusy(null)
      onRefresh?.()
      void refreshContainers()
    }
  }, [busy, addToast, onRefresh, refreshContainers, confirm])

  // up: running, or asleep on demand (the first request wakes it)
  const running = stacks?.filter((s) => stackIsFine(s)).length ?? 0

  return (
    <Card card="stack-controls" meta={stacks ? `${running}/${stacks.length} up` : undefined} open="stacks" clickable={false}>
      {error && !stacks ? (
        <ErrorState card title="Could not load the stacks" error={error} onRetry={onRetry} />
      ) : stacks === null ? (
        <Skeleton label="Loading the stacks…" rows={4} />
      ) : stacks.length === 0 ? (
        <EmptyState card icon={<Boxes size={22} />} title="No stacks yet" hint={`Deploy a template or create a stack on the ${pageLabel('stacks')} page.`} />
      ) : (
        <CardBody className="space-y-1">
          {stacks.map((s) => {
            const isRunning = s.status === 'running'
            const b = (op: Op) => busy === `${s.name}:${op}`
            const spin = (op: Op, icon: React.ReactNode) => (b(op) ? <Loader2 size={13} className="animate-spin" /> : icon)
            return (
              <div key={`${s.member ?? ''}|${s.name}`} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03] transition-colors">
                <StackDot stack={s} size={8} />
                <button type="button" onClick={() => setCurrentPage('stacks', { highlight: s.name })} className="flex-1 min-w-0 text-left" title={`Open ${s.name}`}>
                  <span className="block text-xs font-medium text-slate-200 truncate font-mono">{s.name}</span>
                  <span className={`block text-[10px] ${stackLineTone(s)}`} title={STACK_META[stackState(s)].hint}>{stackLine(s)}</span>
                </button>
                {isAdmin ? (
                  <div className="flex items-center gap-0.5">
                    {!isRunning && (
                      <Hint label={stackState(s) === 'asleep' ? 'Wake it now (Sablier puts it back to sleep when idle)' : 'Start'}><button type="button" aria-label={`${stackState(s) === 'asleep' ? 'Wake' : 'Start'} ${s.name}`} onClick={() => run(s.name, 'start')} disabled={!!busy} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}>{spin('start', <Play size={12} />)}</button></Hint>
                    )}
                    {isRunning && (
                      <>
                        <Hint label="Restart"><button type="button" aria-label={`Restart ${s.name}`} onClick={() => run(s.name, 'restart')} disabled={!!busy} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>{spin('restart', <RotateCw size={12} />)}</button></Hint>
                        <Hint label="Pull the images and recreate what changed"><button type="button" aria-label={`Update ${s.name}`} onClick={() => run(s.name, 'update')} disabled={!!busy} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>{spin('update', <ArrowUpCircle size={12} />)}</button></Hint>
                        <Hint label="Stop"><button type="button" aria-label={`Stop ${s.name}`} onClick={() => run(s.name, 'stop')} disabled={!!busy} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>{spin('stop', <Square size={12} />)}</button></Hint>
                      </>
                    )}
                  </div>
                ) : (
                  <ChevronRight size={13} className="text-slate-500" aria-hidden />
                )}
              </div>
            )
          })}
        </CardBody>
      )}
    </Card>
  )
}
