// =============================================================================
// Environment — Root & per-stack .env editor with table view, validation, save
// On a hub: the hub's files or one VM's (its root .env and its stacks' .env,
// read and saved through the hub's proxy to that VM)
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { SegmentedControl } from '@mantine/core'
import { FloatingSaveBar } from '../components/common/FloatingSaveBar'
import {
  FileCode, Save, CheckCircle, AlertTriangle, RefreshCw,
  ChevronDown, Eye, EyeOff, Pencil,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON_SM, TONE_OK, TONE_QUIET, TONE_GHOST } from '../lib/ui'
import VmCapsule from '../components/fleet/VmCapsule'
import { fetchStacks } from '../api/endpoints'
import {
  fetchRootEnvScoped, saveRootEnvScoped, validateEnvScoped,
  fetchStackEnvScoped, saveStackEnvScoped,
} from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import type {
  RootEnvResponse, StackEnvResponse, StackListResponse,
  EnvValidateResponse,
} from '../../shared/types'
import { EmptyState } from '../components/common/PageState'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keys whose values should be masked in the table view */
const SENSITIVE_PATTERNS = [
  'PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'CREDENTIAL', 'AUTH',
]

function isSensitive(key: string): boolean {
  const upper = key.toUpperCase()
  return SENSITIVE_PATTERNS.some((p) => upper.includes(p))
}

function maskValue(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length)
  return value.slice(0, 2) + '*'.repeat(Math.min(value.length - 4, 16)) + value.slice(-2)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'root' | 'stack'
type ViewMode = 'table' | 'raw'

// ---------------------------------------------------------------------------
// Env Table (parsed key-value view)
// ---------------------------------------------------------------------------

/** a column header of the variables table (static: the file's own order is the point) */
const TH = 'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

/** the settings of a .env file, without its comment lines */
function envVarCount(vs?: { key: string }[]): number {
  return (vs ?? []).filter((v) => v.key).length
}

