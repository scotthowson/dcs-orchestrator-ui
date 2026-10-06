// =============================================================================
// DCS Orchestrator API — TypeScript Interfaces
// Maps to all 24 REST API endpoint response shapes
// =============================================================================

// Electron IPC bridge
export interface ElectronAPI {
  getSettings: () => Promise<Record<string, unknown>>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  getVersion: () => Promise<string>
  /** Combined server check: connectivity + setup status in one call (Node.js http, no CORS) */
  checkServer: (serverUrl: string) => Promise<{ reachable: boolean; initialized: boolean; error?: string }>
  /** Generic JSON fetch via Node.js http (bypasses all browser security) */
  netFetchJson: (url: string) => Promise<{ ok: boolean; status: number; data: unknown; error?: string }>
  /** Discord Rich Presence (desktop app only): push the latest facts */
  presenceUpdate?: (payload: DiscordPresencePayload) => Promise<boolean>
  presenceStatus?: () => Promise<DiscordPresenceStatus>
  presenceConfigure?: () => Promise<DiscordPresenceStatus>
}

export interface DiscordPresencePayload {
  details: string
  state: string
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  startTimestamp?: number
  buttons?: { label: string; url: string }[]
}

export interface DiscordPresenceStatus {
  enabled: boolean
  connected: boolean
  clientId: string
  error: string
  /** unix ms of the last activity Discord accepted, 0 when none yet */
  lastSentAt?: number
  /** Discord account the local client is signed in with */
  user?: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// GET /version
export interface APIVersion {
  api_version: string
  framework_version: string
  docker_version: string
  compose_version: string
  compose_command: string
}

// GET /status
export interface ServerStatus {
  timestamp: string
  hostname: string
  uptime_seconds: number
  docker: {
    containers: {
      total: number
      running: number
      stopped: number
    }
    images: number
    volumes: number
    networks: number
  }
  stacks: {
    total: number
    running: number
  }
  system: {
    load_average: [number, number, number]
    memory_mb: {
      total: number
      available: number
    }
    disk: {
      total: string
      used: string
      available: string
      percent: string
    }
    cpu_count: number
    swap_mb?: { total: number; free: number }
    /** the busiest graphics card in the old shape (null without one) */
    gpu?: GpuInfo | null
    /** every graphics card, busiest kind first (server 4.0.29+) */
    gpus?: GpuInfo[]
  }
}

/** one graphics card from GET /status: NVIDIA (nvidia-smi), AMD (amdgpu sysfs), Intel (name only); a reading the card does not give is null */
export interface GpuInfo {
  vendor?: 'nvidia' | 'amd' | 'intel'
  name: string
  slot?: string
  render?: string | null
  utilization: number | null
  memory_used_mb: number | null
  memory_total_mb: number | null
  temperature: number | null
  temperature_hotspot?: number | null
  fan_speed?: number | null
  fan_rpm?: number | null
  power_w?: number | null
  power_cap_w?: number | null
  /** the driver has powered the card down while idle: it is not woken to read it */
  asleep?: boolean
}

// GET /health
export interface HealthReport {
  status: 'healthy' | 'degraded' | 'critical'
  summary: {
    total: number
    healthy: number
    unhealthy: number
    stopped: number
    /** Stopped on purpose: Sablier starts them on the first request */
    sleeping?: number
    /** On-demand containers that no longer exist (a prune removed them): POST /sablier/repair recreates them */
    on_demand_missing?: string[]
  }
  containers: HealthContainer[]
  api?: ApiHealthMetrics
  /** GET /health?fleet=1 on a hub: the members' containers were merged in */
  fleet?: boolean
  /** the fleet view: one entry per DCS, the hub first (id null) */
  members?: FleetHealthMember[]
  /** the fleet view: how many VMs did not answer (they make the status at least "degraded") */
  unreachable?: number
  /** Docker on that server: when it does not answer every container is down and the status is critical */
  docker?: { reachable: boolean; error: string }
}

/** one DCS in a fleet-wide list (GET …?fleet=1): the hub first, id null */
export interface FleetListMember { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string; count: number }

export interface FleetHealthMember { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string; status: string; summary: HealthReport['summary'] | null }

export interface HealthContainer {
  /** Managed by Sablier: a stopped one is idle, not broken */
  on_demand?: boolean
  /** the fleet view: which member runs it (null = the hub) */
  member?: string | null
  member_name?: string
  vmid?: number | null
  name: string
  state: string
  health: string
}

// GET /stacks
export interface StackListResponse {
  total: number
  stacks: StackInfo[]
}

export interface StackInfo {
  name: string
  status: 'running' | 'stopped'
  running_containers: number
  /** every container of this stopped stack is one Sablier stops on purpose: asleep, not down */
  sleeping?: boolean
  /** its on-demand containers that are asleep right now (Sablier wakes them on a request) */
  sleeping_containers?: number
  /** the hub needs it (proxy, sign-in, firewall): it never moves into a VM */
  hub_only?: boolean
  has_env: boolean
  compose_file: string
  /** Fleet (3.9): "hub" runs here, "vm" runs on a member VM the hub forwards to */
  placement?: 'hub' | 'vm'
  member?: string
  member_name?: string
  /** the member's API address (a VM stack on a hub) */
  member_url?: string | null
  vmid?: number | null
  node?: string | null
  /** the guest kind of a VM stack as the hub reports it ("qemu" | "lxc"); power actions need it */
  type?: string
  reachable?: boolean
  version?: string
  /** where its App-Data is (4.0.32): the stack's folder, or a drive of its own */
  app_data?: StackAppData
  /** every container of the stack, stopped ones too (4.0.33): stopped = total - running - sleeping */
  total_containers?: number
  /** its running containers' CPU and memory, percent of the machine (the stats cache) */
  cpu_percent?: number | null
  mem_percent?: number | null
  /** its images with a newer version upstream (the last registry check) */
  updates_available?: number
  /** the TCP ports it publishes beyond localhost */
  ports?: number[]
  /** the addresses Traefik serves it on (https://host) */
  links?: string[]
  /** when it was last in a backup (ISO time), null when never since 4.0.33 */
  last_backup?: string | null
}

/** a stack's App-Data: `external` = on a drive of its own (an absolute APP_DATA_DIR in its .env); `ok` = that drive is there */
export interface StackAppData {
  path: string
  external: boolean
  ok: boolean
  free_bytes: number | null
}

// GET /stacks/:name
export interface StackDetail {
  name: string
  status: 'running' | 'stopped'
  running_containers: number
  /** its on-demand containers asleep right now */
  sleeping_containers?: number
  has_env: boolean
  services: string[]
  containers: ContainerInfo[]
  images: StackImage[]
  /** where its App-Data is (4.0.32) */
  app_data?: StackAppData
}

export interface StackImage {
  name: string
  id: string
  size: number
}

// GET /stacks/:name/containers
export interface StackContainersResponse {
  stack: string
  containers: ContainerInfo[]
}

// GET /stacks/:name/logs
export interface StackLogsResponse {
  stack: string
  lines: number
  logs: string
}

// POST /stacks/:name/(start|stop|restart)
export interface StackActionResponse {
  stack: string
  action: string
  success: boolean
  output: string
}

// POST /stacks/:name/update
export interface StackUpdateResponse {
  stack: string
  action: 'update'
  success: boolean
  changes_detected: boolean
  changed_images: string[]
  output: string
}

// GET /containers, /stacks/:name/containers
export interface ContainerInfo {
  /** Sablier starts this container on the first request and stops it when idle */
  /** an on-demand container that is not running: Sablier stopped it on purpose (the stack page says so) */
  sleeping?: boolean
  on_demand?: boolean
  /** Compose project (the stack) this container belongs to, "" for containers Compose does not manage */
  stack?: string
  name: string
  state: string
  health: string
  image: string
  image_id: string
  created: string
  uptime_seconds: number
  ports: string
  restart_count: number
  cpu_percent?: number | null
  mem_percent?: number | null
  /** Fleet (3.9): the member VM this container runs on (absent = this server) */
  member?: string
  /** Fleet (3.9.5): the VM's address, where its published ports are */
  member_host?: string | null
  member_name?: string
  vmid?: number | null
}

// GET /containers/:name
export interface ContainerDetail extends ContainerInfo {
  environment: string
  mounts: string
  networks: string
  /** Compose ownership (empty when the container is not Compose-managed) */
  compose_project?: string
  compose_service?: string
  compose_dir?: string
  ip_addresses?: string
  platform?: string
  hostname?: string
  working_dir?: string
  restart_policy?: string
}

// POST /containers/:name/(start|stop|restart)
export interface ContainerActionResponse {
  container: string
  action: string
  success: boolean
  output: string
}

// GET /containers/:name/logs
export interface ContainerLogsResponse {
  container: string
  lines: number
  logs: string
}

// POST /maintenance/prune, /maintenance/image-prune
export interface MaintenanceResponse {
  action: string
  success: boolean
  output: string
}

// GET /containers/:name/stats
export interface ContainerStats {
  container: string
  cpu_percent: string
  memory_usage: string
  memory_percent: string
  network_io: string
  block_io: string
  pids: string
}

// GET /images
export interface ImageListResponse {
  total: number
  images: ImageInfo[]
  /** GET /images?fleet=1 on a hub: the members' images were merged in */
  fleet?: boolean
  members?: { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string; count: number }[]
}

export interface ImageInfo {
  /** the fleet view: which member holds it (null = the hub) */
  member?: string | null
  member_name?: string
  vmid?: number | null
  repository: string
  tag: string
  id: string
  created: string
  size: string
  age_days: number
  staleness: 'current' | 'aging' | 'stale' | 'unknown'
  update_available?: boolean | null
}

// GET /config
export interface ServerConfig {
  environment: string
  update_channel?: string
  /** UPDATE_ON_BOOT: pull image updates during an unattended boot (an older API leaves it out) */
  update_on_boot?: boolean
  update_auto_rollback?: boolean
  update_health_grace?: number
  update_rollback_drop?: number
  ups_enabled?: boolean
  ups_source?: string
  ups_nut_host?: string
  ups_nut_port?: number
  ups_name?: string
  ups_poll_interval?: number
  ups_shutdown_charge?: number
  ups_shutdown_runtime?: number
  ups_on_battery_action?: string
  ups_host_shutdown_cmd?: string
  ups_start_on_power?: boolean
  recovery_dest_dir?: string
  recovery_remote?: string
  recovery_retention_count?: number
  log_level: string
  compose_dir: string
  app_data_dir: string
  base_dir: string
  compose_command: string
  skip_healthcheck_wait: boolean
  continue_on_failure: boolean
  remove_volumes_on_stop: boolean
  aggressive_image_prune: boolean
  update_notification: boolean
  show_banners: boolean
  api_port: number
  api_bind: string
  ntfy_configured: boolean
  // Proxmox (3.8)
  proxmox_url?: string
  proxmox_token_id?: string
  proxmox_token_secret_set?: boolean
  /** 'secret' = the secret store (preferred), 'env' = .env, '' = not set */
  proxmox_token_secret_source?: 'secret' | 'env' | ''
  proxmox_verify_tls?: boolean
  proxmox_node?: string
  // Traefik feed — a Traefik on another machine pulls this host's routes (3.8)
  traefik_feed_enabled?: boolean
  traefik_feed_token?: string
  traefik_feed_target_host?: string
  traefik_feed_detected_host?: string
  traefik_feed_entrypoint?: string
  traefik_feed_middlewares?: string
  traefik_feed_tls?: boolean
  traefik_feed_cert_resolver?: string
  /** A Discord channel webhook is set (DISCORD_WEBHOOK_URL) */
  discord_configured?: boolean
  /** Last characters of the webhook, to recognise it without exposing it */
  discord_webhook_hint?: string
  /** Name and avatar the Discord posts appear with */
  discord_webhook_name?: string
  discord_webhook_avatar?: string
  /** Minutes before a container rule repeats the same event for the same target */
  notify_cooldown_minutes?: number
  ntfy_url: string
  ntfy_topic: string
  ntfy_priority: string
  notification_stacks: string
  enable_colors: boolean
  color_mode: string
  force_color: boolean
  verbose_mode: boolean
  show_system_info: boolean
  progress_bar_width: number
  enable_log_date: boolean
  api_enabled: boolean
  server_name: string
  server_subtitle: string
  timezone: string
  proxy_domain: string
  puid: number
  pgid: number
  // Traefik/DNS
  traefik_domain: string
  traefik_acme_email: string
  cf_dns_api_token_set: boolean
  ddns_enabled: boolean
  ddns_interval: number
  // Health/Monitoring
  enable_post_startup_health_check: boolean
  health_check_delay: number
  critical_containers: string
  important_containers: string
  // Metrics/Features
  metrics_enabled: boolean
  metrics_collect_interval: number
  rollback_enabled: boolean
  plugins_enabled: boolean
  plugins_hooks_enabled: boolean
  // Backup
  backup_source_dir: string
  backup_dest_dir: string
  backup_retention_count: number
  // Docker
  service_start_delay: number
  docker_stacks: string
  service_stop_delay: number
  // API extended
  api_auth_enabled: boolean
  api_rate_limit: number
  api_rate_window: number
  api_token_expiry: number
  api_single_session: boolean
  api_cors_origins: string
  api_ip_whitelist: string
  // Log extended
  log_backup_count: number
  enable_structured_logging: boolean
  // Metrics extended
  metrics_retention_days: number
  // Features extended
  rollback_max_snapshots: number
  secrets_encryption: boolean
  scheduler_check_interval: number
  // API extended (v2)
  api_max_login_attempts: number
  api_lockout_duration: number
  api_tls_enabled: boolean
  api_behind_tls_proxy: boolean
  api_invite_expiry: number
  api_max_body_size: number
  terminal_session_expiry: number
  // Traefik extended
  traefik_trusted_lan: string
  // DDNS extended
  ddns_subdomains: string
  // Dashboard
  portainer_url: string
  dashboard_icon_url: string
  // Docker extended
  docker_compose_version: string
}

// POST /stacks (create)
export interface StackCreateResponse {
  success: boolean
  name: string
  message: string
  /** set when the stack keeps its App-Data on a drive of its own */
  app_data?: { path: string; external: true }
}

// DELETE /stacks/:name
export interface StackDeleteResponse {
  success: boolean
  name: string
  message: string
  /** its App-Data on a drive of its own, kept (never deleted with the stack) */
  app_data_kept?: string
}

// POST /config
export interface ConfigUpdateResponse {
  success: boolean
  updated: number
  message: string
}

// GET /system
export interface SystemInfo {
  hostname: string
  kernel: string
  /** What the host runs on: bare metal, or a hypervisor/container name from systemd-detect-virt */
  virtualization?: string
  /** QEMU guest agent (Proxmox/KVM guests): package present, daemon running, VM channel exposed */
  guest_agent?: { installed: boolean; active: boolean; channel: boolean }
  cpu_count: number
  memory_total_mb: number
  swap_total_mb: number
  docker_version: string
  docker_disk_usage: DockerDiskUsage[]
}

export interface DockerDiskUsage {
  type: string
  total: string
  active: string
  size: string
  reclaimable: string
}

// GET /networks
export interface NetworkListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  total: number
  networks: NetworkInfo[]
}

