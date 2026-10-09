// =============================================================================
// The dashboard's native form fields, once — the same field Mantine draws for a
// Select or a TextInput (lib/mantine.tsx): 40 px, text-sm, the glass fill, a
// hairline edge, an emerald border and ring on focus. Class strings only, in
// colours the theme engine restyles (scripts/theme-classes.mjs lists them).
//
//   <label htmlFor="x" className={LABEL}>Display name</label>
//   <input id="x" className={INPUT} />            (a <select> and a <textarea> wear it too)
//   <p className={HINT}>Shown to the people you share a stack with.</p>
//
//   INPUT        as wide as its column; FIELD the same, as wide as its content
//   INPUT_ICON   with room for an icon at left-3 (a search box, a field with a symbol)
//   FIELD_SM     34 px, text-xs: a field in a toolbar or a table row, as tall as a toolbar button
//   INPUT_FLEET  the fleet's forms (New VM, Link VMs, host folders): a slate fill, the fleet's violet on
//                focus — Mantine's variant="fleet" beside it
//   LABEL        the label above a field; CAPTION the small capitals above a group of fields
//   HINT         the line under a field
//
// A button that is not styled by lib/ui takes FOCUS_RING (lib/ui).
// =============================================================================
import { BTN_CARD, BTN_TOOLBAR } from './ui'

export { FOCUS_RING } from './ui'

const EDGE = 'rounded-lg bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 transition-colors focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed'

/** a text field, select or text area, as wide as its content: 40 px, text-sm */
export const FIELD = `min-h-10 px-3 py-2 text-sm ${EDGE}`
/** the same, as wide as its column */
export const INPUT = `w-full ${FIELD}`
/** the same with room for an icon at left-3 */
export const INPUT_ICON = `w-full min-h-10 pl-9 pr-3 py-2 text-sm ${EDGE}`
/** a field in a toolbar or a table row: as tall as a toolbar button, text-xs */
export const FIELD_SM = `h-[34px] px-3 text-xs ${EDGE}`
/** the search field above a list: the icon sits at left-3, the text starts at pl-10 */
export const SEARCH_FIELD = `w-full min-h-10 pl-10 pr-4 py-2 text-sm ${EDGE}`
/** the fleet's forms: a slate fill, the fleet's violet on focus (dcs-fleet-field: lib/mantine-dcs.css keeps it violet in the light look too) */
export const INPUT_FLEET = 'dcs-fleet-field w-full min-h-10 px-3 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-sm text-slate-200 placeholder-slate-600 transition-colors focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-60 disabled:cursor-not-allowed'

/** the label above a field */
export const LABEL = 'block text-xs font-medium text-slate-300 mb-1.5'
/** the small capitals label above a group of fields, in a form or a panel (CSS shows it in capitals) */
export const CAPTION = 'block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5'
/** the line under a field: what it is for, or what is wrong with it (then in rose) */
export const HINT = 'text-xs text-slate-500 mt-1.5 leading-relaxed'

/** one choice among a few (Auto-lock, Session duration, Mode…): toolbar size; the chosen one is emerald */
export const CHOICE = `${BTN_TOOLBAR} border`
/** the same at card size, for a row of presets (a schedule, a ban length, a stack) */
export const CHOICE_SM = `${BTN_CARD} border`
export const CHOICE_ON = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
export const CHOICE_OFF = 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
