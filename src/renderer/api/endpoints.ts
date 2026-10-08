// =============================================================================
// API Endpoints — typed wrappers for all 24 REST API routes
// =============================================================================

import { apiClient } from './client'
import type {
  FleetVersions,
  FleetUpdateResponse,
  FleetImagesCheckResponse,
  FleetTemplatesResponse,
  APIRoot,
  APIVersion,
  ServerStatus,
  HealthReport,
  StackListResponse,
  StackDetail,
  StackContainersResponse,
  StackLogsResponse,
  StackActionResponse,
  StackUpdateResponse,
  StackCreateResponse,
  StackDeleteResponse,
  ImageListResponse,
  ContainerInfo,
  ContainerDetail,
  ContainerStats,
  ContainerActionResponse,
  ContainerLogsResponse,
  ServerConfig,
  ConfigUpdateResponse,
  ProxmoxStatus,
  ProxmoxNodesResponse,
  ProxmoxVmsResponse,
  ProxmoxVmDetail,
  ProxmoxTasksResponse,
  ProxmoxActionResponse,
  ProxmoxBalloonResponse,
  ProxmoxGuestType,
  ProxmoxVmAction,
  TraefikFeedStatus,
  TraefikFeedTokenResponse,
  FleetStatus, FleetMembersResponse, FleetMember, FleetMemberResponse, FleetOverview, FleetDiscoverResponse,
  FleetJoinTokensResponse, FleetJoinTokenResponse, FleetMemberTestResponse, FleetJoinHubResponse, FleetLeaveResponse,
  FleetMemberSyncResponse, StackPushResponse, StackPullResponse, StackAppDataStatus, MemberFolders, HostFolderOperation, DashboardFeedStatus, WebTerminalStatus, AutheliaSecondStep, AutheliaSecondStepResult, AutheliaSecondStepRepair, AutheliaVerificationCode, ApiKeyInfo, ApiKeyCreated, SshAccess, SshKeyCreated,
  ProxmoxCapabilities, ProxmoxStorageResponse, FleetProvisionDefaults, FleetProvisionRequest, FleetMoveCheck, FleetProvisionResponse, FleetJob, FleetJobsResponse,
  SystemInfo,
  NetworkListResponse,
  NetworkDetail,
  NetworkCreateResponse,
  NetworkCreateOptions,
  NetworkRecreateResponse,
  ContainerEnvUpdateResponse,
  NetworkDeleteResponse,
  NetworkActionResponse,
  VolumeListResponse,
  VolumeDeleteResponse,
  DiskListResponse,
  LogsResponse,
  EventsResponse,
  MaintenanceResponse,
  ContainerProcessesResponse,
  StackComposeResponse,
  AuthResponse,
  AuthVerifyResponse,
  AuthLogoutResponse,
  AuthPasswordChangeResponse,
  InviteResponse,
  InviteListResponse,
  UserListResponse,
  ComposeValidateResponse,
  ComposeSaveResponse,
  StackEnvResponse,
  StackEnvSaveResponse,
  MaintenanceReport,
  OrphanReport,
  DiskAnalysis,
  LogRotateResponse,
  LogStatsResponse,
  LogArchivesResponse,
  BatchStackResponse,
  RootEnvResponse,
  EnvValidateResponse,
  BackupListResponse,
  BackupStatusResponse,
  BackupConfigResponse,
  BackupTriggerResponse,
  BackupRestoreResponse,
  ContainerExecResponse,
  TerminalExecResponse,
  TerminalHistoryResponse,
  ImageDeleteResponse,
  ContainerRenameResponse,
  StackServicesResponse,
  StackActivityResponse,
  SystemMetricsResponse,
  TerminalAuthResponse,
  TerminalAuthVerifyResponse,
  TerminalLogoutResponse,
  ContainerFilesResponse,
  ContainerFileContentResponse,
  AlertConfigResponse,
  CrontabResponse,
  LiveLogsResponse,
  MetricsSnapshotResponse,
  MetricsTrendsResponse,
  ImageCheckResponse,
  ImageRegistryCheckResponse,
  ImageUpdateResponse,
  NotificationRule,
  NotificationRulesResponse,
  NotificationHistoryResponse,
  NotificationTestResponse,
  SnapshotListResponse,
  SnapshotCreateResponse,
  SnapshotRestoreResponse,
  ComposeHistoryResponse,
  ComposeVersionContentResponse,
  DashboardLayout,
  DashboardLayoutResponse,
  PluginCardsResponse,
  ComposeRollbackResponse,
  TemplateListResponse,
  TemplateDetailResponse,
  TemplateDeployResponse,
  TemplateImportResponse,
  TemplateUpdateResponse,
  TemplateDeleteResponse,
  DeployHistoryResponse,
  TemplateUndeployResponse,
  TemplateDryRunResponse,
  AutomationRule,
  AutomationListResponse,
  AutomationHistoryResponse,
  TopologyResponse,
  SetupStatusResponse,
  SetupDefaultsResponse,
  SetupConfigureRequest,
  SetupConfigureResponse,
  SetupCompleteResponse,
  StackRenameResponse,
  StackReorderResponse,
  FactoryResetResponse,
  MetricsHistoryResponse,
  MetricsSummaryResponse,
  RollbackSnapshotsResponse,
  RollbackSnapshotDetail,
  RollbackRestoreResponse,
  RollbackDiffResponse,
  SecretsListResponse,
  SecretSetResponse,
  SecretDeleteResponse,
  SecretExistsResponse,
  SecretReferencesResponse,
  ScheduleListResponse,
  ScheduleCreateResponse,
  Schedule,
  ScheduleHistoryResponse,
  HealthScoreResponse,
  StackHealthScore,
  HealthScoreHistoryResponse,
  PluginListResponse,
  PluginCatalogResponse,
  CrowdSecStatusResponse,
  CrowdSecUnbanResponse, CrowdSecDecisionQuery, CrowdSecDecisionsResponse, CrowdSecBanBody, CrowdSecBanResponse, CrowdSecBulkDeleteResponse, CrowdSecImportResponse,
  CrowdSecExportResponse, CrowdSecAlertsResponse, CrowdSecAlertDetail, CrowdSecAllowlistResponse, CrowdSecAllowAddBody, CrowdSecAllowAddResponse,
  CrowdSecBouncersResponse, CrowdSecMachinesResponse, CrowdSecBouncerAddResponse, CrowdSecMetricsResponse, CrowdSecHubResponse, CrowdSecHubAvailableResponse,
  CrowdSecHubChangeResponse, CrowdSecPluginResponse, CrowdSecPluginSettings, CrowdSecLogsResponse, CrowdSecSimulationResponse, CrowdSecSimulationSetResponse, CrowdSecCommunityResponse, CrowdSecCommunityRegisterResponse, CrowdSecConsoleEnrollBody, CrowdSecConsoleEnrollResponse, CrowdSecSettingsResponse,
  CrowdSecSettingsBody, CrowdSecNotifyResponse, CrowdSecNotifyBody, CrowdSecPreviewResponse, CrowdSecNotifyTestResponse, CrowdSecServiceResponse, CrowdSecFix,
  PluginInstallResponse,
  PluginDeleteResponse,
  PluginHooksListResponse,
  PluginHookContentResponse,
  PluginHookUpdateResponse,
  PluginHookTestResponse,
  PluginLogsResponse,
  PluginConfigUpdateResponse,
  Plugin,
  ConfigSchemaResponse,
  DependencyGraphResponse,
  TemplateImportUrlResponse,
  TemplateGalleryResponse,
  StackCloneResponse,
  ImageSearchResponse,
  ComposeValidateFullResponse,
  ExportResponse,
  AuditLogResponse,
  WebhookListResponse,
  ContainerResetPreview,
  ContainerResetResponse,
  UserRoleResponse,
  WebhookCreateResponse,
  WebhookDeleteResponse,
  WebhookTestResponse,
  ImagePullResponse,
  SessionListResponse,
  SystemUpdateCheckResponse,
  SystemUpdateApplyResponse,
  SystemUpdateRollbackResponse,
  SystemRestartResponse,
  TraefikStatusResponse,
  PowerStatus,
  RecoveryListResponse,
  RecoveryBundleResponse,
  RecoveryRestoreResponse,
  SystemUpdateHistoryResponse,
  OsUpdateCheckResponse,
  OsUpdateApplyResponse,
  OsUpdateStatusResponse,
  OsUpdatesResponse,
  TotpSetupResponse,
  TotpVerifyResponse,
  TotpValidateResponse,
  RouteCertificatesResponse,
  SablierToggleResponse, DockerEngineInfo, DockerEngineFleet, DockerEngineStatus, DockerEngineUpdateResponse, FleetDockerEngineUpdateResponse,
  ProxmoxSelf, StorageOverview, DomainsResponse, DomainChangeResponse,
} from '../../shared/types'

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

/** GET / — API root with endpoint listing */
export function fetchApiRoot(): Promise<APIRoot> {
  return apiClient.get<APIRoot>('/')
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** GET /status — Server status overview */
export function fetchServerStatus(): Promise<ServerStatus> {
  return apiClient.get<ServerStatus>('/status')
}

/** GET /health — Container health report */
/** GET /health — this server's; on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchHealthReport(scope?: string | null): Promise<HealthReport> {
  if (scope === 'all') return apiClient.get<HealthReport>('/health?fleet=1')
  return apiClient.get<HealthReport>(memberPath(scope === 'hub' ? null : scope, '/health'))
}

/** GET /version — API and Docker version info */
export function fetchVersion(): Promise<APIVersion> {
  return apiClient.get<APIVersion>('/version')
}

/** GET /config — Server configuration */
export function fetchConfig(): Promise<ServerConfig> {
  return apiClient.get<ServerConfig>('/config')
}

/** POST /config — Update server configuration */
export function updateConfig(updates: Record<string, string | boolean | number>): Promise<ConfigUpdateResponse> {
  return apiClient.post<ConfigUpdateResponse>('/config', updates)
}

/** GET /system — System information */
export function fetchSystemInfo(): Promise<SystemInfo> {
  return apiClient.get<SystemInfo>('/system')
}

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

/** Path of a call made on a fleet member through the hub (3.9); the path itself when member is empty */
export function memberPath(member: string | null | undefined, path: string): string {
  return member ? `/fleet/members/${encodeURIComponent(member)}/api${path}` : path
}

/** GET /stacks — List all stacks (on a fleet member when one is given) */
export function fetchStacks(member?: string | null): Promise<StackListResponse> {
  return apiClient.get<StackListResponse>(memberPath(member, '/stacks'))
}

/** GET /stacks/:name — Stack detail */
export function fetchStack(name: string): Promise<StackDetail> {
  return apiClient.get<StackDetail>(`/stacks/${encodeURIComponent(name)}`)
}

/** GET /stacks/:name/containers — Containers in a stack */
export function fetchStackContainers(name: string): Promise<StackContainersResponse> {
  return apiClient.get<StackContainersResponse>(
    `/stacks/${encodeURIComponent(name)}/containers`,
  )
}

/** GET /stacks/:name/logs — Stack logs */
export function fetchStackLogs(name: string): Promise<StackLogsResponse> {
  return apiClient.get<StackLogsResponse>(
    `/stacks/${encodeURIComponent(name)}/logs`,
  )
}

/** POST /stacks/:name/start — Start a stack */
export function startStack(name: string, member?: string | null): Promise<StackActionResponse> {
  return apiClient.post<StackActionResponse>(
    memberPath(member, `/stacks/${encodeURIComponent(name)}/start`), undefined, member ? 120000 : undefined,
  )
}

/** POST /stacks/:name/stop — Stop a stack */
export function stopStack(name: string, member?: string | null): Promise<StackActionResponse> {
  return apiClient.post<StackActionResponse>(
    memberPath(member, `/stacks/${encodeURIComponent(name)}/stop`), undefined, 60000,
  )
}

/** POST /stacks/:name/restart — Restart a stack */
export function restartStack(name: string, member?: string | null): Promise<StackActionResponse> {
  return apiClient.post<StackActionResponse>(
    memberPath(member, `/stacks/${encodeURIComponent(name)}/restart`), undefined, 90000,
  )
}

/** POST /stacks/:name/update — Pull and rolling-update a stack */
export function updateStack(name: string): Promise<StackUpdateResponse> {
  return apiClient.post<StackUpdateResponse>(
    `/stacks/${encodeURIComponent(name)}/update`, undefined, 120000,
  )
}

/** POST /stacks — Create a new stack */
/** POST /stacks — a new stack; `app_data_dir` keeps its App-Data on a drive of its own (`app_data_adopt`: use files already there) */
export function createStack(name: string, opts?: { app_data_dir?: string; app_data_adopt?: boolean }): Promise<StackCreateResponse> {
  return apiClient.post<StackCreateResponse>('/stacks', { name, ...(opts ?? {}) })
}

/** POST /stacks/:name/delete — Delete a stack */
export function deleteStack(name: string): Promise<StackDeleteResponse> {
  return apiClient.post<StackDeleteResponse>(
    `/stacks/${encodeURIComponent(name)}/delete`,
  )
}

/** GET /stacks/:name/compose — Fetch raw docker-compose.yml content */
export function fetchStackCompose(name: string): Promise<StackComposeResponse> {
  return apiClient.get<StackComposeResponse>(
    `/stacks/${encodeURIComponent(name)}/compose`,
  )
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** GET /images — All images */
/** GET /images — this server's; on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchImages(scope?: string | null): Promise<ImageListResponse> {
  if (scope === 'all') return apiClient.get<ImageListResponse>('/images?fleet=1')
  return apiClient.get<ImageListResponse>(memberPath(scope === 'hub' ? null : scope, '/images'))
}

/** GET /images/stale — Stale images only */
export function fetchStaleImages(): Promise<ImageListResponse> {
  return apiClient.get<ImageListResponse>('/images/stale')
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export interface ContainerListResponse {
  total: number
  containers: ContainerInfo[]
}

/** GET /containers — All containers */
export function fetchContainers(): Promise<ContainerListResponse> {
  return apiClient.get<ContainerListResponse>('/containers')
}

/** GET /containers/:name — Container detail */
export function fetchContainer(name: string): Promise<ContainerDetail> {
  return apiClient.get<ContainerDetail>(
    `/containers/${encodeURIComponent(name)}`,
  )
}

/** GET /containers/:name/stats — Container resource stats */
export function fetchContainerStats(name: string): Promise<ContainerStats> {
  return apiClient.get<ContainerStats>(
    `/containers/${encodeURIComponent(name)}/stats`,
  )
}

/** GET /containers/:name/logs — Container logs */
export function fetchContainerLogs(name: string): Promise<ContainerLogsResponse> {
  return apiClient.get<ContainerLogsResponse>(
    `/containers/${encodeURIComponent(name)}/logs`,
  )
}

/** POST /containers/:name/start — Start a container */
export function startContainer(name: string, member?: string | null): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>(
    `/containers/${encodeURIComponent(name)}/start${member ? `?member=${encodeURIComponent(member)}` : ''}`,
  )
}

/** POST /containers/:name/stop — Stop a container */
export function stopContainer(name: string, member?: string | null): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>(
    `/containers/${encodeURIComponent(name)}/stop${member ? `?member=${encodeURIComponent(member)}` : ''}`,
  )
}

/** POST /containers/:name/restart — Restart a container */
export function restartContainer(name: string, member?: string | null): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>(
    `/containers/${encodeURIComponent(name)}/restart${member ? `?member=${encodeURIComponent(member)}` : ''}`,
  )
}