export interface NetworkInfo {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  id: string
  name: string
  driver: string
  scope: string
  containers: string[]
}

// GET /networks/:name
export interface NetworkDetail {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
  subnet: string
  gateway: string
  containers: NetworkContainer[]
  /** Containers may join it with `docker network connect` / compose external */
  attachable?: boolean
  ipv6?: boolean
  ip_range?: string
  labels?: Record<string, string>
  created?: string
  /** Compose project that owns the network (from its label), if any */
  compose_project?: string
}

export interface NetworkContainer {
  id: string
  name: string
  ipv4: string
}

// POST /networks (create) and POST /networks/:name/recreate
export interface NetworkCreateOptions {
  name: string
  driver?: string
  subnet?: string
  gateway?: string
  ip_range?: string
  internal?: boolean
  attachable?: boolean
  ipv6?: boolean
  labels?: Record<string, string>
}

// POST /containers/:name/env
export interface ContainerEnvUpdateResponse {
  success: boolean
  container: string
  stack: string
  service: string
  /** Variables written into docker-compose.yml */
  compose_changed: string[]
  /** "KEY=VAR" pairs whose value was written to the stack .env (KEY referenced ${VAR}) */
  env_changed: string[]
  removed: string[]
  recreated: boolean
  output: string
}

export interface NetworkRecreateResponse {
  success: boolean
  name: string
  id: string
  /** Containers connected again after the network was rebuilt */
  reconnected: string[]
  /** Containers that could not be reconnected (still running, detached) */
  failed: string[]
  message: string
}

// POST /networks (create)
export interface NetworkCreateResponse {
  success: boolean
  name: string
  driver: string
  message: string
}

// POST /networks/:name/delete
export interface NetworkDeleteResponse {
  success: boolean
  name: string
  message: string
}

// POST /networks/:name/connect, /networks/:name/disconnect
export interface NetworkActionResponse {
  success: boolean
  network: string
  container: string
  message: string
}

// POST /volumes/:name/delete
export interface VolumeDeleteResponse {
  success: boolean
  name: string
  message: string
}

// GET /volumes
export interface VolumeListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  total: number
  volumes: VolumeInfo[]
}

export interface VolumeInfo {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  name: string
  driver: string
  mountpoint: string
  size_bytes: number
}

// GET /disks
export interface DiskListResponse {
  total: number
  disks: DiskInfo[]
}

export interface DiskInfo {
  device: string
  mount: string
  total: string
  used: string
  available: string
  percent: string
  fstype?: string
  total_bytes?: number
  used_bytes?: number
  avail_bytes?: number
}

/** GET /domains — this server's domains: the primary (the hub's stacks) and the others, one Cloudflare token for all */
export interface DomainEntry {
  domain: string
  primary: boolean
  /** its wildcard certificate is asked for (null: Traefik asks per host, no wildcard list) */
  certificate: boolean | null
  /** Authelia has a sign-in for it (null: no Authelia) */
  sign_in: boolean | null
  /** the VMs that answer under it */
  vms: { id: string; name: string; vmid: number | null }[]
}
export interface DomainsResponse {
  primary: string | null
  cloudflare: boolean
  authelia: boolean
  wildcard: boolean
  /** the domain new VMs get; null = the primary */
  vm_default: string | null
  domains: DomainEntry[]
}
export interface DomainChangeResponse { success: boolean; domain: string; message?: string; traefik_restarted?: boolean; authelia_restarted?: boolean; dns?: { domain: string; ok: boolean; message?: string }[] }

/** GET /storage/overview — storage across every machine (sizes in bytes) */
export interface StorageDrive { device: string; mount: string; fstype: string; total: number; used: number; avail: number }
/** a physical disk of a Proxmox node; wearout is the life left in percent (SSDs), null when unknown */
export interface PveDisk { devpath: string; model: string; vendor: string; serial: string; size: number; type: string; health: string; wearout: number | null; used: string; rpm: number | null }
export interface PveStorage { storage: string; type: string; content: string[]; total: number; used: number; avail: number; active: boolean; shared: boolean; network: boolean }
export interface PveZfsPool { name: string; size: number; alloc: number; free: number; health: string; frag: number | null }
export interface PveNodeStorage { node: string; status: string; disks: PveDisk[]; disks_error: string | null; storages: PveStorage[]; zfs: PveZfsPool[] }
export interface StorageOverview {
  /** counted false: this server is a Proxmox guest, its drives are inside a node's pools (note says which) */
  hub: { name: string; counted: boolean; note: string | null; drives: StorageDrive[] }
  proxmox: { linked: boolean; error: string | null; nodes: PveNodeStorage[] }
  /** the VMs' own disks: they live in the Proxmox pools and are not counted again */
  vms: { id: string; name: string; vmid: number | null; node?: string; type?: string; reachable: boolean; drives: StorageDrive[] | null }[]
  totals: { total: number; used: number; avail: number; drives: number; devices: number; pools: number }
}

/** A user-defined custom disk location (stored locally, not from the API) */
export interface CustomDiskEntry {
  /** Mount path, e.g. /mnt/external */
  mount: string
  /** Friendly label */
  label: string
}

// GET /logs
export interface LogsResponse {
  log_file: string
  lines: number
  logs: string
}

export interface LogEntry {
  timestamp: string
  level: string
  message: string
}

// GET /events
export interface EventsResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  total: number
  events: EventEntry[]
}

export interface EventEntry {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  timestamp: number
  type: string
  action: string
  name: string
}

// GET /containers/:name/reset — what a nuke & reinstall would do
export interface ContainerResetPreview {
  container: string
  stack: string
  service: string
  image: string
  app_data: { path: string; size: string; exists: boolean }[]
  kept_shared: { path: string; shared_with: string }[]
  volumes: string[]
  volumes_shared: { path: string; shared_with: string }[]
  trash_dir: string
  trash_keep_days: number
  previous_resets: string[]
}

// POST /containers/:name/reset
export interface ContainerResetResponse {
  success: boolean
  container: string
  stack: string
  service: string
  image: string
  trashed: string[]
  trash_dir: string
  volumes_removed: string[]
  kept_shared: { path: string; shared_with: string }[]
  failed: string[]
  message: string
  output: string
}

// POST /auth/users/:name/role
export interface UserRoleResponse { success: boolean; username: string; role: 'admin' | 'user' | 'bot'; message: string }

// GET /containers/:name/processes
export interface ContainerProcessesResponse {
  container: string
  processes: ContainerProcess[]
}

export interface ContainerProcess {
  uid: string
  pid: string
  ppid: string
  cpu: string
  time: string
  cmd: string
}

// GET /stacks/:name/compose
export interface StackComposeResponse {
  stack: string
  content: string
}

// Auth responses
export interface AuthResponse {
  success: boolean
  token: string
  username: string
  role: 'admin' | 'user' | 'bot'
  /** From the person's profile, when set */
  display_name?: string
  avatar?: string
  status_emoji?: string
  status_text?: string
}

export interface AuthVerifyResponse {
  valid: boolean
  username: string
  role: string
  /** Set when valid is false (older servers answer 200 instead of 401) */
  message?: string
  /** 4.0.5: whether the account asks for a TOTP code at sign-in (an older server leaves it out) */
  totp_enabled?: boolean
}

export interface AuthLogoutResponse {
  success: boolean
  message: string
}

/** POST /auth/password — the server re-hashed the password and ended every session of the account, this one too */
export interface AuthPasswordChangeResponse {
  success: boolean
  signed_out: boolean
  message: string
}

export interface InviteResponse {
  success: boolean
  code: string
  role: string
  expires_at: string
}

export interface InviteListResponse {
  invites: InviteCode[]
}

export interface InviteCode {
  code: string
  role: string
  created_by?: string
  created_at: string
  expires_at: string
  expired?: boolean
  used: boolean
  used_by?: string
}

export interface UserListResponse {
  users: ApiUser[]
}

export interface ApiUser {
  username: string
  role: string
  created_at: string
  /** From the person's profile, when set */
  display_name?: string
  avatar?: string
  status_emoji?: string
  status_text?: string
}

// GET /auth/sessions
export interface SessionInfo {
  id: string
  username: string
  role: string
  created_at: string
  expires_at: number
  remaining_seconds: number
  ip: string
}

export interface SessionListResponse {
  sessions: SessionInfo[]
  total: number
}

// GET /health — extended API metrics
export interface ApiHealthMetrics {
  uptime_seconds: number
  requests_total: number
  errors_total: number
  memory_kb: number
  pid: number
}

// GET /
export interface APIRoot {
  name: string
  version: string
  endpoints: APIEndpoint[]
}

export interface APIEndpoint {
  method: string
  path: string
  description: string
}

// Connection state
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error'

// Stack annotation (local metadata, persisted via settings)
export interface StackAnnotation {
  label?: string
  priority?: 'critical' | 'high' | 'normal' | 'low'
  notes?: string
  color?: string
}

// Connection profiles
export interface ConnectionProfile {
  id: string
  name: string
  url: string
  isDefault: boolean
  lastConnected?: number
}

// App settings (local, persisted via electron-store)
export interface AppSettings {
  serverUrl: string
  pollingInterval: number
  containerPollingInterval: number
  imagePollingInterval: number
  logPollingInterval: number
  /** the look: dark, light, or the device's preference (the header switch always sets dark or light) */
  theme: 'dark' | 'light' | 'system'
  sidebarCollapsed: boolean
  /** pages this person took out of the sidebar and the tab bars (Settings → Sidebar & pages); the command palette and links still open them */
  hiddenPages: PageId[]
  /** Custom labels for disk mount points — e.g., { "/mnt/plex": "Plex Drive" } */
  diskLabels: Record<string, string>
  /** Mount points to show on dashboard — empty means show all */
  pinnedDisks: string[]
  /** User-added custom disk mount paths (not auto-detected by the server) */
  customDisks: CustomDiskEntry[]
  /** Per-stack annotations (labels, priority, notes) */
  stackAnnotations: Record<string, StackAnnotation>
  /** Optional background image URL */
  backgroundImage: string
  /** Auto-lock screen after N minutes of inactivity (0 = disabled) */
  autoLockMinutes: number
  /** Auto-check for system/image updates (0 = off, ms interval) */
  autoCheckUpdates: number
  /** Number of available DCS framework updates (for sidebar badge) */
  updatesAvailable: number
  /** Show desktop notifications for critical events */
  notificationsEnabled: boolean
  /** Customizable project/app name displayed in sidebar and login */
  projectName: string
  /** Subtitle shown below the project name */
  projectSubtitle: string
  /** Connection profiles for multi-server management */
  connectionProfiles: ConnectionProfile[]
  /** User-defined custom CSS injected into the app */
  customCSS: string
  /** Remember the last username across sessions */
  rememberUsername: boolean
  /** Last successfully authenticated username */
  lastUsername: string
  /** Session duration in minutes (0 = indefinite) */
  sessionDurationMinutes: number
  /** Page shown right after sign-in */
  defaultPage: PageId
  /** Status-bar clock: 24-hour (true) or 12-hour */
  use24hClock: boolean
  /** Turn off animations and transitions */
  reduceMotion: boolean
}

// ---------------------------------------------------------------------------
// Phase 1: Compose Editor
// ---------------------------------------------------------------------------

// POST /stacks/:name/compose/validate
export interface ComposeValidateResponse {
  valid: boolean
  stack: string
  output: string
}

/**
 * A write to a VM stack's files (compose, .env, rollback) is saved on the hub and then pushed into the VM: the answer
 * says whether the VM took it. `pushed: false` means the hub's copy is saved but the VM is behind (push again later).
 */
export interface FleetPushOutcome {
  placement?: 'hub' | 'vm'
  member?: string
  pushed?: boolean
  push_error?: string
}

// POST /stacks/:name/compose
export interface ComposeSaveResponse extends FleetPushOutcome {
  success: boolean
  stack: string
  message: string
  validated: boolean
  validation_errors?: string
}

// GET /stacks/:name/env
export interface StackEnvVariable {
  key: string
  value: string
  line: number
  comment: string
}

export interface StackEnvResponse {
  stack: string
  raw: string
  variables: StackEnvVariable[]
}

// POST /stacks/:name/env
export interface StackEnvSaveResponse extends FleetPushOutcome {
  success: boolean
  stack: string
  message: string
}

// ---------------------------------------------------------------------------
// Phase 2: Maintenance
// ---------------------------------------------------------------------------

export interface MaintenanceReport {
  containers: { total: number; running: number; stopped: number }
  images: { total: number; dangling: number }
  volumes: { total: number; dangling: number }
  networks: { total: number; custom: number }
  docker_df: string
  app_data_size: string
  log_size: string
}

export interface OrphanContainer {
  name: string
  image: string
  status: string
}

export interface DanglingImage {
  id: string
  size: string
  created: string
}

export interface DanglingVolume {
  name: string
  driver: string
}

export interface OrphanReport {
  containers: OrphanContainer[]
  images: DanglingImage[]
  volumes: DanglingVolume[]
}

export interface DiskStackSize {
  name: string
  size: string
}

export interface DiskDfEntry {
  type: string
  total: string
  active: string
  size: string
  reclaimable: string
}

export interface DiskVolumeSize {
  name: string
  size: string
}

export interface DiskAnalysis {
  stack_sizes: DiskStackSize[]
  docker_df: DiskDfEntry[]
  total_app_data: string
  host_disk?: {
    total: string
    used: string
    available: string
    percent: string
  }
  volumes?: DiskVolumeSize[]
}

export interface LogRotateResponse {
  success: boolean
  message: string
  archived_as?: string
  previous_size?: string
  previous_lines?: number
  purged_archives?: number
}

// ---------------------------------------------------------------------------
// Phase 3: Enhanced Logs
// ---------------------------------------------------------------------------

export interface LogLevelCounts {
  error: number
  critical: number
  warning: number
  success: number
  info: number
  debug: number
  step: number
  timing: number
}

export interface LogStatsResponse {
  total_lines: number
  file_size: string
  levels: LogLevelCounts
  sessions: number
  archives: { count: number; total_size: string }
}

export interface LogArchiveEntry {
  filename: string
  size: string
  date: string
}

export interface LogArchivesResponse {
  archives: LogArchiveEntry[]
  total_size: string
}

// ---------------------------------------------------------------------------
// Phase 4: Batch Operations
// ---------------------------------------------------------------------------

export interface BatchStackResult {
  stack: string
  success: boolean
  message: string
  changes_detected?: boolean
}

export interface BatchStackResponse {
  action: string
  total: number
  results: BatchStackResult[]
}

