// =============================================================================
// Automation — everything a server does by itself, on one page.
//   Rules: one list of the timed rules (a DCS task on a clock, kept in
//   /schedules; and cron-expression rules) and the condition rules (when a
//   container turns unhealthy, a disk fills up; kept in /automations). The
//   server runs both on the same clock; each rule writes to its own store.
//   Server crontab (administrators): the crontab of the account the API runs
//   as, on this server only.
// On a hub: Everywhere lists every server's rules; a rule lives on one server.
// The Schedules and Cron Jobs pages open here (PAGE_ALIASES: {tab, kind}).
// =============================================================================

import { serverLabel } from '../hooks/useBrand'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Plus, RefreshCw, BookOpen, Bot, Layers, Zap, CalendarClock, Radar, ListChecks, Server } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useScheduleStore } from '../stores/scheduleStore'
import { useSystemStore } from '../stores/systemStore'
import { EmptyState, ErrorState } from '../components/common/PageState'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK, TONE_QUIET } from '../lib/ui'
import { fetchAutomations, updateAutomation, deleteAutomation, runAutomation } from '../api/endpoints'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import type { AutomationRule } from '../../shared/types'
import { fromAutomation, fromSchedule, sortRules, type KindFilter, type UnifiedRule } from '../components/automation/model'
import RuleRow from '../components/automation/RuleRow'
import ScheduleDialog, { EMPTY_SCHEDULE_FORM, type ScheduleFormState } from '../components/automation/ScheduleDialog'
import AutomationRuleDialog from '../components/automation/AutomationRuleDialog'
import NewRuleChooser, { type NewRuleChoice } from '../components/automation/NewRuleChooser'
import AutomationGuide from '../components/automation/AutomationGuide'
import ServerCrontab from '../components/automation/ServerCrontab'

type Tab = 'rules' | 'cron'

// the tab a device last showed
const TAB_KEY = 'dcs-automation-tab'
function loadTab(): Tab { try { return localStorage.getItem(TAB_KEY) === 'cron' ? 'cron' : 'rules' } catch { return 'rules' } }
function saveTab(t: Tab) { try { localStorage.setItem(TAB_KEY, t) } catch { /* storage unavailable */ } }

const VIEW_ONLY = 'Everywhere is a view: pick the hub or one VM above, then change it there'

const TAB_BTN = 'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'
const CHIP = 'inline-flex items-center gap-1.5 h-8 sm:h-7 px-2.5 rounded-full text-[11px] border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'