/** POST /containers/:name/recreate — Pull latest image, stop, remove, and recreate container */
export function recreateContainer(name: string, member?: string | null): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>(
    `/containers/${encodeURIComponent(name)}/recreate${member ? `?member=${encodeURIComponent(member)}` : ''}`, undefined, 120000,
  )
}

/** GET /containers/:name/reset — What a nuke & reinstall would remove (admin) */
export function fetchContainerResetPreview(name: string): Promise<ContainerResetPreview> {
  return apiClient.get<ContainerResetPreview>(`/containers/${encodeURIComponent(name)}/reset`)
}

/** POST /containers/:name/reset — Nuke & reinstall: wipe its App-Data (to the trash), optionally its volumes, recreate it */
export function resetContainer(name: string, body: { confirm: string; wipe_app_data?: boolean; wipe_volumes?: boolean; pull?: boolean }): Promise<ContainerResetResponse> {
  return apiClient.post<ContainerResetResponse>(`/containers/${encodeURIComponent(name)}/reset`, body, 300000)
}

/** POST /containers/:name/remove — Force-remove a container */
export function removeContainer(name: string, member?: string | null): Promise<ContainerActionResponse> {
  return apiClient.post<ContainerActionResponse>(
    `/containers/${encodeURIComponent(name)}/remove${member ? `?member=${encodeURIComponent(member)}` : ''}`,
  )
}

/** GET /containers/:name/processes — Running processes in a container */
export function fetchContainerProcesses(name: string): Promise<ContainerProcessesResponse> {
  return apiClient.get<ContainerProcessesResponse>(
    `/containers/${encodeURIComponent(name)}/processes`,
  )
}

/** POST /containers/:name/exec — Execute a command inside a container */
export function execContainerCommand(name: string, command: string): Promise<ContainerExecResponse> {
  return apiClient.post<ContainerExecResponse>(
    `/containers/${encodeURIComponent(name)}/exec`,
    { command },
  )
}

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/** GET /networks — Docker networks */
/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchNetworks(scope?: string | null): Promise<NetworkListResponse> {
  if (scope === 'all') return apiClient.get<NetworkListResponse>('/networks?fleet=1')
  return apiClient.get<NetworkListResponse>(memberPath(scope === 'hub' ? null : scope, '/networks'))
}

/** GET /networks/:name — Network detail with containers and IPAM */
export function fetchNetworkDetail(name: string, member?: string | null): Promise<NetworkDetail> {
  return apiClient.get<NetworkDetail>(memberPath(member, `/networks/${encodeURIComponent(name)}`))
}

/**
 * POST /containers/:name/env — Change a Compose service's environment in its
 * stack files (compose entry, or the .env variable it references) and recreate
 * the container unless recreate is false.
 */
export function updateContainerEnv(name: string, opts: { set?: Record<string, string>; unset?: string[]; recreate?: boolean }): Promise<ContainerEnvUpdateResponse> {
  return apiClient.post<ContainerEnvUpdateResponse>(`/containers/${encodeURIComponent(name)}/env`, opts, 180000)
}

/** GET / — The API's own endpoint catalogue (public) */
export function fetchApiCatalogue(): Promise<{ name: string; version: string; endpoints: { method: string; path: string; access: string; description: string }[] }> {
  return apiClient.get('/')
}

/** GET /plugins/:plugin/cards/:card/source — A card's manifest and raw HTML for editing */
export function fetchCardSource(plugin: string, card: string): Promise<{ plugin: string; card: string; meta: Record<string, unknown>; html: string; files: string[] }> {
  return apiClient.get(`/plugins/${encodeURIComponent(plugin)}/cards/${encodeURIComponent(card)}/source`)
}

/** POST /plugins/:plugin/cards/:card — Create or replace a dashboard card (the plugin is created when missing) */
export function saveCard(plugin: string, card: string, body: { meta: Record<string, unknown>; html: string }): Promise<{ success: boolean; plugin: string; card: string; id: string }> {
  return apiClient.post(`/plugins/${encodeURIComponent(plugin)}/cards/${encodeURIComponent(card)}`, body)
}

/** DELETE /plugins/:plugin/cards/:card — Remove a dashboard card */
export function deleteCard(plugin: string, card: string): Promise<{ success: boolean }> {
  return apiClient.delete(`/plugins/${encodeURIComponent(plugin)}/cards/${encodeURIComponent(card)}`)
}

/** POST /networks — Create a new Docker network */
export function createNetwork(opts: NetworkCreateOptions, member?: string | null): Promise<NetworkCreateResponse> {
  return apiClient.post<NetworkCreateResponse>(memberPath(member, '/networks'), opts)
}

/**
 * POST /networks/:name/recreate — Docker cannot change a network in place: the
 * API disconnects its containers, removes it, creates it again with these
 * settings (Compose ownership labels kept) and reconnects the containers.
 */
export function recreateNetwork(name: string, opts: Omit<NetworkCreateOptions, 'name'>, member?: string | null): Promise<NetworkRecreateResponse> {
  return apiClient.post<NetworkRecreateResponse>(memberPath(member, `/networks/${encodeURIComponent(name)}/recreate`), opts, 120000)
}

/** POST /networks/:name/delete — Remove a Docker network */
export function deleteNetwork(name: string, member?: string | null): Promise<NetworkDeleteResponse> {
  return apiClient.post<NetworkDeleteResponse>(
    memberPath(member, `/networks/${encodeURIComponent(name)}/delete`),
  )
}

/** POST /networks/:name/connect — Connect a container to a network */
export function connectToNetwork(
  networkName: string,
  containerName: string,
  member?: string | null,
): Promise<NetworkActionResponse> {
  return apiClient.post<NetworkActionResponse>(
    memberPath(member, `/networks/${encodeURIComponent(networkName)}/connect`),
    { container: containerName },
  )
}

/** POST /networks/:name/disconnect — Disconnect a container from a network */
export function disconnectFromNetwork(
  networkName: string,
  containerName: string,
  member?: string | null,
): Promise<NetworkActionResponse> {
  return apiClient.post<NetworkActionResponse>(
    memberPath(member, `/networks/${encodeURIComponent(networkName)}/disconnect`),
    { container: containerName },
  )
}

/** GET /volumes — Docker volumes */
/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchVolumes(scope?: string | null): Promise<VolumeListResponse> {
  if (scope === 'all') return apiClient.get<VolumeListResponse>('/volumes?fleet=1')
  return apiClient.get<VolumeListResponse>(memberPath(scope === 'hub' ? null : scope, '/volumes'))
}

/** POST /volumes/:name/delete — Remove a Docker volume */
export function deleteVolume(name: string, member?: string | null): Promise<VolumeDeleteResponse> {
  return apiClient.post<VolumeDeleteResponse>(
    memberPath(member, `/volumes/${encodeURIComponent(name)}/delete`),
  )
}

/** GET /disks — Mounted filesystems */
export function fetchDisks(): Promise<DiskListResponse> {
  return apiClient.get<DiskListResponse>('/disks')
}

/** GET /domains — the primary domain, the others, the default for new VMs, who uses which */
export function fetchDomains(): Promise<DomainsResponse> {
  return apiClient.get<DomainsResponse>('/domains')
}
/** POST /domains — add a domain (certificate, sign-in and apex record follow) */
export function addDomain(domain: string): Promise<DomainChangeResponse> {
  return apiClient.post<DomainChangeResponse>('/domains', { domain }, 60000)
}
/** DELETE /domains/{domain} — take a domain off (no VM may still use it) */
export function removeDomain(domain: string): Promise<DomainChangeResponse> {
  return apiClient.delete<DomainChangeResponse>(`/domains/${encodeURIComponent(domain)}`)
}
/** POST /domains/vm-default — the domain new VMs get ("" = the primary) */
export function setVmDefaultDomain(domain: string): Promise<{ success: boolean; vm_default: string | null; effective: string }> {
  return apiClient.post('/domains/vm-default', { domain })
}
/** POST /fleet/members/{id}/domain — a VM answers under another domain ("" = the hub's own); its routes move at once */
export function setMemberDomain(member: string, domain: string): Promise<{ success: boolean; member: string; domain: string; message: string }> {
  return apiClient.post(`/fleet/members/${encodeURIComponent(member)}/domain`, { domain }, 120000)
}

/** GET /storage/overview — this server's drives, every Proxmox node's disks and pools, and the VMs' disks */
export function fetchStorageOverview(): Promise<StorageOverview> {
  return apiClient.get<StorageOverview>('/storage/overview')
}

// ---------------------------------------------------------------------------
// Logs & Events
// ---------------------------------------------------------------------------

/** GET /logs — Application logs */
export function fetchLogs(): Promise<LogsResponse> {
  return apiClient.get<LogsResponse>('/logs')
}

/** GET /events — Docker events */
/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchEvents(scope?: string | null): Promise<EventsResponse> {
  if (scope === 'all') return apiClient.get<EventsResponse>('/events?fleet=1')
  return apiClient.get<EventsResponse>(memberPath(scope === 'hub' ? null : scope, '/events'))
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** POST /maintenance/prune — Docker system prune */
export function runDockerPrune(): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>('/maintenance/prune')
}

/** POST /maintenance/image-prune — Docker image prune (on a fleet member when one is given) */
export function runImagePrune(member?: string | null): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>(memberPath(member, '/maintenance/image-prune'))
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** POST /auth/setup — Initial admin account setup */
export function authSetup(username: string, password: string): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/setup', { username, password })
}

/** POST /auth/login — Authenticate and receive token */
export function authLogin(username: string, password: string): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/login', { username, password })
}

/** POST /auth/register — Register with invite code */
export function authRegister(username: string, password: string, invite_code: string): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/register', { username, password, invite_code })
}

/** GET /auth/verify — Verify current token validity */
export function authVerify(): Promise<AuthVerifyResponse> {
  return apiClient.get<AuthVerifyResponse>('/auth/verify')
}

/** POST /auth/invite — Create an invite code */
export function authCreateInvite(role?: string): Promise<InviteResponse> {
  return apiClient.post<InviteResponse>('/auth/invite', { role: role || 'user' })
}

/** POST /auth/users — Create an account directly, no invite code (admin) */
export function authCreateUser(username: string, password: string, role: 'user' | 'admin' | 'bot'): Promise<{ success: boolean; username: string; role: string; message: string }> {
  return apiClient.post<{ success: boolean; username: string; role: string; message: string }>('/auth/users', { username, password, role })
}

/** POST /auth/users/:name/role — Change an account's role (admin); their sessions are signed out */
export function authSetUserRole(username: string, role: 'user' | 'admin' | 'bot'): Promise<UserRoleResponse> {
  return apiClient.post<UserRoleResponse>(`/auth/users/${encodeURIComponent(username)}/role`, { role })
}

/** GET /auth/users — List all registered users */
export function authListUsers(): Promise<UserListResponse> {
  return apiClient.get<UserListResponse>('/auth/users')
}

/** GET /auth/invites — List all invite codes */
export function authListInvites(): Promise<InviteListResponse> {
  return apiClient.get<InviteListResponse>('/auth/invites')
}

/** DELETE /auth/invite/:code — Revoke an invite code (admin); 404 when the code is unknown */
export function authDeleteInvite(code: string): Promise<{ success: boolean; code: string; message: string }> {
  return apiClient.delete<{ success: boolean; code: string; message: string }>(`/auth/invite/${encodeURIComponent(code)}`)
}

/** POST /auth/revoke — Revoke a user's access */
export function authRevokeUser(username: string): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/auth/revoke', { username })
}

/** POST /auth/logout — Invalidate current session token on server */
export function authLogout(): Promise<AuthLogoutResponse> {
  return apiClient.post<AuthLogoutResponse>('/auth/logout')
}

/** POST /auth/logout-all — Invalidate all sessions for a user (admin) */
export function authLogoutAll(username: string): Promise<AuthLogoutResponse> {
  return apiClient.post<AuthLogoutResponse>('/auth/logout-all', { username })
}

/** POST /auth/password — Change the signed-in account's password on the server; every session of the account ends,
 *  this one too (401: the current password is wrong, 400: the new one is shorter than 8 characters) */
export function authChangePassword(currentPassword: string, newPassword: string): Promise<AuthPasswordChangeResponse> {
  return apiClient.post<AuthPasswordChangeResponse>('/auth/password', { current_password: currentPassword, new_password: newPassword })
}

/** POST /auth/refresh — Refresh current session token */
export function authRefresh(): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/refresh')
}

/** GET /auth/sessions — List active sessions (admin only) */
export function authListSessions(): Promise<SessionListResponse> {
  return apiClient.get<SessionListResponse>('/auth/sessions')
}

/** DELETE /auth/sessions/:prefix — Revoke a session by token prefix (admin only) */
export function authRevokeSession(tokenPrefix: string): Promise<{ success: boolean; revoked: number; message: string }> {
  return apiClient.delete<{ success: boolean; revoked: number; message: string }>(`/auth/sessions/${encodeURIComponent(tokenPrefix)}`)
}

/** POST /auth/factory-reset — Wipe auth state and return to setup wizard */
export function authFactoryReset(opts: { confirm: string; reset_compose?: boolean }): Promise<FactoryResetResponse> {
  return apiClient.post<FactoryResetResponse>('/auth/factory-reset', opts, 120000)
}

// ---------------------------------------------------------------------------
// TOTP Two-Factor Authentication
// ---------------------------------------------------------------------------

/** POST /auth/totp/setup — Generate TOTP secret and QR URI */
export function totpSetup(): Promise<TotpSetupResponse> {
  return apiClient.post<TotpSetupResponse>('/auth/totp/setup', {})
}

/** POST /auth/totp/verify — Verify code and enable 2FA */
export function totpVerify(code: string): Promise<TotpVerifyResponse> {
  return apiClient.post<TotpVerifyResponse>('/auth/totp/verify', { code })
}

/** POST /auth/totp/disable — Disable 2FA (requires password) */
export function totpDisable(password: string): Promise<TotpVerifyResponse> {
  return apiClient.post<TotpVerifyResponse>('/auth/totp/disable', { password })
}

/** POST /auth/totp/validate — Complete login with TOTP code (second step) */
export function totpValidate(totpToken: string, code: string): Promise<TotpValidateResponse> {
  return apiClient.post<TotpValidateResponse>('/auth/totp/validate', { totp_token: totpToken, code })
}

// ---------------------------------------------------------------------------
// Phase 1: Compose Editor & Stack Env
// ---------------------------------------------------------------------------

/** POST /stacks/:name/compose/validate — Validate compose YAML */
export function validateStackCompose(name: string, content: string): Promise<ComposeValidateResponse> {
  return apiClient.post<ComposeValidateResponse>(
    `/stacks/${encodeURIComponent(name)}/compose/validate`,
    { content },
  )
}

/** POST /stacks/:name/compose — Save compose file */
export function saveStackCompose(name: string, content: string): Promise<ComposeSaveResponse> {
  return apiClient.post<ComposeSaveResponse>(
    `/stacks/${encodeURIComponent(name)}/compose`,
    { content },
  )
}

