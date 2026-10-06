// =============================================================================
// needs — what "Needs your attention" lists: only what is broken or waiting on
// the person, each with the page that fixes it, worst first. Pure: the card
// (components/dashboard/NeedsYouCard) hands it what the Dashboard already polls.
// =============================================================================

import { pageLabel } from '../constants/pageTitles'
import type { BackupStatusResponse, DiskInfo, HealthReport, ImageCheckResponse, PageId, StackInfo } from '../../shared/types'

export type Severity = 'problem' | 'attention'

export interface NeedItem {
  key: string
  severity: Severity
  title: string
  detail?: string
  page: PageId
  /** what makes it a new item when it changes: a hidden item comes back when this differs */
  fingerprint: string
}

const BACKUP_STALE_DAYS = 7
const DISK_ATTENTION = 90
const DISK_PROBLEM = 95

/** "a, b and 3 more" */
function names(list: string[], max = 3): string {
  if (list.length <= max) return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list.join('')
  return `${list.slice(0, max).join(', ')} and ${list.length - max} more`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function collectNeeds(input: {
  stacks: StackInfo[] | null
  health: HealthReport | null
  images: ImageCheckResponse | null
  backup: BackupStatusResponse | null
  disks: DiskInfo[] | null
  dcsUpdates: number
  now?: number
}): NeedItem[] {
  const { stacks, health, images, backup, disks, dcsUpdates } = input
  const now = input.now ?? Date.now()
  const out: NeedItem[] = []

  if (health?.docker && !health.docker.reachable) {
    out.push({ key: 'docker-down', severity: 'problem', title: 'Docker isn’t answering', detail: health.docker.error || 'Every container on this server is down until it is back.', page: 'health', fingerprint: 'down' })
  }

  if (stacks) {
    // a drive that holds a stack's App-Data is not there: DCS refuses to start it
    for (const s of stacks.filter((x) => x.app_data?.external && !x.app_data.ok)) {
      out.push({ key: `appdata-${s.name}`, severity: 'problem', title: `App-Data drive missing for ${s.name}`, detail: `${s.app_data!.path} is not there. Mount the drive, then start the stack.`, page: 'stacks', fingerprint: s.app_data!.path })
    }

    // one line per VM that does not answer, however many stacks live in it
    const silent = new Map<string, string[]>()
    for (const s of stacks.filter((x) => x.placement === 'vm' && x.reachable === false)) {
      const vm = s.member_name || s.member || 'a VM'
      silent.set(vm, [...(silent.get(vm) ?? []), s.name])
    }
    for (const [vm, list] of silent) {
      out.push({ key: `vm-${vm}`, severity: 'problem', title: `VM ${vm} isn’t answering`, detail: `${list.length === 1 ? 'Its stack' : 'Its stacks'} ${names(list)} can’t be reached.`, page: 'proxmox', fingerprint: list.join(',') })
    }

    // running, but some of its containers are not (asleep on purpose doesn't count)
    const partial = stacks.filter((s) => s.status === 'running' && s.reachable !== false && typeof s.total_containers === 'number'
      && s.total_containers - s.running_containers - (s.sleeping_containers ?? 0) > 0)
    if (partial.length) {
      const down = (s: StackInfo) => s.total_containers! - s.running_containers - (s.sleeping_containers ?? 0)
      const detail = partial.map((s) => `${s.name} (${down(s)} of ${s.total_containers})`)
      out.push({ key: 'stacks-partial', severity: 'problem',
        title: partial.length === 1 ? `${partial[0].name} has stopped containers` : `${plural(partial.length, 'stack')} have stopped containers`,
        detail: partial.length === 1 ? `${down(partial[0])} of its ${partial[0].total_containers} containers aren’t running.` : names(detail),
        page: 'stacks', fingerprint: detail.join(',') })
    }

    // stopped as a whole (not asleep, not in a silent VM): maybe on purpose, so it is only "attention" and can be hidden
    // (a stack whose App-Data drive is missing is already listed above, with the reason)
    const stopped = stacks.filter((s) => s.status === 'stopped' && !s.sleeping && s.reachable !== false && !(s.app_data?.external && !s.app_data.ok))
    if (stopped.length) {
      out.push({ key: 'stacks-stopped', severity: 'attention', title: stopped.length === 1 ? `${stopped[0].name} is stopped` : `${plural(stopped.length, 'stack')} are stopped`, detail: stopped.length > 1 ? names(stopped.map((s) => s.name)) : 'Start it from Stacks, or hide this if it is off on purpose.', page: 'stacks', fingerprint: stopped.map((s) => s.name).sort().join(',') })
    }
  }

  if (health && health.docker?.reachable !== false) {
    const sick = health.containers.filter((c) => c.health === 'unhealthy').map((c) => c.member_name ? `${c.name} (${c.member_name})` : c.name)
    if (sick.length) {
      out.push({ key: 'unhealthy', severity: 'problem', title: sick.length === 1 ? `${sick[0]} is unhealthy` : `${plural(sick.length, 'container')} are unhealthy`, detail: sick.length > 1 ? names(sick) : 'Its health check is failing.', page: 'health', fingerprint: [...sick].sort().join(',') })
    }
  }

  if (backup) {
    if (backup.status === 'error') {
      out.push({ key: 'backup-failed', severity: 'problem', title: 'The last backup failed', detail: backup.error || `Open ${pageLabel('backup')} for what went wrong.`, page: 'backup', fingerprint: `${backup.error ?? ''}|${backup.started_at ?? ''}` })
    } else if (backup.warnings?.length) {
      out.push({ key: 'backup-incomplete', severity: 'attention', title: 'The last backup is incomplete', detail: names(backup.warnings, 2), page: 'backup', fingerprint: backup.warnings.join('|') })
    }
    if (backup.status !== 'running' && backup.status !== 'restoring') {
      const last = backup.last_backup?.timestamp ? Date.parse(backup.last_backup.timestamp) : NaN
      if (!backup.last_backup) {
        out.push({ key: 'backup-none', severity: 'attention', title: 'No backup yet', detail: `Make one now, or set a timed rule on the ${pageLabel('automations')} page.`, page: 'backup', fingerprint: 'none' })
      } else if (Number.isFinite(last)) {
        const days = Math.floor((now - last) / 86_400_000)
        if (days >= BACKUP_STALE_DAYS) {
          out.push({ key: 'backup-stale', severity: 'attention', title: `No backup for ${days} days`, detail: `The last one is ${backup.last_backup.filename}.`, page: 'backup', fingerprint: backup.last_backup.filename })
        }
      }
    }
  }

  for (const d of disks ?? []) {
    const pct = parseInt(String(d.percent).replace('%', ''), 10)
    if (!Number.isFinite(pct) || pct < DISK_ATTENTION) continue
    out.push({ key: `disk-${d.mount}`, severity: pct >= DISK_PROBLEM ? 'problem' : 'attention', title: `${d.mount} is ${pct}% full`, detail: `${d.available} left of ${d.total}.`, page: 'maintenance', fingerprint: pct >= DISK_PROBLEM ? 'problem' : 'attention' })
  }

  const imageUpdates = images ? images.images.filter((i) => i.update_available) : []
  if (imageUpdates.length) {
    const list = [...new Set(imageUpdates.map((i) => (i.repository || i.image).split('/').pop()!.split(':')[0]))]
    out.push({ key: 'image-updates', severity: 'attention', title: `${plural(imageUpdates.length, 'image update')} waiting`, detail: names(list), page: 'images', fingerprint: imageUpdates.map((i) => i.new_id || i.image).sort().join(',') })
  }

  if (dcsUpdates > 0) {
    out.push({ key: 'dcs-update', severity: 'attention', title: 'A DCS update is ready', detail: `Install it from the ${pageLabel('updates')} page.`, page: 'updates', fingerprint: String(dcsUpdates) })
  }

  // worst first, then the order above
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'problem' ? -1 : 1))
}
