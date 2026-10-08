// =============================================================================
// Settings — connection, profile, appearance, themes, preferences, security.
// Its sections fold (SectionCard); one floating bar saves the ones that changed.
// =============================================================================

import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { Switch as MantineSwitch } from '@mantine/core'
import {
  Cog, Info, HardDrive, Pencil, Check, X, Trash2,
  Keyboard, Timer, Image, Sun, Moon, Palette, Eye, TerminalSquare,
  Monitor, Shield, Lock, User, UserCircle, Mail,
  Camera, Save, Key, AlertTriangle, XCircle, ShieldOff, Plus, FolderPlus,
  Download, Upload, Bell, BellOff, Clock, LockKeyhole,
  Server, Copy, EyeOff, HeartPulse, Wifi, WifiOff, Loader2,
  Star, CheckCircle, ChevronDown, PanelLeft, LogOut, KeyRound,
} from 'lucide-react'
import { isMobile as isMobileDevice } from '../hooks/useMobile'
import ConnectionForm from '../components/settings/ConnectionForm'
import AppSettingsForm from '../components/settings/AppSettings'
import ThemesPanel from '../components/settings/ThemesPanel'
import WebTerminalCard from '../components/settings/WebTerminalCard'
import { useSystemMode } from '../lib/colorMode'
import { CSS_SANITIZE_NOTE } from '../lib/cssSanitize'
import { useConnectionStore } from '../stores/connectionStore'
import { useServerStore } from '../stores/serverStore'
import { rememberPassword } from '../lib/credentials'
import { accountLine } from '../components/auth/ServerGateScreens'
import { discoverServerVerdict, blockedText, type DiscoveredServer } from '../lib/discover'
import { useToast } from '../components/common/Toast'
import { useSettingsStore, DEFAULT_SETTINGS } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useNotificationStore } from '../stores/notificationStore'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { navSections } from '../constants/navSections'
import SidebarPagesPanel from '../components/settings/SidebarPagesPanel'
import { DEFAULT_APP_NAME } from '../hooks/useBrand'
import { OLD_DEFAULT_SUBTITLES } from '../stores/settingsStore'
import {
  BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM,
  TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER,
} from '../lib/ui'
import { FIELD, INPUT, LABEL, FOCUS_RING as FOCUS, CHOICE, CHOICE_ON, CHOICE_OFF, SUBHEAD } from '../lib/fieldStyles'
import { usePolling } from '../hooks/usePolling'
import { FloatingSaveBar } from '../components/common/FloatingSaveBar'
import { fetchVersion, fetchDisks, fetchAlertConfig, updateAlertConfig, updateConfig, fetchConfig, authVerify, authChangePassword } from '../api/endpoints'
import { ApiError } from '../api/client'
import { patchServerProfile, syncProfileFromServer, readLocalProfile, mergeServerProfile, cleanPrefs, PROFILE_KEYS, SYNCED_PREFS } from '../lib/userSync'
import type { APIVersion, DiskInfo, CustomDiskEntry, AppSettings, AlertThresholds, PageId } from '../../shared/types'

// ---------------------------------------------------------------------------
// Settings Dirty Context — single FloatingSaveBar for all sections
// ---------------------------------------------------------------------------

interface DirtyEntry {
  save: () => void | Promise<void>
  discard: () => void
}

interface SettingsDirtyCtx {
  markDirty: (section: string, entry: DirtyEntry) => void
  markClean: (section: string) => void
}

const SettingsDirtyContext = createContext<SettingsDirtyCtx>({
  markDirty: () => {},
  markClean: () => {},
})

function useSettingsDirty(section: string, isDirty: boolean, save: () => void | Promise<void>, discard: () => void) {
  const ctx = useContext(SettingsDirtyContext)
  // Keep latest callbacks in refs to avoid stale closures
  const saveRef = useRef(save)
  const discardRef = useRef(discard)
  saveRef.current = save
  discardRef.current = discard

  useEffect(() => {
    if (isDirty) {
      ctx.markDirty(section, {
        save: () => saveRef.current(),
        discard: () => discardRef.current(),
      })
    } else {
      ctx.markClean(section)
    }
  }, [isDirty, section, ctx])
  // Clean up on unmount
  useEffect(() => () => ctx.markClean(section), [section, ctx])
}

// ---------------------------------------------------------------------------
// User Profile Editor
// ---------------------------------------------------------------------------

interface ProfileData {
  displayName: string
  email: string
  icon: string
  bio: string
  statusEmoji: string
  statusText: string
  timezone: string
  accentColor: string
  backgroundImage: string
}

/** Get the per-user localStorage key for profile data */
function getProfileKey(): string {
  const user = useAuthStore.getState().currentUser
  return user ? `user-profile-${user}` : 'user-profile'
}