/** GET /stacks/:name/env — Read stack .env */
export function fetchStackEnv(name: string): Promise<StackEnvResponse> {
  return apiClient.get<StackEnvResponse>(
    `/stacks/${encodeURIComponent(name)}/env`,
  )
}

/** POST /stacks/:name/env — Save stack .env */
export function saveStackEnv(name: string, content: string): Promise<StackEnvSaveResponse> {
  return apiClient.post<StackEnvSaveResponse>(
    `/stacks/${encodeURIComponent(name)}/env`,
    { content },
  )
}

// ---------------------------------------------------------------------------
// Phase 2: Advanced Maintenance
// ---------------------------------------------------------------------------

/** GET /maintenance/report — Full system report */
export function fetchMaintenanceReport(): Promise<MaintenanceReport> {
  return apiClient.get<MaintenanceReport>('/maintenance/report')
}

/** GET /maintenance/orphans — Orphaned resources */
export function fetchMaintenanceOrphans(): Promise<OrphanReport> {
  return apiClient.get<OrphanReport>('/maintenance/orphans')
}

/** GET /maintenance/disk — Disk analysis */
export function fetchMaintenanceDisk(): Promise<DiskAnalysis> {
  return apiClient.get<DiskAnalysis>('/maintenance/disk')
}

/** POST /maintenance/deep-prune — Aggressive docker prune */
export function triggerDeepPrune(): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>('/maintenance/deep-prune', { confirm: 'CONFIRM' }, 120000)
}

/** POST /maintenance/log-rotate — Rotate logs */
export function triggerLogRotate(): Promise<LogRotateResponse> {
  return apiClient.post<LogRotateResponse>('/maintenance/log-rotate')
}

// ---------------------------------------------------------------------------
// Phase 3: Enhanced Log Viewer
// ---------------------------------------------------------------------------

/** GET /logs — Application logs (with optional server-side filtering) */
export function fetchLogsFiltered(params?: {
  level?: string
  search?: string
  lines?: number
}): Promise<LogsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.level) searchParams.set('level', params.level)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.lines) searchParams.set('lines', String(params.lines))
  const qs = searchParams.toString()
  return apiClient.get<LogsResponse>(qs ? `/logs?${qs}` : '/logs')
}

/** GET /logs/stats — Log statistics */
export function fetchLogStats(): Promise<LogStatsResponse> {
  return apiClient.get<LogStatsResponse>('/logs/stats')
}

/** GET /logs/archives — Archived log files */
export function fetchLogArchives(): Promise<LogArchivesResponse> {
  return apiClient.get<LogArchivesResponse>('/logs/archives')
}

// ---------------------------------------------------------------------------
// Phase 4: Batch Operations
// ---------------------------------------------------------------------------

/** POST /batch/stacks — Start/stop/restart multiple stacks */
export function batchStackAction(
  action: 'start' | 'stop' | 'restart',
  stacks: string[] | 'all',
): Promise<BatchStackResponse> {
  return apiClient.post<BatchStackResponse>('/batch/stacks', { action, stacks }, 120000)
}

/** POST /batch/update — Pull + rolling update multiple stacks */
export function batchStackUpdate(stacks: string[] | 'all'): Promise<BatchStackResponse> {
  return apiClient.post<BatchStackResponse>('/batch/update', { stacks }, 120000)
}

// ---------------------------------------------------------------------------
// Phase 5: Environment Variable Manager
// ---------------------------------------------------------------------------

/** GET /env — Root .env as raw + parsed */
export function fetchRootEnv(): Promise<RootEnvResponse> {
  return apiClient.get<RootEnvResponse>('/env')
}

/** POST /env — Save root .env */
export function saveRootEnv(content: string): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/env', { content })
}

/** POST /env/validate — Validate .env content */
export function validateEnv(content: string): Promise<EnvValidateResponse> {
  return apiClient.post<EnvValidateResponse>('/env/validate', { content })
}

// ---------------------------------------------------------------------------
// Phase 6: Backup & Restore
// ---------------------------------------------------------------------------

/** GET /backups — List backup archives */
export function fetchBackups(): Promise<BackupListResponse> {
  return apiClient.get<BackupListResponse>('/backups')
}

/** GET /backups/status — Current backup status */
export function fetchBackupStatus(): Promise<BackupStatusResponse> {
  return apiClient.get<BackupStatusResponse>('/backups/status')
}

/** GET /backups/config — Backup configuration */
export function fetchBackupConfig(): Promise<BackupConfigResponse> {
  return apiClient.get<BackupConfigResponse>('/backups/config')
}

/** POST /backups/trigger — Start a backup */
export function triggerBackup(stack?: string): Promise<BackupTriggerResponse> {
  return apiClient.post<BackupTriggerResponse>('/backups/trigger', stack ? { stack } : {})
}

/** POST /backups/restore — Restore from archive */
export function restoreBackup(filename: string): Promise<BackupRestoreResponse> {
  return apiClient.post<BackupRestoreResponse>('/backups/restore', { filename, confirm: 'RESTORE' }, 120000)
}

/** POST /backups/cancel — Cancel a running backup */
export function cancelBackup(): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/backups/cancel')
}

/** POST /schedules/:id/run — Run a schedule immediately (the server runs the action before it answers: a backup or a prune outlasts the 30 s default) */
export function runSchedule(id: string, member?: string | null): Promise<{ success: boolean; action: string; output: string }> {
  return apiClient.post<{ success: boolean; action: string; output: string }>(memberPath(member, `/schedules/${encodeURIComponent(id)}/run`), undefined, 120000)
}

/** POST /images/update-all (4.0.33) — update every image on a server now: its unattended image update, started in the background */
export function updateAllImages(member?: string | null): Promise<{ success: boolean; started: boolean; message: string }> {
  return apiClient.post<{ success: boolean; started: boolean; message: string }>(memberPath(member, '/images/update-all'), {}, 60000)
}

// ---------------------------------------------------------------------------
// v3.1: Terminal, Image Delete, Container Rename, Stack Services, System Metrics
// ---------------------------------------------------------------------------

/** POST /terminal/exec — Execute a command on the host */
export function execTerminalCommand(command: string, cwd?: string): Promise<TerminalExecResponse> {
  return apiClient.post<TerminalExecResponse>('/terminal/exec', { command, cwd })
}

/** GET /terminal/history — Recent command audit log */
export function fetchTerminalHistory(): Promise<TerminalHistoryResponse> {
  return apiClient.get<TerminalHistoryResponse>('/terminal/history')
}

/** POST /images/:id/delete — Remove a Docker image by id (an untagged one: "<none>") */
export function deleteImage(id: string, member?: string | null): Promise<ImageDeleteResponse> {
  return apiClient.post<ImageDeleteResponse>(memberPath(member, `/images/${encodeURIComponent(id)}/delete`), undefined, 120000)
}

/** POST /images/delete — Remove a tagged image by its reference ("repository:tag"): Docker takes the name even when the id carries several tags */
export function deleteImageRef(image: string, member?: string | null): Promise<ImageDeleteResponse> {
  return apiClient.post<ImageDeleteResponse>(memberPath(member, '/images/delete'), { image }, 120000)
}

/** POST /containers/:name/rename — Rename a container */
export function renameContainer(name: string, newName: string): Promise<ContainerRenameResponse> {
  return apiClient.post<ContainerRenameResponse>(
    `/containers/${encodeURIComponent(name)}/rename`,
    { new_name: newName },
  )
}

/** GET /stacks/:name/services — Per-service status within a stack */
/** GET /stacks/:stack/activity — Progress of the background action on a stack (deploy, start, stop) */
export function fetchStackActivity(name: string, member?: string | null): Promise<StackActivityResponse> {
  return apiClient.get<StackActivityResponse>(memberPath(member, `/stacks/${encodeURIComponent(name)}/activity`))
}

/** POST /stacks/:name/push — Push the hub's files of a VM stack into the VM that runs it (admin; the hub's own endpoint) */
export function pushStackFiles(name: string): Promise<StackPushResponse> {
  return apiClient.post<StackPushResponse>(`/stacks/${encodeURIComponent(name)}/push`, {}, 120000)
}

/** POST /stacks/:name/pull — Pull a VM stack's files from the VM into the hub's Stacks/<name>/ (admin; the hub's own endpoint) */
export function pullStackFiles(name: string): Promise<StackPullResponse> {
  return apiClient.post<StackPullResponse>(`/stacks/${encodeURIComponent(name)}/pull`, {}, 120000)
}

/** GET /stacks/:name/appdata — Where a stack's App-Data is; for a VM's stack on a hub, whether the VM's folder is mounted at Stacks/<name>/VM-App-Data (admin; the hub's own endpoint) */
export function fetchStackAppData(name: string): Promise<StackAppDataStatus> {
  return apiClient.get<StackAppDataStatus>(`/stacks/${encodeURIComponent(name)}/appdata`)
}

/** POST /stacks/:name/appdata/mount — Mount a VM stack's App-Data on the hub now; the hub may install sshfs first, hence the long wait (409 with the reason when it cannot be mounted) */
export function mountStackAppData(name: string): Promise<StackAppDataStatus> {
  return apiClient.post<StackAppDataStatus>(`/stacks/${encodeURIComponent(name)}/appdata/mount`, {}, 300000)
}

/** POST /stacks/:name/appdata/unmount — Take the mount down on the hub until Mount (nothing changes in the VM) */
export function unmountStackAppData(name: string): Promise<StackAppDataStatus> {
  return apiClient.post<StackAppDataStatus>(`/stacks/${encodeURIComponent(name)}/appdata/unmount`, {}, 60000)
}

export function fetchStackServices(name: string): Promise<StackServicesResponse> {
  return apiClient.get<StackServicesResponse>(
    `/stacks/${encodeURIComponent(name)}/services`,
  )
}

/** GET /system/metrics — Lightweight CPU/memory/disk snapshot */
export function fetchSystemMetrics(): Promise<SystemMetricsResponse> {
  return apiClient.get<SystemMetricsResponse>('/system/metrics')
}

// ---------------------------------------------------------------------------
// v3.2: Terminal Auth, Container Files, Alerts, Cron, Live Logs
// ---------------------------------------------------------------------------

/** POST /terminal/auth — Authenticate with Linux credentials for terminal access */
export function terminalAuth(username: string, password: string): Promise<TerminalAuthResponse> {
  return apiClient.post<TerminalAuthResponse>('/terminal/auth', { username, password })
}

/** POST /terminal/auth/verify — Verify a terminal session token */
export function terminalAuthVerify(token: string): Promise<TerminalAuthVerifyResponse> {
  return apiClient.post<TerminalAuthVerifyResponse>('/terminal/auth/verify', { token })
}

/** POST /terminal/auth/logout — End a terminal session */
export function terminalLogout(token: string): Promise<TerminalLogoutResponse> {
  return apiClient.post<TerminalLogoutResponse>('/terminal/auth/logout', { token })
}

/** POST /terminal/exec — Execute a command (with terminal token) */
export function execTerminalCommandAuth(
  command: string,
  terminalToken: string,
  cwd?: string,
): Promise<TerminalExecResponse> {
  return apiClient.post<TerminalExecResponse>('/terminal/exec', {
    command,
    cwd,
    terminal_token: terminalToken,
  })
}

