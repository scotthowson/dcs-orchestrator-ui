// =============================================================================
// Fleet-scoped operations — the calls the Backup, File Browser, Environment,
// System and Maintenance pages make on the hub or on one VM (through the hub's
// proxy, memberPath), plus the fan-out that runs one action on every server.
// =============================================================================

import { apiClient } from './client'
import { memberPath, type ContainerListResponse } from './endpoints'
import type { ScopeMember } from '../hooks/useFleetScope'
import type {
  BackupStatusResponse,
  BackupConfigResponse,
  BackupTriggerResponse,
  BackupRestoreResponse,
  ContainerFilesResponse,
  ContainerFileContentResponse,
  RootEnvResponse,
  EnvValidateResponse,
  StackEnvResponse,
  StackEnvSaveResponse,
  SystemInfo,
  DockerEngineInfo,
  TerminalAuthResponse,
  OsUpdateCheckResponse,
  OsUpdateApplyResponse,
  OsUpdateStatusResponse,
  MaintenanceResponse,
  MaintenanceReport,
  OrphanReport,
  DiskAnalysis,
  LogRotateResponse,
  MemberTerminalStatus,
  MemberTerminalExecResponse,
  BackupVerifyResponse,
  BackupDownloadLinkResponse,
  BackupChecksumResponse,
  BackupUploadResponse,
} from '../../shared/types'
import type {
  FleetTarget,
  MemberOutcome,
  Placed,
  FleetBackupListResponse,
  FleetMaintenanceReport,
  FleetOrphanReport,
  FleetDiskAnalysis,
} from '../../shared/fleetScopedOps'

/** the member a page scope names ('hub' and 'all' are this server) */
export function memberOf(scope: string | null | undefined): string | null {
  return !scope || scope === 'hub' || scope === 'all' ? null : scope
}

/** the hub plus every VM that answers: where an Everywhere action goes */
export function fleetTargets(members: ScopeMember[], hubName = 'Hub'): FleetTarget[] {
  return [
    { id: null, name: hubName, vmid: null },
    ...members.filter((m) => m.reachable).map((m) => ({ id: m.id, name: m.name, vmid: m.vmid })),
  ]
}

/** the same call on every target at once; a server that fails does not stop the others */
export async function fanOut<T>(targets: FleetTarget[], call: (member: string | null) => Promise<T>): Promise<MemberOutcome<T>[]> {
  const settled = await Promise.allSettled(targets.map((t) => call(t.id)))
  return settled.map((r, i) => (
    r.status === 'fulfilled'
      ? { ...targets[i], ok: true, value: r.value }
      : { ...targets[i], ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
  ))
}

/** one line for the summary toast: "Started on the hub and 15 VMs · clone-c did not answer" */
export function summarizeOutcomes(outcomes: MemberOutcome<unknown>[], verb: string): { ok: boolean; message: string } {
  const good = outcomes.filter((o) => o.ok)
  const bad = outcomes.filter((o) => !o.ok)
  const where = (list: MemberOutcome<unknown>[]) => {
    const hub = list.some((o) => o.id === null)
    const vms = list.filter((o) => o.id !== null).length
    const parts: string[] = []
    if (hub) parts.push('the hub')
    if (vms > 0) parts.push(`${vms} VM${vms === 1 ? '' : 's'}`)
    return parts.join(' and ')
  }
  if (bad.length === 0) return { ok: true, message: `${verb} on ${where(good)}` }
  const failed = bad.map((o) => `${o.name}${o.error ? ` (${o.error})` : ''}`).join(', ')
  if (good.length === 0) return { ok: false, message: `${verb} failed everywhere: ${failed}` }
  return { ok: false, message: `${verb} on ${where(good)} · failed on ${failed}` }
}

// ---------------------------------------------------------------------------
// Sizes: "1.2G" (du -sh), "1.234GB" (docker), "1.2 GB" (the API), "N/A"
// ---------------------------------------------------------------------------

const UNIT_BYTES: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 }