function EnvTable({
  variables,
}: {
  variables: { key: string; value: string; line: number; comment: string }[]
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const toggleReveal = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // the table lists settings: the file's comment lines (the API sends them as rows without a key) stay in the editor view
  const rows = variables.filter((v) => v.key)
  if (rows.length === 0) {
    return <EmptyState compact title="No variables found" hint="Add KEY=value lines to this .env file and they appear here." />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th scope="col" className={`${TH} text-right w-14`}>Line</th>
            <th scope="col" className={`${TH} text-left`}>Key</th>
            <th scope="col" className={`${TH} text-left`}>Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {rows.map((v) => {
            const sensitive = isSensitive(v.key)
            const isRevealed = revealed.has(v.key)
            const displayValue = sensitive && !isRevealed ? maskValue(v.value) : v.value

            return (
              <tr
                key={`${v.line}-${v.key}`}
                className="group hover:bg-white/[0.03] transition-colors duration-100"
              >
                <td className="text-right px-4 py-2 text-xs text-slate-500 font-mono tabular-nums">
                  {v.line}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-cyan-300 whitespace-nowrap">
                  {v.key}
                  {v.comment && (
                    <span className="ml-2 text-slate-500 italic text-[10px] font-sans">
                      {v.comment}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs break-all ${
                        sensitive && !isRevealed ? 'text-slate-500' : 'text-slate-200'
                      }`}
                    >
                      {displayValue || (v.key ? <span className="text-slate-500 italic">(empty)</span> : null)}
                    </span>
                    {sensitive && (
                      <Hint label={isRevealed ? 'Hide the value' : 'Show the value'}>
                        <button
                          type="button"
                          onClick={() => toggleReveal(v.key)}
                          aria-label={`${isRevealed ? 'Hide' : 'Show'} the value of ${v.key}`}
                          aria-pressed={isRevealed}
                          className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                        >
                          {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </Hint>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** the table's shape while a file is read */
function EnvSkeleton({ label }: { label: string }) {
  return (
    <div className="glass rounded-xl border border-white/5 overflow-hidden" role="status" aria-label={label}>
      <div className="px-4 py-3 border-b border-white/5"><div className="skeleton h-3 w-40 rounded" /></div>
      <div className="divide-y divide-white/[0.03]" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="px-4 py-2.5 flex items-center gap-6">
            <div className="skeleton h-3 w-6 rounded" />
            <div className="skeleton h-3 w-40 rounded" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raw Editor (textarea with line numbers gutter)
// ---------------------------------------------------------------------------

function RawEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  const lines = value.split('\n')
  const lineCount = lines.length

  return (
    <div className="relative flex rounded-lg border border-white/5 bg-slate-900/50 overflow-hidden focus-within:border-emerald-500/40 focus-within:ring-2 focus-within:ring-emerald-500/40 transition-all">
      {/* Line numbers gutter */}
      <div
        className="shrink-0 select-none py-3 pr-2 text-right border-r border-white/5 bg-slate-950/30"
        aria-hidden="true"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className="px-3 text-[11px] leading-[1.625rem] text-slate-500 font-mono tabular-nums"
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        aria-label="Contents of the .env file"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        className="
          flex-1 resize-none py-3 px-4
          bg-transparent text-sm text-slate-200
          font-mono leading-[1.625rem]
          placeholder-slate-600
          focus:outline-none
          scrollbar-thin
        "
        style={{ minHeight: `${Math.max(lineCount, 8) * 26 + 24}px` }}
        placeholder="# Enter environment variables (KEY=VALUE)"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Validation Results
// ---------------------------------------------------------------------------

function ValidationResults({ result }: { result: EnvValidateResponse }) {
  if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 animate-fade-in">
        <CheckCircle size={16} className="text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-300">Configuration is valid — no issues found</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 animate-fade-in">
      {result.errors.map((err, i) => (
        <div
          key={`err-${i}`}
          className="flex items-start gap-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-2.5"
        >
          <AlertTriangle size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            {err.line > 0 && (
              <span className="text-[10px] font-mono text-rose-500 mr-2">Line {err.line}</span>
            )}
            <span className="text-sm text-rose-400">{err.message}</span>
          </div>
        </div>
      ))}
      {result.warnings.map((warn, i) => (
        <div
          key={`warn-${i}`}
          className="flex items-start gap-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2.5"
        >
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            {warn.line > 0 && (
              <span className="text-[10px] font-mono text-amber-500 mr-2">Line {warn.line}</span>
            )}
            <span className="text-sm text-amber-400">{warn.message}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Environment() {
  const isConnected = useConnectionStore((s) => s.status) === 'connected'
  const { addToast } = useToast()
  const confirm = useConfirm()

  // .env files live on one server: the hub or one VM (Everywhere reads as the hub here)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const pageScope = scope === 'all' ? 'hub' : scope
  const member = pageScope === 'hub' ? null : scopeMember
  const whereLabel = hasFleet ? (member ? `VM ${memberName}` : 'the hub') : ''

  // Tabs
  const [activeTab, setActiveTab] = useState<TabId>('root')
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  // ---- Root .env state ----
  const [rootRaw, setRootRaw] = useState('')
  const [rootOriginal, setRootOriginal] = useState('')
  const [rootSaving, setRootSaving] = useState(false)
  const [rootValidating, setRootValidating] = useState(false)
  const [rootValidation, setRootValidation] = useState<EnvValidateResponse | null>(null)

  const fetchScopedRoot = useCallback(() => fetchRootEnvScoped(member), [member])
  const {
    data: rootEnvData,
    loading: rootLoading,
    refresh: refreshRoot,
  } = usePolling<RootEnvResponse>(fetchScopedRoot, 60000, {
    enabled: isConnected && activeTab === 'root',
  })

  useEffect(() => {
    if (rootEnvData) {
      setRootRaw(rootEnvData.raw)
      setRootOriginal(rootEnvData.raw)
      setRootValidation(null)
    }
  }, [rootEnvData])

  const rootHasChanges = rootRaw !== rootOriginal

  const handleRootValidate = useCallback(async () => {
    setRootValidating(true)
    try {
      const result = await validateEnvScoped(member, rootRaw)
      setRootValidation(result)
    } catch (err) {
      addToast({
        type: 'error',
        message: `Validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    } finally {
      setRootValidating(false)
    }
  }, [rootRaw, addToast, member])

  const handleRootSave = useCallback(async () => {
    setRootSaving(true)
    try {
      const result = await saveRootEnvScoped(member, rootRaw)
      if (result.success) {
        setRootOriginal(rootRaw)
        setRootValidation(null)
        addToast({ type: 'success', message: `Root .env saved${whereLabel ? ` on ${whereLabel}` : ''} (backup created)` })
        setTimeout(refreshRoot, 500)
      } else {
        addToast({ type: 'error', message: result.message || 'Could not save' })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: `Could not save: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    } finally {
      setRootSaving(false)
    }
  }, [rootRaw, addToast, refreshRoot, member, whereLabel])

  // ---- Stack .env state ----
  const [selectedStack, setSelectedStack] = useState('')
  const [stackRaw, setStackRaw] = useState('')
  const [stackOriginal, setStackOriginal] = useState('')
  const [stackSaving, setStackSaving] = useState(false)
  const [stackEnvData, setStackEnvData] = useState<StackEnvResponse | null>(null)
  const [stackEnvLoading, setStackEnvLoading] = useState(false)
  const [stackEnvEmpty, setStackEnvEmpty] = useState(false)
  const [stackViewMode, setStackViewMode] = useState<ViewMode>('table')

  // a VM's own list through the proxy; the hub's list minus the stacks its VMs run
  const fetchScopedStacks = useCallback(() => fetchStacks(member), [member])
  const {
    data: stacksData,
    loading: stacksLoading,
    refresh: refreshStacks,
  } = usePolling<StackListResponse>(fetchScopedStacks, 60000, {
    enabled: isConnected && activeTab === 'stack',
  })

  const stacks = (stacksData?.stacks ?? []).filter((s) => member ? true : s.placement !== 'vm')

  // another server: its own files, nothing carried over
  const memberRef = useRef(member)
  useEffect(() => {
    if (memberRef.current === member) return
    memberRef.current = member
    setSelectedStack('')
    setRootValidation(null)
    refreshRoot()
    refreshStacks()
  }, [member, refreshRoot, refreshStacks])

  // Fetch stack env when selection changes
  useEffect(() => {
    if (!selectedStack) {
      setStackEnvData(null)
      setStackRaw('')
      setStackOriginal('')
      setStackEnvEmpty(false)
      return
    }

    let mounted = true
    setStackEnvLoading(true)
    setStackEnvEmpty(false)

    fetchStackEnvScoped(member, selectedStack)
      .then((data) => {
        if (!mounted) return
        setStackEnvData(data)
        setStackRaw(data.raw)
        setStackOriginal(data.raw)
        setStackEnvEmpty(!data.raw && data.variables.length === 0)
      })
      .catch(() => {
        if (!mounted) return
        setStackEnvData(null)
        setStackRaw('')
        setStackOriginal('')
        setStackEnvEmpty(true)
      })
      .finally(() => {
        if (mounted) setStackEnvLoading(false)
      })

    return () => { mounted = false }
  }, [selectedStack, member])

  const stackHasChanges = stackRaw !== stackOriginal

  const handleStackSave = useCallback(async () => {
    if (!selectedStack) return
    setStackSaving(true)
    try {
      const result = await saveStackEnvScoped(member, selectedStack, stackRaw)
      if (result.success) {
        setStackOriginal(stackRaw)
        addToast({ type: 'success', message: `${selectedStack} .env saved${whereLabel ? ` on ${whereLabel}` : ''}` })
      } else {
        addToast({ type: 'error', message: result.message || 'Could not save' })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: `Could not save: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    } finally {
      setStackSaving(false)
    }
  }, [selectedStack, stackRaw, addToast, member, whereLabel])

  // switching servers with unsaved edits: ask first (the editor is emptied for the other server's file)
  const hasChanges = (activeTab === 'root' && rootHasChanges) || (activeTab === 'stack' && stackHasChanges)
  const handleScopeChange = useCallback(async (next: string) => {
    if (next === pageScope) return
    if (hasChanges) {
      const ok = await confirm({ title: 'Discard unsaved changes?', message: 'The .env you are editing has unsaved changes. Switching to another server drops them.', confirmLabel: 'Discard and switch', danger: true })
      if (!ok) return
    }
    setScope(next)
  }, [pageScope, hasChanges, confirm, setScope])

  const stackRefreshing = activeTab === 'stack' && stackEnvLoading
  const refreshing = (activeTab === 'root' && rootLoading) || stackRefreshing
  const refreshCurrent = activeTab === 'root' ? refreshRoot : () => {
    if (selectedStack) {
      setStackEnvLoading(true)
      fetchStackEnvScoped(member, selectedStack)
        .then((data) => {
          setStackEnvData(data)
          setStackRaw(data.raw)
          setStackOriginal(data.raw)
        })
        .finally(() => setStackEnvLoading(false))
    }
  }

  /** the Table / Editor switch of a file */
  const viewSwitch = (value: ViewMode, onChange: (v: ViewMode) => void, label: string) => (
    <SegmentedControl
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as ViewMode)}
      data={[
        { value: 'table', label: <span className="flex items-center gap-1.5"><Eye size={12} aria-hidden />Table</span> },
        { value: 'raw', label: <span className="flex items-center gap-1.5"><Pencil size={12} aria-hidden />Editor</span> },
      ]}
    />
  )

  /** a Save button: emerald while there is something to save */
  const saveButton = (changes: boolean, saving: boolean, onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={saving || !changes} className={`${BTN_TOOLBAR} ${changes ? TONE_OK : TONE_QUIET} disabled:cursor-not-allowed`}>
      {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
      {saving ? 'Saving…' : 'Save'}
    </button>
  )

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="environment"
        badge={member ? <VmCapsule member={member} name={memberName} vmid={scopeMembers.find((m) => m.id === member)?.vmid} /> : undefined}
        subtitle={hasFleet ? `The root and per-stack .env files on ${whereLabel}` : undefined}
        actions={
          <button type="button" aria-label="Refresh" onClick={refreshCurrent} disabled={refreshing} className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      >
        {hasFleet && <FleetScopeChips scope={pageScope} members={scopeMembers} onChange={(s) => void handleScopeChange(s)} label=".env of" busy={rootLoading && !!rootEnvData} everywhere={false} />}
      </PageHeader>

      {/* Which file: the root .env or a stack's */}
      <SegmentedControl
        fullWidth
        aria-label="Which .env file"
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabId)}
        data={[
          { value: 'root', label: <span className="flex items-center justify-center gap-2 py-1"><FileCode size={16} aria-hidden />Root .env</span> },
          { value: 'stack', label: <span className="flex items-center justify-center gap-2 py-1"><FileCode size={16} aria-hidden />Stack .env</span> },
        ]}
      />

      {/* ================================================================= */}
      {/* Root .env                                                         */}
      {/* ================================================================= */}
      {activeTab === 'root' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {viewSwitch(viewMode, setViewMode, 'View of the root .env')}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleRootValidate} disabled={rootValidating || rootLoading} className={BTN_TOOLBAR_QUIET}>
                {rootValidating ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Validate
              </button>
              {saveButton(rootHasChanges, rootSaving, handleRootSave)}
            </div>
          </div>

          {/* Validation results */}
          {rootValidation && <ValidationResults result={rootValidation} />}

          {/* Loading: the shape of the table */}
          {rootLoading && !rootEnvData && <EnvSkeleton label="Reading the root .env" />}

          {/* Content */}
          {rootEnvData && (
            <div className="glass rounded-xl border border-white/5 overflow-hidden">
              {viewMode === 'table' ? (
                <EnvTable variables={rootEnvData.variables} />
              ) : (
                <div className="p-4">
                  <RawEditor
                    value={rootRaw}
                    onChange={(v) => {
                      setRootRaw(v)
                      setRootValidation(null)
                    }}
                  />
                </div>
              )}

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-white/5">
                <span className="text-[11px] text-slate-500 font-mono">
                  {envVarCount(rootEnvData.variables)} variable{envVarCount(rootEnvData.variables) !== 1 ? 's' : ''}{whereLabel ? ` · root .env on ${whereLabel}` : ''}
                </span>
                {rootHasChanges && (
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
                    Unsaved changes
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* A stack's .env                                                    */}
      {/* ================================================================= */}
      {activeTab === 'stack' && (
        <div className="space-y-4">
          {/* Stack selector + toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div className="relative flex-1 sm:max-w-sm">
              <select
                aria-label="Stack"
                value={selectedStack}
                onChange={(e) => setSelectedStack(e.target.value)}
                disabled={stacksLoading && stacks.length === 0}
                className="w-full appearance-none h-[34px] rounded-lg bg-white/5 border border-white/10 pl-3 pr-9 text-xs font-medium text-slate-200 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50"
              >
                <option value="" className="bg-slate-900 text-slate-400">
                  {stacksLoading && stacks.length === 0 ? 'Loading stacks…' : stacks.length === 0 ? `No stacks${whereLabel ? ` on ${whereLabel}` : ''}` : `Select a stack${whereLabel ? ` on ${whereLabel}` : ''}…`}
                </option>
                {stacks.map((s) => (
                  <option key={s.name} value={s.name} className="bg-slate-900 text-slate-200">
                    {s.name}
                    {!s.has_env ? ' (no .env)' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                aria-hidden
              />
            </div>

            {/* Actions (when a stack is selected) */}
            {selectedStack && (
              <div className="flex items-center gap-2">
                {viewSwitch(stackViewMode, setStackViewMode, `View of the .env of ${selectedStack}`)}
                {saveButton(stackHasChanges, stackSaving, handleStackSave)}
              </div>
            )}
          </div>

          {/* No stack selected */}
          {!selectedStack && (
            <div className="glass rounded-xl border border-white/5">
              <EmptyState
                icon={<FileCode size={32} />}
                title="Select a stack from the list to view its environment variables"
              />
            </div>
          )}

          {/* Loading stack env */}
          {selectedStack && stackEnvLoading && <EnvSkeleton label={`Reading the .env of ${selectedStack}`} />}

          {/* No .env file: the next step is the editor, where one can be written */}
          {selectedStack && !stackEnvLoading && stackEnvEmpty && stackViewMode === 'table' && (
            <div className="glass rounded-xl border border-white/5">
              <EmptyState
                icon={<FileCode size={32} />}
                title="No .env file"
                hint="This stack does not have an .env file. Open the editor to create one."
                action={
                  <button type="button" onClick={() => setStackViewMode('raw')} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                    <Pencil size={14} />
                    Open the editor
                  </button>
                }
              />
            </div>
          )}

          {/* Stack env content */}
          {selectedStack && !stackEnvLoading && (stackEnvData || stackEnvEmpty) && !(stackEnvEmpty && stackViewMode === 'table') && (
            <div className="glass rounded-xl border border-white/5 overflow-hidden">
              {stackViewMode === 'table' ? (
                <EnvTable variables={stackEnvData?.variables ?? []} />
              ) : (
                <div className="p-4">
                  <RawEditor
                    value={stackRaw}
                    onChange={setStackRaw}
                  />
                </div>
              )}

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-white/5">
                <span className="text-[11px] text-slate-500 font-mono">
                  {envVarCount(stackEnvData?.variables)} variable{envVarCount(stackEnvData?.variables) !== 1 ? 's' : ''}
                  {' '}&middot; {selectedStack}{whereLabel ? ` on ${whereLabel}` : ''}
                </span>
                {stackHasChanges && (
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
                    Unsaved changes
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <FloatingSaveBar
        hasChanges={(activeTab === 'root' && rootHasChanges) || (activeTab === 'stack' && stackHasChanges)}
        onSave={activeTab === 'root' ? handleRootSave : handleStackSave}
        onDiscard={() => {
          if (activeTab === 'root') { setRootRaw(rootOriginal); setRootValidation(null) }
          else { setStackRaw(stackOriginal) }
        }}
        saving={activeTab === 'root' ? rootSaving : stackSaving}
        savingLabel="Saving…"
      />
    </div>
  )
}
