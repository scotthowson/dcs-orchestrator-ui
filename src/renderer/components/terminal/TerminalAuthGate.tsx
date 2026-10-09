// =============================================================================
// TerminalAuthGate — Linux system credential gate for terminal access
// =============================================================================

import { useState, useRef, useEffect } from 'react'
import { Switch } from '@mantine/core'
import { Shield, User, Lock, Loader2, AlertCircle, Eye, EyeOff, KeyRound } from 'lucide-react'
import { terminalAuth } from '../../api/endpoints'
import { saveTerminalSession } from '../../lib/terminalSession'
import Hint from '../common/Hint'
import { BTN_ICON_SM, BTN_SHEET_PRIMARY, TONE_GHOST } from '../../lib/ui'

import { INPUT_ICON } from '../../lib/fieldStyles'
interface Props {
  onAuthenticated: (token: string, username: string) => void
}

export default function TerminalAuthGate({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberSession, setRememberSession] = useState(true)
  const [mounted, setMounted] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
    requestAnimationFrame(() => setMounted(true))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password || loading) return

    setLoading(true)
    setError('')

    try {
      const res = await terminalAuth(username.trim(), password)
      if (res.success && res.token) {
        if (rememberSession) {
          saveTerminalSession({
            token: res.token,
            username: res.username,
            // the System page's OS updates restore the session only while it is valid: the API says how long (4 h as shipped)
            expiresAt: Date.now() + (res.expires_in || 14400) * 1000,
          })
        }
        onAuthenticated(res.token, res.username)
      } else {
        setError(res.message || 'Authentication failed')
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err) {
        const apiErr = err as { status: number; message?: string }
        if (apiErr.status === 429) {
          setError('Too many failed attempts. Please try again in 15 minutes.')
        } else if (apiErr.status === 401) {
          setError('Wrong Linux username or password.')
        } else {
          setError(apiErr.message || 'Authentication failed')
        }
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-6">
      <div
        className={`
          w-full max-w-md transition-all duration-500 ease-out
          ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        `}
      >
        <form onSubmit={handleSubmit} className="glass-card p-5 md:p-6 space-y-5" aria-labelledby="terminal-gate-title">
          <div className="flex items-start gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 shrink-0" aria-hidden>
              <KeyRound size={18} className="text-slate-300" />
            </span>
            <div className="min-w-0">
              <h2 id="terminal-gate-title" className="text-base font-semibold text-slate-200">Sign in with a Linux account</h2>
              <p className="text-xs text-slate-500 mt-0.5">Enter the username and password of a Linux account on this server to open the terminal.</p>
            </div>
          </div>

          {/* What is checked */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/15">
            <Shield size={14} className="text-cyan-400 shrink-0" aria-hidden />
            <span className="text-[11px] text-slate-400">
              The credentials are checked against the server's Linux accounts
            </span>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 animate-fade-in" role="alert">
              <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" aria-hidden />
              <span className="text-xs text-rose-300">{error}</span>
            </div>
          )}

          {/* Username field */}
          <div className="space-y-1.5">
            <label htmlFor="terminal-username" className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              Username
            </label>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                id="terminal-username"
                ref={usernameRef}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Linux username"
                disabled={loading}
                autoComplete="username"
                className={INPUT_ICON}
              />
            </div>
          </div>

          {/* Password field */}
          <div className="space-y-1.5">
            <label htmlFor="terminal-password" className="block text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                id="terminal-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Linux password"
                disabled={loading}
                autoComplete="current-password"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
                className={`${INPUT_ICON} !pr-11`}
              />
              <Hint label={showPassword ? 'Hide the password' : 'Show the password'}>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 ${BTN_ICON_SM} ${TONE_GHOST}`}
                  aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </Hint>
            </div>
          </div>

          {/* Remember toggle */}
          <div className="flex items-center justify-between gap-3">
            <span id="terminal-remember" className="text-xs text-slate-400">Remember for this session</span>
            <Switch size="sm" aria-labelledby="terminal-remember" checked={rememberSession} onChange={() => setRememberSession(!rememberSession)} />
          </div>

          {/* Submit button */}
          <button type="submit" disabled={loading || !username.trim() || !password} className={`${BTN_SHEET_PRIMARY} w-full`}>
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                <Lock size={16} />
                Sign in
              </>
            )}
          </button>
        </form>

        {/* Footer hint */}
        <p className="text-center text-[11px] text-slate-500 mt-4">
          Terminal sessions expire after 4 hours. Close the browser tab to end one right away.
        </p>
      </div>
    </div>
  )
}
