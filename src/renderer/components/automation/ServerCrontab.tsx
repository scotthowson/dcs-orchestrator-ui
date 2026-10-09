// =============================================================================
// ServerCrontab — the Automation page's Server crontab tab: the real crontab of
// the account the DCS API runs as, on this server only (not the fleet): the
// user crontab's entries (add, edit as text, remove) and the system's, with
// what each schedule means in words. Administrators only. Mounted only while
// its tab shows, so it polls only then.
// =============================================================================

import { Fragment, useState, useMemo, useCallback, useEffect, useId, useRef } from 'react'
import { SegmentedControl } from '@mantine/core'
import {
  CalendarClock, Clock, Terminal, User, Server, Plus, Trash2, Edit3, Save, X, Search, FileText,
  AlertTriangle, Loader2, ChevronDown, ChevronRight, Copy, Check,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { usePolling } from '../../hooks/usePolling'
import { fetchCrontab, fetchSystemCrontab, updateCrontab } from '../../api/endpoints'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_OK, TONE_QUIET, TONE_GHOST, TONE_GHOST_DANGER } from '../../lib/ui'
import type { CronEntry, CrontabResponse } from '../../../shared/types'
import { EmptyState } from '../common/PageState'
import ModalOverlay from '../common/ModalOverlay'

import { INPUT, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
import { type Tone } from '../../lib/tone'
import SearchInput from '../common/SearchInput'
import CloseButton from '../common/CloseButton'
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabId = 'user' | 'system'

const PRESET_SCHEDULES: { label: string; cron: string }[] = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Daily at 3 AM', cron: '0 3 * * *' },
  { label: 'Weekly (Sun midnight)', cron: '0 0 * * 0' },
  { label: 'Monthly (1st midnight)', cron: '0 0 1 * *' },
]

/** a column header of the entries table (static) */
const TH = 'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** the user's own entries are the editable ones (emerald); the system's are neutral */
function sourceTone(source: CronEntry['source']): Tone {
  return source === 'user' ? 'ok' : 'neutral'
}

function sourceIcon(source: CronEntry['source']) {
  switch (source) {
    case 'user': return <User size={10} />
    case 'system': return <Server size={10} />
    case 'cron.d': return <FileText size={10} />
  }
}



/** the crontab's text: `crontab -l` says "no crontab for <user>" when there is none, which is not a line to keep */
function crontabText(raw: string | undefined | null): string {
  const t = raw ?? ''
  return /^no crontab for /.test(t.trim()) ? '' : t
}

