// =============================================================================
// MakeCopy — the Backups page's "Make a copy": four choices side by side, each
// saying in a line what it saves and how long it takes. Back up everything (or
// this server), back up one stack, take a config snapshot, make a recovery
// bundle. The backup settings (destination, source, retention, App-Data on
// drives) and the recovery bundles open below the row.
// =============================================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Archive, Boxes, Camera, Download, Info, Layers, LifeBuoy, Loader2, SlidersHorizontal } from 'lucide-react'
import Hint from '../common/Hint'
import { useToast } from '../common/Toast'
import VmCapsule from '../fleet/VmCapsule'
import RecoveryBundleCard from './RecoveryBundleCard'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD, BTN_SHEET, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, TONE_QUIET } from '../../lib/ui'
import { createSnapshot } from '../../api/endpoints'
import { vmLabel } from './format'
import type { ScopeMember } from '../../hooks/useFleetScope'
import type { BackupConfigResponse, SnapshotCreateResponse } from '../../../shared/types'
import type { BackupStackChoice } from '../../../shared/fleetScopedOps'

import { INPUT } from '../../lib/fieldStyles'
/** the drop-down value of a stack: where it lives, then its name */
const stackKey = (member: string | null, name: string) => `${member ?? ''}|${name}`
const parseStackKey = (key: string): { member: string | null; name: string } => {
  const i = key.indexOf('|')
  return { member: i > 0 ? key.slice(0, i) : null, name: key.slice(i + 1) }
}

const OPEN = 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25'

type Panel = 'settings' | 'recovery' | null
const PANEL_KEY = 'dcs-backups-panel'
function loadPanel(): Panel { try { const v = localStorage.getItem(PANEL_KEY); return v === 'settings' || v === 'recovery' ? v : null } catch { return null } }
function savePanel(p: Panel) { try { if (p) localStorage.setItem(PANEL_KEY, p); else localStorage.removeItem(PANEL_KEY) } catch { /* storage unavailable */ } }

/** what the fleet's snapshot did on each DCS, in one line: taken everywhere, taken on some (which failed, why), or nowhere */
function fleetSnapshotToast(results: NonNullable<SnapshotCreateResponse['results']>): { type: 'success' | 'warning' | 'error'; message: string } {
  const failed = results.filter((r) => !r.success)
  const taken = results.length - failed.length
  const vms = results.length - 1
  if (failed.length === 0) return { type: 'success', message: `Snapshot taken on the hub and ${vms} VM${vms === 1 ? '' : 's'}` }
  const why = failed.map((r) => `${r.name}: ${r.message || 'no answer'}`).join(' · ')
  if (taken === 0) return { type: 'error', message: `No snapshot was taken — ${why}` }
  return { type: 'warning', message: `Snapshot taken on ${taken} of ${results.length} — ${why}` }
}