function getProfileData(): ProfileData {
  const defaults: ProfileData = { displayName: '', email: '', icon: '', bio: '', statusEmoji: '', statusText: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, accentColor: 'emerald', backgroundImage: '' }
  try {
    // Try per-user key first, then fallback to legacy global key (migration)
    const key = getProfileKey()
    let raw = localStorage.getItem(key)
    if (!raw && key !== 'user-profile') raw = localStorage.getItem('user-profile')
    const parsed = raw ? JSON.parse(raw) : {}
    // Older builds stored the emoji as its JSON escape text ("\\uD83D\\uDFE2"): decode it once
    if (typeof parsed.statusEmoji === 'string' && /^(\\u[0-9A-Fa-f]{4})+$/.test(parsed.statusEmoji)) {
      try { parsed.statusEmoji = JSON.parse('"' + parsed.statusEmoji + '"') } catch { parsed.statusEmoji = '' }
    }
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

function saveProfileData(data: ProfileData) {
  const key = getProfileKey()
  localStorage.setItem(key, JSON.stringify(data))
  // Dispatch event so Header and App re-read the data
  window.dispatchEvent(new Event('profile-updated'))
  // Sync to server in background (fire-and-forget); the server's document is read first, so the choices stored beside the profile survive
  const isConnected = useConnectionStore.getState().status === 'connected'
  if (isConnected) {
    void patchServerProfile(data as unknown as Record<string, unknown>)
  }
}

function ProfileSettings() {
  const { currentUser } = useAuthStore()
  const { addToast } = useToast()
  const [profile, setProfile] = useState<ProfileData>(getProfileData)
  const [initialProfile, setInitialProfile] = useState<ProfileData>(getProfileData)
  const [avatarPreview, setAvatarPreview] = useState(profile.icon)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Read the server's copy again when the page opens (sign-in has done it already; this catches a change made on another device meanwhile)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  useEffect(() => {
    if (!isConnected || !currentUser) return
    let cancelled = false
    syncProfileFromServer(currentUser).then((ok) => {
      if (cancelled || !ok) return
      const merged = getProfileData()
      setProfile(merged)
      setInitialProfile(merged)
      setAvatarPreview(merged.icon)
    })
    return () => { cancelled = true }
  }, [isConnected, currentUser])

  const userInitial = (currentUser?.[0] ?? 'U').toUpperCase()

  // Dirty tracking — compare current vs initial (exclude backgroundImage, managed elsewhere)
  const isDirty = JSON.stringify({ ...profile, backgroundImage: '' }) !== JSON.stringify({ ...initialProfile, backgroundImage: '' })

  const handleChange = (key: keyof ProfileData, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = useCallback(() => {
    const current = getProfileData()
    saveProfileData({ ...profile, backgroundImage: current.backgroundImage })
    setInitialProfile({ ...profile, backgroundImage: current.backgroundImage })
  }, [profile])

  const handleDiscard = useCallback(() => {
    setProfile(initialProfile)
    setAvatarPreview(initialProfile.icon)
  }, [initialProfile])

  useSettingsDirty('profile', isDirty, handleSave, handleDiscard)

  const handleAvatarUrlChange = (url: string) => {
    handleChange('icon', url)
    setAvatarPreview(url)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      addToast({ type: 'error', message: 'Image must be under 2MB' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      handleChange('icon', dataUrl)
      setAvatarPreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-5">
      {/* Avatar section */}
      <div className="flex items-start gap-5">
        <div className="relative group">
          {avatarPreview && avatarPreview.length > 2 ? (
            <img
              src={avatarPreview}
              alt="Profile"
              className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover ring-2 ring-emerald-500/20 shadow-lg"
              onError={() => setAvatarPreview('')}
            />
          ) : avatarPreview ? (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-slate-800/80 border border-white/10 flex items-center justify-center text-3xl shadow-lg">
              {avatarPreview}
            </div>
          ) : (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-emerald-500/20">
              {userInitial}
            </div>
          )}
          <button aria-label="Upload a profile picture"
            onClick={() => fileInputRef.current?.click()}
            className={`absolute inset-0 rounded-2xl flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 cursor-pointer ${FOCUS}`}
          >
            <Camera size={20} className="text-white" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-200 mb-1">Profile picture</h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Choose a preset, upload an image, or paste a URL. Max 2MB for uploads.
          </p>
          {/* Preset avatar icons */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {['🐳', '🚀', '⚡', '🔥', '🎯', '💎', '🌊', '🦊', '🐧', '🤖', '👨‍💻', '👩‍💻', '🛡️', '🌟', '🎮', '🧠'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={profile.icon === emoji}
                onClick={() => { handleChange('icon', emoji); setAvatarPreview(emoji) }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-base hover:bg-white/10 transition-all ${FOCUS} ${
                  profile.icon === emoji ? 'bg-emerald-500/20 ring-1 ring-emerald-500/40' : 'bg-white/5'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <input
            aria-label="Picture address"
            type="text"
            value={profile.icon}
            onChange={(e) => handleAvatarUrlChange(e.target.value)}
            placeholder="https://example.com/avatar.png"
            className={`${INPUT} font-mono`}
          />
        </div>
      </div>

      {/* Display Name */}
      <div>
        <label htmlFor="profile-display-name" className={`flex items-center gap-1.5 ${LABEL}`}>
          <UserCircle size={12} />
          Display name
        </label>
        <input
          id="profile-display-name"
          type="text"
          value={profile.displayName}
          onChange={(e) => handleChange('displayName', e.target.value)}
          placeholder={currentUser ?? 'Your name'}
          className={INPUT}
        />
      </div>

      {/* Email */}
      <div>
        <label htmlFor="profile-email" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Mail size={12} />
          Email address
        </label>
        <input
          id="profile-email"
          type="email"
          value={profile.email}
          onChange={(e) => handleChange('email', e.target.value)}
          placeholder="you@example.com"
          className={INPUT}
        />
      </div>

      {/* Bio */}
      <div>
        <label htmlFor="profile-bio" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Pencil size={12} />
          Bio
        </label>
        <textarea
          id="profile-bio"
          value={profile.bio}
          onChange={(e) => handleChange('bio', e.target.value)}
          placeholder="A short description about yourself..."
          rows={3}
          className={`${INPUT} resize-none`}
        />
      </div>

      {/* Status */}
      <div>
        <label htmlFor="profile-status" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Eye size={12} />
          Status
        </label>
        <div className="flex flex-col gap-2">
          <select id="profile-status"
            value={profile.statusEmoji}
            onChange={(e) => handleChange('statusEmoji', e.target.value)}
            className={INPUT}
          >
            <option value="">Select status…</option>
            <option value={'\uD83D\uDFE2'}>{'\uD83D\uDFE2'} Online</option>
            <option value={'\uD83D\uDFE1'}>{'\uD83D\uDFE1'} Away</option>
            <option value={'\uD83D\uDD34'}>{'\uD83D\uDD34'} Busy</option>
            <option value={'\u26AB'}>{'\u26AB'} Do not disturb</option>
            <option value={'\uD83D\uDFE3'}>{'\uD83D\uDFE3'} In a meeting</option>
            <option value={'\uD83D\uDCA4'}>{'\uD83D\uDCA4'} Offline</option>
          </select>
          <input
            aria-label="What you are working on"
            type="text"
            value={profile.statusText}
            onChange={(e) => handleChange('statusText', e.target.value)}
            placeholder="What are you working on?"
            className={INPUT}
          />
        </div>
      </div>

      {/* Timezone */}
      <div>
        <label htmlFor="profile-timezone" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Clock size={12} />
          Timezone
        </label>
        <select id="profile-timezone"
          value={profile.timezone}
          onChange={(e) => handleChange('timezone', e.target.value)}
          className={INPUT}
        >
          {Intl.supportedValuesOf('timeZone').filter((tz) =>
            tz.startsWith('America/') || tz.startsWith('Europe/') || tz.startsWith('Asia/') || tz.startsWith('Australia/') || tz.startsWith('Pacific/') || tz === 'UTC'
          ).map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Accent Color */}
      <div>
        <span id="profile-accent-label" className={`flex items-center gap-1.5 ${LABEL}`}>
          <Palette size={12} />
          Accent color
        </span>
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-labelledby="profile-accent-label">
          {[
            { id: 'emerald', label: 'Emerald', tw: 'bg-emerald-500' },
            { id: 'cyan', label: 'Cyan', tw: 'bg-cyan-500' },
            { id: 'violet', label: 'Violet', tw: 'bg-violet-500' },
            { id: 'rose', label: 'Rose', tw: 'bg-rose-500' },
            { id: 'amber', label: 'Amber', tw: 'bg-amber-500' },
            { id: 'blue', label: 'Blue', tw: 'bg-blue-500' },
            { id: 'fuchsia', label: 'Fuchsia', tw: 'bg-fuchsia-500' },
            { id: 'lime', label: 'Lime', tw: 'bg-lime-500' },
          ].map((color) => (
            <Hint key={color.id} label={color.label}>
              <button
                type="button"
                onClick={() => handleChange('accentColor', color.id)}
                aria-label={color.label}
                aria-pressed={profile.accentColor === color.id}
                className={`
                  w-8 h-8 rounded-full ${color.tw} transition-all duration-200 ${FOCUS}
                  ${profile.accentColor === color.id
                    ? 'ring-2 ring-white/40 ring-offset-2 ring-offset-slate-900 scale-110'
                    : 'opacity-60 hover:opacity-100 hover:scale-105'
                  }
                `}
              />
            </Hint>
          ))}
        </div>
      </div>

      {/* Account info */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.03] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User size={12} className="text-slate-500" />
            <span className="text-xs text-slate-500">Username</span>
          </div>
          <span className="text-xs text-slate-300 font-mono">{currentUser ?? '--'}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={12} className="text-slate-500" />
            <span className="text-xs text-slate-500">Local time</span>
          </div>
          <span className="text-xs text-slate-300 font-mono">
            {new Date().toLocaleTimeString(undefined, { timeZone: profile.timezone, hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
        </div>
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Disk Label Manager
// ---------------------------------------------------------------------------

function DiskLabelManager() {
  const diskLabels = useSettingsStore((s) => s.diskLabels) ?? {}
  const customDisks = useSettingsStore((s) => s.customDisks) ?? []
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const isConnected = useConnectionStore((s) => s.status) === 'connected'

  const { data: diskData } = usePolling(fetchDisks, 60000, { enabled: isConnected })
  const disks: DiskInfo[] = diskData?.disks ?? []

  const [editingMount, setEditingMount] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Custom location form state
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMount, setNewMount] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [addError, setAddError] = useState('')

  const handleSaveLabel = useCallback((mount: string) => {
    const newLabels = { ...diskLabels }
    if (editValue.trim()) {
      newLabels[mount] = editValue.trim()
    } else {
      delete newLabels[mount]
    }
    updateSetting('diskLabels', newLabels)
    setEditingMount(null)
  }, [diskLabels, editValue, updateSetting])

  const handleRemoveLabel = useCallback((mount: string) => {
    const newLabels = { ...diskLabels }
    delete newLabels[mount]
    updateSetting('diskLabels', newLabels)
  }, [diskLabels, updateSetting])

  // Custom location handlers
  const handleAddCustom = useCallback(() => {
    const mount = newMount.trim()
    const label = newLabel.trim()
    setAddError('')

    if (!mount) {
      setAddError('Mount path is required')
      return
    }
    if (!mount.startsWith('/')) {
      setAddError('Mount path must be absolute (start with /)')
      return
    }
    // Check for duplicate (existing server disk or already-added custom)
    const serverDuplicate = disks.some((d) => d.mount === mount)
    const customDuplicate = customDisks.some((c) => c.mount === mount)
    if (serverDuplicate || customDuplicate) {
      setAddError('This mount path already exists')
      return
    }

    const entry: CustomDiskEntry = { mount, label: label || mount }
    updateSetting('customDisks', [...customDisks, entry])
    // Also set the label in diskLabels if user provided one
    if (label) {
      const newLabels = { ...diskLabels, [mount]: label }
      updateSetting('diskLabels', newLabels)
    }
    setNewMount('')
    setNewLabel('')
    setShowAddForm(false)
  }, [newMount, newLabel, disks, customDisks, diskLabels, updateSetting])

  const handleRemoveCustom = useCallback((mount: string) => {
    const updated = customDisks.filter((c) => c.mount !== mount)
    updateSetting('customDisks', updated)
    // Also clean up the label
    const newLabels = { ...diskLabels }
    delete newLabels[mount]
    updateSetting('diskLabels', newLabels)
  }, [customDisks, diskLabels, updateSetting])

  const handleEditCustomLabel = useCallback((mount: string, label: string) => {
    // Update in customDisks array
    const updated = customDisks.map((c) => c.mount === mount ? { ...c, label } : c)
    updateSetting('customDisks', updated)
    // Also update diskLabels
    const newLabels = { ...diskLabels }
    if (label) {
      newLabels[mount] = label
    } else {
      delete newLabels[mount]
    }
    updateSetting('diskLabels', newLabels)
    setEditingMount(null)
  }, [customDisks, diskLabels, updateSetting])

  return (
    <div className="space-y-4">
      {/* Server-detected disks */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <HardDrive size={14} className="text-cyan-400" />
          <h3 className={SUBHEAD}>Detected drives</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Rename the drives the server found; the new names show on the {pageLabel('dashboard')} page.
        </p>

        {disks.length === 0 ? (
          <div className="rounded-lg bg-slate-800/30 p-4 text-center">
            <p className="text-xs text-slate-500">
              {isConnected ? 'No disk data available' : 'Connect to server to see detected drives'}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {disks.map((disk) => {
              const isEditing = editingMount === disk.mount
              const hasLabel = !!diskLabels[disk.mount]

              return (
                <div
                  key={disk.mount}
                  className="flex items-center gap-3 rounded-lg bg-slate-800/30 px-3 py-2.5 border border-white/[0.03] hover:border-white/5 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-400 truncate" title={disk.mount}>
                      {disk.mount}
                    </p>
                    {hasLabel && !isEditing && (
                      <p className="text-xs text-slate-200 font-medium mt-0.5">{diskLabels[disk.mount]}</p>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">
                    {disk.used}/{disk.total} ({disk.percent})
                  </span>

                  {isEditing ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        aria-label={`Label for ${disk.mount}`}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' ? handleSaveLabel(disk.mount) : e.key === 'Escape' ? setEditingMount(null) : null}
                        autoFocus
                        placeholder="Custom label…"
                        className={`w-36 ${FIELD} !py-1 !text-xs`}
                      />
                      <Hint label="Save"><button aria-label={`Save the label of ${disk.mount}`} onClick={() => handleSaveLabel(disk.mount)} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}>
                        <Check size={12} />
                      </button></Hint>
                      <Hint label="Cancel"><button aria-label={`Cancel renaming ${disk.mount}`} onClick={() => setEditingMount(null)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                        <X size={12} />
                      </button></Hint>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <Hint label="Edit label">
                        <button
                          onClick={() => { setEditValue(diskLabels[disk.mount] ?? ''); setEditingMount(disk.mount) }}
                          aria-label={`Edit the label of ${disk.mount}`}
                          className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                        >
                          <Pencil size={12} />
                        </button>
                      </Hint>
                      {hasLabel && (
                        <Hint label="Remove label">
                          <button
                            onClick={() => handleRemoveLabel(disk.mount)}
                            aria-label={`Remove the label of ${disk.mount}`}
                            className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </Hint>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.03]" />

      {/* Custom locations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FolderPlus size={14} className="text-cyan-400" />
            <h3 className={SUBHEAD}>Custom locations</h3>
          </div>
          {!showAddForm && (
            <button
              onClick={() => { setShowAddForm(true); setAddError('') }}
              className={BTN_CARD_QUIET}
            >
              <Plus size={12} />
              Add location
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Add mount paths not auto-detected by the server (e.g. NFS mounts, external drives).
        </p>

        {/* Existing custom locations */}
        {customDisks.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {customDisks.map((custom) => {
              const isEditing = editingMount === `custom:${custom.mount}`
              return (
                <div
                  key={custom.mount}
                  className="flex items-center gap-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10 px-3 py-2.5 hover:border-cyan-500/20 transition-all"
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-cyan-500/10 shrink-0">
                    <FolderPlus size={11} className="text-cyan-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-400 truncate" title={custom.mount}>
                      {custom.mount}
                    </p>
                    {!isEditing && (
                      <p className="text-xs text-slate-200 font-medium mt-0.5">{custom.label}</p>
                    )}
                  </div>

                  <span className="text-[10px] text-cyan-400 shrink-0 px-1.5 py-0.5 rounded bg-cyan-500/5 border border-cyan-500/10">
                    custom
                  </span>

                  {isEditing ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        aria-label={`Label for ${custom.mount}`}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleEditCustomLabel(custom.mount, editValue.trim())
                          if (e.key === 'Escape') setEditingMount(null)
                        }}
                        autoFocus
                        placeholder="Label…"
                        className={`w-36 ${FIELD} !py-1 !text-xs`}
                      />
                      <Hint label="Save"><button aria-label={`Save the label of ${custom.mount}`} onClick={() => handleEditCustomLabel(custom.mount, editValue.trim())} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}>
                        <Check size={12} />
                      </button></Hint>
                      <Hint label="Cancel"><button aria-label={`Cancel renaming ${custom.mount}`} onClick={() => setEditingMount(null)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                        <X size={12} />
                      </button></Hint>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <Hint label="Edit label">
                        <button
                          onClick={() => { setEditValue(custom.label); setEditingMount(`custom:${custom.mount}`) }}
                          aria-label={`Edit the label of ${custom.mount}`}
                          className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                        >
                          <Pencil size={12} />
                        </button>
                      </Hint>
                      <Hint label="Remove custom location">
                        <button
                          onClick={() => handleRemoveCustom(custom.mount)}
                          aria-label={`Remove the custom location ${custom.mount}`}
                          className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </Hint>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Add custom location form */}
        {showAddForm && (
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-4 space-y-3 animate-fade-in">
            <div className="flex items-center gap-2 mb-1">
              <FolderPlus size={14} className="text-cyan-400" />
              <h4 className="text-xs font-semibold text-slate-200">New custom location</h4>
            </div>

            <div>
              <label htmlFor="disk-new-mount" className={LABEL}>
                Mount path <span className="text-rose-400" aria-hidden>*</span>
              </label>
              <input
                id="disk-new-mount"
                type="text"
                value={newMount}
                onChange={(e) => { setNewMount(e.target.value); setAddError('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                autoFocus
                placeholder="/mnt/external-drive"
                className={`${INPUT} font-mono`}
              />
            </div>

            <div>
              <label htmlFor="disk-new-label" className={LABEL}>
                Display label
              </label>
              <input
                id="disk-new-label"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                placeholder="External Storage"
                className={INPUT}
              />
            </div>

            {addError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[11px] text-rose-400">
                <XCircle size={12} />
                {addError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleAddCustom}
                disabled={!newMount.trim()}
                className={`${BTN_TOOLBAR} ${TONE_OK}`}
              >
                <Plus size={14} />
                Add location
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewMount(''); setNewLabel(''); setAddError('') }}
                className={BTN_TOOLBAR_QUIET}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {customDisks.length === 0 && !showAddForm && (
          <div className="rounded-lg bg-slate-800/20 border border-dashed border-white/5 p-4 text-center">
            <FolderPlus size={20} className="text-slate-500 mx-auto mb-2" />
            <p className="text-[11px] text-slate-500">
              No custom locations added yet
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Add NFS shares, USB drives, or other mount points
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance Settings
// ---------------------------------------------------------------------------


function AppearanceSettings() {
  // the mode: dark, light, or the device's preference (the header switch always sets dark or light)
  const theme = useSettingsStore((s) => s.theme)
  const systemMode = useSystemMode()
  const projectName = useSettingsStore((s) => s.projectName) || DEFAULT_APP_NAME
  // '' = the server's name (useBrand)
  const projectSubtitle = useSettingsStore((s) => s.projectSubtitle) || ''
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  // Background image is per-user (stored in profile, not settingsStore)
  const profileBg = getProfileData().backgroundImage
  const [bgInput, setBgInput] = useState(profileBg)
  const [backgroundImage, setBackgroundImage] = useState(profileBg)
  const [nameInput, setNameInput] = useState(projectName)
  const [subtitleInput, setSubtitleInput] = useState(projectSubtitle)

  // A subtitle written on another device comes back from the server (it survives browser data clears). The server's
  // own name is not the app's name: that one stays a choice on this device.
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  useEffect(() => {
    if (!isConnected) return
    let cancelled = false
    fetchConfig().then((cfg) => {
      if (cancelled) return
      const ss = (cfg as unknown as Record<string, unknown>).server_subtitle as string | undefined
      if (ss && !OLD_DEFAULT_SUBTITLES.includes(ss) && !projectSubtitle) {
        updateSetting('projectSubtitle', ss)
        setSubtitleInput(ss)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dirty tracking for branding + background
  const brandingDirty = nameInput !== projectName || subtitleInput !== projectSubtitle || bgInput.trim() !== backgroundImage

  const handleSaveAppearance = useCallback(async () => {
    const name = nameInput.trim() || DEFAULT_APP_NAME
    const subtitle = subtitleInput.trim()
    // Save branding locally
    updateSetting('projectName', name)
    updateSetting('projectSubtitle', subtitle)
    // Save background
    const val = bgInput.trim()
    const prof = getProfileData()
    saveProfileData({ ...prof, backgroundImage: val })
    setBackgroundImage(val)
    // Persist branding to server so it survives browser data clears — POST /config is the admin's (a user's call
    // was a 403 swallowed here), so only an admin writes it; everyone else keeps the name on this device
    const isConn = useConnectionStore.getState().status === 'connected'
    if (isConn && useAuthStore.getState().userRole === 'admin') {
      // only the subtitle: SERVER_NAME is the server's own name (notifications, Discord, the fleet), not this app's
      updateConfig({ SERVER_SUBTITLE: subtitle }).catch(() => {})
    }
  }, [nameInput, subtitleInput, bgInput, updateSetting])

  const handleDiscardAppearance = useCallback(() => {
    setNameInput(projectName)
    setSubtitleInput(projectSubtitle)
    setBgInput(backgroundImage)
  }, [projectName, projectSubtitle, backgroundImage])

  useSettingsDirty('appearance', brandingDirty, handleSaveAppearance, handleDiscardAppearance)

  const handleBgSave = () => {
    const val = bgInput.trim()
    const profile = getProfileData()
    saveProfileData({ ...profile, backgroundImage: val })
    setBackgroundImage(val)
  }

  const handleBgClear = () => {
    setBgInput('')
    const profile = getProfileData()
    saveProfileData({ ...profile, backgroundImage: '' })
    setBackgroundImage('')
  }

  const presetBackgrounds = [
    { label: 'None', value: '' },
    { label: 'Dark gradient', value: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80' },
    { label: 'Mountains', value: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80' },
    { label: 'Night sky', value: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80' },
    { label: 'Ocean', value: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80' },
  ]

  return (
    <div className="space-y-5">
      {/* Branding */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cog size={14} className="text-emerald-400" />
          <h3 className={SUBHEAD}>Branding</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          The name in the sidebar and on the sign-in screen, and the line under it. Leave the line empty to show the server&apos;s name.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor="branding-name" className={LABEL}>App name</label>
            <input
              id="branding-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={DEFAULT_APP_NAME}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="branding-subtitle" className={LABEL}>Subtitle</label>
            <input
              id="branding-subtitle"
              type="text"
              value={subtitleInput}
              onChange={(e) => setSubtitleInput(e.target.value)}
              placeholder="The server's name"
              className={INPUT}
            />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.03]" />

      {/* Mode: which look of the theme shows */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Palette size={14} className="text-emerald-400" />
          <h3 className={SUBHEAD}>Mode</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Mode">
          {([
            { id: 'dark', label: 'Dark', icon: <Moon size={14} /> },
            { id: 'light', label: 'Light', icon: <Sun size={14} /> },
            { id: 'system', label: 'System', icon: <Monitor size={14} /> },
          ] as const).map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={theme === m.id}
              onClick={() => updateSetting('theme', m.id)}
              className={`${CHOICE} ${theme === m.id ? CHOICE_ON : CHOICE_OFF}`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Every theme has a dark and a light look. {theme === 'system' ? `System follows this device (${systemMode} now).` : 'The switch at the top right flips between them.'}
        </p>
      </div>

      {/* Background Image */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Image size={14} className="text-cyan-400" />
          <h3 className={SUBHEAD}>Background image</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Set a custom background image URL (Unsplash, direct URL, etc.)
        </p>

        <div className="flex items-center gap-2 mb-3">
          <input
            aria-label="Background image address"
            type="text"
            value={bgInput}
            onChange={(e) => setBgInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBgSave()}
            placeholder="https://images.unsplash.com/..."
            className={`flex-1 min-w-0 ${FIELD} font-mono`}
          />
          <button onClick={handleBgSave} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
            Apply
          </button>
          {backgroundImage && (
            <button onClick={handleBgClear} className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
              Clear
            </button>
          )}
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {presetBackgrounds.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={backgroundImage === p.value}
              onClick={() => { setBgInput(p.value); const prof = getProfileData(); saveProfileData({ ...prof, backgroundImage: p.value }); setBackgroundImage(p.value) }}
              className={`${CHOICE} ${backgroundImage === p.value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Preview */}
        {backgroundImage && (
          <div className="mt-3 rounded-lg overflow-hidden border border-white/5 h-24 relative bg-slate-800/50">
            <img
              src={backgroundImage}
              alt="Background preview"
              className="w-full h-full object-cover opacity-60"
              onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = '0.6' }}
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
                const parent = img.parentElement
                if (parent && !parent.querySelector('.bg-err')) {
                  const err = document.createElement('p')
                  err.className = 'bg-err absolute inset-0 flex items-center justify-center text-xs text-rose-400'
                  err.textContent = 'Failed to load image — check URL'
                  parent.appendChild(err)
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts reference
// ---------------------------------------------------------------------------

/** the pages Ctrl+1 … Ctrl+9 open, in the order App.tsx binds them (Ctrl+0 opens Settings) */

function KeyboardShortcuts() {
  const shortcutGroups = [
    {
      group: 'Navigation',
      shortcuts: [
        // the sidebar's sections in order: Ctrl + 1 … 9, then 0 for the tenth
        ...navSections.map((sec, i) => ({ keys: `Ctrl + ${(i + 1) % 10}`, description: sec.label })),
        { keys: 'Ctrl + T', description: pageLabel('terminal') },
      ],
    },
    {
      group: 'Actions',
      shortcuts: [
        { keys: 'Ctrl + K', description: 'Open command palette' },
        { keys: 'Ctrl + R', description: 'Refresh all data' },
        { keys: 'Ctrl + B', description: 'Toggle sidebar' },
        { keys: 'Ctrl + D', description: 'Toggle dark / light mode' },
        { keys: 'Ctrl + F', description: 'Search / filter the current page' },
        { keys: '?', description: 'Show the shortcuts panel' },
        { keys: 'Escape', description: 'Close dialogs and modals' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {shortcutGroups.map((group) => (
        <div key={group.group}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
            {group.group}
          </p>
          <div className="space-y-0.5">
            {group.shortcuts.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-xs text-slate-400">{s.description}</span>
                <kbd className="shrink-0 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-mono text-slate-500">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Two-Factor Authentication Setup
// ---------------------------------------------------------------------------

function TwoFactorSetup() {
  const [status, setStatus] = useState<'idle' | 'setup' | 'verify' | 'enabled' | 'disabling'>('idle')
  const [secret, setSecret] = useState('')
  const [uri, setUri] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')

  // Whether 2FA is already on: GET /auth/verify carries totp_enabled (an older server leaves it out, so the panel
  // starts as idle there; the panel used to start idle on every server and never knew)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  useEffect(() => {
    if (!isConnected) return
    let cancelled = false
    authVerify().then((res) => {
      if (!cancelled && res.totp_enabled) setStatus((s) => (s === 'idle' ? 'enabled' : s))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isConnected])

  const handleSetup = async () => {
    setLoading(true)
    setError('')
    try {
      const { totpSetup } = await import('../api/endpoints')
      const res = await totpSetup()
      setSecret(res.secret)
      setUri(res.uri)
      setStatus('setup')
    } catch (err) {
      if (err instanceof Error && err.message.includes('already enabled')) {
        setStatus('enabled')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to set up 2FA')
      }
    }
    setLoading(false)
  }

  const handleVerify = async () => {
    if (code.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const { totpVerify } = await import('../api/endpoints')
      const res = await totpVerify(code)
      if (res.success) {
        setStatus('enabled')
        setCode('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    }
    setLoading(false)
  }

  const handleDisable = async () => {
    if (!disablePassword) return
    setLoading(true)
    setError('')
    try {
      const { totpDisable } = await import('../api/endpoints')
      await totpDisable(disablePassword)
      setStatus('idle')
      setDisablePassword('')
      setSecret('')
      setUri('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA')
    }
    setLoading(false)
  }

  return (
    <div className="rounded-lg border border-white/[0.03] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 shrink-0">
            <Shield size={12} className="text-cyan-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-200">Two-factor authentication</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {status === 'enabled' ? 'Enabled — your account requires a code on login' : 'Add an extra layer of security with TOTP'}
            </p>
          </div>
        </div>
        {status === 'idle' && (
          <button onClick={handleSetup} disabled={loading} className={`${BTN_CARD} ${TONE_OK}`}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
            Enable 2FA
          </button>
        )}
        {status === 'enabled' && (
          <button onClick={() => setStatus('disabling')} className={`${BTN_CARD} ${TONE_DANGER}`}>
            Disable
          </button>
        )}
      </div>

      {/* Setup step — show secret */}
      {status === 'setup' && (
        <div className="mt-3 pt-3 border-t border-white/[0.03] space-y-3">
          <p className="text-[11px] text-slate-400">
            Open your authenticator app (Google Authenticator, Authy, etc.) and add this account manually using the secret below:
          </p>
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900/60 border border-white/5">
            <code className="flex-1 text-xs font-mono text-cyan-300 tracking-wider break-all select-all">{secret}</code>
          </div>
          <p className="text-[11px] text-slate-500">Enter the 6-digit code from your app to verify:</p>
          <div className="flex items-center gap-2">
            <input
              aria-label="6-digit code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              placeholder="000000"
              className={`w-32 text-center font-mono text-lg tracking-[0.3em] ${FIELD}`}
            />
            <button
              onClick={handleVerify}
              disabled={loading || code.length !== 6}
              className={`${BTN_TOOLBAR} ${TONE_OK}`}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              Verify and enable
            </button>
          </div>
          {error && <p className="text-[10px] text-rose-400">{error}</p>}
        </div>
      )}

      {/* Disable step */}
      {status === 'disabling' && (
        <div className="mt-3 pt-3 border-t border-white/[0.03] space-y-3">
          <p className="text-[11px] text-slate-400">Enter your password to disable two-factor authentication:</p>
          <div className="flex items-center gap-2">
            <input
              aria-label="Your password"
              type="password"
              value={disablePassword}
              onChange={(e) => { setDisablePassword(e.target.value); setError('') }}
              placeholder="Password"
              className={`flex-1 min-w-0 ${FIELD}`}
            />
            <button onClick={handleDisable} disabled={loading || !disablePassword} className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              Disable 2FA
            </button>
            <button onClick={() => { setStatus('enabled'); setError('') }} className={BTN_TOOLBAR_QUIET}>
              Cancel
            </button>
          </div>
          {error && <p className="text-[10px] text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  )
}

// Security Settings — Change password, delete account, security info
// ---------------------------------------------------------------------------

function SecuritySettings() {
  const { syncLocalPassword, logout } = useAuthStore()
  const [section, setSection] = useState<'info' | 'password' | null>('info')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwLoading, setPwLoading] = useState(false)

  // The password is changed on the server (POST /auth/password): a form that only rewrote this browser's copy left
  // the server on the old password. The server re-hashes it and ends every session of the account, this one too,
  // so the person lands on the sign-in screen with a note to use the new password (the note travels the way the
  // "session expired" one does: the sign-in screen sits outside the toast provider). The rules for a password
  // someone CHOOSES match the sign-up (8 characters, an uppercase letter and a digit); the server holds it to 8.
  const handleChangePassword = async () => {
    setPwError(null)
    if (newPw !== confirmPw) return // Handled by UI below
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters'); return }
    if (!/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) { setPwError('Password must contain at least one uppercase letter and one number'); return }
    setPwLoading(true)
    try {
      await authChangePassword(currentPw, newPw)
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'The server could not change the password')
      setPwLoading(false)
      return
    }
    // the local copy used for the app lock follows the password the server now holds, and so does a password the
    // desktop app remembers for this server (the next sign-in asks for it anyway: the server ended every session)
    await syncLocalPassword(newPw)
    {
      const st = useServerStore.getState()
      const active = st.getActiveServer()
      const who = useAuthStore.getState().currentUser
      if (active?.remember && who) await rememberPassword(active.id, active.url, who, newPw)
    }
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    sessionStorage.setItem('logout-reason', 'password-changed')
    // the sessions saved for other servers are not this server's business
    await logout({ keepOtherServers: true })
  }

  return (
    <div className="space-y-4">
      {/* Security info badges */}
      {section === 'info' && (
        <>
          <div className="space-y-2.5">
            <div className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.03] p-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 shrink-0">
                <Lock size={12} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-200">PBKDF2 key derivation</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  100,000 iterations with random salt
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.03] p-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 shrink-0">
                <Shield size={12} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-200">Rate-limited sign-in</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  5 attempts before temporary lockout
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.03] p-3">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 shrink-0">
                <Key size={12} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-200">Secure sessions</p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Token-based with 4-hour expiry
                </p>
              </div>
            </div>
          </div>

          {/* Two-Factor Authentication */}
          <TwoFactorSetup />

          {/* Action buttons — no "Delete account" here: the server has no endpoint for it, and a button that only
              dropped this browser's copy of the account left the account on the server (an admin revokes it on the Users page) */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => { setPwError(null); setSection('password') }}
              className={BTN_TOOLBAR_QUIET}
            >
              <Key size={14} />
              Change password
            </button>
          </div>
        </>
      )}

      {/* Change password form */}
      {section === 'password' && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-1">
            <Key size={14} className="text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-200">Change password</h3>
          </div>
          <p className="text-[11px] text-slate-500">Every session of your account ends, this one too — you sign in again with the new password.</p>

          {pwError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
              <XCircle size={12} />
              {pwError}
            </div>
          )}

          <input
            aria-label="Current password"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className={INPUT}
          />
          <input
            aria-label="New password"
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 8, uppercase + number)"
            autoComplete="new-password"
            className={INPUT}
          />
          <input
            aria-label="Confirm new password"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className={`${INPUT} ${confirmPw && confirmPw !== newPw ? '!border-rose-500/50 focus:!ring-rose-500/25' : ''}`}
          />
          {confirmPw && confirmPw !== newPw && (
            <p className="text-[10px] text-rose-400">Passwords do not match</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleChangePassword}
              disabled={pwLoading || !currentPw || !newPw || newPw !== confirmPw}
              className={`${BTN_TOOLBAR} ${TONE_OK}`}
            >
              {pwLoading ? <Save size={14} className="animate-spin" /> : <Check size={14} />}
              Update password
            </button>
            <button
              onClick={() => { setSection('info'); setPwError(null); setCurrentPw(''); setNewPw(''); setConfirmPw('') }}
              className={BTN_TOOLBAR_QUIET}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Auto-Lock & Notification Preferences
// ---------------------------------------------------------------------------

function AutoLockSettings() {
  const autoLockMinutes = useSettingsStore((s) => s.autoLockMinutes) ?? 0
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled) ?? true
  const sessionDurationMinutes = useSettingsStore((s) => s.sessionDurationMinutes) ?? 240
  const rememberUsername = useSettingsStore((s) => s.rememberUsername) ?? true
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  const lockOptions = [
    { value: 0, label: 'Never' },
    { value: 5, label: '5 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 120, label: '2 hours' },
  ]

  const sessionOptions = [
    { value: 60, label: '1h' },
    { value: 240, label: '4h' },
    { value: 720, label: '12h' },
    { value: 1440, label: '1 day' },
    { value: 10080, label: '7 days' },
    { value: 43200, label: '30 days' },
    { value: 0, label: 'Indefinite' },
  ]

  return (
    <div className="space-y-5">
      {/* Auto-lock */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <LockKeyhole size={14} className="accent-text" />
          <h3 id="autolock-label" className={SUBHEAD}>Auto-lock</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Automatically lock the app after a period of inactivity. You'll need to sign in again.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="autolock-label">
          {lockOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={autoLockMinutes === opt.value}
              onClick={() => updateSetting('autoLockMinutes', opt.value)}
              className={`${CHOICE} ${autoLockMinutes === opt.value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {autoLockMinutes > 0 && (
          <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1.5">
            <Clock size={10} />
            Screen will lock after {autoLockMinutes} minute{autoLockMinutes !== 1 ? 's' : ''} of inactivity
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.03]" />

      {/* Session Duration */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="accent-text" />
          <h3 id="session-duration-label" className={SUBHEAD}>Session duration</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          How long your "Remember me" session stays active before requiring sign-in again.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="session-duration-label">
          {sessionOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={sessionDurationMinutes === opt.value}
              onClick={() => updateSetting('sessionDurationMinutes', opt.value)}
              className={`${CHOICE} ${sessionDurationMinutes === opt.value ? CHOICE_ON : CHOICE_OFF}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {sessionDurationMinutes > 0 ? (
          <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1.5">
            <Clock size={10} />
            Sessions expire after {sessionDurationMinutes >= 1440 ? `${Math.round(sessionDurationMinutes / 1440)} day${Math.round(sessionDurationMinutes / 1440) !== 1 ? 's' : ''}` : sessionDurationMinutes >= 60 ? `${sessionDurationMinutes / 60} hour${sessionDurationMinutes / 60 !== 1 ? 's' : ''}` : `${sessionDurationMinutes} minutes`}
          </p>
        ) : (
          <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1.5">
            <Clock size={10} />
            Sessions never expire — stay signed in indefinitely
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.03]" />

      {/* Remember Username */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User size={14} className={rememberUsername ? 'text-emerald-400' : 'text-slate-500'} />
            <div>
              <h3 className={SUBHEAD}>Remember username</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Pre-fill your username on the login screen</p>
            </div>
          </div>
          <MantineSwitch
            aria-label="Remember username"
            checked={rememberUsername}
            onChange={() => {
              const next = !rememberUsername
              updateSetting('rememberUsername', next)
              if (!next) updateSetting('lastUsername', '')
            }}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.03]" />

      {/* Notifications */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {notificationsEnabled ? (
              <Bell size={14} className="text-cyan-400" />
            ) : (
              <BellOff size={14} className="text-slate-500" />
            )}
            <div>
              <h3 className={SUBHEAD}>Toast notifications</h3>
              <p className="text-[10px] text-slate-500 mt-0.5">Show in-app notifications for actions and events</p>
            </div>
          </div>
          <MantineSwitch
            aria-label="Toast notifications"
            checked={notificationsEnabled}
            onChange={() => updateSetting('notificationsEnabled', !notificationsEnabled)}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export / Import Settings
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connection Profiles (Phase 6A)
// ---------------------------------------------------------------------------

function ConnectionProfiles() {
  // The same list the sidebar's server switcher shows; nothing lives only here
  const servers = useServerStore((s) => s.servers)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const connectionStatus = useConnectionStore((s) => s.status)
  const currentUser = useAuthStore((s) => s.currentUser)
  const unreachable = useServerStore((s) => s.unreachable)
  const blocked = useServerStore((s) => s.blocked)
  const { addToast } = useToast()

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState('')
  // a server that answers but does not let this web dashboard's address in: it can still be saved (the desktop app has no such limit)
  const [blockedFind, setBlockedFind] = useState<DiscoveredServer | null>(null)
  const [testing, setTesting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    const store = useServerStore.getState()
    store.loadServers()
    store.importLegacyProfiles()
  }, [])

  const active = servers.find((s) => s.id === activeServerId) ?? null

  const handleAdd = useCallback(async (connectNow: boolean) => {
    const name = newName.trim()
    let url = newUrl.trim()
    setAddError('')
    setBlockedFind(null)
    if (!name) { setAddError('Name is required'); return }
    if (!url) { setAddError('Address is required'); return }
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = `http://${url}`
    if (servers.some((s) => s.url === url)) { setAddError('A profile with this address already exists'); return }
    setTesting(true)
    const { found, blocked: refused } = await discoverServerVerdict(url)
    setTesting(false)
    if (!found && refused) { setAddError(blockedText(refused.url)); setBlockedFind(refused); return }
    if (!found) { setAddError('No DCS API answered there — check the address and that the server is running'); return }
    const profile = useServerStore.getState().addServer({ name, url: found.url })
    setShowAdd(false); setNewName(''); setNewUrl(''); setAddError(''); setBlockedFind(null)
    addToast({ type: 'success', message: `Saved ${name} (${found.url})` })
    if (connectNow) {
      setBusyId(profile.id)
      const ok = await useServerStore.getState().switchServer(profile.id)
      setBusyId(null)
      if (!ok) addToast({ type: 'error', message: `Could not connect to ${name}` })
    }
  }, [newName, newUrl, servers, addToast])

  /** Save a server that answers but does not let this dashboard in: the profile works in the desktop app */
  const handleSaveBlocked = useCallback(() => {
    const name = newName.trim()
    if (!blockedFind || !name) return
    const detail = blockedText(blockedFind.url)
    const profile = useServerStore.getState().addServer({ name, url: blockedFind.url })
    useServerStore.getState().markBlocked(profile.id, detail)
    setShowAdd(false); setNewName(''); setNewUrl(''); setAddError(''); setBlockedFind(null)
    addToast({ type: 'info', message: `Saved ${name} (${blockedFind.url}); this browser can’t use it until its admin allows this address` })
  }, [newName, blockedFind, addToast])

  const handleSwitch = useCallback(async (id: string) => {
    if (id === activeServerId && connectionStatus === 'connected') return
    const target = servers.find((s) => s.id === id)
    setBusyId(id)
    const ok = await useServerStore.getState().switchServer(id)
    setBusyId(null)
    if (ok) addToast({ type: 'success', message: `Connected to ${target?.name ?? 'server'}` })
    else addToast({ type: 'error', message: `Could not connect to ${target?.name ?? 'server'} — check the address and that it is running` })
  }, [activeServerId, connectionStatus, servers, addToast])

  const commitRename = useCallback((id: string) => {
    const name = editName.trim()
    if (name) useServerStore.getState().updateServer(id, { name })
    setEditingId(null)
  }, [editName])

  const statusTone = connectionStatus === 'connected' ? 'text-emerald-400' : connectionStatus === 'connecting' ? 'text-amber-400' : 'text-rose-400'

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Save and switch between DCS servers. The list is the same one the server menu in the sidebar shows; each server keeps its own account and sign-in, and a server without one asks you to sign in when you pick it.
      </p>

      {/* Active server */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2 min-w-0">
            {connectionStatus === 'connected' ? <Wifi size={12} className="text-emerald-400 shrink-0" /> : <WifiOff size={12} className="text-slate-500 shrink-0" />}
            <span className="text-[11px] text-slate-500 shrink-0">Active</span>
            <span className="text-xs font-medium text-slate-200 truncate">{active?.name ?? 'No server'}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] font-medium ${statusTone}`}>{connectionStatus}</span>
            <span className="text-[11px] text-slate-300 font-mono truncate">{active?.url ?? ''}</span>
            {currentUser && <span className="text-[10px] text-slate-500 shrink-0">as {currentUser}</span>}
          </div>
        </div>
      </div>

      {/* Profiles */}
      {servers.length > 0 && (
        <div className="space-y-1.5">
          {servers.map((profile) => {
            const isActive = profile.id === activeServerId
            const busy = busyId === profile.id
            const editing = editingId === profile.id
            return (
              <div key={profile.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 transition-colors ${isActive ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}>
                <Server size={14} className={isActive ? 'text-emerald-400 shrink-0' : 'text-slate-500 shrink-0'} />
                <div className="flex-1 min-w-[9rem]">
                  {editing ? (
                    <input aria-label="Profile name"
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => commitRename(profile.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(profile.id); if (e.key === 'Escape') setEditingId(null) }}
                      className={`w-full ${FIELD} !py-1 !text-xs`}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-medium text-slate-200 truncate">{profile.name}</span>
                      {profile.isDefault && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-300 shrink-0">default</span>}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 font-mono truncate">{profile.url}{profile.lastConnected ? ` · last connected ${new Date(profile.lastConnected).toLocaleString()}` : ''}</div>
                  {(() => {
                    const line = accountLine(profile, { active: isActive, signedInHere: isActive, unreachable: unreachable[profile.id], blocked: blocked[profile.id] })
                    return <div className={`text-[10px] ${line.tone === 'ok' ? 'text-emerald-400' : line.tone === 'bad' ? 'text-rose-400' : 'text-slate-500'}`}>{line.text}</div>
                  })()}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!isActive || connectionStatus !== 'connected' ? (
                    <button
                      onClick={() => handleSwitch(profile.id)}
                      disabled={busy}
                      className={`${BTN_CARD} ${TONE_OK}`}
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                      Connect
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-emerald-400"><CheckCircle size={12} /> Connected</span>
                  )}
                  {profile.session?.token && (
                    <button onClick={() => void useServerStore.getState().signOutServer(profile.id)} className={`${BTN_CARD} ${TONE_GHOST}`}>
                      <LogOut size={12} />
                      Sign out here
                    </button>
                  )}
                  {profile.remember && (
                    <button onClick={() => void useServerStore.getState().forgetServerPassword(profile.id)} className={`${BTN_CARD} ${TONE_GHOST}`}>
                      <KeyRound size={12} />
                      Forget password
                    </button>
                  )}
                  <Hint label="Rename">
                    <button onClick={() => { setEditingId(profile.id); setEditName(profile.name) }} aria-label={`Rename ${profile.name}`} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                      <Pencil size={12} />
                    </button>
                  </Hint>
                  <Hint label={profile.isDefault ? 'The default server' : 'Use as the default server'}>
                    <button onClick={() => useServerStore.getState().setDefaultServer(profile.id)} aria-label={profile.isDefault ? `${profile.name} is the default server` : `Use ${profile.name} as the default server`} aria-pressed={!!profile.isDefault} className={`${BTN_ICON_SM} ${profile.isDefault ? 'text-amber-300 hover:bg-white/10' : TONE_GHOST}`}>
                      <Star size={12} className={profile.isDefault ? 'fill-current' : ''} />
                    </button>
                  </Hint>
                  {servers.length > 1 && (
                    <Hint label="Remove this server">
                      <button onClick={() => useServerStore.getState().removeServer(profile.id)} aria-label={`Remove ${profile.name}`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
                        <Trash2 size={12} />
                      </button>
                    </Hint>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd ? (
        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Plus size={14} className="text-emerald-400" />
            <span className="text-xs font-semibold text-slate-200">New server</span>
          </div>
          <div>
            <label htmlFor="server-new-name" className={LABEL}>Name</label>
            <input
              id="server-new-name"
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setAddError(''); setBlockedFind(null) }}
              placeholder="Home server"
              autoFocus
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="server-new-address" className={LABEL}>Address</label>
            <input
              id="server-new-address"
              type="text"
              inputMode="url"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setAddError(''); setBlockedFind(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(true) }}
              placeholder="192.168.1.10:9876 or https://ui.example.com"
              spellCheck={false}
              className={`${INPUT} font-mono`}
            />
            <p className="text-[10px] text-slate-500 mt-1">The API port, or the dashboard address behind Traefik — the address that answers is kept.</p>
          </div>
          {addError && (
            <div role="alert" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] ${blockedFind ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'}`}>
              {blockedFind ? <ShieldOff size={12} className="shrink-0 mt-px" /> : <XCircle size={12} className="shrink-0 mt-px" />}
              <span className="min-w-0 break-words">{addError}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => void handleAdd(true)}
              disabled={!newName.trim() || !newUrl.trim() || testing}
              className={`${BTN_TOOLBAR} ${TONE_OK}`}
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
              Save and connect
            </button>
            <button
              onClick={() => void handleAdd(false)}
              disabled={!newName.trim() || !newUrl.trim() || testing}
              className={BTN_TOOLBAR_QUIET}
            >
              <Plus size={14} />
              Save for later
            </button>
            {blockedFind && (
              <button onClick={handleSaveBlocked} disabled={!newName.trim() || testing} className={BTN_TOOLBAR_QUIET}>
                <Plus size={14} />
                Save anyway
              </button>
            )}
            <button
              onClick={() => { setShowAdd(false); setNewName(''); setNewUrl(''); setAddError(''); setBlockedFind(null) }}
              className={BTN_TOOLBAR_QUIET}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className={BTN_TOOLBAR_QUIET}>
          <Plus size={14} />
          Add server
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notification Preferences (Phase 6B)
// ---------------------------------------------------------------------------

function NotificationPreferencesSection() {
  const { preferences, setPreference, requestDesktopPermission } = useNotificationStore()

  const toggleItems: { key: keyof typeof preferences; label: string; description: string; icon: React.ReactNode; color: string }[] = [
    {
      key: 'healthAlerts',
      label: 'Health alerts',
      description: 'Notify when system health changes (healthy/degraded/critical)',
      icon: <HeartPulse size={12} />,
      color: 'text-rose-400',
    },
    {
      key: 'connectionAlerts',
      label: 'Connection alerts',
      description: 'Notify on server connection/disconnection events',
      icon: <Wifi size={12} />,
      color: 'text-emerald-400',
    },
    {
      key: 'containerCrashAlerts',
      label: 'Container crash alerts',
      description: 'Notify when containers stop unexpectedly',
      icon: <AlertTriangle size={12} />,
      color: 'text-amber-400',
    },
    {
      key: 'desktopNotifications',
      label: window.electronAPI ? 'Desktop notifications' : 'Browser notifications',
      description: window.electronAPI ? 'Show OS-level notifications when the window is not focused' : 'Show browser notifications for important events',
      icon: <Monitor size={12} />,
      color: 'text-cyan-400',
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Control which events generate notifications. These preferences are also accessible from the notification drawer.
      </p>

      <div className="space-y-1">
        {toggleItems.map((item) => {
          const checked = item.key === 'diskWarningThreshold'
            ? false
            : (preferences[item.key] as boolean)
          return (
            <div
              key={item.key}
              className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-white/5 ${item.color}`}>
                  {item.icon}
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-200">{item.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{item.description}</p>
                </div>
              </div>
              <MantineSwitch
                aria-label={item.label}
                checked={checked}
                onChange={() => {
                  if (item.key === 'desktopNotifications' && !checked) {
                    if ('Notification' in window && Notification.permission === 'default') {
                      requestDesktopPermission()
                      return
                    }
                  }
                  setPreference(item.key as keyof typeof preferences, !checked as never)
                }}
                className="shrink-0"
              />
            </div>
          )
        })}
      </div>

      {/* Disk warning threshold */}
      <div className="border-t border-white/[0.03] pt-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-medium text-slate-200">Disk warning threshold</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Alert when disk usage exceeds this percentage</p>
          </div>
          <span className="text-sm font-bold text-amber-400 font-mono">{preferences.diskWarningThreshold}%</span>
        </div>
        <input aria-label="Disk warning threshold"
          type="range"
          min={75}
          max={95}
          step={5}
          value={preferences.diskWarningThreshold}
          onChange={(e) => setPreference('diskWarningThreshold', Number(e.target.value))}
          className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-500"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-slate-500">75%</span>
          <span className="text-[9px] text-slate-500">95%</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Session Information
// ---------------------------------------------------------------------------

function SessionInfo() {
  const { currentUser, apiToken } = useAuthStore()
  const [sessionData, setSessionData] = useState<{ expiresAt?: number } | null>(null)
  const [timeLeft, setTimeLeft] = useState('')
  const [lastLogin, setLastLogin] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('auth-session')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setSessionData(parsed)
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!sessionData?.expiresAt) return
    const expiresAt = sessionData.expiresAt
    const update = () => {
      const diff = expiresAt - Date.now()
      if (diff <= 0) {
        setTimeLeft('Expired')
        return
      }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setTimeLeft(`${h}h ${m}m remaining`)
    }
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [sessionData])

  useEffect(() => {
    async function load() {
      try {
        let accounts: Array<{ username: string; lastLoginAt?: string }> = []
        if (window.electronAPI) {
          const result = await window.electronAPI.getSetting('userAccounts')
          accounts = Array.isArray(result) ? result : []
        } else {
          const raw = localStorage.getItem('userAccounts')
          accounts = raw ? JSON.parse(raw) : []
        }
        const account = accounts.find((a) => a.username?.toLowerCase() === (currentUser?.toLowerCase() ?? ''))
        if (account?.lastLoginAt) setLastLogin(account.lastLoginAt)
      } catch { /* ignore */ }
    }
    load()
  }, [currentUser])

  // the Bearer token the server issued (the row used to show a random client-only token nothing accepts)
  const token = apiToken
  const tokenMasked = token ? `${token.slice(0, 8)}${'*'.repeat(Math.min(token.length - 12, 24))}${token.slice(-4)}` : null

  const handleCopyToken = useCallback(() => {
    if (!token) return
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [token])

  return (
    <div className="space-y-2 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={14} className="accent-text" />
        <h3 className={SUBHEAD}>Session</h3>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[11px] text-slate-500">Status</span>
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Active
          </span>
        </div>
        {sessionData?.expiresAt && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[11px] text-slate-500">Session expiry</span>
            <span className={`text-[11px] font-mono ${
              timeLeft === 'Expired' ? 'text-rose-400' : 'text-slate-300'
            }`}>
              {timeLeft}
            </span>
          </div>
        )}
        {lastLogin && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[11px] text-slate-500">Last sign-in</span>
            <span className="text-[11px] text-slate-300 font-mono">
              {new Date(lastLogin).toLocaleDateString()} {new Date(lastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
        {token && (
          <div className="py-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-500">Session token</span>
              <div className="flex items-center gap-1">
                <Hint label={showToken ? 'Hide token' : 'Show token'}>
                  <button
                    onClick={() => setShowToken(!showToken)}
                    aria-label={showToken ? 'Hide the session token' : 'Show the session token'}
                    className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                  >
                    {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </Hint>
                <Hint label="Copy token">
                  <button
                    onClick={handleCopyToken}
                    aria-label="Copy the session token"
                    className={`${BTN_ICON_SM} ${copied ? TONE_GHOST_OK : TONE_GHOST}`}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </Hint>
              </div>
            </div>
            <div className="bg-white/[0.03] border border-white/5 rounded px-2.5 py-1.5 overflow-x-auto">
              <code className="text-[10px] text-slate-400 font-mono break-all select-all">
                {showToken ? token : tokenMasked}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alert Thresholds Editor
// ---------------------------------------------------------------------------

function AlertThresholdsEditor() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const [thresholds, setThresholds] = useState<AlertThresholds>({
    cpu_warning: 80, cpu_critical: 95,
    memory_warning: 80, memory_critical: 95,
    disk_warning: 85, disk_critical: 95,
    restart_threshold: 5,
  })
  const [initialThresholds, setInitialThresholds] = useState<AlertThresholds>({
    cpu_warning: 80, cpu_critical: 95,
    memory_warning: 80, memory_critical: 95,
    disk_warning: 85, disk_critical: 95,
    restart_threshold: 5,
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConnected) return
    setLoading(true)
    fetchAlertConfig()
      .then((res) => { if (res.thresholds) { setThresholds(res.thresholds); setInitialThresholds(res.thresholds) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isConnected])

  const isDirty = JSON.stringify(thresholds) !== JSON.stringify(initialThresholds)

  const handleSave = useCallback(async () => {
    try {
      await updateAlertConfig(thresholds)
      setInitialThresholds(thresholds)
    } catch { /* */ }
  }, [thresholds])

  const handleDiscard = useCallback(() => {
    setThresholds(initialThresholds)
  }, [initialThresholds])

  useSettingsDirty('alertThresholds', isDirty, handleSave, handleDiscard)

  const updateField = (key: keyof AlertThresholds, value: number) => {
    setThresholds(prev => ({ ...prev, [key]: value }))
  }

  const sliderRow = (label: string, warningKey: keyof AlertThresholds, criticalKey: keyof AlertThresholds, unit = '%') => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-amber-400/70">Warning: {thresholds[warningKey]}{unit}</span>
          <span className="text-[10px] text-rose-400/70">Critical: {thresholds[criticalKey]}{unit}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-amber-400/80 w-10 shrink-0">Warn</span>
            <input aria-label={`${label} warning`}
              type="range" min={10} max={100} step={5}
              value={thresholds[warningKey]}
              onChange={(e) => updateField(warningKey, Number(e.target.value))}
              className="flex-1 h-1 rounded-full appearance-none bg-slate-700 accent-amber-500 cursor-pointer"
            />
            <input aria-label={`${label} warning`}
              type="number" min={10} max={100} step={5}
              value={thresholds[warningKey]}
              onChange={(e) => updateField(warningKey, Number(e.target.value))}
              className="w-14 px-2 py-1 text-xs text-center bg-white/5 border border-white/10 rounded-lg text-amber-400 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-rose-400/80 w-10 shrink-0">Crit</span>
            <input aria-label={`${label} critical`}
              type="range" min={10} max={100} step={5}
              value={thresholds[criticalKey]}
              onChange={(e) => updateField(criticalKey, Number(e.target.value))}
              className="flex-1 h-1 rounded-full appearance-none bg-slate-700 accent-rose-500 cursor-pointer"
            />
            <input aria-label={`${label} critical`}
              type="number" min={10} max={100} step={5}
              value={thresholds[criticalKey]}
              onChange={(e) => updateField(criticalKey, Number(e.target.value))}
              className="w-14 px-2 py-1 text-xs text-center bg-white/5 border border-white/10 rounded-lg text-rose-400 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/20"
            />
          </div>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return <div className="flex items-center gap-2 py-4" role="status"><Timer size={14} className="text-slate-500 animate-spin" /><span className="text-xs text-slate-500">Loading thresholds…</span></div>
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-slate-500 -mt-1">
        Configure when resource usage triggers warning and critical alerts on the dashboard.
      </p>

      {sliderRow('CPU usage', 'cpu_warning', 'cpu_critical')}
      <div className="border-b border-white/[0.03]" />
      {sliderRow('Memory usage', 'memory_warning', 'memory_critical')}
      <div className="border-b border-white/[0.03]" />
      {sliderRow('Disk usage', 'disk_warning', 'disk_critical')}
      <div className="border-b border-white/[0.03]" />

      {/* Restart threshold */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-slate-400">Container restart threshold</span>
          <p className="text-[10px] text-slate-500">Alert when a container restarts more than this many times</p>
        </div>
        <input aria-label="Container restart threshold"
          type="number" min={1} max={50} step={1}
          value={thresholds.restart_threshold}
          onChange={(e) => updateField('restart_threshold', Number(e.target.value))}
          className="w-16 px-2 py-1.5 text-sm text-center bg-white/5 border border-white/10 rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
        />
      </div>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Section Card helper
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings Export / Import
// ---------------------------------------------------------------------------

/** what an export carries: the choices, labels and notes worth moving to another device. Not the server address (a file must not be able to repoint the dashboard), not tokens, not what lives for one session only */
const EXPORT_SETTING_KEYS = [
  'theme', 'themeName', 'defaultPage', 'use24hClock', 'reduceMotion', 'customCSS', 'sidebarCollapsed',
  'pollingInterval', 'containerPollingInterval', 'imagePollingInterval', 'logPollingInterval',
  'diskLabels', 'pinnedDisks', 'customDisks', 'stackAnnotations',
  'autoLockMinutes', 'autoCheckUpdates', 'notificationsEnabled', 'projectName', 'projectSubtitle', 'rememberUsername', 'sessionDurationMinutes',
] as const
type ExportSettingKey = (typeof EXPORT_SETTING_KEYS)[number]

/** one setting read from a file: a value of the kind the setting has is taken over, anything else is left out */
function importableValue(key: ExportSettingKey, value: unknown): unknown {
  if ((SYNCED_PREFS as readonly string[]).includes(key)) return (cleanPrefs({ [key]: value }) as Record<string, unknown>)[key]
  const def = DEFAULT_SETTINGS[key] as unknown
  if (typeof value !== typeof def || Array.isArray(value) !== Array.isArray(def) || value === null) return undefined
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined
  if (typeof value === 'object' && JSON.stringify(value).length > 200000) return undefined
  return value
}

function SettingsExportImport() {
  const [importPreview, setImportPreview] = useState<{ settings: Record<string, unknown>; profile: Record<string, string> | null } | null>(null)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const pickRef = useRef<HTMLInputElement>(null)

  const handleExport = useCallback(() => {
    const state = useSettingsStore.getState()
    const user = useAuthStore.getState().currentUser
    const settings: Record<string, unknown> = {}
    for (const k of EXPORT_SETTING_KEYS) settings[k] = state[k]
    const local = user ? readLocalProfile(user) : null
    const profile: Record<string, string> = {}
    if (local) for (const k of PROFILE_KEYS) if (typeof local[k] === 'string') profile[k] = local[k] as string
    const payload = { _type: 'dcs-settings-export', _version: 2, _exported_at: new Date().toISOString(), settings, profile: Object.keys(profile).length ? profile : null }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dcs-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  // The command palette's "Export settings"
  useEffect(() => {
    const handler = () => handleExport()
    window.addEventListener('export-settings', handler)
    return () => window.removeEventListener('export-settings', handler)
  }, [handleExport])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be picked again
    if (!file) return
    setImportSuccess(false)
    setImportError('')
    setImportPreview(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        // this export and the one the dashboard made before 4.0.1 (dcs-ui-settings)
        if (!parsed || (parsed._type !== 'dcs-settings-export' && parsed._format !== 'dcs-ui-settings')) {
          setImportError('This is not a settings file exported from DCS Orchestrator.')
          return
        }
        const settings: Record<string, unknown> = {}
        const given = parsed.settings && typeof parsed.settings === 'object' ? (parsed.settings as Record<string, unknown>) : {}
        for (const k of EXPORT_SETTING_KEYS) {
          if (!(k in given)) continue
          const v = importableValue(k, given[k])
          if (v !== undefined) settings[k] = v
        }
        let profile: Record<string, string> | null = null
        if (parsed.profile && typeof parsed.profile === 'object') {
          const p: Record<string, string> = {}
          for (const k of PROFILE_KEYS) if (typeof parsed.profile[k] === 'string' && parsed.profile[k] !== '') p[k] = parsed.profile[k]
          if (Object.keys(p).length > 0) profile = p
        }
        if (Object.keys(settings).length === 0 && !profile) {
          setImportError('This file has nothing this dashboard can restore.')
          return
        }
        setImportPreview({ settings, profile })
      } catch {
        setImportError('This file could not be read as settings.')
      }
    }
    reader.readAsText(file)
  }, [])

  const handleImport = useCallback(() => {
    if (!importPreview) return
    for (const [key, value] of Object.entries(importPreview.settings)) updateSetting(key as keyof AppSettings, value as never)
    const user = useAuthStore.getState().currentUser
    if (importPreview.profile && user) {
      mergeServerProfile(user, importPreview.profile) // into this device's profile of the person, then to the server
      if (useConnectionStore.getState().status === 'connected') void patchServerProfile(importPreview.profile)
    }
    setImportPreview(null)
    setImportSuccess(true)
    setTimeout(() => setImportSuccess(false), 3000)
  }, [importPreview, updateSetting])

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Save your choices, polling intervals, disk labels, stack notes and profile to a file, or restore them from one on any device. The server address and sign-in stay as they are on each device.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleExport} className={BTN_TOOLBAR_QUIET}>
          <Download size={14} />
          Export settings
        </button>
        <button onClick={() => pickRef.current?.click()} className={BTN_TOOLBAR_QUIET}>
          <Upload size={14} />
          Import settings
        </button>
        <input
          ref={pickRef}
          type="file"
          accept=".json"
          aria-label="Settings file to import"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {importError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5 text-xs text-rose-400">
          <XCircle size={12} className="shrink-0" />
          {importError}
        </div>
      )}

      {importPreview && (
        <div className="rounded-lg bg-cyan-500/[0.06] border border-cyan-500/15 p-4 animate-fade-in">
          <p className="text-xs font-semibold text-cyan-300 mb-2">Import preview</p>
          <div className="space-y-1 mb-3">
            <p className="text-[10px] text-slate-400">{Object.keys(importPreview.settings).length} settings found</p>
            <p className="text-[10px] text-slate-400">Profile data: {importPreview.profile ? 'Yes' : 'No'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleImport} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              Apply import
            </button>
            <button onClick={() => setImportPreview(null)} className={BTN_TOOLBAR_QUIET}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {importSuccess && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 animate-fade-in">
          <Check size={13} className="text-emerald-400 shrink-0" />
          <p className="text-[11px] text-emerald-300">Settings imported successfully</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionCard
// ---------------------------------------------------------------------------

function SectionCard({ icon, title, children, fullWidth, defaultCollapsed }: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  fullWidth?: boolean
  defaultCollapsed?: boolean
}) {
  // Persist collapsed state per card in localStorage
  const storageKey = `settings-card-${title.replace(/\s+/g, '-').toLowerCase()}`
  const [collapsed, setCollapsed] = useState(() => {
    if (defaultCollapsed) return true
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === 'true'
    } catch { return false }
  })

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(storageKey, String(next)) } catch { /* */ }
  }
  const bodyId = `${storageKey}-body`

  return (
    <div className={`glass rounded-xl border border-white/5 overflow-hidden ${fullWidth ? 'lg:col-span-2' : ''} transition-all duration-300`}>
      <h2>
        <button
          type="button"
          onClick={toggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className={`w-full px-5 py-4 border-b border-white/5 flex items-center gap-2.5 hover:bg-white/[0.03] transition-all text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40`}
        >
          {icon}
          <span className="text-sm font-semibold text-slate-200 flex-1">{title}</span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`text-slate-500 transition-transform duration-300 ${collapsed ? '-rotate-90' : 'rotate-0'}`}
          />
        </button>
      </h2>
      {/* a folded section is invisible, so its controls are out of the tab order too */}
      <div
        id={bodyId}
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          collapsed ? 'max-h-0 opacity-0 invisible' : 'max-h-[6000px] opacity-100'
        }`}
      >
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const connectionStatus = useConnectionStore((s) => s.status)
  const serverUrl = useConnectionStore((s) => s.serverUrl)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const userRole = useAuthStore((s) => s.userRole)
  // Strict: only 'admin' gets full access (principle of least privilege)
  const isAdmin = userRole === 'admin'
  const customCSS = useSettingsStore((s) => s.customCSS) || ''
  const [customCSSLocal, setCustomCSSLocal] = useState(customCSS)
  useEffect(() => { setCustomCSSLocal(customCSS) }, [customCSS])

  const [appVersion, setAppVersion] = useState<string>('--')

  // Fetch API version info
  const isConnected = connectionStatus === 'connected'
  const { data: versionData } = usePolling<APIVersion>(fetchVersion, 60000, {
    enabled: isConnected,
  })

  // Load app version from Electron IPC
  useEffect(() => {
    async function loadVersion() {
      if (window.electronAPI) {
        try {
          const v = await window.electronAPI.getVersion()
          setAppVersion(v)
        } catch {
          setAppVersion('unknown')
        }
      } else {
        // Docker/web mode — use build-time version from Vite
        const { BUILD_VERSION } = await import('../constants/buildInfo')
        setAppVersion(BUILD_VERSION)
      }
    }
    loadVersion()
  }, [])

  // ---------------------------------------------------------------------------
  // Unified FloatingSaveBar — one bar for all sections
  // ---------------------------------------------------------------------------
  const dirtyMapRef = useRef<Record<string, DirtyEntry>>({})
  const [dirtyCount, setDirtyCount] = useState(0)
  const [saving, setSaving] = useState(false)

  const ctxValue = useRef<SettingsDirtyCtx>({
    markDirty: (section, entry) => {
      dirtyMapRef.current[section] = entry
      setDirtyCount(Object.keys(dirtyMapRef.current).length)
    },
    markClean: (section) => {
      delete dirtyMapRef.current[section]
      setDirtyCount(Object.keys(dirtyMapRef.current).length)
    },
  }).current

  // Custom CSS dirty tracking (inline, not a sub-component)
  const cssDirty = customCSSLocal !== customCSS
  useEffect(() => {
    if (cssDirty) {
      ctxValue.markDirty('customCSS', {
        save: () => { updateSetting('customCSS', customCSSLocal) },
        discard: () => { setCustomCSSLocal(customCSS) },
      })
    } else {
      ctxValue.markClean('customCSS')
    }
  }, [cssDirty, customCSSLocal, customCSS]) // eslint-disable-line react-hooks/exhaustive-deps

  // AppSettingsForm integration (separate component, uses props)
  const appSettingsSaveRef = useRef<(() => void) | null>(null)
  const appSettingsDiscardRef = useRef<(() => void) | null>(null)
  const handleAppSettingsDirty = useCallback((dirty: boolean) => {
    if (dirty) {
      ctxValue.markDirty('appSettings', {
        save: () => appSettingsSaveRef.current?.(),
        discard: () => appSettingsDiscardRef.current?.(),
      })
    } else {
      ctxValue.markClean('appSettings')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const handleAppSettingsRegister = useCallback((save: () => void, discard: () => void) => {
    appSettingsSaveRef.current = save
    appSettingsDiscardRef.current = discard
  }, [])

  const handleSaveAll = useCallback(async () => {
    setSaving(true)
    const entries = { ...dirtyMapRef.current }
    for (const entry of Object.values(entries)) {
      await entry.save()
    }
    setSaving(false)
  }, [])

  const handleDiscardAll = useCallback(() => {
    const entries = { ...dirtyMapRef.current }
    for (const entry of Object.values(entries)) {
      entry.discard()
    }
  }, [])

  return (
    <SettingsDirtyContext.Provider value={ctxValue}>
    <div className="space-y-3 md:space-y-6">
      <PageHeader page="settings" />

      <div className="space-y-5">
        {/* Cards keep their natural height and flow into two columns (no stretched, half-empty cards);
            full-width sections sit between the column groups */}
        <div className="lg:columns-2 lg:gap-5 [&>*]:break-inside-avoid [&>*]:mb-5 [&>*:last-child]:mb-0 lg:[&>*:last-child]:mb-5">
        {/* Row 1: User Profile + Server Connection (side by side) */}
        <SectionCard
          icon={<UserCircle size={16} className="accent-text" />}
          title="User profile"
        >
          <ProfileSettings />
        </SectionCard>

        {isAdmin && (
          <SectionCard
            icon={<Server size={16} className="accent-text" />}
            title="Server connection"
          >
            <ConnectionForm />
            <div className="border-t border-white/[0.03] mt-4 pt-4">
              <ConnectionProfiles />
            </div>
          </SectionCard>
        )}

        </div>
        {/* Row 2: Appearance (full-width) */}
        <SectionCard
          icon={<Eye size={16} className="accent-text" />}
          title="Appearance"
          fullWidth
        >
          <AppearanceSettings />
        </SectionCard>

        <SectionCard
          icon={<PanelLeft size={16} className="accent-text" />}
          title="Sidebar & pages"
          fullWidth
        >
          <SidebarPagesPanel />
        </SectionCard>

        {/* Row 3: App Preferences (full-width) */}
        <SectionCard
          icon={<Timer size={16} className="accent-text" />}
          title="Application preferences"
          fullWidth
        >
          <AppSettingsForm onDirtyChange={handleAppSettingsDirty} onRegisterSave={handleAppSettingsRegister} />
        </SectionCard>

        <div className="lg:columns-2 lg:gap-5 [&>*]:break-inside-avoid [&>*]:mb-5 [&>*:last-child]:mb-0 lg:[&>*:last-child]:mb-5">
        {/* Row 4: Keyboard Shortcuts (hidden on mobile) + Disk Config */}
        {!isMobileDevice && (
          <SectionCard
            icon={<Keyboard size={16} className="accent-text" />}
            title="Keyboard shortcuts"
          >
            <KeyboardShortcuts />
          </SectionCard>
        )}

        {isAdmin && (
          <SectionCard
            icon={<HardDrive size={16} className="accent-text" />}
            title="Disk configuration"
          >
            <DiskLabelManager />
          </SectionCard>
        )}

        {/* Row 5: Notification Preferences + Alert Thresholds */}
        <SectionCard
          icon={<Bell size={16} className="accent-text" />}
          title="Notification preferences"
        >
          <NotificationPreferencesSection />
        </SectionCard>

        {isAdmin && (
          <SectionCard
            icon={<AlertTriangle size={16} className="text-amber-400" />}
            title="Alert thresholds"
          >
            <AlertThresholdsEditor />
          </SectionCard>
        )}

        {/* Row 6: Lock + Backup (side by side) */}
        <SectionCard
          icon={<LockKeyhole size={16} className="accent-text" />}
          title="Lock & session"
        >
          <AutoLockSettings />
        </SectionCard>

        {isAdmin && (
          <SectionCard
            icon={<Download size={16} className="accent-text" />}
            title="Backup & restore"
          >
            <SettingsExportImport />
          </SectionCard>
        )}

        </div>
        {/* Web terminal — admin only: a real terminal on the server, behind Authelia */}
        {isAdmin && (
          <SectionCard
            icon={<TerminalSquare size={16} className="accent-text" />}
            title="Web terminal"
            fullWidth
          >
            <WebTerminalCard />
          </SectionCard>
        )}
        {/* Themes — everyone picks their own; admins set the one every dashboard follows */}
        <SectionCard
          icon={<Palette size={16} className="accent-text" />}
          title="Themes"
          fullWidth
        >
          <ThemesPanel />
        </SectionCard>

        {/* Custom CSS — admin only */}
        {isAdmin && <SectionCard
          icon={<Palette size={16} className="accent-text" />}
          title="Custom CSS"
          fullWidth
        >
          <div className="space-y-4">
            <p className="text-[10px] text-slate-500">Add custom styles to personalize your dashboard. Changes are saved via the floating save bar.</p>
            <textarea
              aria-label="Custom CSS"
              value={customCSSLocal}
              onChange={(e) => setCustomCSSLocal(e.target.value)}
              placeholder={"/* Add your custom CSS here */\n.glass { border-radius: 1rem; }"}
              rows={10}
              className="w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-xl text-xs text-emerald-400 placeholder-slate-700 font-mono focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 resize-y transition-all leading-relaxed"
              spellCheck={false}
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                {customCSSLocal.length} characters
              </span>
              <button
                onClick={() => { setCustomCSSLocal(''); updateSetting('customCSS', '') }}
                className={BTN_TOOLBAR_QUIET}
              >
                Clear
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              Use browser dev tools to inspect element classes. {CSS_SANITIZE_NOTE} Your CSS is applied after the active theme, so it wins.
            </p>
          </div>
        </SectionCard>}

        {/* Row 7: About + Security (side by side) */}
        <SectionCard
          icon={<Info size={16} className="accent-text" />}
          title="About"
        >
          <div className="space-y-0">
            {[
              { label: 'App version', value: appVersion },
              { label: 'API version', value: versionData?.api_version ?? '--' },
              { label: 'Framework', value: versionData?.framework_version ?? '--' },
              { label: 'Docker', value: versionData?.docker_version ?? '--' },
              { label: 'Compose', value: versionData?.compose_version ?? '--' },
              { label: 'Server URL', value: serverUrl },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-2.5 border-b border-white/[0.03] last:border-b-0">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{item.label}</span>
                <span className="text-sm text-slate-200 font-mono truncate max-w-[65%]" title={typeof item.value === 'string' ? item.value : undefined}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {/* Show Onboarding button */}
          <div className="pt-3 mt-3 border-t border-white/[0.03]">
            <button
              onClick={() => {
                localStorage.removeItem('onboarding_complete')
                window.dispatchEvent(new Event('show-onboarding'))
              }}
              className={BTN_TOOLBAR_QUIET}
            >
              <Info size={14} />
              Show onboarding guide
            </button>
          </div>
        </SectionCard>

        <SectionCard
          icon={<Shield size={16} className="text-rose-400" />}
          title="Security & account"
        >
          <SessionInfo />
          <SecuritySettings />
        </SectionCard>
      </div>

      <FloatingSaveBar
        hasChanges={dirtyCount > 0}
        onSave={handleSaveAll}
        onDiscard={handleDiscardAll}
        saving={saving}
      />
    </div>
    </SettingsDirtyContext.Provider>
  )
}
