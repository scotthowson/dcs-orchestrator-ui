// =============================================================================
// AppSettings — Settings → Application preferences: layout,
// personal preferences, Discord Rich Presence (desktop app) and the reset
// =============================================================================

import React, { useState, useCallback, useEffect } from 'react'
import { Layout, RotateCcw, User, Gamepad2,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK, SECTION_LABEL } from '../../lib/ui'
import { FIELD } from '../../lib/fieldStyles'
import type { PageId } from '../../../shared/types'
import type { AppSettings as AppSettingsType } from '../../../shared/types'

import { Toggle } from '../common/Toggle'
// ---------------------------------------------------------------------------
// Defaults (must match settingsStore defaults)
// ---------------------------------------------------------------------------

const DEFAULTS: Pick<
  AppSettingsType,
  'pollingInterval' | 'containerPollingInterval' | 'imagePollingInterval' | 'logPollingInterval' | 'sidebarCollapsed'
> = {
  pollingInterval: 10000,
  containerPollingInterval: 5000,
  imagePollingInterval: 60000,
  logPollingInterval: 3000,
  sidebarCollapsed: false,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// The four "polling interval" fields that were here are gone: nothing read them (every poll runs at the fixed
// rates of docs/data-layer.md), so they changed nothing. The stored keys stay, harmless, and Reset puts them back.
const POLL_KEYS = ['pollingInterval', 'containerPollingInterval', 'imagePollingInterval', 'logPollingInterval'] as const

export default function AppSettingsForm({ onDirtyChange, onRegisterSave }: {
  onDirtyChange?: (dirty: boolean) => void
  onRegisterSave?: (save: () => void, discard: () => void) => void
} = {}) {
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)

  const handleReset = useCallback(() => {
    for (const key of POLL_KEYS) updateSetting(key, DEFAULTS[key])
    if (sidebarCollapsed !== DEFAULTS.sidebarCollapsed) {
      toggleSidebar()
    }
  }, [updateSetting, sidebarCollapsed, toggleSidebar])

  // every choice here takes effect at once: nothing waits for a Save
  useEffect(() => { onDirtyChange?.(false) }, [onDirtyChange])
  useEffect(() => { onRegisterSave?.(() => {}, () => {}) }, [onRegisterSave])

  return (
    <div className="space-y-6">
      {/* Appearance */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Layout size={14} className="accent-text" />
          <h3 className={SECTION_LABEL}>Layout</h3>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-slate-300">Sidebar collapsed</p>
            <p className="text-xs text-slate-500">Start with a compact sidebar</p>
          </div>
          <Toggle label="Sidebar collapsed" checked={sidebarCollapsed} onChange={() => toggleSidebar()} />
        </div>
      </div>

      {/* Personal */}
      <PersonalSettings />

      {/* Discord Rich Presence — desktop app only */}
      {typeof window !== 'undefined' && window.electronAPI?.presenceStatus && <DiscordPresenceSettings />}

      {/* Reset to defaults */}
      <div className="flex items-center pt-2 border-t border-white/5">
        <button onClick={handleReset} className={BTN_TOOLBAR_QUIET}>
          <RotateCcw size={14} />
          Reset to defaults
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Personal preferences
// ---------------------------------------------------------------------------

const LANDING_PAGES: { id: PageId; label: string }[] = (['dashboard', 'stacks', 'containers', 'health', 'topology', 'updates', 'templates', 'logs', 'activity'] as const)
  .map((id) => ({ id, label: pageLabel(id) }))

function PersonalSettings() {
  const defaultPage = useSettingsStore((s) => s.defaultPage)
  const use24hClock = useSettingsStore((s) => s.use24hClock)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <User size={14} className="accent-text" />
        <h3 className={SECTION_LABEL}>Personal</h3>
      </div>

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-slate-300">Start on</p>
          <p className="text-xs text-slate-500">The page that opens right after you sign in</p>
        </div>
        <select aria-label="Start on"
          value={defaultPage ?? 'dashboard'}
          onChange={(e) => updateSetting('defaultPage', e.target.value as PageId)}
          className={FIELD}
        >
          {LANDING_PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-slate-300">24-hour clock</p>
          <p className="text-xs text-slate-500">The clock in the status bar ({use24hClock !== false ? '13:05' : '1:05 PM'})</p>
        </div>
        <Toggle label="24-hour clock" checked={use24hClock !== false} onChange={(v) => updateSetting('use24hClock', v)} />
      </div>

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-slate-300">Reduce motion</p>
          <p className="text-xs text-slate-500">Skip animations and transitions everywhere</p>
        </div>
        <Toggle label="Reduce motion" checked={!!reduceMotion} onChange={(v) => updateSetting('reduceMotion', v)} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discord Rich Presence (desktop app)
// ---------------------------------------------------------------------------

function DiscordPresenceSettings() {
  const [enabled, setEnabled] = useState(false)
  const [clientId, setClientId] = useState('')
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean; clientId: string; error: string; lastSentAt?: number; user?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const refreshStatus = useCallback(async () => {
    try { const s = await window.electronAPI?.presenceStatus?.(); if (s) setStatus(s) } catch { /* not in Electron */ }
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    Promise.all([api.getSetting('discordPresenceEnabled'), api.getSetting('discordClientId')])
      .then(([en, id]) => { setEnabled(en === true); setClientId(typeof id === 'string' ? id : '') })
      .catch(() => {})
    void refreshStatus()
    const t = setInterval(() => void refreshStatus(), 5000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const save = async (nextEnabled: boolean, nextId: string) => {
    const api = window.electronAPI
    if (!api) return
    setSaving(true)
    try {
      await api.setSetting('discordClientId', nextId.trim())
      await api.setSetting('discordPresenceEnabled', nextEnabled)
      const s = await api.presenceConfigure?.()
      if (s) setStatus(s)
    } finally {
      setSaving(false)
    }
  }

  const idOk = /^[0-9]{15,22}$/.test(clientId.trim())
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Gamepad2 size={14} className="text-indigo-400" />
        <h3 className={SECTION_LABEL}>Discord Rich Presence</h3>
        {status && (
          <span className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.connected ? 'bg-emerald-500/15 text-emerald-400' : status.enabled ? 'bg-amber-500/15 text-amber-400' : 'bg-white/[0.06] text-slate-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-emerald-400' : status.enabled ? 'bg-amber-400' : 'bg-slate-500'}`} />
            {status.connected ? `Connected${status.user ? ` as ${status.user}` : ''}` : status.enabled ? (status.error ? 'Discord not reachable' : 'Connecting…') : 'Off'}
          </span>
        )}
      </div>
      {status?.connected && (
        <p className="text-[11px] text-slate-500 -mt-1 mb-1">
          {status.lastSentAt ? `Last activity sent ${Math.max(0, Math.round((Date.now() - status.lastSentAt) / 1000))} s ago — open your Discord profile to see it.` : 'Connected, sending the first activity…'}
        </p>
      )}
      <p className="text-xs text-slate-500 mb-2">
        Shows “Managing {'{server}'}” with your container, stack and health counts on your Discord profile while this app is open. It talks to the Discord app on this computer; nothing is sent anywhere else.
      </p>

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-slate-300">Show my server on Discord</p>
          <p className="text-xs text-slate-500">Needs the Discord desktop app running and an Application ID below</p>
        </div>
        <Toggle label="Show my server on Discord" checked={enabled} onChange={(v) => { setEnabled(v); void save(v, clientId) }} />
      </div>

      <div className="py-2">
        <label htmlFor="presence-app-id" className="block text-sm font-medium text-slate-300 mb-1">Discord application ID</label>
        <div className="flex gap-2">
          <input
            id="presence-app-id"
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="123456789012345678"
            className={`flex-1 min-w-0 font-mono ${FIELD}`}
          />
          <button
            type="button"
            onClick={() => void save(enabled, clientId)}
            disabled={saving || (!!clientId && !idOk)}
            className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0`}
          >
            {saving ? 'Saving…' : 'Save and reconnect'}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Not showing up? In Discord open User Settings → Activity Privacy and turn on “Share your detected activities with others” and “Display current activity as a status message”. Your own profile (click your avatar) shows it as “Playing DCS Orchestrator” (the name of your Discord application).
        </p>
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
          Create an application at <span className="font-mono">discord.com/developers/applications</span> named “DCS Orchestrator”, copy its Application ID here, and under Rich Presence → Art Assets upload three images named <span className="font-mono">dcs</span> (the big icon), <span className="font-mono">healthy</span> and <span className="font-mono">warning</span> (the small badge).
        </p>
        {status?.error && <p className="text-[11px] text-amber-400 mt-1">{status.error}</p>}
        <p className="text-[11px] text-slate-500 mt-2">
          The Discord portal asks for these two links: <a href="https://github.com/scotthowson/dcs-orchestrator-ui/blob/legal/TERMS.md" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Terms of Service</a> · <a href="https://github.com/scotthowson/dcs-orchestrator-ui/blob/legal/PRIVACY.md" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}
