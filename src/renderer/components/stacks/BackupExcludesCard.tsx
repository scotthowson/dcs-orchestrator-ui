// =============================================================================
// BackupExcludesCard — the folders and files of a stack's App-Data its backups
// leave out (a ROM library, a cache): one pattern per row, relative to the
// App-Data, kept in the stack's folder as .dcs-backup-exclude. Suggest offers the
// largest folders the server found, with their size; each saved pattern shows
// what it leaves out now. A restore never deletes what is left out, and moving the
// stack (into a VM, to another drive) still carries everything.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Archive, Plus, Sparkles, X, Loader2, RefreshCw } from 'lucide-react'
import SectionHeader from '../common/SectionHeader'
import { Pill } from '../common/Pill'
import { useToast } from '../common/Toast'
import { fetchStackBackupExcludes, saveStackBackupExcludes } from '../../api/endpoints'
import { formatBytes } from '../../api/fleetScopedOps'
import { BTN_CARD_QUIET, BTN_ICON_SM, TONE_GHOST_DANGER, BTN_TOOLBAR_PRIMARY, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { FIELD_SM, HINT } from '../../lib/fieldStyles'
import type { StackBackupExcludes } from '../../../shared/types'

/** the client's own check, the server's rule: relative, no .. part */
function patternProblem(p: string): string | null {
  if (p.startsWith('/')) return 'not a full path: relative to the App-Data'
  if (`/${p}/`.includes('/../')) return 'no ..'
  return null
}

export default function BackupExcludesCard({ stack, isAdmin }: { stack: string; isAdmin: boolean }) {
  const { addToast } = useToast()
  const [data, setData] = useState<StackBackupExcludes | null>(null)
  const [rows, setRows] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetchStackBackupExcludes(stack)
      setData(d)
      setRows(d.patterns)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [stack])
  useEffect(() => { void load() }, [load])

  const cleaned = rows.map((r) => r.trim()).filter(Boolean)
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(data?.patterns ?? [])
  const problems = cleaned.map(patternProblem)
  const max = data?.max ?? 100
  const sizeOf = (p: string) => data?.matched.find((m) => m.pattern === p)
  const suggestions = (data?.suggestions ?? []).filter((s) => !cleaned.includes(s.path))

  const save = async () => {
    if (saving || problems.some(Boolean)) return
    setSaving(true)
    try {
      await saveStackBackupExcludes(stack, cleaned)
      addToast({ type: 'success', message: cleaned.length ? `${stack}: ${cleaned.length} left out of its backups` : `${stack}: its backups take everything again` })
      await load()
    } catch (e) {
      addToast({ type: 'error', message: `Could not save: ${e instanceof Error ? e.message : String(e)}`, duration: 6000 })
    } finally { setSaving(false) }
  }

  return (
    <section className="surface p-4 md:p-5 space-y-3" aria-labelledby="backup-excludes-title" data-backup-excludes>
      <SectionHeader
        as="h3"
        id="backup-excludes-title"
        icon={Archive}
        title="Excluded from backups"
        count={cleaned.length || undefined}
        right={
          <span className="flex items-center gap-2">
            {(data?.excluded_bytes ?? 0) > 0 && <Pill tone="info" title="What the saved patterns leave out of each backup, measured now">{formatBytes(data?.excluded_bytes ?? 0)} left out</Pill>}
            <button type="button" onClick={() => void load()} disabled={loading} className={BTN_CARD_QUIET} aria-label="Measure again">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </span>
        }
      />
      <p className={HINT}>
        Folders and files of <span className="font-mono text-slate-400">App-Data</span> that this stack&apos;s backups and the recovery bundle leave out, one per row
        (wildcards work: <span className="font-mono text-slate-400">*.iso</span>). A restore never deletes them; moving the stack into a VM or to another drive still carries everything.
      </p>

      {error && <p className="text-xs text-rose-300" role="alert">Could not read them: {error}</p>}

      {rows.length === 0 && !loading && !error && (
        <p className="text-xs text-slate-500">Nothing is left out: every backup takes the whole App-Data.</p>
      )}

      <ul className="space-y-2">
        {rows.map((r, i) => {
          const m = sizeOf(r.trim())
          const problem = r.trim() ? patternProblem(r.trim()) : null
          return (
            <li key={i} className="flex items-center gap-2 min-w-0" data-exclude-row>
              <input
                value={r}
                onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                readOnly={!isAdmin}
                aria-label={`Excluded pattern ${i + 1}`}
                aria-invalid={!!problem}
                placeholder={data?.examples[0] ?? 'RomM/library'}
                className={`${FIELD_SM} flex-1 min-w-0 font-mono`}
              />
              {problem
                ? <span className="text-[11px] text-rose-300 shrink-0">{problem}</span>
                : m && <span className="text-[11px] text-slate-500 tabular-nums shrink-0" data-exclude-size>{m.size_bytes == null ? 'not measured' : `${formatBytes(m.size_bytes)} · ${m.files ?? 0} file${m.files === 1 ? "" : "s"}`}</span>}
              {isAdmin && (
                <button type="button" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${r || 'this row'}`}>
                  <X size={12} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {isAdmin && (
        <div className="flex items-center flex-wrap gap-2">
          <button type="button" onClick={() => setRows((xs) => [...xs, ''])} disabled={rows.length >= max} className={BTN_CARD_QUIET}>
            <Plus size={12} /> Add
          </button>
          <button type="button" onClick={() => setSuggestOpen((o) => !o)} disabled={loading} aria-expanded={suggestOpen} className={BTN_CARD_QUIET} data-exclude-suggest>
            <Sparkles size={12} /> Suggest
          </button>
          <span className="flex-1" />
          {dirty && <button type="button" onClick={() => setRows(data?.patterns ?? [])} disabled={saving} className={BTN_TOOLBAR_QUIET}>Undo</button>}
          <button type="button" onClick={() => void save()} disabled={!dirty || saving || problems.some(Boolean)} className={BTN_TOOLBAR_PRIMARY} data-exclude-save>
            {saving && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      )}

      {isAdmin && suggestOpen && (
        <div className="space-y-1.5" data-exclude-suggestions>
          {suggestions.length === 0
            ? <p className="text-xs text-slate-500">No large folder to suggest{data?.suggestions.length ? ' that is not already left out' : ''}.</p>
            : suggestions.map((s) => (
              <button
                key={s.path}
                type="button"
                onClick={() => setRows((xs) => [...xs.filter((x) => x.trim()), s.path])}
                className={`${BTN_CARD_QUIET} w-full justify-between`}
                data-exclude-suggestion={s.path}
              >
                <span className="font-mono truncate">{s.path}</span>
                <span className="tabular-nums text-slate-400 shrink-0">{formatBytes(s.size_bytes)}</span>
              </button>
            ))}
        </div>
      )}
    </section>
  )
}