/** a cron line with its whitespace evened out, to find it again by its text */
function squash(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

export default function ServerCrontab({ refreshKey, serverName }: {
  /** the page's Refresh: a new number re-reads the crontab on screen */
  refreshKey: number
  /** this server's name, for the line that says whose crontab this is */
  serverName?: string
}) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const uid = useId()

  const [activeTab, setActiveTab] = useState<TabId>('user')
  const [search, setSearch] = useState('')
  const [showRawEditor, setShowRawEditor] = useState(false)
  const [rawContent, setRawContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSchedule, setNewSchedule] = useState('0 * * * *')
  const [newCommand, setNewCommand] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  // Polling
  const { data: userData, loading: userLoading, refresh: refreshUser } = usePolling<CrontabResponse>(
    fetchCrontab, 30000, { enabled: isConnected }
  )
  const { data: systemData, loading: systemLoading, refresh: refreshSystem } = usePolling<CrontabResponse>(
    fetchSystemCrontab, 60000, { enabled: isConnected }
  )

  const data = activeTab === 'user' ? userData : systemData
  const loading = activeTab === 'user' ? userLoading : systemLoading
  const refresh = activeTab === 'user' ? refreshUser : refreshSystem
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const firstKey = useRef(refreshKey)
  useEffect(() => { if (refreshKey !== firstKey.current) refreshRef.current() }, [refreshKey])

  // Filter entries
  const entries = useMemo(() => {
    if (!data?.entries) return []
    if (!search.trim()) return data.entries
    const q = search.toLowerCase()
    return data.entries.filter(
      (e) => e.command.toLowerCase().includes(q) ||
             e.schedule.toLowerCase().includes(q) ||
             e.human_readable.toLowerCase().includes(q) ||
             (e.user && e.user.toLowerCase().includes(q))
    )
  }, [data, search])

  // Copy a schedule or a command
  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
  }, [])

  // Open raw editor
  const handleOpenRawEditor = useCallback(() => {
    setRawContent(crontabText(userData?.raw))
    setShowRawEditor(true)
  }, [userData])

  // Save raw crontab
  const handleSaveRaw = useCallback(async () => {
    setSaving(true)
    try {
      const res = await updateCrontab(rawContent)
      if (res.success) {
        addToast({ type: 'success', message: 'Crontab saved' })
        setShowRawEditor(false)
        refreshUser()
      } else {
        addToast({ type: 'error', message: res.message || 'Could not save the crontab' })
      }
    } catch {
      addToast({ type: 'error', message: 'Could not save the crontab' })
    } finally {
      setSaving(false)
    }
  }, [rawContent, addToast, refreshUser])

  // Add new cron entry
  const handleAddEntry = useCallback(async () => {
    if (!newCommand.trim()) return
    const newLine = `${newSchedule} ${newCommand}`
    const currentRaw = crontabText(userData?.raw).trim()
    const updatedRaw = (currentRaw ? currentRaw + '\n' : '') + newLine + '\n'
    setSaving(true)
    try {
      const res = await updateCrontab(updatedRaw)
      if (res.success) {
        addToast({ type: 'success', message: 'Cron entry added' })
        setShowAddForm(false)
        setNewCommand('')
        setNewSchedule('0 * * * *')
        refreshUser()
      } else {
        addToast({ type: 'error', message: res.message || 'Could not add the entry' })
      }
    } catch {
      addToast({ type: 'error', message: 'Could not add the cron entry' })
    } finally {
      setSaving(false)
    }
  }, [newSchedule, newCommand, userData, addToast, refreshUser])

  // Delete cron entry (asks first)
  const handleDeleteEntry = useCallback(async (schedule: string, command: string) => {
    const raw = crontabText(userData?.raw)
    if (!raw) return
    const ok = await confirm({
      title: 'Remove this cron entry?',
      message: `${command}\n\nIt is taken out of the user crontab and stops running.`,
      confirmLabel: 'Remove entry',
      danger: true,
    })
    if (!ok) return
    // The line itself, by its text: the row's place in the (filtered) table is not its place in the file, where
    // comments and settings such as MAILTO= sit between the jobs. Identical lines are interchangeable: the first goes.
    const lines = raw.split('\n')
    const want = squash(`${schedule} ${command}`)
    const at = lines.findIndex((line) => squash(line) === want)
    if (at < 0) {
      addToast({ type: 'error', message: 'That entry is no longer in the crontab: it changed on the server. Refreshed.' })
      refreshUser()
      return
    }
    const newLines = lines.filter((_, i) => i !== at)
    setSaving(true)
    try {
      const res = await updateCrontab(newLines.join('\n'))
      if (res.success) {
        addToast({ type: 'success', message: 'Cron entry removed' })
        refreshUser()
      } else {
        addToast({ type: 'error', message: res.message || 'Could not remove the entry' })
      }
    } catch {
      addToast({ type: 'error', message: 'Could not remove the cron entry' })
    } finally {
      setSaving(false)
    }
  }, [userData, addToast, refreshUser, confirm])


  const colCount = activeTab === 'user' ? 6 : 5

  return (
    <div className="space-y-4">
      {/* whose crontab this is: this server's, not the fleet's, and commands rather than DCS tasks */}
      <div className="glass border border-white/5 rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-start gap-3 flex-1 min-w-[14rem]">
          <span className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center justify-center shrink-0" aria-hidden><Server size={16} /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-200">{serverName ? `${serverName}'s own crontab` : "This server's own crontab"}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Commands the operating system runs on this server only (the hub and VM chips do not apply here).
              {' '}{loading && !data ? '' : `${entries.length} ${activeTab === 'user' ? 'user' : 'system'} ${entries.length === 1 ? 'entry' : 'entries'}${search ? ' match' : ''}.`}
            </p>
          </div>
        </div>
        {activeTab === 'user' && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" aria-label="Add entry" onClick={() => setShowAddForm(!showAddForm)} aria-expanded={showAddForm} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              <Plus size={14} />
              <span>Add entry</span>
            </button>
            <button type="button" aria-label="Raw editor" onClick={handleOpenRawEditor} className={BTN_TOOLBAR_QUIET}>
              <Edit3 size={14} />
              <span className="hidden sm:inline">Raw editor</span>
            </button>
          </div>
        )}
      </div>


      {/* Which crontab + search */}
      <div className="flex items-center flex-wrap gap-4">
        <SegmentedControl
          aria-label="Which crontab"
          value={activeTab}
          onChange={(v) => { setActiveTab(v as TabId); setExpandedIdx(null) }}
          data={[
            { value: 'user', label: <span className="flex items-center gap-1.5"><User size={13} aria-hidden />User crontab</span> },
            { value: 'system', label: <span className="flex items-center gap-1.5"><Server size={13} aria-hidden />System cron</span> },
          ]}
        />

        {/* Search */}
        <div className="flex-1 min-w-[12rem] relative">
          <SearchInput size="sm" value={search} onChange={setSearch} label="Filter the entries" placeholder="Filter by schedule, command or user…" />
        </div>
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleAddEntry() }}
          className="glass border border-white/5 rounded-xl p-4 animate-scale-in"
        >
          <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Plus size={14} className="text-slate-400" aria-hidden />
            New cron entry
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 mb-3">
            {/* Schedule input */}
            <div>
              <label htmlFor={`${uid}-schedule`} className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Schedule</label>
              <input
                id={`${uid}-schedule`}
                type="text"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className={`${INPUT} font-mono sm:w-48`}
                placeholder="* * * * *"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Command input */}
            <div>
              <label htmlFor={`${uid}-command`} className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Command</label>
              <input
                id={`${uid}-command`}
                type="text"
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                className={`${INPUT} font-mono`}
                placeholder="/usr/bin/my-script.sh --arg"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
          </div>

          {/* Preset schedule buttons */}
          <div className="mb-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Quick presets</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_SCHEDULES.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  aria-pressed={newSchedule === p.cron}
                  onClick={() => setNewSchedule(p.cron)}
                  className={`${CHOICE_SM} ${newSchedule === p.cron ? CHOICE_ON : CHOICE_OFF}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving || !newCommand.trim()} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add entry
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className={BTN_TOOLBAR_QUIET}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading: the table's shape */}
      {loading && !data && (
        <div className="glass border border-white/5 rounded-xl overflow-hidden" role="status" aria-label="Reading the cron entries">
          <div className="px-4 py-3 border-b border-white/5"><div className="skeleton h-3 w-48 rounded" /></div>
          <div className="divide-y divide-white/[0.03]" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-6">
                <div className="skeleton h-5 w-28 rounded" />
                <div className="skeleton h-3 w-36 rounded" />
                <div className="skeleton h-3 flex-1 max-w-sm rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && entries.length === 0 && (
        <div className="glass border border-white/5 rounded-xl">
          <EmptyState
            icon={<CalendarClock size={32} />}
            title={search ? 'No entries match your filter' : 'No cron entries found'}
            hint={search
              ? 'Try adjusting your search query or clearing the filter.'
              : activeTab === 'user'
                ? 'Add an entry here; for a DCS task at a time, make a timed rule on the Rules tab.'
                : 'System cron entries appear here once tasks are scheduled on the server.'}
            action={!search && activeTab === 'user' ? (
              <button type="button" onClick={() => setShowAddForm(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                <Plus size={14} />
                Add entry
              </button>
            ) : undefined}
          />
        </div>
      )}

      {/* Cron entries table */}
      {entries.length > 0 && (
        <div className="glass border border-white/5 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th scope="col" className={`${TH} text-left w-8`}><span className="sr-only">Details</span></th>
                  <th scope="col" className={`${TH} text-left`}>Schedule</th>
                  <th scope="col" className={`${TH} text-left`}>In words</th>
                  <th scope="col" className={`${TH} text-left`}>Command</th>
                  <th scope="col" className={`${TH} text-left`}>Source</th>
                  {activeTab === 'user' && (
                    <th scope="col" className={`${TH} text-right w-20`}>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  const open = expandedIdx === idx
                  return (
                    <Fragment key={`${idx}-${entry.schedule}-${entry.command}`}>
                      <tr className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                        {/* Expand toggle */}
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedIdx(open ? null : idx)}
                            aria-label={open ? 'Hide the details' : 'Show the details'}
                            aria-expanded={open}
                            className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>

                        {/* Schedule (monospace) */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/15 whitespace-nowrap">
                              {entry.schedule}
                            </code>
                            <Hint label="Copy the schedule">
                              <button type="button" onClick={() => handleCopy(entry.schedule, `s${idx}`)} aria-label={`Copy the schedule ${entry.schedule}`} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                                {copied === `s${idx}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                              </button>
                            </Hint>
                          </div>
                        </td>

                        {/* In words */}
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-400 flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-500 shrink-0" aria-hidden />
                            {entry.human_readable}
                          </span>
                        </td>

                        {/* Command */}
                        <td className="px-4 py-3">
                          <code className="text-xs font-mono text-slate-300 truncate block max-w-[400px]" title={entry.command}>
                            {entry.command}
                          </code>
                        </td>

                        {/* Source badge */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <Pill tone={sourceTone(entry.source)} icon={sourceIcon(entry.source)}>{entry.source}</Pill>
                          {entry.user && (
                            <span className="text-[10px] text-slate-500 ml-1.5">{entry.user}</span>
                          )}
                        </td>

                        {/* Actions (user crontab only) */}
                        {activeTab === 'user' && (
                          <td className="px-4 py-3 text-right">
                            <Hint label="Remove the entry">
                              <button
                                type="button"
                                onClick={() => handleDeleteEntry(entry.schedule, entry.command)}
                                disabled={saving}
                                aria-label={`Remove the entry ${entry.command}`}
                                className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </Hint>
                          </td>
                        )}
                      </tr>

                      {/* The details: the whole command, wrapped */}
                      {open && (
                        <tr className="border-b border-white/[0.03] bg-white/[0.02]">
                          <td colSpan={colCount} className="px-4 py-3">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Command</p>
                                <code className="block text-xs font-mono text-slate-200 whitespace-pre-wrap break-all">{entry.command}</code>
                                <p className="mt-2 text-[11px] text-slate-500">
                                  {entry.human_readable} · <span className="font-mono">{entry.schedule}</span> · {entry.source}{entry.user ? ` (${entry.user})` : ''}
                                </p>
                              </div>
                              <button type="button" onClick={() => handleCopy(entry.command, `c${idx}`)} className={`${BTN_CARD} ${TONE_QUIET}`}>
                                {copied === `c${idx}` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                Copy command
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Raw editor */}
      {showRawEditor && createPortal(
        <ModalOverlay onClose={() => setShowRawEditor(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
          <div className="w-full max-w-3xl max-h-[80vh] glass border border-white/10 rounded-2xl shadow-2xl shadow-black/40 flex flex-col animate-scale-in overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-slate-400" aria-hidden />
                <h2 className="text-sm font-semibold text-slate-200">Raw crontab editor</h2>
              </div>
              <CloseButton onClick={() => setShowRawEditor(false)} />
            </div>

            {/* Warning */}
            <div className="mx-5 mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/15">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" aria-hidden />
              <p className="text-[11px] text-amber-400/90">
                Editing the raw crontab directly. Invalid syntax may cause crontab installation to fail. Changes are applied immediately.
              </p>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-auto p-5">
              <textarea
                aria-label="Contents of the user crontab"
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                className="w-full h-full min-h-[300px] px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs font-mono text-slate-300 placeholder-slate-600 resize-none transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 leading-relaxed"
                placeholder="# min hour day month weekday command"
                spellCheck={false}
              />
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-white/5">
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                Press <kbd className="px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.03] text-[9px] font-mono text-slate-400">Esc</kbd> to close
              </span>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button type="button" onClick={() => setShowRawEditor(false)} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>
                  Cancel
                </button>
                <button type="button" onClick={handleSaveRaw} disabled={saving} className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save crontab
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>,
        document.body
      )}
    </div>
  )
}
