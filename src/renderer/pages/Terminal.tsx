// =============================================================================
// Terminal — Host-level shell access with Linux authentication gate,
// command history, command queuing, quick commands, and auto-scrolling output
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TerminalSquare,
  AlertTriangle,
  Play,
  Trash2,
  Clock,
  Copy,
  Check,
  Lock,
  Loader2,
  WifiOff,
} from 'lucide-react'
import { execTerminalCommandAuth, terminalAuthVerify, terminalLogout } from '../api/endpoints'
import { execMemberTerminalCommand, fetchMemberTerminal } from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import type { MemberTerminalStatus } from '../../shared/types'
import { useConnectionStore } from '../stores/connectionStore'
import { useSystemStore } from '../stores/systemStore'
import TerminalAuthGate from '../components/terminal/TerminalAuthGate'
import { readTerminalSession, forgetTerminalSession, readTerminalHistory, saveTerminalHistory } from '../lib/terminalSession'
import VmCapsule from '../components/fleet/VmCapsule'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { EmptyState, LoadingState } from '../components/common/PageState'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_CARD, BTN_ICON_SM, BTN_TOOLBAR_QUIET, TONE_DANGER, TONE_GHOST, TONE_OK, TONE_QUIET, BTN_TOOLBAR } from '../lib/ui'

