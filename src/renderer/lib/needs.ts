// =============================================================================
// needs — what "Needs your attention" lists: only what is broken or waiting on
// the person, each with the page that fixes it, worst first. Pure: the card
// (components/dashboard/NeedsYouCard) hands it what the Dashboard already polls.
// =============================================================================

import { pageLabel } from '../constants/pageTitles'
import type { BackupStatusResponse, CrowdSecCommunityResponse, DiskInfo, HealthReport, ImageCheckResponse, OsUpdatesInfo, OsUpdatesResponse, PageId, StackInfo } from '../../shared/types'
import { containerState, isAsleep } from './containerState'

export type Severity = 'problem' | 'attention'

export interface NeedItem {
  key: string
  severity: Severity
  title: string
  detail?: string
  page: PageId
  /** opens the page on the right view (System's OS updates of one server, …) */
  payload?: Record<string, unknown>
  /** what makes it a new item when it changes: a hidden item comes back when this differs */
  fingerprint: string
  /** a one-click fix the card offers an admin (the server it runs on: null = this one) */
  fix?: { kind: 'sablier-repair' | 'sablier-start'; label: string; member: string | null }
}

const BACKUP_STALE_DAYS = 7
const DISK_ATTENTION = 90
const DISK_PROBLEM = 95
/** plain (non-security) OS updates are only mentioned when this many wait, or when they have waited this long */
const OS_PLAIN_MANY = 25
const OS_PLAIN_DAYS = 30
/** automatic security updates get this long to install a waiting security fix before it is mentioned */
const OS_AUTO_GRACE_DAYS = 2

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
  /** the servers' own look at their OS updates (admins only: the card passes null to anyone else) */
  osUpdates?: OsUpdatesResponse | null
  /** CrowdSec's community link (admins only, and only while CrowdSec runs: the card passes null otherwise) */
  crowdsecCommunity?: CrowdSecCommunityResponse | null
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
    // on demand, asleep, and no Sablier to wake it: the first request finds nothing — one line per server
    const stuck = new Map<string, { member: string | null; names: string[] }>()
    for (const c of health.containers.filter((x) => containerState(x) === 'stuck')) {
      const where = c.member_name && c.member ? c.member_name : ''
      const e = stuck.get(where) ?? { member: c.member ?? null, names: [] }
      e.names.push(c.name); stuck.set(where, e)
    }
    for (const [where, e] of stuck) {
      out.push({ key: `sablier-down-${e.member ?? 'here'}`, severity: 'problem',
        title: `On demand, but Sablier is not running${where ? ` in ${where}` : ''}`,
        detail: `${names(e.names)} ${e.names.length === 1 ? 'is' : 'are'} asleep and nothing can wake ${e.names.length === 1 ? 'it' : 'them'} until Sablier starts.`,
        page: 'containers', fingerprint: [...e.names].sort().join(','), fix: { kind: 'sablier-start', label: 'Start Sablier', member: e.member } })
    }
    // on-demand containers a prune removed: Traefik routes to them, but there is nothing to wake
    const gone: { member: string | null; where: string; missing: string[] }[] = []
    if (health.summary.on_demand_missing?.length) gone.push({ member: null, where: '', missing: health.summary.on_demand_missing })
    for (const m of health.summary.on_demand_missing_members ?? []) if (m.missing.length) gone.push({ member: m.id, where: m.name, missing: m.missing })
    for (const g of gone) {
      out.push({ key: `on-demand-missing-${g.member ?? 'here'}`, severity: 'problem',
        title: `${g.missing.length === 1 ? 'An on-demand container is gone' : `${g.missing.length} on-demand containers are gone`}${g.where ? ` in ${g.where}` : ''}`,
        detail: `${names(g.missing)}: recreate ${g.missing.length === 1 ? 'it' : 'them'} (stopped, ready for the first request).`,
        page: 'containers', fingerprint: [...g.missing].sort().join(','), fix: { kind: 'sablier-repair', label: 'Recreate', member: g.member } })
    }

    const sick = health.containers.filter((c) => c.health === 'unhealthy' && !isAsleep(c)).map((c) => c.member_name ? `${c.name} (${c.member_name})` : c.name)
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

  out.push(...osUpdateNeeds(input.osUpdates ?? null, now))

  // the central API refuses this engine's login: the community blocklist goes stale until it registers again (one click on the page)
  if (input.crowdsecCommunity?.needs_register) {
    out.push({ key: 'crowdsec-community', severity: 'attention', title: 'CrowdSec can’t reach the community service',
      detail: 'The community blocklist is not updated. Register the engine again on the CrowdSec overview.',
      page: 'crowdsec', payload: { tab: 'overview' }, fingerprint: 'needs-register' })
  }

  // worst first, then the order above
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'problem' ? -1 : 1))
}

