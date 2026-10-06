// =============================================================================
// AppSettings — Settings → Application preferences: polling intervals, layout,
// personal preferences, Discord Rich Presence (desktop app) and the reset
// =============================================================================

import React, { useState, useCallback, useEffect } from 'react'
import { Switch as MantineSwitch } from '@mantine/core'
import { Timer, Layout, RotateCcw, User, Gamepad2,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK } from '../../lib/ui'
import { FIELD, SUBHEAD } from '../../lib/fieldStyles'
import type { PageId } from '../../../shared/types'
import type { AppSettings as AppSettingsType } from '../../../shared/types'

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
// Interval input descriptor
// ---------------------------------------------------------------------------

interface IntervalField {
  key: keyof Pick<AppSettingsType, 'pollingInterval' | 'containerPollingInterval' | 'imagePollingInterval' | 'logPollingInterval'>
  label: string
  description: string
  min: number
  max: number
}

const intervalFields: IntervalField[] = [
  {
    key: 'pollingInterval',
    label: 'Dashboard polling',
    description: 'How often the dashboard overview refreshes',
    min: 2,
    max: 120,
  },
  {
    key: 'containerPollingInterval',
    label: 'Container polling',
    description: 'Refresh interval for container listings',
    min: 2,
    max: 120,
  },
  {
    key: 'imagePollingInterval',
    label: 'Image polling',
    description: 'Refresh interval for image data',
    min: 10,
    max: 600,
  },
  {
    key: 'logPollingInterval',
    label: 'Log polling',
    description: 'How often the log viewer fetches new entries',
    min: 1,
    max: 60,
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AppSettingsForm({ onDirtyChange, onRegisterSave }: {
  onDirtyChange?: (dirty: boolean) => void
  onRegisterSave?: (save: () => void, discard: () => void) => void
} = {}) {
  const pollingInterval = useSettingsStore((s) => s.pollingInterval)
  const containerPollingInterval = useSettingsStore((s) => s.containerPollingInterval)
  const imagePollingInterval = useSettingsStore((s) => s.imagePollingInterval)
  const logPollingInterval = useSettingsStore((s) => s.logPollingInterval)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)

  // Local state for interval inputs (display in seconds)
  const [localIntervals, setLocalIntervals] = useState<Record<string, number>>({
    pollingInterval: pollingInterval / 1000,
    containerPollingInterval: containerPollingInterval / 1000,
    imagePollingInterval: imagePollingInterval / 1000,
    logPollingInterval: logPollingInterval / 1000,
  })

  const [dirty, setDirty] = useState(false)

  // Sync from store when values change externally
  useEffect(() => {
    setLocalIntervals({
      pollingInterval: pollingInterval / 1000,
      containerPollingInterval: containerPollingInterval / 1000,
      imagePollingInterval: imagePollingInterval / 1000,
      logPollingInterval: logPollingInterval / 1000,
    })
  }, [pollingInterval, containerPollingInterval, imagePollingInterval, logPollingInterval])

  const handleIntervalChange = useCallback((key: string, value: number) => {
    setLocalIntervals((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }, [])

  const handleSave = useCallback(() => {
    for (const field of intervalFields) {
      const seconds = localIntervals[field.key] ?? DEFAULTS[field.key] / 1000
      const clamped = Math.max(field.min, Math.min(field.max, seconds))
      updateSetting(field.key, clamped * 1000)
    }
    setDirty(false)
  }, [localIntervals, updateSetting])

  const handleDiscard = useCallback(() => {
    setLocalIntervals({
      pollingInterval: pollingInterval / 1000,
      containerPollingInterval: containerPollingInterval / 1000,
      imagePollingInterval: imagePollingInterval / 1000,
      logPollingInterval: logPollingInterval / 1000,
    })
    setDirty(false)
  }, [pollingInterval, containerPollingInterval, imagePollingInterval, logPollingInterval])

  const handleReset = useCallback(() => {
    for (const field of intervalFields) {
      updateSetting(field.key, DEFAULTS[field.key])
    }
    if (sidebarCollapsed !== DEFAULTS.sidebarCollapsed) {
      toggleSidebar()
    }
    setLocalIntervals({
      pollingInterval: DEFAULTS.pollingInterval / 1000,
      containerPollingInterval: DEFAULTS.containerPollingInterval / 1000,
      imagePollingInterval: DEFAULTS.imagePollingInterval / 1000,
      logPollingInterval: DEFAULTS.logPollingInterval / 1000,
    })
    setDirty(false)
  }, [updateSetting, sidebarCollapsed, toggleSidebar])

  // Report dirty state to parent
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onRegisterSave?.(handleSave, handleDiscard) }, [handleSave, handleDiscard, onRegisterSave])

  return (
    <div className="space-y-6">
      {/* Polling intervals */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Timer size={14} className="accent-text" />
          <h3 className={SUBHEAD}>Polling intervals</h3>
        </div>

        <div className="space-y-4">
          {intervalFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-slate-300">{field.label}</label>
                  <p className="text-xs text-slate-500">{field.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input aria-label={`${field.label} (seconds)`}
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={localIntervals[field.key] ?? field.min}
                    onChange={(e) => handleIntervalChange(field.key, Number(e.target.value))}
                    className={`w-20 text-right font-mono ${FIELD}`}
                  />
                  <span className="text-xs text-slate-500 w-5">sec</span>
                </div>
              </div>
              {/* Range slider */}
              <input aria-label={field.label}
                type="range"
                min={field.min}
                max={field.max}
                value={localIntervals[field.key] ?? field.min}
                onChange={(e) => handleIntervalChange(field.key, Number(e.target.value))}
                className="
                  w-full h-1.5 rounded-full appearance-none cursor-pointer
                  bg-slate-800
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:h-3.5
                  [&::-webkit-slider-thumb]:w-3.5
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-emerald-400
                  [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(52,211,153,0.4)]
                  [&::-webkit-slider-thumb]:cursor-pointer
                "
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>{field.min}s</span>
                <span>{field.max}s</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Layout size={14} className="accent-text" />
          <h3 className={SUBHEAD}>Layout</h3>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium text-slate-300">Sidebar collapsed</p>
            <p className="text-xs text-slate-500">Start with a compact sidebar</p>
          </div>
          <Switch label="Sidebar collapsed" on={sidebarCollapsed} onChange={() => toggleSidebar()} />
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

const LANDING_PAGES: { id: PageId; label: string }[] = (['dashboard', 'stacks', 'containers', 'health', 'uptime', 'topology', 'updates', 'templates', 'logs', 'activity'] as const)
  .map((id) => ({ id, label: pageLabel(id) }))

/** the dashboard's toggle (a Mantine Switch, themed in lib/mantine.tsx), named for a screen reader */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <MantineSwitch checked={on} onChange={() => onChange(!on)} aria-label={label} />
}

function PersonalSettings() {
  const defaultPage = useSettingsStore((s) => s.defaultPage)
  const use24hClock = useSettingsStore((s) => s.use24hClock)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <User size={14} className="accent-text" />
        <h3 className={SUBHEAD}>Personal</h3>
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
        <Switch label="24-hour clock" on={use24hClock !== false} onChange={(v) => updateSetting('use24hClock', v)} />
      </div>

      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-slate-300">Reduce motion</p>
          <p className="text-xs text-slate-500">Skip animations and transitions everywhere</p>
        </div>
        <Switch label="Reduce motion" on={!!reduceMotion} onChange={(v) => updateSetting('reduceMotion', v)} />
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
        <h3 className={SUBHEAD}>Discord Rich Presence</h3>
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
        <Switch label="Show my server on Discord" on={enabled} onChange={(v) => { setEnabled(v); void save(v, clientId) }} />
      </div>

      <div className="py-2">
        <label htmlFor="presence-app-id" className="block text-sm font-medium text-slate-300 mb-1">Discord Application ID</label>
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