export function parseSizeBytes(text: string | null | undefined): number | null {
  if (!text) return null
  const m = /^\s*([\d.]+)\s*([KMGTP]?)(?:i?B)?\b/i.exec(text)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  return n * (UNIT_BYTES[m[2].toUpperCase() || 'B'] ?? 1)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

/** the sum of the sizes that parse, "N/A" when none does */
export function sumSizes(sizes: (string | null | undefined)[]): string {
  let total = 0
  let any = false
  for (const s of sizes) {
    const b = parseSizeBytes(s)
    if (b !== null) { total += b; any = true }
  }
  return any ? formatBytes(total) : 'N/A'
}

/** docker's "1.2GB (45%)": the size part added up, the share recomputed against a total */
function sumReclaimable(values: string[], totalBytes: number): string {
  let sum = 0
  let any = false
  for (const v of values) {
    const b = parseSizeBytes(v)
    if (b !== null) { sum += b; any = true }
  }
  if (!any) return 'N/A'
  const pct = totalBytes > 0 ? ` (${Math.round((sum / totalBytes) * 100)}%)` : ''
  return `${formatBytes(sum)}${pct}`
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** the hub's archives plus every VM's on Everywhere; one server's list otherwise */
export function fetchBackupsScoped(scope: string): Promise<FleetBackupListResponse> {
  if (scope === 'all') return apiClient.get<FleetBackupListResponse>('/backups?fleet=1')
  return apiClient.get<FleetBackupListResponse>(memberPath(memberOf(scope), '/backups'))
}

export function fetchBackupStatusScoped(member: string | null): Promise<BackupStatusResponse> {
  return apiClient.get<BackupStatusResponse>(memberPath(member, '/backups/status'))
}

export function fetchBackupConfigScoped(member: string | null): Promise<BackupConfigResponse> {
  return apiClient.get<BackupConfigResponse>(memberPath(member, '/backups/config'))
}

/** a backup runs where the stack lives */
export function triggerBackupScoped(member: string | null, stack?: string): Promise<BackupTriggerResponse> {
  return apiClient.post<BackupTriggerResponse>(memberPath(member, '/backups/trigger'), stack ? { stack } : {}, member ? 60000 : undefined)
}

export function cancelBackupScoped(member: string | null): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>(memberPath(member, '/backups/cancel'))
}

/** restore acts on the server that keeps the archive */
export function restoreBackupScoped(member: string | null, filename: string, stack?: string): Promise<BackupRestoreResponse> {
  return apiClient.post<BackupRestoreResponse>(memberPath(member, '/backups/restore'), { filename, confirm: 'RESTORE', ...(stack ? { stack } : {}) }, 120000)
}

/** POST /backups/verify — read a backup to the end against its checksum and manifest, without restoring it */
export function verifyBackupScoped(member: string | null, filename: string): Promise<BackupVerifyResponse> {
  return apiClient.post<BackupVerifyResponse>(memberPath(member, '/backups/verify'), { filename }, 300000)
}

/** GET /backups/{file}/checksum — an archive's size and SHA-256 (a VM's through the hub's JSON proxy) */
export function backupChecksumScoped(member: string | null, filename: string): Promise<BackupChecksumResponse> {
  return apiClient.get<BackupChecksumResponse>(memberPath(member, `/backups/${encodeURIComponent(filename)}/checksum`))
}

/** POST /backups/download-link — a one-time link for the archive; always asked of the hub (a VM's archive streams through it) */
export function backupDownloadLink(member: string | null, filename: string): Promise<BackupDownloadLinkResponse> {
  return apiClient.post<BackupDownloadLinkResponse>('/backups/download-link', member ? { filename, member } : { filename }, 60000)
}

/**
 * the browser saves the archive itself, streamed from the server's disk (never held in the page). Called in the click
 * itself when the link is already at hand: a download the browser starts after an await has lost the click, and a
 * second one is then held back as an "automatic download".
 */
export function openBackupDownload(link: BackupDownloadLinkResponse): void {
  const a = document.createElement('a')
  a.href = `${apiClient.getBaseUrl()}${link.url}`
  a.download = link.filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/** the most a server takes in one upload: the worker pool's front passes 128 MB on, API_MAX_UPLOAD_SIZE can only lower it */
export const BACKUP_UPLOAD_MAX_BYTES = 128 * 1024 * 1024

/**
 * POST /backups/upload — the archive itself as the body (no base64), on a hub into a VM through the hub
 * (POST /fleet/members/{id}/backups/upload). The server lists it only once it reads back whole as a DCS backup and
 * answers why when it does not; onProgress gets the share sent (0 to 1).
 */
export function uploadBackupScoped(member: string | null, file: File, onProgress?: (share: number) => void): Promise<BackupUploadResponse> {
  const path = member ? `/fleet/members/${encodeURIComponent(member)}/backups/upload` : '/backups/upload'
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiClient.getBaseUrl()}${path}?filename=${encodeURIComponent(file.name)}`)
    const token = apiClient.getAuthToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.timeout = 30 * 60 * 1000
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let body: (Partial<BackupUploadResponse> & { message?: string }) | null = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) { resolve(body as BackupUploadResponse); return }
      if (xhr.status === 413) { reject(new Error(body?.message || 'The archive is larger than the server takes (API_MAX_UPLOAD_SIZE)')); return }
      reject(new Error(body?.message || `The upload failed (HTTP ${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('The connection broke during the upload (a proxy in front of the API may refuse a body this large)'))
    xhr.ontimeout = () => reject(new Error('The upload took longer than 30 minutes and was given up'))
    xhr.send(file)
  })
}