/** each server's look, the hub first; a VM that does not answer, cannot say or has not looked yet is left out */
function osHosts(res: OsUpdatesResponse | null): { member: string | null; name: string; info: OsUpdatesInfo }[] {
  if (!res) return []
  const all = 'fleet' in res && res.fleet
    ? res.members.filter((m) => m.reachable).map((m) => ({ member: m.id, name: m.name, info: m as OsUpdatesInfo }))
    : [{ member: null, name: '', info: res }]
  return all.filter((h) => h.info.supported && h.info.enabled !== false && h.info.checked_at > 0)
}

/**
 * OS updates: a restart that finishes installed updates, security fixes waiting (not while automatic security updates
 * have had less than two days to install them), and plain updates only when many or old ones wait and nothing
 * installs them on its own. Calm: all of it is "attention", never "problem".
 */
export function osUpdateNeeds(res: OsUpdatesResponse | null, now = Date.now()): NeedItem[] {
  const hosts = osHosts(res)
  // a hub with VMs names the server in every line (even while only one of them has something to say)
  const fleet = !!res && 'fleet' in res && res.fleet && res.members.length > 1
  const out: NeedItem[] = []
  const days = (since: number) => (since > 0 ? Math.max(0, Math.floor((now / 1000 - since) / 86_400)) : 0)
  for (const { member, name, info } of hosts) {
    const on = fleet && name ? ` on ${name}` : ''
    const key = member ?? 'here'
    const page: PageId = 'system'
    const payload = { section: 'os-updates', member }
    const auto = info.auto_updates
    const autoInstalls = auto?.enabled === true && auto.installs !== false

    if (info.reboot_required === true) {
      const pkgs = info.reboot_packages ?? []
      out.push({ key: `os-restart-${key}`, severity: 'attention', title: `Restart needed to finish updates${on}`,
        detail: pkgs.length
          ? `${names(pkgs)} ${pkgs.length === 1 ? 'was' : 'were'} updated and take${pkgs.length === 1 ? 's' : ''} effect after a restart.`
          : info.reboot_reason ? `${info.reboot_reason[0].toUpperCase()}${info.reboot_reason.slice(1)}.` : 'Installed updates take effect after a restart.',
        page, payload, fingerprint: String(info.boot_time || 'restart') })
    }

    const security = info.security ?? 0
    const total = info.updates ?? 0
    const others = Math.max(0, total - security)
    if (security > 0) {
      const waited = days(info.security_since)
      // automatic security updates will most likely take care of them: only say so when they did not
      if (autoInstalls && waited < OS_AUTO_GRACE_DAYS) continue
      const list = info.security_packages ?? []
      out.push({ key: `os-security-${key}`, severity: 'attention', title: `${plural(security, 'security update')} waiting${on}`,
        detail: autoInstalls
          ? `Automatic updates haven’t installed ${security === 1 ? 'it' : 'them'} in ${waited} days.`
          : list.length
            ? `Fixes for ${names(list)}${others ? `, plus ${plural(others, 'other update')}` : ''}.`
            : `Install them from ${pageLabel('system')}${others ? `, with ${plural(others, 'other update')}` : ''}.`,
        page, payload, fingerprint: `${security}|${info.security_since}` })
      continue
    }

    // only plain updates: nothing to say when the system installs updates itself, or while few and recent ones wait
    if (autoInstalls || total === 0) continue
    const waited = days(info.pending_since)
    if (total < OS_PLAIN_MANY && waited < OS_PLAIN_DAYS) continue
    out.push({ key: `os-updates-${key}`, severity: 'attention', title: `${plural(total, 'system update')} waiting${on}`,
      detail: `${waited >= OS_PLAIN_DAYS ? `Waiting for ${waited} days. ` : ''}${info.security === 0 ? 'None are security fixes; install them when it suits you.' : 'Install them when it suits you.'}`,
      page, payload, fingerprint: `${Math.floor(total / OS_PLAIN_MANY)}|${waited >= OS_PLAIN_DAYS}` })
  }
  return out
}
