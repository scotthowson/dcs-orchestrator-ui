// =============================================================================
// StackFilesEditor — a stack's files in the one editor (components/editor):
// docker-compose.yml, its .env, the dashboard's labels for it and the compose
// file's saved versions. The Stacks page opens it (Edit), a stack's detail opens
// it (Compose), and a container opens it at its own service (Edit compose).
//
// Saving is one press: the server checks the file (docker compose config), the
// save follows when it passes, and what the check found is listed above the save
// bar, each problem a press away from its line. The server checks again as it
// saves (it refuses a file Docker cannot read), so a passed check and the save
// cannot disagree. A viewer reads the compose file and its history.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2, FileText, History, Loader2, Pencil, RotateCcw, Shield, Tag, AlertTriangle, ArrowLeft, Crosshair } from 'lucide-react'
import {
  fetchStackCompose, fetchStackEnv, validateStackCompose, saveStackCompose, saveStackEnv, fetchComposeHistory, fetchComposeVersion, rollbackCompose,
} from '../../api/endpoints'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { LoadingState, EmptyState, ErrorState } from '../common/PageState'
import Segmented from '../common/Segmented'
import { Pill } from '../common/Pill'
import Hint from '../common/Hint'
import { useSettingsStore } from '../../stores/settingsStore'
import { useComposeLinter, useEnvLinter } from '../../hooks/useComposeLinter'
import type { StackInfo, StackAnnotation, ComposeVersion } from '../../../shared/types'
import EditorFrame from '../editor/EditorFrame'
import CodeArea, { type CodeAreaHandle } from '../editor/CodeArea'
import SaveBar from '../editor/SaveBar'
import DiffView from '../editor/DiffView'
import EditorTools from '../editor/EditorTools'
import EditorStatus, { LintButton } from '../editor/EditorStatus'
import { useSavePipeline, lintQuestion, type CheckOutcome, type SaveOutcome } from '../editor/useSavePipeline'
import { changeSummary, changedServices, changesMeaning, diffLines, problemsFrom, serviceBlocks, type Problem } from '../editor/codeText'
import { BTN_CARD, BTN_TOOLBAR, TONE_QUIET } from '../../lib/ui'
import { INPUT, LABEL, HINT } from '../../lib/fieldStyles'
import { TONE_TEXT } from '../../lib/tone'
import { CountBadge } from './LintParts'

type TabId = 'compose' | 'env' | 'labels' | 'history'

export interface StackFilesEditorProps {
  stackName: string
  /** the stack as the list knows it (its state beside the title, its labels) */
  stack?: StackInfo
  isAdmin: boolean
  /** a container's Edit compose: the editor opens at this service */
  initialService?: string
  /** the compose file already read (a stack's detail reads it before it opens the editor) */
  initialContent?: string
  /** the Labels tab (the Stacks page's editor) */
  withLabels?: boolean
  onClose: () => void
  onSaved?: () => void
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

function prettyName(name: string): string {
  return name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  if (names.length > 4) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** the dashboard's linter's findings as problems with their lines */
function lintProblems(diags: { line: number; severity: string; message: string }[]): Problem[] {
  return diags.filter((d) => d.severity === 'error' || d.severity === 'warning')
    .map((d) => ({ severity: d.severity === 'error' ? 'error' as const : 'warning' as const, message: d.message, line: d.line }))
}

const PRIORITIES: { value: NonNullable<StackAnnotation['priority']>; label: string; tone: 'problem' | 'attention' | 'neutral'; icon: typeof Shield }[] = [
  { value: 'critical', label: 'Critical', tone: 'problem', icon: Shield },
  { value: 'high', label: 'High', tone: 'attention', icon: AlertTriangle },
  { value: 'normal', label: 'Normal', tone: 'neutral', icon: Tag },
  { value: 'low', label: 'Low', tone: 'neutral', icon: Tag },
]

export default function StackFilesEditor({ stackName, stack, isAdmin, initialService, initialContent, withLabels = false, onClose, onSaved }: StackFilesEditorProps) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const code = useRef<CodeAreaHandle>(null)
  const [tab, setTab] = useState<TabId>('compose')
  const [showDiff, setShowDiff] = useState(false)
  const [caret, setCaret] = useState<{ line: number; col: number } | null>(null)
  const [barH, setBarH] = useState(0)

  // ---- the compose file ----------------------------------------------------
  const [composeSaved, setComposeSaved] = useState(initialContent ?? '')
  const [compose, setCompose] = useState(initialContent ?? '')
  const [composeLoading, setComposeLoading] = useState(initialContent === undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadCompose = useCallback(() => {
    setComposeLoading(true)
    setLoadError(null)
    fetchStackCompose(stackName)
      .then((r) => { setComposeSaved(r.content); setCompose(r.content) })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'The compose file could not be read'))
      .finally(() => setComposeLoading(false))
  }, [stackName])
  useEffect(() => { if (initialContent === undefined) loadCompose() }, [initialContent, loadCompose])

