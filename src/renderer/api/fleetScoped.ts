// =============================================================================
// API helpers for the fleet-scoped pages (Containers, Logs, Uptime, Topology).
// Every call names the DCS it is meant for: null (or undefined) is the hub,
// this server; a member id rides the hub's proxy to that VM
// (/fleet/members/<id>/api/…). Streams cannot ride the proxy, so a VM's logs
// are polled through the plain endpoints instead.
// =============================================================================

import { apiClient } from './client'
import { memberPath } from './endpoints'
import type {
  ContainerActionResponse, ContainerDetail, ContainerEnvUpdateResponse, ContainerExecResponse,
  ContainerFileContentResponse, ContainerFilesResponse, ContainerInfo, ContainerLogsResponse,
  ContainerProcessesResponse, ContainerRenameResponse, ContainerResetPreview, ContainerResetResponse,
  ContainerStats, LiveLogsResponse, LogArchivesResponse, LogsResponse,
  SablierToggleResponse, SablierSettingsResponse, TopologyResponse, ContainerHomarrState, ContainerHomarrAddResponse,
  ContainerThemeState, ContainerThemeResponse,
} from '../../shared/types'
import type { RowMember, ScopeMemberTag } from '../../shared/fleetScoped'

export type ContainerActionName = 'start' | 'stop' | 'restart' | 'recreate' | 'remove'

/** The key of a row in a list that may hold the same container name on two servers */
export function rowKey(row: { member?: RowMember; name: string }): string {
  return `${row.member ?? ''}|${row.name}`
}

const enc = encodeURIComponent

// ---------------------------------------------------------------------------
// Lists per scope
// ---------------------------------------------------------------------------

/**
 * The rows of a scope, each saying where it lives:
 * - everywhere: the hub's list as is — its own rows untagged, every VM's tagged
 * - hub: only the hub's own rows
 * - a VM: its own list carries no tag; every row is tagged with the VM asked for,
 *   so the capsule and the actions know where it lives
 */
export function scopeContainerRows(scope: string, rows: ContainerInfo[], vm: ScopeMemberTag | null): ContainerInfo[] {
  if (scope === 'all') return rows
  if (scope === 'hub') return rows.filter((c) => !c.member)
  return vm ? rows.map((c) => ({ ...c, member: vm.id, member_name: vm.name, vmid: vm.vmid })) : rows
}

/** GET /topology of the hub or of one VM */
export function fetchTopologyOn(member: RowMember): Promise<TopologyResponse> {
  return apiClient.get<TopologyResponse>(memberPath(member, '/topology'))
}
/** GET /topology?fleet=1 — the hub's map and every reachable VM's in one answer (servers says who answered) */
export function fetchTopologyFleet(): Promise<TopologyResponse> {
  return apiClient.get<TopologyResponse>('/topology?fleet=1')
}

// ---------------------------------------------------------------------------
// One container, on the hub or on a VM
// ---------------------------------------------------------------------------

/** POST /containers/:name/(start|stop|restart|recreate|remove) */
export function containerActionOn(name: string, action: ContainerActionName, member: RowMember): Promise<ContainerActionResponse> {
  const slow = action === 'recreate' ? 120000 : member ? 60000 : undefined
  return apiClient.post<ContainerActionResponse>(memberPath(member, `/containers/${enc(name)}/${action}`), undefined, slow)
}

/** GET /containers/:name — detail */
export function fetchContainerOn(name: string, member: RowMember): Promise<ContainerDetail> {
  return apiClient.get<ContainerDetail>(memberPath(member, `/containers/${enc(name)}`))
}

/** GET /containers/:name/stats */
export function fetchContainerStatsOn(name: string, member: RowMember): Promise<ContainerStats> {
  return apiClient.get<ContainerStats>(memberPath(member, `/containers/${enc(name)}/stats`))
}

/** GET /containers/:name/logs — the last lines, in one answer (polled for a VM: streams do not ride the proxy) */
export function fetchContainerLogsOn(name: string, member: RowMember, tail = 100): Promise<ContainerLogsResponse> {
  return apiClient.get<ContainerLogsResponse>(memberPath(member, `/containers/${enc(name)}/logs?tail=${tail}`))
}

/** GET /containers/:name/logs/live?lines=&since= — the lines since a timestamp, for polling */
export function fetchContainerLogsLiveOn(name: string, member: RowMember, lines = 100, since?: string): Promise<LiveLogsResponse> {
  return apiClient.get<LiveLogsResponse>(memberPath(member, `/containers/${enc(name)}/logs/live?lines=${lines}${since ? `&since=${enc(since)}` : ''}`))
}

/** GET /containers/:name/processes */
export function fetchContainerProcessesOn(name: string, member: RowMember): Promise<ContainerProcessesResponse> {
  return apiClient.get<ContainerProcessesResponse>(memberPath(member, `/containers/${enc(name)}/processes`))
}

/** POST /containers/:name/exec */
export function execContainerCommandOn(name: string, command: string, member: RowMember): Promise<ContainerExecResponse> {
  return apiClient.post<ContainerExecResponse>(memberPath(member, `/containers/${enc(name)}/exec`), { command })
}

/** POST /containers/:name/rename */
export function renameContainerOn(name: string, newName: string, member: RowMember): Promise<ContainerRenameResponse> {
  return apiClient.post<ContainerRenameResponse>(memberPath(member, `/containers/${enc(name)}/rename`), { new_name: newName })
}