/** GET /containers/:name/files — List directory contents inside a container */
export function fetchContainerFiles(name: string, path = '/'): Promise<ContainerFilesResponse> {
  return apiClient.get<ContainerFilesResponse>(
    `/containers/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
  )
}

/** GET /containers/:name/files/content — Read file contents inside a container */
export function fetchContainerFileContent(
  name: string,
  path: string,
): Promise<ContainerFileContentResponse> {
  return apiClient.get<ContainerFileContentResponse>(
    `/containers/${encodeURIComponent(name)}/files/content?path=${encodeURIComponent(path)}`,
  )
}

/** GET /alerts/config — Read alert thresholds */
export function fetchAlertConfig(): Promise<AlertConfigResponse> {
  return apiClient.get<AlertConfigResponse>('/alerts/config')
}

/** POST /alerts/config — Update alert thresholds */
export function updateAlertConfig(thresholds: AlertConfigResponse['thresholds']): Promise<AlertConfigResponse> {
  return apiClient.post<AlertConfigResponse>('/alerts/config', { thresholds })
}

/** GET /system/crontab — User crontab entries */
export function fetchCrontab(): Promise<CrontabResponse> {
  return apiClient.get<CrontabResponse>('/system/crontab')
}

/** GET /system/crontab/system — System-level cron entries */
export function fetchSystemCrontab(): Promise<CrontabResponse> {
  return apiClient.get<CrontabResponse>('/system/crontab/system')
}

/** POST /system/crontab — Update user crontab */
export function updateCrontab(content: string): Promise<{ success: boolean; message: string }> {
  return apiClient.post('/system/crontab', { content })
}

/** GET /containers/:name/logs/live — Live log polling for a container */
export function fetchContainerLogsLive(
  name: string,
  lines = 100,
  since?: string,
): Promise<LiveLogsResponse> {
  let url = `/containers/${encodeURIComponent(name)}/logs/live?lines=${lines}`
  if (since) url += `&since=${encodeURIComponent(since)}`
  return apiClient.get<LiveLogsResponse>(url)
}

/** GET /logs/live — Live log polling for DCS application log */
export function fetchAppLogsLive(lines = 100, since?: string): Promise<LiveLogsResponse> {
  let url = `/logs/live?lines=${lines}`
  if (since) url += `&since=${encodeURIComponent(since)}`
  return apiClient.get<LiveLogsResponse>(url)
}

// ---------------------------------------------------------------------------
// v4.0: Resource Trends, Image Updates, Notifications, Snapshots,
//       Compose History, Templates, Automations, Network Topology
// ---------------------------------------------------------------------------

/** POST /metrics/snapshot — Capture and persist current metrics (on a fleet member when one is given: its own trends) */
export function captureMetricsSnapshot(member?: string | null): Promise<MetricsSnapshotResponse> {
  return apiClient.post<MetricsSnapshotResponse>(memberPath(member, '/metrics/snapshot'))
}

/** GET /metrics/trends — Query historical metrics */
export function fetchMetricsTrends(range: string = '1h'): Promise<MetricsTrendsResponse> {
  return apiClient.get<MetricsTrendsResponse>(`/metrics/trends?range=${range}`)
}

/** GET /images/check-updates — Quick local staleness check */
export function fetchImageUpdates(member?: string | null): Promise<ImageCheckResponse> {
  return apiClient.get<ImageCheckResponse>(memberPath(member, '/images/check-updates'))
}

/** POST /images/check-updates — Registry check for updates (slow) */
export function checkImageRegistry(member?: string | null): Promise<ImageRegistryCheckResponse> {
  return apiClient.post<ImageRegistryCheckResponse>(memberPath(member, '/images/check-updates'), undefined, 120000)
}

/** POST /images/update — Pull an image; recreate the Compose services that use it unless recreate is false */
export function updateImage(name: string, opts: { recreate?: boolean } = {}, member?: string | null): Promise<ImageUpdateResponse> {
  return apiClient.post<ImageUpdateResponse>(memberPath(member, '/images/update'), { image: name, recreate: opts.recreate ?? true }, 600000)
}

/** GET /notifications/rules — List notification rules */
export function fetchNotificationRules(): Promise<NotificationRulesResponse> {
  return apiClient.get<NotificationRulesResponse>('/notifications/rules')
}

/** POST /notifications/rules — Create/update a notification rule */
export function createNotificationRule(rule: Partial<NotificationRule>): Promise<NotificationRule> {
  return apiClient.post<NotificationRule>('/notifications/rules', rule)
}

/** DELETE /notifications/rules/:id — Delete a notification rule */
export function deleteNotificationRule(id: string): Promise<{ success: boolean; deleted: string }> {
  return apiClient.delete<{ success: boolean; deleted: string }>(`/notifications/rules/${encodeURIComponent(id)}`)
}

/** GET /notifications/history — Notification send history */
export function fetchNotificationHistory(): Promise<NotificationHistoryResponse> {
  return apiClient.get<NotificationHistoryResponse>('/notifications/history')
}

/** POST /notifications/test — Send a test notification */
export function sendTestNotification(opts?: {
  message?: string
  priority?: string
  title?: string
  tags?: string
}): Promise<NotificationTestResponse> {
  return apiClient.post<NotificationTestResponse>('/notifications/test', opts || {})
}

/** GET /snapshots — List all snapshots */
/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchSnapshots(scope?: string | null): Promise<SnapshotListResponse> {
  if (scope === 'all') return apiClient.get<SnapshotListResponse>('/snapshots?fleet=1')
  return apiClient.get<SnapshotListResponse>(memberPath(scope === 'hub' ? null : scope, '/snapshots'))
}

/** POST /snapshots/create — Create a new snapshot */
/** a hub: scope 'all' takes one snapshot here and one on every VM at the same moment (?fleet=1) */
export function createSnapshot(label?: string, scope?: string | null): Promise<SnapshotCreateResponse> {
  if (scope === 'all') return apiClient.post<SnapshotCreateResponse>('/snapshots/create?fleet=1', { label: label || '' }, 240000)
  return apiClient.post<SnapshotCreateResponse>(memberPath(scope === 'hub' ? null : scope, '/snapshots/create'), { label: label || '' })
}

/** POST /snapshots/:id/restore — Restore from a snapshot */
export function restoreSnapshot(id: string, member?: string | null): Promise<SnapshotRestoreResponse> {
  return apiClient.post<SnapshotRestoreResponse>(memberPath(member, `/snapshots/${encodeURIComponent(id)}/restore`), { confirm: 'RESTORE' }, 120000)
}

/** DELETE /snapshots/:id — Delete a snapshot */
export function deleteSnapshot(id: string, member?: string | null): Promise<{ success: boolean; deleted: string }> {
  return apiClient.delete<{ success: boolean; deleted: string }>(memberPath(member, `/snapshots/${encodeURIComponent(id)}`))
}

/** GET /stacks/:name/compose/history — Compose version history */
export function fetchComposeHistory(name: string): Promise<ComposeHistoryResponse> {
  return apiClient.get<ComposeHistoryResponse>(`/stacks/${encodeURIComponent(name)}/compose/history`)
}

/** GET /stacks/:name/compose/history/:id — View a specific compose version's content */
export function fetchComposeVersionContent(name: string, versionId: string): Promise<ComposeVersionContentResponse> {
  return apiClient.get<ComposeVersionContentResponse>(
    `/stacks/${encodeURIComponent(name)}/compose/history/${encodeURIComponent(versionId)}`,
  )
}

/** GET /settings/dashboard — Fetch user's dashboard layout */
export function fetchDashboardLayout(): Promise<DashboardLayoutResponse> {
  return apiClient.get<DashboardLayoutResponse>('/settings/dashboard')
}

/** POST /settings/dashboard — Save user's dashboard layout */
export function saveDashboardLayout(layout: DashboardLayout): Promise<{ success: boolean }> {
  return apiClient.post<{ success: boolean }>('/settings/dashboard', { layout })
}

/** GET /settings/profile — Fetch user's profile from server */
export function fetchProfile(): Promise<{ profile: Record<string, unknown> | null }> {
  return apiClient.get<{ profile: Record<string, unknown> | null }>('/settings/profile')
}

/** POST /settings/profile — Save user's profile to server */
export function saveProfileToServer(profile: Record<string, unknown>): Promise<{ success: boolean }> {
  return apiClient.post<{ success: boolean }>('/settings/profile', { profile })
}

/** GET /traefik/status — Traefik present, its domain, the Authelia middleware name, Sablier present */
export function fetchTraefikStatus(): Promise<TraefikStatusResponse> {
  return apiClient.get<TraefikStatusResponse>('/traefik/status')
}

/** Start a container on demand through Sablier (or serve it normally again): writes or removes the Traefik middleware */
export function setContainerSablier(name: string, body: { enabled: boolean; session?: string; display_name?: string; theme?: string }): Promise<SablierToggleResponse> {
  return apiClient.post<SablierToggleResponse>(`/containers/${encodeURIComponent(name)}/sablier`, body)
}

/** TLS state of the proxy: challenge, ACME account, certificates held, recent errors, hints */
export function fetchRouteCertificates(): Promise<RouteCertificatesResponse> {
  return apiClient.get<RouteCertificatesResponse>('/routes/certificates')
}

// ---------------------------------------------------------------------------
// Routes & DNS
// ---------------------------------------------------------------------------

export interface RouteEntry {
  subdomain: string
  service: string
  stack: string
  target: string
  conflict: boolean
  /** Traefik's CrowdSec bouncer: checks this route (protected), does not (bypass), or CrowdSec is not set up on the proxy (off) */
  crowdsec?: 'protected' | 'bypass' | 'off'
}

export interface RoutesResponse {
  total: number
  routes: RouteEntry[]
  domain: string
}

export interface RouteCheckResponse {
  available: boolean
  subdomain: string
  fqdn: string
  existing_service: string
  existing_stack: string
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV' | 'CAA' | 'PTR' | string

export interface DnsRecord {
  id: string
  type: DnsRecordType
  name: string
  /** Name relative to the zone ("@" for the apex) */
  subdomain: string
  content: string
  /** 1 = automatic */
  ttl: number
  proxied: boolean
  proxiable: boolean
  priority: number | null
  comment: string
  tags: string[]
  locked: boolean
  created_on: string
  modified_on: string
  /** Comment mentions DCS: created by a deployment, a route change or a sync */
  managed: boolean
  /** "stack/service" of the DCS route that uses this name, if any */
  route: string | null
  /** CNAME pointing at the DCS domain */
  points_to_dcs: boolean
  /** DCS can change or delete it (A, AAAA, CNAME, TXT, MX, NS and not locked) */
  editable: boolean
}

export interface DnsZone {
  id: string
  name: string
  status: string
  name_servers: string[]
  plan: string
}

export interface DnsRecordsResponse {
  total: number
  all_total?: number
  records: DnsRecord[]
  domain: string
  zone: { id: string; name: string } | null
  cf_configured: boolean
  token_source: '' | 'secret' | 'env' | 'stack-env'
  /** DCS routes under the zone that have no A/AAAA/CNAME record */
  routes_without_dns: { fqdn: string; route: string }[]
  error?: string
  hint?: string
}

export interface DnsStatusResponse {
  cf_configured: boolean
  token_source: '' | 'secret' | 'env' | 'stack-env'
  token_status: 'active' | 'invalid' | 'unreachable' | 'unknown' | string
  domain: string
  zone: DnsZone | null
  zone_found: boolean
  hint: string
}

export interface DnsRecordInput {
  zone?: string
  type: DnsRecordType
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  priority?: number | null
  comment?: string
}

/** GET /routes — List all Traefik routes */
export function fetchRoutes(): Promise<RoutesResponse> {
  return apiClient.get<RoutesResponse>('/routes')
}

/** GET /routes/check?subdomain=xyz — Check subdomain availability */
export function checkSubdomain(subdomain: string): Promise<RouteCheckResponse> {
  return apiClient.get<RouteCheckResponse>(`/routes/check?subdomain=${encodeURIComponent(subdomain)}`)
}

/** PUT /routes/:stack/:service — Update a route's subdomain */
export function updateRoute(stack: string, service: string, subdomain: string): Promise<{ success: boolean; old_subdomain: string; new_subdomain: string }> {
  return apiClient.put<{ success: boolean; old_subdomain: string; new_subdomain: string }>(
    `/routes/${encodeURIComponent(stack)}/${encodeURIComponent(service)}`,
    { subdomain },
  )
}

/** DELETE /routes/:stack/:service — Delete a route and clean up DNS */
export function deleteRoute(stack: string, service: string): Promise<{ success: boolean; deleted: string }> {
  return apiClient.delete<{ success: boolean; deleted: string }>(
    `/routes/${encodeURIComponent(stack)}/${encodeURIComponent(service)}`,
  )
}

/** GET /dns/records — Records of the zone (all types) with DCS route links */
export function fetchDnsRecords(opts: { zone?: string; type?: string; search?: string } = {}): Promise<DnsRecordsResponse> {
  const params = new URLSearchParams()
  if (opts.zone) params.set('zone', opts.zone)
  if (opts.type) params.set('type', opts.type)
  if (opts.search) params.set('search', opts.search)
  const qs = params.toString()
  return apiClient.get<DnsRecordsResponse>(`/dns/records${qs ? `?${qs}` : ''}`)
}

/** GET /dns/status — Token source and validity, zone details */
export function fetchDnsStatus(): Promise<DnsStatusResponse> {
  return apiClient.get<DnsStatusResponse>('/dns/status')
}

/** GET /dns/zones — Zones the token can manage */
export function fetchDnsZones(): Promise<{ zones: DnsZone[]; total: number }> {
  return apiClient.get<{ zones: DnsZone[]; total: number }>('/dns/zones')
}

/** POST /dns/records — Create a record */
export function createDnsRecord(input: DnsRecordInput): Promise<{ success: boolean; record: DnsRecord }> {
  return apiClient.post<{ success: boolean; record: DnsRecord }>('/dns/records', input)
}

/** PUT /dns/records/:id — Change a record (partial body allowed) */
export function updateDnsRecord(id: string, input: Partial<DnsRecordInput>): Promise<{ success: boolean; record: DnsRecord }> {
  return apiClient.put<{ success: boolean; record: DnsRecord }>(`/dns/records/${encodeURIComponent(id)}`, input)
}

/** DELETE /dns/records/:id — Delete a record; force removes protected ones */
export function deleteDnsRecord(id: string, opts: { zone?: string; force?: boolean } = {}): Promise<{ success: boolean; id: string; name: string; type: string; forced: boolean }> {
  const params = new URLSearchParams()
  if (opts.zone) params.set('zone', opts.zone)
  if (opts.force) params.set('force', 'true')
  const qs = params.toString()
  return apiClient.delete<{ success: boolean; id: string; name: string; type: string; forced: boolean }>(`/dns/records/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`)
}

/** POST /dns/records/sync — Create the CNAMEs that DCS routes are missing */
export function syncDnsRecords(): Promise<{ success: boolean; created: string[]; failed: { name: string; error: string }[]; zone: string }> {
  return apiClient.post<{ success: boolean; created: string[]; failed: { name: string; error: string }[]; zone: string }>('/dns/records/sync')
}

/** GET /homarr/status — Check if Homarr is deployed with API key */
export function fetchHomarrStatus(): Promise<{ active: boolean; has_api_key: boolean; url: string }> {
  return apiClient.get<{ active: boolean; has_api_key: boolean; url: string }>('/homarr/status')
}

/** GET /plugins/cards — List all available plugin cards */
export function fetchPluginCards(): Promise<PluginCardsResponse> {
  return apiClient.get<PluginCardsResponse>('/plugins/cards')
}

/** POST /stacks/:name/compose/rollback — Rollback compose file */
export function rollbackCompose(name: string, versionId: string): Promise<ComposeRollbackResponse> {
  return apiClient.post<ComposeRollbackResponse>(
    `/stacks/${encodeURIComponent(name)}/compose/rollback`,
    { version_id: versionId },
  )
}

/** GET /templates — List available templates */
export function fetchTemplates(): Promise<TemplateListResponse> {
  return apiClient.get<TemplateListResponse>('/templates')
}

/** GET /templates/:name — Template detail */
export function fetchTemplateDetail(name: string): Promise<TemplateDetailResponse> {
  return apiClient.get<TemplateDetailResponse>(`/templates/${encodeURIComponent(name)}`)
}

/** POST /templates/:name/deploy — Deploy (merge) a template into an existing stack */
export function deployTemplate(name: string, opts: {
  target_stack: string
  variables?: Record<string, string>
  auto_start?: boolean
  replace_services?: boolean
  exclude_services?: string[]
  custom_routes?: Record<string, string>
  connect_proxy?: boolean
  resource_limits?: { mem_limit?: string; cpus?: number }
  add_to_homarr?: boolean
  allow_privileged?: boolean
  /** Container names chosen on the deploy screen, keyed by service */
  container_names?: Record<string, string>
  /** services whose route is protected by Authelia */
  authelia_services?: string[]
  /** services Sablier starts on demand (route carries the middleware) */
  on_demand_services?: string[]
  /** false: no route, no DNS record and no proxy network for this deploy (the API otherwise gives every service a default route) */
  routes?: boolean
  /** only these services get a route; an empty list sent on purpose means none */
  route_services?: string[]
  /** one of this server's domains for the routes (a hub stack; default its own) */
  domain?: string
  /** a graphics card's PCI slot (GET /status → system.gpus[].slot) for the template's gpu services */
  gpu?: string
}, member?: string | null): Promise<TemplateDeployResponse> {
  // a first deploy pulls every image and Authelia hashes its secrets: well past the usual 30 s
  return apiClient.post<TemplateDeployResponse>(memberPath(member, `/templates/${encodeURIComponent(name)}/deploy`), opts, 600000)
}

/** POST /templates/import — Import a custom template */
export function importTemplate(opts: {
  name: string
  compose: string
  metadata?: Record<string, unknown>
  env?: string
}): Promise<TemplateImportResponse> {
  return apiClient.post<TemplateImportResponse>('/templates/import', opts)
}

/** POST /templates/:name/update — Update an existing template */
export function updateTemplate(name: string, opts: {
  compose?: string
  metadata?: Record<string, unknown>
  env?: string
}): Promise<TemplateUpdateResponse> {
  return apiClient.post<TemplateUpdateResponse>(
    `/templates/${encodeURIComponent(name)}/update`,
    opts,
  )
}

/** DELETE /templates/:name — Delete a template */
export function deleteTemplate(name: string): Promise<TemplateDeleteResponse> {
  return apiClient.delete<TemplateDeleteResponse>(
    `/templates/${encodeURIComponent(name)}`,
  )
}

/** GET /templates/deploy-history — Deployment audit log */
export function fetchDeployHistory(): Promise<DeployHistoryResponse> {
  return apiClient.get<DeployHistoryResponse>('/templates/deploy-history')
}

/** POST /templates/:name/undeploy — Remove deployed services from a stack */
export function undeployTemplate(name: string, opts: {
  target_stack: string; services: string[]; remove_containers?: boolean; remove_data?: boolean
}, member?: string | null): Promise<TemplateUndeployResponse> {
  return apiClient.post<TemplateUndeployResponse>(memberPath(member, `/templates/${encodeURIComponent(name)}/undeploy`), opts, 120000)
}

/** POST /templates/:name/dry-run — Preview deployment without writing */
export function dryRunTemplate(name: string, opts: {
  target_stack: string; variables?: Record<string, string>; exclude_services?: string[]
  /** the same routing choice the deploy sends (see deployTemplate) */
  routes?: boolean; route_services?: string[]
}, member?: string | null): Promise<TemplateDryRunResponse> {
  return apiClient.post<TemplateDryRunResponse>(memberPath(member, `/templates/${encodeURIComponent(name)}/dry-run`), opts, member ? 60000 : undefined)
}

/** GET /automations — List automation rules */
/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchAutomations(scope?: string | null): Promise<AutomationListResponse> {
  if (scope === 'all') return apiClient.get<AutomationListResponse>('/automations?fleet=1')
  return apiClient.get<AutomationListResponse>(memberPath(scope === 'hub' ? null : scope, '/automations'))
}

/** POST /automations — Create an automation rule */
export function createAutomation(rule: {
  name: string
  trigger_type: string
  trigger_value?: string
  action_type: string
  action_target?: string
  enabled?: boolean
  threshold?: number | null
  cooldown?: number | null
}, member?: string | null): Promise<AutomationRule> {
  return apiClient.post<AutomationRule>(memberPath(member, '/automations'), rule)
}

/** POST /automations/:id/update — Update an automation rule */
export function updateAutomation(id: string, updates: Partial<AutomationRule>, member?: string | null): Promise<AutomationRule> {
  return apiClient.post<AutomationRule>(memberPath(member, `/automations/${encodeURIComponent(id)}/update`), updates)
}

/** DELETE /automations/:id — Delete an automation rule */
export function deleteAutomation(id: string, member?: string | null): Promise<{ success: boolean; deleted: string }> {
  return apiClient.delete<{ success: boolean; deleted: string }>(memberPath(member, `/automations/${encodeURIComponent(id)}`))
}

/** POST /automations/:id/run — Run an automation now (admin; the server runs the action before it answers, so longer than the 30 s default) */
export function runAutomation(id: string, member?: string | null): Promise<{ success: boolean; id: string; action: string; message: string }> {
  return apiClient.post(memberPath(member, `/automations/${encodeURIComponent(id)}/run`), undefined, 120000)
}

/** GET /automations/:id/history — Automation run history (asked on the fleet member that owns the rule when one is given) */
export function fetchAutomationHistory(id: string, member?: string | null): Promise<AutomationHistoryResponse> {
  return apiClient.get<AutomationHistoryResponse>(memberPath(member, `/automations/${encodeURIComponent(id)}/history`))
}

/** GET /topology — Network topology graph data */
export function fetchTopology(): Promise<TopologyResponse> {
  return apiClient.get<TopologyResponse>('/topology')
}

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

/** GET /setup/status — Check if server needs first-run setup (no auth) */
export function fetchSetupStatus(): Promise<SetupStatusResponse> {
  return apiClient.get<SetupStatusResponse>('/setup/status')
}

/** GET /setup/defaults — Get setup defaults and system info (no auth, setup mode only) */
export function fetchSetupDefaults(): Promise<SetupDefaultsResponse> {
  return apiClient.get<SetupDefaultsResponse>('/setup/defaults')
}

/** POST /setup/configure — Apply setup configuration (auth required, setup mode only) */
export function setupConfigure(data: SetupConfigureRequest): Promise<SetupConfigureResponse> {
  return apiClient.post<SetupConfigureResponse>('/setup/configure', data)
}

/** POST /setup/complete — Finalize first-run setup (auth required, setup mode only) */
export function setupComplete(): Promise<SetupCompleteResponse> {
  return apiClient.post<SetupCompleteResponse>('/setup/complete')
}

/** POST /stacks/rename — Rename a stack directory (admin only) */
export function renameStack(oldName: string, newName: string): Promise<StackRenameResponse> {
  return apiClient.post<StackRenameResponse>('/stacks/rename', { old_name: oldName, new_name: newName })
}

/** POST /stacks/reorder — Set stack startup order (admin only) */
export function reorderStacks(stacks: string[]): Promise<StackReorderResponse> {
  return apiClient.post<StackReorderResponse>('/stacks/reorder', { stacks })
}

// ---------------------------------------------------------------------------
// Metrics History
// ---------------------------------------------------------------------------

export function fetchMetricsHistory(range: string = '24h'): Promise<MetricsHistoryResponse> {
  return apiClient.get<MetricsHistoryResponse>(`/metrics/history?range=${encodeURIComponent(range)}`)
}

export function fetchMetricsSummary(range: string = '24h'): Promise<MetricsSummaryResponse> {
  return apiClient.get<MetricsSummaryResponse>(`/metrics/summary?range=${encodeURIComponent(range)}`)
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export function fetchRollbackSnapshots(stack: string): Promise<RollbackSnapshotsResponse> {
  return apiClient.get<RollbackSnapshotsResponse>(`/rollback/${encodeURIComponent(stack)}/snapshots`)
}

export function fetchRollbackSnapshot(stack: string, id: string): Promise<RollbackSnapshotDetail> {
  return apiClient.get<RollbackSnapshotDetail>(`/rollback/${encodeURIComponent(stack)}/snapshots/${encodeURIComponent(id)}`)
}

export function restoreRollbackSnapshot(stack: string, snapshotId: string): Promise<RollbackRestoreResponse> {
  return apiClient.post<RollbackRestoreResponse>(`/rollback/${encodeURIComponent(stack)}/restore`, { snapshot_id: snapshotId }, 120000)
}

export function fetchRollbackDiff(stack: string, id: string): Promise<RollbackDiffResponse> {
  return apiClient.get<RollbackDiffResponse>(`/rollback/${encodeURIComponent(stack)}/diff/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchSecrets(scope?: string | null): Promise<SecretsListResponse> {
  if (scope === 'all') return apiClient.get<SecretsListResponse>('/secrets?fleet=1')
  return apiClient.get<SecretsListResponse>(memberPath(scope === 'hub' ? null : scope, '/secrets'))
}

export function setSecret(key: string, value: string, member?: string | null): Promise<SecretSetResponse> {
  return apiClient.post<SecretSetResponse>(memberPath(member, `/secrets/${encodeURIComponent(key)}`), { value })
}

export function deleteSecret(key: string, member?: string | null): Promise<SecretDeleteResponse> {
  return apiClient.delete<SecretDeleteResponse>(memberPath(member, `/secrets/${encodeURIComponent(key)}`))
}

export function checkSecretExists(key: string): Promise<SecretExistsResponse> {
  return apiClient.get<SecretExistsResponse>(`/secrets/${encodeURIComponent(key)}/exists`)
}

/** GET /secrets/:key/references — Stacks and env files that reference a secret */
export function fetchSecretReferences(key: string, member?: string | null): Promise<SecretReferencesResponse> {
  return apiClient.get<SecretReferencesResponse>(memberPath(member, `/secrets/${encodeURIComponent(key)}/references`))
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/** on a hub, scope 'all' merges every VM (?fleet=1) and a member id asks that VM */
export function fetchSchedules(scope?: string | null): Promise<ScheduleListResponse> {
  if (scope === 'all') return apiClient.get<ScheduleListResponse>('/schedules?fleet=1')
  return apiClient.get<ScheduleListResponse>(memberPath(scope === 'hub' ? null : scope, '/schedules'))
}

export function createSchedule(schedule: { name: string; schedule: string; action: string; target?: string }, member?: string | null): Promise<ScheduleCreateResponse> {
  return apiClient.post<ScheduleCreateResponse>(memberPath(member, '/schedules'), schedule)
}

export function updateSchedule(id: string, updates: Partial<Schedule>, member?: string | null): Promise<Schedule> {
  return apiClient.post<Schedule>(memberPath(member, `/schedules/${encodeURIComponent(id)}/update`), updates)
}

export function deleteSchedule(id: string, member?: string | null): Promise<{ success: boolean; deleted: string }> {
  return apiClient.delete<{ success: boolean; deleted: string }>(memberPath(member, `/schedules/${encodeURIComponent(id)}`))
}

export function toggleSchedule(id: string, member?: string | null): Promise<Schedule> {
  return apiClient.post<Schedule>(memberPath(member, `/schedules/${encodeURIComponent(id)}/toggle`))
}

/** GET /schedules/:id/history — asked on the fleet member that owns the schedule when one is given (a VM's runs are not on the hub) */
export function fetchScheduleHistory(id: string, member?: string | null): Promise<ScheduleHistoryResponse> {
  return apiClient.get<ScheduleHistoryResponse>(memberPath(member, `/schedules/${encodeURIComponent(id)}/history`))
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

/** GET /health/score — this server's; on a hub, scope 'all' folds every VM in (?fleet=1) and a member id asks that VM */
export function fetchHealthScore(scope?: string | null): Promise<HealthScoreResponse> {
  if (scope === 'all') return apiClient.get<HealthScoreResponse>('/health/score?fleet=1')
  return apiClient.get<HealthScoreResponse>(memberPath(scope === 'hub' ? null : scope, '/health/score'))
}

export function fetchStackHealthScore(stack: string): Promise<StackHealthScore> {
  return apiClient.get<StackHealthScore>(`/health/score/${encodeURIComponent(stack)}`)
}

export function fetchHealthScoreHistory(range: string = '24h'): Promise<HealthScoreHistoryResponse> {
  return apiClient.get<HealthScoreHistoryResponse>(`/health/score/history?range=${encodeURIComponent(range)}`)
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/** GET /plugins/catalog — Plugins shipped with DCS that can be installed */
export function fetchPluginCatalog(): Promise<PluginCatalogResponse> {
  return apiClient.get<PluginCatalogResponse>('/plugins/catalog')
}

/** POST /plugins/catalog/:name/install — Install a catalogue plugin (installed disabled) */
export function installCatalogPlugin(name: string): Promise<{ success: boolean; plugin: Plugin; message: string }> {
  return apiClient.post(`/plugins/catalog/${encodeURIComponent(name)}/install`)
}

export function fetchPlugins(): Promise<PluginListResponse> {
  return apiClient.get<PluginListResponse>('/plugins')
}

export function installPlugin(source: string): Promise<PluginInstallResponse> {
  return apiClient.post<PluginInstallResponse>('/plugins/install', { url: source })
}

export function scaffoldPlugin(definition: {
  name: string
  description?: string
  version?: string
  author?: string
  manifest?: Record<string, unknown>
  hooks?: Record<string, string>
  cards?: Record<string, { meta: Record<string, unknown>; html: string }>
}): Promise<PluginInstallResponse> {
  return apiClient.post<PluginInstallResponse>('/plugins/scaffold', definition)
}

export function removePlugin(name: string): Promise<PluginDeleteResponse> {
  return apiClient.delete<PluginDeleteResponse>(`/plugins/${encodeURIComponent(name)}`)
}

export function togglePlugin(name: string): Promise<Plugin> {
  return apiClient.post<Plugin>(`/plugins/${encodeURIComponent(name)}/toggle`)
}

/** GET /plugins/:name/hooks — List hooks with metadata */
export function fetchPluginHooks(name: string): Promise<PluginHooksListResponse> {
  return apiClient.get<PluginHooksListResponse>(`/plugins/${encodeURIComponent(name)}/hooks`)
}

/** GET /plugins/:name/hooks/:hook — Read hook script content */
export function fetchPluginHookContent(name: string, hook: string): Promise<PluginHookContentResponse> {
  return apiClient.get<PluginHookContentResponse>(`/plugins/${encodeURIComponent(name)}/hooks/${encodeURIComponent(hook)}`)
}

/** POST /plugins/:name/hooks/:hook/update — Update hook script */
export function updatePluginHook(name: string, hook: string, content: string): Promise<PluginHookUpdateResponse> {
  return apiClient.post<PluginHookUpdateResponse>(`/plugins/${encodeURIComponent(name)}/hooks/${encodeURIComponent(hook)}/update`, { content })
}

/** POST /plugins/:name/hooks/:hook/test — Dry-run a hook */
export function testPluginHook(name: string, hook: string, context?: Record<string, unknown>): Promise<PluginHookTestResponse> {
  return apiClient.post<PluginHookTestResponse>(`/plugins/${encodeURIComponent(name)}/hooks/${encodeURIComponent(hook)}/test`, { context }, 60000)
}

/** GET /plugins/:name/logs — Execution history */
export function fetchPluginLogs(name: string): Promise<PluginLogsResponse> {
  return apiClient.get<PluginLogsResponse>(`/plugins/${encodeURIComponent(name)}/logs`)
}

/** POST /plugins/:name/config — Update plugin configuration */
export function updatePluginConfig(name: string, config: Record<string, unknown>): Promise<PluginConfigUpdateResponse> {
  return apiClient.post<PluginConfigUpdateResponse>(`/plugins/${encodeURIComponent(name)}/config`, { config })
}

// ---------------------------------------------------------------------------
// Config Schema & Dependency Graph
// ---------------------------------------------------------------------------

export function fetchConfigSchema(): Promise<ConfigSchemaResponse> {
  return apiClient.get<ConfigSchemaResponse>('/config/schema')
}

export function fetchDependencyGraph(): Promise<DependencyGraphResponse> {
  return apiClient.get<DependencyGraphResponse>('/stacks/dependency-graph')
}

// ---------------------------------------------------------------------------
// v4.1: URL Import, Gallery, Clone, Image Search, Validation, Export, Audit, Webhooks
// ---------------------------------------------------------------------------

/** POST /templates/fetch-url — Fetch compose content from URL without saving */
export function fetchTemplateUrl(url: string): Promise<{ content: string; url: string }> {
  return apiClient.post<{ content: string; url: string }>('/templates/fetch-url', { url })
}

/** POST /templates/import-url — Import a template from a URL */
export function importTemplateFromUrl(url: string, name?: string): Promise<TemplateImportUrlResponse> {
  return apiClient.post<TemplateImportUrlResponse>('/templates/import-url', { url, name })
}

/** GET /templates/gallery — Browse curated template catalog */
export function fetchTemplateGallery(category?: string): Promise<TemplateGalleryResponse> {
  const params = category ? `?category=${encodeURIComponent(category)}` : ''
  return apiClient.get<TemplateGalleryResponse>(`/templates/gallery${params}`)
}

/** POST /stacks/:name/clone — Clone a stack */
export function cloneStack(name: string, newName: string): Promise<StackCloneResponse> {
  return apiClient.post<StackCloneResponse>(`/stacks/${encodeURIComponent(name)}/clone`, { new_name: newName })
}

/** GET /images/search — Search Docker Hub */
export function searchImages(query: string, limit?: number): Promise<ImageSearchResponse> {
  const params = new URLSearchParams({ q: query })
  if (limit) params.set('limit', String(limit))
  return apiClient.get<ImageSearchResponse>(`/images/search?${params}`)
}

/** POST /compose/validate — Validate compose YAML */
export function validateCompose(opts: { content?: string; stack?: string }): Promise<ComposeValidateFullResponse> {
  return apiClient.post<ComposeValidateFullResponse>('/compose/validate', opts)
}

/** GET /export/:type — Export system data */
export function exportData(type: 'health' | 'system' | 'config'): Promise<ExportResponse> {
  return apiClient.get<ExportResponse>(`/export/${type}`)
}

/** GET /audit — Fetch audit log */
export function fetchAuditLog(opts?: { limit?: number; action?: string }, scope?: string | null): Promise<AuditLogResponse> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.action) params.set('action', opts.action)
  if (scope === 'all') params.set('fleet', '1')
  const q = params.toString()
  return apiClient.get<AuditLogResponse>(memberPath(scope === 'all' || scope === 'hub' ? null : scope, `/audit${q ? `?${q}` : ''}`))
}

/** GET /webhooks — List configured webhooks */
export function fetchWebhooks(): Promise<WebhookListResponse> {
  return apiClient.get<WebhookListResponse>('/webhooks')
}

/** POST /webhooks — Create a webhook */
export function createWebhook(config: { url: string; events?: string[]; enabled?: boolean }): Promise<WebhookCreateResponse> {
  return apiClient.post<WebhookCreateResponse>('/webhooks', config)
}

/** DELETE /webhooks/:id — Delete a webhook */
export function deleteWebhook(id: string): Promise<WebhookDeleteResponse> {
  return apiClient.delete<WebhookDeleteResponse>(`/webhooks/${encodeURIComponent(id)}`)
}

/** POST /webhooks/:id/test — Test a webhook */
export function testWebhook(id: string): Promise<WebhookTestResponse> {
  return apiClient.post<WebhookTestResponse>(`/webhooks/${encodeURIComponent(id)}/test`, {})
}

/** POST /images/pull — Pull an image from Docker Hub */
export function pullImage(image: string, member?: string | null): Promise<ImagePullResponse> {
  return apiClient.post<ImagePullResponse>(memberPath(member, '/images/pull'), { image }, 600000)   // a pull takes as long as the registry does
}

// ---------------------------------------------------------------------------
// System Updates
// ---------------------------------------------------------------------------

/** GET /system/update/check — Newer DCS release on the channel, release notes, local edits, restart support */
export function checkSystemUpdate(): Promise<SystemUpdateCheckResponse> {
  return apiClient.get<SystemUpdateCheckResponse>('/system/update/check')
}

/** POST /system/update/apply — Update to the channel's release; user files are kept, a backup tag allows rollback */
export function applySystemUpdate(opts: { replaceLocal?: boolean; restart?: boolean; /** a hub: then bring the VMs to the new version */ fleet?: boolean } = {}): Promise<SystemUpdateApplyResponse> {
  return apiClient.post<SystemUpdateApplyResponse>('/system/update/apply', { confirm: true, replace_local: !!opts.replaceLocal, restart: !!opts.restart, fleet: !!opts.fleet }, 180000)
}

/** POST /system/update/rollback — Return to a backup tag; user files are kept */
export function rollbackSystemUpdate(backupTag: string, restart = false): Promise<SystemUpdateRollbackResponse> {
  return apiClient.post<SystemUpdateRollbackResponse>('/system/update/rollback', { backup_tag: backupTag, restart }, 120000)
}

/** POST /system/restart — Restart the API listener without root (re-exec, or a systemd relaunch for older listeners) */
export function restartApiServer(): Promise<SystemRestartResponse> {
  return apiClient.post<SystemRestartResponse>('/system/restart', {}, 20000)
}

/** GET /system/update/history — Outcomes of unattended self-updates */
export function fetchSystemUpdateHistory(): Promise<SystemUpdateHistoryResponse> {
  return apiClient.get<SystemUpdateHistoryResponse>('/system/update/history')
}

// ---------------------------------------------------------------------------
// Power (UPS)
// ---------------------------------------------------------------------------

/** GET /power — UPS status: mains or battery, charge, runtime, load */
export function fetchPower(): Promise<PowerStatus> {
  return apiClient.get<PowerStatus>('/power')
}

/** POST /sablier/repair — Recreate on-demand containers a prune removed (created, not started); in a VM of the fleet with member */
export function repairOnDemand(member?: string | null): Promise<{ success: boolean; recreated: string[]; failed: string[]; message: string }> {
  return apiClient.post<{ success: boolean; recreated: string[]; failed: string[]; message: string }>(memberPath(member, '/sablier/repair'), {}, 120000)
}

/** POST /power/sample — Read the UPS right now */
export function samplePower(): Promise<PowerStatus> {
  return apiClient.post<PowerStatus>('/power/sample', {}, 20000)
}

// ---------------------------------------------------------------------------
// Recovery bundles
// ---------------------------------------------------------------------------

/** GET /recovery — bundles on this box and how they are made */
export function fetchRecovery(): Promise<RecoveryListResponse> {
  return apiClient.get<RecoveryListResponse>('/recovery')
}

/** POST /recovery/bundle — write an encrypted recovery bundle now */
export function createRecoveryBundle(opts: { passphrase?: string; include_app_data?: string[]; copy_remote?: boolean }): Promise<RecoveryBundleResponse> {
  return apiClient.post<RecoveryBundleResponse>('/recovery/bundle', opts, 900000)
}

/** POST /recovery/restore — restore a bundle stored on this box (pre-restore snapshot kept) */
export function restoreRecoveryBundle(file: string, passphrase: string, restart = true): Promise<RecoveryRestoreResponse> {
  return apiClient.post<RecoveryRestoreResponse>('/recovery/restore', { file, passphrase, confirm: true, restart }, 300000)
}

/** POST /recovery/upload — store a bundle picked in the browser */
export function uploadRecoveryBundle(filename: string, contentB64: string): Promise<{ success: boolean; file: string; size: number }> {
  return apiClient.post<{ success: boolean; file: string; size: number }>('/recovery/upload', { filename, content_b64: contentB64 }, 300000)
}

/** POST /setup/restore — first run only: restore a bundle from the setup wizard */
export function setupRestore(contentB64: string, passphrase: string): Promise<RecoveryRestoreResponse> {
  return apiClient.post<RecoveryRestoreResponse>('/setup/restore', { content_b64: contentB64, passphrase }, 300000)
}

/** POST /system/ui-update/apply — Pull latest DCS-UI image and recreate container */
export function applyUiUpdate(): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/system/ui-update/apply', {}, 120000)
}

/** POST /system/os-update/check — Check for available OS package updates */
export function checkOsUpdates(terminalToken: string, password?: string): Promise<OsUpdateCheckResponse> {
  return apiClient.post<OsUpdateCheckResponse>('/system/os-update/check', { terminal_token: terminalToken, ...(password ? { password } : {}) }, 120000)
}

/** POST /system/os-update/apply — Start OS package updates (background) */
export function applyOsUpdates(terminalToken: string, password?: string): Promise<OsUpdateApplyResponse> {
  return apiClient.post<OsUpdateApplyResponse>('/system/os-update/apply', { terminal_token: terminalToken, confirm: 'true', ...(password ? { password } : {}) }, 30000)
}

/** GET /system/os-updates?fleet=1 — every server's own look at its OS updates (the hub first); refresh asks for a new look */
export function fetchOsUpdates(refresh = false): Promise<OsUpdatesResponse> {
  return apiClient.get<OsUpdatesResponse>(`/system/os-updates?fleet=1${refresh ? '&refresh=1' : ''}`)
}

/** GET /system/os-update/status — Poll background OS update status */
export function getOsUpdateStatus(): Promise<OsUpdateStatusResponse> {
  return apiClient.get<OsUpdateStatusResponse>('/system/os-update/status')
}

// ---------------------------------------------------------------------------
// CrowdSec (the dashboard card, and the CrowdSec page — every call may name a fleet member)
// ---------------------------------------------------------------------------

/** an address or network for a URL path: only the characters an address has, the slash of a range stays a slash */
function csAddr(v: string): string {
  return v.replace(/[^0-9a-fA-F:./]/g, '')
}
function csQuery(q: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/** GET /crowdsec/status — which state CrowdSec is in, what is wrong and how to fix it, and the numbers for the status strip */
export function crowdsecStatus(member?: string | null): Promise<CrowdSecStatusResponse> {
  return apiClient.get<CrowdSecStatusResponse>(memberPath(member, '/crowdsec/status'))
}

/** POST /crowdsec/unban-me — remove bans on the caller's and the home public address */
export function crowdsecUnbanMe(): Promise<{ success: boolean; addresses: string[]; message: string }> {
  return apiClient.post('/crowdsec/unban-me')
}

/** POST /crowdsec/trust — whitelist an address (defaults to the home public address and the caller) */
export function crowdsecTrust(ip?: string): Promise<{ success: boolean; addresses: string[]; synced: boolean; message?: string }> {
  return apiClient.post('/crowdsec/trust', ip ? { ip } : {})
}

/** DELETE /crowdsec/decisions/:value — lift the ban on one address or network */
export function crowdsecUnban(value: string, member?: string | null): Promise<CrowdSecUnbanResponse> {
  return apiClient.delete(memberPath(member, `/crowdsec/decisions/${csAddr(value)}`))
}

/** GET /crowdsec/decisions — active bans, filtered and sorted on the server */
export function crowdsecDecisions(query: CrowdSecDecisionQuery = {}, member?: string | null): Promise<CrowdSecDecisionsResponse> {
  return apiClient.get<CrowdSecDecisionsResponse>(memberPath(member, `/crowdsec/decisions${csQuery({ ...query })}`))
}

/** POST /crowdsec/decisions — ban an address or a network (a duration, or permanent = ten years) */
export function crowdsecBan(body: CrowdSecBanBody, member?: string | null): Promise<CrowdSecBanResponse> {
  return apiClient.post<CrowdSecBanResponse>(memberPath(member, '/crowdsec/decisions'), body, member ? 60000 : undefined)
}

/** POST /crowdsec/decisions/delete — lift several bans at once */
export function crowdsecBulkUnban(body: { ids?: number[]; values?: string[] }, member?: string | null): Promise<CrowdSecBulkDeleteResponse> {
  return apiClient.post<CrowdSecBulkDeleteResponse>(memberPath(member, '/crowdsec/decisions/delete'), body, 120000)
}

/** POST /crowdsec/decisions/import — ban many addresses from CSV, JSON or one address per line */
export function crowdsecImportBans(body: { format?: 'auto' | 'csv' | 'json' | 'values'; content: string; duration?: string; reason?: string; permanent?: boolean }, member?: string | null): Promise<CrowdSecImportResponse> {
  return apiClient.post<CrowdSecImportResponse>(memberPath(member, '/crowdsec/decisions/import'), body, 120000)
}

/** GET /crowdsec/decisions/export — the active bans as CSV or JSON text */
export function crowdsecExportBans(format: 'csv' | 'json', query: CrowdSecDecisionQuery = {}, member?: string | null): Promise<CrowdSecExportResponse> {
  return apiClient.get<CrowdSecExportResponse>(memberPath(member, `/crowdsec/decisions/export${csQuery({ ...query, format })}`))
}

/** GET /crowdsec/alerts — recent detections */
export function crowdsecAlerts(query: { window?: '1h' | '6h' | '24h' | '7d' | '30d'; q?: string; scenario?: string; country?: string; ip?: string; simulated?: 'any' | 'yes' | 'no'; limit?: number; offset?: number } = {}, member?: string | null): Promise<CrowdSecAlertsResponse> {
  return apiClient.get<CrowdSecAlertsResponse>(memberPath(member, `/crowdsec/alerts${csQuery({ ...query })}`))
}

/** GET /crowdsec/alerts/:id — one alert with the requests that raised it */
export function crowdsecAlert(id: number, member?: string | null): Promise<{ alert: CrowdSecAlertDetail }> {
  return apiClient.get<{ alert: CrowdSecAlertDetail }>(memberPath(member, `/crowdsec/alerts/${Math.floor(id)}`))
}

/** GET /crowdsec/allowlist — everything that is never banned */
export function crowdsecAllowlist(member?: string | null): Promise<CrowdSecAllowlistResponse> {
  return apiClient.get<CrowdSecAllowlistResponse>(memberPath(member, '/crowdsec/allowlist'))
}
/** POST /crowdsec/allowlist — never ban an address or network */
export function crowdsecAllow(body: CrowdSecAllowAddBody, member?: string | null): Promise<CrowdSecAllowAddResponse> {
  return apiClient.post<CrowdSecAllowAddResponse>(memberPath(member, '/crowdsec/allowlist'), body, member ? 60000 : undefined)
}
/** DELETE /crowdsec/allowlist/:value */
export function crowdsecDisallow(value: string, member?: string | null): Promise<{ success: boolean; value: string; mechanism: string; message: string }> {
  return apiClient.delete(memberPath(member, `/crowdsec/allowlist/${csAddr(value)}`))
}

/** GET /crowdsec/bouncers */
export function crowdsecBouncers(member?: string | null): Promise<CrowdSecBouncersResponse> {
  return apiClient.get<CrowdSecBouncersResponse>(memberPath(member, '/crowdsec/bouncers'))
}
/** GET /crowdsec/machines */
export function crowdsecMachines(member?: string | null): Promise<CrowdSecMachinesResponse> {
  return apiClient.get<CrowdSecMachinesResponse>(memberPath(member, '/crowdsec/machines'))
}
/** POST /crowdsec/bouncers — register a bouncer; the API key is in the answer, once */
export function crowdsecAddBouncer(name: string, member?: string | null): Promise<CrowdSecBouncerAddResponse> {
  return apiClient.post<CrowdSecBouncerAddResponse>(memberPath(member, '/crowdsec/bouncers'), { name })
}
/** DELETE /crowdsec/bouncers/:name */
export function crowdsecDeleteBouncer(name: string, member?: string | null): Promise<{ success: boolean; name: string; was_dcs_bouncer: boolean; message: string }> {
  return apiClient.delete(memberPath(member, `/crowdsec/bouncers/${encodeURIComponent(name)}`))
}
/** POST /crowdsec/bouncers/register-traefik — the fix for "bans are not enforced at the proxy" */
export function crowdsecRegisterTraefikBouncer(member?: string | null): Promise<{ success: boolean; name: string; message: string }> {
  return apiClient.post(memberPath(member, '/crowdsec/bouncers/register-traefik'), undefined, 120000)
}

/** GET /crowdsec/metrics — what has been happening (window 24h, 7d or 30d) */
export function crowdsecMetrics(window: '24h' | '7d' | '30d' = '24h', member?: string | null): Promise<CrowdSecMetricsResponse> {
  return apiClient.get<CrowdSecMetricsResponse>(memberPath(member, `/crowdsec/metrics${csQuery({ window })}`))
}

/** GET /crowdsec/hub — installed collections, scenarios, parsers and suggestions */
export function crowdsecHub(member?: string | null): Promise<CrowdSecHubResponse> {
  return apiClient.get<CrowdSecHubResponse>(memberPath(member, '/crowdsec/hub'))
}
/** GET /crowdsec/hub?type=&available=1 — what can be installed */
export function crowdsecHubAvailable(type: 'collections' | 'scenarios' | 'parsers', q = '', limit = 40, member?: string | null): Promise<CrowdSecHubAvailableResponse> {
  return apiClient.get<CrowdSecHubAvailableResponse>(memberPath(member, `/crowdsec/hub${csQuery({ type, available: 1, q, limit })}`))
}
/** POST /crowdsec/hub/update and /upgrade, /install, /remove */
export function crowdsecHubUpdate(member?: string | null): Promise<CrowdSecHubChangeResponse> {
  return apiClient.post(memberPath(member, '/crowdsec/hub/update'), undefined, 150000)
}
export function crowdsecHubUpgrade(member?: string | null): Promise<CrowdSecHubChangeResponse> {
  return apiClient.post(memberPath(member, '/crowdsec/hub/upgrade'), undefined, 240000)
}
export function crowdsecHubInstall(type: 'collections' | 'scenarios' | 'parsers', name: string, member?: string | null): Promise<CrowdSecHubChangeResponse> {
  return apiClient.post(memberPath(member, '/crowdsec/hub/install'), { type, name }, 200000)
}
export function crowdsecHubRemove(type: 'collections' | 'scenarios' | 'parsers', name: string, member?: string | null): Promise<CrowdSecHubChangeResponse> {
  return apiClient.post(memberPath(member, '/crowdsec/hub/remove'), { type, name }, 200000)
}

/** GET /crowdsec/logs — the tail of the container's log */
export function crowdsecLogs(opts: { lines?: number; level?: 'all' | 'warn' | 'error'; q?: string; lapi?: boolean } = {}, member?: string | null): Promise<CrowdSecLogsResponse> {
  return apiClient.get<CrowdSecLogsResponse>(memberPath(member, `/crowdsec/logs${csQuery({ lines: opts.lines, level: opts.level, q: opts.q, lapi: opts.lapi ? 1 : undefined })}`))
}

/** GET /crowdsec/simulation and POST — scenarios that alert without banning */
export function crowdsecSimulation(member?: string | null): Promise<CrowdSecSimulationResponse> {
  return apiClient.get<CrowdSecSimulationResponse>(memberPath(member, '/crowdsec/simulation'))
}
export function crowdsecSetSimulation(body: { scenario?: string; global?: boolean; enabled: boolean }, member?: string | null): Promise<CrowdSecSimulationSetResponse> {
  return apiClient.post<CrowdSecSimulationSetResponse>(memberPath(member, '/crowdsec/simulation'), body, 60000)
}

/** GET /crowdsec/community — community blocklist and console */
export function crowdsecCommunity(member?: string | null): Promise<CrowdSecCommunityResponse> {
  return apiClient.get<CrowdSecCommunityResponse>(memberPath(member, '/crowdsec/community'))
}
/** POST /crowdsec/community/register — register the engine with the community again (CrowdSec restarts, so the timeout is long) */
export function crowdsecCommunityRegister(member?: string | null): Promise<CrowdSecCommunityRegisterResponse> {
  return apiClient.post<CrowdSecCommunityRegisterResponse>(memberPath(member, '/crowdsec/community/register'), undefined, 180000)
}
/** POST /crowdsec/console/enroll — enrol the engine in the CrowdSec Console with a key from app.crowdsec.net */
export function crowdsecConsoleEnroll(body: CrowdSecConsoleEnrollBody, member?: string | null): Promise<CrowdSecConsoleEnrollResponse> {
  return apiClient.post<CrowdSecConsoleEnrollResponse>(memberPath(member, '/crowdsec/console/enroll'), body, 120000)
}

/** GET /crowdsec/settings and PUT — the ban profile (restarts CrowdSec, so the timeout is long) */
export function crowdsecSettings(member?: string | null): Promise<CrowdSecSettingsResponse> {
  return apiClient.get<CrowdSecSettingsResponse>(memberPath(member, '/crowdsec/settings'))
}
export function crowdsecSaveSettings(body: CrowdSecSettingsBody, member?: string | null): Promise<CrowdSecSettingsResponse> {
  return apiClient.put<CrowdSecSettingsResponse>(memberPath(member, '/crowdsec/settings'), body, 180000)
}

/** GET /crowdsec/notifications, PUT, and the preview / test / reset calls — the Discord alerts */
export function crowdsecNotify(member?: string | null): Promise<CrowdSecNotifyResponse> {
  return apiClient.get<CrowdSecNotifyResponse>(memberPath(member, '/crowdsec/notifications'))
}
export function crowdsecSaveNotify(body: CrowdSecNotifyBody, member?: string | null): Promise<CrowdSecNotifyResponse> {
  return apiClient.put<CrowdSecNotifyResponse>(memberPath(member, '/crowdsec/notifications'), body, 180000)
}
export function crowdsecPreviewNotify(body: { settings?: CrowdSecNotifyBody['settings']; sample?: string; alert_id?: number }, member?: string | null): Promise<CrowdSecPreviewResponse> {
  return apiClient.post<CrowdSecPreviewResponse>(memberPath(member, '/crowdsec/notifications/preview'), body, 30000)
}
export function crowdsecTestNotify(body: { settings?: CrowdSecNotifyBody['settings']; sample?: string; webhook_url?: string; include_mention?: boolean }, member?: string | null): Promise<CrowdSecNotifyTestResponse> {
  return apiClient.post<CrowdSecNotifyTestResponse>(memberPath(member, '/crowdsec/notifications/test'), body, 45000)
}
export function crowdsecResetNotify(member?: string | null): Promise<CrowdSecNotifyResponse> {
  return apiClient.post<CrowdSecNotifyResponse>(memberPath(member, '/crowdsec/notifications/reset'), undefined, 180000)
}

/** GET /crowdsec/plugin and PUT — the Traefik bouncer plugin's settings (written into Traefik's middleware file; Traefik reloads by itself) */
export function crowdsecPlugin(member?: string | null): Promise<CrowdSecPluginResponse> {
  return apiClient.get<CrowdSecPluginResponse>(memberPath(member, '/crowdsec/plugin'))
}
export function crowdsecSavePlugin(settings: Partial<CrowdSecPluginSettings>, member?: string | null): Promise<CrowdSecPluginResponse> {
  return apiClient.put<CrowdSecPluginResponse>(memberPath(member, '/crowdsec/plugin'), { settings }, 60000)
}
/** POST /crowdsec/traefik/restart — Traefik loads a plugin it declares only when it starts */
export function crowdsecRestartTraefik(member?: string | null): Promise<{ success: boolean; message: string }> {
  return apiClient.post(memberPath(member, '/crowdsec/traefik/restart'), undefined, 120000)
}

/** POST /crowdsec/service — start, restart or reload the container */
export function crowdsecService(action: 'start' | 'restart' | 'reload', member?: string | null): Promise<CrowdSecServiceResponse> {
  return apiClient.post<CrowdSecServiceResponse>(memberPath(member, '/crowdsec/service'), { action }, 150000)
}

/** run a fix button the status offered (kind "api") */
export function crowdsecRunFix(fix: CrowdSecFix, member?: string | null): Promise<{ success?: boolean; message?: string }> {
  const path = memberPath(member, fix.path)
  if (fix.method === 'POST') return apiClient.post(path, fix.body ?? undefined, 150000)
  if (fix.method === 'PUT') return apiClient.put(path, fix.body ?? undefined, 150000)
  return apiClient.get(path)
}

// =============================================================================
// Proxmox (3.8)
// =============================================================================

/** GET /proxmox/status — link state, version, node and guest counts */
export function fetchProxmoxStatus(): Promise<ProxmoxStatus> {
  return apiClient.get<ProxmoxStatus>('/proxmox/status')
}

/** GET /proxmox/nodes — every node with CPU, memory, disk and uptime */
export function fetchProxmoxNodes(): Promise<ProxmoxNodesResponse> {
  return apiClient.get<ProxmoxNodesResponse>('/proxmox/nodes')
}

/** GET /proxmox/vms — every VM and LXC container */
export function fetchProxmoxVms(): Promise<ProxmoxVmsResponse> {
  return apiClient.get<ProxmoxVmsResponse>('/proxmox/vms')
}

/** GET /proxmox/vms/:node/:type/:vmid — one guest with its configuration */
export function fetchProxmoxVm(node: string, type: ProxmoxGuestType, vmid: number): Promise<ProxmoxVmDetail> {
  return apiClient.get<ProxmoxVmDetail>(`/proxmox/vms/${encodeURIComponent(node)}/${type}/${vmid}`)
}

/** GET /proxmox/tasks — recent Proxmox tasks */
export function fetchProxmoxTasks(): Promise<ProxmoxTasksResponse> {
  return apiClient.get<ProxmoxTasksResponse>('/proxmox/tasks')
}

/** POST /proxmox/vms/:node/:type/:vmid/:action — start, shutdown, stop, reboot, reset, suspend, resume */
export function proxmoxVmAction(node: string, type: ProxmoxGuestType, vmid: number, action: ProxmoxVmAction): Promise<ProxmoxActionResponse> {
  return apiClient.post<ProxmoxActionResponse>(`/proxmox/vms/${encodeURIComponent(node)}/${type}/${vmid}/${action}`, {}, 60000)
}

/** POST /proxmox/vms/:node/:type/:vmid/resize — more disk (the filesystem of a fleet VM grows at once over the hub's ssh key), cores and memory (restart: reboot so they apply) */
export function proxmoxVmResize(node: string, type: 'qemu' | 'lxc', vmid: number, body: { disk_add_gb?: number; cores?: number; memory_mb?: number; restart?: boolean }): Promise<{ success: boolean; message: string; filesystem: string; applied: string }> {
  return apiClient.post<{ success: boolean; message: string; filesystem: string; applied: string }>(`/proxmox/vms/${encodeURIComponent(node)}/${type}/${vmid}/resize`, body, 240000)
}

/** POST /proxmox/vms/:node/qemu/:vmid/balloon — give a VM a memory balloon (floor: its memory minus a quarter, at most 512 MB — three quarters or more stay with the guest) so Proxmox reports the guest's real use and can reclaim idle memory; takes effect at the next boot */
export function proxmoxVmBalloon(node: string, vmid: number): Promise<ProxmoxBalloonResponse> {
  return apiClient.post<ProxmoxBalloonResponse>(`/proxmox/vms/${encodeURIComponent(node)}/qemu/${vmid}/balloon`, {}, 60000)
}

/** POST /proxmox/test — try a connection with the given values without saving them */
export function proxmoxTest(body: { url?: string; token_id?: string; token_secret?: string; verify_tls?: boolean }): Promise<ProxmoxStatus> {
  return apiClient.post<ProxmoxStatus>('/proxmox/test', body, 30000)
}

// =============================================================================
// Traefik feed (3.8)
// =============================================================================

// =============================================================================
// Fleet (3.9): the hub and its members
// =============================================================================

/** GET /fleet/status — hub, member or standalone; the hub this server joined; a pending join */
export function fetchFleetStatus(): Promise<FleetStatus> {
  return apiClient.get<FleetStatus>('/fleet/status')
}

/** GET /fleet/members — the members this hub manages */
export function fetchFleetMembers(): Promise<FleetMembersResponse> {
  return apiClient.get<FleetMembersResponse>('/fleet/members')
}

/** GET /fleet/members/:id — one member with a live reachability check */
export function fetchFleetMember(id: string): Promise<FleetMember> {
  return apiClient.get<FleetMember>(`/fleet/members/${encodeURIComponent(id)}`)
}

/** POST /fleet/members — add a member by address and an account on it */
export function addFleetMember(body: { url: string; username: string; password: string; name?: string; vmid?: number | null; node?: string | null; type?: string | null; insecure?: boolean }): Promise<FleetMemberResponse> {
  return apiClient.post<FleetMemberResponse>('/fleet/members', body, 90000)
}

/** PUT /fleet/members/:id — rename, re-address or re-map a member */
export function updateFleetMember(id: string, body: { name?: string; url?: string; username?: string; password?: string; vmid?: number | null; node?: string | null; type?: string | null; insecure?: boolean }): Promise<FleetMemberResponse> {
  return apiClient.put<FleetMemberResponse>(`/fleet/members/${encodeURIComponent(id)}`, body)
}

/** DELETE /fleet/members/:id — forget a member; destroy=true also stops and destroys its VM on Proxmox */
export function removeFleetMember(id: string, destroy = false): Promise<{ success: boolean; id: string; vm_destroyed?: boolean }> {
  return apiClient.delete<{ success: boolean; id: string; vm_destroyed?: boolean }>(`/fleet/members/${encodeURIComponent(id)}${destroy ? '?destroy=true' : ''}`)
}

/** GET /feed/status — The dashboard feed: on or off, and its two addresses (admin) */
export function fetchDashboardFeedStatus(): Promise<DashboardFeedStatus> { return apiClient.get<DashboardFeedStatus>('/feed/status') }
/** GET /ssh/access — the VMs, the hub and the ssh keys made so far (admin) */
export function fetchSshAccess(): Promise<SshAccess> { return apiClient.get<SshAccess>('/ssh/access') }
/** POST /ssh/keys — a key of your own on the VMs you tick; the private half is in the answer once, after the password */
export function createSshKey(body: { name: string; members: string[]; password: string; hub_access: boolean; via: 'hub' | 'direct'; hub_host: string }): Promise<SshKeyCreated> {
  return apiClient.post<SshKeyCreated>('/ssh/keys', body, 120000)
}
/** DELETE /ssh/keys/:id — the key is taken off every VM */
export function deleteSshKey(id: string): Promise<{ success: boolean; results: { name: string; removed: boolean }[] }> {
  return apiClient.delete<{ success: boolean; results: { name: string; removed: boolean }[] }>(`/ssh/keys/${encodeURIComponent(id)}`)
}
/** GET /ssh/keys/:id/config — the ssh config for a key as the VMs are now */
export function fetchSshKeyConfig(id: string, via: 'hub' | 'direct', hubHost: string): Promise<{ config: string; config_file: string }> {
  return apiClient.get<{ config: string; config_file: string }>(`/ssh/keys/${encodeURIComponent(id)}/config?via=${via}&hub_host=${encodeURIComponent(hubHost)}`)
}
/** POST /ssh/keys/:id/vms — put an existing key on more VMs */
export function addSshKeyVms(id: string, members: string[]): Promise<{ success: boolean; results: { id: string; name: string; ok: boolean; error: string }[] }> {
  return apiClient.post<{ success: boolean; results: { id: string; name: string; ok: boolean; error: string }[] }>(`/ssh/keys/${encodeURIComponent(id)}/vms`, { members }, 120000)
}
/** GET /auth/keys — the API keys for dashboards and scripts (admin) */
export function fetchApiKeys(): Promise<{ keys: ApiKeyInfo[] }> { return apiClient.get<{ keys: ApiKeyInfo[] }>('/auth/keys') }
/** POST /auth/keys — make a key; the answer holds it once */
export function createApiKey(name: string, role: 'read' | 'operate', expires_days: number): Promise<ApiKeyCreated> {
  return apiClient.post<ApiKeyCreated>('/auth/keys', { name, role, expires_days })
}
/** DELETE /auth/keys/:id — the key stops working at once */
export function deleteApiKey(id: string): Promise<{ success: boolean; message: string }> {
  return apiClient.delete<{ success: boolean; message: string }>(`/auth/keys/${encodeURIComponent(id)}`)
}
/** GET /terminal/web — the web terminal's state (admin) */
export function fetchWebTerminalStatus(): Promise<WebTerminalStatus> { return apiClient.get<WebTerminalStatus>('/terminal/web') }
/** POST /terminal/web/embed — the pages that may show the web terminal in a frame; an empty list takes the permission away */
export function setWebTerminalEmbed(origins: string[]): Promise<{ success: boolean; embed_origins: string[]; message: string }> {
  return apiClient.post('/terminal/web/embed', { origins }, 30000)
}
/** POST /terminal/web/theme — the web terminal's colours and text size; it restarts with them */
export function setWebTerminalTheme(theme: Record<string, string>, font_size: number): Promise<{ success: boolean; message: string }> {
  return apiClient.post('/terminal/web/theme', { theme, font_size }, 60000)
}
/** GET /authelia/second-step — the second step at sign-in to the apps behind Authelia: the setting, what Authelia says now, the apps to choose from */
export function fetchAutheliaSecondStep(): Promise<AutheliaSecondStep> { return apiClient.get<AutheliaSecondStep>('/authelia/second-step') }
/** POST /authelia/second-step — set it (written into Authelia's rules; Authelia restarts to read them) (admin) */
export function setAutheliaSecondStep(mode: AutheliaSecondStep['mode'], apps: string[] = []): Promise<AutheliaSecondStepResult> {
  return apiClient.post<AutheliaSecondStepResult>('/authelia/second-step', mode === 'apps' ? { mode, apps } : { mode }, 30000)
}
/** POST /authelia/second-step/repair — put DCS's registration rule back into an older Authelia's configuration (admin) */
export function repairAutheliaSecondStep(): Promise<AutheliaSecondStepRepair> { return apiClient.post<AutheliaSecondStepRepair>('/authelia/second-step/repair', {}, 30000) }
/** GET /authelia/verification-code — the one-time code Authelia last wrote to its file on the server (admin) */
export function fetchAutheliaVerificationCode(): Promise<AutheliaVerificationCode> { return apiClient.get<AutheliaVerificationCode>('/authelia/verification-code') }
/** POST /feed/token — Switch the dashboard feed on with a new token; the token is answered once (admin) */
export function createDashboardFeedToken(): Promise<{ success: boolean; token: string; message: string }> { return apiClient.post('/feed/token', {}) }
/** DELETE /feed/token — Switch the dashboard feed off (admin) */
export function deleteDashboardFeedToken(): Promise<{ success: boolean; enabled: boolean }> { return apiClient.delete('/feed/token') }
/** GET /fleet/members/:id/folders — The folders of the Proxmox host this VM has (virtiofs), where it mounts them, which containers use them, what could be shared (admin) */
export function fetchMemberFolders(id: string): Promise<MemberFolders> {
  return apiClient.get<MemberFolders>(`/fleet/members/${encodeURIComponent(id)}/folders`)
}
/** GET /fleet/members/:id/folders?op=1 — Only the steps under way (cheap: asks neither Proxmox nor the VM) */
export function fetchMemberFolderOperation(id: string): Promise<{ operation: HostFolderOperation | null }> {
  return apiClient.get<{ operation: HostFolderOperation | null }>(`/fleet/members/${encodeURIComponent(id)}/folders?op=1`)
}
/** POST /fleet/members/:id/folders — Share a folder of the Proxmox host with the VM; answers at once, the steps follow */
export function shareMemberFolder(id: string, body: { name: string; path?: string; mount?: string; readonly?: boolean; restart?: boolean }): Promise<{ success: boolean; started: boolean; folder: string; mount: string; operation: HostFolderOperation | null }> {
  return apiClient.post(`/fleet/members/${encodeURIComponent(id)}/folders`, body)
}
/** DELETE /fleet/members/:id/folders/:name — Take a shared folder from the VM (nothing is deleted on the host) */
export function removeMemberFolder(id: string, name: string, opts: { restart?: boolean; mapping?: boolean } = {}): Promise<{ success: boolean; started: boolean; folder: string; operation: HostFolderOperation | null }> {
  const q = [opts.restart === false ? 'restart=false' : '', opts.mapping ? 'mapping=true' : ''].filter(Boolean).join('&')
  return apiClient.delete(`/fleet/members/${encodeURIComponent(id)}/folders/${encodeURIComponent(name)}${q ? `?${q}` : ''}`)
}
/** POST /fleet/members/:id/folders/:name/mount — Mount a folder the VM has, in the VM, now; restarts the stacks that use it */
export function mountMemberFolder(id: string, name: string, body: { mount?: string; readonly?: boolean } = {}): Promise<{ success: boolean; folder: string; mount: string; restarted: string[]; message: string }> {
  return apiClient.post(`/fleet/members/${encodeURIComponent(id)}/folders/${encodeURIComponent(name)}/mount`, body, 300000)
}
/** POST /fleet/members/:id/folders/:name/use — One volume line more on a service of the VM's stack, and the stack is started again */
export function attachMemberFolder(id: string, name: string, body: { stack: string; service: string; target: string; subfolder?: string; readonly?: boolean; start?: boolean }): Promise<{ success: boolean; changed: boolean; stack: string; service: string; source: string; target: string; message: string }> {
  return apiClient.post(`/fleet/members/${encodeURIComponent(id)}/folders/${encodeURIComponent(name)}/use`, body, 300000)
}

/** GET /proxmox/capabilities — what the API token may do (creating VMs needs more than power); POST with Proxmox values before they are saved */
export function fetchProxmoxCapabilities(pve?: { url: string; token_id: string; token_secret: string; verify_tls: boolean }): Promise<ProxmoxCapabilities> {
  return pve ? apiClient.post<ProxmoxCapabilities>('/proxmox/capabilities', pve, 60000) : apiClient.get<ProxmoxCapabilities>('/proxmox/capabilities')
}

/** GET /proxmox/self — the Proxmox guest this DCS runs in, with the tags it has and the ones it should have (dcs, and hub on a hub) */
export function fetchProxmoxSelf(): Promise<ProxmoxSelf> {
  return apiClient.get<ProxmoxSelf>('/proxmox/self')
}

/** POST /proxmox/self/tag — give that guest its tags now (the API token needs VM.Config.Options on it) */
export function tagProxmoxSelf(): Promise<ProxmoxSelf> {
  return apiClient.post<ProxmoxSelf>('/proxmox/self/tag', {}, 30000)
}

/** GET /proxmox/storage — the node's storages */
export function fetchProxmoxStorage(node?: string): Promise<ProxmoxStorageResponse> {
  return apiClient.get<ProxmoxStorageResponse>(`/proxmox/storage${node ? `?node=${encodeURIComponent(node)}` : ''}`)
}

/** GET /fleet/provision/defaults — prefilled values for creating VMs (POST with Proxmox values before they are saved) */
export function fetchFleetProvisionDefaults(pve?: { url: string; token_id: string; token_secret: string; verify_tls: boolean }): Promise<FleetProvisionDefaults> {
  return pve ? apiClient.post<FleetProvisionDefaults>('/fleet/provision/defaults', pve, 60000) : apiClient.get<FleetProvisionDefaults>('/fleet/provision/defaults')
}

/** GET /fleet/provision/move-check — what a move of this hub stack into a VM would take with it */
export function fetchFleetMoveCheck(stack: string): Promise<FleetMoveCheck> {
  return apiClient.get<FleetMoveCheck>(`/fleet/provision/move-check?stack=${encodeURIComponent(stack)}`)
}
/** POST /fleet/provision — create one VM per stack; the jobs run in the background */
export function provisionFleet(body: FleetProvisionRequest): Promise<FleetProvisionResponse> {
  return apiClient.post<FleetProvisionResponse>('/fleet/provision', body, 60000)
}

/** GET /fleet/jobs — VMs being built, newest first */
export function fetchFleetJobs(): Promise<FleetJobsResponse> {
  return apiClient.get<FleetJobsResponse>('/fleet/jobs')
}

/** GET /fleet/jobs/:id — one job with its steps and log */
export function fetchFleetJob(id: string): Promise<FleetJob> {
  return apiClient.get<FleetJob>(`/fleet/jobs/${encodeURIComponent(id)}`)
}

/** POST /fleet/jobs/:id/retry — run a failed job again from the step that failed */
export function retryFleetJob(id: string): Promise<{ success: boolean }> {
  return apiClient.post<{ success: boolean }>(`/fleet/jobs/${encodeURIComponent(id)}/retry`, {})
}

/** DELETE /fleet/jobs/:id — forget a finished or failed job */
export function deleteFleetJob(id: string, destroy = false): Promise<{ success: boolean; vm_destroyed?: boolean }> {
  return apiClient.delete<{ success: boolean; vm_destroyed?: boolean }>(`/fleet/jobs/${encodeURIComponent(id)}${destroy ? '?destroy=true' : ''}`)
}

/** POST /fleet/members/:id/test — log in afresh, read the identity, match the guest */
export function testFleetMember(id: string): Promise<FleetMemberTestResponse> {
  return apiClient.post<FleetMemberTestResponse>(`/fleet/members/${encodeURIComponent(id)}/test`, {}, 90000)
}

/** POST /fleet/members/:id/relink — take a VM back after the hub lost its password: the hub lifts its lock-out on the VM, the VM joins again over the hub's ssh key (a failure answers with the command to run on the VM by hand) */
export function relinkFleetMember(id: string): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>(`/fleet/members/${encodeURIComponent(id)}/relink`, {}, 180000)
}

/** POST /fleet/members/:id/sync — pull the files of every stack the member runs into the hub's Stacks/ (direction "push" sends the hub's copies into the VM); stacks limits it */
export function syncFleetMember(id: string, body: { direction?: 'pull' | 'push'; stacks?: string[] } = {}): Promise<FleetMemberSyncResponse> {
  // one call per stack inside, 90 s each on the member's side
  return apiClient.post<FleetMemberSyncResponse>(`/fleet/members/${encodeURIComponent(id)}/sync`, body, 300000)
}

/** GET /fleet/overview — every member with its stacks and container counts */
export function fetchFleetOverview(): Promise<FleetOverview> {
  return apiClient.get<FleetOverview>('/fleet/overview')
}

/** GET /fleet/discover — the last scan of the guests for DCS installs (30 s cache) */
export function fetchFleetDiscover(): Promise<FleetDiscoverResponse> {
  return apiClient.get<FleetDiscoverResponse>('/fleet/discover')
}

/** POST /fleet/discover — scan now; Proxmox values may be given before they are saved (the wizard) */
export function runFleetDiscover(pve?: { url: string; token_id: string; token_secret: string; verify_tls: boolean }): Promise<FleetDiscoverResponse> {
  return apiClient.post<FleetDiscoverResponse>('/fleet/discover', pve ?? {}, 120000)
}

/** GET /fleet/join-tokens — the join codes still valid */
export function fetchFleetJoinTokens(): Promise<FleetJoinTokensResponse> {
  return apiClient.get<FleetJoinTokensResponse>('/fleet/join-tokens')
}

/** POST /fleet/join-tokens — mint a join code */
export function createFleetJoinToken(ttlHours = 24): Promise<FleetJoinTokenResponse> {
  return apiClient.post<FleetJoinTokenResponse>('/fleet/join-tokens', { ttl_hours: ttlHours })
}

/** DELETE /fleet/join-tokens/:token — revoke a join code */
export function revokeFleetJoinToken(token: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/fleet/join-tokens/${encodeURIComponent(token)}`)
}

/** POST /fleet/join-hub — make this server a member of a hub */
/** GET /fleet/images — every image on the hub and on each member, tagged with where it runs */
export function fetchFleetImages(): Promise<ImageCheckResponse> {
  return apiClient.get<ImageCheckResponse>('/fleet/images')
}

/** POST /fleet/images/check — the registry check on the hub and every member at once (slow) */
export function checkFleetImageRegistry(): Promise<FleetImagesCheckResponse> {
  return apiClient.post<FleetImagesCheckResponse>('/fleet/images/check', undefined, 200000)
}

/** GET /fleet/templates — the DCS templates the hub baked (a full clone of one is a 25-second build) */
export function fetchFleetTemplates(): Promise<FleetTemplatesResponse> {
  return apiClient.get<FleetTemplatesResponse>('/fleet/templates')
}

/** POST /fleet/templates — bake a DCS template from a cloud image without building a VM: the VM settings (node, storage,
 *  network, image | image_url | image_file) and no vms; the answer lists the one bake job */
export function bakeFleetTemplate(body: Omit<FleetProvisionRequest, 'vms'>): Promise<FleetProvisionResponse> {
  return apiClient.post<FleetProvisionResponse>('/fleet/templates', body, 60000)
}

/** DELETE /fleet/templates/{vmid} — remove a baked template with its VM */
export function deleteFleetTemplate(vmid: number): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/fleet/templates/${vmid}`)
}

/** GET /fleet/versions — the hub's DCS version next to every member's, asked live */
// ---- Docker Engine: version, package source, one-click update (fleet-wide from a hub) ----
export function fetchDockerEngine(fleet = false): Promise<DockerEngineInfo | DockerEngineFleet> {
  return apiClient.get<DockerEngineInfo | DockerEngineFleet>(`/system/docker-engine${fleet ? '?fleet=1' : ''}`)
}
export function fetchDockerEngineStatus(): Promise<DockerEngineStatus> {
  return apiClient.get<DockerEngineStatus>('/system/docker-engine/status')
}
/** unattended where the API has passwordless sudo; otherwise the Terminal session token + the sudo password */
export function updateDockerEngine(terminalToken?: string, password?: string): Promise<DockerEngineUpdateResponse> {
  return apiClient.post<DockerEngineUpdateResponse>('/system/docker-engine/update', { ...(terminalToken ? { terminal_token: terminalToken } : {}), ...(password ? { password } : {}) }, 30000)
}
export function updateFleetDockerEngine(members: string[] | 'all' = 'all'): Promise<FleetDockerEngineUpdateResponse> {
  return apiClient.post<FleetDockerEngineUpdateResponse>('/fleet/docker-engine/update', { members }, 60000)
}

export function fetchFleetVersions(): Promise<FleetVersions> {
  return apiClient.get<FleetVersions>('/fleet/versions')
}

/** POST /fleet/update — bring members (ids, or "all") to the hub's DCS version: each fetches the hub's code and re-executes */
export function updateFleet(members: string[] | 'all' = 'all'): Promise<FleetUpdateResponse> {
  return apiClient.post<FleetUpdateResponse>('/fleet/update', { members }, 600000)
}

export function joinFleetHub(body: { hub_url?: string; token?: string; name?: string; url?: string; pending?: boolean }): Promise<FleetJoinHubResponse> {
  return apiClient.post<FleetJoinHubResponse>('/fleet/join-hub', body, 120000)
}

/** DELETE /fleet/hub — leave the hub */
export function leaveFleetHub(): Promise<FleetLeaveResponse> {
  return apiClient.delete<FleetLeaveResponse>('/fleet/hub')
}

/** GET /traefik/feed/status — what a Traefik on another machine can pull, and when it last did */
export function fetchTraefikFeedStatus(): Promise<TraefikFeedStatus> {
  return apiClient.get<TraefikFeedStatus>('/traefik/feed/status')
}

/** POST /traefik/feed/token — mint a new feed token */
export function rotateTraefikFeedToken(): Promise<TraefikFeedTokenResponse> {
  return apiClient.post<TraefikFeedTokenResponse>('/traefik/feed/token', {})
}