  // ---- the .env (an admin's to read: the server refuses it to anyone else) ----
  const [envSaved, setEnvSaved] = useState('')
  const [env, setEnv] = useState('')
  const [envState, setEnvState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [envError, setEnvError] = useState<string | null>(null)
  useEffect(() => {
    // read when its tab is first opened (as before); the linters cross-check it with the compose file from then on
    if (!isAdmin || envState !== 'idle' || tab !== 'env') return
    setEnvState('loading')
    fetchStackEnv(stackName)
      .then((r) => { setEnvSaved(r.raw); setEnv(r.raw); setEnvState('ready') })
      .catch((err) => { setEnvError(err instanceof Error ? err.message : 'The .env could not be read'); setEnvState('failed') })
  }, [isAdmin, envState, stackName, tab])

  const composeLint = useComposeLinter(compose || undefined, env || undefined)
  const envLint = useEnvLinter(env || undefined, compose || undefined)

  const composeDiff = useMemo(() => diffLines(composeSaved, compose), [composeSaved, compose])
  const envDiff = useMemo(() => diffLines(envSaved, env), [envSaved, env])
  const composeDirty = compose !== composeSaved
  const envDirty = env !== envSaved

  // ---- labels (kept in this dashboard, not on the server) ------------------
  const annotations = useSettingsStore((s) => s.stackAnnotations) ?? {}
  const annotation: StackAnnotation = annotations[stackName] ?? {}
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const [annoLabel, setAnnoLabel] = useState(annotation.label ?? '')
  const [annoPriority, setAnnoPriority] = useState<NonNullable<StackAnnotation['priority']>>(annotation.priority ?? 'normal')
  const [annoNotes, setAnnoNotes] = useState(annotation.notes ?? '')
  const labelsDirty = withLabels && (annoLabel !== (annotation.label ?? '') || annoPriority !== (annotation.priority ?? 'normal') || annoNotes !== (annotation.notes ?? ''))
  const saveLabels = useCallback(() => {
    const next = { ...annotations }
    const a: StackAnnotation = {}
    if (annoLabel.trim()) a.label = annoLabel.trim()
    if (annoPriority !== 'normal') a.priority = annoPriority
    if (annoNotes.trim()) a.notes = annoNotes.trim()
    if (Object.keys(a).length) next[stackName] = a
    else delete next[stackName]
    updateSetting('stackAnnotations', next)
    setAnnoLabel(a.label ?? '')
    setAnnoNotes(a.notes ?? '')
    addToast({ type: 'success', message: 'Labels saved' })
  }, [annotations, annoLabel, annoPriority, annoNotes, stackName, updateSetting, addToast])
  const discardLabels = () => { setAnnoLabel(annotation.label ?? ''); setAnnoPriority(annotation.priority ?? 'normal'); setAnnoNotes(annotation.notes ?? '') }

  // ---- check and save, in one press ------------------------------------------
  const checkCompose = useCallback(async (): Promise<CheckOutcome> => {
    const text = compose
    const res = await validateStackCompose(stackName, text)
    const lint = lintProblems(composeLint.diagnostics)
    const lintErrors = lint.filter((p) => p.severity === 'error').length
    if (!res.valid) return { ok: false, problems: [...problemsFrom(res.output, text), ...lint.filter((p) => p.severity === 'error')] }
    return { ok: true, problems: lint, ask: lintQuestion(lintErrors, 'docker-compose.yml'), passNote: lint.length ? `Docker reads the file · the linter has ${plural(lint.length, 'note')}` : 'Checked: Docker reads the file without a problem' }
  }, [compose, stackName, composeLint.diagnostics])
  const saveCompose = useCallback(async (): Promise<SaveOutcome> => {
    const text = compose
    const res = await saveStackCompose(stackName, text)
    // HTTP 200 with success:false is a compose file Docker refused: nothing was written
    if (!res.success) return { ok: false, title: 'Docker refused the file — nothing was saved', problems: problemsFrom(res.validation_errors || res.message || 'The check failed', text) }
    setComposeSaved(text)
    // a VM stack: the hub's copy is saved either way; pushed:false means the VM did not take it yet
    if (res.pushed === false) addToast({ type: 'warning', message: res.message, duration: 8000 })
    else addToast({ type: 'success', message: `Compose file saved for ${stackName}` })
    onSaved?.()
    return { ok: true, note: 'Saved · checked by Docker' }
  }, [compose, stackName, addToast, onSaved])
  const composeRun = useSavePipeline({ check: checkCompose, save: saveCompose, version: compose })

  const checkEnv = useCallback(async (): Promise<CheckOutcome> => {
    const lint = lintProblems(envLint.diagnostics)
    const lintErrors = lint.filter((p) => p.severity === 'error').length
    return { ok: true, problems: lint, ask: lintQuestion(lintErrors, 'the .env'), passNote: lint.length ? `The linter has ${plural(lint.length, 'note')}` : 'Checked: every line is a comment or KEY=value' }
  }, [envLint.diagnostics])
  const saveEnv = useCallback(async (): Promise<SaveOutcome> => {
    const text = env
    const res = await saveStackEnv(stackName, text)
    if (!res.success) return { ok: false, problems: [{ severity: 'error', message: res.message || 'The save failed' }] }
    setEnvSaved(text)
    if (res.pushed === false) addToast({ type: 'warning', message: res.message, duration: 8000 })
    else addToast({ type: 'success', message: `.env saved for ${stackName}` })
    onSaved?.()
    return { ok: true }
  }, [env, stackName, addToast, onSaved])
  const envRun = useSavePipeline({ check: checkEnv, save: saveEnv, version: env })

  // ---- the container's way in: open at its service -------------------------
  const blocks = useMemo(() => serviceBlocks(compose), [compose])
  const focusBlock = initialService ? blocks.find((b) => b.name === initialService) ?? null : null
  const jumped = useRef(false)
  useEffect(() => {
    if (!initialService || composeLoading || jumped.current || !focusBlock) return
    jumped.current = true
    window.setTimeout(() => code.current?.jumpTo(focusBlock.start), 60)
  }, [initialService, composeLoading, focusBlock])

  // ---- history ------------------------------------------------------------
  const [versions, setVersions] = useState<ComposeVersion[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [compare, setCompare] = useState<{ id: string; content: string } | null>(null)
  const [busyVersion, setBusyVersion] = useState<string | null>(null)
  const loadHistory = useCallback(() => {
    setHistoryError(null)
    fetchComposeHistory(stackName)
      .then((r) => setVersions(r.versions || []))
      .catch((err) => setHistoryError(err instanceof Error ? err.message : 'The history could not be read'))
  }, [stackName])
  useEffect(() => { if (tab === 'history' && versions === null && !historyError) loadHistory() }, [tab, versions, historyError, loadHistory])
  const openCompare = async (id: string) => {
    setBusyVersion(id)
    try {
      const r = await fetchComposeVersion(stackName, id)
      setCompare({ id, content: r.content })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'That version could not be read' })
    } finally {
      setBusyVersion(null)
    }
  }
  const rollback = async (id: string) => {
    if (!(await confirm({
      danger: true,
      title: 'Roll back the compose file?',
      message: `Replace the docker-compose.yml of ${stackName} with the version of ${fmtVersion(id)}? The file it replaces is kept in the history.${composeDirty ? ' Your unsaved edits are dropped.' : ''}`,
      confirmLabel: 'Roll back',
    }))) return
    setBusyVersion(id)
    try {
      const rb = await rollbackCompose(stackName, id)
      if (!rb.success) throw new Error(rb.message || 'The rollback failed')
      if (rb.pushed === false) addToast({ type: 'warning', message: rb.message, duration: 8000 })
      else addToast({ type: 'success', message: `Rolled back to ${fmtVersion(id)}` })
      const r = await fetchStackCompose(stackName)
      setComposeSaved(r.content)
      setCompose(r.content)
      setCompare(null)
      setVersions(null)
      onSaved?.()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The rollback failed' })
    } finally {
      setBusyVersion(null)
    }
  }

