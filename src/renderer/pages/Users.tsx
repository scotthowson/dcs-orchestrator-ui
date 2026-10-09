// =============================================================================
// Users — the accounts that can sign in, invite codes, the sessions open now,
// and the sign-in to the apps behind Authelia (its second step)
// =============================================================================

import StatTile from '../components/common/StatTile'
import { useState, useEffect, useCallback } from 'react'
import {
  Users as UsersIcon,
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldX,
  Copy,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  Plus,
  AlertTriangle,
  KeyRound,
  Bot,
  LogOut,
  Trash2,
  Fingerprint,
} from 'lucide-react'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_ICON_SM, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_DANGER } from '../lib/ui'
import {
  authListUsers, authListInvites, authCreateInvite, authCreateUser, authRevokeUser, authSetUserRole,
  authListSessions, authRevokeSession, authDeleteInvite, authLogoutAll,
} from '../api/endpoints'
import type { ApiUser, InviteCode, SessionInfo as SessionEntry } from '../../shared/types'
import { LoadingState, EmptyState } from '../components/common/PageState'
import AppSignInCard from '../components/users/AppSignInCard'

import { FIELD_SM } from '../lib/fieldStyles'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return dateStr }
}

/** Older builds stored the status emoji as \uXXXX escapes */
function decodeEmoji(s: string): string {
  if (/^(\\u[0-9A-Fa-f]{4})+$/.test(s)) { try { return JSON.parse('"' + s + '"') } catch { return s } }
  return s
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const now = Date.now()
    const diff = now - d.getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return formatDate(dateStr)
  } catch { return '' }
}

function isExpired(dateStr: string): boolean {
  if (!dateStr) return false
  try { return new Date(dateStr).getTime() < Date.now() } catch { return false }
}

// ---------------------------------------------------------------------------
// Roles: one colour each, everywhere a role is drawn (the list, the sessions, the invites)
// ---------------------------------------------------------------------------

type Role = 'user' | 'admin' | 'bot'