// ---------------------------------------------------------------------------
// Container files (the File Browser)
// ---------------------------------------------------------------------------

export function fetchContainersScoped(member: string | null): Promise<ContainerListResponse> {
  return apiClient.get<ContainerListResponse>(memberPath(member, '/containers'))
}

export function fetchContainerFilesScoped(member: string | null, name: string, path = '/'): Promise<ContainerFilesResponse> {
  return apiClient.get<ContainerFilesResponse>(memberPath(member, `/containers/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`))
}

export function fetchContainerFileContentScoped(member: string | null, name: string, path: string): Promise<ContainerFileContentResponse> {
  return apiClient.get<ContainerFileContentResponse>(memberPath(member, `/containers/${encodeURIComponent(name)}/files/content?path=${encodeURIComponent(path)}`))
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export function fetchRootEnvScoped(member: string | null): Promise<RootEnvResponse> {
  return apiClient.get<RootEnvResponse>(memberPath(member, '/env'))
}

export function saveRootEnvScoped(member: string | null, content: string): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>(memberPath(member, '/env'), { content })
}

export function validateEnvScoped(member: string | null, content: string): Promise<EnvValidateResponse> {
  return apiClient.post<EnvValidateResponse>(memberPath(member, '/env/validate'), { content })
}

export function fetchStackEnvScoped(member: string | null, name: string): Promise<StackEnvResponse> {
  return apiClient.get<StackEnvResponse>(memberPath(member, `/stacks/${encodeURIComponent(name)}/env`))
}

export function saveStackEnvScoped(member: string | null, name: string, content: string): Promise<StackEnvSaveResponse> {
  return apiClient.post<StackEnvSaveResponse>(memberPath(member, `/stacks/${encodeURIComponent(name)}/env`), { content })
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export function fetchSystemInfoScoped(member: string | null): Promise<SystemInfo> {
  return apiClient.get<SystemInfo>(memberPath(member, '/system'))
}

/** may this server update packages unattended (root or passwordless sudo, as on a VM the hub built)? */
export async function fetchSudoReadyScoped(member: string | null): Promise<boolean> {
  const info = await apiClient.get<DockerEngineInfo>(memberPath(member, '/system/docker-engine'))
  return info.sudo_ready === true
}

export function terminalAuthScoped(member: string | null, username: string, password: string): Promise<TerminalAuthResponse> {
  return apiClient.post<TerminalAuthResponse>(memberPath(member, '/terminal/auth'), { username, password })
}

/** no terminal token where sudo_ready: the server answers unattended */
export function checkOsUpdatesScoped(member: string | null, terminalToken?: string | null, password?: string): Promise<OsUpdateCheckResponse> {
  return apiClient.post<OsUpdateCheckResponse>(
    memberPath(member, '/system/os-update/check'),
    { ...(terminalToken ? { terminal_token: terminalToken } : {}), ...(password ? { password } : {}) },
    120000,
  )
}

export function applyOsUpdatesScoped(member: string | null, terminalToken?: string | null, password?: string): Promise<OsUpdateApplyResponse> {
  return apiClient.post<OsUpdateApplyResponse>(
    memberPath(member, '/system/os-update/apply'),
    { confirm: 'true', ...(terminalToken ? { terminal_token: terminalToken } : {}), ...(password ? { password } : {}) },
    30000,
  )
}

export function getOsUpdateStatusScoped(member: string | null): Promise<OsUpdateStatusResponse> {
  return apiClient.get<OsUpdateStatusResponse>(memberPath(member, '/system/os-update/status'))
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export function runDockerPruneScoped(member: string | null): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>(memberPath(member, '/maintenance/prune'), undefined, 120000)
}

export function runImagePruneScoped(member: string | null): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>(memberPath(member, '/maintenance/image-prune'), undefined, 120000)
}