  // ---- what is shown ----------------------------------------------------
  const onFile = tab === 'compose' || tab === 'env'
  const file = tab === 'env' ? { text: env, set: setEnv, saved: envSaved, diff: envDiff, dirty: envDirty, run: envRun, lint: envLint.diagnostics, lang: 'env' as const, name: '.env' } :
    { text: compose, set: setCompose, saved: composeSaved, diff: composeDiff, dirty: composeDirty, run: composeRun, lint: composeLint.diagnostics, lang: 'yaml' as const, name: 'docker-compose.yml' }
  const anyDirty = composeDirty || envDirty || labelsDirty
  const dirtyWhat = [composeDirty && 'docker-compose.yml', envDirty && '.env', labelsDirty && 'the labels'].filter(Boolean).join(', ')

  const switchTab = (t: TabId) => {
    setShowDiff(false)
    setCompare(null)
    setCaret(null)
    setTab(t)
  }

  const discard = async () => {
    const n = Math.max(file.diff.added, file.diff.removed)
    if (!(await confirm({ title: 'Discard your changes?', message: `The editor goes back to the saved ${file.name}: ${plural(n, 'changed line')} ${n === 1 ? 'is' : 'are'} lost.`, confirmLabel: 'Discard changes', danger: true }))) return
    file.set(file.saved)
    file.run.clear()
    setShowDiff(false)
  }