export default function Automations() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const serverName = useSystemStore((s) => serverLabel(s.status))
  const { addToast } = useToast()
  const confirm = useConfirm()

  // ---- tab, filter (a link names them: {tab, kind}) ----
  const [tab, setTab] = useState<Tab>(loadTab)
  const [kind, setKind] = useState<KindFilter>('all')
  const shownTab: Tab = isAdmin ? tab : 'rules'   // the crontab is the administrators'
  const pickTab = (t: Tab) => { setTab(t); saveTab(t) }
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (!p) return
    let used = false
    if (p.tab === 'rules' || p.tab === 'cron') { pickTab(p.tab); used = true }
    if (p.kind === 'timed' || p.kind === 'condition' || p.kind === 'all') { setKind(p.kind); used = true }
    if (used) useSettingsStore.getState().consumeNavigationPayload()
  }, [navigationPayload])

  const [showGuide, setShowGuide] = useState(false)
  const [cronRefresh, setCronRefresh] = useState(0)

  // ---- the two stores of rules ----
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const { schedules, loading: schedLoading, saving: schedSaving, error: schedError, fetchSchedules, createSchedule, updateSchedule, deleteSchedule, toggleSchedule, runSchedule } = useScheduleStore()
  // timed DCS tasks: read on arrival and on a scope change (they change only when someone changes them)
  useEffect(() => { if (isConnected) fetchSchedules(scope) }, [fetchSchedules, isConnected, scope])

  // automation rules: every 10 s, as their run counts move when a condition fires
  const fetchScopedAutomations = useCallback(() => fetchAutomations(scope), [scope])
  const { data: autoData, loading: autoLoading, error: autoError, refresh: refreshAutomations } = usePolling(fetchScopedAutomations, 10000, { enabled: isConnected })
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; refreshAutomations() } }, [scope, refreshAutomations])

  const rules = useMemo(
    () => sortRules([...schedules.map(fromSchedule), ...(autoData?.automations ?? []).map(fromAutomation)]),
    [schedules, autoData],
  )
  const stats = useMemo(() => ({
    total: rules.length,
    active: rules.filter((r) => r.enabled).length,
    timed: rules.filter((r) => r.kind === 'timed').length,
    condition: rules.filter((r) => r.kind === 'condition').length,
  }), [rules])
  const shown = useMemo(() => (kind === 'all' ? rules : rules.filter((r) => r.kind === kind)), [rules, kind])
  // both stores answered (a list that grows by half a second later reads as a flicker)
  const ready = (!!autoData || !!autoError) && !(schedLoading && schedules.length === 0 && !schedError)
  const loading = schedLoading || autoLoading

  const refreshAll = () => {
    if (shownTab === 'cron') { setCronRefresh((n) => n + 1); return }
    fetchSchedules(scope)
    refreshAutomations()
  }

  // ---- dialogs ----
  const [choosing, setChoosing] = useState(false)
  const [schedDialog, setSchedDialog] = useState<{ mode: 'create' | 'edit'; id?: string; member: string | null } | null>(null)
  const [schedForm, setSchedForm] = useState<ScheduleFormState>(EMPTY_SCHEDULE_FORM)
  const [autoDialog, setAutoDialog] = useState<{ editing: AutomationRule | null; start: 'schedule' | 'condition'; member: string | null } | null>(null)

  const openNewRule = () => {
    if (scope === 'all') { addToast({ type: 'info', message: VIEW_ONLY }); return }
    setChoosing(true)
  }
  const pickNew = (c: NewRuleChoice) => {
    setChoosing(false)
    if (c === 'timed') { setSchedForm(EMPTY_SCHEDULE_FORM); setSchedDialog({ mode: 'create', member: scopeMember }) }
    else setAutoDialog({ editing: null, start: c === 'cron' ? 'schedule' : 'condition', member: scopeMember })
    if (kind !== 'all' && kind !== (c === 'condition' ? 'condition' : 'timed')) setKind('all')   // the new rule shows in the list
  }

  const submitSchedule = async () => {
    if (!schedDialog || !schedForm.name) return
    if (scope === 'all') { addToast({ type: 'info', message: VIEW_ONLY }); return }
    const ok = schedDialog.mode === 'create'
      ? await createSchedule(schedForm, schedDialog.member)
      : await updateSchedule(schedDialog.id!, schedForm, schedDialog.member)
    if (ok) { setSchedDialog(null); addToast({ type: 'success', message: schedDialog.mode === 'create' ? 'Rule created' : 'Rule updated' }) }
    else addToast({ type: 'error', message: useScheduleStore.getState().error || 'Could not save the rule' })
  }

  // ---- what a row does, on the rule's own store ----
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const where = (r: UnifiedRule) => r.member ?? scopeMember

  const runRule = async (r: UnifiedRule) => {
    setRunningKey(r.key)
    try {
      if (r.src.type === 'schedule') {
        const res = await runSchedule(r.id, where(r))
        if (res) addToast({ type: res.success ? 'success' : 'error', message: res.success ? `${r.name}: ran successfully` : `${r.name}: the run failed: ${res.output}` })
        else addToast({ type: 'error', message: `Could not run ${r.name}` })
      } else {
        const res = await runAutomation(r.id, where(r))
        addToast({ type: res.success ? 'success' : 'error', message: `${r.name}: ${res.message || (res.success ? 'done' : 'failed')}` })
        refreshAutomations()
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : `Could not run ${r.name}` })
    } finally {
      setRunningKey(null)
    }
  }

  const toggleRule = async (r: UnifiedRule) => {
    if (togglingKey) return
    setTogglingKey(r.key)
    try {
      if (r.src.type === 'schedule') {
        if (!(await toggleSchedule(r.id, where(r)))) throw new Error(`Could not ${r.enabled ? 'pause' : 'resume'} ${r.name}`)
      } else {
        await updateAutomation(r.id, { enabled: !r.enabled }, where(r))
        refreshAutomations()
      }
      addToast({ type: 'success', message: `${r.name} ${r.enabled ? 'paused' : 'resumed'}` })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : `Could not switch ${r.name}` })
    } finally {
      setTogglingKey(null)
    }
  }

  const editRule = (r: UnifiedRule) => {
    if (scope === 'all') { addToast({ type: 'info', message: VIEW_ONLY }); return }
    if (r.src.type === 'schedule') {
      const s = r.src.item
      setSchedForm({ name: s.name, schedule: s.schedule || s.cron || '@daily', action: s.action, target: s.target || '' })
      setSchedDialog({ mode: 'edit', id: s.id, member: where(r) })
    } else {
      setAutoDialog({ editing: r.src.item, start: r.src.item.trigger_type, member: where(r) })
    }
  }

  const deleteRule = async (r: UnifiedRule) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `"${r.name}" is removed together with its run history. This cannot be undone.`,
      confirmLabel: 'Delete rule',
      danger: true,
    })
    if (!ok) return
    setDeletingKey(r.key)
    try {
      if (r.src.type === 'schedule') {
        if (!(await deleteSchedule(r.id, where(r)))) throw new Error(useScheduleStore.getState().error || 'Could not delete the rule')
      } else {
        await deleteAutomation(r.id, where(r))
        refreshAutomations()
      }
      addToast({ type: 'success', message: 'Rule deleted' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not delete the rule' })
    } finally {
      setDeletingKey(null)
    }
  }

  if (!isConnected) {
    return (
      <div className="space-y-5 animate-fade-in">
        <DisconnectedBanner />
        <EmptyState icon={<Bot size={32} />} title="Connect to a server to manage automation" />
      </div>
    )
  }

  const kindChips: { value: KindFilter; label: string; count: number; icon: typeof Layers }[] = [
    { value: 'all', label: 'All', count: stats.total, icon: Layers },
    { value: 'timed', label: 'Timed', count: stats.timed, icon: CalendarClock },
    { value: 'condition', label: 'When something happens', count: stats.condition, icon: Radar },
  ]
  const tiles = [
    { label: 'Rules', value: stats.total, icon: Layers, tone: 'text-slate-100', iconTone: 'text-slate-400' },
    { label: 'Active', value: stats.active, icon: Zap, tone: 'text-emerald-400', iconTone: 'text-emerald-400' },
    { label: 'Timed', value: stats.timed, icon: CalendarClock, tone: 'text-slate-100', iconTone: 'text-cyan-400' },
    { label: 'Condition', value: stats.condition, icon: Radar, tone: 'text-slate-100', iconTone: 'text-amber-400' },
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="automations"
        badge={shownTab === 'rules' && scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        subtitle={shownTab === 'cron'
          ? 'The commands this server\'s crontab runs'
          : stats.total > 0 ? `${stats.active} active of ${stats.total} rule${stats.total === 1 ? '' : 's'} · at a time or when something happens` : undefined}
        actions={<>
          {isAdmin && shownTab === 'rules' && (
            <button type="button" onClick={openNewRule} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              <Plus size={14} /> New rule
            </button>
          )}
          <Hint label={showGuide ? 'Hide the guide' : 'Show the guide'}>
            <button
              type="button"
              aria-label="Guide"
              aria-expanded={showGuide}
              onClick={() => setShowGuide(!showGuide)}
              className={`${BTN_TOOLBAR} ${showGuide ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">Guide</span>
            </button>
          </Hint>
          <button type="button" aria-label="Refresh" onClick={refreshAll} disabled={shownTab === 'rules' && loading} className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={shownTab === 'rules' && loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        {hasFleet && shownTab === 'rules' && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={loading && ready} />}
      </PageHeader>

      {/* the rules at a glance, both kinds */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="glass border border-white/5 rounded-xl p-3 sm:p-4 md:p-5">
            <div className="flex items-center gap-2 mb-1">
              <t.icon size={14} className={t.iconTone} aria-hidden />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</span>
            </div>
            <p className={`text-xl sm:text-2xl font-bold tabular-nums ${t.tone}`}>{ready ? t.value : '–'}</p>
          </div>
        ))}
      </div>

      {showGuide && <AutomationGuide onClose={() => setShowGuide(false)} />}

      {/* Rules · Server crontab (the crontab is the administrators') */}
      {isAdmin && (
        <div role="tablist" aria-label="Automation" className="flex items-center gap-1 border-b border-white/5 overflow-x-auto scrollbar-none">
          <button type="button" role="tab" aria-selected={shownTab === 'rules'} onClick={() => pickTab('rules')}
            className={`${TAB_BTN} ${shownTab === 'rules' ? 'text-emerald-400 border-emerald-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
            <ListChecks size={14} aria-hidden /> Rules
            <span className="text-[10px] tabular-nums text-slate-500">{ready ? stats.total : ''}</span>
          </button>
          <button type="button" role="tab" aria-selected={shownTab === 'cron'} onClick={() => pickTab('cron')}
            className={`${TAB_BTN} ${shownTab === 'cron' ? 'text-emerald-400 border-emerald-400' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
            <Server size={14} aria-hidden /> Server crontab
          </button>
        </div>
      )}

      {shownTab === 'cron' ? (
        <ServerCrontab refreshKey={cronRefresh} serverName={serverName} />
      ) : (
        <div className="space-y-4">
          <div role="group" aria-label="Show the rules" className="flex flex-wrap items-center gap-1.5">
            {kindChips.map((c) => (
              <button key={c.value} type="button" aria-pressed={kind === c.value} onClick={() => setKind(c.value)}
                className={`${CHIP} ${kind === c.value ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200' : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'}`}>
                <c.icon size={11} aria-hidden /> {c.label}
                <span className="tabular-nums text-slate-500">{ready ? c.count : ''}</span>
              </button>
            ))}
          </div>

          {schedError && <ErrorState title="Could not read the timed rules" error={schedError} onRetry={() => fetchSchedules(scope)} />}
          {autoError && <ErrorState title="Could not read the condition and cron rules" error={autoError} onRetry={refreshAutomations} />}

          {!ready ? (
            <div className="space-y-3" role="status" aria-label="Reading the rules">
              {[0, 1, 2].map((i) => <div key={i} className="glass border border-white/5 rounded-xl h-[5.5rem] skeleton" aria-hidden />)}
            </div>
          ) : shown.length === 0 ? (
            <div className="glass border border-white/5 rounded-xl">
              <EmptyState
                icon={<Bot size={32} />}
                title={rules.length === 0 ? 'No rules yet' : kind === 'timed' ? 'No timed rules' : 'No rules that wait for something to happen'}
                hint={rules.length === 0
                  ? 'A rule makes DCS do something by itself: a backup every night, a restart when a container turns unhealthy.'
                  : 'The other rules are under All.'}
                action={isAdmin ? (
                  <button type="button" onClick={openNewRule} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                    <Plus size={14} /> New rule
                  </button>
                ) : undefined}
              />
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Rules">
              {shown.map((r) => (
                <RuleRow
                  key={r.key}
                  rule={r}
                  isAdmin={isAdmin}
                  scopeMember={scopeMember}
                  running={runningKey === r.key}
                  toggling={togglingKey === r.key}
                  deleting={deletingKey === r.key}
                  onRun={() => runRule(r)}
                  onToggle={() => toggleRule(r)}
                  onEdit={() => editRule(r)}
                  onDelete={() => deleteRule(r)}
                  onScope={setScope}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {choosing && <NewRuleChooser where={hasFleet ? (scopeMember ? memberName : 'the hub') : null} onPick={pickNew} onClose={() => setChoosing(false)} />}
      {schedDialog && (
        <ScheduleDialog mode={schedDialog.mode} form={schedForm} setForm={setSchedForm} saving={schedSaving} onSubmit={submitSchedule} onClose={() => setSchedDialog(null)} />
      )}
      {autoDialog && (
        <AutomationRuleDialog
          editing={autoDialog.editing}
          startTrigger={autoDialog.start}
          member={autoDialog.member}
          onSaved={() => { setAutoDialog(null); refreshAutomations() }}
          onClose={() => setAutoDialog(null)}
        />
      )}
    </div>
  )
}
