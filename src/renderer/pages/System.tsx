// =============================================================================
// System — system info, Docker disk usage and maintenance
// On a hub: the hub's own facts or one VM's (through the hub's proxy). OS
// updates on a VM the hub built run unattended: its API has passwordless sudo.
// =============================================================================

import { fetchSystemInfo, terminalAuth, runImagePrune } from '../api/endpoints'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Cpu,
  HardDrive,
  Server,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Wrench,
  Download,
  Lock,
  User,
  Eye,
  EyeOff,
  Package,
  Shield,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import {
  fetchSudoReadyScoped, runDockerPruneScoped, checkOsUpdatesScoped, applyOsUpdatesScoped, getOsUpdateStatusScoped, fetchOsUpdatesScoped,
} from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { useSystemStore } from '../stores/systemStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ApiError } from '../api/client'
import type { SystemInfo, DockerDiskUsage, OsUpdateCheckResponse, OsUpdatesInfo } from '../../shared/types'
import { ago } from '../components/fleet/fleetShared'
import { plural } from '../lib/needs'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { Panel } from '../components/dashboard/cardShared'
import { BTN_CARD_QUIET, BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK } from '../lib/ui'
import { readTerminalSession, saveTerminalSession, forgetTerminalSession } from '../lib/terminalSession'

