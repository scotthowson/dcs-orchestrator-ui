// =============================================================================
// Config — the server's settings as cards of rows: toggles, choices, numbers and
// text, saved together. Every row is one family (a name and one sentence of help on
// the left, its control on the right), and the cards fold away.
// =============================================================================

import React, { useEffect, useId, useState, useCallback } from 'react'
import { Switch } from '@mantine/core'
import {
  Globe,
  FolderOpen,
  Bell,
  RefreshCw,
  Save,
  Undo2,
  Check,
  AlertCircle,
  AlertTriangle,
  Palette,
  Shield,
  Zap,
  Server,
  ChevronDown,
  ScrollText,
  Network,
  HeartPulse,
  Activity,
  HardDrive,
  Container, LifeBuoy, BatteryCharging, ArrowUpCircle,
} from 'lucide-react'
import { FloatingSaveBar } from '../components/common/FloatingSaveBar'
import { ProxmoxTestPanel, TraefikFeedPanel, HomarrPanel } from '../components/settings/IntegrationPanels'
import PageHeader from '../components/common/PageHeader'
import { ErrorState } from '../components/common/PageState'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK, TONE_QUIET } from '../lib/ui'
import { usePolling } from '../hooks/usePolling'
import { fetchConfig, updateConfig, setSecret } from '../api/endpoints'
import { useSettingsStore } from '../stores/settingsStore'
import { useConfigStore } from '../stores/configStore'
import { useConnectionStore } from '../stores/connectionStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import type { ServerConfig } from '../../shared/types'

import { FIELD } from '../lib/fieldStyles'
// ---------------------------------------------------------------------------
// The rows of a card — one family
// ---------------------------------------------------------------------------

/** a status shown in place of a control (Configured · Active): one pill for all of them */
function StatePill({ tone, children }: { tone: 'ok' | 'off'; children: React.ReactNode }) {
  return tone === 'ok' ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden />
      {children}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden />
      {children}
    </span>
  )
}

/**
 * One row of a card: the name (a real label of its control) and one sentence of help on the left, the
 * control on the right. Every row helper below is this with a different control, so they all space,
 * wrap and read the same.
 */
