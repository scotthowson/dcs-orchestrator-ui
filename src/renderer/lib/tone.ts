// =============================================================================
// Tone — what a colour means, once for the whole dashboard. Every status pill,
// dot, number tile, card edge and bar picks a tone, never a colour:
//
//   ok         emerald  fine, running, on, up to date
//   attention  amber    needs a look (a warning, an update to make, a disk at 75 %)
//   problem    rose     something failed, is down or destroys something
//   info       cyan     information (an update is available, a count, a source)
//   neutral    slate    nothing to say (stopped by hand, unknown, off)
//   fleet      violet   the fleet's identity: the hub, a VM, "this runs in a VM"
//
// The classes below are the ones the theme engine restyles (scripts/theme-classes.mjs
// lists them), so every theme, dark or light, recolours a tone.
// =============================================================================

export type Tone = 'ok' | 'attention' | 'problem' | 'info' | 'neutral' | 'fleet'

/** the Mantine palette colour of a tone (a Badge, a Switch, a SegmentedControl, a RingProgress) */
export const TONE_COLOR: Record<Tone, 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' | 'violet'> = {
  ok: 'emerald', attention: 'amber', problem: 'rose', info: 'cyan', neutral: 'slate', fleet: 'violet',
}

/** the text colour of a tone */
export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-400', attention: 'text-amber-400', problem: 'text-rose-400', info: 'text-cyan-400', neutral: 'text-slate-300', fleet: 'text-violet-300',
}

/** the fill of a bar in a tone */
export const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-emerald-500', attention: 'bg-amber-500', problem: 'bg-rose-500', info: 'bg-cyan-500', neutral: 'bg-slate-500', fleet: 'bg-violet-500',
}

/** the small dot in front of a status */
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-400', attention: 'bg-amber-400', problem: 'bg-rose-400', info: 'bg-cyan-400', neutral: 'bg-slate-500', fleet: 'bg-violet-400',
}

/** the icon tile at the head of a sheet or a card (a 10 % tint, the icon in the tone) */
export const TONE_TILE: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-400', attention: 'bg-amber-500/15 text-amber-400', problem: 'bg-rose-500/15 text-rose-400',
  info: 'bg-cyan-500/15 text-cyan-400', neutral: 'bg-white/5 text-slate-300', fleet: 'bg-violet-500/15 text-violet-300',
}

/** the same tones as chart colours (an SVG attribute cannot take a class) */
export const TONE_HEX: Record<Tone, string> = {
  ok: '#10b981', attention: '#f59e0b', problem: '#f43f5e', info: '#06b6d4', neutral: '#64748b', fleet: '#8b5cf6',
}

/** a usage percentage: fine below 75, needs attention from 75, a problem from 90 — for every bar and ring of the dashboard */
export const PCT_ATTENTION = 75
export const PCT_PROBLEM = 90
export function pctTone(pct: number): Tone {
  return pct >= PCT_PROBLEM ? 'problem' : pct >= PCT_ATTENTION ? 'attention' : 'ok'
}

/** a number that is fine stays plain: only a verdict that needs a look takes a colour */
export const quiet = (t: Tone): Tone => (t === 'ok' ? 'neutral' : t)

/** the load average against the cores there are: fine below one per core, busy from one, overloaded from two ('neutral' while the core count is unknown) */
export function loadTone(load: number, cores: number | undefined): Tone {
  if (!cores || cores < 1) return 'neutral'
  const perCore = load / cores
  return perCore >= 2 ? 'problem' : perCore >= 1 ? 'attention' : 'ok'
}

/** a health score as a grade: A from 90, B from 75, C from 60, D from 40, F below */
export function scoreGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}
/** the tone of a grade: A fine, B information, C and D need a look, F a problem */
export const GRADE_TONE: Record<string, Tone> = { A: 'ok', B: 'info', C: 'attention', D: 'attention', F: 'problem' }
