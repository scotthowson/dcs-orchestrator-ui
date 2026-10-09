// =============================================================================
// LogHealthSummary — how many critical lines, errors and warnings the log holds
// =============================================================================

import { useConnectionStore } from '../../stores/connectionStore'
import type { LogStatsResponse } from '../../../shared/types'
import { Card, CardOffline } from './cardShared'
import { Skeleton, ErrorState } from '../common/PageState'
import { Pill } from '../common/Pill'
interface Props {
  data: LogStatsResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function LogHealthSummary({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  if (!isConnected && !data) return <Card card="log-health" dim><CardOffline /></Card>
  if (!data && error) return <Card card="log-health"><ErrorState card title="Could not load the log statistics" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="log-health"><Skeleton label="Loading the log statistics…" rows={2} /></Card>

  const { levels, total_lines, file_size } = data
  const clean = levels.critical === 0 && levels.error === 0 && levels.warning === 0

  return (
    <Card card="log-health" meta={file_size && file_size !== '0' ? file_size : undefined} open="logs" tone={levels.critical > 0 ? 'problem' : undefined}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {levels.critical > 0 && <Pill tone="problem" size="md">{levels.critical} critical</Pill>}
        {levels.error > 0 && <Pill tone="problem" size="md">{levels.error} error{levels.error === 1 ? '' : 's'}</Pill>}
        {levels.warning > 0 && <Pill tone="attention" size="md">{levels.warning} warning{levels.warning === 1 ? '' : 's'}</Pill>}
        {clean && <Pill tone="ok" size="md">Clean</Pill>}
      </div>
      <p className="text-[11px] text-slate-500">{total_lines.toLocaleString()} total lines</p>
    </Card>
  )
}