function Row({ label, description, controlId, helpId, children }: {
  label: string
  description?: React.ReactNode
  /** the id of the control, so the name is its label and a click on the name reaches it */
  controlId?: string
  helpId?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/[0.03] last:border-b-0">
      <div className="flex-1 min-w-0">
        {controlId
          ? <label htmlFor={controlId} className="block text-sm font-medium text-slate-200">{label}</label>
          : <span className="block text-sm font-medium text-slate-200">{label}</span>}
        {description && <p id={helpId} className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/** the ids a row's control and its label/help share */
function useRowIds(description: React.ReactNode) {
  const id = useId()
  return { id, helpId: description ? `${id}-help` : undefined }
}

function ToggleRow({
  label,
  description,
  configKey,
  value,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  configKey: string
  value: boolean
  onChange: (key: string, val: boolean) => void
  disabled?: boolean
}) {
  const { id, helpId } = useRowIds(description)
  return (
    <Row label={label} description={description} controlId={id} helpId={helpId}>
      {/* the dashboard's toggle (a Mantine Switch, themed in lib/mantine.tsx), named by the row's label */}
      <Switch id={id} checked={value} disabled={disabled} aria-describedby={helpId} onChange={() => { if (!disabled) onChange(configKey, !value) }} className="shrink-0" />
    </Row>
  )
}

function SelectRow({
  label,
  description,
  configKey,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  configKey: string
  value: string
  options: string[]
  onChange: (key: string, val: string) => void
  disabled?: boolean
}) {
  const { id, helpId } = useRowIds(description)
  return (
    <Row label={label} description={description} controlId={id} helpId={helpId}>
      <select
        id={id}
        aria-describedby={helpId}
        value={value}
        onChange={(e) => onChange(configKey, e.target.value)}
        disabled={disabled}
        className={`${FIELD} shrink-0`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </Row>
  )
}

function TextRow({
  label,
  description,
  configKey,
  value,
  onChange,
  disabled,
  readOnly,
  placeholder,
  type = 'text',
}: {
  label: string
  description?: string
  configKey: string
  value: string
  onChange: (key: string, val: string) => void
  disabled?: boolean
  readOnly?: boolean
  placeholder?: string
  type?: 'text' | 'password'
}) {
  const { id, helpId } = useRowIds(description)
  return (
    <Row label={label} description={description} controlId={readOnly ? undefined : id} helpId={helpId}>
      {readOnly ? (
        <span className="text-sm text-slate-400 font-mono truncate max-w-[180px] md:max-w-[260px]" title={value}>{value}</span>
      ) : (
        <input
          id={id}
          aria-describedby={helpId}
          type={type}
          value={value}
          onChange={(e) => onChange(configKey, e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={type === 'password' ? 'new-password' : undefined}
          className={`${FIELD} font-mono w-40 md:w-48 shrink-0`}
        />
      )}
    </Row>
  )
}

function NumberRow({
  label,
  description,
  configKey,
  value,
  onChange,
  disabled,
  min,
  max,
}: {
  label: string
  description?: string
  configKey: string
  value: number
  onChange: (key: string, val: number) => void
  disabled?: boolean
  min?: number
  max?: number
}) {
  const { id, helpId } = useRowIds(description)
  return (
    <Row label={label} description={description} controlId={id} helpId={helpId}>
      <input
        id={id}
        aria-describedby={helpId}
        type="number"
        value={value}
        onChange={(e) => onChange(configKey, parseInt(e.target.value, 10))}
        disabled={disabled}
        min={min}
        max={max}
        className={`${FIELD} font-mono w-28 shrink-0`}
      />
    </Row>
  )
}

// ---------------------------------------------------------------------------
// Group Card
// ---------------------------------------------------------------------------

interface GroupCardProps {
  icon: React.ReactNode
  title: string
  description?: string
  children: React.ReactNode
  storageKey?: string
}

/** A small heading that splits one card into readable parts */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-5 pb-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{children}</span>
      <span className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
    </div>
  )
}

/**
 * A card of rows. Its heading is a button that folds the card (aria-expanded, a focus ring); a folded
 * card leaves the tab order, so a keyboard never lands on a field nobody can see.
 */
function GroupCard({ icon, title, description, children, storageKey }: GroupCardProps) {
  const key = storageKey || `cfg-card-${title.toLowerCase().replace(/\s+/g, '-')}`
  const uid = useId()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(key) === 'true' } catch { return false }
  })
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(key, String(next)) } catch {}
  }

  return (
    <div className="glass rounded-xl border border-white/5 overflow-hidden">
      <h2 className="m-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={`${uid}-body`}
          aria-labelledby={`${uid}-title`}
          aria-describedby={description ? `${uid}-about` : undefined}
          className="block w-full px-5 py-4 border-b border-white/5 text-left select-none hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
        >
          <span className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              {icon}
              <span id={`${uid}-title`} className="text-sm font-semibold text-slate-200">{title}</span>
            </span>
            <ChevronDown
              size={16}
              aria-hidden
              className={`text-slate-500 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
            />
          </span>
          {description && !collapsed && (
            <span id={`${uid}-about`} className="block text-xs font-normal text-slate-500 mt-1 ml-[26px]">{description}</span>
          )}
        </button>
      </h2>
      <div
        id={`${uid}-body`}
        className={`transition-[max-height,visibility] duration-300 ease-in-out overflow-hidden ${collapsed ? 'max-h-0 invisible' : 'max-h-[2000px]'}`}
      >
        <div className="px-5 py-2">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading: the cards' shape while the settings arrive
// ---------------------------------------------------------------------------

function ConfigSkeleton() {
  const card = (rows: number, key: number) => (
    <div key={key} className="glass rounded-xl border border-white/5 overflow-hidden" aria-hidden>
      <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2.5">
        <div className="skeleton h-4 w-4 rounded" />
        <div className="skeleton h-4 w-36 rounded" />
      </div>
      <div className="px-5 py-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-3 border-b border-white/[0.03] last:border-b-0">
            <div className="space-y-1.5"><div className="skeleton h-3.5 w-32 rounded" /><div className="skeleton h-3 w-52 max-w-full rounded" /></div>
            <div className="skeleton h-7 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div role="status" aria-label="Loading the settings" className="lg:columns-2 lg:gap-5 [&>*]:break-inside-avoid [&>*]:mb-5">
      {[5, 4, 6, 3].map((rows, i) => card(rows, i))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type EditableConfig = Record<string, string | boolean | number>

export default function Config() {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const setStoreConfig = useConfigStore((s) => s.setConfig)
  const isConnected = useConnectionStore((s) => s.status) === 'connected'
  const connServerUrl = useConnectionStore((s) => s.serverUrl)

  const { data, loading, error, refresh } = usePolling<ServerConfig>(fetchConfig, 60000, {
    enabled: isConnected,
  })

  useEffect(() => {
    if (data) setStoreConfig(data)
  }, [data, setStoreConfig])

  // Local editable copy
  const [edits, setEdits] = useState<EditableConfig>({})
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [userIsEditing, setUserIsEditing] = useState(false)

  // Build edits from server data
  const buildEditsFromData = useCallback((d: ServerConfig): EditableConfig => ({
    ENVIRONMENT: d.environment,
    LOG_LEVEL: d.log_level,
    TZ: d.timezone,
    // the row showed "off" whatever .env held, and a save always sent the key (no original to diff against)
    UPDATE_ON_BOOT: d.update_on_boot ?? false,
    SERVER_NAME: d.server_name,
    SERVER_SUBTITLE: d.server_subtitle ?? '',
    PROXY_DOMAIN: d.proxy_domain ?? '',
    PUID: d.puid ?? 1000,
    PGID: d.pgid ?? 1000,
    SKIP_HEALTHCHECK_WAIT: d.skip_healthcheck_wait,
    CONTINUE_ON_FAILURE: d.continue_on_failure,
    REMOVE_VOLUMES_ON_STOP: d.remove_volumes_on_stop,
    AGGRESSIVE_IMAGE_PRUNE: d.aggressive_image_prune,
    UPDATE_NOTIFICATION: d.update_notification,
    SHOW_BANNERS: d.show_banners,
    API_PORT: d.api_port,
    API_BIND: d.api_bind,
    API_ENABLED: d.api_enabled ?? true,
    API_AUTH_ENABLED: d.api_auth_enabled ?? true,
    API_RATE_LIMIT: d.api_rate_limit ?? 600,
    API_RATE_WINDOW: d.api_rate_window ?? 60,
    API_TOKEN_EXPIRY: d.api_token_expiry ?? 86400,
    API_SINGLE_SESSION: d.api_single_session ?? false,
    API_CORS_ORIGINS: d.api_cors_origins ?? '',
    API_IP_WHITELIST: d.api_ip_whitelist ?? '',
    NTFY_URL: d.ntfy_url ?? '',
    NTFY_TOPIC: d.ntfy_topic ?? '',
    NTFY_PRIORITY: d.ntfy_priority ?? 'default',
    DISCORD_WEBHOOK_URL: '',
    DISCORD_WEBHOOK_NAME: d.discord_webhook_name ?? 'DCS Orchestrator',
    PROXMOX_URL: d.proxmox_url ?? '',
    PROXMOX_TOKEN_ID: d.proxmox_token_id ?? '',
    PROXMOX_TOKEN_SECRET: '',
    PROXMOX_VERIFY_TLS: d.proxmox_verify_tls ?? true,
    PROXMOX_NODE: d.proxmox_node ?? '',
    TRAEFIK_FEED_ENABLED: d.traefik_feed_enabled ?? false,
    TRAEFIK_FEED_TARGET_HOST: d.traefik_feed_target_host ?? '',
    TRAEFIK_FEED_ENTRYPOINT: d.traefik_feed_entrypoint ?? 'websecure',
    TRAEFIK_FEED_MIDDLEWARES: d.traefik_feed_middlewares ?? '',
    TRAEFIK_FEED_TLS: d.traefik_feed_tls ?? true,
    TRAEFIK_FEED_CERT_RESOLVER: d.traefik_feed_cert_resolver ?? '',
    DISCORD_WEBHOOK_AVATAR: d.discord_webhook_avatar ?? '',
    NOTIFY_COOLDOWN_MINUTES: d.notify_cooldown_minutes ?? 60,
    NOTIFICATION_STACKS: d.notification_stacks ?? '',
    ENABLE_COLORS: d.enable_colors ?? true,
    COLOR_MODE: d.color_mode ?? 'auto',
    FORCE_COLOR: d.force_color ?? false,
    VERBOSE_MODE: d.verbose_mode ?? false,
    SHOW_SYSTEM_INFO: d.show_system_info ?? true,
    PROGRESS_BAR_WIDTH: d.progress_bar_width ?? 50,
    ENABLE_LOG_DATE: d.enable_log_date ?? true,
    LOG_BACKUP_COUNT: d.log_backup_count ?? 12,
    ENABLE_STRUCTURED_LOGGING: d.enable_structured_logging ?? false,
    // Traefik/DNS
    TRAEFIK_DOMAIN: d.traefik_domain ?? '',
    TRAEFIK_ACME_EMAIL: d.traefik_acme_email ?? '',
    DDNS_ENABLED: d.ddns_enabled ?? false,
    DDNS_INTERVAL: d.ddns_interval ?? 300,
    // Health/Monitoring
    ENABLE_POST_STARTUP_HEALTH_CHECK: d.enable_post_startup_health_check ?? true,
    HEALTH_CHECK_DELAY: d.health_check_delay ?? 10,
    CRITICAL_CONTAINERS: d.critical_containers ?? '',
    IMPORTANT_CONTAINERS: d.important_containers ?? '',
    // Metrics/Features
    METRICS_ENABLED: d.metrics_enabled ?? true,
    METRICS_COLLECT_INTERVAL: d.metrics_collect_interval ?? 60,
    ROLLBACK_ENABLED: d.rollback_enabled ?? true,
    PLUGINS_ENABLED: d.plugins_enabled ?? true,
    PLUGINS_HOOKS_ENABLED: d.plugins_hooks_enabled ?? true,
    METRICS_RETENTION_DAYS: d.metrics_retention_days ?? 7,
    ROLLBACK_MAX_SNAPSHOTS: d.rollback_max_snapshots ?? 10,
    SCHEDULER_CHECK_INTERVAL: d.scheduler_check_interval ?? 60,
    // Docker
    SERVICE_START_DELAY: d.service_start_delay ?? 0,
    SERVICE_STOP_DELAY: d.service_stop_delay ?? 0,
    DOCKER_STACKS: d.docker_stacks ?? '',
    // Backup
    BACKUP_SOURCE_DIR: d.backup_source_dir ?? '',
    BACKUP_DEST_DIR: d.backup_dest_dir ?? '',
    BACKUP_RETENTION_COUNT: d.backup_retention_count ?? 7,
    // API extended
    API_MAX_LOGIN_ATTEMPTS: d.api_max_login_attempts ?? 5,
    API_LOCKOUT_DURATION: d.api_lockout_duration ?? 900,
    API_TLS_ENABLED: d.api_tls_enabled ?? false,
    API_BEHIND_TLS_PROXY: d.api_behind_tls_proxy ?? false,
    API_INVITE_EXPIRY: d.api_invite_expiry ?? 604800,
    API_MAX_BODY_SIZE: d.api_max_body_size ?? 1048576,
    TERMINAL_SESSION_EXPIRY: d.terminal_session_expiry ?? 14400,
    TRAEFIK_TRUSTED_LAN: d.traefik_trusted_lan ?? '',
    DDNS_SUBDOMAINS: d.ddns_subdomains ?? '@',
    PORTAINER_URL: d.portainer_url ?? '',
    DASHBOARD_ICON_URL: d.dashboard_icon_url ?? '',
    DOCKER_COMPOSE_VERSION: d.docker_compose_version ?? 'auto',
  }), [])

  // Sync from server ONLY when user hasn't started editing
  useEffect(() => {
    if (data && !userIsEditing) {
      setEdits(buildEditsFromData(data))
    }
  }, [data, userIsEditing, buildEditsFromData])

  const handleChange = useCallback((key: string, val: string | boolean | number) => {
    setEdits((prev) => ({ ...prev, [key]: val }))
    setSaveResult(null)
    setUserIsEditing(true)
  }, [])

  const handleBoolChange = useCallback((key: string, val: boolean) => {
    handleChange(key, val)
  }, [handleChange])

  const handleStringChange = useCallback((key: string, val: string) => {
    handleChange(key, val)
  }, [handleChange])

  const handleNumberChange = useCallback((key: string, val: number) => {
    handleChange(key, val)
  }, [handleChange])

  // Check if anything changed from the original
  const hasChanges = data ? Object.keys(edits).some((key) => {
    const original = getOriginalValue(data, key)
    return edits[key] !== original
  }) : false

  const handleSave = async () => {
    if (!data || !hasChanges) return
    setSaving(true)
    setSaveResult(null)

    // Build diff — only send changed values
    const diff: Record<string, string | boolean | number> = {}
    for (const key of Object.keys(edits)) {
      const original = getOriginalValue(data, key)
      if (edits[key] !== original) {
        diff[key] = edits[key]
      }
    }

    try {
      // The Proxmox token secret belongs in the secret store (the API reads it
      // from there first); .env only when the store cannot take it
      if (typeof diff.PROXMOX_TOKEN_SECRET === 'string' && diff.PROXMOX_TOKEN_SECRET) {
        try {
          await setSecret('PROXMOX_TOKEN_SECRET', diff.PROXMOX_TOKEN_SECRET)
          delete diff.PROXMOX_TOKEN_SECRET
          if (Object.keys(diff).length === 0) {
            setSaveResult({ success: true, message: 'Proxmox token secret stored in the secret store' })
            setUserIsEditing(false)
            setTimeout(refresh, 500)
            return
          }
        } catch (err) {
          console.error('[Config] storing the Proxmox secret in the secret store failed, writing .env:', err)
        }
      }
      const result = await updateConfig(diff)
      setSaveResult({ success: result.success, message: result.message })
      // Refresh to get updated values — clear editing flag so poll can sync
      setUserIsEditing(false)
      setTimeout(refresh, 500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSaveResult({ success: false, message: msg })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setUserIsEditing(false)
    if (data) {
      setEdits(buildEditsFromData(data))
      setSaveResult(null)
    }
  }

  const cfg = data

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="config"
        actions={<>
          {hasChanges && (
            <button type="button" onClick={handleReset} className={BTN_TOOLBAR_QUIET}>
              <Undo2 size={14} />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={hasChanges ? handleSave : refresh}
            disabled={saving || (loading && !cfg)}
            className={`${BTN_TOOLBAR} ${hasChanges ? TONE_OK : TONE_QUIET}`}
          >
            {saving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : hasChanges ? (
              <Save size={14} />
            ) : (
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            )}
            {saving ? 'Saving…' : hasChanges ? 'Save changes' : 'Refresh'}
          </button>
        </>}
      />

      {/* Save result banner */}
      {saveResult && (
        <div
          role={saveResult.success ? 'status' : 'alert'}
          className={`
          flex items-center gap-3 rounded-xl p-4 animate-fade-in
          ${saveResult.success
            ? 'bg-emerald-500/10 border border-emerald-500/20'
            : 'bg-rose-500/10 border border-rose-500/20'
          }
        `}>
          {saveResult.success ? (
            <Check size={18} className="text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle size={18} className="text-rose-400 flex-shrink-0" />
          )}
          <p className={`text-sm ${saveResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {saveResult.message}
          </p>
        </div>
      )}

      {/* Could not load */}
      {error && <ErrorState title="Could not load the server settings" error={error} onRetry={refresh} />}

      {/* The cards' shape while the settings arrive */}
      {loading && !cfg && <ConfigSkeleton />}

      {cfg && (
        <div className="lg:columns-2 lg:gap-5 [&>*]:break-inside-avoid [&>*]:mb-5 [&>*:last-child]:mb-0 lg:[&>*:last-child]:mb-5">
          {/* Environment */}
          <GroupCard
            icon={<Globe size={16} className="text-slate-400" />}
            title="Environment"
            description="Runtime environment and server identity"

          >
            <SelectRow
              label="Environment"
              description="Runtime environment profile"
              configKey="ENVIRONMENT"
              value={String(edits.ENVIRONMENT ?? cfg.environment)}
              options={['production', 'staging', 'testing', 'development']}
              onChange={handleStringChange}
            />
            <SelectRow
              label="Log level"
              description="Logging verbosity"
              configKey="LOG_LEVEL"
              value={String(edits.LOG_LEVEL ?? cfg.log_level)}
              options={['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']}
              onChange={handleStringChange}
            />
            <SelectRow
              label="Update channel"
              description="stable follows the tagged releases; main follows every commit on the main branch"
              configKey="UPDATE_CHANNEL"
              value={String(edits.UPDATE_CHANNEL ?? cfg.update_channel ?? 'stable')}
              options={['stable', 'main']}
              onChange={handleStringChange}
            />
            <TextRow
              label="Server name"
              description="Display name for this server"
              configKey="SERVER_NAME"
              value={String(edits.SERVER_NAME ?? cfg.server_name)}
              onChange={handleStringChange}
              placeholder="Docker Server"
            />
            <TextRow
              label="Timezone"
              description="Server timezone (e.g. America/New_York)"
              configKey="TZ"
              value={String(edits.TZ ?? cfg.timezone)}
              onChange={handleStringChange}
              placeholder="UTC"
            />
            <TextRow label="Server subtitle" description="Subtitle shown in the UI header" configKey="SERVER_SUBTITLE" value={String(edits.SERVER_SUBTITLE ?? '')} onChange={handleStringChange} />
            <TextRow label="Proxy domain" description="Primary reverse proxy domain" configKey="PROXY_DOMAIN" value={String(edits.PROXY_DOMAIN ?? '')} onChange={handleStringChange} placeholder="example.com" />
            <NumberRow label="PUID" description="User ID for container permissions" configKey="PUID" value={Number(edits.PUID ?? 1000)} onChange={handleNumberChange} min={0} max={65534} />
            <NumberRow label="PGID" description="Group ID for container permissions" configKey="PGID" value={Number(edits.PGID ?? 1000)} onChange={handleNumberChange} min={0} max={65534} />
          </GroupCard>

          {/* Paths (read-only) */}
          <GroupCard
            icon={<FolderOpen size={16} className="text-slate-400" />}
            title="Paths"
            description="Server directory paths (read-only)"

          >
            <TextRow label="Compose directory" configKey="" value={cfg.compose_dir} onChange={() => {}} readOnly />
            <TextRow label="App data directory" configKey="" value={cfg.app_data_dir} onChange={() => {}} readOnly />
            <TextRow label="Base directory" configKey="" value={cfg.base_dir} onChange={() => {}} readOnly />
            <TextRow label="Compose command" configKey="" value={cfg.compose_command} onChange={() => {}} readOnly />
          </GroupCard>

          {/* Feature Flags */}
          <GroupCard
            icon={<Zap size={16} className="text-slate-400" />}
            title="Feature flags"
            description="Toggle framework features on or off"

          >
            <ToggleRow
              label="Show banners"
              description="Display ASCII art banners during startup and shutdown"
              configKey="SHOW_BANNERS"
              value={Boolean(edits.SHOW_BANNERS ?? cfg.show_banners)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Skip health check wait"
              description="Don't wait for containers to pass health checks during startup"
              configKey="SKIP_HEALTHCHECK_WAIT"
              value={Boolean(edits.SKIP_HEALTHCHECK_WAIT ?? cfg.skip_healthcheck_wait)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Continue on failure"
              description="Continue stack operations even if one stack fails"
              configKey="CONTINUE_ON_FAILURE"
              value={Boolean(edits.CONTINUE_ON_FAILURE ?? cfg.continue_on_failure)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Remove volumes on stop"
              description="Delete anonymous volumes when stopping stacks"
              configKey="REMOVE_VOLUMES_ON_STOP"
              value={Boolean(edits.REMOVE_VOLUMES_ON_STOP ?? cfg.remove_volumes_on_stop)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Aggressive image prune"
              description="Prune all unused images, not just dangling ones"
              configKey="AGGRESSIVE_IMAGE_PRUNE"
              value={Boolean(edits.AGGRESSIVE_IMAGE_PRUNE ?? cfg.aggressive_image_prune)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Update notifications"
              description="Send ntfy notifications when stack images are updated"
              configKey="UPDATE_NOTIFICATION"
              value={Boolean(edits.UPDATE_NOTIFICATION ?? cfg.update_notification)}
              onChange={handleBoolChange}
            />
          </GroupCard>

          {/* Display & Colors */}
          <GroupCard
            icon={<Palette size={16} className="text-slate-400" />}
            title="Display & colors"
            description="Terminal output appearance settings"

          >
            <ToggleRow
              label="Enable colors"
              description="Enable colored terminal output for logs and banners"
              configKey="ENABLE_COLORS"
              value={Boolean(edits.ENABLE_COLORS ?? cfg.enable_colors ?? true)}
              onChange={handleBoolChange}
            />
            <SelectRow
              label="Color mode"
              description="When to use color output"
              configKey="COLOR_MODE"
              value={String(edits.COLOR_MODE ?? cfg.color_mode ?? 'auto')}
              options={['auto', 'always', 'never']}
              onChange={handleStringChange}
            />
            <ToggleRow
              label="Force color"
              description="Force color output regardless of terminal type detection"
              configKey="FORCE_COLOR"
              value={Boolean(edits.FORCE_COLOR ?? cfg.force_color ?? false)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Verbose mode"
              description="Show additional detail in command output"
              configKey="VERBOSE_MODE"
              value={Boolean(edits.VERBOSE_MODE ?? cfg.verbose_mode ?? false)}
              onChange={handleBoolChange}
            />
            <ToggleRow
              label="Show system info"
              description="Display system information during startup"
              configKey="SHOW_SYSTEM_INFO"
              value={Boolean(edits.SHOW_SYSTEM_INFO ?? cfg.show_system_info ?? true)}
              onChange={handleBoolChange}
            />
            <NumberRow
              label="Progress bar width"
              description="Character width of progress bars in terminal output"
              configKey="PROGRESS_BAR_WIDTH"
              value={Number(edits.PROGRESS_BAR_WIDTH ?? cfg.progress_bar_width ?? 50)}
              onChange={handleNumberChange}
              min={20}
              max={120}
            />
          </GroupCard>

          {/* Log Formatting */}
          <GroupCard
            icon={<ScrollText size={16} className="text-slate-400" />}
            title="Log formatting"
            description="Customize log output format and metadata"

          >
            <ToggleRow
              label="Log timestamps"
              description="Include date/time in log entries"
              configKey="ENABLE_LOG_DATE"
              value={Boolean(edits.ENABLE_LOG_DATE ?? cfg.enable_log_date ?? true)}
              onChange={handleBoolChange}
            />
            <NumberRow label="Log backup count" description="Number of rotated log archives to keep" configKey="LOG_BACKUP_COUNT" value={Number(edits.LOG_BACKUP_COUNT ?? 12)} onChange={handleNumberChange} min={1} max={100} />
            <ToggleRow label="Structured logging" description="Enable JSONL structured log output" configKey="ENABLE_STRUCTURED_LOGGING" value={Boolean(edits.ENABLE_STRUCTURED_LOGGING)} onChange={handleBoolChange} />
          </GroupCard>

          {/* API Server */}
          <GroupCard
            icon={<Server size={16} className="text-slate-400" />}
            title="API server"
            description="REST API server settings"

          >
            {/* Auto-detect: API is running since you're viewing this page */}
            {isConnected && (
              <div className="flex items-center justify-between rounded-lg bg-emerald-500/5 border border-emerald-500/15 px-3 py-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] text-emerald-400 font-medium">Connected</span>
                  <span className="text-[10px] text-slate-400 font-mono ml-1">{(connServerUrl || '').replace(/^https?:\/\//, '')}</span>
                </div>
                {!cfg.api_enabled && (
                  <span className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} />
                    Running manually
                  </span>
                )}
              </div>
            )}
            <ToggleRow
              label="API enabled"
              description={isConnected && !cfg.api_enabled ? 'API is running manually — enable this to auto-start with ./start.sh' : 'Enable or disable the REST API server on startup'}
              configKey="API_ENABLED"
              value={Boolean(edits.API_ENABLED ?? cfg.api_enabled ?? true)}
              onChange={handleBoolChange}
            />
            <NumberRow
              label="Port"
              description="API server listen port"
              configKey="API_PORT"
              value={Number(edits.API_PORT ?? cfg.api_port)}
              onChange={handleNumberChange}
              min={1024}
              max={65535}
            />
            <TextRow
              label="Bind address"
              description="Network interface to bind to (0.0.0.0 for all)"
              configKey="API_BIND"
              value={String(edits.API_BIND ?? cfg.api_bind)}
              onChange={handleStringChange}
              placeholder="0.0.0.0"
            />
            <ToggleRow label="Authentication" description="Require auth for API requests (auto-enabled when bound to 0.0.0.0)" configKey="API_AUTH_ENABLED" value={Boolean(edits.API_AUTH_ENABLED ?? true)} onChange={handleBoolChange} />
            <NumberRow label="Rate limit" description="Max requests per window per IP" configKey="API_RATE_LIMIT" value={Number(edits.API_RATE_LIMIT ?? 600)} onChange={handleNumberChange} min={10} max={10000} />
            <NumberRow label="Rate window" description="Rate limit window in seconds" configKey="API_RATE_WINDOW" value={Number(edits.API_RATE_WINDOW ?? 60)} onChange={handleNumberChange} min={10} max={3600} />
            <NumberRow label="Token expiry" description="Session token lifetime in seconds (86400 = 24h)" configKey="API_TOKEN_EXPIRY" value={Number(edits.API_TOKEN_EXPIRY ?? 86400)} onChange={handleNumberChange} min={300} max={604800} />
            <ToggleRow label="Single session" description="Allow only one active session per user" configKey="API_SINGLE_SESSION" value={Boolean(edits.API_SINGLE_SESSION)} onChange={handleBoolChange} />
            <TextRow label="Dashboards allowed from other addresses" description="A web dashboard on another domain must be listed here to use this server (comma-separated, e.g. https://ui.example.com). The desktop app and this server's own dashboard need no entry. CORS: API_CORS_ORIGINS" configKey="API_CORS_ORIGINS" value={String(edits.API_CORS_ORIGINS ?? '')} onChange={handleStringChange} placeholder="https://ui.example.com" />
            <TextRow label="IP whitelist" description="Comma-separated allowed IPs/CIDRs (empty = allow all)" configKey="API_IP_WHITELIST" value={String(edits.API_IP_WHITELIST ?? '')} onChange={handleStringChange} placeholder="192.168.1.0/24,10.0.0.5" />
            <NumberRow label="Max login attempts" description="Failed login attempts before lockout" configKey="API_MAX_LOGIN_ATTEMPTS" value={Number(edits.API_MAX_LOGIN_ATTEMPTS ?? 5)} onChange={handleNumberChange} min={1} max={20} />
            <NumberRow label="Lockout duration" description="Seconds of lockout after max failed attempts" configKey="API_LOCKOUT_DURATION" value={Number(edits.API_LOCKOUT_DURATION ?? 900)} onChange={handleNumberChange} min={60} max={86400} />
            <NumberRow label="Invite expiry" description="Invite code validity in seconds (604800 = 7 days)" configKey="API_INVITE_EXPIRY" value={Number(edits.API_INVITE_EXPIRY ?? 604800)} onChange={handleNumberChange} min={3600} max={2592000} />
            <NumberRow label="Max body size" description="Maximum request body size in bytes" configKey="API_MAX_BODY_SIZE" value={Number(edits.API_MAX_BODY_SIZE ?? 1048576)} onChange={handleNumberChange} min={65536} max={10485760} />
            <NumberRow label="Terminal session expiry" description="Terminal session validity in seconds (14400 = 4h)" configKey="TERMINAL_SESSION_EXPIRY" value={Number(edits.TERMINAL_SESSION_EXPIRY ?? 14400)} onChange={handleNumberChange} min={300} max={86400} />
          </GroupCard>

          {/* Notifications */}
          <GroupCard
            icon={<Bell size={16} className="text-slate-400" />}
            title="Notifications"
            description="ntfy push notifications and the Discord webhook"

          >
            <Row label="Status">
              {cfg.ntfy_configured ? <StatePill tone="ok">Configured</StatePill> : <StatePill tone="off">Not configured</StatePill>}
            </Row>
            <SectionLabel>ntfy push</SectionLabel>
            <TextRow
              label="ntfy server URL"
              description="URL of your ntfy server, for example https://ntfy.sh"
              configKey="NTFY_URL"
              value={String(edits.NTFY_URL ?? cfg.ntfy_url ?? '')}
              onChange={handleStringChange}
              placeholder="https://ntfy.sh"
            />
            <TextRow
              label="Topic"
              description="ntfy topic to publish notifications to"
              configKey="NTFY_TOPIC"
              value={String(edits.NTFY_TOPIC ?? cfg.ntfy_topic ?? '')}
              onChange={handleStringChange}
              placeholder="docker-updates"
            />
            <SectionLabel>Discord</SectionLabel>
            <TextRow
              label="Discord webhook"
              description={cfg.discord_configured ? `Set (webhook ${cfg.discord_webhook_hint || ''}). Paste a new URL to replace it, or a \${SECRETS_…} reference.` : 'Channel webhook URL — every notification is also posted there as a rich embed'}
              configKey="DISCORD_WEBHOOK_URL"
              value={String(edits.DISCORD_WEBHOOK_URL ?? '')}
              onChange={handleStringChange}
              placeholder={cfg.discord_configured ? 'configured' : 'https://discord.com/api/webhooks/…'}
            />
            <TextRow
              label="Discord name"
              description="The name the Discord posts appear with"
              configKey="DISCORD_WEBHOOK_NAME"
              value={String(edits.DISCORD_WEBHOOK_NAME ?? cfg.discord_webhook_name ?? 'DCS Orchestrator')}
              onChange={handleStringChange}
              placeholder="DCS Orchestrator"
            />
            <TextRow
              label="Discord avatar"
              description="Any https image URL; empty = the DCS icon"
              configKey="DISCORD_WEBHOOK_AVATAR"
              value={String(edits.DISCORD_WEBHOOK_AVATAR ?? cfg.discord_webhook_avatar ?? '')}
              onChange={handleStringChange}
              placeholder="https://…/avatar.png"
            />
            <TextRow
              label="Repeat cooldown"
              description="Minutes before a container rule repeats the same event for the same container while it lasts (0 = every check). Disk rules wait 6 h, image-update rules a day; a rule's own cooldown overrides these."
              configKey="NOTIFY_COOLDOWN_MINUTES"
              value={String(edits.NOTIFY_COOLDOWN_MINUTES ?? cfg.notify_cooldown_minutes ?? 60)}
              onChange={handleStringChange}
              placeholder="60"
            />
            <SectionLabel>Delivery</SectionLabel>
            <SelectRow
              label="Priority"
              description="Default ntfy priority level"
              configKey="NTFY_PRIORITY"
              value={String(edits.NTFY_PRIORITY ?? cfg.ntfy_priority ?? 'default')}
              options={['min', 'low', 'default', 'high', 'urgent']}
              onChange={handleStringChange}
            />
            <TextRow label="Notification stacks" description="Comma-separated stacks to notify about (empty = all)" configKey="NOTIFICATION_STACKS" value={String(edits.NOTIFICATION_STACKS ?? '')} onChange={handleStringChange} placeholder="core-infrastructure,web-applications" />
            <TextRow label="Portainer URL" description="Portainer dashboard link for notification buttons" configKey="PORTAINER_URL" value={String(edits.PORTAINER_URL ?? '')} onChange={handleStringChange} placeholder="https://portainer.example.com" />
            <TextRow label="Dashboard icon URL" description="Custom icon URL for notification action buttons" configKey="DASHBOARD_ICON_URL" value={String(edits.DASHBOARD_ICON_URL ?? '')} onChange={handleStringChange} />
          </GroupCard>

          {/* Security */}
          <GroupCard
            icon={<Shield size={16} className="text-slate-400" />}
            title="Security"
            description="Access control and safety settings"

          >
            <Row label="Config protection" description="Configuration changes are backed up before being applied">
              <StatePill tone="ok">Active</StatePill>
            </Row>
            <Row label="API whitelist" description="Only whitelisted configuration keys can be modified via the API">
              <StatePill tone="ok">Active</StatePill>
            </Row>
            <ToggleRow label="TLS enabled" description="Direct TLS termination on the API server" configKey="API_TLS_ENABLED" value={Boolean(edits.API_TLS_ENABLED)} onChange={handleBoolChange} />
            <ToggleRow label="Behind TLS proxy" description="API is behind a TLS-terminating proxy (enables HSTS)" configKey="API_BEHIND_TLS_PROXY" value={Boolean(edits.API_BEHIND_TLS_PROXY)} onChange={handleBoolChange} />
          </GroupCard>

          {/* ── Traefik / DNS ── */}
          <GroupCard
            icon={<Network size={16} className="text-slate-400" />}
            title="Traefik & DNS"
            description="Reverse proxy, ACME certificates, and dynamic DNS"

          >
            <TextRow label="Traefik domain" description="Primary domain for auto-routing" configKey="TRAEFIK_DOMAIN" value={String(edits.TRAEFIK_DOMAIN ?? '')} onChange={handleStringChange} placeholder="example.com" />
            <TextRow label="ACME email" description="Email for Let's Encrypt certificates" configKey="TRAEFIK_ACME_EMAIL" value={String(edits.TRAEFIK_ACME_EMAIL ?? '')} onChange={handleStringChange} placeholder="admin@example.com" />
            <Row label="Cloudflare DNS token" description={cfg?.cf_dns_api_token_set ? 'A Cloudflare API token is configured' : 'No Cloudflare token set — configure via .env'}>
              {cfg?.cf_dns_api_token_set ? <StatePill tone="ok">Set</StatePill> : <StatePill tone="off">Not set</StatePill>}
            </Row>
            <ToggleRow label="DDNS enabled" description="Periodically update DNS A records with current public IP" configKey="DDNS_ENABLED" value={Boolean(edits.DDNS_ENABLED)} onChange={handleBoolChange} />
            <NumberRow label="DDNS interval" description="Seconds between DDNS update checks" configKey="DDNS_INTERVAL" value={Number(edits.DDNS_INTERVAL ?? 300)} onChange={handleNumberChange} min={60} max={3600} />
            <TextRow label="Trusted LAN" description="CIDR subnet for Traefik IP-based access rules" configKey="TRAEFIK_TRUSTED_LAN" value={String(edits.TRAEFIK_TRUSTED_LAN ?? '')} onChange={handleStringChange} placeholder="192.168.1.0/24" />
            <TextRow label="DDNS subdomains" description="DNS records to update (@ = root, * = wildcard)" configKey="DDNS_SUBDOMAINS" value={String(edits.DDNS_SUBDOMAINS ?? '@')} onChange={handleStringChange} />
            <SectionLabel>Traefik in another VM or machine (route feed)</SectionLabel>
            <ToggleRow label="Publish routes as a feed" description="The Traefik that fronts this host runs elsewhere — the networking VM of a Proxmox layout, or a friend's proxy box. It pulls every route DCS makes with its HTTP provider; nothing to install there" configKey="TRAEFIK_FEED_ENABLED" value={Boolean(edits.TRAEFIK_FEED_ENABLED)} onChange={handleBoolChange} />
            <TextRow label="Target host" description={`How that Traefik reaches this machine (empty = ${cfg?.traefik_feed_detected_host || 'the detected LAN IP'})`} configKey="TRAEFIK_FEED_TARGET_HOST" value={String(edits.TRAEFIK_FEED_TARGET_HOST ?? '')} onChange={handleStringChange} placeholder={cfg?.traefik_feed_detected_host || '192.168.1.10'} />
            <TextRow label="Entrypoint" description="Entrypoint name on that Traefik" configKey="TRAEFIK_FEED_ENTRYPOINT" value={String(edits.TRAEFIK_FEED_ENTRYPOINT ?? 'websecure')} onChange={handleStringChange} placeholder="websecure" />
            <TextRow label="Middlewares" description="Middleware names that exist on that Traefik, comma-separated (its own auth, compress…)" configKey="TRAEFIK_FEED_MIDDLEWARES" value={String(edits.TRAEFIK_FEED_MIDDLEWARES ?? '')} onChange={handleStringChange} placeholder="secure-headers@file, compress@file" />
            <ToggleRow label="TLS on the routes" description="Off only when that Traefik serves plain http" configKey="TRAEFIK_FEED_TLS" value={Boolean(edits.TRAEFIK_FEED_TLS ?? true)} onChange={handleBoolChange} />
            <TextRow label="Certificate resolver" description="Its certResolver name, if it does not have a default" configKey="TRAEFIK_FEED_CERT_RESOLVER" value={String(edits.TRAEFIK_FEED_CERT_RESOLVER ?? '')} onChange={handleStringChange} placeholder="letsencrypt" />
            <TraefikFeedPanel enabled={Boolean(cfg?.traefik_feed_enabled)} />
            <SectionLabel>Integrations · Homarr dashboard</SectionLabel>
            <HomarrPanel onOpenSecrets={() => setCurrentPage('secrets')} />
          </GroupCard>

          {/* ── Proxmox ── */}
          <GroupCard
            icon={<Server size={16} className="text-slate-400" />}
            title="Proxmox"
            description="Show and power the VMs and containers of a Proxmox host or cluster"
          >
            <TextRow label="Proxmox URL" description="The web UI address, port included" configKey="PROXMOX_URL" value={String(edits.PROXMOX_URL ?? '')} onChange={handleStringChange} placeholder="https://pve.example.com:8006" />
            <TextRow label="API token ID" description="Datacenter → Permissions → API Tokens (user@realm!name); needs VM.Audit, VM.PowerMgmt, Sys.Audit on /" configKey="PROXMOX_TOKEN_ID" value={String(edits.PROXMOX_TOKEN_ID ?? '')} onChange={handleStringChange} placeholder="dcs@pve!dcs" />
            <TextRow label="Token secret" description={cfg?.proxmox_token_secret_source === 'secret' ? `Kept in the secret store (${pageLabel('secrets')} page); type a new one to replace it` : cfg?.proxmox_token_secret_source === 'env' ? 'Kept in .env — type it again and Save moves it to the secret store' : 'Shown once when the token was made; Save keeps it in the secret store, never in .env'} configKey="PROXMOX_TOKEN_SECRET" value={String(edits.PROXMOX_TOKEN_SECRET ?? '')} onChange={handleStringChange} placeholder={cfg?.proxmox_token_secret_set ? '••••••••' : 'xxxxxxxx-xxxx-…'} type="password" />
            <ToggleRow label="Verify certificate" description="Off for the self-signed certificate Proxmox ships with" configKey="PROXMOX_VERIFY_TLS" value={Boolean(edits.PROXMOX_VERIFY_TLS ?? true)} onChange={handleBoolChange} />
            <TextRow label="Only this node" description="Optional: hide the other nodes of a cluster" configKey="PROXMOX_NODE" value={String(edits.PROXMOX_NODE ?? '')} onChange={handleStringChange} placeholder="pve" />
            <ProxmoxTestPanel url={String(edits.PROXMOX_URL ?? '')} tokenId={String(edits.PROXMOX_TOKEN_ID ?? '')} tokenSecret={String(edits.PROXMOX_TOKEN_SECRET ?? '')} verifyTls={Boolean(edits.PROXMOX_VERIFY_TLS ?? true)} secretSource={cfg?.proxmox_token_secret_source ?? ''} onOpenSecrets={() => setCurrentPage('secrets')} />
          </GroupCard>

          {/* ── Docker ── */}
          <GroupCard
            icon={<Container size={16} className="text-slate-400" />}
            title="Docker"
            description="Container engine and stack management"

          >
            <NumberRow label="Service start delay" description="Seconds to wait between starting each stack" configKey="SERVICE_START_DELAY" value={Number(edits.SERVICE_START_DELAY ?? 0)} onChange={handleNumberChange} min={0} max={30} />
            <NumberRow label="Service stop delay" description="Seconds to wait between stopping each stack" configKey="SERVICE_STOP_DELAY" value={Number(edits.SERVICE_STOP_DELAY ?? 0)} onChange={handleNumberChange} min={0} max={30} />
            <SelectRow label="Compose version" description="Docker Compose version detection mode" configKey="DOCKER_COMPOSE_VERSION" value={String(edits.DOCKER_COMPOSE_VERSION ?? 'auto')} onChange={handleStringChange} options={['auto', 'v1', 'v2']} />
            <TextRow label="Stack startup order" description="Space-separated stack names defining startup sequence" configKey="DOCKER_STACKS" value={String(edits.DOCKER_STACKS ?? '')} onChange={handleStringChange} />
          </GroupCard>

          {/* ── Health & Monitoring ── */}
          <GroupCard
            icon={<HeartPulse size={16} className="text-slate-400" />}
            title="Health & monitoring"
            description="Health checks and container prioritization"

          >
            <ToggleRow label="Post-startup health check" description="Run a health check after all stacks start" configKey="ENABLE_POST_STARTUP_HEALTH_CHECK" value={Boolean(edits.ENABLE_POST_STARTUP_HEALTH_CHECK)} onChange={handleBoolChange} />
            <NumberRow label="Health check delay" description="Seconds to wait before the health check" configKey="HEALTH_CHECK_DELAY" value={Number(edits.HEALTH_CHECK_DELAY ?? 10)} onChange={handleNumberChange} min={0} max={120} />
            <TextRow label="Critical containers" description="Comma-separated names — unhealthy triggers critical alerts" configKey="CRITICAL_CONTAINERS" value={String(edits.CRITICAL_CONTAINERS ?? '')} onChange={handleStringChange} placeholder="traefik,pihole" />
            <TextRow label="Important containers" description="Comma-separated names — unhealthy triggers warnings" configKey="IMPORTANT_CONTAINERS" value={String(edits.IMPORTANT_CONTAINERS ?? '')} onChange={handleStringChange} placeholder="plex,nextcloud" />
          </GroupCard>

          {/* ── Metrics & Features ── */}
          <GroupCard
            icon={<Activity size={16} className="text-slate-400" />}
            title="Metrics & features"
            description="Optional subsystems — metrics, scheduler, plugins, rollback"

          >
            <ToggleRow label="Metrics collection" description="Collect CPU, memory, disk metrics at regular intervals" configKey="METRICS_ENABLED" value={Boolean(edits.METRICS_ENABLED)} onChange={handleBoolChange} />
            <NumberRow label="Metrics interval" description="Seconds between metrics snapshots" configKey="METRICS_COLLECT_INTERVAL" value={Number(edits.METRICS_COLLECT_INTERVAL ?? 60)} onChange={handleNumberChange} min={10} max={600} />
            <ToggleRow label="Rollback" description="Snapshot compose files before changes for one-click rollback" configKey="ROLLBACK_ENABLED" value={Boolean(edits.ROLLBACK_ENABLED)} onChange={handleBoolChange} />
            <ToggleRow label="Plugins" description="Load plugins from .plugins/ directory" configKey="PLUGINS_ENABLED" value={Boolean(edits.PLUGINS_ENABLED)} onChange={handleBoolChange} />
            <ToggleRow label="Plugin hooks" description="Fire plugin hooks on stack start/stop/update events" configKey="PLUGINS_HOOKS_ENABLED" value={Boolean(edits.PLUGINS_HOOKS_ENABLED)} onChange={handleBoolChange} />
            <NumberRow label="Metrics retention days" description="Days of metrics history to keep" configKey="METRICS_RETENTION_DAYS" value={Number(edits.METRICS_RETENTION_DAYS ?? 7)} onChange={handleNumberChange} min={1} max={90} />
            <NumberRow label="Rollback max snapshots" description="Maximum compose snapshots per stack" configKey="ROLLBACK_MAX_SNAPSHOTS" value={Number(edits.ROLLBACK_MAX_SNAPSHOTS ?? 10)} onChange={handleNumberChange} min={1} max={50} />
            <NumberRow label="Scheduler check interval" description="Seconds between scheduler checks" configKey="SCHEDULER_CHECK_INTERVAL" value={Number(edits.SCHEDULER_CHECK_INTERVAL ?? 60)} onChange={handleNumberChange} min={10} max={3600} />
          </GroupCard>

          {/* ── Backup ── */}
          <GroupCard
            icon={<HardDrive size={16} className="text-slate-400" />}
            title="Backup"
            description="Automated backup source, destination, and retention"

          >
            <TextRow label="Source directory" description="Path to back up (typically your Stacks or App-Data)" configKey="BACKUP_SOURCE_DIR" value={String(edits.BACKUP_SOURCE_DIR ?? '')} onChange={handleStringChange} placeholder="/opt/docker" />
            <TextRow label="Destination directory" description="Where backups are stored" configKey="BACKUP_DEST_DIR" value={String(edits.BACKUP_DEST_DIR ?? '')} onChange={handleStringChange} placeholder="/mnt/backup" />
            <NumberRow label="Retention count" description="Number of backup copies to keep" configKey="BACKUP_RETENTION_COUNT" value={Number(edits.BACKUP_RETENTION_COUNT ?? 7)} onChange={handleNumberChange} min={1} max={90} />
          </GroupCard>

          {/* ── Recovery bundle ── */}
          <GroupCard
            icon={<LifeBuoy size={16} className="text-slate-400" />}
            title="Recovery bundle"
            description={`One encrypted archive that rebuilds this install anywhere (the ${pageLabel('backup')} page creates it)`}
          >
            <TextRow label="Destination directory" description="Where bundles are written (default: backup destination/recovery, else .data/recovery)" configKey="RECOVERY_DEST_DIR" value={String(edits.RECOVERY_DEST_DIR ?? cfg.recovery_dest_dir ?? '')} onChange={handleStringChange} placeholder="/mnt/backup/recovery" />
            <TextRow label="Off-box copy" description="rsync target (user@nas:/backups/dcs) or a mounted path that receives every bundle" configKey="RECOVERY_REMOTE" value={String(edits.RECOVERY_REMOTE ?? cfg.recovery_remote ?? '')} onChange={handleStringChange} placeholder="user@nas:/backups/dcs" />
            <NumberRow label="Bundles to keep" description="Older bundles are removed" configKey="RECOVERY_RETENTION_COUNT" value={Number(edits.RECOVERY_RETENTION_COUNT ?? cfg.recovery_retention_count ?? 10)} onChange={handleNumberChange} min={1} max={100} />
          </GroupCard>

          {/* ── Power (UPS) ── */}
          <GroupCard
            icon={<BatteryCharging size={16} className="text-slate-400" />}
            title="Power (UPS)"
            description="Watch a UPS, alert on battery, stop the stacks cleanly before it runs out"
          >
            <ToggleRow label="UPS watch" description="Poll the UPS from the API (restart the API after changing these settings)" configKey="UPS_ENABLED" value={Boolean(edits.UPS_ENABLED ?? cfg.ups_enabled)} onChange={handleBoolChange} />
            <SelectRow label="Source" description="auto tries a NUT server, then apcupsd, then CyberPower's pwrstat (PowerPanel)" configKey="UPS_SOURCE" value={String(edits.UPS_SOURCE ?? cfg.ups_source ?? 'auto')} options={['auto', 'nut', 'apcupsd', 'pwrstat']} onChange={handleStringChange} />
            <TextRow label="NUT host" description="NUT server address (the nut-upsd template listens on this host)" configKey="UPS_NUT_HOST" value={String(edits.UPS_NUT_HOST ?? cfg.ups_nut_host ?? '127.0.0.1')} onChange={handleStringChange} placeholder="127.0.0.1" />
            <NumberRow label="NUT port" description="NUT server port" configKey="UPS_NUT_PORT" value={Number(edits.UPS_NUT_PORT ?? cfg.ups_nut_port ?? 3493)} onChange={handleNumberChange} min={1} max={65535} />
            <TextRow label="UPS name" description="Name of the UPS on the NUT server" configKey="UPS_NAME" value={String(edits.UPS_NAME ?? cfg.ups_name ?? 'ups')} onChange={handleStringChange} placeholder="ups" />
            <NumberRow label="Poll interval" description="Seconds between readings" configKey="UPS_POLL_INTERVAL" value={Number(edits.UPS_POLL_INTERVAL ?? cfg.ups_poll_interval ?? 15)} onChange={handleNumberChange} min={5} max={300} />
            <NumberRow label="Stop at charge %" description="On battery and at or below this charge, stop every stack" configKey="UPS_SHUTDOWN_CHARGE" value={Number(edits.UPS_SHUTDOWN_CHARGE ?? cfg.ups_shutdown_charge ?? 20)} onChange={handleNumberChange} min={1} max={99} />
            <NumberRow label="Stop at runtime (s)" description="On battery and at or below this many seconds left, stop every stack" configKey="UPS_SHUTDOWN_RUNTIME" value={Number(edits.UPS_SHUTDOWN_RUNTIME ?? cfg.ups_shutdown_runtime ?? 300)} onChange={handleNumberChange} min={30} max={7200} />
            <SelectRow label="On low battery" description="stop-stacks runs ./stop.sh --force in order; none only alerts" configKey="UPS_ON_BATTERY_ACTION" value={String(edits.UPS_ON_BATTERY_ACTION ?? cfg.ups_on_battery_action ?? 'stop-stacks')} options={['stop-stacks', 'none']} onChange={handleStringChange} />
            <TextRow label="Host shutdown command" description="Run after the stacks stopped (needs a sudo rule), for example: sudo /sbin/shutdown -h now" configKey="UPS_HOST_SHUTDOWN_CMD" value={String(edits.UPS_HOST_SHUTDOWN_CMD ?? cfg.ups_host_shutdown_cmd ?? '')} onChange={handleStringChange} placeholder="leave empty to keep the host running" />
            <ToggleRow label="Start again on mains" description="Run ./start.sh when power returns after a low-battery stop" configKey="UPS_START_ON_POWER" value={Boolean(edits.UPS_START_ON_POWER ?? cfg.ups_start_on_power)} onChange={handleBoolChange} />
          </GroupCard>

          {/* ── Unattended updates ── */}
          <GroupCard
            icon={<ArrowUpCircle size={16} className="text-slate-400" />}
            title="Unattended updates"
            description="What a dcs-update schedule does after it applied a release"
          >
            <ToggleRow label="Auto rollback" description="Return to the backup tag when the health score drops after the update" configKey="UPDATE_AUTO_ROLLBACK" value={Boolean(edits.UPDATE_AUTO_ROLLBACK ?? cfg.update_auto_rollback ?? true)} onChange={handleBoolChange} />
            <NumberRow label="Health grace (s)" description="Seconds to wait before the health score is compared" configKey="UPDATE_HEALTH_GRACE" value={Number(edits.UPDATE_HEALTH_GRACE ?? cfg.update_health_grace ?? 120)} onChange={handleNumberChange} min={30} max={3600} />
            <NumberRow label="Rollback drop" description="Points the health score may fall before a rollback" configKey="UPDATE_ROLLBACK_DROP" value={Number(edits.UPDATE_ROLLBACK_DROP ?? cfg.update_rollback_drop ?? 15)} onChange={handleNumberChange} min={1} max={100} />
            <ToggleRow label="Pull images on boot" description={`Pull image updates during an unattended boot (slower, otherwise the ${pageLabel('updates')} page and schedules do it)`} configKey="UPDATE_ON_BOOT" value={Boolean(edits.UPDATE_ON_BOOT)} onChange={handleBoolChange} />
          </GroupCard>
        </div>
      )}

      <FloatingSaveBar hasChanges={hasChanges} onSave={handleSave} onDiscard={handleReset} saving={saving} />
    </div>
  )
}

// Map config key to original data value — uses the same field map as buildEditsFromData
function getOriginalValue(data: ServerConfig, key: string): string | boolean | number {
  const map: Record<string, string | boolean | number> = {
    ENVIRONMENT: data.environment,
    LOG_LEVEL: data.log_level,
    TZ: data.timezone,
    UPDATE_ON_BOOT: data.update_on_boot ?? false,
    SERVER_NAME: data.server_name,
    SERVER_SUBTITLE: data.server_subtitle ?? '',
    PROXY_DOMAIN: data.proxy_domain ?? '',
    PUID: data.puid ?? 1000,
    PGID: data.pgid ?? 1000,
    SKIP_HEALTHCHECK_WAIT: data.skip_healthcheck_wait,
    CONTINUE_ON_FAILURE: data.continue_on_failure,
    REMOVE_VOLUMES_ON_STOP: data.remove_volumes_on_stop,
    AGGRESSIVE_IMAGE_PRUNE: data.aggressive_image_prune,
    UPDATE_NOTIFICATION: data.update_notification,
    SHOW_BANNERS: data.show_banners,
    API_PORT: data.api_port,
    API_BIND: data.api_bind,
    API_ENABLED: data.api_enabled ?? true,
    API_AUTH_ENABLED: data.api_auth_enabled ?? true,
    API_RATE_LIMIT: data.api_rate_limit ?? 600,
    API_RATE_WINDOW: data.api_rate_window ?? 60,
    API_TOKEN_EXPIRY: data.api_token_expiry ?? 86400,
    API_SINGLE_SESSION: data.api_single_session ?? false,
    API_CORS_ORIGINS: data.api_cors_origins ?? '',
    API_IP_WHITELIST: data.api_ip_whitelist ?? '',
    NTFY_URL: data.ntfy_url ?? '',
    NTFY_TOPIC: data.ntfy_topic ?? '',
    DISCORD_WEBHOOK_NAME: data.discord_webhook_name ?? 'DCS Orchestrator',
    PROXMOX_URL: data.proxmox_url ?? '',
    PROXMOX_TOKEN_ID: data.proxmox_token_id ?? '',
    PROXMOX_TOKEN_SECRET: '',
    PROXMOX_VERIFY_TLS: data.proxmox_verify_tls ?? true,
    PROXMOX_NODE: data.proxmox_node ?? '',
    TRAEFIK_FEED_ENABLED: data.traefik_feed_enabled ?? false,
    TRAEFIK_FEED_TARGET_HOST: data.traefik_feed_target_host ?? '',
    TRAEFIK_FEED_ENTRYPOINT: data.traefik_feed_entrypoint ?? 'websecure',
    TRAEFIK_FEED_MIDDLEWARES: data.traefik_feed_middlewares ?? '',
    TRAEFIK_FEED_TLS: data.traefik_feed_tls ?? true,
    TRAEFIK_FEED_CERT_RESOLVER: data.traefik_feed_cert_resolver ?? '',
    DISCORD_WEBHOOK_AVATAR: data.discord_webhook_avatar ?? '',
    NOTIFY_COOLDOWN_MINUTES: data.notify_cooldown_minutes ?? 60,
    NTFY_PRIORITY: data.ntfy_priority ?? 'default',
    NOTIFICATION_STACKS: data.notification_stacks ?? '',
    ENABLE_COLORS: data.enable_colors ?? true,
    COLOR_MODE: data.color_mode ?? 'auto',
    FORCE_COLOR: data.force_color ?? false,
    VERBOSE_MODE: data.verbose_mode ?? false,
    SHOW_SYSTEM_INFO: data.show_system_info ?? true,
    PROGRESS_BAR_WIDTH: data.progress_bar_width ?? 50,
    ENABLE_LOG_DATE: data.enable_log_date ?? true,
    LOG_BACKUP_COUNT: data.log_backup_count ?? 12,
    ENABLE_STRUCTURED_LOGGING: data.enable_structured_logging ?? false,
    TRAEFIK_DOMAIN: data.traefik_domain ?? '',
    TRAEFIK_ACME_EMAIL: data.traefik_acme_email ?? '',
    DDNS_ENABLED: data.ddns_enabled ?? false,
    DDNS_INTERVAL: data.ddns_interval ?? 300,
    ENABLE_POST_STARTUP_HEALTH_CHECK: data.enable_post_startup_health_check ?? true,
    HEALTH_CHECK_DELAY: data.health_check_delay ?? 10,
    CRITICAL_CONTAINERS: data.critical_containers ?? '',
    IMPORTANT_CONTAINERS: data.important_containers ?? '',
    METRICS_ENABLED: data.metrics_enabled ?? true,
    METRICS_COLLECT_INTERVAL: data.metrics_collect_interval ?? 60,
    ROLLBACK_ENABLED: data.rollback_enabled ?? true,
    PLUGINS_ENABLED: data.plugins_enabled ?? true,
    PLUGINS_HOOKS_ENABLED: data.plugins_hooks_enabled ?? true,
    METRICS_RETENTION_DAYS: data.metrics_retention_days ?? 7,
    ROLLBACK_MAX_SNAPSHOTS: data.rollback_max_snapshots ?? 10,
    SCHEDULER_CHECK_INTERVAL: data.scheduler_check_interval ?? 60,
    SERVICE_START_DELAY: data.service_start_delay ?? 0,
    SERVICE_STOP_DELAY: data.service_stop_delay ?? 0,
    DOCKER_STACKS: data.docker_stacks ?? '',
    BACKUP_SOURCE_DIR: data.backup_source_dir ?? '',
    BACKUP_DEST_DIR: data.backup_dest_dir ?? '',
    BACKUP_RETENTION_COUNT: data.backup_retention_count ?? 7,
    // API extended
    API_MAX_LOGIN_ATTEMPTS: data.api_max_login_attempts ?? 5,
    API_LOCKOUT_DURATION: data.api_lockout_duration ?? 900,
    API_TLS_ENABLED: data.api_tls_enabled ?? false,
    API_BEHIND_TLS_PROXY: data.api_behind_tls_proxy ?? false,
    API_INVITE_EXPIRY: data.api_invite_expiry ?? 604800,
    API_MAX_BODY_SIZE: data.api_max_body_size ?? 1048576,
    TERMINAL_SESSION_EXPIRY: data.terminal_session_expiry ?? 14400,
    TRAEFIK_TRUSTED_LAN: data.traefik_trusted_lan ?? '',
    DDNS_SUBDOMAINS: data.ddns_subdomains ?? '@',
    PORTAINER_URL: data.portainer_url ?? '',
    DASHBOARD_ICON_URL: data.dashboard_icon_url ?? '',
    DOCKER_COMPOSE_VERSION: data.docker_compose_version ?? 'auto',
  }
  return map[key] ?? ''
}
