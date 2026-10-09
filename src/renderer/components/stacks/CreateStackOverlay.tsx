// =============================================================================
// CreateStackOverlay — Full-screen glass overlay for creating a new stack
// =============================================================================

import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '@mantine/core'
import {
  X,
  Plus,
  Loader2,
  AlertTriangle,
  Sparkles,
  FileCode2,
  FileText,
  HardDrive,
} from 'lucide-react'
import { createStack, saveStackCompose, saveStackEnv, fetchDisks } from '../../api/endpoints'
import type { DiskInfo } from '../../../shared/types'
import { fmtBytes } from '../storage/StorageEverywhere'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import Hint from '../common/Hint'
import { useModalA11y } from '../../hooks/useModalA11y'
import { BTN_ICON, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_QUIET } from '../../lib/ui'

import CloseButton from '../common/CloseButton'
interface Props {
  onClose: () => void
  onCreated: () => void
}

const DEFAULT_COMPOSE = `services:
  # Define your services here
  # example:
  #   image: nginx:latest
  #   container_name: example
  #   restart: unless-stopped
  #   ports:
  #     - "8080:80"
  #   volumes:
  #     - \${APP_DATA_DIR}/example:/data
  #   environment:
  #     - TZ=\${TZ}
  #     - PUID=\${PUID}
  #     - PGID=\${PGID}
`

const DEFAULT_ENV = `# =============================================================================
# Stack Configuration
# Inherits from root .env — only add stack-specific overrides here
# =============================================================================

# Base path for persistent data (inherited from root .env)
# APP_DATA_DIR is set in the root .env file

# Domain for reverse proxy labels
# PROXY_DOMAIN is set in the root .env file

# User/Group IDs
# PUID and PGID are set in the root .env file

# Timezone
# TZ is set in the root .env file
`