/** admin is information (cyan), a bot is its own kind (violet), a plain user is neutral (slate) */
const ROLE_TONE: Record<string, { pill: string; avatar: string }> = {
  admin: { pill: 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/20', avatar: 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/20' },
  bot: { pill: 'bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/20', avatar: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/20' },
  user: { pill: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/25', avatar: 'bg-slate-500/15 text-slate-300 ring-1 ring-slate-500/25' },
}
const roleTone = (role: string) => ROLE_TONE[role] ?? ROLE_TONE.user

function RolePill({ role, className = '' }: { role: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleTone(role).pill} ${className}`}>
      {role === 'admin' ? <Shield className="h-2.5 w-2.5" aria-hidden /> : role === 'bot' ? <Bot className="h-2.5 w-2.5" aria-hidden /> : <ShieldCheck className="h-2.5 w-2.5" aria-hidden />}
      {role}
    </span>
  )
}

/** the heading of a card on this page */
function CardTitle({ icon, children, count }: { icon: React.ReactNode; children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-sm font-semibold text-slate-200">{children}</h2>
      {count !== undefined && <span className="text-xs text-slate-500 tabular-nums">({count})</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Users page
// ---------------------------------------------------------------------------

export default function Users() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const currentUser = useAuthStore((s) => s.currentUser)
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [users, setUsers] = useState<ApiUser[]>([])
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [newInviteRole, setNewInviteRole] = useState<'user' | 'admin'>('user')
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' as Role })
  const [createLoading, setCreateLoading] = useState(false)
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [revokingSession, setRevokingSession] = useState<string | null>(null)
  const [deletingInvite, setDeletingInvite] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState<string | null>(null)

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, invitesRes, sessionsRes] = await Promise.all([
        authListUsers(),
        authListInvites(),
        authListSessions().catch(() => ({ sessions: [], total: 0 })),
      ])
      setSessions(sessionsRes.sessions)
      setUsers(usersRes.users ?? [])
      setInvites(invitesRes.invites ?? [])
    } catch {
      // Data may not be available if auth isn't configured
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isConnected) fetchData()
  }, [isConnected, fetchData])

  // Generate invite code
  const handleCreateInvite = useCallback(async () => {
    setInviteLoading(true)
    try {
      const result = await authCreateInvite(newInviteRole)
      if (result.success) {
        addToast({ type: 'success', message: `Invite code created (${newInviteRole})` })
        fetchData()
      } else {
        addToast({ type: 'error', message: 'Could not create the invite code' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast({ type: 'error', message: `Could not create the invite: ${msg}`, duration: 6000 })
    } finally {
      setInviteLoading(false)
    }
  }, [newInviteRole, addToast, fetchData])

  // Create an account directly (bots, family): no invite round trip
  const handleCreateUser = useCallback(async () => {
    const u = newUser.username.trim()
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) { addToast({ type: 'error', message: 'Username: 3–32 letters, digits, hyphens or underscores' }); return }
    if (newUser.password.length < 8) { addToast({ type: 'error', message: 'Password: at least 8 characters' }); return }
    setCreateLoading(true)
    try {
      const result = await authCreateUser(u, newUser.password, newUser.role)
      addToast({ type: 'success', message: result.message || `User ${u} created` })
      setNewUser({ username: '', password: '', role: 'user' })
      fetchData()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not create the user', duration: 6000 })
    } finally {
      setCreateLoading(false)
    }
  }, [newUser, addToast, fetchData])

  // Change a user's role
  const handleChangeRole = useCallback(async (username: string, role: Role) => {
    try {
      const result = await authSetUserRole(username, role)
      addToast({ type: result.success ? 'success' : 'error', message: result.message || `${username} is now ${role}` })
      fetchData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast({ type: 'error', message: `Could not change the role: ${msg}`, duration: 6000 })
    }
  }, [addToast, fetchData])

  // Revoke user
  const handleRevokeUser = useCallback(async (username: string) => {
    setRevokeTarget(username)
    try {
      const result = await authRevokeUser(username)
      if (result.success) {
        addToast({ type: 'success', message: `User "${username}" has been revoked.` })
        fetchData()
      } else {
        addToast({ type: 'error', message: result.message || 'Could not revoke the user' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast({ type: 'error', message: `Could not revoke the user: ${msg}`, duration: 6000 })
    } finally {
      setRevokeTarget(null)
    }
  }, [addToast, fetchData])

  const askRevokeUser = useCallback(async (username: string) => {
    const ok = await confirm({
      title: 'Revoke access?',
      message: `Revoke access for ${username}? Their sessions end and they can no longer sign in.`,
      confirmLabel: 'Revoke access',
      danger: true,
    })
    if (ok) await handleRevokeUser(username)
  }, [confirm, handleRevokeUser])

  const handleRevokeSession = useCallback(async (tokenPrefix: string) => {
    setRevokingSession(tokenPrefix)
    try {
      const result = await authRevokeSession(tokenPrefix)
      if (result.success) {
        addToast({ type: 'success', message: `Session revoked (${result.revoked} token${result.revoked !== 1 ? 's' : ''})` })
        fetchData()
      } else {
        addToast({ type: 'error', message: result.message || 'Could not revoke the session' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not revoke the session' })
    } finally {
      setRevokingSession(null)
    }
  }, [addToast, fetchData])

  // Every session of an account at once (POST /auth/logout-all): a lost phone, a shared password. Your own account
  // too — that ends this session as well, so the dashboard signs out itself instead of hitting a 401 on the next poll.
  const askLogoutAll = useCallback(async (username: string) => {
    const self = username === currentUser
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message: self
        ? 'Sign out every session of your account, this one too? You sign in again afterwards.'
        : `Sign out every session of ${username}? They stay registered and can sign in again.`,
      confirmLabel: 'Sign out everywhere',
      danger: true,
    })
    if (!ok) return
    setSigningOut(username)
    try {
      const result = await authLogoutAll(username)
      if (!result.success) { addToast({ type: 'error', message: result.message || 'Could not sign the account out' }); return }
      if (self) { await useAuthStore.getState().logout({ keepOtherServers: true }); return }
      addToast({ type: 'success', message: `${username} is signed out everywhere` })
      fetchData()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not sign the account out', duration: 6000 })
    } finally {
      setSigningOut(null)
    }
  }, [confirm, currentUser, addToast, fetchData])

  // An invite that should not be used (sent to the wrong person, no longer wanted): DELETE /auth/invite/{code}
  const askDeleteInvite = useCallback(async (invite: InviteCode) => {
    const ok = await confirm({
      title: invite.used ? 'Remove this invite?' : 'Revoke this invite?',
      message: invite.used
        ? `Remove the used invite ${invite.code.slice(0, 8)}… from the list? ${invite.used_by ? `${invite.used_by}'s account stays.` : 'The account made with it stays.'}`
        : `Revoke the invite ${invite.code}? Nobody can register with it any more.`,
      confirmLabel: invite.used ? 'Remove' : 'Revoke invite',
      danger: !invite.used,
    })
    if (!ok) return
    setDeletingInvite(invite.code)
    try {
      await authDeleteInvite(invite.code)
      addToast({ type: 'success', message: invite.used ? 'Invite removed' : 'Invite revoked' })
      fetchData()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not delete the invite', duration: 6000 })
    } finally {
      setDeletingInvite(null)
    }
  }, [confirm, addToast, fetchData])

  // Copy invite code to clipboard
  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code)
      addToast({ type: 'info', message: 'Invite code copied' })
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }, [addToast])

  // Disconnected state
  if (!isConnected) {
    return (
      <LoadingState label="Waiting for the server connection…" hint="Make sure the DCS Orchestrator API is running" />
    )
  }

  const activeInvites = invites.filter((i) => !i.used && !isExpired(i.expires_at))
  const usedInvites = invites.filter((i) => i.used)

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="users"
        actions={
          <button type="button" onClick={fetchData} disabled={loading} aria-label="Refresh" className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 stagger-children">
        <StatTile icon={UsersIcon} label="Registered users" value={users.length} tone="ok" loading={loading && users.length === 0} />
        <StatTile icon={KeyRound} label="Active invites" value={activeInvites.length} tone="info" loading={loading && users.length === 0} />
        <StatTile icon={ShieldCheck} label="Admin users" value={users.filter((u) => u.role === 'admin').length} loading={loading && users.length === 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        {/* ---- Users List ---- */}
        <section className="surface p-4 md:p-5">
          <div className="flex items-center justify-between mb-5">
            <CardTitle icon={<UsersIcon className="h-4 w-4 text-emerald-400" aria-hidden />} count={users.length}>Registered users</CardTitle>
          </div>

          {loading ? (
            <LoadingState compact label="Loading users…" />
          ) : users.length === 0 ? (
            <EmptyState
              compact
              icon={<UsersIcon className="h-8 w-8" />}
              title="No users registered yet"
              hint="Create an invite code to get started"
              action={
                <button type="button" onClick={handleCreateInvite} disabled={inviteLoading} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                  <UserPlus size={14} />
                  Invite user
                </button>
              }
            />
          ) : (
            <ul className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
              {users.map((user) => (
                <li
                  key={user.username}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-white/[0.03] border border-white/[0.03] px-4 py-3 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${roleTone(user.role).avatar}`}>
                      {user.avatar && user.avatar.length > 2 ? (
                        <img src={user.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : user.avatar ? (
                        <span className="text-lg leading-none">{user.avatar}</span>
                      ) : (
                        user.username[0]?.toUpperCase() ?? 'U'
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 min-w-0">
                        {user.display_name ? <>{user.display_name} <span className="text-[11px] font-normal text-slate-500 truncate">{user.username}</span></> : <span className="truncate">{user.username}</span>}
                        {user.status_emoji && <span className="text-xs" title={user.status_text || ''}>{decodeEmoji(user.status_emoji)}</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <RolePill role={user.role} />
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" aria-hidden />
                          {timeAgo(user.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Role, changeable for everyone but yourself; a bot account runs day-to-day operations only and may keep several sessions */}
                  <div className="flex items-center gap-2">
                    {user.username !== currentUser && (
                      <Hint label="Change this account's role (signs its sessions out)">
                        <select
                          value={user.role}
                          onChange={(e) => handleChangeRole(user.username, e.target.value as Role)}
                          aria-label={`Role of ${user.username}`}
                          className={`${FIELD_SM} !h-8 !px-2 !text-[11px] text-slate-300 hover:text-slate-100 cursor-pointer`}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                          <option value="bot">Bot</option>
                        </select>
                      </Hint>
                    )}
                    {/* Every session of the account at once (your own too: that ends this one) */}
                    <Hint label={user.username === currentUser ? 'Sign out every session of your account, this one too' : `Sign out every session of ${user.username}`}>
                      <button
                        type="button"
                        onClick={() => askLogoutAll(user.username)}
                        disabled={signingOut === user.username}
                        aria-label={`Sign out ${user.username} everywhere`}
                        className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                      >
                        {signingOut === user.username ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      </button>
                    </Hint>
                    {/* Revoke — not for yourself (you cannot revoke your own access) */}
                    {user.username === currentUser ? (
                      <Hint label="You cannot revoke your own account">
                        <span className="inline-flex">
                          <button type="button" disabled aria-label="Revoke (not available for your own account)" className={`${BTN_CARD} bg-white/[0.03] border border-white/5 text-slate-500 cursor-not-allowed`}>
                            <ShieldX size={12} />
                            Revoke
                          </button>
                        </span>
                      </Hint>
                    ) : (
                      <button
                        type="button"
                        onClick={() => askRevokeUser(user.username)}
                        disabled={revokeTarget === user.username}
                        aria-label={`Revoke access for ${user.username}`}
                        className={`${BTN_CARD} ${TONE_DANGER}`}
                      >
                        {revokeTarget === user.username ? <Loader2 size={12} className="animate-spin" /> : <ShieldX size={12} />}
                        Revoke
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Create a user directly ---- */}
        <section className="surface p-4 md:p-5">
          <CardTitle icon={<UserPlus className="h-4 w-4 text-emerald-400" aria-hidden />}>Create user</CardTitle>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            An account you set up yourself, no invite code: for the Discord bot, an automation, or someone who should not register on their own. Bots need admin for the start, stop and update commands.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreateUser() }}
            className="space-y-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.03]"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
                aria-label="Username"
                placeholder="Username, e.g. dcs-bot"
                autoComplete="off"
                className={`${FIELD_SM} font-mono`}
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
                aria-label="Password"
                placeholder="Password, 8+ characters"
                autoComplete="new-password"
                className={FIELD_SM}
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="new-user-role" className="text-xs text-slate-400">Role</label>
              <select
                id="new-user-role"
                value={newUser.role}
                onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value as Role }))}
                className={`${FIELD_SM} !px-2 text-slate-300`}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="bot">Bot</option>
              </select>
              <span className="flex-1" />
              <button
                type="submit"
                disabled={createLoading || !newUser.username || !newUser.password}
                className={`${BTN_TOOLBAR} justify-center ${TONE_OK}`}
              >
                {createLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                Create
              </button>
            </div>
          </form>
        </section>

        {/* ---- Invite Codes ---- */}
        <section className="surface p-4 md:p-5">
          <div className="mb-5">
            <CardTitle icon={<KeyRound className="h-4 w-4 text-cyan-400" aria-hidden />}>Invite codes</CardTitle>
          </div>

          {/* Create invite form */}
          <div className="flex flex-wrap items-center gap-3 mb-5 p-3 rounded-xl bg-white/[0.03] border border-white/[0.03]">
            <div className="flex-1 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-cyan-400 flex-shrink-0" aria-hidden />
              <label htmlFor="invite-role" className="text-xs text-slate-400">New invite for</label>
              <select
                id="invite-role"
                value={newInviteRole}
                onChange={(e) => setNewInviteRole(e.target.value as 'user' | 'admin')}
                className={`${FIELD_SM} !h-8 !px-2 text-slate-300`}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleCreateInvite}
              disabled={inviteLoading}
              className={`${BTN_TOOLBAR} ${TONE_OK}`}
            >
              {inviteLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Generate
            </button>
          </div>

          {/* Active invites */}
          {activeInvites.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                Active ({activeInvites.length})
              </p>
              <div className="space-y-2">
                {activeInvites.map((invite) => (
                  <InviteCard
                    key={invite.code}
                    invite={invite}
                    copiedCode={copiedCode}
                    onCopy={handleCopyCode}
                    onDelete={askDeleteInvite}
                    deleting={deletingInvite === invite.code}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Used invites */}
          {usedInvites.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
                Used ({usedInvites.length})
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
                {usedInvites.map((invite) => (
                  <div
                    key={invite.code}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.01] border border-white/[0.03] opacity-70"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden />
                      <code className="text-[11px] font-mono text-slate-500">{invite.code.slice(0, 8)}...</code>
                      <RolePill role={invite.role} />
                    </div>
                    <div className="flex items-center gap-2">
                      {invite.used_by && (
                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <UsersIcon className="h-2.5 w-2.5" aria-hidden />
                          {invite.used_by}
                        </span>
                      )}
                      {/* a used invite is only history: removing it keeps the list short, the account it made stays */}
                      <Hint label="Remove from the list">
                        <button
                          type="button"
                          onClick={() => askDeleteInvite(invite)}
                          disabled={deletingInvite === invite.code}
                          aria-label={`Remove the used invite ${invite.code}`}
                          className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                        >
                          {deletingInvite === invite.code ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </Hint>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {invites.length === 0 && !loading && (
            <EmptyState
              compact
              icon={<KeyRound className="h-8 w-8" />}
              title="No invite codes yet"
              hint="Generate an invite to allow new user registration"
            />
          )}
        </section>

        {/* ── Active sessions ── */}
        <section className="surface overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-cyan-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-200">Active sessions</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-slate-500 border border-white/5 tabular-nums">{sessions.length}</span>
            </div>
          </div>
          <div className="p-4">
            {sessions.length === 0 ? (
              <EmptyState compact title="No active sessions" />
            ) : (
              <ul className="space-y-2">
                {sessions.map((s) => {
                  const hours = Math.floor(s.remaining_seconds / 3600)
                  const mins = Math.floor((s.remaining_seconds % 3600) / 60)
                  return (
                    <li key={s.id} className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/[0.03] hover:border-white/5 px-4 py-3 transition-all">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 shrink-0">
                        <Shield className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-200">{s.username}</span>
                          <RolePill role={s.role} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[10px] text-slate-500">
                          <span className="font-mono">{s.id}</span>
                          <span>{s.ip}</span>
                          <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" aria-hidden />{hours}h {mins}m left</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(s.id.replace('...', ''))}
                        disabled={revokingSession === s.id}
                        aria-label={`Revoke the session ${s.id} of ${s.username}`}
                        className={`${BTN_CARD} ${TONE_DANGER}`}
                      >
                        {revokingSession === s.id ? <Loader2 size={12} className="animate-spin" /> : <ShieldX size={12} />}
                        Revoke
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── Sign-in to your apps: Authelia's second step ── */}
      <section className="surface p-4 md:p-5 space-y-4" aria-labelledby="app-sign-in-title">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-emerald-400" aria-hidden />
          <h2 id="app-sign-in-title" className="text-sm font-semibold text-slate-200">Sign-in to your apps (Authelia)</h2>
        </div>
        <AppSignInCard />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function InviteCard({ invite, copiedCode, onCopy, onDelete, deleting }: {
  invite: InviteCode
  copiedCode: string | null
  onCopy: (code: string) => void
  /** DELETE /auth/invite/{code}: the code stops working */
  onDelete: (invite: InviteCode) => void
  deleting: boolean
}) {
  const expired = isExpired(invite.expires_at)

  return (
    <div className={`
      flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-4 py-3 border transition-colors
      ${expired
        ? 'bg-rose-500/5 border-rose-500/10'
        : 'bg-white/[0.03] border-white/[0.03] hover:bg-white/5'
      }
    `}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <code className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded truncate">
          {invite.code}
        </code>
        <RolePill role={invite.role} />
        {expired && (
          <span className="flex items-center gap-1 text-[10px] text-rose-400">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
            Expired
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" aria-hidden />
          {formatDate(invite.expires_at)}
        </span>
        <Hint label="Copy invite code">
          <button
            type="button"
            onClick={() => onCopy(invite.code)}
            aria-label={`Copy the invite code ${invite.code}`}
            className={`${BTN_ICON_SM} ${TONE_GHOST}`}
          >
            {copiedCode === invite.code
              ? <Check size={12} className="text-emerald-400" />
              : <Copy size={12} />
            }
          </button>
        </Hint>
        <Hint label={expired ? 'Remove the expired invite' : 'Revoke the invite — nobody can register with it'}>
          <button
            type="button"
            onClick={() => onDelete(invite)}
            disabled={deleting}
            aria-label={`${expired ? 'Remove' : 'Revoke'} the invite code ${invite.code}`}
            className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </Hint>
      </div>
    </div>
  )
}
