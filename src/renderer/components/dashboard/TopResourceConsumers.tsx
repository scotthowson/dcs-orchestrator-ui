// =============================================================================
// TopResourceConsumers — the containers using the most CPU or memory (as many as the card is tall)
// =============================================================================

import { useState } from 'react'
import { Cpu } from 'lucide-react'
import { useContainerStore } from '../../stores/containerStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { Card, CardBody, CardOffline, CardSwitch } from './cardShared'
import { pctTone, TONE_FILL } from '../../lib/tone'
import { EmptyState } from '../common/PageState'
function parsePercent(val: string): number {
  const n = parseFloat(val)
  return isNaN(n) ? 0 : n
}

export default function TopResourceConsumers() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const stats = useContainerStore((s) => s.stats)
  const [mode, setMode] = useState<'cpu' | 'mem'>('cpu')

  if (!isConnected && Object.keys(stats).length === 0) return <Card card="top-consumers" dim><CardOffline /></Card>

  const entries = Object.entries(stats)
    .map(([name, s]) => ({ name, cpu: parsePercent(s.cpu_percent), mem: parsePercent(s.memory_percent) }))
    .sort((a, b) => mode === 'cpu' ? b.cpu - a.cpu : b.mem - a.mem)
    .slice(0, 20)

  return (
    <Card
      card="top-consumers"
      open="containers"
      actions={<CardSwitch label="Rank by" value={mode} onChange={setMode} data={[{ value: 'cpu', label: 'CPU' }, { value: 'mem', label: 'MEM' }]} />}
    >
      {entries.length === 0 ? (
        <EmptyState card icon={<Cpu size={22} />} title="No container stats yet" hint="They appear once containers are running." />
      ) : (
        <CardBody className="space-y-2">
          {entries.map((e) => {
            const pct = mode === 'cpu' ? e.cpu : e.mem
            return (
              <div key={e.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-slate-300 font-mono truncate max-w-[60%]">{e.name}</span>
                  <span className="text-[11px] text-slate-400 font-medium tabular-nums">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800/60 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${TONE_FILL[pctTone(pct)]}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              </div>
            )
          })}
        </CardBody>
      )}
    </Card>
  )
}