export default function CreateStackOverlay({ onClose, onCreated }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const nameFieldId = useId()
  const { addToast } = useToast()

  const [stackName, setStackName] = useState('')
  const [composeContent, setComposeContent] = useState(DEFAULT_COMPOSE)
  const [envContent, setEnvContent] = useState(DEFAULT_ENV)
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // the error sits below the editor: bring it into view when it appears (a refused App-Data location was easy to miss)
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [error])
  const confirm = useConfirm()
  // where its App-Data goes: the stack's own folder (today's default), a drive DCS knows, or a path typed here
  const [adMode, setAdMode] = useState<'stack' | 'drive' | 'custom'>('stack')
  const [disks, setDisks] = useState<DiskInfo[] | null>(null)
  const [adMount, setAdMount] = useState('')
  const [adPath, setAdPath] = useState('')
  const [adEdited, setAdEdited] = useState(false)
  useEffect(() => {
    if (adMode !== 'drive' || disks) return
    fetchDisks().then((r) => {
      const list = (r.disks ?? []).filter((d) => d.mount && d.mount !== '/')
      setDisks(list)
      if (!adMount && list.length) setAdMount([...list].sort((a, b) => (b.avail_bytes ?? 0) - (a.avail_bytes ?? 0))[0].mount)
    }).catch(() => setDisks([]))
  }, [adMode, disks, adMount])

  // Auto-focus name input on mount
  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 100)
  }, [])

  // Escape closes, focus stays inside and returns to what opened it
  useModalA11y(overlayRef, onClose, { initialFocus: nameInputRef })

  // Backdrop click to close
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose],
  )

  // Sanitize stack name into a valid slug
  const sanitizedName = stackName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  // the App-Data path the stack is created with ('' = the stack's own folder)
  const suggestedPath = adMount ? `${adMount.replace(/\/+$/, '')}/.dcs/Stacks/${sanitizedName || '<stack>'}/App-Data` : ''
  const appDataPath = adMode === 'stack' ? '' : (adMode === 'drive' && !adEdited ? suggestedPath : adPath.trim())

  // Handle create
  const handleCreate = useCallback(async () => {
    if (!sanitizedName) return
    setCreating(true)
    setError(null)

    try {
      // Step 1: Create the stack directory (its App-Data on a drive of its own when one was chosen; a folder that already
      // holds files is used only once the person says so)
      let result
      try {
        result = await createStack(sanitizedName, appDataPath ? { app_data_dir: appDataPath } : undefined)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (appDataPath && /already holds files/.test(msg) && await confirm({
          title: 'Use the files already there?',
          message: `${appDataPath} already holds files. Use them as the App-Data of ${sanitizedName}?`,
          confirmLabel: 'Use them',
        })) {
          result = await createStack(sanitizedName, { app_data_dir: appDataPath, app_data_adopt: true })
        } else {
          throw e
        }
      }
      if (!result.success) {
        setError(result.message || 'Failed to create stack')
        setCreating(false)
        return
      }

      // Step 2: Save compose content if user modified it
      if (composeContent.trim() && composeContent !== DEFAULT_COMPOSE) {
        try {
          const res = await saveStackCompose(sanitizedName, composeContent)
          // HTTP 200 with success:false is a compose file Docker refused: the stack exists, the file was not written
          if (!res.success) throw new Error(res.validation_errors || res.message || 'Validation failed')
        } catch (err) {
          // Non-fatal: stack was created, compose save failed
          addToast({
            type: 'warning',
            message: `Stack created but the compose file could not be saved: ${err instanceof Error ? err.message : String(err)}`,
            duration: 6000,
          })
        }
      }

      // Step 3: Save env content if user modified it (the App-Data line the server wrote stays in it)
      if (envContent.trim() && envContent !== DEFAULT_ENV) {
        try {
          const keep = result.app_data?.path && !/^\s*APP_DATA_DIR=/m.test(envContent)
            ? `${envContent.replace(/\n*$/, '\n')}\n# This stack keeps its App-Data on a drive of its own (chosen when it was created)\nAPP_DATA_DIR="${result.app_data.path}"\n`
            : envContent
          const res = await saveStackEnv(sanitizedName, keep)
          if (!res.success) throw new Error(res.message || 'Save failed')
        } catch (err) {
          // Non-fatal
          addToast({
            type: 'warning',
            message: `Stack created but the .env file could not be saved: ${err instanceof Error ? err.message : String(err)}`,
            duration: 6000,
          })
        }
      }

      addToast({
        type: 'success',
        message: `Stack "${sanitizedName}" created successfully!`,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create stack')
    } finally {
      setCreating(false)
    }
  }, [sanitizedName, composeContent, envContent, addToast, onCreated, onClose, appDataPath, confirm])

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[6vh] animate-fade-in"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="
          relative w-full max-w-3xl mx-4
          bg-slate-900/95 backdrop-blur-2xl
          border border-white/10 rounded-2xl
          shadow-2xl shadow-black/40
          overflow-hidden animate-scale-in
          flex flex-col
          max-h-[88vh]
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-stack-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 shrink-0">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 id="create-stack-title" className="text-base font-semibold text-slate-100">
                Create stack
              </h2>
              <p className="text-xs text-slate-500">
                Set up a new Compose stack
              </p>
            </div>
          </div>
          <Hint label="Close">
            <CloseButton onClick={onClose} />
          </Hint>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-5 space-y-5">
          {/* Stack name input */}
          <div>
            <label htmlFor={nameFieldId} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Stack name
            </label>
            <input
              id={nameFieldId}
              ref={nameInputRef}
              type="text"
              value={stackName}
              onChange={(e) => {
                setStackName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && sanitizedName) handleCreate()
              }}
              placeholder="my-new-stack"
              className="
                w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl
                text-sm text-slate-200 placeholder-slate-600 font-mono
                focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20
                transition-all duration-200
              "
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2">
              <p className="text-[10px] text-slate-500">
                Use lowercase letters, numbers and hyphens
              </p>
              {sanitizedName && (
                <p className="text-[10px] text-slate-500">
                  Created as <span className="text-emerald-400 font-mono">{sanitizedName}</span>
                </p>
              )}
            </div>
          </div>

          {/* Where its App-Data goes */}
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              <HardDrive size={12} aria-hidden /> App-Data location
            </p>
            <SegmentedControl
              size="xs"
              fullWidth
              value={adMode}
              onChange={(v) => setAdMode(v as 'stack' | 'drive' | 'custom')}
              aria-label="Where the stack's App-Data goes"
              data={[
                { value: 'stack', label: "In the stack's folder" },
                { value: 'drive', label: 'On a drive' },
                { value: 'custom', label: 'Custom path' },
              ]}
            />
            {adMode === 'stack' && (
              <p className="mt-2 text-[11px] text-slate-500">
                <span className="font-mono text-slate-400">Stacks/{sanitizedName || '<stack>'}/App-Data</span>, next to its compose file — as every stack has it.
              </p>
            )}
            {adMode === 'drive' && (
              <div className="mt-2 space-y-2">
                {disks === null ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 size={11} className="animate-spin" aria-hidden /> Reading the drives…</p>
                ) : disks.length === 0 ? (
                  <p className="text-[11px] text-amber-300">No data drive is mounted besides the system disk: use a custom path, or mount the drive first.</p>
                ) : (
                  <select
                    value={adMount}
                    onChange={(e) => { setAdMount(e.target.value); setAdEdited(false) }}
                    aria-label="The drive its App-Data goes on"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/40"
                  >
                    {disks.map((d) => (
                      <option key={d.mount} value={d.mount}>
                        {d.mount}{d.fstype ? ` (${d.fstype})` : ''} — {d.avail_bytes != null ? `${fmtBytes(d.avail_bytes)} free` : `${d.available} free`}
                      </option>
                    ))}
                  </select>
                )}
                {adMount && (
                  <input
                    type="text"
                    value={adEdited ? adPath : suggestedPath}
                    onChange={(e) => { setAdEdited(true); setAdPath(e.target.value) }}
                    aria-label="The App-Data folder on that drive"
                    spellCheck={false}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/40"
                  />
                )}
              </div>
            )}
            {adMode === 'custom' && (
              <input
                type="text"
                value={adPath}
                onChange={(e) => setAdPath(e.target.value)}
                placeholder={`/mnt/disk2/.dcs/Stacks/${sanitizedName || '<stack>'}/App-Data`}
                aria-label="The full path of its App-Data folder"
                spellCheck={false}
                className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40"
              />
            )}
            {adMode !== 'stack' && (
              <p className="mt-2 text-[11px] text-slate-500">
                DCS makes the folders on the drive, backs them up with the stack, and never deletes them with the stack. While the drive is not mounted, the stack is not started.
              </p>
            )}
          </div>

          {/* Tab switcher: one choice */}
          <div className="min-w-0 max-w-full w-fit overflow-x-auto scrollbar-none">
            <SegmentedControl
              aria-label="File"
              value={activeTab}
              onChange={(v) => setActiveTab(v as 'compose' | 'env')}
              data={[
                { value: 'compose', label: <span className="flex items-center gap-1.5"><FileCode2 size={13} aria-hidden />docker-compose.yml</span> },
                { value: 'env', label: <span className="flex items-center gap-1.5"><FileText size={13} aria-hidden />.env</span> },
              ]}
            />
          </div>

          {/* Editor area */}
          <div className="rounded-xl border border-white/5 overflow-hidden bg-slate-950/60">
            {/* Editor header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-slate-900/40">
              {activeTab === 'compose' ? (
                <FileCode2 size={13} className="text-cyan-400" />
              ) : (
                <FileText size={13} className="text-cyan-400" />
              )}
              <span className="text-[11px] text-slate-400 font-mono">
                {activeTab === 'compose' ? 'docker-compose.yml' : '.env'}
              </span>
              <span className="ml-auto text-[10px] text-slate-500">
                {activeTab === 'compose' ? 'YAML' : 'ENV'}
              </span>
            </div>

            {/* Textarea */}
            <textarea
              aria-label={activeTab === 'compose' ? 'docker-compose.yml' : '.env file'}
              value={activeTab === 'compose' ? composeContent : envContent}
              onChange={(e) => {
                if (activeTab === 'compose') {
                  setComposeContent(e.target.value)
                } else {
                  setEnvContent(e.target.value)
                }
              }}
              className="
                w-full bg-transparent text-slate-200 font-mono text-sm
                p-4 resize-none focus:outline-none
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/30
                placeholder-slate-600 leading-relaxed
              "
              style={{ minHeight: '280px' }}
              spellCheck={false}
              placeholder={
                activeTab === 'compose'
                  ? 'Paste or write your docker-compose.yml here…'
                  : 'Define environment variables (KEY=value)…'
              }
            />

            {/* Editor footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-slate-900/40">
              <span className="text-[10px] text-slate-500 font-mono">
                {(activeTab === 'compose' ? composeContent : envContent).split('\n').length} lines
              </span>
              <span className="text-[10px] text-slate-500">
                {activeTab === 'compose' ? 'YAML' : 'ENV'}
              </span>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div ref={errorRef} role="alert" className="flex items-center gap-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 animate-fade-in">
              <AlertTriangle size={15} className="text-rose-400 shrink-0" />
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t border-white/5 shrink-0 bg-slate-900/50">
          <p className="hidden sm:block text-[11px] text-slate-500">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 text-slate-400 font-mono text-[10px]">Esc</kbd> to cancel
          </p>
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button onClick={onClose} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !sanitizedName || (adMode !== 'stack' && !appDataPath.startsWith('/'))}
              className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              Create stack
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