  // what saving changes: the services whose block changed, and when the containers take it
  const running = stack ? stack.status === 'running' : true
  const detail = tab === 'compose'
    ? (() => {
      if (!changesMeaning(composeSaved, compose)) return 'Only comments and blank lines: the containers are not affected'
      const svcs = changedServices(composeSaved, compose)
      const when = running ? 'takes effect when the stack is updated (its containers are recreated)' : 'takes effect when the stack starts'
      return svcs.length ? `${listNames(svcs)}: ${when}` : `The file ${when}`
    })()
    : !changesMeaning(envSaved, env) ? 'Only comments and blank lines: the containers are not affected'
      : 'The .env takes effect when the stack is updated (its containers are recreated)'

  const lintNote = onFile && (
    <LintButton diagnostics={file.lint} onJump={(l) => { setShowDiff(false); window.setTimeout(() => code.current?.jumpTo(l), 0) }} what={file.name} />
  )

  const editable = isAdmin
  const title = annotation.label || prettyName(stackName)
  const subtitle = (
    <>
      {stackName}/{tab === 'env' ? '.env' : 'docker-compose.yml'}
      {initialService && focusBlock && tab === 'compose' && <> · opened at <span className="text-slate-400">{initialService}</span></>}
    </>
  )

  const tabOptions = [
    { value: 'compose' as const, label: <TabLabel icon={<FileCode2 size={12} />} text="Compose" dirty={composeDirty} errors={composeLint.counts.errors} warnings={composeLint.counts.warnings} /> },
    ...(isAdmin ? [{ value: 'env' as const, label: <TabLabel icon={<FileText size={12} />} text=".env" dirty={envDirty} errors={envLint.counts.errors} warnings={envLint.counts.warnings} /> }] : []),
    ...(withLabels && isAdmin ? [{ value: 'labels' as const, label: <TabLabel icon={<Tag size={12} />} text="Labels" dirty={labelsDirty} /> }] : []),
    { value: 'history' as const, label: <TabLabel icon={<History size={12} />} text="History" /> },
  ]

  const bar = onFile && editable ? (
    <SaveBar
      open={file.dirty}
      placement="panel"
      status={changeSummary(file.diff)}
      detail={detail}
      phase={file.run.phase}
      result={file.run.result}
      onJump={(l) => { setShowDiff(false); window.setTimeout(() => code.current?.jumpTo(l), 0) }}
      onDismissResult={file.run.clear}
      onCheck={file.run.checkOnly}
      secondary={{ label: 'Discard', onClick: () => void discard() }}
      primary={{ label: 'Save', busyLabel: 'Saving…', onClick: () => void file.run.submit() }}
      onHeight={setBarH}
      label={`Unsaved changes to ${file.name}`}
    />
  ) : tab === 'labels' ? (
    <SaveBar
      open={labelsDirty}
      placement="panel"
      status="The labels changed"
      detail="Kept in this dashboard: the server is not changed"
      secondary={{ label: 'Discard', onClick: discardLabels }}
      primary={{ label: 'Save', onClick: saveLabels }}
      onHeight={setBarH}
      label="Unsaved labels"
    />
  ) : null