// ---------------------------------------------------------------------------
// Phase 5: Environment Manager
// ---------------------------------------------------------------------------

export interface EnvVariable {
  key: string
  value: string
  line: number
  comment: string
}

export interface RootEnvResponse {
  raw: string
  variables: EnvVariable[]
}

export interface EnvValidationError {
  line: number
  message: string
}

export interface EnvValidateResponse {
  valid: boolean
  errors: EnvValidationError[]
  warnings: EnvValidationError[]
}

// ---------------------------------------------------------------------------
// Phase 6: Backup & Restore
// ---------------------------------------------------------------------------

export interface BackupEntry {
  filename: string
  size: string
  timestamp: number
  /** it has a .sha256 written when it was made (read back to the end then) */
  verified?: boolean
  /** "full" (everything), "stack" (one stack), "legacy" (an archive from before 4.0.28) */
  kind?: 'full' | 'stack' | 'legacy'
  stack?: string
  /** false: something could not be read when it was made (its warnings say what); null for an old archive */
  complete?: boolean | null
}
/** POST /backups/verify — the archive read to the end against its .sha256 and manifest */
export interface BackupVerifyResponse { ok: boolean; error: string | null; sha256: string; checksum_checked: boolean; format: number; kind: string; parts: number; filename: string }

export interface BackupListResponse {
  backups: BackupEntry[]
  total: number
}

export interface BackupStatusResponse {
  status: 'idle' | 'running' | 'error' | 'restoring'
  last_backup?: { filename: string; size: string; timestamp: string } | null
  /** the last restore: what came back, and what could not (a drive folder that is not there, a file it could not write) */
  last_restore?: {
    filename: string
    timestamp: string
    stacks?: string[]
    volumes?: string[]
    appdata?: string[]
    warnings?: string[]
    legacy?: boolean
  } | null
  progress?: string | null
  percent?: number
  stage?: string
  error?: string
  started_at?: string
  filename?: string
  /** what could not be read (the backup is then incomplete) */
  warnings?: string[]
}

export interface BackupConfigResponse {
  configured: boolean
  destination: string
  source: string
  retention_count: number
  /** App-Data folders on drives a backup takes as parts of their own (4.0.33); ok: false while the drive is not there */
  appdata_dirs?: { stack: string; path: string; ok: boolean }[]
}

export interface BackupTriggerResponse {
  success: boolean
  message: string
  filename: string
}

export interface BackupRestoreResponse {
  success: boolean
  message: string
  filename: string
}

// POST /containers/:name/exec
export interface ContainerExecResponse {
  container: string
  command: string
  exit_code: number
  output: string
  success: boolean
}

// System Update Check
export interface SystemUpdateLocalChanges {
  /** tracked files with local edits under Stacks/, .templates/, .api-auth/, .plugins/ (always kept) */
  user: string[]
  /** tracked framework files with local edits */
  framework: string[]
  /** user files the update touches: put back byte for byte afterwards */
  kept: string[]
  /** framework files the update touches: need replace_local */
  conflicts: string[]
}

export type SystemRestartMethod = 'reexec' | 'systemd' | 'relaunch' | 'manual'

export interface SystemUpdateCheckResponse {
  available: boolean
  /** current | behind | ahead | diverged | unknown */
  /** behind / current / ahead / unknown; `member` = a VM the hub updates, `manual` = installed without git */
  state?: string
  /** false when GitHub could not be reached; `error` says why */
  checked?: boolean
  /** hub (a VM built by the hub) or manual (no git): who brings updates here */
  managed_by?: 'hub' | 'manual'
  /** a member: its hub */
  hub?: { name?: string; url?: string; version?: string } | null
  /** the newest update this install took (ISO), "" when none */
  last_updated_at?: string
  /** a member or a manual install: the one-line explanation */
  note?: string
  error?: string
  channel?: string
  branch: string
  current_version: string
  current_commit?: string
  latest_version: string
  latest_name?: string
  latest_commit?: string
  commits_behind: number
  changelog: { hash: string; message: string; author: string; date: string }[]
  release_notes?: string
  local_changes?: SystemUpdateLocalChanges
  /** true only when edited framework files block the update */
  has_local_changes: boolean
  last_backup_tag?: string
  restart_method?: SystemRestartMethod
  api_pid?: number
  ui_update?: { available: boolean; current?: string; latest?: string }
}

export interface SystemRestartInfo {
  method: SystemRestartMethod | ''
  eta_seconds: number
  hint: string
}

export interface SystemUpdateApplyResponse {
  success?: boolean
  updated?: boolean
  /** a hub: the VMs are updated once the API is back on the new code */
  fleet_update_queued?: boolean
  state?: string
  channel?: string
  branch?: string
  previous_version: string
  previous_commit?: string
  updated_to?: string
  new_version?: string
  new_commit?: string
  changelog: { hash: string; message: string }[]
  release_notes?: string
  backup_tag: string
  commits_applied?: number
  kept_local?: string[]
  replaced_local?: string[]
  backup_dir?: string
  new_settings?: string[]
  service_definition_changed?: boolean
  restart_required?: boolean
  restart_scheduled?: boolean
  restart?: SystemRestartInfo
  message?: string
}

export interface SystemUpdateRollbackResponse {
  success?: boolean
  rolled_back?: boolean
  restored_version?: string
  restored_commit?: string
  previous_version?: string
  backup_tag?: string
  kept_local?: string[]
  replaced_local?: string[]
  restart_required?: boolean
  restart_scheduled?: boolean
  restart?: SystemRestartInfo
  message?: string
}

export interface SystemRestartResponse {
  restarting: boolean
  method: SystemRestartMethod
  eta_seconds: number
  hint: string
}

// GET /traefik/status
export interface TraefikStatusResponse {
  active: boolean
  domain: string
  /** forward-auth middleware name this install defines ("" when Authelia is not set up) */
  authelia_middleware?: string
  authelia?: boolean
  sablier?: boolean
}

// GET /power
export interface PowerStatus {
  enabled: boolean
  source: 'nut' | 'apcupsd' | 'pwrstat' | 'none' | string
  ups?: string
  ok?: boolean
  error?: string
  status?: string
  on_battery?: boolean
  low_battery?: boolean
  charge?: number | null
  runtime_seconds?: number | null
  load?: number | null
  input_voltage?: number | null
  /** 4.0.22 (pwrstat): the output voltage, the load in watts, the rated watts, the last power event and the self-test result */
  output_voltage?: number | null
  load_watts?: number | null
  rated_watts?: number | null
  last_power_event?: string | null
  test_result?: string | null
  model?: string
  sampled_at?: string
  stacks_stopped?: boolean
  last_event?: string
  loop_running?: boolean
  stale?: boolean
  hint?: string
}

// GET /recovery
export interface RecoveryBundleEntry {
  file: string
  size: number
  size_human: string
  created: string
  checksum: boolean
}

export interface RecoveryListResponse {
  dest_dir: string
  remote: string
  retention: number
  passphrase_set: boolean
  stacks: string[]
  bundles: RecoveryBundleEntry[]
}

export interface RecoveryBundleResponse {
  success: boolean
  file: string
  path: string
  size: number
  size_human: string
  stacks: number
  app_data: string[]
  /** what could not be read into the bundle (Traefik or Authelia data) */
  warnings?: string[]
  remote_copied: boolean
  note: string
  message: string
}

export interface RecoveryRestoreResponse {
  success: boolean
  file?: string
  stacks: number
  users: number
  initialized?: boolean
  /** the App-Data written back ("stack", or "stack/Traefik") */
  app_data?: string[]
  /** what did not come back: a drive folder that is not there, App-Data that could not be written */
  warnings?: string[]
  restart_scheduled: boolean
  restart: SystemRestartInfo
  message: string
}

// GET /system/update/history
export interface SystemUpdateHistoryEntry {
  type: string
  timestamp: string
  /** updated | rolled-back | failed | needs-consent | check-failed | images */
  result: string
  message: string
  from: string
  to: string
  channel: string
}

export interface SystemUpdateHistoryResponse {
  running: boolean
  entries: SystemUpdateHistoryEntry[]
  log_tail: string
  auto_rollback: boolean
  health_grace: number
  rollback_drop: number
}

export interface OsUpdateCheckResponse {
  available: boolean
  count: number
  package_manager: string
  packages: { package: string; version: string }[]
  checked_as: string
}

export interface OsUpdateApplyResponse {
  success: boolean
  status?: string
  package_manager: string
  exit_code?: number
  summary?: string
  output?: string
  applied_as?: string
  message: string
}

export interface OsUpdateStatusResponse {
  status: 'idle' | 'running' | 'complete'
  success?: boolean
  package_manager?: string
  exit_code?: number
  summary?: string
  output?: string
  applied_as?: string
  message?: string
  started_at?: string
  completed_at?: string
}

export interface UIUpdateCheckResponse {
  available: boolean
  current_version: string
  latest_version: string
  release_url: string
  changelog: string
  published_at: string
  download_url?: string
}

// Navigation
export type PageId =
  | 'dashboard'
  | 'stacks'
  | 'containers'
  | 'images'
  | 'health'
  | 'uptime'
  | 'networks'
  | 'logs'
  | 'system'
  | 'diagnostics'
  | 'config'
  | 'settings'
  | 'bookmarks'
  | 'activity'
  | 'users'
  | 'volumes'
  | 'maintenance'
  | 'environment'
  | 'backup'
  | 'terminal'
  | 'cronjobs'
  | 'trends'
  | 'updates'
  | 'notifications'
  | 'snapshots'
  | 'templates'
  | 'automations'
  | 'topology'
  | 'file-browser'
  | 'disk-analysis'
  | 'secrets'
  | 'schedules'
  | 'plugins'
  | 'event-feed'
  | 'export'
  | 'dns'
  | 'proxmox'
  | 'crowdsec'
  | 'setup'

/**
 * Pages restricted to admin users only.
 * Used by Sidebar (hide nav items), CommandPalette (hide commands),
 * and settingsStore (navigation guard).
 */
export const ADMIN_ONLY_PAGES: ReadonlySet<PageId> = new Set([
  'secrets',
  'file-browser',
  'plugins',
  'terminal',
  'environment',
  'config',
  'maintenance',
  'backup',
  'cronjobs',
  'users',
  'automations',
  'snapshots',
  'export',
  'dns',
])

// ---------------------------------------------------------------------------
// v3.1: Terminal, Image Delete, Container Rename, Stack Services, System Metrics
// ---------------------------------------------------------------------------

// POST /terminal/exec
export interface TerminalExecResponse {
  command: string
  cwd: string
  exit_code: number
  output: string
  success: boolean
  timestamp: string
}

// GET /terminal/history
export interface TerminalHistoryResponse {
  commands: string[]
  total: number
}

// POST /images/*/delete
export interface ImageDeleteResponse {
  success: boolean
  image: string
  message: string
}

// POST /containers/:name/rename
export interface ContainerRenameResponse {
  success: boolean
  old_name: string
  new_name: string
  message: string
}

// GET /stacks/:name/services
export interface StackServiceInfo {
  name: string
  state: string
  health: string
  image: string
  container: string
}

export interface StackServicesResponse {
  stack: string
  services: StackServiceInfo[]
}

// GET /system/metrics
export interface SystemMetricsResponse {
  cpu: {
    count: number
    load_average: [number, number, number]
  }
  memory: {
    total_mb: number
    used_mb: number
    available_mb: number
    cached_mb: number
    swap_total_mb: number
    swap_used_mb: number
  }
  disks: Array<{
    device: string
    mount: string
    total: string
    used: string
    available: string
    percent: string
  }>
}

// ---------------------------------------------------------------------------
// v3.2: Terminal Auth, Container Files, Alerts, Cron, Live Logs
// ---------------------------------------------------------------------------

// POST /terminal/auth
export interface TerminalAuthResponse {
  success: boolean
  token: string
  username: string
  expires_in: number
  auth_method: string
  message?: string
}

// POST /terminal/auth/verify
/** GET /fleet/members/{id}/terminal — can the hub open a shell in this VM (3.9.3)? */
export interface MemberTerminalStatus {
  available: boolean
  member: string
  member_name: string
  vmid: number | null
  /** the VM's address and the account the hub's ssh key opens */
  host: string
  user: string
  /** why not, when it cannot */
  reason: string
}

/** POST /fleet/members/{id}/terminal/exec — a command the hub ran inside a VM over its ssh key */
export interface MemberTerminalExecResponse extends TerminalExecResponse {
  member: string
  member_name: string
  vmid: number | null
  host: string
  user: string
}

export interface TerminalAuthVerifyResponse {
  valid: boolean
  username: string
  expires_at: number
}

// POST /terminal/auth/logout
export interface TerminalLogoutResponse {
  success: boolean
  message: string
}

// GET /containers/:name/files
export interface ContainerFileEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  permissions: string
  modified: string
}

export interface ContainerFilesResponse {
  container: string
  path: string
  entries: ContainerFileEntry[]
}

// GET /containers/:name/files/content
export interface ContainerFileContentResponse {
  container: string
  path: string
  content: string
  size: number
}

// GET/POST /alerts/config
export interface AlertThresholds {
  cpu_warning: number
  cpu_critical: number
  memory_warning: number
  memory_critical: number
  disk_warning: number
  disk_critical: number
  restart_threshold: number
}

export interface AlertConfigResponse {
  thresholds: AlertThresholds
}

// GET /system/crontab
export interface CronEntry {
  schedule: string
  command: string
  user?: string
  source: 'user' | 'system' | 'cron.d'
  human_readable: string
}

export interface CrontabResponse {
  entries: CronEntry[]
  raw: string
}

// GET /containers/:name/logs/live, GET /logs/live
export interface LogStreamEntry {
  timestamp: string
  line: string
  level?: string
}

export interface LiveLogsResponse {
  entries: LogStreamEntry[]
  count: number
  container?: string
}

// ---------------------------------------------------------------------------
// v4.0: Resource Trends, Image Updates, Notifications, Snapshots,
//       Compose History, Templates, Automations, Network Topology
// ---------------------------------------------------------------------------

// GET /metrics/trends
export interface MetricsPoint {
  ts: string
  epoch: number
  cpu_pct: number
  load1: number
  load5?: number
  load15?: number
  mem_used_mb: number
  mem_total_mb: number
  mem_pct: number
  disk_pct: number
  /** Present on rolled-up (5-minute / hourly) or downsampled points */
  n?: number
  cpu_min?: number
  cpu_max?: number
  mem_min?: number
  mem_max?: number
  disk_min?: number
  disk_max?: number
}

export interface MetricsSnapshotResponse {
  success: boolean
  timestamp: string
  cpu_pct: number
  mem_pct: number
  disk_pct: number
}

export interface MetricsTrendsResponse {
  range: string
  points: MetricsPoint[]
  /** Points returned (after downsampling) */
  count: number
  /** Samples covered before downsampling */
  total?: number
  /** Seconds between points */
  resolution_s?: number
  oldest_epoch?: number | null
  newest_epoch?: number | null
}

