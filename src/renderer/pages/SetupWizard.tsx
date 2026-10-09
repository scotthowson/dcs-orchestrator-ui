// =============================================================================
// SetupWizard — 5-step first-run configuration wizard
// Full-screen page (renders outside Sidebar/Header, like Login.tsx): the front
// door of a new install, so it has no page header — the step indicator and the
// step's own heading say where you are. Colours mean what they mean elsewhere:
// emerald = on / fine, amber = needs attention, rose = a problem, cyan =
// information, violet = the fleet (a Proxmox link, a hub, a stack in its own VM).
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { Switch, Tooltip } from '@mantine/core'
import {
  Server, CheckCircle2, User, Lock, Shield,
  Settings, Globe, Clock, FolderOpen, Layers, ChevronUp, ChevronDown,
  Trash2, Plus, Pencil, Sparkles, Loader2, ArrowRight, ArrowLeft,
  Check, AlertCircle, Wifi, WifiOff, Link, Bell, Zap, HardDrive, ChevronRight, Palette,
  AlertTriangle, LifeBuoy, Satellite, Radar, Cpu,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useServerStore } from '../stores/serverStore'
import {
  fetchSetupDefaults, fetchSetupStatus, setupConfigure, setupComplete, renameStack,
  authSetup, authLogin, deployTemplate, setSecret, setupRestore, proxmoxTest, fetchFleetStatus,
  fetchFleetProvisionDefaults, fetchProxmoxCapabilities, provisionFleet, fetchFleetJobs, fetchProxmoxStatus,
} from '../api/endpoints'
import { apiClient, ApiError, ApiNetworkError } from '../api/client'
import { isWebMode } from '../lib/env'
import type { SetupDefaultsResponse, FleetStatus, FleetJoinHubResponse, FleetProvisionDefaults, ProxmoxCapabilities } from '../../shared/types'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import FleetJobsPanel from '../components/fleet/FleetJobsPanel'
import { VmSettingsFields, CapabilityNote, settingsFromDefaults, vmSettingsToRequest, osLabel, type VmSettings } from '../components/fleet/NewVmSheet'
import FleetLinkPanel from '../components/fleet/FleetLinkPanel'
import { VmSizeControl } from '../components/fleet/VmSizeControl'
import PlanCapacity from '../components/fleet/PlanCapacity'
import { HubFirewallNote } from '../components/fleet/fleetShared'
import JoinHubPanel from '../components/fleet/JoinHubPanel'
import Hint from '../components/common/Hint'
import PasswordStrengthMeter from '../components/auth/PasswordStrength'
import ShowPasswordButton from '../components/auth/ShowPasswordButton'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_DANGER, FOCUS_RING } from '../lib/ui'
import { CHOICE, CHOICE_ON, CHOICE_OFF, INPUT, INPUT_ICON, LABEL, FIELD, FIELD_SM } from '../lib/fieldStyles'
// ---------------------------------------------------------------------------
// The pieces every step is drawn with
// ---------------------------------------------------------------------------

/** Geoblock's country list as typed: two letters per country, comma separated (the API checks each one against ISO 3166-1; "UK" is GB) */
const GEOBLOCK_COUNTRIES_RE = /^\s*[A-Za-z]{2}(\s*,\s*[A-Za-z]{2})*\s*$/
const geoblockCountriesOk = (s: string) => GEOBLOCK_COUNTRIES_RE.test(s) && !/\bUK\b/i.test(s)
/** the header button of a folding section: its focus ring sits inside, because the section clips what sticks out */
const SECTION_BTN = 'w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.05] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40'
/** a choice among a few option cards (ntfy: off · deploy here · existing server) */
const OPTION_CARD = 'rounded-lg border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardProps {
  onComplete: () => void
}

interface StackEntry {
  name: string
  label: string
  isDefault: boolean
  isNew: boolean
  editing: boolean
  /** the folder this row started as (a renamed row keeps the stack files it came from) */
  source?: string
}

type Step = 1 | 2 | 3 | 4 | 5

// ---------------------------------------------------------------------------
// Common timezones for the searchable dropdown
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto', 'America/Vancouver',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
  'Europe/Madrid', 'Europe/Amsterdam', 'Europe/Moscow', 'Europe/Istanbul',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
  'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Bangkok',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
  'Pacific/Auckland', 'Pacific/Honolulu', 'Africa/Cairo',
  'Africa/Johannesburg', 'Africa/Lagos',
]

// Every zone the runtime knows, the common ones first. Intl.supportedValuesOf is missing in older WebViews (then the
// common ones are the whole list) and leaves "UTC" out in some engines, which is why the common ones are never dropped.
const ALL_TIMEZONES: string[] = (() => {
  let known: string[] = []
  try {
    if (typeof Intl.supportedValuesOf === 'function') known = Intl.supportedValuesOf('timeZone')
  } catch { /* an engine without the list */ }
  const common = new Set(COMMON_TIMEZONES)
  return [...COMMON_TIMEZONES, ...known.filter((z) => !common.has(z))]
})()

/** A typed zone in its proper spelling ("europe/zurich" → "Europe/Zurich"), or '' when the runtime does not know it.
 *  The list decides; where it is missing or leaves a link name out (US/Pacific), the formatter is the judge — it throws
 *  on a zone it does not know. Only names shaped like an IANA zone are asked, so an offset ("+05:00") never passes. */