export function triggerDeepPruneScoped(member: string | null): Promise<MaintenanceResponse> {
  return apiClient.post<MaintenanceResponse>(memberPath(member, '/maintenance/deep-prune'), { confirm: 'CONFIRM' }, 180000)
}

export function triggerLogRotateScoped(member: string | null): Promise<LogRotateResponse> {
  return apiClient.post<LogRotateResponse>(memberPath(member, '/maintenance/log-rotate'))
}

export function fetchMaintenanceReportScoped(member: string | null): Promise<MaintenanceReport> {
  return apiClient.get<MaintenanceReport>(memberPath(member, '/maintenance/report'))
}

export function fetchMaintenanceOrphansScoped(member: string | null): Promise<OrphanReport> {
  return apiClient.get<OrphanReport>(memberPath(member, '/maintenance/orphans'))
}

export function fetchMaintenanceDiskScoped(member: string | null): Promise<DiskAnalysis> {
  return apiClient.get<DiskAnalysis>(memberPath(member, '/maintenance/disk'))
}

/** the hub and at least one VM: what a hub answers in one call with ?fleet=1 (3.9.3) */
function wantsFleetAnswer(targets: FleetTarget[]): boolean {
  return targets.some((t) => t.id === null) && targets.some((t) => t.id !== null)
}

/** the hub's merged answer, or null when this DCS is older and answered the plain shape (or nothing) */
async function fleetAnswer<T extends { members: MemberOutcome<unknown>[] }>(path: string): Promise<T | null> {
  try {
    const r = await apiClient.get<T & { fleet?: boolean }>(path)
    return r && r.fleet === true && Array.isArray(r.members) ? r : null
  } catch {
    return null
  }
}

function placed<T>(o: MemberOutcome<unknown>, row: T): Placed<T> {
  return { ...row, member: o.id, member_name: o.name, vmid: o.vmid }
}

/** the hub's and every VM's numbers added up (each asked at the same time) */
export async function fetchFleetMaintenanceReport(targets: FleetTarget[]): Promise<FleetMaintenanceReport> {
  if (wantsFleetAnswer(targets)) {
    const hub = await fleetAnswer<FleetMaintenanceReport>('/maintenance/report?fleet=1')
    if (hub) return hub
  }
  const members = await fanOut(targets, fetchMaintenanceReportScoped)
  const totals: MaintenanceReport = {
    containers: { total: 0, running: 0, stopped: 0 },
    images: { total: 0, dangling: 0 },
    volumes: { total: 0, dangling: 0 },
    networks: { total: 0, custom: 0 },
    docker_df: '',
    app_data_size: 'N/A',
    log_size: 'N/A',
  }
  const answered = members.filter((m): m is MemberOutcome<MaintenanceReport> & { value: MaintenanceReport } => m.ok && !!m.value)
  for (const { value: r } of answered) {
    totals.containers.total += r.containers?.total ?? 0
    totals.containers.running += r.containers?.running ?? 0
    totals.containers.stopped += r.containers?.stopped ?? 0
    totals.images.total += r.images?.total ?? 0
    totals.images.dangling += r.images?.dangling ?? 0
    totals.volumes.total += r.volumes?.total ?? 0
    totals.volumes.dangling += r.volumes?.dangling ?? 0
    totals.networks.total += r.networks?.total ?? 0
    totals.networks.custom += r.networks?.custom ?? 0
  }
  totals.app_data_size = sumSizes(answered.map((m) => m.value.app_data_size))
  totals.log_size = sumSizes(answered.map((m) => m.value.log_size))
  return { totals, members }
}