// GET/POST /images/check-updates
export interface ImageUpdateInfo {
  image: string
  /** the fleet view: which member runs it (null = the hub / this server) */
  member?: string | null
  member_name?: string
  vmid?: number | null
  repository?: string
  tag?: string
  age_days: number
  staleness: 'current' | 'aging' | 'stale' | 'unknown'
  containers: string
  stack: string
  size: string
  old_id?: string
  new_id?: string
  update_available?: boolean
  /** Running containers created from this tag that still run an older copy of it (a pull moved the tag; they were never recreated): "name1,name2" */
  containers_outdated?: string
  /** …of those, the ones Compose does not manage (started by hand): DCS cannot recreate them, only their owner can */
  containers_outdated_manual?: string
}

export interface ImageCheckResponse {
  images: ImageUpdateInfo[]
  total: number
  stale: number
  aging: number
  current: number
  updates_available?: number
  /** When the registry digests were last compared (cache file time) */
  registry_checked_at?: string
  /** When an image was last pulled here (the newest pull across the fleet in the fleet view) */
  last_update_at?: string
  /** GET /fleet/images: true when members were merged in */
  fleet?: boolean
  /** GET /fleet/images: one entry per DCS (the hub first, id null) */
  members?: FleetImagesMember[]
}

/** One DCS in the fleet-wide image view */
export interface FleetImagesMember { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string; total: number; updates_available: number; stale: number; registry_checked_at: string; last_update_at: string }
/** POST /fleet/images/check — the registry check everywhere at once */
export interface FleetImagesCheckResponse { members: { id: string | null; name: string; reachable: boolean; error: string; total: number; updates_available: number }[]; total: number; updates_available: number; unreachable: number; checked_at: string }

export interface ImageRegistryCheckResponse {
  images: { image: string; old_id: string; new_id: string; update_available: boolean }[]
  total: number
  updates_available: number
  checked_at: string
}

export interface ImageUpdateResponse {
  success: boolean
  image: string
  containers_restarted: string[]
  /** Running containers that are not Compose-managed and were left alone */
  containers_skipped?: string[]
  /** Compose services that were recreated but are not running afterwards */
  containers_failed?: string[]
  /** False when the request asked for a pull only */
  recreate?: boolean
  timestamp: string
}

// Notification Rules
export interface NotificationRule {
  id: string
  name: string
  enabled: boolean
  trigger: string
  target: string
  priority: string
  tags: string[]
  title_template?: string
  message_template?: string
  /** Minutes before the same event for the same target repeats; null = the event's default */
  cooldown_minutes?: number | null
  created_at: string
}

export interface NotificationRulesResponse {
  rules: NotificationRule[]
}

export interface NotificationHistoryEntry {
  timestamp: string
  type: string
  title: string
  priority: string
  status_code: number
}

export interface NotificationHistoryResponse {
  history: NotificationHistoryEntry[]
}

export interface NotificationTestResponse {
  success: boolean
  message: string
  status_code: number
  timestamp: string
}

// Snapshots
export interface SnapshotEntry {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  filename: string
  label: string
  /** from the archive's manifest: the DCS that took it and its version ('' on an archive without one) */
  hostname?: string
  dcs_version?: string
  size: string
  timestamp: string
  epoch: number
}

export interface SnapshotListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  snapshots: SnapshotEntry[]
  total: number
}

export interface SnapshotCreateResponse {
  success: boolean
  filename: string
  label: string
  size: string
  timestamp: string
  message?: string
  /** POST …?fleet=1 on a hub: one snapshot here and one on every VM — what each DCS did (id null = the hub);
   *  `success` is false as soon as one of them failed, so read taken / failed / results */
  fleet?: boolean
  results?: { id: string | null; name: string; success: boolean; filename: string; message: string }[]
  taken?: number
  failed?: number
}

export interface SnapshotRestoreResponse {
  success: boolean
  message: string
  filename: string
}

// Compose History
export interface ComposeVersion {
  version_id: string
  timestamp: string
  size: number
}

export interface ComposeHistoryResponse {
  stack: string
  versions: ComposeVersion[]
  count: number
}

export interface ComposeVersionContentResponse {
  stack: string
  version_id: string
  content: string
  size: number
}

export interface ComposeRollbackResponse extends FleetPushOutcome {
  success: boolean
  stack: string
  restored_version: string
  message: string
}

// Templates
export interface TemplateOptionalService {
  service: string
  label: string
  description?: string
  default_enabled: boolean
}

export interface TemplateInfo {
  name: string
  title?: string
  /** "bypass": its apps sign in on their own, so its routes are not put behind Authelia by default */
  auth?: string
  auth_note?: string
  description: string
  category: string
  target_stack?: string
  tags: string[]
  icon?: string
  variables?: TemplateVariable[]
  optional_services?: TemplateOptionalService[]
  singleton?: boolean
  /** services that can use one of the server's graphics cards (4.0.30): picked on the deploy sheet */
  gpu?: TemplateGpuUse[]
}

/** template.json "gpu": compute = AI (AMD also gets /dev/kfd), video = transcoding; images swaps the image per vendor */
export interface TemplateGpuUse {
  service: string
  use?: 'compute' | 'video'
  images?: Partial<Record<'amd' | 'nvidia' | 'intel', string>>
}

export interface TemplateVariable {
  name: string
  label: string
  description?: string
  default?: string
  required?: boolean
  type?: string
  /** Conditional visibility: { "OTHER_VAR": "value" } — only show this field when OTHER_VAR equals value */
  show_if?: Record<string, string>
  /** Dropdown options: [{ "value": "sqlite", "label": "SQLite (built-in)" }] */
  options?: { value: string; label: string }[]
}

export interface TemplateListResponse {
  templates: TemplateInfo[]
  total: number
}

export interface TemplateDetailResponse {
  template: TemplateInfo
  compose: string
  env?: string
  /** ${SECRETS_NAME} placeholders the template uses and whether each secret exists */
  secrets?: { name: string; exists: boolean }[]
}

export interface TemplateUpdateResponse {
  success: boolean
  name: string
  message: string
}

export interface TemplateDeleteResponse {
  success: boolean
  name: string
  message: string
}

export interface TemplateDeployResponse {
  success: boolean
  target_stack: string
  services_added: string[]
  /** the graphics card the services were given (4.0.30) */
  gpu?: { vendor: string; name: string; slot: string; render: string | null } | null
  started: boolean
  message: string
  backup_file?: string
  /** Why auto-start was held back (for example missing secrets) */
  warning?: string
  /** service → container name for the added services */
  containers?: Record<string, string>
  /** Set when the start runs in the background: poll GET /stacks/{stack}/activity */
  activity_id?: string
  /** services deployed with a Sablier middleware */
  on_demand?: string[]
  /** true when the Sablier plugin had to be declared and Traefik was restarted once */
  traefik_restarted?: boolean
  /** the Traefik template's "Start containers on demand" switch: Sablier deployed into the stack, or present already, or why not */
  sablier?: { deployed: boolean; present: boolean; error?: string } | null
  /** the Traefik template's add-ons as this deploy left them (geoblock carries its countries) */
  addons?: Record<string, { on: boolean; countries?: string[] }> | null
}

// GET /stacks/:stack/activity — progress of a background action on a stack
export type StackActivityPhase =
  | 'idle' | 'pulling' | 'creating' | 'starting' | 'stopping'
  | 'healthcheck' | 'running' | 'started' | 'stopped' | 'exited' | 'unhealthy' | 'failed'

export interface StackActivityService {
  service: string
  container: string
  image: string
  state: 'missing' | 'created' | 'running' | 'restarting' | 'exited' | 'dead' | 'paused' | string
  health: 'none' | 'starting' | 'healthy' | 'unhealthy' | string
  pulled: boolean
  created: boolean
  started: boolean
  /** The container's own explanation when it is not fine: last health-check output or last log lines */
  detail?: string
}

export interface StackActivityResponse {
  stack: string
  active: boolean
  id: string | null
  action: 'deploy' | 'start' | 'stop' | 'restart' | null
  template: string | null
  phase: StackActivityPhase
  started_at: string | null
  finished_at: string | null
  success: boolean | null
  elapsed_s: number
  services: StackActivityService[]
  output: string[]
  error: string
}

export interface TemplateImportResponse {
  success: boolean
  name: string
  message: string
}

// Deploy History / Audit Log
export interface DeployHistoryEntry {
  id: string
  action: 'deploy' | 'undeploy'
  template: string
  target_stack: string
  services: string[]
  backup_file?: string
  timestamp: string
  epoch: number
}

export interface DeployHistoryResponse {
  history: DeployHistoryEntry[]
  total: number
}

// Template Undeploy
export interface TemplateUndeployResponse {
  success: boolean
  template: string
  target_stack: string
  services_removed: string[]
  containers_removed: string[]
  backup_file: string
  stack_deleted: boolean
  data_removed: boolean
  message: string
}

// Template Dry Run / Preview
export interface TemplateDryRunResponse {
  success: boolean
  template: string
  target_stack: string
  services: string[]
  service_conflicts: string
  has_service_conflicts: boolean
  port_conflicts: string
  has_port_conflicts: boolean
  port_conflicts_detail?: { port: number; owner: string; type: 'stack' | 'container'; service?: string }[]
  env_additions: { key: string; value: string }[]
  env_existing?: { key: string; current_value: string; new_value: string }[]
  lines_added: number
  compose_preview: string
  /** the template runs once per server */
  is_singleton?: boolean
  /** a singleton that is already deployed: the service names, comma-separated */
  singleton_conflict?: string
  has_singleton_conflict?: boolean
  /** required variables with no value, comma-separated */
  missing_required_vars?: string
  has_missing_vars?: boolean
  /** what the security scan of the compose found */
  security_warnings?: string[]
  /** what the pre-deploy plugin hooks said (dry run) */
  plugin_results?: { plugin: string; output: string }[]
}

// Automations
export interface AutomationRule {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  id: string
  name: string
  enabled: boolean
  trigger_type: 'schedule' | 'condition'
  trigger_value: string
  action_type: string
  action_target: string
  /** condition rules: the percentage a high_cpu, high_memory or disk_full condition must reach (the engine assumes 90 without it) */
  threshold?: number | null
  /** condition rules: seconds the rule waits after it fired before it can fire again (the engine assumes 900 without it) */
  cooldown?: number | null
  created_at: string
  run_count: number
  last_run: string | null
  history: AutomationHistoryEntry[]
}

export interface AutomationHistoryEntry {
  timestamp: string
  success: boolean
  message: string
}

export interface AutomationListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  automations: AutomationRule[]
  total: number
}

export interface AutomationHistoryResponse {
  automation_id: string
  history: AutomationHistoryEntry[]
}

// Network Topology
export interface TopologyNodeIP {
  network: string
  ip: string
}

export interface TopologyNode {
  /** unique in the answer: on a fleet map a VM's container is "<vm name>/<container>" */
  id: string
  /** the container's own name (a fleet map only; the hub's own containers carry it too) */
  name?: string
  state: string
  health: string
  image: string
  stack: string
  networks: string[]
  ports: string
  ip_addresses?: TopologyNodeIP[]
  /** the VM that runs it (null: the hub itself); only on a fleet map */
  member?: string | null
  member_name?: string | null
}

export interface TopologyEdge {
  source: string
  target: string
  network: string
}

export interface TopologyNetwork {
  name: string
  driver: string
  subnet: string
  container_count: number
  /** the network's own name (a fleet map prefixes name with the VM's) */
  plain_name?: string
  member?: string | null
  member_name?: string | null
}

/** One server of a fleet map: the hub first, then every VM the hub asked */
export interface TopologyServer {
  id: string | null
  name: string
  hub: boolean
  /** the VM answered with its map (false: unreachable or an older DCS) */
  answered: boolean
  reachable?: boolean
}

export interface TopologyResponse {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  networks: TopologyNetwork[]
  /** GET /topology?fleet=1 on a hub: who is on the map */
  servers?: TopologyServer[]
}

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

// GET /setup/status
export interface SetupStatusResponse {
  initialized: boolean
  needs_admin?: boolean
  needs_config?: boolean
  /** A node (DCS_ROLE=node) is never "to be set up": it says so, and which hub manages it (null until it joined one) */
  role?: 'node'
  hub?: { url: string; name: string } | null
}

// GET /setup/defaults
export interface SetupDefaultsResponse {
  defaults: Record<string, string>
  stacks: string[]
  system: {
    hostname: string
    timezone: string
    puid: number
    pgid: number
    docker_version: string
    compose_version: string
    docker_available: boolean
    /** where DCS runs (3.8): a Proxmox guest gets a link offer in the wizard; linked (3.9.7): a Proxmox link is saved already (setup.sh) */
    proxmox?: { virtualization: string; host: boolean; guest: boolean; reason: string; hint_url: string; vendor: string; product: string; guest_agent: boolean; linked?: boolean }
    /** 3.9.7: the role chosen in setup.sh (FLEET_ROLE), else what the fleet state says */
    fleet_role?: 'hub' | 'member' | 'standalone'
  }
}

// POST /auth/factory-reset
export interface FactoryResetResponse {
  success: boolean
  files_removed: string[]
  compose_reset: boolean
  stacks_removed: string[]
}

// POST /setup/configure
export interface SetupConfigureRequest {
  env_vars: Record<string, string>
  stacks: string[]
  /** 3.9.7: stacks the person removed on the wizard's stack page — their folders go too, unless containers run from them or App-Data holds data */
  remove_stacks?: string[]
}

export interface SetupConfigureResponse {
  success: boolean
  stacks_created: string[]
  stacks_removed: string[]
  stacks_warned: string[]
  env_updated: number
}

// POST /setup/complete
export interface SetupCompleteResponse {
  initialized: boolean
  message: string
  /** A join saved by setup.sh that ran when setup completed (3.9) */
  fleet_join?: FleetJoinOutcome | null
  /** The Proxmox tags the VM that runs this DCS was given (dcs, and hub on a hub); null without a Proxmox link */
  proxmox_tag?: ProxmoxSelf | null
}

// GET /proxmox/self, POST /proxmox/self/tag — the VM this DCS runs in and its Proxmox tags
export interface ProxmoxSelf {
  linked: boolean
  role: string
  guest: { node: string; type: 'qemu' | 'lxc'; vmid: number; name: string; matched_by: 'uuid' | 'ip' | 'name' } | null
  /** the tags the guest has now / should have / lacks */
  tags: string[]
  wanted: string[]
  missing: string[]
  tagged: boolean
  changed: boolean
  message: string
}

// POST /stacks/rename
export interface StackRenameRequest {
  old_name: string
  new_name: string
}

export interface StackRenameResponse {
  success: boolean
  old_name: string
  new_name: string
  message?: string
}

// POST /stacks/reorder
export interface StackReorderRequest {
  stacks: string[]
}