import { Pill } from '../components/common/Pill'
import Kbd from '../components/common/Kbd'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandEntry {
  command: string
  cwd: string
  output: string
  exitCode: number
  success: boolean
  timestamp: string
  /** the prompt the command ran under: the hub's account and host, or the VM's */
  user: string
  host: string
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandEntry {
  command: string
  cwd: string
  output: string
  exitCode: number
  success: boolean
  timestamp: string
  /** the prompt the command ran under: the hub's account and host, or the VM's */
  user: string
  host: string
}

// ---------------------------------------------------------------------------
// ANSI color parser — converts basic ANSI escape codes to styled spans. The colours are
// the dashboard's own classes, not hex values, so the output reads in every theme and look.
// ---------------------------------------------------------------------------

const ANSI_CLASSES: Record<string, string> = {
  '30': 'text-slate-500', '31': 'text-rose-400', '32': 'text-emerald-400',
  '33': 'text-amber-400', '34': 'text-blue-400', '35': 'text-violet-400',
  '36': 'text-cyan-400', '37': 'text-slate-200',
  '90': 'text-slate-400', '91': 'text-rose-300', '92': 'text-emerald-300',
  '93': 'text-amber-300', '94': 'text-blue-300', '95': 'text-violet-300',
  '96': 'text-cyan-300', '97': 'text-slate-100',
  '1': 'font-bold', '2': 'opacity-70', '4': 'underline',
}

/** Escape HTML entities to prevent XSS from command output */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseAnsi(text: string): string {
  // SECURITY: Escape HTML FIRST to prevent XSS, then apply ANSI colour spans (the classes come from the table above)
  const safe = escapeHtml(text)
  let open = 0
  // eslint-disable-next-line no-control-regex
  const html = safe.replace(/\x1b\[([0-9;]*)m/g, (_match, codes: string) => {
    if (!codes || codes === '0') {
      const close = '</span>'.repeat(open)
      open = 0
      return close
    }
    const classes = codes.split(';').map((c: string) => ANSI_CLASSES[c]).filter(Boolean).join(' ')
    if (!classes) return ''
    open++
    return `<span class="${classes}">`
  })
  return html + '</span>'.repeat(open)
}

// ---------------------------------------------------------------------------
// Helper — shorten home directory in CWD to ~
// ---------------------------------------------------------------------------

function shortenCwd(fullCwd: string, user: string): string {
  const homePrefix = `/home/${user}`
  if (fullCwd === homePrefix) return '~'
  if (fullCwd.startsWith(homePrefix + '/')) return '~' + fullCwd.slice(homePrefix.length)
  if (fullCwd === '/root') return '~'
  if (fullCwd.startsWith('/root/')) return '~' + fullCwd.slice(5)
  return fullCwd
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Terminal() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const hostname = useSystemStore((s) => s.status?.hostname) || 'host'

  // On a hub the shell is the hub's own, or one inside a VM the hub built: the hub's Terminal
  // session unlocks both, the command travels over the hub's ssh key (3.9.3)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const pageScope = scope === 'all' ? 'hub' : scope
  const member = hasFleet && pageScope !== 'hub' ? scopeMember : null
  const [vmStatus, setVmStatus] = useState<MemberTerminalStatus | null>(null)
  const [vmChecking, setVmChecking] = useState(false)
  /** each server keeps its own working directory */
  const cwdsRef = useRef<Record<string, string>>({})
  const targetKey = member ?? 'hub'

  // Auth state
  const [authenticated, setAuthenticated] = useState(false)
  const [terminalToken, setTerminalToken] = useState('')
  const [terminalUser, setTerminalUser] = useState('')
  const [authChecking, setAuthChecking] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Terminal state
  const [commandInput, setCommandInput] = useState('')
  const [cwd, setCwd] = useState('~')
  const [entries, setEntries] = useState<CommandEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<string[]>(readTerminalHistory)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [queueLength, setQueueLength] = useState(0)

  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<string[]>([])
  const loadingRef = useRef(false)

  // Keep loadingRef in sync
  useEffect(() => { loadingRef.current = loading }, [loading])

  // another server: keep this one's directory, take that one's (its home until pwd answers)
  const prevKeyRef = useRef(targetKey)
  useEffect(() => {
    if (prevKeyRef.current === targetKey) return
    cwdsRef.current[prevKeyRef.current] = cwd
    prevKeyRef.current = targetKey
    setCwd(cwdsRef.current[targetKey] ?? '~')
    queueRef.current = []
    setQueueLength(0)
  }, [targetKey, cwd])

  // can the hub open a shell in the chosen VM?
  useEffect(() => {
    if (!member || !authenticated || !isConnected) { setVmStatus(null); return }
    let alive = true
    setVmChecking(true)
    fetchMemberTerminal(member)
      .then((st) => { if (alive) setVmStatus(st) })
      .catch((err: unknown) => {
        if (alive) setVmStatus({ available: false, member, member_name: memberName, vmid: null, host: '', user: '', reason: err instanceof Error ? err.message : 'the hub could not check this VM' })
      })
      .finally(() => { if (alive) setVmChecking(false) })
    return () => { alive = false }
  }, [member, memberName, authenticated, isConnected])

  const promptUser = member ? (vmStatus?.user || 'dcs') : terminalUser
  const promptHost = member ? memberName : hostname
  const vmBlocked = !!member && !!vmStatus && !vmStatus.available

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [entries])

  // Check for saved terminal session on mount
  useEffect(() => {
    if (!isConnected) {
      setAuthChecking(false)
      return
    }

    // only the session this server issued (kept under its address) is offered back to it
    const saved = readTerminalSession()
    if (saved) {
      const { token, username } = saved
      terminalAuthVerify(token).then((res) => {
        if (res.valid) {
          setTerminalToken(token)
          setTerminalUser(username || res.username)
          setAuthenticated(true)
        } else {
          forgetTerminalSession()
        }
      }).catch(() => {
        forgetTerminalSession()
      }).finally(() => setAuthChecking(false))
      return
    }
    setAuthChecking(false)
  }, [isConnected])

  // another server address while this page stays: the token in memory was issued by the server before, drop it
  const serverUrl = useConnectionStore((s) => s.serverUrl)
  const serverRef = useRef(serverUrl)
  useEffect(() => {
    if (serverRef.current === serverUrl) return
    serverRef.current = serverUrl
    setAuthenticated(false)
    setTerminalToken('')
    setTerminalUser('')
    setEntries([])
  }, [serverUrl])

  // Focus input when authenticated
  useEffect(() => {
    if (authenticated) inputRef.current?.focus()
  }, [authenticated])

  // Fetch the working directory on auth, and the first time another server is chosen
  useEffect(() => {
    if (!authenticated || !terminalToken || !isConnected) return
    if (member && !vmStatus?.available) return
    if ((cwdsRef.current[member ?? 'hub'] ?? '~') !== '~') return
    const run = member ? execMemberTerminalCommand(member, 'pwd', terminalToken) : execTerminalCommandAuth('pwd', terminalToken)
    run.then((res) => {
      const dir = res.output.trim() || (member ? res.cwd : '')
      if (res.success && dir) {
        cwdsRef.current[member ?? 'hub'] = dir
        setCwd(dir)
      }
    }).catch(() => {})
  }, [authenticated, terminalToken, isConnected, member, vmStatus?.available])

  // ---------------------------------------------------------------------------
  // Auth handlers
  // ---------------------------------------------------------------------------

  const handleAuthenticated = (token: string, username: string) => {
    setTerminalToken(token)
    setTerminalUser(username)
    setAuthenticated(true)
    setSessionExpired(false)
  }

  const handleLock = async () => {
    if (terminalToken) {
      try { await terminalLogout(terminalToken) } catch { /* ignore */ }
    }
    forgetTerminalSession()
    setAuthenticated(false)
    setTerminalToken('')
    setTerminalUser('')
    setEntries([])
    setCwd('~')
    cwdsRef.current = {}
    queueRef.current = []
    setQueueLength(0)
  }

  // ---------------------------------------------------------------------------
  // Execute command (with queuing support)
  // ---------------------------------------------------------------------------

  const executeCommand = useCallback(async (cmd?: string) => {
    const command = (cmd ?? commandInput).trim()
    if (!command) return

    // If already executing, queue the command instead of dropping it
    if (loadingRef.current) {
      queueRef.current.push(command)
      setQueueLength(queueRef.current.length)
      setCommandInput('')
      setHistoryIndex(-1)
      // Add to history
      setHistory(prev => {
        const filtered = prev.filter(h => h !== command)
        const next = [command, ...filtered].slice(0, 50)
        saveTerminalHistory(next)
        return next
      })
      return
    }

    setLoading(true)
    setCommandInput('')
    setHistoryIndex(-1)

    // Add to history (dedup and cap at 50)
    setHistory(prev => {
      const filtered = prev.filter(h => h !== command)
      const next = [command, ...filtered].slice(0, 50)
      saveTerminalHistory(next)
      return next
    })

    // Handle local "clear" command
    if (command === 'clear' || command === 'cls') {
      setEntries([])
      setLoading(false)
      inputRef.current?.focus()
      return
    }

    // a VM the hub cannot reach: say why instead of asking
    if (member && vmBlocked) {
      setEntries(prev => [...prev, { command, cwd, output: `The hub cannot open a shell in ${memberName}: ${vmStatus?.reason || 'not available'}`, exitCode: -1, success: false, timestamp: new Date().toISOString(), user: promptUser, host: promptHost }])
      setLoading(false)
      inputRef.current?.focus()
      return
    }

    try {
      const result = member
        ? await execMemberTerminalCommand(member, command, terminalToken, cwd === '~' ? undefined : cwd)
        : await execTerminalCommandAuth(command, terminalToken, cwd === '~' ? undefined : cwd)
      const entry: CommandEntry = {
        command,
        cwd: result.cwd || cwd,
        output: result.output,
        exitCode: result.exit_code,
        success: result.success,
        timestamp: result.timestamp,
        user: promptUser,
        host: promptHost,
      }
      setEntries(prev => [...prev, entry])

      // Track CWD changes
      if (result.cwd) {
        setCwd(result.cwd)
        cwdsRef.current[member ?? 'hub'] = result.cwd
      }
    } catch (err: unknown) {
      // Check for session expiry
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 401) {
        setSessionExpired(true)
        setAuthenticated(false)
        forgetTerminalSession()
        return
      }

      setEntries(prev => [...prev, {
        command,
        cwd,
        output: err instanceof Error ? err.message : 'Command execution failed',
        exitCode: -1,
        success: false,
        timestamp: new Date().toISOString(),
        user: promptUser,
        host: promptHost,
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()

      // Process next queued command if any
      if (queueRef.current.length > 0) {
        const nextCmd = queueRef.current.shift()!
        setQueueLength(queueRef.current.length)
        setTimeout(() => executeCommand(nextCmd), 0)
      }
    }
  }, [commandInput, cwd, terminalToken, member, memberName, vmBlocked, vmStatus?.reason, promptUser, promptHost])

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      executeCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1)
        setHistoryIndex(newIndex)
        setCommandInput(history[newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setCommandInput(history[newIndex])
      } else {
        setHistoryIndex(-1)
        setCommandInput('')
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setEntries([])
    }
  }, [executeCommand, history, historyIndex])

  // ---------------------------------------------------------------------------
  // Copy output
  // ---------------------------------------------------------------------------

  const handleCopyOutput = (index: number) => {
    const entry = entries[index]
    if (entry) {
      navigator.clipboard.writeText(entry.output)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    }
  }

  // ---------------------------------------------------------------------------
  // Quick commands
  // ---------------------------------------------------------------------------

  const quickCommands = [
    { label: 'docker ps', cmd: 'docker ps', tip: 'List running containers' },
    { label: 'docker stats', cmd: 'docker stats --no-stream', tip: 'One-shot container resource usage' },
    { label: 'df -h', cmd: 'df -h', tip: 'Disk space usage (human-readable)' },
    { label: 'free -m', cmd: 'free -m', tip: 'Memory usage in megabytes' },
    { label: 'top (snapshot)', cmd: 'top -bn1 | head -20', tip: 'One-shot CPU/memory snapshot (top 20 lines)' },
    { label: 'uptime', cmd: 'uptime', tip: 'System uptime and load averages' },
    { label: 'whoami', cmd: 'whoami', tip: 'Current logged-in user' },
    { label: 'ls -la', cmd: 'ls -la', tip: 'Detailed directory listing' },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Not connected
  if (!isConnected) {
    return (
      <div className="space-y-4 md:space-y-5 animate-fade-in">
        <PageHeader page="terminal" />
        <EmptyState icon={<WifiOff size={28} />} title="Not connected" hint="Connect to a server to use the terminal." />
      </div>
    )
  }

  // Checking auth
  if (authChecking) {
    return (
      <div className="space-y-4 md:space-y-5 animate-fade-in">
        <DisconnectedBanner />
        <PageHeader page="terminal" />
        <LoadingState label="Verifying the terminal session…" />
      </div>
    )
  }

  // Not signed in — show the gate
  if (!authenticated) {
    return (
      <div className="space-y-4 md:space-y-5 animate-fade-in">
        <DisconnectedBanner />
        <PageHeader page="terminal" />
        {sessionExpired && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 max-w-md mx-auto" role="alert">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" aria-hidden />
            <span className="text-xs text-amber-300">The terminal session expired. Sign in again to continue.</span>
          </div>
        )}
        <TerminalAuthGate onAuthenticated={handleAuthenticated} />
        {hasFleet && (
          <p className="text-center text-[11px] text-slate-500 px-4">
            This one sign-in also opens a shell inside every VM the hub built — pick the server above the terminal afterwards.
          </p>
        )}
      </div>
    )
  }

  const displayCwd = shortenCwd(cwd, promptUser)
  /** the prompt's user@host: emerald on this server, violet inside a VM */
  const promptColor = (inVm: boolean) => (inVm ? 'text-violet-400' : 'text-emerald-500')

  // Signed in — the terminal
  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] min-h-[32rem] gap-4 md:gap-5">
      <DisconnectedBanner />
      <PageHeader
        page="terminal"
        badge={<>
          {member && <VmCapsule member={member} name={memberName} vmid={scopeMembers.find((m) => m.id === member)?.vmid} />}
          <Pill tone="ok" icon={<Lock size={10} />}>Unlocked</Pill>
        </>}
        subtitle={<>Signed in as <span className="font-mono text-slate-300">{terminalUser}</span> with a Linux account{member ? <> · shell inside the VM <span className="font-mono text-slate-300">{memberName}</span></> : null}</>}
        actions={<>
          <Hint label="Clear the screen (Ctrl+L)">
            <button type="button" onClick={() => setEntries([])} aria-label="Clear the screen" className={BTN_TOOLBAR_QUIET}>
              <Trash2 size={14} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          </Hint>
          <Hint label="Lock the terminal and end the session">
            <button type="button" onClick={handleLock} aria-label="Lock the terminal" className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
              <Lock size={14} />
              <span className="hidden sm:inline">Lock</span>
            </button>
          </Hint>
        </>}
      >
        {/* On a hub: the hub's shell or one inside a VM */}
        {hasFleet && (
          <div className="flex flex-col gap-2">
            <FleetScopeChips scope={pageScope} members={scopeMembers} onChange={setScope} label="Shell on" everywhere={false} busy={vmChecking} />
            {vmBlocked && vmStatus && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15" role="alert">
                <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" aria-hidden />
                <p className="text-[11px] text-amber-200/80">The hub cannot open a shell in <span className="font-mono">{memberName}</span>: {vmStatus.reason}</p>
              </div>
            )}
            {member && vmStatus?.available && (
              <p className="text-[11px] text-slate-500">
                Commands run inside the VM as <span className="font-mono text-slate-400">{vmStatus.user}@{vmStatus.host}</span> over the hub's ssh key — each one a fresh shell with a 60 s limit, written to the hub's terminal audit log.
              </p>
            )}
          </div>
        )}
      </PageHeader>

      {/* Quick commands */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-1">Quick commands</span>
        {quickCommands.map((qc) => (
          <Hint key={qc.cmd} label={qc.tip}>
            <button type="button" onClick={() => executeCommand(qc.cmd)} className={`${BTN_CARD} ${TONE_QUIET} font-mono`}>
              {qc.label}
            </button>
          </Hint>
        ))}
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        role="log"
        aria-label="Terminal output"
        className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-slate-950 border border-white/5 font-mono text-sm scrollbar-thin cursor-text"
      >
        {/* Welcome message when empty */}
        {entries.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500 px-4 text-center">
            <TerminalSquare size={32} strokeWidth={1.2} aria-hidden />
            <p className="text-xs">Ready. Type a command below, or use a quick command above.</p>
            <p className="text-[11px] text-slate-500">
              <Kbd>↑</Kbd> / <Kbd>↓</Kbd> walk the history
              &nbsp;&middot;&nbsp;
              <Kbd>Ctrl+L</Kbd> clears the screen
            </p>
          </div>
        )}

        {/* Command entries */}
        <div className="p-3 space-y-0">
          {entries.map((entry, idx) => (
            <div key={`${entry.timestamp}-${idx}`} className="group animate-fade-in border-b border-white/[0.03] pb-1 mb-1">
              {/* Prompt + command */}
              <div className="flex flex-wrap items-start gap-y-1">
                <span className={`${promptColor(entry.host !== hostname)} select-none shrink-0`}>
                  {entry.user}@{entry.host}
                </span>
                <span className="text-slate-500 select-none">:</span>
                <span className="text-cyan-400 select-none">{shortenCwd(entry.cwd, entry.user)}</span>
                <span className="text-slate-500 select-none mx-1">$</span>
                <span className="text-slate-200 break-all min-w-0">{entry.command}</span>

                {/* Time, exit code and copy: shown on hover or focus, always on a touch screen (under the command on a phone) */}
                <div className="ml-auto pl-2 max-sm:basis-full max-sm:pl-0 max-sm:justify-end flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity shrink-0">
                  <span className="text-[10px] text-slate-500 flex items-center gap-1 tabular-nums">
                    <Clock size={9} aria-hidden />
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <Pill tone={entry.exitCode === 0 ? 'ok' : 'problem'}>exit {entry.exitCode}</Pill>
                  <Hint label={copiedIndex === idx ? 'Copied' : 'Copy the output'}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleCopyOutput(idx) }} aria-label="Copy the output" className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                      {copiedIndex === idx ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </Hint>
                </div>
              </div>

              {/* Output */}
              {entry.output && (
                <pre
                  className={`mt-0.5 whitespace-pre-wrap break-all text-[13px] leading-relaxed ${entry.success ? 'text-slate-400' : 'text-rose-300/80'}`}
                  dangerouslySetInnerHTML={{ __html: parseAnsi(entry.output) }}
                />
              )}
            </div>
          ))}

          {/* Running: a blinking cursor block */}
          {loading && (
            <div className="flex items-center gap-0 py-1" role="status" aria-label="Running the command">
              <span className={`${promptColor(!!member)} select-none shrink-0`}>
                {promptUser}@{promptHost}
              </span>
              <span className="text-slate-500 select-none">:</span>
              <span className="text-cyan-400 select-none">{displayCwd}</span>
              <span className="text-slate-500 select-none mx-1">$</span>
              <span className="text-emerald-400 animate-pulse" aria-hidden>&#9610;</span>
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className={`
        flex items-center gap-0 rounded-xl bg-slate-950 border px-3 py-2 font-mono text-sm
        transition-colors duration-200 focus-within:ring-2 focus-within:ring-emerald-500/30
        ${loading ? 'border-emerald-500/30' : 'border-white/5 focus-within:border-emerald-500/50'}
      `}>
        <span className={`${promptColor(!!member)} select-none shrink-0 hidden sm:inline`}>
          {promptUser}@{promptHost}
        </span>
        <span className="text-slate-500 select-none hidden sm:inline">:</span>
        <span className="text-cyan-400 select-none shrink-0 hidden sm:inline">{displayCwd}</span>
        <span className="text-slate-500 select-none mx-1">$</span>

        {/* Input — never disabled */}
        <input
          ref={inputRef}
          type="text"
          aria-label="Command"
          value={commandInput}
          onChange={(e) => { setCommandInput(e.target.value); setHistoryIndex(-1) }}
          onKeyDown={handleKeyDown}
          placeholder={loading ? 'Type the next command (it is queued)…' : 'Type a command…'}
          className="flex-1 min-w-0 bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Queue indicator */}
        {queueLength > 0 && (
          <span className="text-[11px] text-cyan-400 mr-2 select-none whitespace-nowrap">
            {queueLength} queued
          </span>
        )}

        {/* Run — a spinner while a command runs */}
        <Hint label={loading ? 'Running… the command will be queued' : 'Run the command (Enter)'}>
          <button
            type="button"
            onClick={() => executeCommand()}
            disabled={!commandInput.trim()}
            aria-label="Run the command"
            className={`${BTN_ICON_SM} ${TONE_OK} ml-2`}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          </button>
        </Hint>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-slate-500">
            {history.length} command{history.length !== 1 ? 's' : ''} in the history
          </span>
          <button
            type="button"
            onClick={() => { setHistory([]); saveTerminalHistory([]) }}
            className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors px-2 py-1 -my-1 rounded-md"
          >
            Clear the history
          </button>
        </div>
      )}
    </div>
  )
}