import { INPUT_ICON } from '../lib/fieldStyles'
import { Pill } from '../components/common/Pill'
/** which server a panel talks to: null is the hub (or a server without a fleet) */
interface ScopedProps { member: string | null; whereLabel: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMb(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb.toFixed(0)} MB`
}

/** QEMU guest agent state for a Proxmox/KVM guest, with the fix when something is missing */
function GuestAgentStatus({ ga }: { ga: { installed: boolean; active: boolean; channel: boolean } }) {
  const hint = (text: string) => <span className="block text-[11px] leading-snug text-slate-500 font-sans mt-0.5">{text}</span>
  if (ga.active && ga.channel) return <span className="text-emerald-400">Running</span>
  if (ga.active) {
    return (
      <span className="inline-block text-right max-w-[260px] text-amber-300">
        Running, no channel from the VM
        {hint('Turn on Options → QEMU Guest Agent for this VM in Proxmox, then power-cycle it')}
      </span>
    )
  }
  if (ga.installed) {
    return (
      <span className="inline-block text-right max-w-[260px] text-amber-300">
        Installed, not running
        {hint('sudo systemctl enable --now qemu-guest-agent')}
      </span>
    )
  }
  return (
    <span className="inline-block text-right max-w-[260px] text-slate-400">
      Not installed
      {hint('sudo apt install qemu-guest-agent — lets the hypervisor freeze the filesystem for consistent backups, read this VM\'s IP and shut it down cleanly')}
    </span>
  )
}

function KvRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/[0.03] last:border-b-0">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider shrink-0">{label}</span>
      <span className="text-sm text-slate-200 font-mono text-right">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Maintenance panel
// ---------------------------------------------------------------------------

function MaintenancePanel({ member, whereLabel }: ScopedProps) {
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const confirm = useConfirm()
  const [pruning, setPruning] = useState(false)
  const [imagePruning, setImagePruning] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Hide entire panel for non-admin users
  if (!isAdmin) return null

  const where = whereLabel ? ` on ${whereLabel}` : ''

  const handlePrune = async () => {
    if (!(await confirm({
      title: `Run a Docker system prune${where}?`,
      message: 'This removes all stopped containers, unused networks, dangling images and the build cache.',
      confirmLabel: 'Run system prune',
      danger: true,
    }))) return
    setPruning(true)
    setResult(null)
    try {
      const res = await runDockerPruneScoped(member)
      setResult({
        success: res.success,
        message: res.success ? `Docker system prune completed${where}` : (res.output || 'Prune failed'),
      })
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'Prune failed' })
    } finally {
      setPruning(false)
    }
  }

  const handleImagePrune = async () => {
    if (!(await confirm({
      title: `Prune unused images${where}?`,
      message: 'This removes the Docker images no container uses, to free disk space.',
      confirmLabel: 'Prune images',
      danger: true,
    }))) return
    setImagePruning(true)
    setResult(null)
    try {
      const res = await runImagePrune(member)
      setResult({
        success: res.success,
        message: res.success ? `Image prune completed${where}` : (res.output || 'Image prune failed'),
      })
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : 'Image prune failed' })
    } finally {
      setImagePruning(false)
    }
  }

  return (
    <Panel icon={Wrench} title={whereLabel ? `${pageLabel('maintenance')} · ${whereLabel}` : pageLabel('maintenance')}>
      <p className="text-xs text-slate-500 mb-4">
        Clean up unused Docker resources{where} to reclaim disk space. The {pageLabel('maintenance')} page has the full report.
      </p>

      {/* Result banner */}
      {result && (
        <div className={`
          flex items-center gap-2 rounded-lg p-3 mb-4 text-sm animate-fade-in
          ${result.success
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
          }
        `} role="status">
          {result.success ? <CheckCircle size={16} aria-hidden /> : <XCircle size={16} aria-hidden />}
          <span>{result.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handlePrune}
          disabled={pruning || imagePruning}
          className="flex items-center gap-3 surface p-4 hover:bg-white/5 hover:border-white/10 disabled:opacity-50 transition-all duration-200 text-left"
        >
          <div className="rounded-lg p-2.5 bg-rose-500/10 text-rose-400">
            {pruning ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">System prune</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Remove stopped containers, networks and the build cache</p>
          </div>
        </button>

        <button
          type="button"
          onClick={handleImagePrune}
          disabled={pruning || imagePruning}
          className="flex items-center gap-3 surface p-4 hover:bg-white/5 hover:border-white/10 disabled:opacity-50 transition-all duration-200 text-left"
        >
          <div className="rounded-lg p-2.5 bg-rose-500/10 text-rose-400">
            {imagePruning ? <Loader2 size={18} className="animate-spin" /> : <HardDrive size={18} />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Image prune</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Remove unused Docker images</p>
          </div>
        </button>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// OS package updates panel
// ---------------------------------------------------------------------------

/** what the automatic-updates setting means here, in a few words ('' when the server cannot tell) */
function autoUpdatesLine(a: OsUpdatesInfo['auto_updates'] | undefined): string {
  if (!a || a.enabled === null) return ''
  if (!a.enabled) return 'Automatic updates are off'
  const tool = a.tool ? ` (${a.tool})` : ''
  if (a.installs === false) return `Automatic updates only download or notify${tool}`
  return `Automatic ${a.security_only ? 'security ' : ''}updates are on${tool}`
}

/**
 * The server's own look at its OS updates, no sign-in needed: what waits (and how much of it is security fixes), a
 * restart that finishes installed updates, and whether the system updates itself. The server looks in the background
 * every few hours; "Look again" asks for a new look now.
 */
function OsGlance({ member }: { member: string | null }) {
  const fetchGlance = useCallback(() => fetchOsUpdatesScoped(member), [member])
  const { data, refresh } = usePolling<OsUpdatesInfo>(fetchGlance, 20000)
  const [asking, setAsking] = useState(false)
  const lookAgain = async () => {
    setAsking(true)
    try { await fetchOsUpdatesScoped(member, true) } catch { /* the next poll says how it went */ }
    finally { setAsking(false); refresh() }
  }
  if (!data || !data.supported || data.enabled === false) return null

  const security = data.security ?? 0
  const total = data.updates ?? 0
  const others = Math.max(0, total - security)
  const looking = data.checking || asking
  // the server looks again at most every five minutes on request: the button says so instead of seeming to do nothing
  const lookedJustNow = data.checked_at > 0 && Date.now() / 1000 - data.checked_at < 300
  const auto = autoUpdatesLine(data.auto_updates)
  let icon = <CheckCircle size={14} className="text-emerald-400 shrink-0" aria-hidden />
  let line: string
  if (!data.checked_at) {
    icon = <Loader2 size={14} className="text-slate-500 shrink-0 animate-spin" aria-hidden />
    line = 'Looking at the OS updates for the first time…'
  } else if (data.updates === null) {
    icon = <Package size={14} className="text-slate-500 shrink-0" aria-hidden />
    line = data.note || 'Waiting updates can’t be counted here'
  } else if (security > 0) {
    icon = <ShieldAlert size={14} className="text-amber-400 shrink-0" aria-hidden />
    line = `${plural(security, 'security update')} waiting${others ? `, and ${plural(others, 'other update')}` : ''}`
  } else if (total > 0) {
    icon = <Package size={14} className="text-cyan-400 shrink-0" aria-hidden />
    line = `${plural(total, 'update')} waiting${data.security === 0 ? ', none of them security fixes' : ''}`
  } else {
    line = 'Up to date'
  }

  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium text-slate-200 truncate">{line}</span>
        {data.package_manager && <span className="text-[11px] text-slate-500 shrink-0">via {data.package_manager}</span>}
      </div>
      {data.reboot_required === true && (
        <div className="flex items-start gap-2 text-xs text-amber-300">
          <RotateCcw size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>Restart needed to finish updates{data.reboot_reason ? `: ${data.reboot_reason}` : ''}{data.reboot_packages.length ? ` (${data.reboot_packages.slice(0, 4).join(', ')}${data.reboot_packages.length > 4 ? '…' : ''})` : ''}.</span>
        </div>
      )}
      {security > 0 && data.security_packages.length > 0 && (
        <p className="text-[11px] text-slate-500 font-mono truncate" title={data.security_packages.join(', ')}>{data.security_packages.join(', ')}</p>
      )}
      {data.check_error && <p className="text-[11px] text-amber-300/80">The last look didn’t work: {data.check_error}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span>{data.checked_at ? `Looked ${ago(data.checked_at)}` : 'Not looked yet'}{looking && data.checked_at ? ' · looking again…' : ''}</span>
        {auto && <span>· {auto}</span>}
        <button type="button" onClick={() => void lookAgain()} disabled={looking || lookedJustNow}
          title={lookedJustNow && !looking ? 'Looked less than five minutes ago' : undefined}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-50 transition-colors">
          <RefreshCw size={11} className={looking ? 'animate-spin' : ''} aria-hidden /> Look again
        </button>
      </div>
    </div>
  )
}

function OsUpdatesPanel({ member, whereLabel }: ScopedProps) {
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const where = whereLabel ? ` on ${whereLabel}` : ''

  // Auth state — store password in memory for sudo -S during session
  // (the remembered terminal session is the hub's: a VM signs in on its own)
  const [termToken, setTermToken] = useState<string | null>(() => {
    if (member) return null
    try {
      const parsed = readTerminalSession()
      if (parsed?.expiresAt && parsed.expiresAt > Date.now()) return parsed.token
      return null
    } catch { return null }
  })
  const [sudoPassword, setSudoPassword] = useState<string | null>(null)
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authing, setAuthing] = useState(false)
  const [authError, setAuthError] = useState('')

  // A VM the hub built runs its API with passwordless sudo: the server answers without a terminal token
  // (null while being asked). The hub keeps its Linux sign-in.
  const [sudoReady, setSudoReady] = useState<boolean | null>(member ? null : false)
  useEffect(() => {
    if (!member || !isAdmin) return
    let alive = true
    fetchSudoReadyScoped(member)
      .then((ready) => { if (alive) setSudoReady(ready) })
      .catch(() => { if (alive) setSudoReady(false) })
    return () => { alive = false }
  }, [member, isAdmin])
  const unattended = !!member && sudoReady === true

  // Update state
  const [updateData, setUpdateData] = useState<OsUpdateCheckResponse | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyOutput, setApplyOutput] = useState<string | null>(null)
  const [showPackages, setShowPackages] = useState(false)

  if (!isAdmin) return null

  const forgetSession = () => {
    setTermToken(null)
    setSudoPassword(null)
    if (!member) forgetTerminalSession()
  }
  // the terminal session is gone (401), or it is not enough on its own (403 "Sudo password required": a session restored
  // from the Terminal page carries no password): sign in again. The API's message has no status code in it — the error's own is read.
  const sessionRefused = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 403)

  const handleAuth = async () => {
    if (!authUsername.trim() || !authPassword) return
    setAuthing(true)
    setAuthError('')
    try {
      const res = await terminalAuth(authUsername.trim(), authPassword, member)
      if (res.success && res.token) {
        setTermToken(res.token)
        setSudoPassword(authPassword)  // Keep password in memory for sudo -S
        if (!member) {
          saveTerminalSession({ token: res.token, username: res.username, expiresAt: Date.now() + (res.expires_in * 1000) })
        }
        setAuthPassword('')
        addToast({ type: 'success', message: `Signed in as ${res.username}${where}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      const status = err instanceof ApiError ? err.status : 0
      if (status === 429) setAuthError('Too many attempts. Try again in 15 minutes.')
      else if (status === 401) setAuthError('Invalid Linux username or password.')
      else setAuthError(msg)
    } finally {
      setAuthing(false)
    }
  }

  const handleCheck = async () => {
    if (!termToken && !unattended) return
    setChecking(true)
    try {
      const res = unattended ? await checkOsUpdatesScoped(member) : await checkOsUpdatesScoped(member, termToken, sudoPassword || undefined)
      setUpdateData(res)
      if (res.available) {
        addToast({ type: 'info', message: `${res.count} package update${res.count !== 1 ? 's' : ''} available${where}` })
      } else {
        addToast({ type: 'success', message: `System is up to date${where}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Check failed'
      if (sessionRefused(err) && !unattended) forgetSession()
      addToast({ type: 'error', message: msg })
    } finally {
      setChecking(false)
    }
  }

  const handleApply = async () => {
    if (!termToken && !unattended) return
    setApplying(true)
    setApplyOutput(null)
    try {
      // Start background update
      if (unattended) await applyOsUpdatesScoped(member)
      else await applyOsUpdatesScoped(member, termToken, sudoPassword || undefined)
      addToast({ type: 'info', message: `OS update started${where} — this can take a few minutes` })

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const status = await getOsUpdateStatusScoped(member)
          if (status.status === 'complete') {
            clearInterval(pollInterval)
            setApplying(false)
            setApplyOutput(status.output || null)
            if (status.success) {
              addToast({ type: 'success', message: status.message || `System updated${where}` })
              setUpdateData(null)
            } else {
              addToast({ type: 'error', message: status.message || 'Update completed with errors' })
            }
          }
        } catch {
          // Poll failed — keep trying
        }
      }, 3000)

      // Safety timeout: stop polling after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval)
        setApplying(false)
      }, 600000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed'
      if (sessionRefused(err) && !unattended) forgetSession()
      addToast({ type: 'error', message: msg })
      setApplying(false)
    }
  }

  return (
    <Panel icon={Download} title={whereLabel ? `OS package updates · ${whereLabel}` : 'OS package updates'}>
      <OsGlance member={member} />
      {member && sudoReady === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Asking the VM whether it updates unattended…
        </div>
      ) : !termToken && !unattended ? (
        /* Not signed in: the Linux account form */
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2.5">
            <Shield size={14} className="text-cyan-400 mt-0.5 shrink-0" aria-hidden />
            <p className="text-xs text-slate-400 leading-relaxed">
              {member
                ? `This VM's API has no passwordless sudo, so a Linux account on the VM ${whereLabel.replace(/^VM /, '')} is needed to check and apply its OS updates. The password goes to that VM through the hub and is checked against its system account.`
                : 'A Linux account of this server is needed to check and apply OS updates. Your password is sent to the server and checked against its system accounts.'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type="text"
                aria-label="Linux username"
                value={authUsername}
                onChange={(e) => { setAuthUsername(e.target.value); setAuthError('') }}
                placeholder="Linux username"
                autoComplete="username"
                className={`${INPUT_ICON}`}
              />
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type={showPassword ? 'text' : 'password'}
                aria-label="Linux password"
                value={authPassword}
                onChange={(e) => { setAuthPassword(e.target.value); setAuthError('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                placeholder="Password"
                autoComplete="current-password"
                className={`${INPUT_ICON} !pr-10`}
              />
              <Hint label={showPassword ? 'Hide the password' : 'Show the password'}>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                  aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </Hint>
            </div>
          </div>
          {authError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400" role="alert">
              <XCircle size={12} aria-hidden />
              {authError}
            </div>
          )}
          <button
            type="button"
            onClick={handleAuth}
            disabled={authing || !authUsername.trim() || !authPassword}
            className={`${BTN_TOOLBAR} ${TONE_OK}`}
          >
            {authing ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            Sign in
          </button>
        </div>
      ) : (
        /* Signed in (or unattended on a VM): the update controls */
        <div className="space-y-3">
          {unattended && (
            <div className="flex items-start gap-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
              <CheckCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" aria-hidden />
              <p className="text-xs text-slate-400 leading-relaxed">
                Unattended: the VM&apos;s API runs with passwordless sudo (the hub built it that way), so no Linux sign-in is needed here.
              </p>
            </div>
          )}
          {/* Status banner */}
          {updateData ? (
            updateData.available ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Package size={14} className="text-cyan-400 shrink-0" aria-hidden />
                  <span className="text-sm font-medium text-cyan-400">{updateData.count} update{updateData.count !== 1 ? 's' : ''} available</span>
                  <span className="text-[11px] text-slate-500 truncate">via {updateData.package_manager}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPackages(!showPackages)}
                  aria-expanded={showPackages}
                  className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                >
                  {showPackages ? 'Hide' : 'Show'} packages
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5">
                <CheckCircle size={14} className="text-emerald-400" aria-hidden />
                <span className="text-sm font-medium text-emerald-400">System is up to date</span>
                <span className="text-[11px] text-slate-500">via {updateData.package_manager}</span>
              </div>
            )
          ) : (
            <p className="text-xs text-slate-500">Choose "Check for updates" to scan for available OS package updates{where}.</p>
          )}

          {/* Package list */}
          {showPackages && updateData?.packages && updateData.packages.length > 0 && (
            <div className="rounded-lg bg-slate-950/60 border border-white/5 max-h-48 overflow-y-auto scrollbar-thin">
              <div className="divide-y divide-white/[0.03]">
                {updateData.packages.map((pkg) => (
                  <div key={pkg.package} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-slate-300 font-mono truncate">{pkg.package}</span>
                    <span className="text-slate-500 font-mono text-[11px] shrink-0 ml-3">{pkg.version}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Update output log */}
          {applyOutput && (
            <div className="rounded-lg bg-slate-950/60 border border-white/5 max-h-64 overflow-y-auto scrollbar-thin">
              <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Update log</span>
              </div>
              <pre className="p-3 text-[11px] font-mono text-slate-400 leading-relaxed whitespace-pre-wrap">{applyOutput}</pre>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={handleCheck} disabled={checking || applying} className={BTN_TOOLBAR_QUIET}>
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Check for updates
            </button>
            {updateData?.available && (
              <button type="button" onClick={handleApply} disabled={applying || checking} className={`${BTN_TOOLBAR} font-semibold text-white bg-emerald-600 hover:bg-emerald-500`}>
                {applying ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {applying ? 'Updating…' : 'Apply updates'}
              </button>
            )}
            {!unattended && (
              <button type="button" onClick={() => { forgetSession(); setUpdateData(null); setApplyOutput(null) }} className={`${BTN_CARD_QUIET} ml-auto`}>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function System() {
  const setSystem = useSystemStore((s) => s.setSystem)
  const isConnected = useConnectionStore((s) => s.status) === 'connected'

  // One server at a time: the hub or one VM (Everywhere reads as the hub here)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const pageScope = scope === 'all' ? 'hub' : scope
  const member = pageScope === 'hub' ? null : scopeMember
  const whereLabel = hasFleet ? (member ? `VM ${memberName}` : 'the hub') : ''

  // a new server asks at once; the answer of the one shown before stays until it lands
  const infoKey = pollKeys.systemInfo(member)
  const { data, dataKey: infoOf, loading, error, refresh } = usePolling<SystemInfo>(() => fetchSystemInfo(member), 30000, { key: infoKey })

  // the global store describes the server the dashboard is signed in to, never a VM
  useEffect(() => {
    if (data && !member && infoOf === infoKey) setSystem(data)
  }, [data, member, setSystem, infoOf, infoKey])

  const info = data
  const diskUsage: DockerDiskUsage[] = info?.docker_disk_usage ?? []

  // "Needs your attention" opens the OS updates of one server: that server in scope, the panel in view
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  const osRef = useRef<HTMLDivElement>(null)
  const [focusOs, setFocusOs] = useState(0)
  useEffect(() => {
    if (!navigationPayload || navigationPayload.section !== 'os-updates') return
    useSettingsStore.getState().consumeNavigationPayload()
    const target = typeof navigationPayload.member === 'string' ? navigationPayload.member : 'hub'
    if (target !== pageScope) setScope(target)
    setFocusOs((n) => n + 1)
  }, [navigationPayload, pageScope, setScope])
  const infoShown = !!info
  const diskShown = diskUsage.length > 0
  useEffect(() => {
    if (!focusOs) return
    // after the panels above have their size (the system facts load first)
    const t = window.setTimeout(() => osRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
    return () => window.clearTimeout(t)
  }, [focusOs, member, infoShown, diskShown])


  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="system"
        badge={member ? <VmCapsule member={member} name={memberName} vmid={scopeMembers.find((m) => m.id === member)?.vmid} /> : undefined}
        subtitle={hasFleet ? `Resources, Docker runtime, OS updates and maintenance on ${whereLabel}` : undefined}
        actions={
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh" className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      >
        {hasFleet && <FleetScopeChips scope={pageScope} members={scopeMembers} onChange={setScope} label="Server" busy={loading && !!data} everywhere={false} />}
      </PageHeader>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-300" role="alert">
          Could not load the system information: {error.message}
        </div>
      )}

      {/* Loading: panels shaped like the ones that follow */}
      {loading && !info && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" role="status" aria-label="Loading the system information">
          {[[Server, 'Server', 5], [Cpu, 'Hardware', 3]].map(([Icon, title, rows]) => (
            <Panel key={title as string} icon={Icon as typeof Server} title={title as string}>
              <div className="space-y-3" aria-hidden>
                {Array.from({ length: rows as number }).map((_, i) => <div key={i} className="skeleton h-6" />)}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* Info cards grid */}
      {info && (
        <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
          <Panel icon={Server} title="Server">
            <KvRow label="Hostname" value={info.hostname} />
            <KvRow label="Kernel" value={info.kernel} />
            <KvRow label="Runs on" value={!info.virtualization || info.virtualization === 'unknown' ? 'Unknown' : info.virtualization === 'none' ? 'Bare metal' : `${info.virtualization} (virtual machine or container)`} />
            {info.guest_agent && (info.virtualization === 'kvm' || info.virtualization === 'qemu' || info.guest_agent.installed) && (
              <KvRow label="QEMU agent" value={<GuestAgentStatus ga={info.guest_agent} />} />
            )}
            <KvRow label="Docker version" value={info.docker_version} />
          </Panel>

          <Panel icon={Cpu} title="Hardware">
            <KvRow label="CPU cores" value={info.cpu_count} />
            <KvRow label="Total memory" value={formatMb(info.memory_total_mb)} />
            <KvRow label="Swap" value={formatMb(info.swap_total_mb)} />
          </Panel>
        </div>
      )}

      {/* Docker disk usage table */}
      {diskUsage.length > 0 && (
        <Panel flush icon={Database} title="Docker disk usage">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th scope="col" className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Type</th>
                  <th scope="col" className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Total</th>
                  <th scope="col" className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Active</th>
                  <th scope="col" className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Size</th>
                  <th scope="col" className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Reclaimable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {diskUsage.map((row) => (
                  <tr key={row.type} className="hover:bg-white/[0.03] transition-colors duration-150">
                    <td className="px-4 py-3 text-slate-200 font-medium text-xs">{row.type}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300 text-xs">{row.total}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300 text-xs">{row.active}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-300 text-xs">{row.size}</td>
                    <td className="px-4 py-3 text-right"><Pill tone="info">{row.reclaimable}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* OS package updates (a fresh panel per server: its own sign-in, its own results) */}
      <div ref={osRef} id="os-updates" className="scroll-mt-20">
        {isConnected && <OsUpdatesPanel key={`os-${member ?? 'hub'}`} member={member} whereLabel={whereLabel} />}
      </div>

      {/* Maintenance */}
      {isConnected && <MaintenancePanel key={`maint-${member ?? 'hub'}`} member={member} whereLabel={whereLabel} />}
    </div>
  )
}