export interface StackReorderResponse {
  success: boolean
  order: string[]
}

// ---------------------------------------------------------------------------
// v4.0: SSE, Metrics History, Rollback, Secrets, Scheduler, Health Scoring, Plugins, Multi-Server
// ---------------------------------------------------------------------------

export interface SSEMetricsEvent {
  cpu_percent: number
  memory_percent: number
  memory_used_mb: number
  memory_total_mb: number
  load_average: [number, number, number]
  disk_percent: number
  container_count: number
  container_running: number
}

export interface MetricsHistoryResponse {
  range: string
  data: MetricsPoint[]
  count: number
  total?: number
  resolution_s?: number
  oldest_epoch?: number | null
  newest_epoch?: number | null
}

export interface MetricsDataPoint {
  ts: string
  cpu_percent: number
  memory_percent: number
  memory_used_mb: number
  memory_total_mb: number
  load_1m: number
  load_5m: number
  load_15m: number
  disk_percent: number
  disk_used_gb: number
  disk_total_gb: number
  containers_total: number
  containers_running: number
  containers_stopped: number
  images_count: number
  networks_count: number
  volumes_count: number
}

export interface MetricsSummaryResponse {
  range: string
  samples: number
  points?: number
  resolution_s?: number
  oldest_epoch?: number | null
  newest_epoch?: number | null
  cpu: { avg: number; min: number; max: number }
  mem: { avg: number; min: number; max: number }
  disk: { avg: number; min: number; max: number }
}

export interface RollbackSnapshotsResponse {
  stack: string
  snapshots: RollbackSnapshot[]
}

export interface RollbackSnapshot {
  id: string
  timestamp: string
  operation: string
  images_count: number
}

export interface RollbackSnapshotDetail extends RollbackSnapshot {
  compose_file: string
  env_file: string | null
  images: { name: string; digest: string }[]
  metadata: { user: string; stack_status: string; created_at: string }
}

export interface RollbackRestoreResponse {
  success: boolean
  stack: string
  snapshot_id: string
  output: string
}

export interface RollbackDiffResponse {
  stack: string
  snapshot_id: string
  compose_diff: string
  env_diff: string
  image_changes: { image: string; from: string; to: string }[]
}

export interface SecretEntry {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  key: string
  modified: string
  size: number
}

export interface SecretsListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  secrets: SecretEntry[]
  count: number
  /** Regular expression the server applies to names */
  name_rule?: string
}

export interface SecretSetResponse {
  success: boolean
  key: string
  replaced: boolean
  /** Placeholder to use in compose and .env files, e.g. ${SECRETS_DB_PASSWORD} */
  reference: string
  message: string
}

export interface SecretReferencesResponse {
  key: string
  exists: boolean
  stacks: string[]
  root_env: boolean
  reference: string
}

export interface SecretDeleteResponse {
  success: boolean
  key: string
}

export interface SecretExistsResponse {
  key: string
  exists: boolean
}

export interface ScheduleListResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  schedules: Schedule[]
  total: number
}

export interface Schedule {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  id: string
  name: string
  schedule: string
  /** the same expression under its older name (the API keeps both) */
  cron?: string
  action: string
  target: string
  enabled: boolean
  created_at: string
  last_run: string | null
  next_run: string
  run_count: number
}

export interface ScheduleCreateResponse {
  success: boolean
  schedule: Schedule
}

export interface ScheduleHistoryResponse {
  schedule_id: string
  history: ScheduleExecution[]
}

export interface ScheduleExecution {
  timestamp: string
  schedule_id: string
  action: string
  target: string
  success: boolean
  duration_ms: number
  output: string
  /** 'manual' when a person pressed Run now */
  trigger?: string
}

export interface HealthScoreResponse {
  score: number
  grade: string
  factors: {
    stacks: { score: number; weight: number; healthy: number; unhealthy: number; /** on-demand containers that sleep (outside the score) */ sleeping?: number; total: number }
    resources: { score: number; weight: number; cpu_pct: number; mem_pct: number }
    images: { score: number; weight: number; total: number; stale: number }
    uptime: { score: number; weight: number; seconds: number }
  }
  /** per-stack scores: the API does not emit them today (the fleet view sends an empty list) — shown only when they come */
  stacks?: StackHealthScore[]
  /** GET /health/score?fleet=1 on a hub: the members were folded in */
  fleet?: boolean
  members?: { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string; score: number | null; grade: string | null }[]
}

export interface StackHealthScore {
  /** the fleet view: which member runs it (null = the hub) */
  member?: string | null
  member_name?: string
  vmid?: number | null
  stack: string
  score: number
  grade: string
  container_count: number
  healthy_count: number
  container_scores: ContainerHealthScore[]
}

export interface ContainerHealthScore {
  container: string
  score: number
  grade: string
  factors: { health: number; uptime: number; restarts: number; resources: number; image_age: number }
}

export interface HealthScoreHistoryResponse {
  range: string
  history: { ts: string; score: number }[]
}

export interface PluginListResponse {
  plugins: Plugin[]
  total: number
}

export interface Plugin {
  name: string
  version: string
  description: string
  author?: string
  templates: string[]
  hooks: string[]
  enabled: boolean
  category?: string
  tags?: string[]
  /** Root .env variables the hooks receive (declared in the manifest) */
  env?: string[]
  config?: Record<string, unknown>
  contract?: number
  installed_from?: string
}

export interface PluginCatalogEntry {
  name: string
  version: string
  description: string
  author?: string
  category: string
  tags: string[]
  hooks: string[]
  env: string[]
  config: Record<string, unknown>
  installed: boolean
  contract?: number
}

export interface PluginCatalogResponse {
  plugins: PluginCatalogEntry[]
  count: number
}

export interface PluginInstallResponse {
  success: boolean
  plugin: Plugin
  message: string
}

export interface PluginDeleteResponse {
  success: boolean
  name: string
}

// Plugin hooks & execution
export interface PluginHookInfo {
  name: string
  size: number
  executable: boolean
  modified: number
  lines: number
}

export interface PluginHooksListResponse {
  plugin: string
  hooks: PluginHookInfo[]
}

export interface PluginHookContentResponse {
  plugin: string
  hook: string
  content: string
  executable: boolean
  size: number
}

export interface PluginHookUpdateResponse {
  success: boolean
  plugin: string
  hook: string
  message: string
}

export interface PluginHookTestResponse {
  success: boolean
  plugin: string
  hook: string
  exit_code: number
  output: string
}

export interface PluginLogEntry {
  timestamp: string
  hook: string
  status: string
  message: string
  exit_code?: number
}

export interface PluginLogsResponse {
  plugin: string
  entries: PluginLogEntry[]
  total: number
}

export interface PluginConfigUpdateResponse {
  success: boolean
  plugin: string
  message: string
}

export interface ConfigSchemaResponse {
  sections: Record<string, {
    title: string
    properties: Record<string, {
      type: string
      default: unknown
      description: string
      enum?: string[]
      minimum?: number
      maximum?: number
      pattern?: string
    }>
  }>
}

export interface DependencyGraphResponse {
  nodes: { id: string; status: string }[]
  edges: { from: string; to: string }[]
}

export interface ServerProfile {
  id: string
  name: string
  url: string
  /** Session saved for this server, so switching back needs no sign-in */
  apiToken?: string
  username?: string
  lastConnected?: number
  color?: string
  isDefault?: boolean
}

// ---------------------------------------------------------------------------
// v4.1: URL Import, Gallery, Stack Clone, Image Search, Compose Validate,
//       Export, Audit Log, Webhooks
// ---------------------------------------------------------------------------

export interface TemplateImportUrlResponse {
  success: boolean
  name: string
  source_url: string
  message: string
}

export interface GalleryTemplate {
  name: string
  description: string
  category: string
  url: string
  services: string[]
  icon?: string
}

export interface TemplateGalleryResponse {
  templates: GalleryTemplate[]
  total: number
}

export interface StackCloneResponse {
  success: boolean
  source: string
  name: string
  message: string
}

export interface ImageSearchResult {
  name: string
  description: string
  stars: number
  official: string
}

export interface ImageSearchResponse {
  results: ImageSearchResult[]
  total: number
  query: string
}

export interface ComposeValidateFullResponse {
  valid: boolean
  errors: string[]
  warnings: string[]
  services: string[]
  output: string
}

export interface ExportResponse {
  type: string
  data: Record<string, unknown>
}

export interface AuditEntry {
  /** the fleet view: which member it belongs to (null = the hub); absent outside it */
  member?: string | null
  member_name?: string
  vmid?: number | null
  timestamp: string
  action: string
  detail: string
}

export interface AuditLogResponse {
  /** GET …?fleet=1 on a hub: the members' rows were merged in, one entry per DCS in members */
  fleet?: boolean
  members?: FleetListMember[]
  entries: AuditEntry[]
  total: number
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  created_at: string
}

export interface WebhookListResponse {
  webhooks: Webhook[]
  total: number
}

export interface WebhookCreateResponse {
  success: boolean
  webhook: Webhook
}

export interface WebhookDeleteResponse {
  success: boolean
  deleted: string
}

export interface WebhookTestResponse {
  /** false when the hook did not answer 2xx (status_code 0: unreachable) */
  success: boolean
  status_code: number
  url: string
  timestamp: string
  /** 4.0.5: one sentence about the answer, for the toast (an older API leaves it out) */
  message?: string
}

// POST /images/pull
export interface ImagePullResponse {
  success: boolean
  image: string
  message: string
}

// Dashboard Layout (24-column free-placement grid, 50px row height)
export interface DashboardCard {
  id: string
  visible: boolean
  x: number   // column start (0-based, 0-23)
  y: number   // row start (0-based, each row = 50px)
  w: number   // width in columns
  h: number   // height in row units (× 50px)
}

export interface DashboardLayout {
  /** Epoch ms of the last save; the newer copy wins between cache and server */
  updated_at?: number
  cards: DashboardCard[]
  labels: Record<string, string>  // card ID → custom title (for dividers)
  /** Per-card settings (quick actions, spotlight picks, notes text…), keyed by card ID */
  config?: Record<string, unknown>
  version: number
}

// Keep DashboardCardSize for backwards compat with any references
export type DashboardCardSize = 'small' | 'medium' | 'large' | 'full'

// Plugin Cards
export interface PluginCardMeta {
  id: string
  title: string
  icon: string
  defaultW: number
  defaultH: number
  description: string
  plugin: string
  author?: string
  version?: string
  /** Seconds between reloads of the card (0 = never) */
  refreshInterval?: number
  // Size constraints (omit for free resizing)
  minW?: number
  minH?: number
  maxW?: number
  maxH?: number
  // Behavior
  isScrollable?: boolean
  dataEndpoint?: string | null
}

export interface PluginCardsResponse {
  cards: PluginCardMeta[]
  total: number
}

export interface DashboardLayoutResponse {
  layout: DashboardLayout
}

// TOTP Two-Factor Authentication
export interface TotpSetupResponse { secret: string; uri: string; message: string }
export interface TotpVerifyResponse { success: boolean; message: string }
export interface TotpValidateResponse { success: boolean; token?: string; username?: string; role?: string }


// =============================================================================
// CrowdSec (the CrowdSec page; the API lives in .lib/crowdsec.sh and .lib/crowdsec-config.sh)
// =============================================================================

/** One active ban (GET /crowdsec/decisions). `ip` and `since` are the older names of `value` and `created_at`. */
export interface CrowdSecDecision {
  ip: string
  value?: string
  id?: number
  scope?: 'Ip' | 'Range' | string
  scenario?: string
  origin?: string
  duration?: string
  type?: string
  since?: string
  country?: string
  simulated?: boolean
  /** seconds left when the answer was made; `expires_at` (ISO) is the fixed point for a live countdown */
  seconds_left?: number
  expires_at?: string
  /** a ban of a year or more: DCS bans "for ever" as ten years */
  permanent?: boolean
  created_at?: string
  alert_id?: number
  events?: number
  as_number?: string
  as_name?: string
  latitude?: number | null
  longitude?: number | null
  machine?: string
  kind?: string
  /** plain words for what it is: Web probing, Manual ban, Community blocklist … */
  label?: string
  family?: 'bruteforce' | 'exploit' | 'probe' | 'manual' | 'community' | 'other'
}

export type CrowdSecState =
  | 'healthy' | 'not_deployed' | 'stopped' | 'crash_loop' | 'starting' | 'unhealthy' | 'lapi_unreachable' | 'docker_unavailable'

export interface CrowdSecFix {
  id: string
  label: string
  /** api: call `method path` with `body`; ui: the page goes somewhere (logs, deploy, hub …) */
  kind: 'api' | 'ui'
  method: string
  path: string
  body: unknown
  primary: boolean
}

export interface CrowdSecIssue {
  code: string
  severity: 'info' | 'warning' | 'error'
  title: string
  detail: string
  fix: CrowdSecFix | null
}

export interface CrowdSecTraefikInfo {
  present: boolean
  container?: string
  state?: string
  running?: boolean
  project?: string
  workdir?: string
}

export interface CrowdSecPreflight {
  docker: { ok: boolean; version: string }
  traefik: CrowdSecTraefikInfo
  template: { name: string; title: string; description: string; target_stack: string; variables: { name: string; label: string; description: string; default: string; required: boolean }[] } | null
  target_stack: string
  target_reason: string
  stacks: string[]
  discord: { configured: boolean }
  enforcement: boolean
  blockers: string[]
  warnings: string[]
  can_deploy: boolean
}

export interface CrowdSecCounts {
  decisions: number
  decisions_active: number
  simulated: number
  /** community blocklist entries CrowdSec holds (not listed on the page) */
  community: number
  alerts_24h: number
  machines: number
  bouncers: number
  collections: number
  scenarios: number
  parsers: number
  updates: number
  countries_24h: number
  sources_24h: number
}

export interface CrowdSecAcquisitionSource { name: string; reads: number; parsed: number; unparsed: number; pour: number }

export interface CrowdSecBouncerBrief { registered: boolean; name: string; last_pull?: string | null; type?: string; version?: string; ip_address?: string }

export interface CrowdSecMachine {
  id: string
  ip_address: string
  version: string
  validated: boolean
  last_push: string | null
  last_heartbeat: string | null
  os: string
  auth_type?: string
  datasources: Record<string, number>
}

