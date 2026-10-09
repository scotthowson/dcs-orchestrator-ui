import { create } from 'zustand'
import { StackInfo } from '../../shared/types'
import { onServerReset } from '../lib/serverScope'

interface StackState {
  stacks: StackInfo[]
  actionLoading: string | null
  lastActionTimestamps: Record<string, number>
  setStacks: (stacks: StackInfo[]) => void
  setActionLoading: (name: string | null) => void
  recordAction: (stackName: string) => void
}

function loadActionTimestamps(): Record<string, number> {
  try {
    const raw = localStorage.getItem('stack-action-timestamps')
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

export const useStackStore = create<StackState>((set, get) => ({
  stacks: [],
  actionLoading: null,
  lastActionTimestamps: loadActionTimestamps(),

  setStacks: (stacks) => set({ stacks }),
  setActionLoading: (name) => set({ actionLoading: name }),
  recordAction: (stackName) => {
    const updated = { ...get().lastActionTimestamps, [stackName]: Date.now() }
    localStorage.setItem('stack-action-timestamps', JSON.stringify(updated))
    set({ lastActionTimestamps: updated })
  },
}))

// the stacks are the server's; the action times are this device's
onServerReset(() => useStackStore.setState({ stacks: [], actionLoading: null }))