/** POST /containers/:name/env — change a Compose service's environment in its stack files and recreate it unless told not to */
export function updateContainerEnvOn(name: string, opts: { set?: Record<string, string>; unset?: string[]; recreate?: boolean }, member: RowMember): Promise<ContainerEnvUpdateResponse> {
  return apiClient.post<ContainerEnvUpdateResponse>(memberPath(member, `/containers/${enc(name)}/env`), opts, 180000)
}

/** POST /containers/:name/sablier — start on demand through Traefik, or serve normally again */
export function setContainerSablierOn(name: string, body: { enabled: boolean; session?: string; display_name?: string; theme?: string; show_details?: boolean }, member: RowMember): Promise<SablierToggleResponse> {
  return apiClient.post<SablierToggleResponse>(memberPath(member, `/containers/${enc(name)}/sablier`), body)
}

/**
 * GET /containers/:name/homarr — is the container on the Homarr dashboard (3.9.5). Always asked
 * of the server the dashboard is connected to: in a fleet the hub runs Homarr and asks the VM
 * (?member=) only for the container's address.
 */
export function fetchContainerHomarr(name: string, member: RowMember): Promise<ContainerHomarrState> {
  return apiClient.get<ContainerHomarrState>(`/containers/${enc(name)}/homarr${member ? `?member=${enc(member)}` : ''}`)
}

/** POST /containers/:name/homarr — put the container on Homarr now (an app, and a tile with an API key) */
export function addContainerHomarr(name: string, member: RowMember): Promise<ContainerHomarrAddResponse> {
  return apiClient.post<ContainerHomarrAddResponse>(`/containers/${enc(name)}/homarr${member ? `?member=${enc(member)}` : ''}`, undefined, 45000)
}

/**
 * GET /containers/:name/theme — the theme.park theme on the container's pages (3.9.5). Asked of the
 * server the dashboard is connected to: in a fleet the hub's Traefik applies the theme to a VM's route.
 */
export function fetchContainerTheme(name: string, member: RowMember): Promise<ContainerThemeState> {
  return apiClient.get<ContainerThemeState>(`/containers/${enc(name)}/theme${member ? `?member=${enc(member)}` : ''}`)
}

/** POST /containers/:name/theme — apply a theme.park theme (with add-ons) or remove it */
export function setContainerTheme(name: string, member: RowMember, body: { enabled: boolean; theme?: string; addons?: string[] }): Promise<ContainerThemeResponse> {
  return apiClient.post<ContainerThemeResponse>(`/containers/${enc(name)}/theme${member ? `?member=${enc(member)}` : ''}`, body, 90000)
}

/** GET /containers/:name/sablier — the container's current on-demand settings (3.9.4) */
export function fetchContainerSablier(name: string, member: RowMember): Promise<SablierSettingsResponse> {
  return apiClient.get<SablierSettingsResponse>(memberPath(member, `/containers/${enc(name)}/sablier`))
}

/** GET /containers/:name/reset — what a nuke & reinstall would remove */
export function fetchContainerResetPreviewOn(name: string, member: RowMember): Promise<ContainerResetPreview> {
  return apiClient.get<ContainerResetPreview>(memberPath(member, `/containers/${enc(name)}/reset`))
}

/** POST /containers/:name/reset — nuke & reinstall */
export function resetContainerOn(name: string, body: { confirm: string; wipe_app_data?: boolean; wipe_volumes?: boolean; pull?: boolean }, member: RowMember): Promise<ContainerResetResponse> {
  return apiClient.post<ContainerResetResponse>(memberPath(member, `/containers/${enc(name)}/reset`), body, 300000)
}

/** GET /containers/:name/files?path= */
export function fetchContainerFilesOn(name: string, path: string, member: RowMember): Promise<ContainerFilesResponse> {
  return apiClient.get<ContainerFilesResponse>(memberPath(member, `/containers/${enc(name)}/files?path=${enc(path)}`))
}

/** GET /containers/:name/files/content?path= */
export function fetchContainerFileContentOn(name: string, path: string, member: RowMember): Promise<ContainerFileContentResponse> {
  return apiClient.get<ContainerFileContentResponse>(memberPath(member, `/containers/${enc(name)}/files/content?path=${enc(path)}`))
}

// ---------------------------------------------------------------------------
// The framework log of the hub or of one VM
// ---------------------------------------------------------------------------

/** GET /logs?lines=&level=&search= — the tail of the framework log */
export function fetchLogsOn(params: { level?: string; search?: string; lines?: number }, member: RowMember): Promise<LogsResponse> {
  const q = new URLSearchParams()
  if (params.level) q.set('level', params.level)
  if (params.search) q.set('search', params.search)
  if (params.lines) q.set('lines', String(params.lines))
  const qs = q.toString()
  return apiClient.get<LogsResponse>(memberPath(member, qs ? `/logs?${qs}` : '/logs'))
}

/** GET /logs/live?lines=&since= — the framework log since a timestamp, for polling */
export function fetchAppLogsLiveOn(member: RowMember, lines = 100, since?: string): Promise<LiveLogsResponse> {
  return apiClient.get<LiveLogsResponse>(memberPath(member, `/logs/live?lines=${lines}${since ? `&since=${enc(since)}` : ''}`))
}

/** GET /logs/archives */
export function fetchLogArchivesOn(member: RowMember): Promise<LogArchivesResponse> {
  return apiClient.get<LogArchivesResponse>(memberPath(member, '/logs/archives'))
}