/** GET /crowdsec/status — the state CrowdSec is in, and (when it is healthy) the numbers for the status strip. The first four fields are the ones the dashboard card has always used. */
export interface CrowdSecStatusResponse {
  installed: boolean
  running: boolean
  container?: string
  message?: string
  client_ip?: string
  client_banned?: boolean
  trusted?: string[]
  whitelist?: { synced_at?: string; public_ip?: string; file?: string; addresses?: string[]; reloaded?: boolean }
  decisions?: CrowdSecDecision[]
  decision_count?: number
  /** absent on a DCS older than the CrowdSec page */
  state?: CrowdSecState
  title?: string
  detail?: string
  fixes?: CrowdSecFix[]
  issues?: CrowdSecIssue[]
  deployed?: boolean
  container_state?: string
  health?: string
  image?: string
  restart_count?: number
  exit_code?: number
  started_at?: string
  stack?: string | null
  defined_in?: string | null
  docker?: { ok: boolean; version: string }
  traefik?: CrowdSecTraefikInfo
  version?: string
  version_number?: string
  log_tail?: string[]
  preflight?: CrowdSecPreflight | null
  generated_at?: number
  allowlist_mechanism?: 'native' | 'parser' | 'unknown'
  features?: { allowlists: boolean; decisions_import: boolean; simulation: boolean }
  counts?: CrowdSecCounts
  bouncer?: CrowdSecBouncerBrief
  bouncers?: CrowdSecBouncerRow[]
  machines?: CrowdSecMachine[]
  acquisition?: { sources: CrowdSecAcquisitionSource[]; reads: number; parsed: number; unparsed: number; parse_rate: number | null }
  enforcement?: CrowdSecEnforcement
}

/** What Traefik's own files say about the CrowdSec bouncer plugin */
export interface CrowdSecPluginState {
  /** the plugin is declared in Traefik's static configuration */
  declared: boolean
  name: string
  version: string
  module: string
  traefik_running: boolean
  /** Traefik has started since the plugin was declared (null: not known) */
  loaded: boolean | null
  mode: string | null
  /** the CrowdSec page saved these settings (a marker line in the middleware file) */
  managed: boolean
  key_present: boolean
  settings: Record<string, unknown>
}
export interface CrowdSecEnforcement {
  routes_dir: string
  middleware_file: string
  middleware_present: boolean
  middleware_mtime?: number
  in_chain: boolean
  chain_file?: string
  plugin?: CrowdSecPluginState
}

/** The plugin's own settings (the safe subset the page edits) */
export interface CrowdSecPluginSettings {
  mode: 'live' | 'stream'
  update_interval: number
  default_decision_seconds: number
  http_timeout: number
  remediation_status_code: number
  log_level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  trust_home: boolean
  client_trusted_ips: string[]
  forwarded_headers_trusted_ips: string[]
}
/** GET /crowdsec/plugin (and the answer of the PUT) */
export interface CrowdSecPluginResponse {
  available: boolean
  reason?: string
  file?: string
  managed?: boolean
  plugin: CrowdSecPluginState
  settings?: CrowdSecPluginSettings
  defaults?: CrowdSecPluginSettings
  limits?: { update_interval: [number, number]; default_decision_seconds: [number, number]; http_timeout: [number, number]; remediation_status_code: [number, number]; list_max: number; forwarded_max: number }
  lan?: string
  home?: string
  backups?: { name: string; created_at: string; size: number }[]
  help?: Record<'mode' | 'update_interval' | 'default_decision_seconds' | 'http_timeout' | 'remediation_status_code' | 'log_level' | 'client_trusted_ips' | 'forwarded_headers_trusted_ips', string>
  success?: boolean
  applied?: { changed: boolean; message: string; backup: string | null }
}

export interface CrowdSecFacet { value: string; count: number; label?: string }

/** GET /crowdsec/decisions */
export interface CrowdSecDecisionsResponse {
  decisions: CrowdSecDecision[]
  count: number
  total: number
  offset: number
  limit: number
  as_of: number
  truncated: boolean
  community: number
  facets: {
    origins: CrowdSecFacet[]
    scenarios: CrowdSecFacet[]
    countries: CrowdSecFacet[]
    types: CrowdSecFacet[]
    scopes: CrowdSecFacet[]
    unknown_country: number
  }
}

export interface CrowdSecDecisionQuery {
  q?: string
  scope?: 'ip' | 'range' | ''
  origin?: string
  type?: string
  country?: string
  scenario?: string
  simulated?: 'any' | 'yes' | 'no'
  sort?: 'created' | 'expires' | 'value' | 'country' | 'scenario' | 'origin'
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface CrowdSecBanBody { value: string; duration?: string; permanent?: boolean; reason?: string }
export interface CrowdSecBanResponse {
  success: boolean
  value: string
  scope: 'Ip' | 'Range'
  duration: string
  reason: string
  permanent: boolean
  replaced: number
  expires_at: string
  message: string
}
export interface CrowdSecUnbanResponse { success: boolean; ip: string; value: string; scope: string; deleted: number; message: string }
export interface CrowdSecBulkDeleteResponse {
  success: boolean
  requested: number
  deleted: number
  failed: number
  results: { id?: number | string; value?: string; ok: boolean; deleted: number; error?: string }[]
}
export interface CrowdSecImportResponse {
  success: boolean
  format: string
  total: number
  imported: number
  skipped: number
  allowlisted: number
  skipped_entries: { line: number; value: string; reason: string; message: string }[]
  error: string | null
}
export interface CrowdSecExportResponse { format: 'csv' | 'json'; filename: string; count: number; content: string; generated_at: number }

export interface CrowdSecAlertSource {
  value: string
  ip: string
  scope: string
  range: string
  country: string
  as_number: string
  as_name: string
  latitude: number | null
  longitude: number | null
}
export interface CrowdSecAlert {
  id: number
  scenario: string
  message: string
  events_count: number
  created_at: string
  start_at: string
  stop_at: string
  machine: string
  kind: string
  simulated: boolean
  remediation: boolean
  capacity: number
  leakspeed: string
  source: CrowdSecAlertSource
  decisions: { id: number; type: string; value: string; scope: string; origin: string; duration: string; simulated: boolean }[]
  label: string
  family: 'bruteforce' | 'exploit' | 'probe' | 'manual' | 'other'
  banned: boolean
}
export interface CrowdSecAlertsResponse {
  alerts: CrowdSecAlert[]
  count: number
  total: number
  window: string
  offset: number
  limit: number
  as_of: number
  retention_days: number
  facets: { scenarios: CrowdSecFacet[]; countries: CrowdSecFacet[]; unknown_country: number }
}
export interface CrowdSecAlertDetail extends Omit<CrowdSecAlert, 'banned'> {
  uuid: string
  meta: { key: string; value: string }[]
  context: Record<string, unknown>
  events: { timestamp: string; fields: Record<string, string> }[]
}

export interface CrowdSecAllowEntry {
  value: string
  kind: 'ip' | 'range'
  comment: string
  created_at: string
  expires_at: string | null
  list: string | null
  source: 'managed' | 'env' | 'allowlist' | 'other' | 'trusted'
  managed: boolean
  removable: boolean
}
export interface CrowdSecAllowlistResponse {
  mechanism: 'native' | 'parser'
  list_name: string | null
  supports_expiry: boolean
  note: string
  entries: CrowdSecAllowEntry[]
  lists: { name: string; description: string; items: number; created_at: string; updated_at: string }[]
  count: number
  client_ip: string
  home: { public_ip: string; synced_at: string | null }
}
export interface CrowdSecAllowAddBody { value: string; comment?: string; expires?: string }
export interface CrowdSecAllowAddResponse { success: boolean; value: string; kind: 'ip' | 'range'; mechanism: string; comment: string; expires_at: string | null; removed_bans: number; message: string }

export interface CrowdSecBouncerRow {
  name: string
  type: string
  version: string
  ip_address: string
  last_pull: string | null
  created_at: string
  revoked: boolean
  auto_created?: boolean
  dcs?: boolean
  status?: 'active' | 'idle' | 'never' | 'revoked'
}
export interface CrowdSecBouncersResponse {
  bouncers: CrowdSecBouncerRow[]
  count: number
  dcs_bouncer: CrowdSecBouncerRow | null
  name: string
  enforcement: CrowdSecEnforcement
  traefik: CrowdSecTraefikInfo
  traefik_registerable: boolean
}
export interface CrowdSecMachinesResponse { machines: CrowdSecMachine[]; count: number }
export interface CrowdSecBouncerAddResponse { success: boolean; name: string; api_key: string; shown_once: boolean; message: string }

export interface CrowdSecMetricsResponse {
  window: '24h' | '7d' | '30d'
  since: number
  retention_days: number
  window_supported: boolean
  totals: { alerts: number; events: number; sources: number; countries: number; scenarios: number; banned_now: number; manual: number }
  bucket_seconds: number
  timeline: { t: number; alerts: number; events: number }[]
  scenarios: { scenario: string; label: string; family: string; alerts: number; events: number; sources: number }[]
  countries: { code: string; alerts: number; events: number; sources: number }[]
  unknown_country: number
  sources: { value: string; country: string; as_number: string; as_name: string; alerts: number; events: number; last_seen: number; scenarios: string[]; banned: boolean }[]
  networks: { as_number: string; as_name: string; alerts: number; sources: number }[]
  bans_by_country: { code: string; count: number }[]
  map_points: { lat: number; lon: number; country: string; alerts: number; sources: number }[]
  acquisition: { source: string; reads: number; parsed: number; unparsed: number; poured: number }[]
  parsers: { name: string; hits: number; parsed: number; unparsed: number }[]
  decisions_by_origin: { origin: string; count: number }[]
  lapi_requests: number
  as_of: number
}

export interface CrowdSecHubItem { name: string; version: string; description: string; status: string; enabled: boolean; update: boolean; tainted: boolean; local: boolean }
export interface CrowdSecHubResponse {
  installed: { collections: CrowdSecHubItem[]; scenarios: CrowdSecHubItem[]; parsers: CrowdSecHubItem[] }
  counts: { collections: number; scenarios: number; parsers: number; updates: number }
  suggestions: { name: string; group: string; title: string; description: string; installed: boolean }[]
}
export interface CrowdSecHubAvailableResponse {
  type: 'collections' | 'scenarios' | 'parsers'
  items: { name: string; description: string; version: string; installed: boolean; update: boolean }[]
  count: number
  total: number
}

export interface CrowdSecLogLine { time: string; level: 'info' | 'warn' | 'error' | 'debug' | string; module: string; message: string }
export interface CrowdSecLogsResponse { container: string; state: string; lines: CrowdSecLogLine[]; count: number; lapi_included: boolean }

export interface CrowdSecSimulationResponse {
  global: boolean
  exclusions: string[]
  scenarios: { name: string; description: string; simulated: boolean }[]
  simulated_count: number
  note: string
}

export interface CrowdSecCommunityResponse {
  capi: { registered: boolean; reachable: boolean; sharing: boolean; pulling: boolean; console_blocklists: boolean; error: string | null }
  console: { authenticated: boolean; enrolled: boolean; registered: boolean; decision_management: boolean; plan: string; sharing: Record<string, boolean> }
  community_decisions: number
  note: string
}

/** The ban profile: how long CrowdSec bans by itself */
export interface CrowdSecProfileSettings {
  duration: string
  range_duration: string
  escalate: { enabled: boolean; max: string }
  overrides: { pattern: string; duration: string }[]
}
export interface CrowdSecSettingsResponse {
  mode: 'dcs' | 'stock' | 'custom' | 'missing'
  editable: boolean
  custom: boolean
  profile: CrowdSecProfileSettings
  manual_duration: string
  defaults: CrowdSecProfileSettings
  presets: string[]
  limits: { auto_max: string; manual_max: string; overrides_max: number }
  live: { file: string; profiles: string[]; notified: boolean; escalate: boolean; ip_duration: string | null; range_duration: string | null }
  drift: boolean
  backups: { name: string; kind: string; created_at: string; size: number }[]
  raw: string | null
  retention_days: number
  help: { duration: string; escalate: string; overrides: string }
  success?: boolean
  applied?: { changed: boolean; message: string; backup: string | null }
}
export interface CrowdSecSettingsBody { profile?: Partial<Omit<CrowdSecProfileSettings, 'escalate'>> & { escalate?: Partial<CrowdSecProfileSettings['escalate']> }; manual_duration?: string; take_over?: boolean }

export interface CrowdSecMessageField { name: string; value: string; inline: boolean }
export interface CrowdSecNotifySettings {
  v: number
  enabled: boolean
  webhook: { mode: 'global' | 'custom' | 'keep' }
  identity: { name: string; avatar_url: string }
  embed: { color_mode: 'auto' | 'fixed'; color: string }
  mention: { mode: 'none' | 'role' | 'user' | 'here' | 'everyone'; id: string; text: string }
  events: { bans: boolean; simulated: boolean; detect_only: boolean }
  filters: { min_events: number; only: string[]; ignore: string[] }
  delivery: { group_wait: number; group_threshold: number; max_retry: number; timeout: number }
  message: { title: string; description: string; footer: string; link: string; timestamp: boolean; fields: CrowdSecMessageField[] }
}
export interface CrowdSecPlaceholder { name: string; group: string; label: string; example: string; description: string }
export interface CrowdSecWebhookView {
  mode: 'global' | 'custom' | 'keep'
  configured: boolean
  masked: string | null
  sources: Record<'global' | 'custom' | 'keep', { configured: boolean; masked: string | null }>
}
export interface CrowdSecNotifyResponse {
  settings: CrowdSecNotifySettings
  webhook: CrowdSecWebhookView
  defaults: CrowdSecNotifySettings
  placeholders: CrowdSecPlaceholder[]
  samples: string[]
  state: { enabled: boolean; wired: boolean; plugin_active: boolean; file: 'dcs' | 'other' | 'missing'; profile_mode: string; drift: boolean; working: boolean }
  status: {
    last_test: { at: number; ok: boolean; http: number; message: string; sample: string } | null
    last_apply: { at: number; ok: boolean; message: string } | null
    delivery_errors: { time: string; message: string }[]
    note: string
  }
  limits: { title: number; description: number; footer: number; fields: number; group_threshold_max: number }
  info: { unban: string }
  success?: boolean
  applied?: { changed: boolean; message: string }
}
export interface CrowdSecNotifyBody { settings?: DeepPartial<CrowdSecNotifySettings>; webhook_url?: string; clear_custom_webhook?: boolean; take_over?: boolean }
export interface CrowdSecPreviewResponse {
  valid: boolean
  error?: string
  sample?: string
  payload: DiscordWebhookPayload | null
  alert?: { id: number; scenario: string }
}
export interface DiscordEmbedField { name: string; value: string; inline?: boolean }
export interface DiscordEmbed { title?: string; description?: string; url?: string; color?: number; fields?: DiscordEmbedField[]; footer?: { text: string }; timestamp?: string }
export interface DiscordWebhookPayload { username?: string; avatar_url?: string; content?: string; allowed_mentions?: Record<string, unknown>; embeds: DiscordEmbed[] }
export interface CrowdSecNotifyTestResponse { success: boolean; delivered: boolean; http: number; message: string; sample: string; at: number; webhook: string }
export interface CrowdSecServiceResponse { success: boolean; action: string; state: string; message: string }
export interface CrowdSecHubChangeResponse { success: boolean; action?: string; type?: string; name?: string; message: string; detail?: string }
export interface CrowdSecSimulationSetResponse { success: boolean; global: boolean; exclusions: string[]; message: string }

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }

