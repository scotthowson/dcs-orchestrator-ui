import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  KeyRound, Plus, Trash2, Search, Shield, Eye, EyeOff, AlertTriangle, X, Loader2, RefreshCw,
  BookOpen, Lock, FileKey, Terminal, ChevronDown, ChevronRight, Wand2, Copy, Check, Link2, Layers,
} from 'lucide-react'
import { useSecretsStore } from '../stores/secretsStore'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { EmptyState, ErrorState } from '../components/common/PageState'
import { pageLabel } from '../constants/pageTitles'
import {
  BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, BTN_SHEET_DANGER,
  TONE_OK, TONE_QUIET, TONE_GHOST, TONE_GHOST_DANGER,
} from '../lib/ui'
import { fetchSecretReferences } from '../api/endpoints'
import type { SecretEntry, SecretReferencesResponse } from '../../shared/types'
import ModalOverlay from '../components/common/ModalOverlay'
import DashboardFeedCard from '../components/secrets/DashboardFeedCard'
import ApiKeysCard from '../components/secrets/ApiKeysCard'

import SearchInput from '../components/common/SearchInput'
import CloseButton from '../components/common/CloseButton'
// Same rule as the server (.lib/secrets.sh): a compose-safe variable name.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const GENERATED_LENGTH = 32
const GENERATED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Random value that is safe inside compose files and .env (no quotes, $, spaces) */
function generateSecret(length = GENERATED_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => GENERATED_ALPHABET[b % GENERATED_ALPHABET.length]).join('')
}

/** a row key: the secret on its DCS (the hub's rows have no member), so the same name on two VMs stays apart */
const secretKey = (e: { member?: string | null; key: string }) => `${e.member ?? ''}|${e.key}`

