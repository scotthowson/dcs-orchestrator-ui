// =============================================================================
// ActiveAutomations — the rules of the Automation page (its timed rules, the former
// schedules, and its condition and cron rules) and whether they are switched on
// =============================================================================

import { Bot } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { pageLabel } from '../../constants/pageTitles'
import type { AutomationListResponse, ScheduleListResponse } from '../../../shared/types'
import { Card, CardBody, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
import { Pill } from '../common/Pill'
interface Props {
  data: AutomationListResponse | null
  /** the timed rules (GET /schedules); null while unknown */
  schedules?: ScheduleListResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function ActiveAutomations({ data, schedules, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  if (!isConnected && !data) return <Card card="automations" dim><CardOffline /></Card>
  if (!data && error) return <Card card="automations"><ErrorState card title="Could not load the automations" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="automations"><Skeleton label="Loading the automations…" rows={3} /></Card>

  // one list, as the Automation page shows it: active first, then by name
  const rules = [
    ...data.automations.map((a) => ({ key: `a-${a.member ?? ''}-${a.id}`, name: a.name, enabled: a.enabled, timed: a.trigger_type === 'schedule' })),
    ...(schedules?.schedules ?? []).map((s) => ({ key: `s-${s.member ?? ''}-${s.id}`, name: s.name, enabled: s.enabled, timed: true })),
  ].sort((x, y) => Number(y.enabled) - Number(x.enabled) || x.name.localeCompare(y.name))
  const enabled = rules.filter((r) => r.enabled).length
  const recent = rules.slice(0, 30)   // as many as the card is tall: the body scrolls beyond that

  return (
    <Card card="automations" meta={`${enabled}/${rules.length} active`} open="automations">
      {recent.length === 0 ? (
        <EmptyState card icon={<Bot size={22} />} title="No automation rules yet" hint={`Create a rule on the ${pageLabel('automations')} page and it shows up here.`} />
      ) : (
        <CardBody className="space-y-1.5">
          {recent.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} role="img" aria-label={a.enabled ? 'On' : 'Off'} />
                <span className="text-[11px] text-slate-300 truncate">{a.name}</span>
              </div>
              <Pill tone={a.timed ? 'info' : 'attention'}>{a.timed ? 'Timed' : 'Condition'}</Pill>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  )
}