function knownTimezone(typed: string): string {
  const t = typed.trim()
  if (!t) return ''
  const hit = ALL_TIMEZONES.find((z) => z.toLowerCase() === t.toLowerCase())
  if (hit) return hit
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(t)) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: t }).resolvedOptions().timeZone || '' } catch { return '' }
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total, needsAdmin = true }: { current: Step; total: number; needsAdmin?: boolean }) {
  const steps = Array.from({ length: total }, (_, i) => i + 1)
  const labels = ['Connect', needsAdmin ? 'Admin' : 'Sign in', 'Server', 'Stacks', 'Review']

  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((s, i) => {
        const isActive = s === current
        const isComplete = s < current
        return (
          <div key={s} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`
                flex items-center justify-center w-9 h-9 rounded-full text-xs font-bold
                transition-all duration-300
                ${isComplete
                  ? 'bg-emerald-500 text-white ring-2 ring-emerald-500/30'
                  : isActive
                    ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/40'
                    : 'bg-slate-800/60 text-slate-500 ring-1 ring-white/[0.06]'
                }
              `}>
                {isComplete ? <Check size={14} /> : s}
              </div>
              <span className={`
                text-[10px] mt-1.5 font-medium transition-colors duration-300
                ${isActive ? 'text-emerald-400' : isComplete ? 'text-slate-400' : 'text-slate-500'}
              `}>
                {labels[i]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`
                w-6 sm:w-10 md:w-16 h-px mx-0.5 sm:mx-1 mb-5 transition-colors duration-300
                ${s < current ? 'bg-emerald-500/50' : 'bg-white/[0.06]'}
              `} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EnvToggle — inline toggle for boolean env vars
// ---------------------------------------------------------------------------

function EnvToggle({ label, helpText, envKey, envVars, setEnvVars }: {
  label: string
  helpText?: string
  envKey: string
  envVars: Record<string, string>
  setEnvVars: (v: Record<string, string>) => void
}) {
  const isOn = envVars[envKey] === 'true'
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-xs text-slate-300">{label}</p>
        {helpText && <p className="text-[10px] text-slate-500">{helpText}</p>}
      </div>
      <Switch
        aria-label={label}
        checked={isOn}
        onChange={() => setEnvVars({ ...envVars, [envKey]: isOn ? 'false' : 'true' })}
        className="shrink-0"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SetupWizard
// ---------------------------------------------------------------------------

/** the wizard's settings from GET /setup/defaults: the server's saved .env over the stock defaults (the saved ones only reach a signed-in admin once one exists) */
function envFromDefaults(data: SetupDefaultsResponse): Record<string, string> {
  return {
        SERVER_NAME: data.defaults.SERVER_NAME || 'Docker Server',
        TZ: data.system.timezone || data.defaults.TZ || 'UTC',
        PROXY_DOMAIN: data.defaults.PROXY_DOMAIN || 'example.com',
        APP_DATA_DIR: data.defaults.APP_DATA_DIR || './App-Data',
        PUID: String(data.system.puid || data.defaults.PUID || '1000'),
        PGID: String(data.system.pgid || data.defaults.PGID || '1000'),
        NTFY_URL: data.defaults.NTFY_URL || '',
        NTFY_TOPIC: data.defaults.NTFY_TOPIC || '',
        LOG_LEVEL: data.defaults.LOG_LEVEL || 'INFO',
        BACKUP_SOURCE_DIR: data.defaults.BACKUP_SOURCE_DIR || '',
        BACKUP_DEST_DIR: data.defaults.BACKUP_DEST_DIR || '',
        CONTINUE_ON_FAILURE: data.defaults.CONTINUE_ON_FAILURE || 'true',
        SKIP_HEALTHCHECK_WAIT: data.defaults.SKIP_HEALTHCHECK_WAIT || 'false',
        SERVICE_START_DELAY: data.defaults.SERVICE_START_DELAY || '5',
        ENABLE_POST_STARTUP_HEALTH_CHECK: data.defaults.ENABLE_POST_STARTUP_HEALTH_CHECK || 'true',
        API_PORT: data.defaults.API_PORT || '9876',
        API_BIND: data.defaults.API_BIND || (isWebMode() ? '0.0.0.0' : '127.0.0.1'),
  }
}

export default function SetupWizard({ onComplete }: WizardProps) {
  // Wizard state
  const [step, setStep] = useState<Step>(1)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminConfirm, setAdminConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [apiToken, setLocalApiToken] = useState<string | null>(null)

  // Server connection
  const [serverUrlInput, setServerUrlInput] = useState(apiClient.getBaseUrl() || 'http://')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Server config
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [stacks, setStacks] = useState<StackEntry[]>([])

  // Defaults from server
  const [defaults, setDefaults] = useState<SetupDefaultsResponse | null>(null)

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [complete, setComplete] = useState(false)

  // New stack input
  const [newStackName, setNewStackName] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [labelEditIndex, setLabelEditIndex] = useState<number | null>(null)
  const [labelEditValue, setLabelEditValue] = useState('')

  // Timezone filter
  const [tzFilter, setTzFilter] = useState('')
  const [tzDropdownOpen, setTzDropdownOpen] = useState(false)

  // Push notifications: off, a self-hosted ntfy deployed by the wizard, or an existing server
  const [notifyMode, setNotifyMode] = useState<'off' | 'self' | 'external'>('off')
  const [ntfyPort, setNtfyPort] = useState('8093')
  // Per-step outcome of the completion run, shown on the success screen
  const [setupResults, setSetupResults] = useState<{ label: string; ok: boolean; detail?: string }[]>([])

  // Collapsible advanced sections (Step 3)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showStartup, setShowStartup] = useState(false)
  const [showBackup, setShowBackup] = useState(false)
  const [showTraefik, setShowTraefik] = useState(false)
  const [showPreferences, setShowPreferences] = useState(false)
  // Proxmox link (Step 3): opened by itself when the API says this is a Proxmox guest
  const [showProxmox, setShowProxmox] = useState(false)
  const [pveUrl, setPveUrl] = useState('')
  const [pveTokenId, setPveTokenId] = useState('')
  const [pveSecret, setPveSecret] = useState('')
  const [pveVerify, setPveVerify] = useState(true)
  const [pveTesting, setPveTesting] = useState(false)
  const [pveTest, setPveTest] = useState<{ ok: boolean; text: string } | null>(null)
  // a link setup.sh (or an earlier wizard run) saved: its secret stays on the server, the fields show the rest
  const [pveSaved, setPveSaved] = useState<{ url: string; token_id: string } | null>(null)
  // Fleet (3.9): link the other VMs from here (hub), or join a hub (member)
  const [fleetStatus, setFleetStatus] = useState<FleetStatus | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [linkedMembers, setLinkedMembers] = useState(0)
  const [showFleet, setShowFleet] = useState(false)
  const [joined, setJoined] = useState<FleetJoinHubResponse | null>(null)
  // The VM is the stack: with Proxmox linked, each stack (but core-infrastructure) gets its own VM built by the hub
  const [provDefaults, setProvDefaults] = useState<FleetProvisionDefaults | null>(null)
  const [caps, setCaps] = useState<ProxmoxCapabilities | null>(null)
  const [vmSettings, setVmSettings] = useState<VmSettings | null>(null)
  const vmEditedRef = useRef(false) // a re-test refreshes the VM settings from the hub's defaults unless they were edited
  // default stacks the person removed on the stack page: the server deletes their folders when setup is applied
  const [removedStacks, setRemovedStacks] = useState<string[]>([])
  const [placements, setPlacements] = useState<Record<string, 'hub' | 'vm'>>({})
  const [vmSpecs, setVmSpecs] = useState<Record<string, { cores: number; memGb: number; diskGb: number }>>({})
  const [showVmSettings, setShowVmSettings] = useState(false)
  const [sizeOpen, setSizeOpen] = useState<string | null>(null)
  const [vmQueued, setVmQueued] = useState(0)
  const vmReady = !!(pveTest?.ok && caps?.can_provision && vmSettings)
  const jobsPoll = usePolling(fetchFleetJobs, 5000, { key: pollKeys.fleetJobs, enabled: complete && vmQueued > 0, requireConnection: false })
  const pveGuest = !!defaults?.system?.proxmox?.guest
  const pveHost = !!defaults?.system?.proxmox?.host
  const usingSavedSecret = !!(pveSaved && !pveSecret.trim() && pveTokenId.trim() === pveSaved.token_id)
  const pveFilled = !!(pveUrl.trim() && pveTokenId.trim() && (pveSecret.trim() || usingSavedSecret))
  const fleetRole = defaults?.system?.fleet_role
  useEffect(() => {
    const p = defaults?.system?.proxmox
    if (!p) return
    // a Proxmox guest or host, the hub chosen in setup.sh, or a link setup.sh saved: the section opens by itself
    if (p.guest || p.host || p.linked || defaults?.system?.fleet_role === 'hub') setShowProxmox(true)
    if (p.hint_url && !pveUrl) setPveUrl(p.hint_url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults])
  // Once signed in: a link saved on the server (./setup.sh asks for it on a hub) fills the fields and is tested
  const loadSavedPve = async () => {
    try {
      const st = await fetchProxmoxStatus()
      if (!st.configured || !st.url || !st.token_id) return
      setPveUrl(st.url); setPveTokenId(st.token_id); setPveVerify(st.verify_tls); setPveSecret('')
      setPveSaved({ url: st.url, token_id: st.token_id }); setShowProxmox(true)
      await runPveTest({ url: st.url, token_id: st.token_id, verify_tls: st.verify_tls })
    } catch { /* not linked, or an older server: the fields stay as they are */ }
  }
  const runPveTest = async (given?: { url: string; token_id: string; verify_tls: boolean }) => {
    setPveTesting(true); setPveTest(null)
    // an empty secret asks the server to use the one it keeps (the saved link's)
    const pve = given ? { ...given, token_secret: '' } : { url: pveUrl.trim(), token_id: pveTokenId.trim(), token_secret: pveSecret.trim(), verify_tls: pveVerify }
    try {
      const r = await proxmoxTest(pve)
      setPveTest(r.reachable ? { ok: true, text: `Connected: Proxmox VE ${r.version}, ${r.nodes} node${r.nodes === 1 ? '' : 's'}, ${r.vms.total} guests (${r.vms.running} running)` } : { ok: false, text: r.error || r.hints?.[0] || 'Not reachable' })
      if (r.reachable) {
        void Promise.allSettled([fetchProxmoxCapabilities(pve), fetchFleetProvisionDefaults(pve)]).then(([c, d]) => {
          if (c.status === 'fulfilled') setCaps(c.value)
          if (d.status === 'fulfilled') { setProvDefaults(d.value); setVmSettings((v) => (v && vmEditedRef.current) ? v : settingsFromDefaults(d.value)) }
        })
      } else { setCaps(null); setProvDefaults(null); setVmSettings(null) }
    } catch (e) {
      setPveTest({ ok: false, text: e instanceof Error ? e.message : 'The test failed' })
    } finally { setPveTesting(false) }
  }

  // Traefik HTTPS configuration
  const [enableTraefik, setEnableTraefik] = useState(false)
  const [traefikEmail, setTraefikEmail] = useState('')
  const [traefikTrustedLan, setTraefikTrustedLan] = useState('192.168.1.0/24')
  const [cfDnsToken, setCfDnsToken] = useState('')
  const [includeDockerSocket, setIncludeDockerSocket] = useState(true)
  // Traefik's add-ons (switches of the template): each declares a Traefik plugin only while it is on, since Traefik
  // does not start when a declared plugin cannot be fetched
  const [traefikSablier, setTraefikSablier] = useState(false)
  const [traefikCloudflareIp, setTraefikCloudflareIp] = useState(false)
  const [traefikGeoblock, setTraefikGeoblock] = useState(false)
  const [traefikGeoblockCountries, setTraefikGeoblockCountries] = useState('')
  const [traefikThemePark, setTraefikThemePark] = useState(false)
  const [traefikMaintenance, setTraefikMaintenance] = useState(false)
  const traefikAddonsOn = [
    traefikSablier && 'Start on demand',
    traefikCloudflareIp && 'Cloudflare real IP',
    traefikGeoblock && `Geoblock${traefikGeoblockCountries.trim() ? ` (${traefikGeoblockCountries.toUpperCase().replace(/\s+/g, '')})` : ''}`,
    traefikThemePark && 'theme.park',
    traefikMaintenance && 'Maintenance mode',
  ].filter((x): x is string => typeof x === 'string')
  const [enableDDNS, setEnableDDNS] = useState(false)
  const [ddnsSubdomains, setDdnsSubdomains] = useState('@')
  const [ddnsInterval, setDdnsInterval] = useState(300)

  // Authelia SSO configuration (requires Traefik)
  const [enableAuthelia, setEnableAuthelia] = useState(false)
  const [autheliaUser, setAutheliaUser] = useState('')
  const [autheliaDisplay, setAutheliaDisplay] = useState('')
  const [autheliaEmail, setAutheliaEmail] = useState('')
  const [autheliaPassword, setAutheliaPassword] = useState('')
  // Where the proxy services and ntfy land: follows the stack list the user builds
  const [proxyStack, setProxyStack] = useState('networking-security')
  const [notifyStack, setNotifyStack] = useState('communication-collaboration')
  // CrowdSec: intrusion detection on Traefik's log, bouncer at the proxy, Discord alerts
  const [enableCrowdsec, setEnableCrowdsec] = useState(true)
  const [crowdsecBouncer, setCrowdsecBouncer] = useState(true)
  // Stacks the wizard deploys into stay on the hub: core-infrastructure (the dashboard), the proxy stack
  // (Traefik serves every VM's routes; Authelia and CrowdSec sit with it) and the self-hosted ntfy's stack
  const hubOnly: Record<string, string> = { 'core-infrastructure': 'The dashboard runs here' }
  if (enableTraefik) hubOnly[proxyStack] = 'Traefik runs here: the hub serves every VM\'s routes'
  if (notifyMode === 'self' && notifyStack) hubOnly[notifyStack] = hubOnly[notifyStack] ?? 'ntfy runs here'
  for (const n of provDefaults?.running_stacks ?? []) hubOnly[n] = hubOnly[n] ?? 'Its containers are running on this server already'
  const placementOf = (name: string): 'hub' | 'vm' => hubOnly[name] ? 'hub' : placements[name] ?? (vmReady ? 'vm' : 'hub')
  const specOf = (name: string) => vmSpecs[name] ?? { cores: provDefaults?.defaults.cores ?? 2, memGb: Math.round((provDefaults?.defaults.memory_mb ?? 4096) / 1024), diskGb: provDefaults?.defaults.disk_gb ?? 32 }
  // a guest on Proxmox already carries the stack's name (a leftover of an earlier attempt, or someone's VM): the hub
  // refuses to build a twin, so that stack is left out of the build — the rest still gets its VMs
  const clashOf = (name: string) => provDefaults?.guests?.find((g) => g.name === name)
  const vmPlan = stacks.filter((st) => placementOf(st.name) === 'vm' && !clashOf(st.name)).map((st) => ({ stack: st.name, source: st.source && st.source !== st.name ? st.source : undefined, ...specOf(st.name) }))

  // Client-side dashboard preferences
  const [prefTheme, setPrefTheme] = useState<'dark' | 'light' | 'system'>(() => useSettingsStore.getState().theme)
  const [prefSessionMinutes, setPrefSessionMinutes] = useState(240)
  const [prefAutoLock, setPrefAutoLock] = useState(0)
  // this device's own name and subtitle, if it has them: setting up another server must not reset them
  const [prefAppName, setPrefAppName] = useState(() => useSettingsStore.getState().projectName || 'DCS Orchestrator')
  // '' = the server's name
  const [prefAppSubtitle, setPrefAppSubtitle] = useState(() => useSettingsStore.getState().projectSubtitle || '')

  // Pre-flight validation
  const [alreadyConfigured, setAlreadyConfigured] = useState(false)
  const [needsAdmin, setNeedsAdmin] = useState(true)
  // Restore a recovery bundle instead of setting up from scratch
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreDone, setRestoreDone] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const handleRestoreBundle = useCallback(async () => {
    if (!restoreFile || !restorePass || restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => { const r = String(reader.result || ''); resolve(r.includes(',') ? r.slice(r.indexOf(',') + 1) : r) }
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(restoreFile)
      })
      const res = await setupRestore(b64, restorePass)
      setRestoreDone(res.message || 'Restored')
      // the restored accounts and settings take over: reload into the sign-in page
      setTimeout(() => window.location.reload(), res.restart_scheduled ? 7000 : 2500)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }, [restoreFile, restorePass, restoring])

  // Server URL from settings
  const { setServerUrl } = useConnectionStore()
  const { register, login, setApiToken: setStoreApiToken } = useAuthStore()

  // Defaults that already carry an ntfy URL mean "use that server"
  useEffect(() => {
    if (envVars.NTFY_URL && notifyMode === 'off') setNotifyMode('external')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envVars.NTFY_URL])

  // Override body overflow:hidden so the wizard page can scroll
  useEffect(() => {
    document.body.style.overflow = 'auto'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Auto-connect in web/Docker mode (API is at /api on same origin)
  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (isWebMode() && !autoConnectRef.current) {
      autoConnectRef.current = true
      handleConnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to server and fetch defaults
  useEffect(() => {
    const names = stacks.map((st) => st.name)
    if (names.length === 0) return
    if (!names.includes(proxyStack)) setProxyStack(names.includes('networking-security') ? 'networking-security' : names[0])
    if (!names.includes(notifyStack)) setNotifyStack(names.includes('communication-collaboration') ? 'communication-collaboration' : names[0])
  }, [stacks, proxyStack, notifyStack])

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    setConnected(false)
    setDefaults(null)

    // Normalize the URL
    let url = serverUrlInput.trim()
    if (!url) {
      setError('Please enter a server URL')
      setConnecting(false)
      return
    }
    // Relative URLs (Docker/web mode uses /api) — pass through as-is
    if (!url.startsWith('/')) {
      // Add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`
      }
      // Add default port if none specified
      try {
        const parsed = new URL(url)
        if (!parsed.port && !url.includes(':9876')) {
          url = `${parsed.protocol}//${parsed.hostname}:9876`
        }
      } catch {
        setError('Invalid URL format')
        setConnecting(false)
        return
      }
    }

    // Apply the URL
    apiClient.setBaseUrl(url)
    setServerUrl(url)
    useSettingsStore.getState().updateSetting('serverUrl', url)
    setServerUrlInput(url)

    // Test connection by fetching defaults
    try {
      const data = await fetchSetupDefaults()
      setDefaults(data)

      // Pre-populate env vars from defaults
      setEnvVars(envFromDefaults(data))

      // Check if server is already initialized
      try {
        const status = await fetchSetupStatus()
        if (status.initialized) {
          setAlreadyConfigured(true)
        }
        // Track whether admin account still needs to be created
        if (status.needs_admin === false) {
          setNeedsAdmin(false)
        }
      } catch {
        // Setup status check is best-effort
      }

      // Pre-populate stacks
      setStacks(data.stacks.map((name) => ({
        name,
        label: '',
        isDefault: true,
        isNew: false,
        editing: false,
      })))

      setConnected(true)
    } catch (err) {
      if (err instanceof ApiNetworkError) {
        setError(`Cannot reach server at ${url} — is the API running?`)
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed')
      }
    } finally {
      setConnecting(false)
    }
  }

  // Validation helpers
  const isStep2Valid = useCallback(() => {
    if (!adminUsername.trim() || adminUsername.length < 3) return false
    if (adminPassword.length < 8) return false
    if (needsAdmin) {
      // Creating new account — enforce strong password + confirmation
      if (!/[A-Z]/.test(adminPassword)) return false
      if (!/[0-9]/.test(adminPassword)) return false
      if (adminPassword !== adminConfirm) return false
    }
    return true
  }, [adminUsername, adminPassword, adminConfirm, needsAdmin])

  const notifyTopicValid = /^[A-Za-z0-9_-]{1,64}$/.test((envVars.NTFY_TOPIC || 'dcs').trim())
  const notifyValid =
    notifyMode === 'off' ||
    (notifyMode === 'self' && /^\d{2,5}$/.test(ntfyPort) && Number(ntfyPort) > 0 && Number(ntfyPort) < 65536 && notifyTopicValid) ||
    (notifyMode === 'external' && /^https?:\/\/\S+$/.test((envVars.NTFY_URL || '').trim()) && notifyTopicValid)

  // HTTPS through Traefik needs a domain of the person's own and a mailbox Let's Encrypt accepts: with the
  // example.com placeholder (as the domain, or in the address) the certificate request is refused, and the wizard
  // used to deploy Traefik anyway and leave every route without a certificate
  const traefikDomainValid = !!(envVars.PROXY_DOMAIN || '').trim() && (envVars.PROXY_DOMAIN || '').trim().toLowerCase() !== 'example.com'
  const traefikEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(traefikEmail.trim()) && !/@example\.(com|org|net)$/i.test(traefikEmail.trim())
  const traefikValid = !enableTraefik || (traefikDomainValid && traefikEmailValid)

  const isStep3Valid = useCallback(() => {
    // Geoblock without a usable country list would be refused by the deploy: it stops the step here instead
    if (enableTraefik && traefikGeoblock && !geoblockCountriesOk(traefikGeoblockCountries)) return false
    return !!(envVars.SERVER_NAME?.trim() && envVars.TZ?.trim()) && notifyValid && traefikValid
  }, [envVars, notifyValid, traefikValid, enableTraefik, traefikGeoblock, traefikGeoblockCountries])

  const isStep4Valid = useCallback(() => {
    if (!(stacks.length >= 1 && stacks.every((s) => /^[a-z0-9][a-z0-9_-]*$/.test(s.name)))) return false
    if (vmPlan.length > 0) {
      if (!vmSettings || !vmSettings.node || !vmSettings.storage || !vmSettings.gateway || !vmSettings.ip_start) return false
      if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(vmSettings.gateway) || !/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(vmSettings.ip_start)) return false
    }
    return true
  }, [stacks, vmPlan.length, vmSettings])

  // Navigation
  const canNext = useCallback(() => {
    switch (step) {
      case 1: return connected && defaults !== null && !alreadyConfigured
      case 2: return isStep2Valid()
      case 3: return isStep3Valid()
      case 4: return isStep4Valid()
      case 5: return true
      default: return false
    }
  }, [step, connected, defaults, alreadyConfigured, isStep2Valid, isStep3Valid, isStep4Valid])

  const handleNext = async () => {
    setError(null)

    // Step 2: Create admin account or sign in to existing one
    if (step === 2) {
      setLoading(true)
      try {
        let res
        if (needsAdmin) {
          // First-time setup — create admin account
          res = await authSetup(adminUsername.trim(), adminPassword)
        } else {
          // Users already exist (interrupted setup) — sign in
          res = await authLogin(adminUsername.trim(), adminPassword)
        }
        if (res.success && res.token) {
          setLocalApiToken(res.token)
          apiClient.setAuthToken(res.token)
          setStoreApiToken(res.token)
          // the session this server just issued is kept for it (serverStore): the dashboard opens with it after the wizard
          await useServerStore.getState().sessionStarted({ token: res.token, username: res.username || adminUsername.trim(), role: res.role })

          // Register locally so the app has a local account session
          const registered = await register(adminUsername.trim(), adminPassword)
          if (!registered) {
            // Account already exists locally (e.g. previous session) — log in instead
            await login(adminUsername.trim(), adminPassword, true)
          }
          // a resumed setup: the settings saved last time are only the admin's to read, so read them now
          if (!needsAdmin) {
            void fetchSetupDefaults().then((d) => { setDefaults(d); setEnvVars((cur) => ({ ...cur, ...envFromDefaults(d) })) }).catch(() => {})
          }
          // A join saved by setup.sh (this VM runs under a hub) opens its section by itself
          void fetchFleetStatus().then((f) => { setFleetStatus(f); if (f.pending_join) setShowFleet(true) }).catch(() => {})
          // …and a Proxmox link it saved fills the Proxmox fields and is tested
          if (!pveTest?.ok) void loadSavedPve()
        } else {
          setError(needsAdmin ? 'Failed to create admin account' : 'Invalid credentials')
          setLoading(false)
          return
        }
      } catch (err) {
        if (err instanceof ApiNetworkError) {
          setError('Cannot reach the server. Check the connection.')
        } else {
          setError(err instanceof Error ? err.message : (needsAdmin ? 'Failed to create admin account' : 'Sign in failed'))
        }
        setLoading(false)
        return
      }
      setLoading(false)
    }

    if (step < 5) {
      setStep((step + 1) as Step)
    }
  }

  const handleBack = () => {
    setError(null)
    if (step > 1) {
      setStep((step - 1) as Step)
    }
  }

  const handleComplete = async () => {
    setError(null)
    setCompleting(true)

    try {
      // 0. A stack renamed on the Stacks step that stays on the hub: its folder is renamed on the server first
      //    (POST /stacks/rename). The configure call only takes names, so a renamed row used to make a NEW empty
      //    stack beside the old folder and its files. A refusal (containers run from it, the new name is taken) stops
      //    the run with the server's reason before anything else is written. Rows placed in a VM carry their source
      //    to the build instead (vmPlan).
      for (const s of stacks) {
        if (!s.source || s.source === s.name || placementOf(s.name) !== 'hub') continue
        try {
          await renameStack(s.source, s.name)
        } catch (err) {
          // no folder of that name on the server (a default it never created): nothing to carry over, configure makes the new one
          if (!(err instanceof ApiError && err.status === 404)) {
            throw new Error(`Could not rename the stack ${s.source} to ${s.name}: ${err instanceof Error ? err.message : 'the server refused'}`)
          }
        }
        // done on the server: the row now starts as its new name, so a retry of this run does not rename again
        const renamed = s.name
        setStacks((prev) => prev.map((row) => (row.name === renamed ? { ...row, source: undefined } : row)))
      }

      // 1. Build ALL env vars in one go — includes API, Traefik, DDNS settings
      const allEnvVars: Record<string, string> = {
        ...envVars,
        API_ENABLED: 'true',
        API_PORT: '9876',
        API_BIND: '0.0.0.0',
        // Don't set API_AUTH_ENABLED — let the server auto-detect from API_BIND.
        // When API_BIND=0.0.0.0, the server enables auth automatically.
      }

      // The Cloudflare token is stored as the secret CF_DNS_API_TOKEN; every
      // file only references it as ${SECRETS_CF_DNS_API_TOKEN}, so it never
      // sits in plain text (Traefik, DDNS and the DNS page resolve it)
      let cfTokenValue = ''
      let cfTokenStoredAsSecret = false
      if (cfDnsToken.trim()) {
        try {
          await setSecret('CF_DNS_API_TOKEN', cfDnsToken.trim())
          cfTokenValue = '${SECRETS_CF_DNS_API_TOKEN}'
          cfTokenStoredAsSecret = true
        } catch (err) {
          console.error('[SetupWizard] storing the Cloudflare token as a secret failed:', err)
          cfTokenValue = cfDnsToken.trim()
        }
      }

      // Add Traefik + Cloudflare vars if enabled
      if (enableTraefik && envVars.PROXY_DOMAIN) {
        allEnvVars.TRAEFIK_DOMAIN = envVars.PROXY_DOMAIN
        if (cfTokenValue) allEnvVars.CF_DNS_API_TOKEN = cfTokenValue
      }

      // Add DDNS vars if enabled — its switch lives in the Traefik block, so with HTTPS off there is no domain for it
      // to keep pointed here (a switch left on before HTTPS was turned off used to write the keys anyway)
      if (enableTraefik && enableDDNS && cfDnsToken) {
        allEnvVars.DDNS_ENABLED = 'true'
        allEnvVars.DDNS_SUBDOMAINS = ddnsSubdomains || '@'
        allEnvVars.DDNS_INTERVAL = String(ddnsInterval)
      }

      // Push notifications: the API runs on the host, so a self-hosted ntfy is
      // reached on the loopback port; the topic is appended by the server.
      const ntfyTopic = (envVars.NTFY_TOPIC || 'dcs').trim()
      // The access token is a secret the wizard never reads back, so its field is empty on a resumed setup: it is
      // only sent when someone typed one (an empty value used to blank the token saved before). The ntfy the wizard
      // deploys itself is reached without one, so a token left from another server is cleared rather than sent to it.
      const ntfyTokenTyped = (envVars.NTFY_TOKEN || '').trim()
      delete allEnvVars.NTFY_TOKEN
      if (notifyMode === 'self') {
        allEnvVars.NTFY_URL = `http://127.0.0.1:${ntfyPort}`
        allEnvVars.NTFY_TOPIC = ntfyTopic
        allEnvVars.NTFY_TOKEN = ''
      } else if (notifyMode === 'external') {
        allEnvVars.NTFY_URL = (envVars.NTFY_URL || '').trim().replace(/\/+$/, '')
        allEnvVars.NTFY_TOPIC = ntfyTopic
        if (ntfyTokenTyped) allEnvVars.NTFY_TOKEN = ntfyTokenTyped
      } else {
        allEnvVars.NTFY_URL = ''
      }
      // Proxmox link: only when every field is filled (the page can be linked later).
      // The token secret goes to the secret store like the Cloudflare token; .env only if that fails.
      let pveSecretStored = false
      if (pveFilled) {
        allEnvVars.PROXMOX_URL = pveUrl.trim().replace(/\/+$/, '')
        allEnvVars.PROXMOX_TOKEN_ID = pveTokenId.trim()
        allEnvVars.PROXMOX_VERIFY_TLS = pveVerify ? 'true' : 'false'
        if (pveSecret.trim()) {
          try {
            await setSecret('PROXMOX_TOKEN_SECRET', pveSecret.trim())
            pveSecretStored = true
          } catch (err) {
            console.error('[SetupWizard] storing the Proxmox secret failed, writing .env:', err)
            allEnvVars.PROXMOX_TOKEN_SECRET = pveSecret.trim()
          }
        }
      }
      const results: { label: string; ok: boolean; detail?: string }[] = []
      if (cfDnsToken.trim()) {
        results.push(cfTokenStoredAsSecret
          ? { label: 'Cloudflare token stored as the secret CF_DNS_API_TOKEN', ok: true }
          : { label: 'Cloudflare token', ok: false, detail: 'The secret store was unavailable, so the token was written to .env in plain text' })
      }

      // Single setupConfigure call with everything — MUST be before setupComplete
      const configured = await setupConfigure({
        env_vars: allEnvVars,
        stacks: stacks.filter((s) => placementOf(s.name) === 'hub').map((s) => s.name),
        remove_stacks: removedStacks.filter((n) => !stacks.some((s) => s.name === n || s.source === n)),
      })
      results.push({ label: 'Configuration saved', ok: true })
      if (configured.stacks_removed?.length) results.push({ label: `Removed stack${configured.stacks_removed.length === 1 ? '' : 's'}: ${configured.stacks_removed.join(', ')}`, ok: true })
      const kept = (configured.stacks_warned ?? []).filter((n) => removedStacks.includes(n))
      if (kept.length) results.push({ label: `Kept ${kept.join(', ')}`, ok: false, detail: `Containers run from it, or its App-Data folder holds data — remove it from the ${pageLabel('stacks')} page when you are sure` })
      if (pveFilled) results.push({ label: `Proxmox linked (${pveUrl.trim()})${!pveSecret.trim() ? ' — the token secret saved before is kept' : pveSecretStored ? ' — token secret in the secret store' : ' — token secret written to .env'}`, ok: true, detail: pveTest?.ok ? pveTest.text : `Not tested — the ${pageLabel('proxmox')} page will say if the token is refused` })
      if (linkedMembers > 0) results.push({ label: `${linkedMembers} fleet member${linkedMembers === 1 ? '' : 's'} linked — their stacks show under their VMs on the ${pageLabel('proxmox')} page`, ok: true })
      if (joined) results.push({ label: `Joined the hub ${joined.hub.name || joined.hub.url} as "${joined.member.name}"`, ok: true, detail: joined.member.vmid ? `Guest ${joined.member.vmid}${joined.member.node ? ` on ${joined.member.node}` : ''}` : `The hub could not tell which guest this is — pick it on its ${pageLabel('proxmox')} page` })

      // 2. Deploy Traefik BEFORE marking setup complete (needs setup mode for permissive CORS/auth)
      if (enableTraefik && envVars.PROXY_DOMAIN) {
        try {
          const res = await deployTemplate('traefik', {
            target_stack: proxyStack,
            variables: {
              TRAEFIK_DOMAIN: envVars.PROXY_DOMAIN,
              TRAEFIK_ACME_EMAIL: traefikEmail || `admin@${envVars.PROXY_DOMAIN}`,
              TRAEFIK_TRUSTED_LAN: traefikTrustedLan,
              ...(cfTokenValue ? { CF_DNS_API_TOKEN: cfTokenValue } : {}),
              // the add-ons: a plugin is declared only while its switch is on
              TRAEFIK_SABLIER: traefikSablier ? 'true' : 'false',
              TRAEFIK_CLOUDFLARE_REAL_IP: traefikCloudflareIp ? 'true' : 'false',
              TRAEFIK_GEOBLOCK: traefikGeoblock ? 'true' : 'false',
              ...(traefikGeoblock ? { TRAEFIK_GEOBLOCK_COUNTRIES: traefikGeoblockCountries.trim() } : {}),
              TRAEFIK_THEMEPARK: traefikThemePark ? 'true' : 'false',
              TRAEFIK_MAINTENANCE: traefikMaintenance ? 'true' : 'false',
            },
            auto_start: true,
            replace_services: true,
            exclude_services: includeDockerSocket ? [] : ['docker-socket-proxy'],
          })
          results.push({ label: 'Traefik deployed', ok: res.started !== false, detail: res.started === false ? (res as { warning?: string }).warning || 'Deployed but not started' : undefined })
          if (traefikSablier) {
            if (res.sablier?.deployed) results.push({ label: 'Sablier deployed with Traefik (start on demand)', ok: true })
            else if (res.sablier?.present) results.push({ label: 'Sablier runs already: its plugin is declared', ok: true })
            else results.push({ label: 'Sablier deployment', ok: false, detail: res.sablier?.error || 'not deployed' })
          }
          const addonsOn = traefikAddonsOn.filter((a) => !a.startsWith('Start on demand'))
          if (addonsOn.length) results.push({ label: `Traefik add-ons: ${addonsOn.join(', ')}`, ok: true })
        } catch (err) {
          console.error('[SetupWizard] Traefik deploy failed:', err)
          results.push({ label: 'Traefik deployment', ok: false, detail: err instanceof Error ? err.message : 'failed' })
        }
      }

      // 3b. Deploy Authelia if enabled (non-fatal — requires Traefik)
      if (enableAuthelia && enableTraefik && autheliaUser && autheliaPassword) {
        try {
          const res = await deployTemplate('authelia', {
            target_stack: proxyStack,
            variables: {
              AUTHELIA_ADMIN_USER: autheliaUser,
              AUTHELIA_ADMIN_DISPLAY: autheliaDisplay || autheliaUser,
              AUTHELIA_ADMIN_EMAIL: autheliaEmail || `${autheliaUser}@${envVars.PROXY_DOMAIN || 'localhost'}`,
              AUTHELIA_ADMIN_PASSWORD: autheliaPassword,
            },
            auto_start: true,
            replace_services: true,
            connect_proxy: true,
          })
          results.push({ label: 'Authelia deployed', ok: res.started !== false, detail: res.started === false ? (res as { warning?: string }).warning || 'Deployed but not started' : undefined })
        } catch (err) {
          console.error('[SetupWizard] Authelia deploy failed:', err)
          results.push({ label: 'Authelia deployment', ok: false, detail: err instanceof Error ? err.message : 'failed' })
        }
      }

      // 3c. CrowdSec: reads Traefik's access log, bans at the proxy, alerts to Discord
      if (enableCrowdsec && enableTraefik) {
        try {
          const res = await deployTemplate('crowdsec', {
            target_stack: proxyStack,
            variables: {
              ENABLE_TRAEFIK_BOUNCER: crowdsecBouncer ? 'true' : 'false',
              DISCORD_WEBHOOK_URL: (envVars.DISCORD_WEBHOOK_URL || '').trim(),
            },
            auto_start: true,
            replace_services: true,
          })
          results.push({ label: 'CrowdSec deployed', ok: res.started !== false, detail: res.started === false ? (res as { warning?: string }).warning || 'Deployed but not started' : undefined })
        } catch (err) {
          console.error('[SetupWizard] CrowdSec deploy failed:', err)
          results.push({ label: 'CrowdSec deployment', ok: false, detail: err instanceof Error ? err.message : 'failed' })
        }
      }

      // 3d. Self-hosted ntfy so DCS notifications work out of the box
      if (notifyMode === 'self') {
        const targetStack = notifyStack || stacks[0]?.name || 'communication-collaboration'
        try {
          const res = await deployTemplate('ntfy', {
            target_stack: targetStack,
            variables: { PORT_NTFY: ntfyPort },
            auto_start: true,
            replace_services: true,
            connect_proxy: enableTraefik,
          })
          results.push({ label: `ntfy deployed to ${targetStack}`, ok: res.started !== false, detail: res.started === false ? (res as { warning?: string }).warning || 'Deployed but not started' : `Subscribe to topic "${ntfyTopic}" in the ntfy app` })
        } catch (err) {
          console.error('[SetupWizard] ntfy deploy failed:', err)
          results.push({ label: 'ntfy deployment', ok: false, detail: err instanceof Error ? err.message : 'failed' })
        }
      } else if (notifyMode === 'external') {
        results.push({ label: `Notifications via ${allEnvVars.NTFY_URL}/${ntfyTopic}`, ok: true })
      }
      setSetupResults(results)

      // 3. Mark setup as complete (AFTER template deploys so they run in setup mode);
      //    a join setup.sh saved that was not run above happens here
      const done = await setupComplete()
      // 3c. The VMs: one per stack placed in a VM, built by the hub in the background
      const leftOut = stacks.filter((st) => placementOf(st.name) === 'vm' && clashOf(st.name)).map((st) => `${st.name} (VM ${clashOf(st.name)?.vmid})`)
      if (leftOut.length > 0) {
        results.push({ label: `Left out of the build: ${leftOut.join(', ')}`, ok: false, detail: `A guest with the stack's name already exists on Proxmox — delete or rename it there, or link it from the ${pageLabel('proxmox')} page, then add the stack as a VM (New VM)` })
      }
      if (vmPlan.length > 0 && vmSettings) {
        try {
          const r = await provisionFleet({ ...vmSettingsToRequest(vmSettings), vms: vmPlan.map((v) => ({ stack: v.stack, source: v.source, cores: v.cores, memory_mb: v.memGb * 1024, disk_gb: v.diskGb })) })
          setVmQueued(r.jobs.length)
          const built = r.jobs.filter((j) => !j.bake), templates = r.jobs.filter((j) => j.bake)
          results.push({
            label: `${built.length} VM${built.length === 1 ? '' : 's'} being built by the hub${templates.length ? `, after a DCS template of the operating system` : ''}: ${built.map((j) => `${j.stack} (${j.ip})`).join(', ')}`,
            ok: true,
            detail: templates.length ? `The template is baked once (${templates.map((j) => j.ip).join(', ')}); every VM is then cloned from it in about half a minute and joins this hub` : 'Each VM gets Docker and DCS, joins this hub and runs its stack',
          })
        } catch (err) {
          results.push({ label: 'Building the VMs', ok: false, detail: `${err instanceof Error ? err.message : 'failed'} — the ${pageLabel('proxmox')} page can build them one by one` })
        }
        setSetupResults([...results])
      }
      // the VM that runs this DCS has its Proxmox tags now (dcs, and hub on a hub)
      if (done?.proxmox_tag?.guest) {
        const t = done.proxmox_tag
        results.push(t.tagged
          ? { label: t.changed ? `Tagged this VM in Proxmox: ${t.wanted.join(', ')}` : `This VM already carries its Proxmox tags: ${t.wanted.join(', ')}`, ok: true }
          : { label: `This VM could not be tagged in Proxmox (${t.wanted.join(', ')})`, ok: false, detail: t.message })
        setSetupResults([...results])
      }
      if (done?.fleet_join) {
        results.push(done.fleet_join.joined
          ? { label: `Joined the hub ${done.fleet_join.hub?.name || done.fleet_join.hub?.url || ''} as "${done.fleet_join.member?.name ?? ''}"`, ok: true }
          : { label: `Joining the hub ${done.fleet_join.hub_url || ''} failed`, ok: false, detail: `${done.fleet_join.error || ''} — run ./setup.sh --join <hub-url> <code> on this VM, or use the ${pageLabel('proxmox')} page` })
        setSetupResults([...results])
      }

      // 4. Persist client-side dashboard preferences
      const settingsState = useSettingsStore.getState()
      settingsState.updateSetting('theme', prefTheme)
      settingsState.updateSetting('sessionDurationMinutes', prefSessionMinutes)
      settingsState.updateSetting('autoLockMinutes', prefAutoLock)
      settingsState.updateSetting('projectName', prefAppName)
      settingsState.updateSetting('projectSubtitle', prefAppSubtitle)

      // 3b. Persist stack labels as annotations
      const labelledStacks = stacks.filter((s) => s.label)
      if (labelledStacks.length > 0) {
        const annotations = { ...settingsState.stackAnnotations }
        for (const s of labelledStacks) {
          annotations[s.name] = { ...annotations[s.name], label: s.label }
        }
        settingsState.updateSetting('stackAnnotations', annotations)
      }

      // 4. Ensure authenticated before redirect (safety net)
      const authState = useAuthStore.getState()
      if (!authState.isAuthenticated && adminUsername && adminPassword) {
        await login(adminUsername.trim(), adminPassword, true)
        // the dashboard opens only with a session the server issued (serverStore); without one, the sign-in follows
        if (apiToken) await useServerStore.getState().sessionStarted({ token: apiToken, username: adminUsername.trim(), role: 'admin' })
      }

      // 5. Show success + set session flag for welcome toast
      setComplete(true)
      sessionStorage.setItem('dcs-just-setup', 'true')

      // 6. Redirect after a short pause when every step succeeded — a failed step keeps the results on screen
      //    (the button below moves on); VMs being built keep the success screen too, it follows them
      if (vmPlan.length === 0 && results.every((r) => r.ok)) {
        setTimeout(() => {
          onComplete()
        }, 4000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
      setCompleting(false)
    }
  }

  // Stack management helpers
  const moveStack = (index: number, direction: 'up' | 'down') => {
    const newStacks = [...stacks]
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= newStacks.length) return
    ;[newStacks[index], newStacks[target]] = [newStacks[target], newStacks[index]]
    setStacks(newStacks)
  }

  const deleteStack = (index: number) => {
    if (stacks.length <= 1) return
    const gone = stacks[index]
    // a stack the server already has a folder for (not one added here): remembered, so removing it here really removes it
    if (!gone.isNew) setRemovedStacks((r) => { const n = gone.source ?? gone.name; return r.includes(n) ? r : [...r, n] })
    setStacks(stacks.filter((_, i) => i !== index))
  }

  const addStack = () => {
    const name = newStackName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) return
    if (stacks.some((s) => s.name === name)) return
    // adding back a stack that was removed keeps it (and its folder)
    setRemovedStacks((r) => r.filter((n) => n !== name))
    setStacks([...stacks, { name, label: '', isDefault: false, isNew: true, editing: false }])
    setNewStackName('')
  }

  const startEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(stacks[index].name)
  }

  const commitEdit = (index: number) => {
    const name = editValue.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (name && /^[a-z0-9][a-z0-9_-]*$/.test(name) && !stacks.some((s, i) => i !== index && s.name === name)) {
      const updated = [...stacks]
      const old = updated[index].name
      // a renamed row keeps the folder it came from, and its VM placement and size follow the new name
      updated[index] = { ...updated[index], name, source: updated[index].source ?? (updated[index].isNew ? undefined : old) }
      setStacks(updated)
      if (old !== name) {
        setPlacements((prev) => { if (!(old in prev)) return prev; const next = { ...prev, [name]: prev[old] }; delete next[old]; return next })
        setVmSpecs((prev) => { if (!(old in prev)) return prev; const next = { ...prev, [name]: prev[old] }; delete next[old]; return next })
      }
    }
    setEditingIndex(null)
    setEditValue('')
  }

  const formatStackName = (name: string): string =>
    name.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  const startLabelEdit = (index: number) => {
    setLabelEditIndex(index)
    setLabelEditValue(stacks[index].label)
  }

  const commitLabelEdit = (index: number) => {
    const updated = [...stacks]
    updated[index] = { ...updated[index], label: labelEditValue.trim() }
    setStacks(updated)
    setLabelEditIndex(null)
    setLabelEditValue('')
  }

  // every zone the runtime knows, the common ones first (only 34 could be chosen before)
  const filteredTimezones = ALL_TIMEZONES.filter((tz) =>
    tz.toLowerCase().includes(tzFilter.trim().toLowerCase()),
  )
  /** take a zone into the form and close the list */
  const pickTimezone = (tz: string) => {
    setEnvVars((prev) => ({ ...prev, TZ: tz }))
    setTzFilter('')
    setTzDropdownOpen(false)
  }

  // ── Render ──

  // Success screen — a page that scrolls: the content is centred while it fits (margin auto) and starts at the top
  // when it does not, so the heading is never cut off above the screen
  if (complete) {
    const wide = vmQueued > 0
    return (
      <div className="h-screen overflow-y-auto bg-slate-950 px-4 scrollbar-thin">
        <div className="min-h-full flex">
          <div className={`m-auto text-center animate-scale-in w-full ${wide ? 'max-w-4xl py-10' : 'max-w-sm py-8'}`}>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/15 ring-2 ring-emerald-500/30 mb-4 shadow-lg shadow-emerald-500/10">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-slate-100 mb-1.5">Setup complete</h2>
            <p className="text-sm text-slate-400 mb-5">
              <span className="font-semibold text-slate-200">{envVars.SERVER_NAME || 'Your server'}</span> is configured and ready to manage
            </p>
            {setupResults.length > 0 && (
              <ul className="text-left text-xs mb-5 bg-slate-900/60 border border-white/5 rounded-2xl divide-y divide-white/[0.04] overflow-hidden">
                {setupResults.map((r) => (
                  <li key={r.label} className="flex items-start gap-2.5 px-4 py-2.5">
                    {r.ok ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-px" /> : <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-px" />}
                    <span className={`min-w-0 break-words ${r.ok ? 'text-slate-300' : 'text-amber-300'}`}>
                      {r.label}
                      {r.detail && <span className="block text-[11px] text-slate-500 mt-0.5">{r.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {vmPlan.length > 0 ? (
              <div className="text-left space-y-4">
                {vmQueued > 0 && (jobsPoll.data && jobsPoll.data.jobs.length > 0
                  ? <FleetJobsPanel jobs={jobsPoll.data.jobs} onChanged={jobsPoll.refresh} compact title="Each VM gets Docker and DCS, joins this hub and runs its stack" />
                  : <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 size={12} className="animate-spin text-emerald-400" /> Waiting for the first VM job…</p>)}
                {/* no automatic redirect while VMs are involved: the builds are followed here, or a refused build stays readable */}
                <button type="button" onClick={onComplete} className={`${BTN_SHEET_PRIMARY} w-full`}>
                  {vmQueued > 0 ? 'Open the dashboard — the builds carry on in the background' : 'Open the dashboard'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 size={12} className="animate-spin text-emerald-400" />
                <span>Entering the dashboard…</span>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-6">
              Tip: export your settings from the {pageLabel('settings')} page to back up this setup
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 relative">
      {/* Animated background (fixed behind scroll) */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full bg-emerald-500/[0.05] blur-3xl animate-float-slow" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full bg-cyan-500/[0.05] blur-3xl animate-float-slow" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-violet-500/[0.04] blur-3xl animate-float-slow" style={{ animationDelay: '6s' }} />
      </div>

      {/* Grid pattern (fixed behind scroll) */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Scrollable content area */}
      <div
        className="relative z-10 min-h-screen flex items-start justify-center pt-12 pb-8 md:py-12 overflow-y-auto scrollbar-thin"
        style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))' }}
      >
        <div className="w-full max-w-2xl mx-4 sm:mx-6">
          {/* Logo */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mb-3">
              <Layers className="w-7 h-7 text-emerald-400" />
            </div>
          </div>

          <h1 className="sr-only">Set up DCS Orchestrator</h1>

          {/* Step indicator */}
          <StepIndicator current={step} total={5} needsAdmin={needsAdmin} />

          {/* Content card */}
          <div className="bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-2xl p-4 sm:p-6 md:p-8 shadow-2xl shadow-black/20 gradient-border">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3 mb-6 animate-fade-in">
              <AlertCircle size={14} className="text-rose-400 shrink-0" />
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}

          {/* ── Step 1: Connect to Server ── */}
          {step === 1 && (
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-slate-100">Welcome to DCS Orchestrator</h2>
                <p className="text-sm text-slate-500 mt-2">
                  {isWebMode() ? 'Connecting to your server automatically...' : 'Enter your server address to begin setup'}
                </p>
              </div>

              {/* Server URL input */}
              <div className="bg-slate-800/40 border border-white/5 rounded-xl p-5 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <Link size={16} className="text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-300">Server connection</h3>
                </div>
                <p className="text-[11px] text-slate-500 mb-3">
                  Enter the IP or hostname shown by <span className="font-mono text-slate-400">./setup.sh</span> on your server
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      aria-label="Server address"
                      type="text"
                      value={serverUrlInput}
                      onChange={(e) => { setServerUrlInput(e.target.value); setConnected(false) }}
                      onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                      placeholder="http://192.168.1.50:9876"
                      className={`${INPUT_ICON} font-mono`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting || !serverUrlInput.trim()}
                    className={`${BTN_SHEET_PRIMARY} shrink-0`}
                  >
                    {connecting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : connected ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <Wifi size={16} />
                    )}
                    {connecting ? 'Connecting…' : connected ? 'Connected' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Connection status + System info (only shown after connecting) */}
              {connected && defaults ? (
                <>
                  {/* Connected banner */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/15 mb-4 animate-fade-in">
                    <Wifi size={12} className="text-emerald-400" />
                    <span className="text-[11px] text-emerald-400">
                      Connected to <span className="font-mono font-semibold">{defaults.system.hostname}</span>
                    </span>
                  </div>

                  {/* Already configured warning */}
                  {alreadyConfigured && (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 mb-4 animate-fade-in">
                      <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-300">Server already configured</p>
                        <p className="text-[10px] text-amber-400/70 mt-0.5">
                          This server is already set up. Sign in from the sign-in screen, or use Factory reset on the {pageLabel('diagnostics')} page to start fresh.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* System info card */}
                  <div className="bg-slate-800/40 border border-white/5 rounded-xl p-5 animate-fade-in">
                    <div className="flex items-center gap-2 mb-4">
                      <Server size={16} className="text-emerald-400" />
                      <h3 className="text-sm font-semibold text-slate-300">Detected system</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {[
                        { label: 'Hostname', value: defaults.system.hostname },
                        { label: 'Timezone', value: defaults.system.timezone },
                        { label: 'Docker', value: defaults.system.docker_version },
                        { label: 'Compose', value: defaults.system.compose_version },
                        { label: 'User ID', value: String(defaults.system.puid) },
                        { label: 'Group ID', value: String(defaults.system.pgid) },
                        { label: 'Docker status', value: defaults.system.docker_available ? 'Available' : 'Not available', status: defaults.system.docker_available },
                      ].map((item) => (
                        <div key={item.label + (('status' in item) ? '-status' : '')} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/[0.03]">
                          <span className="text-[11px] text-slate-500">{item.label}</span>
                          {'status' in item ? (
                            <span className={`text-[11px] font-mono flex items-center gap-1 ${item.status ? 'text-emerald-400' : 'text-rose-400'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${item.status ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                              {item.value}
                            </span>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-300">{item.value}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : !connecting && !connected && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-white/5">
                  <WifiOff size={12} className="text-slate-500" />
                  <span className="text-[11px] text-slate-500">
                    Not connected — enter your server IP and click Connect
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Create Admin Account / Sign In ── */}
          {step === 2 && (
            <div className="animate-fade-in">
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Shield size={16} className="text-emerald-400" />
                  <h2 className="text-lg font-semibold text-slate-100">
                    {needsAdmin ? 'Create admin account' : 'Sign in to continue'}
                  </h2>
                </div>
                <p className="text-xs text-slate-500">
                  {needsAdmin
                    ? 'This account manages your DCS Orchestrator server'
                    : 'An admin account already exists — sign in to resume setup'}
                </p>
              </div>

              {!needsAdmin && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/15 mb-4">
                  <AlertCircle size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-cyan-400/80">
                    A previous setup was interrupted. Sign in with your admin credentials to pick up where you left off.
                  </p>
                </div>
              )}

              {needsAdmin && (
                <div className="mb-5 rounded-xl border border-white/5 bg-white/[0.02]">
                  <button
                    type="button"
                    onClick={() => setRestoreOpen((v) => !v)}
                    aria-expanded={restoreOpen}
                    className={`w-full flex items-center gap-2 px-4 py-3 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40`}
                  >
                    <LifeBuoy size={14} className="text-rose-300 shrink-0" />
                    <span className="text-xs font-medium text-slate-300 flex-1">Moving from another server? Restore a recovery bundle</span>
                    <ChevronDown size={14} className={`text-slate-500 transition-transform ${restoreOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {restoreOpen && (
                    <div className="px-4 pb-4 space-y-3 animate-fade-in">
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        A bundle made on the {pageLabel('backup')} page brings back the accounts, settings, secrets, stacks, routes, templates and plugins. Afterwards sign in with the account you had before and start the stacks.
                      </p>
                      <input
                        aria-label="Recovery bundle file"
                        type="file"
                        accept=".enc,application/octet-stream"
                        onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                        className="block w-full text-[11px] text-slate-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-white/10 file:text-slate-200 file:text-xs hover:file:bg-white/15"
                      />
                      <div className="relative">
                        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          aria-label="Bundle passphrase"
                          type="password"
                          value={restorePass}
                          onChange={(e) => setRestorePass(e.target.value)}
                          placeholder="Bundle passphrase"
                          className={INPUT_ICON}
                        />
                      </div>
                      {restoreError && <p className="text-[10px] text-rose-400">{restoreError}</p>}
                      {restoreDone ? (
                        <p className="text-[11px] text-emerald-400">{restoreDone} Reloading…</p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleRestoreBundle}
                          disabled={!restoreFile || restorePass.length < 8 || restoring}
                          className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
                        >
                          {restoring ? <Loader2 size={14} className="animate-spin" /> : <LifeBuoy size={14} />}
                          {restoring ? 'Restoring…' : 'Restore this bundle'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {/* Username */}
                <div>
                  <label htmlFor="wizard-username" className={LABEL}>Username</label>
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      id="wizard-username"
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      className={INPUT_ICON}
                    />
                  </div>
                  {adminUsername && adminUsername.length < 3 && (
                    <p role="alert" className="text-[10px] text-rose-400 mt-1">At least 3 characters required</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="wizard-password" className={LABEL}>Password</label>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      id="wizard-password"
                      type={showPassword ? 'text' : 'password'}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !needsAdmin && canNext()) handleNext() }}
                      placeholder={needsAdmin ? 'Min 8 chars, uppercase + number' : 'Enter your password'}
                      className={`${INPUT_ICON} !pr-12`}
                    />
                    <ShowPasswordButton shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                  {/* Strength indicator — only for new account creation */}
                  {needsAdmin && adminPassword.length > 0 && <PasswordStrengthMeter password={adminPassword} className="mt-2" />}
                </div>

                {/* Confirm Password — only for new account creation */}
                {needsAdmin && (
                  <div>
                    <label htmlFor="wizard-confirm-password" className={LABEL}>Confirm password</label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        id="wizard-confirm-password"
                        type={showPassword ? 'text' : 'password'}
                        value={adminConfirm}
                        onChange={(e) => setAdminConfirm(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && canNext()) handleNext() }}
                        placeholder="Repeat password"
                        className={INPUT_ICON}
                      />
                    </div>
                    {adminConfirm && adminPassword !== adminConfirm && (
                      <p role="alert" className="text-[10px] text-rose-400 mt-1">Passwords do not match</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Server Configuration ── */}
          {step === 3 && (
            <div className="animate-fade-in">
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Settings size={16} className="text-emerald-400" />
                  <h2 className="text-lg font-semibold text-slate-100">Server setup</h2>
                </div>
                <p className="text-xs text-slate-500">Pre-populated from your system — adjust as needed</p>
              </div>

              <div className="space-y-4">
                {/* Server Name */}
                <div>
                  <label htmlFor="wiz-server-name" className={LABEL}>Server name</label>
                  <div className="relative">
                    <Server size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input id="wiz-server-name"
                      type="text"
                      value={envVars.SERVER_NAME || ''}
                      onChange={(e) => setEnvVars({ ...envVars, SERVER_NAME: e.target.value })}
                      placeholder="My Docker Server"
                      className={INPUT_ICON}
                    />
                  </div>
                </div>

                {/* Timezone */}
                <div>
                  <label htmlFor="wiz-timezone" className={LABEL}>Timezone</label>
                  <div className="relative">
                    <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
                    <input id="wiz-timezone"
                      type="text"
                      value={tzDropdownOpen ? tzFilter : (envVars.TZ || '')}
                      onChange={(e) => {
                        setTzFilter(e.target.value)
                        setTzDropdownOpen(true)
                      }}
                      onFocus={() => {
                        setTzFilter('')
                        setTzDropdownOpen(true)
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || !tzDropdownOpen) return
                        e.preventDefault()
                        // a typed zone the runtime knows is taken as typed; a filter that leaves one zone takes that one
                        const tz = knownTimezone(tzFilter) || (filteredTimezones.length === 1 ? filteredTimezones[0] : '')
                        if (tz) pickTimezone(tz)
                      }}
                      onBlur={() => {
                        // a typed zone the runtime knows is kept: it used to be thrown away unless it was clicked in the list
                        const tz = knownTimezone(tzFilter)
                        if (tz) setEnvVars((prev) => ({ ...prev, TZ: tz }))
                        setTimeout(() => setTzDropdownOpen(false), 200)
                      }}
                      placeholder="Select or type a timezone…"
                      autoComplete="off"
                      className={INPUT_ICON}
                    />
                    {tzDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50 scrollbar-thin">
                        {filteredTimezones.map((tz) => (
                          <button
                            key={tz}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              pickTimezone(tz)
                            }}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors ${
                              envVars.TZ === tz ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-300'
                            }`}
                          >
                            {tz}
                          </button>
                        ))}
                        {/* nothing in the list: a zone the runtime still knows (a link name such as US/Pacific) can be taken with Enter */}
                        {filteredTimezones.length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-500">
                            {knownTimezone(tzFilter) ? `Press Enter to use ${knownTimezone(tzFilter)}` : 'No timezone matches — type an IANA name such as Europe/Zurich'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Domain */}
                <div>
                  <label htmlFor="wiz-domain" className={LABEL}>Domain</label>
                  <div className="relative">
                    <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input id="wiz-domain"
                      type="text"
                      value={envVars.PROXY_DOMAIN || ''}
                      onChange={(e) => setEnvVars({ ...envVars, PROXY_DOMAIN: e.target.value })}
                      placeholder="example.com"
                      className={INPUT_ICON}
                    />
                  </div>
                </div>

                {/* Data Directory */}
                <div>
                  <label htmlFor="wiz-data-directory" className={LABEL}>Data directory</label>
                  <div className="relative">
                    <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input id="wiz-data-directory"
                      type="text"
                      value={envVars.APP_DATA_DIR || ''}
                      onChange={(e) => setEnvVars({ ...envVars, APP_DATA_DIR: e.target.value })}
                      placeholder="./App-Data"
                      className={INPUT_ICON}
                    />
                  </div>
                </div>

                {/* PUID / PGID */}
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  <div>
                    <label className={LABEL}>User ID (PUID)</label>
                    <input aria-label="User ID (PUID)"
                      type="number"
                      value={envVars.PUID || ''}
                      onChange={(e) => setEnvVars({ ...envVars, PUID: e.target.value })}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Group ID (PGID)</label>
                    <input aria-label="Group ID (PGID)"
                      type="number"
                      value={envVars.PGID || ''}
                      onChange={(e) => setEnvVars({ ...envVars, PGID: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter' && canNext()) handleNext() }}
                      className={INPUT}
                    />
                  </div>
                </div>

                {/* ── Proxmox (opened by itself on a Proxmox guest) ── */}
                <div className={`border rounded-xl overflow-hidden ${pveGuest || pveHost ? 'border-violet-500/25' : 'border-white/5'}`}>
                  <button
                    type="button"
                    onClick={() => setShowProxmox(!showProxmox)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Server size={14} className="text-violet-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-300">Proxmox</span>
                      {pveTest?.ok
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium truncate">{fleetRole === 'hub' ? 'Hub · linked' : 'Linked'}</span>
                        : fleetRole === 'hub'
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-medium truncate">Hub — link Proxmox here</span>
                          : pveGuest || pveHost
                            ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-medium truncate">{pveHost ? 'This is the Proxmox host' : 'Proxmox guest detected'}</span>
                            : <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Optional</span>}
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 shrink-0 ${showProxmox ? 'rotate-90' : ''}`} />
                  </button>
                  {showProxmox && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      {fleetRole === 'hub' && (
                        <p className="text-[11px] text-violet-300 rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2 flex items-start gap-2">
                          <Server size={13} className="text-violet-300 shrink-0 mt-0.5" />
                          <span><b>This DCS is the hub</b> — chosen in <span className="font-mono">./setup.sh</span>. {pveSaved ? <>The Proxmox link setup made is filled in below{pveTest?.ok ? ' and works' : ''}; each stack can get its own VM in the next step.</> : <>Link Proxmox here and each stack can get its own VM in the next step.</>}</span>
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500">
                        {defaults?.system?.proxmox?.reason ? <>{defaults.system.proxmox.reason}. </> : null}
                        Link DCS to the Proxmox API and the <span className="text-slate-300">{pageLabel('proxmox')}</span> page shows every VM and container with start, shutdown, reboot and alerts.
                        Make a token under <span className="text-slate-300">Datacenter → Permissions → API Tokens</span> with <span className="font-mono text-slate-300">VM.Audit</span>, <span className="font-mono text-slate-300">VM.PowerMgmt</span> and <span className="font-mono text-slate-300">Sys.Audit</span> on <span className="font-mono text-slate-300">/</span> (docs/PROXMOX.md). Leave this empty to do it later.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label htmlFor="wiz-proxmox-url" className={LABEL}>Proxmox URL</label>
                          <input id="wiz-proxmox-url" type="text" value={pveUrl} onChange={(e) => { setPveUrl(e.target.value); setPveTest(null) }} placeholder={defaults?.system?.proxmox?.hint_url || 'https://pve.example.com:8006'}
                            className={INPUT} />
                        </div>
                        <div>
                          <label htmlFor="wiz-api-token-id" className={LABEL}>API token ID</label>
                          <input id="wiz-api-token-id" type="text" value={pveTokenId} onChange={(e) => { setPveTokenId(e.target.value); setPveTest(null) }} placeholder="dcs@pve!dcs"
                            className={INPUT} />
                        </div>
                        <div>
                          <label htmlFor="wiz-token-secret" className={LABEL}>Token secret</label>
                          <input id="wiz-token-secret" type="password" value={pveSecret} onChange={(e) => { setPveSecret(e.target.value); setPveTest(null) }} placeholder={usingSavedSecret ? 'saved already — leave empty to keep it' : 'shown once when the token is made'} autoComplete="off"
                            className={INPUT} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                          <input type="checkbox" checked={pveVerify} onChange={(e) => { setPveVerify(e.target.checked); setPveTest(null) }} className="accent-emerald-500" />
                          Verify the certificate (off for the self-signed one Proxmox ships with)
                        </label>
                        <button type="button" onClick={() => { void runPveTest() }} disabled={!pveFilled || pveTesting}
                          className={BTN_TOOLBAR_QUIET}>
                          {pveTesting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Test connection
                        </button>
                      </div>
                      {pveTest && <div className={`text-xs ${pveTest.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{pveTest.text}</div>}
                      {pveTest?.ok && (
                        <div className="pt-3 border-t border-white/[0.04] space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[11px] text-slate-400">This DCS becomes the <span className="text-slate-300">hub</span>: the DCS in each other VM is a member, shown under its VM on the {pageLabel('proxmox')} page. Scan the VMs now, link what answers, and get the join code for the rest.</p>
                            {!showLink && <button type="button" onClick={() => setShowLink(true)} className={`${BTN_TOOLBAR_QUIET} shrink-0`}><Radar size={14} /> Link the VMs</button>}
                          </div>
                          {showLink && <FleetLinkPanel pve={{ url: pveUrl.trim(), token_id: pveTokenId.trim(), token_secret: pveSecret, verify_tls: pveVerify }} compact onChanged={() => setLinkedMembers((n) => n + 1)} />}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Fleet: this VM runs under a hub (opened by itself when setup.sh saved a join); not on a hub ── */}
                {(fleetRole !== 'hub' || fleetStatus?.pending_join || joined) && (
                <div className={`border rounded-xl overflow-hidden ${fleetStatus?.pending_join || joined ? 'border-violet-500/25' : 'border-white/5'}`}>
                  <button
                    type="button"
                    onClick={() => setShowFleet(!showFleet)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Satellite size={14} className="text-violet-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-300">Join a DCS hub</span>
                      {joined
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium truncate">Joined {joined.hub.name || joined.hub.url}</span>
                        : fleetStatus?.pending_join
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-medium truncate">setup.sh saved a join to {fleetStatus.pending_join.hub_url}</span>
                          : <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Optional</span>}
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 shrink-0 ${showFleet ? 'rotate-90' : ''}`} />
                  </button>
                  {showFleet && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      <p className="text-[11px] text-slate-500">
                        A hub is the DCS linked to Proxmox. As a member, this server keeps its own stacks; the hub's {pageLabel('proxmox')} page lists them under this VM and can deploy here.
                        {fleetStatus?.pending_join ? ' setup.sh already holds the join code — the join runs now, on the card.' : ` You need the hub's address and a join code from its ${pageLabel('proxmox')} page (Members → Join code).`}
                      </p>
                      <JoinHubPanel pending={fleetStatus?.pending_join ?? null} autoRun={!!fleetStatus?.pending_join} compact onJoined={(r) => { setJoined(r); setFleetStatus((f) => (f ? { ...f, pending_join: null } : f)) }} />
                    </div>
                  )}
                </div>
                )}

                {/* ── Advanced: Notifications ── */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowNotifications(!showNotifications)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2">
                      <Bell size={14} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-slate-300">Notifications</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Advanced</span>
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${showNotifications ? 'rotate-90' : ''}`} />
                  </button>
                  {showNotifications && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      <p className="text-[11px] text-slate-500">
                        DCS pushes start/stop failures, unhealthy containers, automation runs and deploy events through <span className="text-slate-300">ntfy</span>.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Push notifications">
                        {([
                          { id: 'off', label: 'Off', hint: 'No push notifications' },
                          { id: 'self', label: 'Deploy ntfy here', hint: 'Recommended · self-hosted' },
                          { id: 'external', label: 'Existing server', hint: 'ntfy.sh or your own' },
                        ] as { id: 'off' | 'self' | 'external'; label: string; hint: string }[]).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            role="radio"
                            aria-checked={notifyMode === opt.id}
                            onClick={() => setNotifyMode(opt.id)}
                            className={`${OPTION_CARD} ${notifyMode === opt.id ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                          >
                            <span className={`block text-xs font-semibold ${notifyMode === opt.id ? 'text-emerald-300' : 'text-slate-300'}`}>{opt.label}</span>
                            <span className="block text-[10px] text-slate-500 mt-0.5">{opt.hint}</span>
                          </button>
                        ))}
                      </div>
                      {notifyMode === 'self' && (
                        <div className="grid grid-cols-2 gap-3 animate-fade-in">
                          <div>
                            <label htmlFor="wiz-ntfy-port" className={LABEL}>ntfy port</label>
                            <input id="wiz-ntfy-port"
                              type="text"
                              inputMode="numeric"
                              value={ntfyPort}
                              onChange={(e) => setNtfyPort(e.target.value.replace(/\D/g, ''))}
                              placeholder="8093"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label htmlFor="wiz-topic" className={LABEL}>Topic</label>
                            <input id="wiz-topic"
                              type="text"
                              value={envVars.NTFY_TOPIC || ''}
                              onChange={(e) => setEnvVars({ ...envVars, NTFY_TOPIC: e.target.value })}
                              placeholder="dcs"
                              className={INPUT}
                            />
                          </div>
                          <p className="col-span-2 text-[10px] text-slate-500">
                            The wizard deploys the ntfy template and starts it. On your phone, subscribe to topic <span className="font-mono text-slate-300">{(envVars.NTFY_TOPIC || 'dcs').trim() || 'dcs'}</span> on <span className="font-mono text-slate-300">http://{'<server-ip>'}:{ntfyPort || '8093'}</span>{enableTraefik && envVars.PROXY_DOMAIN ? <> or <span className="font-mono text-slate-300">https://ntfy.{envVars.PROXY_DOMAIN}</span></> : null}.
                          </p>
                          <div className="col-span-2">
                            <label className={LABEL}>Deploy into stack</label>
                            <select aria-label="Deploy into stack"
                              value={notifyStack}
                              onChange={(e) => setNotifyStack(e.target.value)}
                              className={INPUT}
                            >
                              {stacks.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                      <div className="pt-3 mt-1 border-t border-white/[0.03] animate-fade-in">
                        <label htmlFor="wiz-discord-webhook-optional" className={LABEL}>Discord webhook <span className="text-slate-600">(optional)</span></label>
                        <input id="wiz-discord-webhook-optional"
                          type="text"
                          value={envVars.DISCORD_WEBHOOK_URL || ''}
                          onChange={(e) => setEnvVars({ ...envVars, DISCORD_WEBHOOK_URL: e.target.value.trim() })}
                          placeholder="https://discord.com/api/webhooks/…"
                          spellCheck={false}
                          className={`${INPUT} font-mono`}
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Server Settings → Integrations → Webhooks in Discord. Every notification also lands in that channel as a rich embed, whether or not ntfy is on.</p>
                      </div>
                      {notifyMode === 'external' && (
                        <div className="space-y-3 animate-fade-in">
                          <div>
                            <label htmlFor="wiz-ntfy-server-url" className={LABEL}>ntfy server URL</label>
                            <input id="wiz-ntfy-server-url"
                              type="text"
                              value={envVars.NTFY_URL || ''}
                              onChange={(e) => setEnvVars({ ...envVars, NTFY_URL: e.target.value })}
                              placeholder="https://ntfy.sh"
                              className={INPUT}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label htmlFor="wiz-topic-2" className={LABEL}>Topic</label>
                              <input id="wiz-topic-2"
                                type="text"
                                value={envVars.NTFY_TOPIC || ''}
                                onChange={(e) => setEnvVars({ ...envVars, NTFY_TOPIC: e.target.value })}
                                placeholder="dcs"
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label htmlFor="wiz-access-token-optional" className={LABEL}>Access token <span className="text-slate-600">(optional)</span></label>
                              <input id="wiz-access-token-optional"
                                type="password"
                                value={envVars.NTFY_TOKEN || ''}
                                onChange={(e) => setEnvVars({ ...envVars, NTFY_TOKEN: e.target.value })}
                                placeholder="tk_…"
                                className={INPUT}
                              />
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Messages go to <span className="font-mono text-slate-300">{((envVars.NTFY_URL || 'https://ntfy.sh').trim().replace(/\/+$/, ''))}/{(envVars.NTFY_TOPIC || 'dcs').trim() || 'dcs'}</span>. Public servers need a hard-to-guess topic.
                          </p>
                        </div>
                      )}
                      {!notifyValid && (
                        <p className="text-[10px] text-rose-400">{notifyMode === 'self' ? 'Enter a valid port and a topic of letters, digits, - or _.' : 'Enter an http(s) URL and a topic of letters, digits, - or _.'}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Advanced: Startup & Health ── */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowStartup(!showStartup)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-slate-300">Startup and health</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Advanced</span>
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${showStartup ? 'rotate-90' : ''}`} />
                  </button>
                  {showStartup && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      {/* Log Level */}
                      <div>
                        <label className={LABEL}>Log level</label>
                        <select aria-label="Log level"
                          value={envVars.LOG_LEVEL || 'INFO'}
                          onChange={(e) => setEnvVars({ ...envVars, LOG_LEVEL: e.target.value })}
                          className={INPUT}
                        >
                          <option value="ERROR">ERROR</option>
                          <option value="WARNING">WARNING</option>
                          <option value="INFO">INFO</option>
                          <option value="DEBUG">DEBUG</option>
                        </select>
                      </div>

                      {/* Toggle: Continue on failure */}
                      <EnvToggle
                        label="Continue on failure"
                        helpText="Continue starting stacks if one fails"
                        envKey="CONTINUE_ON_FAILURE"
                        envVars={envVars}
                        setEnvVars={setEnvVars}
                      />

                      {/* Toggle: Skip health check wait */}
                      <EnvToggle
                        label="Skip health check wait"
                        helpText="Skip waiting for health checks during startup"
                        envKey="SKIP_HEALTHCHECK_WAIT"
                        envVars={envVars}
                        setEnvVars={setEnvVars}
                      />

                      {/* Toggle: Post-startup health check */}
                      <EnvToggle
                        label="Post-startup health check"
                        helpText="Run health check after all stacks start"
                        envKey="ENABLE_POST_STARTUP_HEALTH_CHECK"
                        envVars={envVars}
                        setEnvVars={setEnvVars}
                      />

                      {/* Number: Service start delay */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <div>
                          <label className={LABEL}>Start delay (seconds)</label>
                          <input aria-label="Start delay (seconds)"
                            type="number"
                            min="0"
                            max="60"
                            value={envVars.SERVICE_START_DELAY || '5'}
                            onChange={(e) => setEnvVars({ ...envVars, SERVICE_START_DELAY: e.target.value })}
                            className={INPUT}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Advanced: Backup ── */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowBackup(!showBackup)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2">
                      <HardDrive size={14} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-slate-300">Backup</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Advanced</span>
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${showBackup ? 'rotate-90' : ''}`} />
                  </button>
                  {showBackup && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      <div>
                        <label htmlFor="wiz-backup-source-directory" className={LABEL}>Backup source directory</label>
                        <input id="wiz-backup-source-directory"
                          type="text"
                          value={envVars.BACKUP_SOURCE_DIR || ''}
                          onChange={(e) => setEnvVars({ ...envVars, BACKUP_SOURCE_DIR: e.target.value })}
                          placeholder="/path/to/source"
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label htmlFor="wiz-backup-destination-directory" className={LABEL}>Backup destination directory</label>
                        <input id="wiz-backup-destination-directory"
                          type="text"
                          value={envVars.BACKUP_DEST_DIR || ''}
                          onChange={(e) => setEnvVars({ ...envVars, BACKUP_DEST_DIR: e.target.value })}
                          placeholder="/path/to/destination"
                          className={INPUT}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500">Configure after setup if unsure</p>
                    </div>
                  )}
                </div>

                {/* ── HTTPS with Traefik (collapsible) ── */}
                <div className={`border rounded-xl overflow-hidden ${enableTraefik ? 'border-emerald-500/20 glow-emerald' : 'border-white/5'}`}>
                  <button
                    type="button"
                    onClick={() => setShowTraefik(!showTraefik)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-emerald-400" />
                      <span className="text-xs font-semibold text-slate-300">HTTPS and reverse proxy</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Recommended</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {enableTraefik && <span className="text-[9px] text-emerald-400 font-medium">Enabled</span>}
                      <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${showTraefik ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                  {showTraefik && (
                    <div className="px-4 py-4 space-y-4 border-t border-white/[0.03] animate-fade-in">
                      {/* Master toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-slate-300">Enable HTTPS with Traefik</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">Automatic TLS certificates via Let's Encrypt</p>
                        </div>
                        {/* dynamic DNS is switched inside this block: with HTTPS off it goes off too, not left on unseen */}
                        <Switch aria-label="Enable HTTPS with Traefik" checked={enableTraefik} onChange={() => { if (enableTraefik) setEnableDDNS(false); setEnableTraefik(!enableTraefik) }} className="shrink-0" />
                      </div>

                      {enableTraefik && (
                        <div className="space-y-3 animate-fade-in">
                          {/* Domain (read-only, inherited from PROXY_DOMAIN) */}
                          <div>
                            <label className={LABEL}>Domain</label>
                            <div className="flex items-center gap-2">
                              <input aria-label="Domain"
                                type="text"
                                value={envVars.PROXY_DOMAIN || 'example.com'}
                                disabled
                                className="flex-1 px-3 py-2.5 bg-slate-800/30 border border-white/5 rounded-lg text-sm text-slate-400 font-mono"
                              />
                              <span className="text-[9px] text-slate-500 shrink-0">from Domain above</span>
                            </div>
                            {/* the step cannot be left with the placeholder: say why, where the eye is */}
                            {!traefikDomainValid && (
                              <p className="text-[10px] text-amber-400 mt-1">Needed to continue: set your own domain in the Domain field above — example.com cannot get a certificate.</p>
                            )}
                          </div>

                          {/* Where the proxy services are deployed */}
                          <div>
                            <label className={LABEL}>Deploy into stack</label>
                            <select aria-label="Deploy into stack"
                              value={proxyStack}
                              onChange={(e) => setProxyStack(e.target.value)}
                              className={INPUT}
                            >
                              {stacks.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
                            </select>
                            <p className="text-[10px] text-slate-500 mt-1">Traefik, Authelia and CrowdSec go here. Renaming or removing stacks in the last step keeps this in sync.</p>
                          </div>

                          {/* Email for Let's Encrypt */}
                          <div>
                            <label htmlFor="wiz-lets-encrypt-email" className={LABEL}>
                              Let's Encrypt email <span className="text-rose-400" aria-hidden>*</span>
                            </label>
                            <input id="wiz-lets-encrypt-email"
                              type="email"
                              value={traefikEmail}
                              onChange={(e) => setTraefikEmail(e.target.value)}
                              placeholder="you@your-domain.com"
                              aria-invalid={!!traefikEmail.trim() && !traefikEmailValid}
                              className={INPUT}
                            />
                            {/* the step cannot be left without it: an empty field says so calmly, a wrong address is an error */}
                            {traefikEmailValid
                              ? <p className="text-[10px] text-slate-500 mt-1">Used for certificate expiry notifications</p>
                              : traefikEmail.trim()
                                ? <p className="text-[10px] text-rose-400 mt-1" role="alert">Enter a real address — Let's Encrypt refuses example.com and malformed ones.</p>
                                : <p className="text-[10px] text-amber-400 mt-1">Needed to continue: Let's Encrypt registers the certificates to this address.</p>}
                          </div>

                          {/* Trusted LAN */}
                          <div>
                            <label htmlFor="wiz-trusted-lan-subnet" className={LABEL}>Trusted LAN subnet</label>
                            <input id="wiz-trusted-lan-subnet"
                              type="text"
                              value={traefikTrustedLan}
                              onChange={(e) => setTraefikTrustedLan(e.target.value)}
                              placeholder="192.168.1.0/24"
                              className={`${INPUT} font-mono`}
                            />
                          </div>

                          {/* Docker Socket Proxy toggle */}
                          <div className="flex items-center justify-between py-2 group/dsp relative">
                            <div>
                              <p className={`text-xs font-medium ${isWebMode() ? 'text-slate-400' : 'text-slate-300'}`}>Include Docker Socket Proxy</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {isWebMode() ? 'Enabled by default in AIO for security' : 'Secure read-only Docker API access (recommended)'}
                              </p>
                            </div>
                            <Tooltip label={isWebMode() ? 'Locked on in AIO — Docker Socket Proxy secures the Docker API' : includeDockerSocket ? 'On: the stack gets the read-only Docker API proxy' : 'Off: no Docker Socket Proxy in the stack'}>
                              <span className="inline-flex shrink-0">
                                {/* locked on in web mode: it keeps its on look, dimmed, and ignores a click */}
                                <Switch aria-label="Include Docker Socket Proxy" aria-disabled={isWebMode() || undefined} style={isWebMode() ? { opacity: 0.6 } : undefined} checked={includeDockerSocket} onChange={() => { if (!isWebMode()) setIncludeDockerSocket(!includeDockerSocket) }} />
                              </span>
                            </Tooltip>
                          </div>

                          {/* Add-ons: each declares a Traefik plugin only while it is on */}
                          <div className="pt-1">
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Add-ons</p>
                            <p className="text-[10px] text-slate-500 mt-1">Each one declares a Traefik plugin only while it is on (Traefik does not start when a declared plugin cannot be fetched). Deploying the Traefik template again changes them later.</p>
                            <div className="flex items-center justify-between py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-300">Start containers on demand (Sablier)</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">Deploys Sablier with Traefik: an app can sleep while nobody uses it and wake on the first visit, chosen per route when you deploy it</p>
                              </div>
                              <Switch aria-label="Start containers on demand (Sablier)" checked={traefikSablier} onChange={() => setTraefikSablier(!traefikSablier)} className="shrink-0 ml-3" />
                            </div>
                            <div className="flex items-center justify-between py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-300">Cloudflare real IP</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">For a site behind Cloudflare's proxy: the visitor's address replaces Cloudflare's before CrowdSec and Geoblock judge it. Leave off when Cloudflare only serves your DNS.</p>
                              </div>
                              <Switch aria-label="Cloudflare real IP" checked={traefikCloudflareIp} onChange={() => setTraefikCloudflareIp(!traefikCloudflareIp)} className="shrink-0 ml-3" />
                            </div>
                            <div className="flex items-center justify-between py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-300">Geoblock</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">Only visitors from the countries you list reach your routes; your LAN is always let in</p>
                              </div>
                              <Switch aria-label="Geoblock" checked={traefikGeoblock} onChange={() => setTraefikGeoblock(!traefikGeoblock)} className="shrink-0 ml-3" />
                            </div>
                            {traefikGeoblock && (
                              <div className="pb-2 animate-fade-in">
                                <label htmlFor="wiz-geoblock-countries" className={LABEL}>
                                  Allowed countries <span className="text-rose-400" aria-hidden>*</span>
                                </label>
                                <input id="wiz-geoblock-countries"
                                  type="text"
                                  value={traefikGeoblockCountries}
                                  onChange={(e) => setTraefikGeoblockCountries(e.target.value)}
                                  placeholder="GB,US,DE"
                                  aria-invalid={traefikGeoblockCountries.trim() !== '' && !geoblockCountriesOk(traefikGeoblockCountries) ? true : undefined}
                                  className={`${INPUT} font-mono`}
                                />
                                <p className={`text-[10px] mt-1 ${traefikGeoblockCountries.trim() !== '' && !geoblockCountriesOk(traefikGeoblockCountries) ? 'text-rose-400' : 'text-slate-500'}`}>
                                  {/\bUK\b/i.test(traefikGeoblockCountries) ? 'The United Kingdom is GB.' : 'ISO 3166-1 alpha-2 codes, comma separated. Needed before you can continue.'}
                                </p>
                              </div>
                            )}
                            <div className="flex items-center justify-between py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-300">theme.park themes</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">Declares the theme.park plugin now, so a theme put on an app's pages later needs no Traefik restart</p>
                              </div>
                              <Switch aria-label="theme.park themes" checked={traefikThemePark} onChange={() => setTraefikThemePark(!traefikThemePark)} className="shrink-0 ml-3" />
                            </div>
                            <div className="flex items-center justify-between py-2">
                              <div>
                                <p className="text-xs font-medium text-slate-300">Maintenance mode</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">A "maintenance" middleware with a holding page: add it to a route, and the page shows while App-Data/Traefik/maintenance.trigger exists</p>
                              </div>
                              <Switch aria-label="Maintenance mode" checked={traefikMaintenance} onChange={() => setTraefikMaintenance(!traefikMaintenance)} className="shrink-0 ml-3" />
                            </div>
                          </div>

                          {/* Cloudflare DNS (optional) */}
                          <div>
                            <label htmlFor="wiz-cloudflare-dns-api-token-optional" className={LABEL}>
                              Cloudflare DNS API token <span className="text-[9px] text-slate-500">(optional)</span>
                            </label>
                            <input id="wiz-cloudflare-dns-api-token-optional"
                              type="password"
                              value={cfDnsToken}
                              onChange={(e) => setCfDnsToken(e.target.value)}
                              placeholder="Leave empty for HTTP challenge"
                              className={`${INPUT} font-mono`}
                            />
                            <p className="text-[10px] text-slate-500 mt-1">Needed for the DNS challenge (wildcard certificates), dynamic DNS and the {pageLabel('dns')} page. Stored encrypted as the secret <span className="font-mono text-slate-400">CF_DNS_API_TOKEN</span>; leave empty to use the HTTP-01 challenge.</p>
                          </div>

                          {/* Auto-routing info */}
                          {envVars.PROXY_DOMAIN && envVars.PROXY_DOMAIN !== 'example.com' && (
                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/15 p-3">
                              <p className="text-[11px] font-medium text-emerald-400 mb-1">Auto-routing enabled</p>
                              <p className="text-[10px] text-slate-400 leading-relaxed">
                                Services deployed from the {pageLabel('templates')} page will automatically get HTTPS routes at <span className="font-mono text-emerald-400/80">servicename.{envVars.PROXY_DOMAIN}</span>. You can edit routes before deploying or modify them later in the Traefik config files.
                              </p>
                            </div>
                          )}

                          {/* Dynamic DNS toggle */}
                          {cfDnsToken && (
                            <div className="space-y-3 pt-1">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-medium text-slate-300">Dynamic DNS (DDNS)</p>
                                  <p className="text-[10px] text-slate-500 mt-0.5">Auto-update DNS when your public IP changes</p>
                                </div>
                                <Switch aria-label="Dynamic DNS (DDNS)" checked={enableDDNS} onChange={() => setEnableDDNS(!enableDDNS)} className="shrink-0" />
                              </div>

                              {enableDDNS && (
                                <div className="animate-fade-in space-y-3">
                                  <div>
                                    <label htmlFor="wiz-subdomains-to-monitor" className={LABEL}>Subdomains to monitor</label>
                                    <input id="wiz-subdomains-to-monitor"
                                      type="text"
                                      value={ddnsSubdomains}
                                      onChange={(e) => setDdnsSubdomains(e.target.value)}
                                      placeholder="@,www,traefik,ui"
                                      className={`${INPUT} font-mono`}
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Use @ for root domain. Comma-separated.</p>
                                  </div>

                                  <div>
                                    <span className={LABEL}>Check interval</span>
                                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Check interval">
                                      {[
                                        { value: 60, label: '1 min' },
                                        { value: 300, label: '5 min' },
                                        { value: 900, label: '15 min' },
                                        { value: 1800, label: '30 min' },
                                        { value: 3600, label: '1 hour' },
                                      ].map((opt) => (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          role="radio"
                                          aria-checked={ddnsInterval === opt.value}
                                          onClick={() => setDdnsInterval(opt.value)}
                                          className={`${CHOICE} ${ddnsInterval === opt.value ? CHOICE_ON : CHOICE_OFF}`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1.5">How often to check if your public IP has changed</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Authelia SSO (requires Traefik) ── */}
                {enableTraefik && (
                  <div className={`border rounded-xl overflow-hidden transition-all ${enableAuthelia ? 'border-emerald-500/20' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center">
                          <Shield size={18} className="text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200">Authelia SSO</p>
                          <p className="text-[10px] text-slate-500">Single sign-on and 2FA for all your services</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {enableAuthelia && <span className="text-[9px] text-emerald-400 font-medium">Enabled</span>}
                        <Switch aria-label="Authelia SSO" checked={enableAuthelia} onChange={() => setEnableAuthelia(!enableAuthelia)} />
                      </div>
                    </div>
                    {enableAuthelia && (
                      <div className="px-4 py-4 space-y-3 border-t border-white/5 animate-fade-in">
                        <p className="text-[11px] text-slate-500">
                          Authelia will protect your services with a login portal at <span className="text-cyan-400 font-medium">auth.{envVars.PROXY_DOMAIN || 'yourdomain.com'}</span>
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="wiz-admin-username" className="block text-[10px] text-slate-500 mb-1 font-medium">Admin username</label>
                            <input id="wiz-admin-username"
                              type="text"
                              value={autheliaUser}
                              onChange={(e) => setAutheliaUser(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                              placeholder="admin"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <label htmlFor="wiz-display-name" className="block text-[10px] text-slate-500 mb-1 font-medium">Display name</label>
                            <input id="wiz-display-name"
                              type="text"
                              value={autheliaDisplay}
                              onChange={(e) => setAutheliaDisplay(e.target.value)}
                              placeholder="John Doe"
                              className={INPUT}
                            />
                          </div>
                        </div>
                        <div>
                          <label htmlFor="wiz-email" className="block text-[10px] text-slate-500 mb-1 font-medium">Email</label>
                          <input id="wiz-email"
                            type="email"
                            value={autheliaEmail}
                            onChange={(e) => setAutheliaEmail(e.target.value)}
                            placeholder={`admin@${envVars.PROXY_DOMAIN || 'yourdomain.com'}`}
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <label htmlFor="wiz-password" className="block text-[10px] text-slate-500 mb-1 font-medium">Password</label>
                          <input id="wiz-password"
                            type="password"
                            value={autheliaPassword}
                            onChange={(e) => setAutheliaPassword(e.target.value)}
                            placeholder="Minimum 8 characters"
                            className={INPUT}
                          />
                        </div>
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                          <Shield size={12} className="text-cyan-400 mt-0.5 shrink-0" />
                          <p className="text-[10px] text-slate-500 leading-relaxed">
                            Authelia uses <span className="text-cyan-400">Redis</span> for sessions and <span className="text-cyan-400">SQLite</span> for storage.
                            Secrets are auto-generated. Password is hashed with Argon2id.
                            Every app you deploy afterwards sits behind the portal; apps that bring their own clients (Plex, Nextcloud, the *arr apps…) stay open unless you protect them in the deploy sheet.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── CrowdSec (requires Traefik) ── */}
                {enableTraefik && (
                  <div className={`border rounded-xl overflow-hidden transition-all ${enableCrowdsec ? 'border-emerald-500/20' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02]">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center">
                          <Shield size={18} className="text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200">CrowdSec intrusion detection</p>
                          <p className="text-[10px] text-slate-500">Reads Traefik's access log, bans attackers, community blocklists</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {enableCrowdsec && <span className="text-[9px] text-emerald-400 font-medium">Enabled</span>}
                        <Switch aria-label="CrowdSec intrusion detection" checked={enableCrowdsec} onChange={() => setEnableCrowdsec(!enableCrowdsec)} />
                      </div>
                    </div>
                    {enableCrowdsec && (
                      <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-slate-300">Block at the proxy (Traefik bouncer)</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Banned IPs are refused by Traefik before they reach any app. No root needed.</p>
                          </div>
                          <Switch aria-label="Block at the proxy (Traefik bouncer)" checked={crowdsecBouncer} onChange={() => setCrowdsecBouncer(!crowdsecBouncer)} className="shrink-0" />
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          {(envVars.DISCORD_WEBHOOK_URL || '').trim()
                            ? 'Every ban is posted to the Discord webhook from the Notifications step, as an embed with the source, country, scenario and action.'
                            : 'Add a Discord webhook in the Notifications step and every ban is posted there as an embed.'}
                          {' '}The host firewall bouncer (nftables) is a separate, root-only install; the README explains it.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Dashboard Preferences (collapsible) ── */}
                <div className="border border-white/5 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowPreferences(!showPreferences)}
                    className={SECTION_BTN}
                  >
                    <div className="flex items-center gap-2">
                      <Palette size={14} className="text-cyan-400" />
                      <span className="text-xs font-semibold text-slate-300">Dashboard preferences</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium">Advanced</span>
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 ${showPreferences ? 'rotate-90' : ''}`} />
                  </button>
                  {showPreferences && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      <div>
                        <label className={LABEL}>Mode</label>
                        <select aria-label="Mode"
                          value={prefTheme}
                          onChange={(e) => setPrefTheme(e.target.value as 'dark' | 'light' | 'system')}
                          className={INPUT}
                        >
                          <option value="system">System (follows this device)</option>
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>Session duration</label>
                        <select aria-label="Session duration"
                          value={prefSessionMinutes}
                          onChange={(e) => setPrefSessionMinutes(Number(e.target.value))}
                          className={INPUT}
                        >
                          <option value={60}>1 hour</option>
                          <option value={240}>4 hours</option>
                          <option value={480}>8 hours</option>
                          <option value={1440}>24 hours</option>
                          <option value={0}>Indefinite</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>Auto-lock</label>
                        <select aria-label="Auto-lock"
                          value={prefAutoLock}
                          onChange={(e) => setPrefAutoLock(Number(e.target.value))}
                          className={INPUT}
                        >
                          <option value={0}>Off</option>
                          <option value={5}>5 minutes</option>
                          <option value={15}>15 minutes</option>
                          <option value={30}>30 minutes</option>
                          <option value={60}>1 hour</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="wiz-app-name" className={LABEL}>App name</label>
                        <input id="wiz-app-name"
                          type="text"
                          value={prefAppName}
                          onChange={(e) => setPrefAppName(e.target.value)}
                          placeholder="DCS Orchestrator"
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label htmlFor="wiz-app-subtitle" className={LABEL}>App subtitle</label>
                        <input id="wiz-app-subtitle"
                          type="text"
                          value={prefAppSubtitle}
                          onChange={(e) => setPrefAppSubtitle(e.target.value)}
                          placeholder="The server's name"
                          className={INPUT}
                        />
                      </div>
                      <p className="text-[10px] text-slate-500">These can be changed later on the {pageLabel('settings')} page</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Stack Configuration ── */}
          {step === 4 && (
            <div className="animate-fade-in">
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Layers size={16} className="text-emerald-400" />
                  <h2 className="text-lg font-semibold text-slate-100">Stack categories</h2>
                </div>
                <p className="text-xs text-slate-500">Define your stack categories, startup order, and display labels{pveTest?.ok ? ' — and which ones get their own VM' : ''}</p>
              </div>
              {pveTest?.ok && (
                <div className="mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                  <p className="text-[11px] text-slate-300 flex items-start gap-2"><Server size={13} className="text-violet-400 shrink-0 mt-0.5" /><span>Proxmox is linked, so <b>a stack can be a VM</b>: the hub builds it (Debian cloud image, Docker, DCS), the VM joins this hub and runs that one stack. The dashboard here stays the only one; <span className="font-mono">core-infrastructure</span> stays on the hub. Toggle each stack, size the VMs, and check the network below.</span></p>
                  <CapabilityNote caps={caps} />
                  {vmPlan.length > 0 && <HubFirewallNote fw={provDefaults?.hub_firewall} />}
                  {(() => {
                    const clashes = stacks.filter((st) => placementOf(st.name) === 'vm' && clashOf(st.name))
                    if (clashes.length === 0) return null
                    return (
                      <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 text-[11px] text-rose-300 flex items-start gap-2">
                        <AlertTriangle size={13} className="text-rose-300 shrink-0 mt-0.5" />
                        <span>Proxmox already has a guest named like {clashes.length === 1 ? 'this stack' : 'these stacks'}: {clashes.map((st) => <span key={st.name} className="font-mono">{st.name} <span className="text-rose-300">(VM {clashOf(st.name)?.vmid})</span>{' '}</span>)}
                          — {clashes.length === 1 ? 'it is' : 'they are'} left out of the build, the others get their VMs. Delete or rename the old guest{clashes.length === 1 ? '' : 's'} on Proxmox to build {clashes.length === 1 ? 'it' : 'them'}, or link {clashes.length === 1 ? 'it' : 'them'} from the {pageLabel('proxmox')} page.</span>
                      </div>
                    )
                  })()}
                  {vmPlan.length > 0 && <PlanCapacity plan={vmPlan} defaults={provDefaults} storage={vmSettings?.storage ?? ''} />}
                </div>
              )}

              {/* Stack list */}
              <div className="space-y-2 max-h-[46rem] overflow-y-auto pr-1 scrollbar-thin mb-4">
                {stacks.map((stack, index) => (
                  <div
                    key={`${stack.name}-${index}`}
                    className="bg-slate-800/40 border border-white/5 rounded-lg px-3 py-2 group"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      {/* Order number */}
                      <span className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 text-[10px] font-bold text-slate-500 shrink-0">
                        {index + 1}
                      </span>

                      {/* Name (editable) */}
                      {editingIndex === index ? (
                        <input aria-label="Stack name"
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(index)
                            if (e.key === 'Escape') { setEditingIndex(null); setEditValue('') }
                          }}
                          onBlur={() => commitEdit(index)}
                          autoFocus
                          className={`flex-1 min-w-[8rem] ${FIELD_SM} !px-2 font-mono`}
                        />
                      ) : (
                        <span className="flex-1 min-w-[8rem] text-xs font-mono text-slate-300 truncate" title={stack.name}>
                          {stack.name}
                        </span>
                      )}

                      {/* Badges */}
                      {stack.label && labelEditIndex !== index && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-white/10 text-slate-300 shrink-0">
                          {stack.label}
                        </span>
                      )}
                      {stack.isNew && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-cyan-500/15 text-cyan-400 shrink-0">
                          Custom
                        </span>
                      )}
                      {stack.isDefault && !stack.isNew && !stack.label && !vmReady && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-500/15 text-slate-500 shrink-0">
                          Default
                        </span>
                      )}

                      {/* Where the stack runs: on the hub, or in its own VM */}
                      {vmReady && (
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex rounded-md bg-white/5 border border-white/10 overflow-hidden" role="radiogroup" aria-label={`Where ${stack.name} runs`}>
                            {(['hub', 'vm'] as const).map((p) => (
                              <button key={p} type="button" role="radio" aria-checked={placementOf(stack.name) === p} onClick={() => setPlacements((m) => ({ ...m, [stack.name]: p }))}
                                disabled={p === 'vm' && !!hubOnly[stack.name]} title={p === 'vm' && hubOnly[stack.name] ? `Stays on the hub — ${hubOnly[stack.name]}` : undefined}
                                className={`h-8 sm:h-6 px-3 sm:px-2 text-[11px] sm:text-[10px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40 ${placementOf(stack.name) === p ? (p === 'vm' ? 'bg-violet-500/25 text-violet-200' : 'bg-emerald-500/20 text-emerald-300') : 'text-slate-500 hover:text-slate-300'}`}>
                                {p === 'vm' ? 'VM' : 'Hub'}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1 sm:min-w-[8.5rem]">
                          {hubOnly[stack.name] && <span className="text-slate-500" title={`Stays on the hub — ${hubOnly[stack.name]}`}><Lock size={10} /></span>}
                          {placementOf(stack.name) === 'vm' && clashOf(stack.name) && (
                            <span className="h-6 px-2 rounded-md border border-rose-500/30 bg-rose-500/10 text-[10px] font-medium text-rose-300 flex items-center gap-1"
                              title={`A guest named ${stack.name} already exists on Proxmox (VM ${clashOf(stack.name)?.vmid}, ${clashOf(stack.name)?.status || 'stopped'}). This stack is left out of the build: delete or rename that guest on Proxmox, or link it from the ${pageLabel('proxmox')} page.`}>
                              <AlertTriangle size={10} /> VM {clashOf(stack.name)?.vmid} exists
                            </span>
                          )}
                          {placementOf(stack.name) === 'vm' && !clashOf(stack.name) && (
                            <button type="button" onClick={() => setSizeOpen((o) => (o === stack.name ? null : stack.name))} aria-expanded={sizeOpen === stack.name}
                              title="The VM's size"
                              className={`h-8 sm:h-6 px-2 rounded-md border text-[10px] font-medium flex items-center gap-1.5 tabular-nums transition-colors ${FOCUS_RING} ${sizeOpen === stack.name ? 'bg-violet-500/15 border-violet-500/35 text-violet-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                              <Cpu size={10} className="text-violet-300" />
                              {specOf(stack.name).cores}c · {specOf(stack.name).memGb} GB · {specOf(stack.name).diskGb} GB
                              <ChevronDown size={10} className={`transition-transform ${sizeOpen === stack.name ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity shrink-0">
                        <Hint label={stack.label ? 'Edit label' : 'Add label'}>
                          <button
                            type="button"
                            onClick={() => labelEditIndex === index ? commitLabelEdit(index) : startLabelEdit(index)}
                            aria-label={`${stack.label ? 'Edit' : 'Add'} the label of ${stack.name}`}
                            className={`${BTN_ICON_SM} ${labelEditIndex === index ? 'text-emerald-400 hover:bg-white/10' : TONE_GHOST}`}
                          >
                            <Palette size={12} />
                          </button>
                        </Hint>
                        <Hint label="Rename">
                          <button
                            type="button"
                            onClick={() => startEdit(index)}
                            aria-label={`Rename ${stack.name}`}
                            className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                          >
                            <Pencil size={12} />
                          </button>
                        </Hint>
                        <Hint label="Move up">
                          <button
                            type="button"
                            onClick={() => moveStack(index, 'up')}
                            disabled={index === 0}
                            aria-label={`Move ${stack.name} up`}
                            className={`${BTN_ICON_SM} ${TONE_GHOST} disabled:opacity-20`}
                          >
                            <ChevronUp size={14} />
                          </button>
                        </Hint>
                        <Hint label="Move down">
                          <button
                            type="button"
                            onClick={() => moveStack(index, 'down')}
                            disabled={index === stacks.length - 1}
                            aria-label={`Move ${stack.name} down`}
                            className={`${BTN_ICON_SM} ${TONE_GHOST} disabled:opacity-20`}
                          >
                            <ChevronDown size={14} />
                          </button>
                        </Hint>
                        <Hint label="Remove">
                          <button
                            type="button"
                            onClick={() => deleteStack(index)}
                            disabled={stacks.length <= 1}
                            aria-label={`Remove ${stack.name}`}
                            className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} disabled:opacity-20`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </Hint>
                      </div>
                    </div>

                    {/* The VM's size */}
                    {vmReady && placementOf(stack.name) === 'vm' && !clashOf(stack.name) && sizeOpen === stack.name && (
                      <div className="mt-2.5 ml-8 animate-fade-in">
                        <VmSizeControl value={specOf(stack.name)}
                          limits={{ maxCores: provDefaults?.capacity?.cores, maxMemGb: provDefaults?.capacity?.memory_gb, minDiskGb: 10 }}
                          onChange={(v) => setVmSpecs((m) => ({ ...m, [stack.name]: v }))} />
                      </div>
                    )}

                    {/* Inline label editor */}
                    {labelEditIndex === index && (
                      <div className="flex items-center gap-2 mt-2 ml-8">
                        <input
                          type="text"
                          value={labelEditValue}
                          onChange={(e) => setLabelEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitLabelEdit(index)
                            if (e.key === 'Escape') { setLabelEditIndex(null); setLabelEditValue('') }
                          }}
                          autoFocus
                          placeholder={formatStackName(stack.name)}
                          className={`flex-1 min-w-0 ${FIELD_SM} !px-2`}
                        />
                        <button
                          type="button"
                          onClick={() => commitLabelEdit(index)}
                          className={`${BTN_CARD} ${TONE_OK}`}
                        >
                          Save
                        </button>
                        {stack.label && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...stacks]
                              updated[index] = { ...updated[index], label: '' }
                              setStacks(updated)
                              setLabelEditIndex(null)
                              setLabelEditValue('')
                            }}
                            className={`${BTN_CARD} text-slate-400 hover:text-rose-300 hover:bg-rose-500/10`}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add stack */}
              <div className="flex items-center gap-2">
                <input
                  aria-label="New stack name"
                  type="text"
                  value={newStackName}
                  onChange={(e) => setNewStackName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  onKeyDown={(e) => e.key === 'Enter' && addStack()}
                  placeholder="new-stack-name"
                  className={`flex-1 min-w-0 ${FIELD} font-mono`}
                />
                <button
                  type="button"
                  onClick={addStack}
                  disabled={!newStackName.trim()}
                  className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0`}
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>

              {stacks.length === 0 && (
                <p className="text-[10px] text-rose-400 mt-2">At least one stack is required</p>
              )}

              {vmReady && vmSettings && vmPlan.length > 0 && (
                <div className="mt-4 border border-violet-500/20 rounded-xl overflow-hidden">
                  <button type="button" onClick={() => setShowVmSettings(!showVmSettings)} className={SECTION_BTN}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Server size={14} className="text-violet-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-300">VM settings</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono truncate">{osLabel(vmSettings, provDefaults)} · {vmSettings.node} · {vmSettings.storage} · {vmSettings.bridge} · from {vmSettings.ip_start}/{vmSettings.cidr} via {vmSettings.gateway}</span>
                    </div>
                    <ChevronRight size={14} className={`text-slate-500 transition-transform duration-200 shrink-0 ${showVmSettings ? 'rotate-90' : ''}`} />
                  </button>
                  {showVmSettings && (
                    <div className="px-4 py-4 space-y-3 border-t border-white/[0.03] animate-fade-in">
                      <p className="text-[11px] text-slate-500">Prefilled from Proxmox and this hub's network. Each VM gets the next free address from the first one, cores/RAM/disk per stack, user <span className="font-mono">{provDefaults?.vm_user || 'dcs'}</span> with the hub's ssh key, and the admin <span className="font-mono">{provDefaults?.admin_user || adminUsername}</span> with a generated password kept in the hub's secret store.</p>
                      <VmSettingsFields value={vmSettings} onChange={(v) => { vmEditedRef.current = true; setVmSettings(v) }} defaults={provDefaults} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 5: Review & Complete ── */}
          {step === 5 && (
            <div className="animate-fade-in">
              <div className="text-center mb-6">
                <Sparkles size={20} className="text-emerald-400 mx-auto mb-2" />
                <h2 className="text-lg font-semibold text-slate-100">Review configuration</h2>
                <p className="text-xs text-slate-500 mt-1">Confirm your settings before completing setup</p>
              </div>

              <div className="space-y-4">
                {/* Admin Account */}
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={14} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold text-slate-300">Admin account</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white text-xs font-bold">
                      {(adminUsername[0] || 'A').toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{adminUsername}</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold">admin</span>
                    </div>
                  </div>
                </div>

                {/* Server Config — grouped by category */}
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Settings size={14} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold text-slate-300">Server identity</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {['SERVER_NAME', 'TZ', 'PROXY_DOMAIN'].map((key) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500 shrink-0">{key}</span>
                        <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars[key]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FolderOpen size={14} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold text-slate-300">Storage and permissions</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {['APP_DATA_DIR', 'PUID', 'PGID'].map((key) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500 shrink-0">{key}</span>
                        <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars[key]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Advanced sections — only show if values differ from defaults */}
                {envVars.NTFY_URL && (
                  <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Bell size={14} className="text-cyan-400" />
                      <h3 className="text-xs font-semibold text-slate-300">Notifications</h3>
                    </div>
                    <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                      <span className="text-[10px] text-slate-500 shrink-0">NTFY_URL</span>
                      <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars.NTFY_URL}</span>
                    </div>
                    {envVars.NTFY_TOPIC && (
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03] mt-1">
                        <span className="text-[10px] text-slate-500 shrink-0">NTFY_TOPIC</span>
                        <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars.NTFY_TOPIC}</span>
                      </div>
                    )}
                  </div>
                )}

                {(() => {
                  const startupDefaults: Record<string, string> = { LOG_LEVEL: 'INFO', CONTINUE_ON_FAILURE: 'true', SKIP_HEALTHCHECK_WAIT: 'false', SERVICE_START_DELAY: '5', ENABLE_POST_STARTUP_HEALTH_CHECK: 'true' }
                  const changed = Object.entries(startupDefaults).filter(([k, v]) => envVars[k] && envVars[k] !== v)
                  return changed.length > 0 ? (
                    <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Zap size={14} className="text-cyan-400" />
                        <h3 className="text-xs font-semibold text-slate-300">Startup and health</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {changed.map(([key]) => (
                          <div key={key} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                            <span className="text-[10px] text-slate-500 shrink-0">{key}</span>
                            <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars[key]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}

                {(envVars.BACKUP_SOURCE_DIR || envVars.BACKUP_DEST_DIR) && (
                  <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <HardDrive size={14} className="text-cyan-400" />
                      <h3 className="text-xs font-semibold text-slate-300">Backup</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {['BACKUP_SOURCE_DIR', 'BACKUP_DEST_DIR'].filter((k) => envVars[k]).map((key) => (
                        <div key={key} className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">{key}</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{envVars[key]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dashboard Preferences (only if non-default) */}
                {(prefTheme !== 'system' || prefSessionMinutes !== 240 || prefAutoLock !== 0 || prefAppName !== 'DCS Orchestrator' || prefAppSubtitle !== '') && (
                  <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Palette size={14} className="text-cyan-400" />
                      <h3 className="text-xs font-semibold text-slate-300">Dashboard</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {prefTheme !== 'system' && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">Mode</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{prefTheme}</span>
                        </div>
                      )}
                      {prefSessionMinutes !== 240 && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">Session</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{prefSessionMinutes === 0 ? 'Indefinite' : `${prefSessionMinutes / 60}h`}</span>
                        </div>
                      )}
                      {prefAutoLock !== 0 && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">Auto-lock</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{prefAutoLock}min</span>
                        </div>
                      )}
                      {prefAppName !== 'DCS Orchestrator' && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">App name</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{prefAppName}</span>
                        </div>
                      )}
                      {prefAppSubtitle !== '' && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500 shrink-0">Subtitle</span>
                          <span className="text-[10px] font-mono text-slate-300 truncate ml-2">{prefAppSubtitle}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Proxmox */}
                <div className={`bg-slate-800/40 border rounded-xl p-4 ${pveFilled ? 'border-violet-500/20' : 'border-white/5'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Server size={14} className={pveFilled ? 'text-violet-400' : 'text-slate-500'} />
                    <h3 className="text-xs font-semibold text-slate-300">Proxmox</h3>
                  </div>
                  {pveFilled ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-emerald-500/5">
                        <span className="text-[10px] text-emerald-300 font-medium">Linked{pveTest?.ok ? ' · connection tested' : ''}</span>
                        <span className="text-[10px] text-emerald-300" aria-hidden>✓</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">URL</span>
                        <span className="text-[10px] font-mono text-slate-300 truncate max-w-[60%]">{pveUrl.trim()}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">Token</span>
                        <span className="text-[10px] font-mono text-slate-300">{pveTokenId.trim()} · secret kept in the secret store</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500">Not linked — the {pageLabel('proxmox')} page and the {pageLabel('config')} page can do it any time</p>
                  )}
                </div>

                {/* VMs the hub builds */}
                {vmPlan.length > 0 && vmSettings && (
                  <div className="bg-slate-800/40 border border-violet-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Server size={14} className="text-violet-400" />
                      <h3 className="text-xs font-semibold text-slate-300">VMs the hub builds ({vmPlan.length})</h3>
                    </div>
                    <div className="space-y-1">
                      {vmPlan.map((v) => (
                        <div key={v.stack} className="flex items-center justify-between py-1 px-2 rounded bg-violet-500/5">
                          <span className="text-[10px] font-mono text-violet-200">{v.stack}</span>
                          <span className="text-[10px] text-slate-400">{v.cores} cores · {v.memGb} GB RAM · {v.diskGb} GB</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">Network</span>
                        <span className="text-[10px] font-mono text-slate-300">{osLabel(vmSettings, provDefaults)}{vmSettings.bake && !vmSettings.os.startsWith('tpl:') && !vmSettings.os.startsWith('iso:') ? ' · a DCS template is baked first, then each VM clones it' : vmSettings.os.startsWith('tpl:') ? ' · cloned from the baked template' : ''} · {vmSettings.bridge} · from {vmSettings.ip_start}/{vmSettings.cidr} via {vmSettings.gateway} · DNS {vmSettings.dns}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">Proxmox</span>
                        <span className="text-[10px] font-mono text-slate-300">node {vmSettings.node} · disks on {vmSettings.storage} · image on {vmSettings.image_storage}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Fleet */}
                {(linkedMembers > 0 || joined || fleetStatus?.pending_join) && (
                  <div className="bg-slate-800/40 border border-violet-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Satellite size={14} className="text-violet-400" />
                      <h3 className="text-xs font-semibold text-slate-300">Fleet</h3>
                    </div>
                    <div className="space-y-1">
                      {linkedMembers > 0 && <div className="flex items-center justify-between py-1 px-2 rounded bg-emerald-500/5"><span className="text-[10px] text-emerald-300 font-medium">Hub · {linkedMembers} member{linkedMembers === 1 ? '' : 's'} linked</span><span className="text-[10px] text-emerald-300">✓</span></div>}
                      {joined && <div className="flex items-center justify-between py-1 px-2 rounded bg-emerald-500/5"><span className="text-[10px] text-emerald-300 font-medium">Member of {joined.hub.name || joined.hub.url} as "{joined.member.name}"</span><span className="text-[10px] text-emerald-300">✓</span></div>}
                      {!joined && fleetStatus?.pending_join && <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]"><span className="text-[10px] text-slate-400">Joins {fleetStatus.pending_join.hub_url} when setup completes</span></div>}
                    </div>
                  </div>
                )}

                {/* HTTPS & Reverse Proxy */}
                <div className={`bg-slate-800/40 border rounded-xl p-4 ${enableTraefik ? 'border-emerald-500/20' : 'border-white/5'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={14} className={enableTraefik ? 'text-emerald-400' : 'text-slate-500'} />
                    <h3 className="text-xs font-semibold text-slate-300">HTTPS and reverse proxy</h3>
                  </div>
                  {enableTraefik ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-emerald-500/5">
                        <span className="text-[10px] text-emerald-400 font-medium">Traefik enabled</span>
                        <span className="text-[10px] text-emerald-400" aria-hidden>✓</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">Domain</span>
                        <span className="text-[10px] font-mono text-slate-300">{envVars.PROXY_DOMAIN}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">ACME email</span>
                        <span className="text-[10px] font-mono text-slate-300">{traefikEmail}</span>
                      </div>
                      <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                        <span className="text-[10px] text-slate-500">Docker Socket Proxy</span>
                        <span className="text-[10px] text-slate-300">{includeDockerSocket ? 'Included' : 'Excluded'}</span>
                      </div>
                      <div className={`flex items-center justify-between gap-3 py-1 px-2 rounded ${traefikAddonsOn.length ? 'bg-emerald-500/5' : 'bg-white/[0.03]'}`}>
                        <span className="text-[10px] text-slate-500 shrink-0">Add-ons</span>
                        <span className={`text-[10px] text-right ${traefikAddonsOn.length ? 'text-emerald-300' : 'text-slate-400'}`}>{traefikAddonsOn.length ? traefikAddonsOn.join(' · ') : 'None'}</span>
                      </div>
                      <div className={`flex items-center justify-between py-1 px-2 rounded ${enableAuthelia && autheliaUser && autheliaPassword ? 'bg-emerald-500/5' : 'bg-white/[0.03]'}`}>
                        <span className="text-[10px] text-slate-500">Authelia SSO</span>
                        <span className={`text-[10px] ${enableAuthelia && autheliaUser && autheliaPassword ? 'text-emerald-300' : 'text-slate-400'}`}>
                          {enableAuthelia && autheliaUser && autheliaPassword ? `${autheliaUser} · auth.${envVars.PROXY_DOMAIN}` : enableAuthelia ? 'Enabled but incomplete — skipped' : 'Off'}
                        </span>
                      </div>
                      <div className={`flex items-center justify-between py-1 px-2 rounded ${enableCrowdsec ? 'bg-emerald-500/5' : 'bg-white/[0.03]'}`}>
                        <span className="text-[10px] text-slate-500">CrowdSec</span>
                        <span className={`text-[10px] ${enableCrowdsec ? 'text-emerald-300' : 'text-slate-400'}`}>{enableCrowdsec ? `Enabled${crowdsecBouncer ? ' · Traefik bouncer' : ''}` : 'Off'}</span>
                      </div>
                      {cfDnsToken && (
                        <div className="flex items-center justify-between py-1 px-2 rounded bg-white/[0.03]">
                          <span className="text-[10px] text-slate-500">Cloudflare DNS</span>
                          <span className="text-[10px] text-slate-300">Configured</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 px-2">Not configured — you can turn it on later from the {pageLabel('templates')} page</p>
                  )}
                </div>

                {/* Stack Order */}
                <div className="bg-slate-800/40 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Layers size={14} className="text-emerald-400" />
                    <h3 className="text-xs font-semibold text-slate-300">Startup order ({stacks.length} {stacks.length === 1 ? 'stack' : 'stacks'})</h3>
                  </div>
                  <div className="space-y-1">
                    {stacks.map((stack, i) => (
                      <div key={stack.name} className="flex items-center gap-2 py-1">
                        <span className="w-5 h-5 flex items-center justify-center rounded bg-white/5 text-[9px] font-bold text-slate-500">
                          {i + 1}
                        </span>
                        <span className="text-xs font-mono text-slate-300">{stack.name}</span>
                        {vmReady && (placementOf(stack.name) === 'vm'
                          ? (clashOf(stack.name)
                            ? <span className="text-[8px] px-1 rounded bg-rose-500/15 text-rose-300" title="A guest with this name already exists on Proxmox">left out — VM {clashOf(stack.name)?.vmid} exists</span>
                            : <span className="text-[8px] px-1 rounded bg-violet-500/15 text-violet-300">VM · {specOf(stack.name).cores}c · {specOf(stack.name).memGb} GB · {specOf(stack.name).diskGb} GB</span>)
                          : <span className="text-[8px] px-1 rounded bg-emerald-500/10 text-emerald-300">hub</span>)}
                        {stack.label && (
                          <span className="text-[8px] px-1 rounded bg-white/10 text-slate-300">{stack.label}</span>
                        )}
                        {stack.isNew && (
                          <span className="text-[8px] px-1 rounded bg-cyan-500/15 text-cyan-400">new</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Navigation buttons ── */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/5">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={loading || completing}
                className={BTN_SHEET_QUIET}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            ) : (
              <div />
            )}

            {step < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canNext() || loading}
                className={BTN_SHEET_PRIMARY}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className={BTN_SHEET_PRIMARY}
              >
                {completing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Applying configuration…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Complete setup
                  </>
                )}
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
