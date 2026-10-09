// =============================================================================
// Fleet-scoped operations — the calls the Backup, File Browser, Environment,
// System and Maintenance pages make on the hub or on one VM (through the hub's
// proxy, memberPath), plus the fan-out that runs one action on every server.
// =============================================================================

import { apiClient } from './client'
import { memberPath, fetchMaintenanceReport, fetchMaintenanceOrphans, fetchMaintenanceDisk } from './endpoints'
import type { ScopeMember } from '../hooks/useFleetScope'
import type {
  BackupConfigResponse,
  BackupRestoreResponse,
  ContainerFilesResponse,
  ContainerFileContentResponse,
  RootEnvResponse,
  EnvValidateResponse,
  DockerEngineInfo,
  OsUpdateCheckResponse,
  OsUpdateApplyResponse,
  OsUpdateStatusResponse,
  OsUpdatesInfo,
  MaintenanceResponse,
  MaintenanceReport,
  MemberTerminalStatus,
  MemberTerminalExecResponse,
  BackupVerifyResponse,
  BackupDownloadLinkResponse,
  BackupChecksumResponse,
  BackupUploadResponse,
  UploadLimits,
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

export function fetchBackupConfigScoped(member: string | null): Promise<BackupConfigResponse> {
  return apiClient.get<BackupConfigResponse>(memberPath(member, '/backups/config'))
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

/** the most a server from before streamed uploads (4.0.34 and older) takes in one: its worker pool's front passed 128 MB on */
export const LEGACY_UPLOAD_MAX_BYTES = 128 * 1024 * 1024

/**
 * why FILE cannot go to the server, before a byte is sent: larger than its limit, or more than the room on its disk.
 * limits: its GET /backups/config or GET /recovery `upload`; undefined when the server's answer has none (an older
 * server, which takes 128 MB at most); null when it is not known (not read yet, no destination: the server decides).
 * null when it may go.
 */
export function uploadRefusal(file: File, limits: UploadLimits | null | undefined, serverLabel: string, what = 'an upload'): string | null {
  if (limits === null) return null
  if (limits === undefined) {
    return file.size > LEGACY_UPLOAD_MAX_BYTES
      ? `${file.name} is ${formatBytes(file.size)}: ${serverLabel} runs an older DCS, which takes ${formatBytes(LEGACY_UPLOAD_MAX_BYTES)} at most. Update it (Updates page), or copy the file into its BACKUP_DEST_DIR by hand (scp, a share)`
      : null
  }
  if (file.size > limits.max_bytes) {
    return `${file.name} is ${formatBytes(file.size)}: ${serverLabel} takes ${what} of up to ${formatBytes(limits.max_bytes)} (API_MAX_BACKUP_UPLOAD_SIZE in its .env). Raise it there, or copy the file into BACKUP_DEST_DIR by hand`
  }
  if (limits.free_bytes !== null && file.size + limits.reserve_bytes > limits.free_bytes) {
    return `Not enough room on ${serverLabel}: ${file.name} is ${formatBytes(file.size)} and its backup folder has ${formatBytes(limits.free_bytes)} free (${formatBytes(limits.reserve_bytes)} is kept spare). Make room there first`
  }
  return null
}

/**
 * POST a file as the request body (no base64), with its progress (onProgress: bytes sent, of total). Nothing of it is
 * held by the page: the browser streams it from the disk. The server streams it to its own disk and answers once it
 * has checked it; a 413 / 507 names the limit or the room.
 */
function uploadFileXhr<T extends { success?: boolean }>(path: string, file: File, onProgress?: (sent: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${apiClient.getBaseUrl()}${path}`)
    const token = apiClient.getAuthToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    // no overall limit: 20 GB take as long as they take; the server gives up on an upload that sends nothing for 5 minutes
    xhr.timeout = 0
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total) }
    xhr.onload = () => {
      let body: (Partial<T> & { message?: string }) | null = null
      try { body = JSON.parse(xhr.responseText) } catch { body = null }
      if (xhr.status >= 200 && xhr.status < 300 && body?.success) { resolve(body as T); return }
      if (xhr.status === 413) { reject(new Error(body?.message || `${file.name} is larger than the server takes (API_MAX_BACKUP_UPLOAD_SIZE), or than a proxy in front of it lets through`)); return }
      if (xhr.status === 507) { reject(new Error(body?.message || 'The server has no room for it')); return }
      reject(new Error(body?.message || `The upload failed (HTTP ${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('The connection broke during the upload: the server may have refused it (its upload limit or its free room), or a proxy in front of it did (Cloudflare takes 100 MB at most; see the Guide, "Downloading and uploading a backup"). Nothing of it was kept'))
    xhr.onabort = () => reject(new Error('The upload was stopped'))
    xhr.send(file)
  })
}

/**
 * POST /backups/upload — the archive itself as the body, on a hub into a VM through the hub
 * (POST /fleet/members/{id}/backups/upload). The server lists it only once it reads back whole as a DCS backup and
 * answers why when it does not; onProgress gets the bytes sent.
 */
export function uploadBackupScoped(member: string | null, file: File, onProgress?: (sent: number, total: number) => void): Promise<BackupUploadResponse> {
  const path = member ? `/fleet/members/${encodeURIComponent(member)}/backups/upload` : '/backups/upload'
  return uploadFileXhr<BackupUploadResponse>(`${path}?filename=${encodeURIComponent(file.name)}`, file, onProgress)
}

/** POST /recovery/upload — a recovery bundle, the file itself as the body (4.0.35; an older server takes JSON: uploadRecoveryBundle) */
export function uploadRecoveryBundleFile(file: File, onProgress?: (sent: number, total: number) => void): Promise<{ success: boolean; file: string; size: number; message?: string }> {
  return uploadFileXhr(`/recovery/upload?filename=${encodeURIComponent(file.name)}`, file, onProgress)
}

// ---------------------------------------------------------------------------
// Container files (the File Browser)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

/** may this server update packages unattended (root or passwordless sudo, as on a VM the hub built)? */
export async function fetchSudoReadyScoped(member: string | null): Promise<boolean> {
  const info = await apiClient.get<DockerEngineInfo>(memberPath(member, '/system/docker-engine'))
  return info.sudo_ready === true
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

/** the server's own look at its OS updates (no sign-in); refresh asks for a new one (admins; at most every five minutes) */
export function fetchOsUpdatesScoped(member: string | null, refresh = false): Promise<OsUpdatesInfo> {
  return apiClient.get<OsUpdatesInfo>(memberPath(member, `/system/os-updates${refresh ? '?refresh=1' : ''}`))
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
  const members = await fanOut(targets, fetchMaintenanceReport)
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
    totals.containers.sleeping = (totals.containers.sleeping ?? 0) + (r.containers?.sleeping ?? 0)
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
  const members = await fanOut(targets, fetchMaintenanceOrphans)
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
  const members = await fanOut(targets, fetchMaintenanceDisk)
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