// TLS state of the reverse proxy (GET /routes/certificates)
export interface RouteCertificate {
  resolver: string
  domain: string
  sans: string[]
  not_after: string
  days_left: number
}
export interface RouteCertificatesResponse {
  traefik_stack: string
  active: boolean
  /** Domain the routes are built on (empty or example.com = not configured) */
  domain?: string
  /** Live probe of every route through Traefik (dry run of proxy-reconcile) */
  probe?: { routes: number; passing: number; skipped_target_down: number; dead: string[]; backend_down: string[] } | null
  /** Last Traefik errors and warnings from its log */
  log?: string[]
  challenge: 'dns' | 'http' | 'none' | 'unknown'
  email: string
  token_set: boolean
  acme_file: { exists: boolean; mode: string; mode_ok: boolean }
  certificates: RouteCertificate[]
  errors: string[]
  hints: string[]
  checked_at?: string
}

// POST /containers/{name}/sablier
export interface SablierToggleResponse {
  container: string
  enabled: boolean
  middleware: string
  route_file: string
  traefik_restarted: boolean
  /** the settings written (3.9.4) */
  session?: string
  theme?: string
  display_name?: string
  show_details?: boolean
  message?: string
}

// GET /containers/{name}/theme (3.9.5) — a theme.park theme on the container's pages
export interface ContainerThemeState {
  container: string
  /** the VM it runs in when the hub answered for one (null = this server) */
  member: string | null
  /** theme.park has themes for this app */
  supported: boolean
  /** theme.park's name for the app ("sonarr") */
  app: string
  /** a Traefik route serves it: the theme reaches the pages through that route */
  routed: boolean
  host: string
  /** a Traefik runs where the theme is applied (this server, or the hub for a VM) */
  traefik: boolean
  enabled: boolean
  theme: string
  addons: string[]
  /** DCS wrote the theme (false: a theme.park middleware written by hand in the route) */
  managed?: boolean
  /** the middleware that carries the theme now */
  middleware?: string
  /** theme.park middlewares written by hand on the route (they give way to DCS's theme) */
  foreign?: { middleware: string; theme: string; addons: string[] }[]
  /** the name this Traefik knows the theme.park plugin by ("theme-park", "themepark"; "" when undeclared) */
  plugin?: string
  catalog: {
    themes: string[]
    community: string[]
    /** the add-ons theme.park has for this app */
    addons: string[]
  }
  /** why it cannot be themed, when it cannot */
  reason: string
}

export interface ContainerThemeResponse extends ContainerThemeState {
  success: boolean
  traefik_restarted: boolean
  message: string
}

// GET /containers/{name}/homarr (3.9.5) — is the container on the Homarr dashboard
export interface ContainerHomarrState {
  container: string
  /** the VM it runs in when the hub answered for one (null = this server) */
  member: string | null
  homarr: {
    /** Homarr is deployed on this server (the hub, in a fleet) */
    active: boolean
    /** board: an API key is stored (app + tile); library: the app library only */
    mode: 'board' | 'library' | 'none'
    has_api_key: boolean
  }
  /** what DCS would put on Homarr */
  target: {
    url: string
    /** route: its HTTPS route; port: a published port; "": nothing to open */
    source: 'route' | 'port' | ''
    host: string
    name: string
    icon: string
    description: string
    template: string
  }
  added: boolean
  app: { id: string; name: string; href: string } | null
  /** why it cannot be added, when it cannot */
  reason: string
}

export interface ContainerHomarrAddResponse extends ContainerHomarrState {
  success: boolean
  already: boolean
  result?: { mode: 'board' | 'library'; app_id: string; tile: boolean }
  message: string
}

// GET /containers/{name}/sablier (3.9.4) — the current on-demand settings
export interface SablierSettingsResponse {
  container: string
  enabled: boolean
  middleware: string
  /** idle time before Sablier stops it, Go duration ("30m") */
  session: string
  /** waiting page: ghost, shuffle, hacker-terminal, matrix */
  theme: string
  display_name: string
  show_details: boolean
  /** a Traefik route points at the container (on-demand needs one) */
  traefik_routed: boolean
  sablier_deployed: boolean
  route_file: string
  /** a hand-written Sablier block wakes it together with other containers (never changed here) */
  group?: boolean
}

// =============================================================================
// Proxmox (3.8) — GET /proxmox/*, POST /proxmox/vms/:node/:type/:vmid/:action
// =============================================================================

export interface ProxmoxStatus {
  configured: boolean
  reachable: boolean
  url: string
  token_id: string
  verify_tls: boolean
  node_filter: string
  version: string
  release: string
  nodes: number
  nodes_online: number
  vms: { total: number; running: number; stopped: number; qemu: number; lxc: number }
  error: string
  hints: string[]
}

export interface ProxmoxNode {
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  mem_pct: number
  disk: number
  maxdisk: number
  disk_pct: number
  uptime: number
  level: string
}

export interface ProxmoxNodesResponse { total: number; nodes: ProxmoxNode[] }

export type ProxmoxGuestType = 'qemu' | 'lxc'
export type ProxmoxVmAction = 'start' | 'shutdown' | 'stop' | 'reboot' | 'reset' | 'suspend' | 'resume'

export interface ProxmoxVm {
  vmid: number
  name: string
  type: ProxmoxGuestType
  node: string
  status: string
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  mem_pct: number
  disk: number
  maxdisk: number
  uptime: number
  tags: string[]
  lock: string
  hastate: string
  /** DCS asked for the last change within five minutes */
  intended: boolean
}

export interface ProxmoxVmsResponse { total: number; running: number; stopped: number; vms: ProxmoxVm[] }

export interface ProxmoxVmDetail {
  vmid: number
  node: string
  type: ProxmoxGuestType
  name: string
  status: string
  qmpstatus: string
  uptime: number
  cpu: number
  cpus: number
  mem: number
  maxmem: number
  disk: number
  maxdisk: number
  /** the balloon floor in MiB — the API emits the VM's config value as is (and divides the live figure down to it);
   *  0 = no balloon device, so `mem` is the host's view of the whole allocation (page cache included) */
  balloon: number
  /** what the guest itself reports through its balloon driver, in bytes (0 when there is no device or the guest has not answered yet) */
  guest_mem_free: number
  guest_mem_total: number
  netin: number
  netout: number
  diskread: number
  diskwrite: number
  agent: string
  lock: string
  /** the operating system the guest reports through the guest agent (null: no agent, or the VM is off) */
  os: { name: string; id: string; version: string; kernel: string; arch: string } | null
  /** the image the hub built the VM from (null: not built by DCS, or before DCS recorded it) */
  image: { id: string; label: string; kind: string; template_vmid: number | null } | null
  config: { bios?: string; machine?: string; args?: string; created?: number | null; cores: number | null; sockets: number | null; memory: number | null; ostype: string; onboot: string; description: string; tags: string; net0: string; bootdisk: string; hostname: string }
}

export interface ProxmoxTask {
  upid: string
  node: string
  type: string
  id: string
  user: string
  status: string
  starttime: number
  endtime: number
}

export interface ProxmoxTasksResponse { tasks: ProxmoxTask[] }

export interface ProxmoxActionResponse {
  success: boolean
  action: ProxmoxVmAction
  upid: string
  node: string
  type: ProxmoxGuestType
  vmid: number
  name: string
  message: string
}

/** POST /proxmox/vms/:node/qemu/:vmid/balloon — the balloon floor and the VM's memory, both in MB; it takes effect at the next boot */
export interface ProxmoxBalloonResponse {
  success: boolean
  action: 'balloon'
  vmid: number
  balloon: number
  memory: number
  message: string
}

// =============================================================================
// Traefik feed (3.8) — GET /traefik/feed/status, POST /traefik/feed/token
// =============================================================================

export interface TraefikFeedStatus {
  enabled: boolean
  ready: boolean
  token: string
  target_host: string
  detected_host: string
  entrypoint: string
  middlewares: string
  tls: boolean
  cert_resolver: string
  routes: number
  /** Routes merged in from fleet members (3.9) */
  member_routes?: number
  members?: number
  skipped: { service: string; reason: string }[]
  routes_dir: string
  local_traefik: boolean
  last_poll: number
  last_client: string
  endpoint_url: string
  snippet: string
}

export interface TraefikFeedTokenResponse { success: boolean; token: string }

// =============================================================================
// Fleet (3.9): a hub and the DCS installs in the other VMs (members)
// =============================================================================

export type FleetRole = 'hub' | 'member' | 'standalone'

/** What a member remembers about the hub it joined */
export interface FleetHubLink {
  url: string
  name: string
  version: string
  member_id: string
  member_name: string
  vmid: number | null
  node: string | null
  matched_by: string | null
  username: string
  joined_at: number
}

/** GET /fleet/status */
export interface FleetStatus {
  role: FleetRole
  members: number
  hub: FleetHubLink | null
  join_tokens: number
  /** A join saved by setup.sh before the first admin existed */
  pending_join: { hub_url: string; name: string } | null
  /** How other machines reach this API */
  self_url: string
  scan_ports: string
  proxmox_linked: boolean
  hostname: string
  server_name: string
  version: string
  hub_account: string
  /** What this installation is: the full DCS (hub, the default; a standalone server is a hub without members) or the API alone (node) */
  dcs_role?: 'hub' | 'node'
}

export interface FleetIdentity {
  hostname: string
  product_uuid: string
  ips: string[]
  api_port: number
  version: string
  server_name: string
  os: string
  virt: string
  /** false for an API-only DCS (a member the hub built): it serves no dashboard of its own */
  dashboard?: boolean
  /** node: the API alone, no dashboard, no accounts of its own (the hub's is the only one); hub: the full DCS */
  role?: 'hub' | 'node'
}

export type FleetMatchedBy = 'uuid' | 'ip' | 'name' | 'manual' | 'provision'

export interface FleetMember {
  id: string
  name: string
  url: string
  username: string
  role: string
  source: 'join' | 'manual'
  added_by: string
  added_at: number
  vmid: number | null
  node: string | null
  type: ProxmoxGuestType | null
  matched_by: FleetMatchedBy | null
  insecure: boolean
  identity: Partial<FleetIdentity>
  version: string
  last_seen: number
  reachable: boolean
  last_error: string
  /** The stacks this member runs (the VM's stack, usually one) */
  stacks?: string[]
  /** The hub built this VM */
  provisioned?: boolean
}

/** A member without its stack-name list: what the sheets and menus need */
export type FleetMemberBase = Omit<FleetMember, 'stacks'>
export interface FleetMembersResponse { total: number; members: FleetMember[] }
export interface FleetMemberResponse { success: boolean; member: FleetMember }

/** A member as GET /fleet/overview reports it, with what it answered just now */
export interface FleetMemberLive extends FleetMemberBase {
  error: string
  stacks: StackInfo[]
  stacks_total: number
  containers_running: number
  containers_total: number
  /** the VM's own Docker counts (from its /status; older hubs do not send them) */
  images?: number
  networks?: number
  volumes?: number
  /** the member's containers as of the last snapshot (the VM card lists them) */
  containers?: ContainerInfo[]
}

export interface FleetOverview {
  hub: { version: string; name: string; hostname: string }
  members: FleetMemberLive[]
  /** images, networks and volumes are the VMs' Docker counts added up (hubs before 3.9.10 do not send them) */
  totals: { members: number; reachable: number; stacks: number; containers_running: number; containers_total: number; images?: number; networks?: number; volumes?: number }
}

/** One guest as the scan saw it */
export interface FleetGuestScan {
  node: string
  type: ProxmoxGuestType
  vmid: number
  name: string
  status: string
  ips: string[]
  /** A DCS API answered at this address */
  dcs: { ip: string; port: number; version: string; url: string } | null
  /** The member already mapped to this guest */
  member: { id: string; name: string; url: string } | null
}

export interface FleetDiscoverResponse { scanned: number; found: number; guests: FleetGuestScan[]; error?: string }

export interface FleetJoinToken {
  token: string
  created_at: number
  expires_at: number
  created_by: string
  uses: number
  /** curl -fsSL '<hub>/fleet/bootstrap?token=<code>' | bash — installs DCS as a node of this hub on any VM and joins it */
  node_command?: string
}
export interface FleetJoinTokensResponse { hub_url: string; tokens: FleetJoinToken[] }
export interface FleetJoinTokenResponse {
  success: boolean
  token: string
  expires_at: number
  ttl_hours: number
  hub_url: string
  /** curl -fsSL '<hub>/fleet/bootstrap?token=<code>' | bash — the one line for a node */
  node_command: string
  /** DCS_HUB_URL=… DCS_JOIN_TOKEN=… ./setup.sh */
  command: string
  /** ./setup.sh --join <hub> <code> */
  join_command: string
}

export interface FleetMatch { node: string; type: ProxmoxGuestType; vmid: number; name: string; matched_by: FleetMatchedBy }
export interface FleetMemberTestResponse { reachable: boolean; error: string; identity: Partial<FleetIdentity>; version: string; match: FleetMatch | null }

export interface FleetJoinHubResponse { success: boolean; member: FleetMember; hub: { name: string; version: string; url: string } }
export interface FleetLeaveResponse { success: boolean; hub_url: string; hint: string }