  const onEscape = () => {
    if (code.current?.findOpen()) { code.current.closeFind(); return true }
    if (showDiff) { setShowDiff(false); return true }
    if (compare) { setCompare(null); return true }
    return false
  }

  const onSave = () => {
    if (tab === 'labels') { if (labelsDirty) saveLabels(); return }
    if (onFile && editable && file.dirty) void file.run.submit()
  }

  /** the compose file or the .env: read, failed, the diff, or the code */
  const fileBody = () => {
    const env = tab === 'env'
    if (env ? envState === 'loading' || envState === 'idle' : composeLoading) return <LoadingState label={env ? 'Reading the .env file…' : 'Reading the compose file…'} />
    if (env && envState === 'failed') return <ErrorState title="The .env could not be read" error={envError} onRetry={() => setEnvState('idle')} />
    if (!env && loadError) return <ErrorState title="The compose file could not be read" error={loadError} onRetry={loadCompose} />
    if (showDiff) return <DiffView diff={file.diff} left="Saved" right="Your edit" />
    return (
      <CodeArea
        ref={code}
        key={tab}
        value={file.text}
        onChange={file.set}
        readOnly={!editable}
        lang={file.lang}
        label={env ? '.env file' : 'Compose file'}
        diagnostics={file.lint}
        changed={file.diff.changed}
        focusBlock={env ? null : focusBlock}
        bottomInset={barH ? barH + 24 : 0}
        onCaret={(line, col) => setCaret({ line, col })}
      />
    )
  }