/** one choice of the row: an icon, a name, what it saves and how long it takes, and its controls */
function Choice({ id, icon, tone, title, tag, children, description }: {
  id: string
  icon: ReactNode
  /** the tile behind the icon: emerald for a backup, cyan for a snapshot, violet for a bundle */
  tone: string
  title: string
  /** what it saves · how long: the line that keeps the kinds apart */
  tag: string
  description: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="glass rounded-xl border border-white/5 p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3">
        <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${tone}`} aria-hidden>{icon}</div>
        <div className="min-w-0">
          <h3 id={id} className="text-sm font-semibold text-slate-200">{title}</h3>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">{tag}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      <div className="mt-auto space-y-2">{children}</div>
    </section>
  )
}

export default function MakeCopy({
  scope, scopeMember, memberName, members, hasFleet, config, configMember, stackChoices, triggerLoading, busy,
  onBackupEverything, onBackup, onSnapshotTaken,
}: {
  scope: string
  scopeMember: string | null
  memberName: string
  members: ScopeMember[]
  hasFleet: boolean
  config: BackupConfigResponse | null
  /** the server whose settings `config` are (null = the hub) */
  configMember: string | null
  stackChoices: BackupStackChoice[]
  triggerLoading: boolean
  /** a backup or a restore is running on the server the status card follows */
  busy: boolean
  onBackupEverything: () => void
  onBackup: (member: string | null, stack?: string) => void
  onSnapshotTaken: () => void
}) {
  const { addToast } = useToast()
  const everywhere = scope === 'all'
  const isConfigured = config?.configured ?? true
  const configName = configMember ? (members.find((m) => m.id === configMember)?.name ?? configMember) : ''
  const configVmid = configMember ? (members.find((m) => m.id === configMember)?.vmid ?? null) : null

  const [panel, setPanel] = useState<Panel>(loadPanel)
  const toggle = (p: Exclude<Panel, null>) => { const next = panel === p ? null : p; setPanel(next); savePanel(next) }
  // a VM's recovery bundle lives on its own dashboard: the card is the hub's
  const showRecovery = !scopeMember
  const openPanel = panel === 'recovery' && !showRecovery ? null : panel

  // ---- one stack: where each stack lives is part of the choice ----
  const [selectedStack, setSelectedStack] = useState('')
  useEffect(() => { setSelectedStack('') }, [scope])
  const visibleStacks = useMemo(
    () => stackChoices.filter((s) => (everywhere ? true : scope === 'hub' ? s.member === null : s.member === scopeMember)),
    [stackChoices, everywhere, scope, scopeMember],
  )
  const stackGroups = useMemo(() => {
    const groups: { key: string; label: string; stacks: BackupStackChoice[] }[] = []
    for (const s of visibleStacks) {
      const key = s.member ?? ''
      let g = groups.find((x) => x.key === key)
      if (!g) { g = { key, label: s.member ? vmLabel(s.member_name, s.vmid) : 'Hub', stacks: [] }; groups.push(g) }
      g.stacks.push(s)
    }
    return groups
  }, [visibleStacks])
  const selected = selectedStack ? parseStackKey(selectedStack) : null
  const selectedChoice = selected ? visibleStacks.find((s) => s.name === selected.name && s.member === selected.member) ?? null : null

  // ---- config snapshot ----
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const takeSnapshot = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const result = await createSnapshot(label.trim() || undefined, scope)
      if (result.results) {
        // Everywhere: the fleet answer says what each DCS did — its success is false as soon as one VM failed, so the
        // toast reads the results themselves
        const t = fleetSnapshotToast(result.results)
        addToast({ ...t, duration: t.type === 'success' ? undefined : 8000 })
        if (t.type !== 'error') { setLabel(''); onSnapshotTaken() }
      } else if (result.success) {
        addToast({ type: 'success', message: `Snapshot "${result.filename}" taken` })
        setLabel('')
        onSnapshotTaken()
      } else {
        addToast({ type: 'error', message: result.message || 'Could not take the snapshot', duration: 6000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: `The snapshot failed: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setCreating(false)
    }
  }, [creating, label, scope, addToast, onSnapshotTaken])

  const where = everywhere ? 'on every server' : scopeMember ? `on the VM ${memberName}` : hasFleet ? 'on the hub' : ''

  return (
    <section aria-labelledby="make-copy-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <Archive size={16} className="text-slate-400" aria-hidden />
        <h2 id="make-copy-title" className="text-sm font-semibold text-slate-200">Make a copy</h2>
      </div>

      {!isConfigured && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-300">Backup not configured{hasFleet ? (configMember ? ` on the VM ${configName}` : ' on the hub') : ''}</p>
            <p className="text-xs text-amber-400/70 mt-1">
              Set <code className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded">BACKUP_DEST_DIR</code> in {configMember ? 'that VM\'s' : 'the server\'s'} <code className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded">.env</code> file (the {pageLabel('environment')} page) to enable backups there. Config snapshots and recovery bundles work without it.
            </p>
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${showRecovery ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
        {/* Everything (Everywhere: the hub and every VM at once), or this server */}
        <Choice
          id="make-everything"
          icon={everywhere ? <Boxes size={18} className="text-emerald-400" /> : <Archive size={18} className="text-emerald-400" />}
          tone="bg-emerald-500/10"
          title={everywhere ? 'Back up everything' : 'Full backup'}
          tag="Backup · data · minutes"
          description={`Stacks with their App-Data, volumes and the install's settings${where ? `, ${where}` : ''}. Containers pause while they are read.`}
        >
          {everywhere ? (
            <Hint label="A full backup on the hub and on every VM that answers, started at the same time">
              <span className="flex">
                <button type="button" onClick={onBackupEverything} disabled={triggerLoading || busy} className={`${BTN_SHEET_PRIMARY} w-full`}>
                  {triggerLoading ? <Loader2 size={16} className="animate-spin" /> : <Boxes size={16} />}
                  Back up everything
                </button>
              </span>
            </Hint>
          ) : (
            <button type="button" onClick={() => onBackup(scopeMember)} disabled={triggerLoading || busy || !isConfigured} className={`${BTN_SHEET_PRIMARY} w-full`}>
              {triggerLoading ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
              Full backup{scopeMember ? ` of ${memberName}` : ''}
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-expanded={openPanel === 'settings'}
              aria-controls="backup-settings-panel"
              onClick={() => toggle('settings')}
              className={`${BTN_CARD} ${openPanel === 'settings' ? OPEN : TONE_QUIET}`}
            >
              <SlidersHorizontal size={12} />
              Backup settings
            </button>
            {config?.configured && (
              <span className="text-[10px] text-slate-500 truncate min-w-0" title={`${config.destination} · keeps ${config.retention_count} of each kind`}>
                keeps {config.retention_count}
              </span>
            )}
          </div>
        </Choice>

        {/* One stack, where it lives */}
        <Choice
          id="make-stack"
          icon={<Layers size={18} className="text-emerald-400" />}
          tone="bg-emerald-500/10"
          title="Back up one stack"
          tag="Backup · data · faster"
          description="One stack with its App-Data and volumes, from the hub or a VM: the copy to make before you change that stack."
        >
          <select
            aria-label="Stack to back up"
            value={selectedStack}
            onChange={(e) => setSelectedStack(e.target.value)}
            disabled={!isConfigured && !everywhere}
            className={INPUT}
          >
            <option value="" className="bg-slate-900 text-slate-400">
              {visibleStacks.length === 0 ? 'No stacks here' : 'Choose a stack…'}
            </option>
            {hasFleet ? stackGroups.map((g) => (
              <optgroup key={g.key || 'hub'} label={g.label} className="bg-slate-900 text-slate-400">
                {g.stacks.map((s) => (
                  <option key={stackKey(s.member, s.name)} value={stackKey(s.member, s.name)} disabled={!s.reachable} className="bg-slate-900 text-slate-200">
                    {s.name}{s.member ? ` — ${vmLabel(s.member_name, s.vmid)}` : everywhere ? ' — Hub' : ''}{s.reachable ? '' : ' (not answering)'}
                  </option>
                ))}
              </optgroup>
            )) : visibleStacks.map((s) => (
              <option key={s.name} value={stackKey(null, s.name)} className="bg-slate-900 text-slate-200">{s.name}</option>
            ))}
          </select>
          <Hint label={selectedChoice?.member ? `Runs on ${vmLabel(selectedChoice.member_name, selectedChoice.vmid)}` : selectedChoice && hasFleet ? 'Runs on the hub' : undefined}>
            <span className="flex">
              <button
                type="button"
                onClick={() => { if (selectedChoice) onBackup(selectedChoice.member, selectedChoice.name) }}
                disabled={!selectedChoice || !selectedChoice.reachable || triggerLoading || busy}
                className={`${BTN_SHEET_QUIET} w-full`}
              >
                <Download size={16} />
                Back up stack
              </button>
            </span>
          </Hint>
          {selectedChoice && hasFleet && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
              <span>Runs where it lives:</span>
              <VmCapsule member={selectedChoice.member} name={selectedChoice.member_name} vmid={selectedChoice.vmid} size="xs" />
            </p>
          )}
        </Choice>

        {/* Config snapshot: settings only, while you wait */}
        <Choice
          id="make-snapshot"
          icon={<Camera size={18} className="text-cyan-400" />}
          tone="bg-cyan-500/10"
          title="Config snapshot"
          tag="Snapshot · settings only · seconds"
          description={`Stack files and settings, no data${everywhere ? ', one on every server' : ''}. Take one before you change something.`}
        >
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') takeSnapshot() }}
            aria-label="Label of the snapshot (optional)"
            placeholder="Label (optional), e.g. before-traefik"
            disabled={creating}
            className={INPUT}
          />
          <button type="button" onClick={takeSnapshot} disabled={creating} className={`${BTN_SHEET_QUIET} w-full`}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {creating ? 'Taking…' : 'Take a snapshot'}
          </button>
        </Choice>

        {/* Recovery bundle: the hub's own (a VM's is on its own dashboard) */}
        {showRecovery && (
          <Choice
            id="make-bundle"
            icon={<LifeBuoy size={18} className="text-violet-400" />}
            tone="bg-violet-500/10"
            title="Recovery bundle"
            tag="Bundle · encrypted · to move or rebuild"
            description={`The whole ${hasFleet ? 'hub' : 'install'}, encrypted with a passphrase: to move to a new machine or rebuild after a disaster.`}
          >
            <button
              type="button"
              aria-expanded={openPanel === 'recovery'}
              aria-controls="recovery-bundle-panel"
              onClick={() => toggle('recovery')}
              className={`${BTN_SHEET} w-full ${openPanel === 'recovery' ? OPEN : TONE_QUIET}`}
            >
              <LifeBuoy size={16} />
              Make a bundle
            </button>
          </Choice>
        )}
      </div>

      {/* The settings a backup runs with: one server's */}
      {openPanel === 'settings' && (
        <section id="backup-settings-panel" aria-labelledby="backup-settings-title" className="glass rounded-xl border border-white/5 overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-2">
            <SlidersHorizontal size={16} className="text-slate-400" aria-hidden />
            <h2 id="backup-settings-title" className="text-sm font-semibold text-slate-200">Backup settings</h2>
            {hasFleet && <VmCapsule member={configMember} name={configName} vmid={configVmid} size="xs" />}
          </div>
          <div className="p-5">
            {!config && <p className="text-xs text-slate-500">Reading the settings…</p>}
            {config && (
              <div className={`grid grid-cols-1 gap-3 ${(config.appdata_dirs?.length ?? 0) > 0 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="glass border border-white/5 rounded-lg p-3 min-w-0">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Destination</p>
                  <p className="mt-1 text-xs font-mono text-slate-300 truncate" title={config.destination}>{config.destination || 'not set'}</p>
                </div>
                <div className="glass border border-white/5 rounded-lg p-3 min-w-0">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Source</p>
                  <p className="mt-1 text-xs font-mono text-slate-300 truncate" title={config.source}>{config.source || 'N/A'}</p>
                </div>
                <div className="glass border border-white/5 rounded-lg p-3 min-w-0">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Retention</p>
                  <p className="mt-1 text-xs font-mono text-slate-300">{config.retention_count} backup{config.retention_count !== 1 ? 's' : ''} of each kind</p>
                </div>
                {/* App-Data on drives of their own: parts of their own in every backup */}
                {(config.appdata_dirs?.length ?? 0) > 0 && (
                  <div className="glass border border-white/5 rounded-lg p-3 min-w-0">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">App-Data on drives</p>
                    <ul className="mt-1 space-y-0.5">
                      {config.appdata_dirs!.map((d) => (
                        <li key={d.stack} className="text-xs font-mono truncate" title={d.ok ? `${d.stack}: ${d.path}` : `${d.path} is not there (drive not mounted?): a backup leaves it out until it is back`}>
                          <span className="text-slate-400">{d.stack}</span>{' '}
                          <span className={d.ok ? 'text-slate-300' : 'text-amber-300'}>{d.path}</span>
                          {!d.ok && <span className="text-amber-300"> · not mounted</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0 text-slate-500" aria-hidden />
              <span>
                {hasFleet && everywhere ? 'These are the hub\'s settings. Every VM keeps its own destination and retention: pick a VM chip above to see them. ' : ''}
                They are set in the server&apos;s .env (BACKUP_DEST_DIR, BACKUP_SOURCE_DIR, BACKUP_RETENTION_COUNT) on the {pageLabel('environment')} page.
              </span>
            </p>
          </div>
        </section>
      )}

      {openPanel === 'recovery' && (
        <div id="recovery-bundle-panel" className="animate-fade-in">
          <RecoveryBundleCard />
        </div>
      )}
    </section>
  )
}
