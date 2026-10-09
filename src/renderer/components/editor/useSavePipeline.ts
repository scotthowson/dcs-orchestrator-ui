// =============================================================================
// useSavePipeline — the one press of every editor: check, then save. The page
// says how to check and how to save; the pipeline runs them in order, stops at
// the first problem and keeps the result for the save bar to show.
//
//   const run = useSavePipeline({ check: () => checkCompose(text), save: () => saveCompose(text), version: text })
//   run.submit()      check, then save when the check passes (Ctrl+S, the bar's Save)
//   run.checkOnly()   check without saving (the bar's "Check only")
//   run.phase         'idle' | 'checking' | 'saving' | 'saved'
//   run.result        what the last check or save found (stale once the text changed after it)
//
// A check that finds errors stops the save. A check may pass with a question (lint errors Docker accepts: "Save
// anyway?", as the editors asked before; a deploy that replaces services): the save waits for the answer. Warnings
// never stop it.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '../common/ConfirmDialog'
import type { Problem } from './codeText'

export interface CheckOutcome {
  /** the file can be saved (the server's check passed) */
  ok: boolean
  problems: Problem[]
  /** asked before the save goes on (lint errors Docker accepts, services a deploy replaces) */
  ask?: { title: string; message: string; confirmLabel: string; declined: string }
  /** what the check says when it passes ("Docker reads the file without a problem") */
  passNote?: string
}

export type SaveOutcome = { ok: true; note?: string } | { ok: false; problems: Problem[]; title?: string }

export interface PipelineResult {
  tone: 'ok' | 'attention' | 'problem'
  title: string
  problems: Problem[]
  /** the text changed after this result */
  stale?: boolean
}

export type PipelinePhase = 'idle' | 'checking' | 'saving' | 'saved'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function useSavePipeline({ check, save, version, saveWord = 'saved' }: {
  check: () => Promise<CheckOutcome>
  save: () => Promise<SaveOutcome>
  /** the text being edited: a change marks the last result stale */
  version: string
  /** the past tense of the primary action ("saved", "deployed") for the result's words */
  saveWord?: string
}) {
  const confirm = useConfirm()
  const [phase, setPhase] = useState<PipelinePhase>('idle')
  const [result, setResult] = useState<PipelineResult | null>(null)
  const versionAt = useRef<string | null>(null)
  const busy = useRef(false)
  const savedTimer = useRef<number | undefined>(undefined)

  // a result older than the text is kept (the list is what one fixes from) but said to be stale
  useEffect(() => {
    if (result && versionAt.current !== null && versionAt.current !== version && !result.stale) setResult({ ...result, stale: true })
  }, [version, result])
  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  const failed = (title: string, problems: Problem[]): PipelineResult => ({ tone: 'problem', title, problems })

  const runCheck = useCallback(async (): Promise<CheckOutcome | null> => {
    setPhase('checking')
    versionAt.current = version
    try {
      return await check()
    } catch (err) {
      setResult(failed('The check did not run — nothing was ' + saveWord, [{ severity: 'error', message: err instanceof Error ? err.message : 'The check failed' }]))
      setPhase('idle')
      return null
    }
  }, [check, version, saveWord])

  const checkOnly = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const c = await runCheck()
      if (!c) return
      const errors = c.problems.filter((p) => p.severity === 'error')
      const warnings = c.problems.filter((p) => p.severity === 'warning')
      if (!c.ok || errors.length) setResult(failed(`${plural(errors.length || 1, 'problem')} to fix`, c.problems))
      else setResult({ tone: warnings.length || c.ask ? 'attention' : 'ok', title: c.passNote ?? 'Checked: no problems', problems: c.problems })
      setPhase('idle')
    } finally {
      busy.current = false
    }
  }, [runCheck])

  const submit = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      setResult(null)
      const c = await runCheck()
      if (!c) return
      const errors = c.problems.filter((p) => p.severity === 'error')
      if (!c.ok || (errors.length && !c.ask)) {
        setResult(failed(`${plural(errors.length || 1, 'problem')} to fix — nothing was ${saveWord}`, c.problems))
        setPhase('idle')
        return
      }
      if (c.ask) {
        const { declined, ...q } = c.ask
        if (!(await confirm({ ...q, danger: true }))) {
          setResult({ tone: 'attention', title: declined, problems: c.problems })
          setPhase('idle')
          return
        }
      }
      setPhase('saving')
      let s: SaveOutcome
      try {
        s = await save()
      } catch (err) {
        s = { ok: false, problems: [{ severity: 'error', message: err instanceof Error ? err.message : 'The save failed' }] }
      }
      if (!s.ok) {
        setResult(failed(s.title ?? `Not ${saveWord}`, s.problems))
        setPhase('idle')
        return
      }
      setResult({ tone: 'ok', title: s.note ?? `${saveWord[0].toUpperCase()}${saveWord.slice(1)}`, problems: c.problems.filter((p) => p.severity === 'warning') })
      setPhase('saved')
      window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => { setPhase((p) => (p === 'saved' ? 'idle' : p)); setResult((r) => (r?.tone === 'ok' ? null : r)) }, 1600)
    } finally {
      busy.current = false
    }
  }, [runCheck, save, saveWord, confirm])

  const clear = useCallback(() => { setResult(null); setPhase((p) => (p === 'saved' ? 'idle' : p)) }, [])

  return { phase, result, submit, checkOnly, clear, busy: phase === 'checking' || phase === 'saving' }
}

/** the question a save asks when the dashboard's linter found errors Docker accepts (the editors asked it before) */
export function lintQuestion(errors: number, what = 'the file'): CheckOutcome['ask'] | undefined {
  if (!errors) return undefined
  return {
    title: 'Save with lint errors?',
    message: `The linter found ${plural(errors, 'error')} in ${what} (a port used twice, a port another stack holds, a line that is not KEY=value…). Save it anyway?`,
    confirmLabel: 'Save anyway',
    declined: `Not saved: ${plural(errors, 'lint error')} to look at`,
  }
}