/** every server's orphans in one list, each row tagged with where it is */
export async function fetchFleetOrphans(targets: FleetTarget[]): Promise<FleetOrphanReport> {
  if (wantsFleetAnswer(targets)) {
    const hub = await fleetAnswer<FleetOrphanReport>('/maintenance/orphans?fleet=1')
    if (hub) return hub
  }
  const members = await fanOut(targets, fetchMaintenanceOrphansScoped)
  const out: FleetOrphanReport = { containers: [], images: [], volumes: [], members }
  for (const m of members) {
    if (!m.ok || !m.value) continue
    out.containers.push(...(m.value.containers ?? []).map((r) => placed(m, r)))
    out.images.push(...(m.value.images ?? []).map((r) => placed(m, r)))
    out.volumes.push(...(m.value.volumes ?? []).map((r) => placed(m, r)))
  }
  return out
}

/** every server's disk picture: stacks tagged, docker's tables added up per type */
export async function fetchFleetDisk(targets: FleetTarget[]): Promise<FleetDiskAnalysis> {
  if (wantsFleetAnswer(targets)) {
    const hub = await fleetAnswer<FleetDiskAnalysis>('/maintenance/disk?fleet=1')
    if (hub) return hub
  }
  const members = await fanOut(targets, fetchMaintenanceDiskScoped)
  const stack_sizes: FleetDiskAnalysis['stack_sizes'] = []
  const byType = new Map<string, { total: number; active: number; size: number; sizeAny: boolean; reclaimable: string[] }>()
  const totals: string[] = []
  for (const m of members) {
    if (!m.ok || !m.value) continue
    stack_sizes.push(...(m.value.stack_sizes ?? []).map((r) => placed(m, r)))
    totals.push(m.value.total_app_data)
    for (const row of m.value.docker_df ?? []) {
      const acc = byType.get(row.type) ?? { total: 0, active: 0, size: 0, sizeAny: false, reclaimable: [] }
      acc.total += parseInt(row.total, 10) || 0
      acc.active += parseInt(row.active, 10) || 0
      const b = parseSizeBytes(row.size)
      if (b !== null) { acc.size += b; acc.sizeAny = true }
      acc.reclaimable.push(row.reclaimable)
      byType.set(row.type, acc)
    }
  }
  const docker_df: FleetDiskAnalysis['docker_df'] = Array.from(byType.entries()).map(([type, acc]) => ({
    type,
    total: String(acc.total),
    active: String(acc.active),
    size: acc.sizeAny ? formatBytes(acc.size) : 'N/A',
    reclaimable: sumReclaimable(acc.reclaimable, acc.size),
    member: null,
    member_name: 'Everywhere',
    vmid: null,
  }))
  return { stack_sizes, docker_df, total_app_data: sumSizes(totals), members }
}

// ---------------------------------------------------------------------------
// A shell inside a VM, opened by the hub (3.9.3): the hub's own Terminal
// session unlocks it, the hub's ssh key carries the command
// ---------------------------------------------------------------------------

export function fetchMemberTerminal(member: string): Promise<MemberTerminalStatus> {
  return apiClient.get<MemberTerminalStatus>(`/fleet/members/${encodeURIComponent(member)}/terminal`)
}

export function execMemberTerminalCommand(member: string, command: string, terminalToken: string, cwd?: string): Promise<MemberTerminalExecResponse> {
  return apiClient.post<MemberTerminalExecResponse>(
    `/fleet/members/${encodeURIComponent(member)}/terminal/exec`,
    { command, terminal_token: terminalToken, ...(cwd ? { cwd } : {}) },
    90000,
  )
}
