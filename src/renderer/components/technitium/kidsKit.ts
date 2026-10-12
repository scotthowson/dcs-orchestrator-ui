// The kids' controls' words and sums, shared by the Kids tab's cards and the group editor.

import type { TechnitiumCategory, TechnitiumGroup, TechnitiumWindow } from '../../../shared/types'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "every day", "Mon–Fri", "weekends", or the days */
export function daysLabel(days: number[]): string {
  const d = [...days].sort().join()
  if (d === '1,2,3,4,5,6,7') return 'every day'
  if (d === '1,2,3,4,5') return 'Mon–Fri'
  if (d === '1,2,3,4,7') return 'Sun–Thu'
  if (d === '6,7') return 'weekends'
  return [...days].sort().map((x) => DAYS[x - 1]).join(', ')
}

/** how long a window lasts, "10 h" or "9 h 30" */
export function windowLength(from: string, to: string): string {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm }
  const d = (m(to) - m(from) + 1440) % 1440
  return d === 0 ? '—' : `${Math.floor(d / 60)} h${d % 60 ? ` ${String(d % 60).padStart(2, '0')}` : ''}`
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "Games and Video and streaming", "Games, Chat and Shopping" */
export function categoryNames(ids: string[], categories: TechnitiumCategory[]): string {
  const n = ids.map((id) => categories.find((c) => c.id === id)?.name ?? id)
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/** what a window blocks, in a few words */
export function windowBlocks(w: TechnitiumWindow, categories: TechnitiumCategory[]): string {
  return w.scope === 'all' ? 'every name' : categoryNames(w.categories, categories) || 'no category yet'
}

/** the pills of what is in force now: "Bedtime until 07:00", "Games blocked until 18:00" */
export function activeLabels(g: TechnitiumGroup, categories: TechnitiumCategory[]): { key: string; text: string; all: boolean }[] {
  return g.windows.filter((w) => w.active && w.id).map((w) => ({
    key: w.id!,
    all: w.scope === 'all',
    text: w.scope === 'all' ? `${w.name} until ${w.to}` : `${categoryNames(w.categories, categories)} blocked until ${w.to}`,
  }))
}

export const NEW_WINDOW: TechnitiumWindow = { name: 'Bedtime', enabled: true, from: '21:00', to: '07:00', days: [1, 2, 3, 4, 5, 6, 7], scope: 'all', categories: [] }