function referenceFor(name: string): string {
  return `\${SECRETS_${name}}`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

const GUIDE_SECTIONS = [
  {
    icon: Lock,
    title: 'How it works',
    body: (
      <>
        <p>Each value is encrypted on the server with <span className="text-slate-300">AES-256-CBC</span> and a 256-bit master key stored at <code className="text-slate-500 bg-white/5 px-1 rounded font-mono text-[10px]">.secrets/.master-key</code> (mode 600). Values are write-only: you can replace or delete a secret, never read it back from the UI.</p>
        <p>The same store is used by the API, <code className="text-slate-500 bg-white/5 px-1 rounded font-mono text-[10px]">start.sh</code>, the {pageLabel('stacks')} page and scheduled tasks, so a stack behaves the same however it is started.</p>
        <p>Back up <code className="text-slate-500 bg-white/5 px-1 rounded font-mono text-[10px]">.master-key</code> separately: backups and snapshots carry only the encrypted files.</p>
      </>
    ),
  },
  {
    icon: Terminal,
    title: 'Reference a secret',
    body: (
      <>
        <p>Use the placeholder shown on each card, <span className="text-cyan-300 font-mono">{'${SECRETS_NAME}'}</span>, in a compose file or in a stack&apos;s <code className="text-slate-500 bg-white/5 px-1 rounded font-mono text-[10px]">.env</code>:</p>
        <div className="bg-slate-950/60 rounded-lg p-3 font-mono text-[10px] space-y-1 border border-white/5">
          <p className="text-slate-500"># docker-compose.yml</p>
          <p className="text-slate-400">services:</p>
          <p className="text-slate-400">{'  '}homarr:</p>
          <p className="text-slate-400">{'    '}environment:</p>
          <p className="text-slate-300">{'      '}- DB_PASSWORD=<span className="text-cyan-300">{'${SECRETS_HOMARR_PASSWORD}'}</span></p>
          <p className="text-slate-500 pt-1"># Stacks/web-applications/.env</p>
          <p className="text-slate-300">API_KEY=<span className="text-cyan-300">{'${SECRETS_STRIPE_KEY}'}</span></p>
        </div>
        <p>Names are letters, digits and underscores (UPPER_SNAKE is easiest to read) and must match exactly.</p>
      </>
    ),
  },
  {
    icon: FileKey,
    title: 'What happens at start',
    body: (
      <>
        <p>When a stack starts, DCS decrypts every referenced secret into the environment of the <span className="text-slate-300">docker compose</span> process only. The compose file and .env keep the placeholder.</p>
        <p>If a referenced secret does not exist the stack is <span className="text-rose-400">not started</span> and the missing names are reported, instead of running a service with an empty password.</p>
        <p>After changing a value, restart the stacks that use it: the card&apos;s <span className="text-slate-300">References</span> shows which ones.</p>
      </>
    ),
  },
]

export default function Secrets() {
  const { entries, keys, loading, saving, error, fetchSecrets, setSecret, deleteSecret } = useSecretsStore()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [guideSection, setGuideSection] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [refsFor, setRefsFor] = useState<string | null>(null)
  const [refs, setRefs] = useState<Record<string, SecretReferencesResponse | 'loading' | 'error'>>({})

  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  useEffect(() => { if (isConnected) fetchSecrets(scope) }, [fetchSecrets, isConnected, scope])

  const filtered = useMemo(
    () => entries.filter((e) => e.key.toLowerCase().includes(search.toLowerCase())),
    [entries, search],
  )

  const trimmedKey = newKey.trim()
  const keyValid = NAME_RE.test(trimmedKey)
  const keyExists = keys.includes(trimmedKey)

  const closeAdd = () => {
    setShowAddModal(false)
    setNewKey(''); setNewValue(''); setKeyError(''); setShowValue(false); setConfirmReplace(false)
  }

  const handleGenerate = () => {
    setNewValue(generateSecret())
    setShowValue(true)
  }

  const handleAdd = useCallback(async () => {
    if (!keyValid) {
      setKeyError('Use letters, digits and underscores, starting with a letter — e.g. HOMARR_PASSWORD')
      return
    }
    if (!newValue) { setKeyError('Value is required'); return }
    if (keyExists && !confirmReplace) { setConfirmReplace(true); return }
    if (scope === 'all') { addToast({ type: 'info', message: 'Everywhere is a view: pick the hub or one VM above, then change it there' }); return }
    const result = await setSecret(trimmedKey, newValue, scopeMember)
    if (result) {
      addToast({
        type: 'success',
        message: `${result.replaced ? 'Replaced' : 'Stored'} ${trimmedKey}. Reference it as ${result.reference}${result.replaced ? ' and restart stacks that use it.' : '.'}`,
      })
      setRefs((prev) => { const next = { ...prev }; delete next[secretKey({ member: scopeMember, key: trimmedKey })]; return next })
      closeAdd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyValid, keyExists, confirmReplace, newValue, trimmedKey, setSecret, addToast, scope, scopeMember])

  /** Delete: ask first (the shared confirmation, focus on Cancel), then remove it from the server that keeps it */
  const handleDelete = useCallback(async (entry: SecretEntry) => {
    if (scope === 'all') { addToast({ type: 'info', message: 'Everywhere is a view: pick the hub or one VM above, then change it there' }); return }
    const where = entry.member !== undefined && entry.member ? ` on the VM ${entry.member_name ?? entry.member}` : ''
    const ok = await confirm({
      title: 'Delete this secret?',
      message: `Delete ${entry.key}${where}? Stacks that reference it will refuse to start. This cannot be undone.`,
      confirmLabel: 'Delete secret',
      danger: true,
    })
    if (!ok) return
    const done = await deleteSecret(entry.key, scopeMember)
    if (done) addToast({ type: 'success', message: `Deleted ${entry.key}` })
  }, [deleteSecret, addToast, scope, scopeMember, confirm])

  const copyReference = async (entry: SecretEntry) => {
    const id = secretKey(entry)
    try {
      await navigator.clipboard.writeText(referenceFor(entry.key))
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
    } catch {
      addToast({ type: 'error', message: 'Clipboard is not available' })
    }
  }

  const toggleReferences = async (entry: SecretEntry) => {
    const id = secretKey(entry)
    if (refsFor === id) { setRefsFor(null); return }
    setRefsFor(id)
    if (refs[id] && refs[id] !== 'error') return
    setRefs((prev) => ({ ...prev, [id]: 'loading' }))
    try {
      const r = await fetchSecretReferences(entry.key, entry.member ?? scopeMember)
      setRefs((prev) => ({ ...prev, [id]: r }))
    } catch {
      setRefs((prev) => ({ ...prev, [id]: 'error' }))
    }
  }

  /** the fields of the add dialog: mono, one focus ring */
  const inputClass = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-200 font-mono placeholder-slate-600 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40'

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="secrets"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        subtitle={entries.length > 0 ? `${entries.length} encrypted value${entries.length === 1 ? '' : 's'} · injected into stacks at start` : undefined}
        actions={<>
          <button type="button" aria-label="Refresh" onClick={() => fetchSecrets(scope)} disabled={loading} className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Hint label={showGuide ? 'Hide the guide' : 'Show the guide'}>
            <button
              type="button"
              aria-label="Guide"
              aria-expanded={showGuide}
              onClick={() => setShowGuide(!showGuide)}
              className={`${BTN_TOOLBAR} ${showGuide ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">Guide</span>
            </button>
          </Hint>
          {isAdmin && (
            <button type="button" onClick={() => setShowAddModal(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              <Plus size={14} /> Add secret
            </button>
          )}
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={loading && entries.length > 0} />}
      </PageHeader>

      {/* Guide */}
      {showGuide && (
        <section aria-label={`${pageLabel('secrets')} guide`} className="glass rounded-xl border border-white/5 overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-200">{pageLabel('secrets')} guide</h2>
            </div>
            <Hint label="Close the guide">
              <CloseButton label="Close the guide" size="sm" onClick={() => setShowGuide(false)} />
            </Hint>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-400">
              Store passwords, API keys and tokens once, reference them as <span className="text-cyan-300 font-mono text-xs">{'${SECRETS_NAME}'}</span> anywhere, and let DCS inject them when a stack starts. Only admins can manage secrets.
            </p>
            {GUIDE_SECTIONS.map((section, i) => {
              const Icon = section.icon
              const open = guideSection === i
              return (
                <div key={section.title} className="border border-white/[0.03] rounded-lg overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setGuideSection(open ? null : i)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
                  >
                    <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />
                    <span className="text-sm font-medium text-slate-200 flex-1">{section.title}</span>
                    {open ? <ChevronDown size={14} className="text-slate-500" aria-hidden /> : <ChevronRight size={14} className="text-slate-500" aria-hidden />}
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-3 text-[11px] text-slate-400 space-y-2 border-t border-white/[0.03] animate-fade-in">
                      {section.body}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Search */}
      <div className="relative">
        <SearchInput value={search} onChange={setSearch} label="Search the secrets" placeholder="Search secrets…" />
      </div>

      {error && <ErrorState title="Something went wrong with the secrets" error={error} onRetry={() => fetchSecrets(scope)} />}

      {/* Cards */}
      {loading && entries.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-label="Reading the secrets">
          {[1, 2, 3].map((i) => <div key={i} className="glass rounded-xl p-4 h-24 skeleton" aria-hidden />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-xl border border-white/5">
          <EmptyState
            icon={<KeyRound size={32} />}
            title={search ? 'No secrets match your search' : 'No secrets stored yet'}
            hint={isAdmin ? 'Add a secret, then reference it as ${SECRETS_NAME} in a compose file or .env' : 'An admin can add secrets here'}
            action={isAdmin && !search ? (
              <button type="button" onClick={() => setShowAddModal(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                <Plus size={14} /> Add secret
              </button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filtered.map((entry) => {
            const id = secretKey(entry)
            const r = refs[id]
            const open = refsFor === id
            return (
              <div key={id} className="glass rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors animate-fade-in">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0" aria-hidden>
                      <Shield className="w-4 h-4 text-slate-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-mono text-slate-100 truncate" title={entry.key}>{entry.key}{entry.member !== undefined && <span className="ml-2 align-middle"><VmCapsule member={entry.member} name={entry.member_name} vmid={entry.vmid} size="xs" onClick={() => setScope(entry.member ?? 'hub')} /></span>}</p>
                      <p className="text-[10px] text-slate-500 truncate">{entry.modified ? `Updated ${formatDate(entry.modified)}` : 'Encrypted'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Hint label="Copy the placeholder for compose and .env files">
                      <button type="button" onClick={() => copyReference(entry)} aria-label={`Copy the placeholder of ${entry.key}`} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                        {copied === id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </Hint>
                    <Hint label="Where is this secret used?">
                      <button
                        type="button"
                        onClick={() => toggleReferences(entry)}
                        aria-label={`${open ? 'Hide' : 'Show'} where ${entry.key} is used`}
                        aria-expanded={open}
                        className={`${BTN_ICON_SM} ${open ? 'text-cyan-400 bg-cyan-500/10' : TONE_GHOST}`}
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                    </Hint>
                    {isAdmin && (
                      <Hint label="Delete">
                        <button type="button" onClick={() => handleDelete(entry)} disabled={saving} aria-label={`Delete ${entry.key}`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Hint>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-[10px] font-mono text-slate-500 truncate">{referenceFor(entry.key)}</p>
                {open && (
                  <div className="mt-2 pt-2 border-t border-white/5 text-[11px] animate-fade-in">
                    {r === 'loading' || !r ? (
                      <p className="text-slate-500 flex items-center gap-1.5" role="status"><Loader2 size={11} className="animate-spin" /> Looking for references…</p>
                    ) : r === 'error' ? (
                      <p className="text-rose-400">Could not load references</p>
                    ) : r.stacks.length === 0 && !r.root_env ? (
                      <p className="text-slate-500">Not referenced yet. Add <span className="font-mono text-cyan-300">{r.reference}</span> to a compose file or .env.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-slate-400 flex items-center gap-1.5"><Layers size={11} className="text-slate-400" aria-hidden /> Used by</p>
                        <div className="flex flex-wrap gap-1">
                          {r.stacks.map((st) => (
                            <span key={st} className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono text-[10px]">{st}</span>
                          ))}
                          {r.root_env && <span className="px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-300 font-mono text-[10px]">root .env</span>}
                        </div>
                        <p className="text-slate-500">Restart these stacks after changing the value.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add dialog */}
      {/* the token a dashboard that cannot sign in reads the server with (this server's own; not a VM's) */}
      {isAdmin && !scopeMember && <DashboardFeedCard />}
      {isAdmin && !scopeMember && <ApiKeysCard />}
      {showAddModal && createPortal(
        <ModalOverlay onClose={closeAdd} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={closeAdd}>
          <div className="glass rounded-2xl p-6 w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto border border-white/10 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-100">Add secret</h2>
              <CloseButton onClick={closeAdd} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAdd() }} className="space-y-4">
              <div>
                <label htmlFor="secret-name" className="block text-sm text-slate-400 mb-1">Name</label>
                <input
                  id="secret-name"
                  value={newKey}
                  onChange={(e) => { setNewKey(e.target.value.replace(/[\s-]+/g, '_')); setKeyError(''); setConfirmReplace(false) }}
                  placeholder="HOMARR_PASSWORD"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inputClass} ${trimmedKey && !keyValid ? '!border-rose-500/40' : ''}`}
                />
                <p className="text-[10px] text-slate-500 mt-1 font-mono truncate">
                  {trimmedKey ? (keyValid ? `Reference: ${referenceFor(trimmedKey)}` : 'Letters, digits and underscores only, starting with a letter') : 'Letters, digits and underscores — UPPER_SNAKE reads best'}
                </p>
                {keyExists && <p className="text-[10px] text-amber-400 mt-1">A secret with this name exists; saving replaces its value.</p>}
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label htmlFor="secret-value" className="text-sm text-slate-400">Value</label>
                  <button type="button" onClick={handleGenerate} className="flex items-center gap-1 h-8 px-2 rounded-lg text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                    <Wand2 size={12} /> Generate {GENERATED_LENGTH}-character value
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    id="secret-value"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    className={`${inputClass} pr-11 resize-none ${showValue ? '' : 'text-security-disc'}`}
                    style={showValue ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
                  />
                  <Hint label={showValue ? 'Hide the value' : 'Show the value'}>
                    <button type="button" onClick={() => setShowValue(!showValue)} aria-label={showValue ? 'Hide the value' : 'Show the value'} aria-pressed={showValue} className={`absolute right-1.5 top-1.5 ${BTN_ICON_SM} ${TONE_GHOST}`}>
                      {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </Hint>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Stored encrypted; never shown again after saving.</p>
              </div>
              {keyError && <p className="text-sm text-rose-400" role="alert">{keyError}</p>}
              {confirmReplace && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300" role="alert">
                  Replace the existing value of <span className="font-mono">{trimmedKey}</span>? Stacks that use it keep the old value until they are restarted.
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeAdd} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
                <button type="submit" disabled={saving || !trimmedKey || !newValue} className={`${confirmReplace ? BTN_SHEET_DANGER : BTN_SHEET_PRIMARY} flex-1`}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {confirmReplace ? 'Replace' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}