/** POST /stacks/:name/push — the hub's Stacks/<name>/ into the VM that runs it (`pushed` = files the VM took) */
export interface StackPushResponse { success: boolean; stack: string; member: string; member_name: string; pushed: number; message: string }
/** POST /stacks/:name/pull — the VM's files into the hub's Stacks/<name>/, file for file (the copy replaced is kept in the compose history) */
export interface StackPullResponse { success: boolean; stack: string; member: string; member_name: string; written: number; removed: number; message: string }
/** GET /feed/status — the dashboard feed: a read-only token for dashboards that cannot sign in */
export interface DashboardFeedStatus { enabled: boolean; summary_url: string; crowdsec_url: string; auth: string }
/** One API key as GET /auth/keys lists it (the key itself is only in the answer that made it) */
export interface ApiKeyInfo { id: string; name: string; role: 'read' | 'operate'; prefix: string; created_at: number; created_by: string; expires_at: number; last_used_at: number; expired: boolean }
/** POST /auth/keys — the key, shown once */
export interface ApiKeyCreated { success: boolean; id: string; name: string; role: 'read' | 'operate'; key: string; expires_at: number; message: string }
/** GET /ssh/access — what the ssh sheet needs */
export interface SshVm { id: string; name: string; vmid: number | null; address: string; reachable: boolean }
export interface SshKeyInfo { id: string; name: string; owner: string; created_at: number; fingerprint: string; members: string[]; hub: boolean }
export interface SshAccess { vms: SshVm[]; keys: SshKeyInfo[]; hub: { host: string; user: string; port: number }; vm_user: string }
/** POST /ssh/keys — the key, shown once */
export interface SshKeyCreated {
  success: boolean; id: string; name: string; private_key: string; public_key: string; fingerprint: string
  results: { id: string; name: string; ok: boolean; error: string }[]
  hub_access: boolean; config: string; key_file: string; config_file: string; message: string
}
/** GET /terminal/web — the web terminal: a real terminal on the server in a browser tab, always behind Authelia */
export interface WebTerminalStatus {
  deployed: boolean; stack: string; state: string; running: boolean; url: string; protected: boolean; key_installed: boolean
  /** the pages that may show the terminal in a frame (a Homarr card); missing on a server before 4.0.16 */
  embed_origins?: string[]
  user: string; ssh_port: number; theme: Record<string, string>; font_size: number
  requirements: { traefik_domain: boolean; authelia: boolean; ssh_keygen: boolean }
  ready: boolean; template: string; service: string; default_stack: string
}
/** One step of sharing or removing a host folder (GET /fleet/members/:id/folders?op=1) */
export interface HostFolderStep { id: string; label: string; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; detail: string }
/** The steps under way for a VM's host folders, or the last ones */
export interface HostFolderOperation {
  id: string
  action: 'add' | 'remove'
  folder: string
  state: 'running' | 'done' | 'failed'
  error: string
  note: string
  by?: string
  started_at: number
  updated_at: number
  finished_at?: number
  steps: HostFolderStep[]
}
/** A container of the VM that binds a host folder (from the hub's copy of the stack's compose file) */
export interface HostFolderUser { stack: string; service: string; source: string; target: string; readonly: boolean }
/** A folder of the Proxmox host a VM was given (a virtiofs device of the VM) */
export interface HostFolder {
  /** the mapping's name on Proxmox, and the tag the VM mounts */
  id: string
  slot: string
  /** the folder on the Proxmox host */
  host_path: string
  /** the device is on the VM's configuration and appears at its next full restart */
  pending: boolean
  /** the device goes away at the VM's next full restart */
  removing: boolean
  /** where the VM mounts it ('' = nowhere yet) */
  mount: string
  mounted: boolean
  in_fstab: boolean
  /** the running VM sees the device */
  in_vm: boolean
  readonly: boolean
  used_by: HostFolderUser[]
}
/** GET /fleet/members/:id/folders — the folders of the Proxmox host a VM of the fleet has, what the token may do, what can be shared */
export interface MemberFolders {
  member: string
  member_name: string
  /** false: not a Proxmox VM the hub knows (reason says why) */
  supported: boolean
  reason?: string
  vmid?: number
  node?: string
  vm_status?: string
  can?: { list: boolean; create: boolean; attach: boolean }
  missing?: string[]
  /** what to do when the token lacks a permission ('' = nothing) */
  hint?: string
  vm_reached?: boolean
  vm_sudo?: boolean
  restart_needed?: boolean
  /** the directory mappings Proxmox has for the VM's node */
  mappings: { id: string; path: string; description: string }[]
  /** starting points for a path: the host's directory storages and ZFS pools */
  suggestions: string[]
  stacks?: string[]
  /** the services of each of the VM's stacks */
  services?: Record<string, string[]>
  folders: HostFolder[]
  operation: HostFolderOperation | null
}
/** GET /stacks/:name/appdata — where a stack's App-Data is. A VM's stack on a hub: Stacks/<name>/VM-App-Data on the hub is a live view of the VM's App-Data (a mount over the hub's ssh key), with whether it is mounted and why not */
export interface StackAppDataStatus {
  stack: string
  /** local: this server runs the stack; vm: a VM of the fleet does */
  placement: 'local' | 'vm'
  /** local: the App-Data folder here; vm: the link on the hub, absolute */
  path?: string
  exists?: boolean
  member?: string
  member_name?: string
  /** false: FLEET_APPDATA_MOUNT=false in the hub's .env */
  enabled?: boolean
  state?: 'mounted' | 'waiting' | 'unavailable' | 'held' | 'off'
  mounted?: boolean
  /** unmounted on purpose: it stays down until Mount */
  held?: boolean
  /** sshfs is installed on the hub */
  sshfs?: boolean
  /** Stacks/<name>/VM-App-Data */
  link?: string
  mountpoint?: string
  /** user@address:/folder — the folder in the VM */
  remote?: string
  /** root (the VM's account has passwordless sudo) or account */
  access?: string
  reason?: string
  success?: boolean
  message?: string
}
/** POST /fleet/members/:id/sync — the files of every stack a member runs, pulled into the hub (or pushed into the VM) */
export interface FleetMemberSyncResponse {
  success: boolean
  member: string
  direction: 'pull' | 'push'
  stacks: { name: string; files: number }[]
  failed: { name: string; error: string }[]
  message: string
}

/** GET /proxmox/capabilities — what the token may do */
export interface ProxmoxCapabilities {
  privileges: string[]
  can_power: boolean
  can_provision: boolean
  missing: string[]
  needed: string[]
  hint: string
}

export interface ProxmoxStorage {
  storage: string
  type: string
  content: string[]
  total: number
  used: number
  avail: number
  active: number
  images: boolean
  import_ready: boolean
  dir: boolean
}
export interface ProxmoxStorageResponse { node: string; storages: ProxmoxStorage[] }

/** GET /fleet/provision/defaults — prefilled values for creating VMs */
/** A cloud image the hub can have Proxmox download (cloud-init; apt or dnf inside) */
export interface FleetImage { id: string; label: string; url: string; file: string; family?: string; /** a purpose-built DCS image (vm-images/): nothing to bake */ prebuilt?: boolean; /** what its kernel drives (vm-images/images.json): whether a GPU or a USB device can be passed through */ hardware?: string }
/** A file already on a Proxmox storage: an imported cloud image, or an installer ISO */
export interface FleetStoredImage { volid: string; file: string; size: number; storage: string }
/** A DCS template the hub baked: VMs cloned from it build in about half a minute */
export interface FleetTemplate { vmid: number; node: string; image_id: string; image_file: string; family: string; name: string; baked_at: number; dcs_version: string }
export interface FleetTemplatesResponse { total: number; templates: FleetTemplate[] }

/** GET /fleet/versions — the hub's DCS version next to every member's (asked live) */
export interface FleetMemberVersion { id: string; name: string; vmid: number | null; url: string; /** the version recorded at join/last update */ recorded: string; version: string; reachable: boolean; /** answering, on another version than the hub */ behind: boolean }
export interface FleetUpdateResult { id: string; success: boolean; message: string; from?: string; to?: string; restart?: string }
/** one update round as GET /fleet/versions `last_round` keeps it: `running` while the members fetch the hub's code and
 *  re-execute (results empty, the counts 0), `done` afterwards, `aborted` when the hub went down in the middle of it;
 *  a hub before 4.0.4 sends no status (its rounds were always finished) */
export interface FleetUpdateRound {
  status?: 'running' | 'done' | 'aborted'
  at: number
  started_at?: number
  finished_at?: number
  /** the member ids a running round addresses */
  members?: string[]
  hub_version: string
  results: FleetUpdateResult[]
  updated: number
  failed: number
}
/** GET /system/docker-engine — the Docker Engine here and what its package source offers */
export interface DockerEngineStatus { status: 'idle' | 'running' | 'done' | 'failed'; started_at?: string; finished_at?: string; version?: string; exit_code?: number; output?: string; by?: string }
export interface DockerEngineInfo {
  version: string
  /** docker-ce (Docker's own packages), docker.io (Debian's), moby-engine (Fedora's), docker-arch (Arch Linux's) or unknown */
  source: string
  /** the newest version the package source offers ('' when unknown) */
  candidate: string
  /** the package source has not been asked yet (it is being asked in the background) */
  checking?: boolean
  candidate_checked_at?: number
  package_manager: string
  upgradable: boolean
  /** this API may update it unattended (root or passwordless sudo) */
  sudo_ready: boolean
  hostname: string
  /** Debian's docker.io with AppArmor 4: the dashboard and Traefik's socket proxy cannot spawn workers */
  apparmor_issue: boolean
  recommended: boolean
  switch_command: string
  note: string
  last_update: DockerEngineStatus
}
export interface DockerEngineMember extends DockerEngineInfo { id: string | null; name: string; vmid: number | null; reachable: boolean; error: string }
export interface DockerEngineFleet extends DockerEngineInfo { fleet: true; members: DockerEngineMember[]; upgradable_count: number; versions: string[] }
export interface DockerEngineUpdateResponse { success: boolean; status: string; message: string }
export interface FleetDockerEngineUpdateResponse { success: boolean; results: { id: string; success: boolean; message: string }[]; started: number; failed: number }

export interface FleetVersions { hub: { version: string }; members: FleetMemberVersion[]; behind: number; unreachable: number; /** a round is queued for after the hub's own restart */ pending: boolean; last_round: FleetUpdateRound | null; /** when the members were asked (epoch seconds) */ checked_at: number }
/** POST /fleet/update: the finished round — or 202 with `running: true` when it did not finish within the API's wait (a
 *  member's self-update takes minutes); the result then comes from GET /fleet/versions `last_round` once that is no longer running */
export interface FleetUpdateResponse extends FleetUpdateRound { success: boolean; running?: boolean; message?: string }
/** firewalld on the hub and the API port the VMs fetch DCS from and join on (certain: firewalld itself said; else read from the zone as shipped) */
export interface HubFirewall { active: boolean; port: number; zone: string; open: boolean | null; certain: boolean }

export interface FleetProvisionDefaults {
  proxmox_linked: boolean
  /** 3.9.7 */
  hub_firewall?: HubFirewall
  /** 3.9.7: the Proxmox node's size (0 when unknown) — the VM size choices stop there */
  capacity?: { cores: number; memory_gb: number }
  /** 3.9.7: the guests Proxmox already has (templates apart) — a stack cannot get a VM named like one of them */
  guests?: { name: string; vmid: number; type: string; node: string; status: string; /** what the guest is given: memory in GB, virtual CPUs */ maxmem_gb?: number; maxcpu?: number }[]
  /** 3.9.8: stacks with containers up on the hub — they stay on it (a build refuses them) */
  running_stacks?: string[]
  node: string
  storages: ProxmoxStorage[]
  /** what a VM can be built from: the catalogue (cloud images by URL), and what Proxmox already holds */
  images?: { catalogue: FleetImage[]; on_proxmox: { imports: FleetStoredImage[]; isos: FleetStoredImage[] }; templates?: FleetTemplate[] }
  storage: string
  image_storage: string
  bridge: string
  hub_ip: string
  cidr: number
  gateway: string
  dns: string
  ip_start: string
  image_url: string
  image_file: string
  admin_user: string
  tz: string
  hub_url: string
  proxy_domain: string
  vm_user: string
  defaults: { cores: number; memory_mb: number; disk_gb: number }
}

export interface FleetVmPlan { /** 4.0.21: the stack runs on the hub and goes into the VM with its folders, volumes and routes; the hub keeps its copy */ move?: boolean; stack: string; /** the hub's Stacks/<source> folder that moves into the VM (default: the stack name) */ source?: string; cores?: number; memory_mb?: number; disk_gb?: number; ip?: string; /** one of the hub's domains for its apps (default: the one for new VMs, else the hub's) */ domain?: string; /** per-VM operating system, one of: */ image?: string; image_url?: string; image_file?: string; iso?: string }
/** GET /fleet/provision/move-check — what moving a stack of the hub into a VM takes with it */
export interface FleetMoveCheck {
  stack: string; containers_up: number; data_kb: number; files: number
  folders: { name: string; kb: number; files: number }[]
  volumes: { name: string; volume: string; kb: number; files: number }[]
  routes: number; outside_paths: string[]; suggested_disk_gb: number; reads_as: string; note: string
  /** a VM of that name exists from an earlier try that did not finish: what to do about it */
  earlier_vm?: string | null
  /** false: something would be lost in a VM (a hub-only stack, a service that cannot move): blockers says what */
  movable?: boolean
  blockers?: string[]
  /** host devices its services use (/dev/dri …): the VM needs them passed through */
  devices?: string[]
  /** ports it publishes on the host: in the VM they open on the VM's address */
  ports?: { service: string; port: string; protocol: string }[]
  /** services that drive Docker through its socket: in the VM they see the VM's Docker */
  docker_socket?: string[]
  /** its settings that reach other stacks by container name, and other stacks' settings that reach it */
  links_out?: { file: string; name: string }[]
  links_in?: { stack: string; file: string; name: string }[]
  /** cpus: limits of its services, largest first; Docker refuses a limit above the VM's cores */
  cpu_limits?: { service: string; cpus: number }[]
  min_cores?: number
  /** its services' memory limits added up (MB) */
  memory_limits_mb?: number
}
export interface FleetProvisionRequest {
  node: string
  storage: string
  image_storage?: string
  bridge?: string
  cidr?: number
  gateway: string
  dns?: string
  ip_start?: string
  vms: FleetVmPlan[]
  /** the operating system for every VM of the request (a VM's own choice wins): a catalogue id, a URL, a file on the import storage, or an installer ISO */
  image?: string
  image_url?: string
  image_file?: string
  iso?: string
  /** bake a DCS template for the image first (once) — the builds then clone it */
  bake?: boolean
  /** clone the DCS template when one exists (the default) */
  from_template?: boolean
}
export interface FleetProvisionResponse { success: boolean; jobs: { id: string; stack: string; ip: string; /** the DCS template bake that runs ahead of the VMs */ bake?: boolean }[] }

export type FleetJobStepState = 'pending' | 'running' | 'done' | 'failed'
export interface FleetJobStep { id: string; label: string; hint: string; state: FleetJobStepState; detail: string }
export interface FleetJob {
  id: string
  stack: string
  /** build: a VM for a stack; bake: a DCS template other VMs clone */
  kind?: 'build' | 'bake'
  template_for?: string
  cloned_from?: number
  /** cloud: built and joined unattended; iso: the VM boots an installer, you install by hand and join */
  image_kind?: 'cloud' | 'iso'
  image_id?: string
  family?: string
  iso?: string
  /** an ISO build: done at the boot, closed by the VM's later join */
  manual?: boolean
  join_token?: string
  hub_url?: string
  status: 'queued' | 'running' | 'done' | 'failed'
  node: string
  storage: string
  image_storage: string
  bridge: string
  cidr: number
  gateway: string
  dns: string
  ip: string
  cores: number
  memory_mb: number
  disk_gb: number
  image_url: string
  image_file: string
  admin_user: string
  vmid: number | null
  member_id: string | null
  created_by: string
  created_at: number
  updated_at: number
  started_at: number | null
  finished_at: number | null
  error: string
  current: string
  log: { t: number; text: string }[]
  steps: FleetJobStep[]
}
export interface FleetJobsResponse { total: number; running: number; jobs: FleetJob[] }
export interface FleetJoinOutcome { joined: boolean; member?: FleetMember; hub?: { name: string; version: string; url: string }; hub_url?: string; error?: string }
