// =============================================================================
// useStackCounts — how many stacks run, for the chosen fleet scope: everywhere
// (the hub's /stacks already carries every VM's, tagged), the hub alone, or one
// VM. The Health page and the dashboard cards read the same numbers.
// =============================================================================

import { useMemo } from 'react'
import { usePolling } from './usePolling'
import { fetchStacks } from '../api/endpoints'
import { pollKeys } from '../api/pollKeys'
import { scopeMember, type FleetScope } from './useFleetScope'

export function useStackCounts(scope: FleetScope): { total: number; running: number; sleeping: number; loaded: boolean } {
  const { data } = usePolling(fetchStacks, 30000, { key: pollKeys.stacks })
  return useMemo(() => {
    const all = data?.stacks ?? []
    const member = scopeMember(scope)
    const mine = scope === 'all' ? all : scope === 'hub' ? all.filter((st) => st.placement !== 'vm') : all.filter((st) => st.member === member)
    const sleeping = mine.filter((st) => st.status !== 'running' && st.sleeping).length
    // a stack Sablier keeps asleep is on purpose: it stays out of the total the score is made of
    return { total: mine.length - sleeping, running: mine.filter((st) => st.status === 'running').length, sleeping, loaded: !!data }
  }, [data, scope])
}