  /** the saved versions, or one of them next to the file */
  const historyBody = () => {
    if (compare) {
      return (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 sm:px-5 py-2 border-b border-white/5">
            <button type="button" onClick={() => setCompare(null)} className={`${BTN_CARD} ${TONE_QUIET}`}><ArrowLeft size={12} />All versions</button>
            <span className="text-xs text-slate-400 min-w-0">{fmtVersion(compare.id)} next to the file as it is saved now</span>
            {isAdmin && (
              <button type="button" onClick={() => void rollback(compare.id)} disabled={busyVersion === compare.id} className={`${BTN_CARD} ${TONE_QUIET} ml-auto`}>
                {busyVersion === compare.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}Roll back to it
              </button>
            )}
          </div>
          <DiffView diff={diffLines(compare.content, composeSaved)} left={fmtVersion(compare.id)} right="Saved now" empty="This version is the same as the saved file" />
        </div>
      )
    }
    if (historyError) return <ErrorState title="The history could not be read" error={historyError} onRetry={loadHistory} />
    if (versions === null) return <LoadingState label="Reading the saved versions…" />
    if (versions.length === 0) return <EmptyState icon={<History size={28} />} title="No saved versions yet" hint="Each save keeps the file it replaces here." />
    return (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 sm:p-6">
        <p className="text-xs text-slate-500 mb-3">{plural(versions.length, 'saved version')}, the newest first. Compare one with the file, or roll back to it.</p>
        <ul className="space-y-2 max-w-3xl">
          {[...versions].reverse().map((v) => (
            <li key={v.version_id} className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-300">{fmtVersion(v.version_id, v.timestamp)}</p>
                <p className="text-[11px] text-slate-500 font-mono truncate">{v.version_id}{v.size > 0 ? ` · ${(v.size / 1024).toFixed(1)} KB` : ''}</p>
              </div>
              <button type="button" onClick={() => void openCompare(v.version_id)} disabled={busyVersion === v.version_id} aria-label={`Compare ${v.version_id} with the file`} className={`${BTN_CARD} ${TONE_QUIET}`}>
                {busyVersion === v.version_id ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}Compare
              </button>
              {isAdmin && (
                <button type="button" onClick={() => void rollback(v.version_id)} disabled={busyVersion === v.version_id} aria-label={`Roll back to ${v.version_id}`} className={`${BTN_CARD} ${TONE_QUIET}`}>
                  <RotateCcw size={12} />Roll back
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <EditorFrame
      title={title}
      subtitle={subtitle}
      icon={editable ? <Pencil size={18} /> : <FileCode2 size={18} />}
      tone="info"
      badge={stack ? <Pill tone={stack.status === 'running' ? 'ok' : 'neutral'} dot>{stack.status === 'running' ? 'Running' : 'Stopped'}</Pill> : undefined}
      tabs={<Segmented ariaLabel="File" value={tab} onChange={switchTab} options={tabOptions} />}
      tools={onFile && !(tab === 'env' && envState !== 'ready') ? (
        <>
          {initialService && focusBlock && tab === 'compose' && (
            <Hint label={`Go to the ${initialService} service`}>
              <button type="button" onClick={() => { setShowDiff(false); window.setTimeout(() => code.current?.jumpTo(focusBlock.start), 0) }} className={`${BTN_TOOLBAR} ${TONE_QUIET}`}>
                <Crosshair size={14} /><span className="hidden sm:inline">{initialService}</span>
              </button>
            </Hint>
          )}
          <EditorTools
            onFind={() => { setShowDiff(false); window.setTimeout(() => code.current?.openFind(editable), 0) }}
            diff={editable ? { on: showDiff, toggle: () => setShowDiff((d) => !d), changed: Math.max(file.diff.added, file.diff.removed) } : undefined}
            copy={file.text}
          />
        </>
      ) : undefined}
      dirty={anyDirty}
      dirtyWhat={`your changes to ${dirtyWhat}`}
      onClose={onClose}
      onSave={onSave}
      onFind={onFile ? () => { setShowDiff(false); window.setTimeout(() => code.current?.openFind(editable), 0) } : undefined}
      onEscape={onEscape}
      bar={bar}
      status={onFile ? <EditorStatus lines={file.text.split('\n').length} caret={caret} lang={tab === 'env' ? 'ENV' : 'YAML'} lint={lintNote} readOnly={!editable} /> : undefined}
    >
      {onFile && fileBody()}

      {tab === 'labels' && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 sm:p-6" style={{ paddingBottom: barH ? barH + 32 : undefined }}>
          <div className="max-w-2xl space-y-5">
            <p className={`${HINT} mt-0`}>Labels are for you: a label replaces the stack&apos;s name in the grid, the priority sets the order and how much a stack stands out, the notes are private. They are kept in this dashboard and do not change the server.</p>
            <div>
              <label htmlFor="stack-label" className={LABEL}>Custom label</label>
              <input id="stack-label" value={annoLabel} onChange={(e) => setAnnoLabel(e.target.value)} placeholder="A display name…" className={INPUT} />
            </div>
            <div>
              <p id="stack-priority" className={LABEL}>Priority</p>
              <div role="group" aria-labelledby="stack-priority" className="flex flex-wrap gap-2">
                {PRIORITIES.map((p) => {
                  const on = annoPriority === p.value
                  const Icon = p.icon
                  return (
                    <button key={p.value} type="button" aria-pressed={on} onClick={() => setAnnoPriority(p.value)}
                      className={`${BTN_TOOLBAR} border ${on ? `bg-white/10 border-white/20 ${TONE_TEXT[p.tone]}` : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'}`}>
                      <Icon size={12} />{p.label}
                    </button>
                  )
                })}
              </div>
              <p className={HINT}>Critical stacks sort first and get a highlighted border.</p>
            </div>
            <div>
              <label htmlFor="stack-notes" className={LABEL}>Notes</label>
              <textarea id="stack-notes" value={annoNotes} onChange={(e) => setAnnoNotes(e.target.value)} rows={5} placeholder="Settings, reminders, who looks after it…" className={`${INPUT} resize-y`} />
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && historyBody()}
    </EditorFrame>
  )
}

/** a version id is a timestamp the server wrote: shown as a date when it reads as one */
function fmtVersion(id: string, timestamp?: string): string {
  const t = timestamp ? new Date(timestamp) : null
  if (t && !Number.isNaN(t.getTime())) return `${t.toLocaleDateString()} ${t.toLocaleTimeString()}`
  return id
}

function TabLabel({ icon, text, dirty, errors = 0, warnings = 0 }: { icon: React.ReactNode; text: string; dirty?: boolean; errors?: number; warnings?: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="flex">{icon}</span>
      {text}
      <CountBadge errors={errors} warnings={warnings} />
      {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" role="img" aria-label="unsaved" />}
    </span>
  )
}
