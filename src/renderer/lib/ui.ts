// =============================================================================
// The dashboard's button scale — three sizes and an icon button, taken from the
// Proxmox page, where they were tried first. A button is a SHAPE (its size,
// radius and text) plus a TONE (its colours); the pairs pages need most come
// ready-made. Only classes the theme engine restyles (scripts/theme-classes.mjs
// lists them) — nothing here is a hex value.
//
//   toolbar  BTN_TOOLBAR    32 px (34 with its border; 40 on a phone): the buttons of a page's
//                           header and of a filter row — text-xs, an icon at 14
//   card     BTN_CARD       32 px: an action on a card, in a list row or in a panel — 11 px text, an icon at 12
//   sheet    BTN_SHEET      44 px: the buttons that end a sheet or a dialog (Cancel · Save) — text-sm
//   icon     BTN_ICON       36 px on a phone, 32 from sm up: a button that is only an icon (14) —
//            BTN_ICON_SM    32 px on a phone, 28 from sm up: the same in a dense row (12)
//
// An icon button takes a tone that draws its edge (TONE_QUIET · OK · ATTN · DANGER) or a ghost tone (no
// edge: a row of icons in a list or a table).
//
// Icons (lucide, `size`): ICON.toolbar 14 in a toolbar button and a sheet's button, ICON.card 12 in a
// card's button, a small icon button and a pill (10), ICON.row 16 at the head of a row, a card or a
// notice, ICON.hero 20 in a page's or an empty state's tile. A spinner takes the size of what it replaces.
//
//   <button className={BTN_TOOLBAR_QUIET}><RefreshCw size={14} /> Refresh</button>
//   <button className={`${BTN_ICON} ${TONE_DANGER}`} aria-label="Stop"><Square size={14} /></button>
//
// An icon-only button needs a name (aria-label) and a hint (components/common/Hint).
// =============================================================================

// ── shapes ──────────────────────────────────────────────────────────────────
export const BTN_TOOLBAR = 'px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const BTN_CARD = 'h-8 px-2.5 rounded-lg text-[11px] inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const BTN_SHEET = 'h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed'
export const BTN_ICON = 'h-9 w-9 sm:h-8 sm:w-8 rounded-lg inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const BTN_ICON_SM = 'h-8 w-8 sm:h-7 sm:w-7 rounded-lg inline-flex items-center justify-center shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// ── tones ───────────────────────────────────────────────────────────────────
/** neutral: the button that is always there */
export const TONE_QUIET = 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
/** go: start, resume, confirm — emerald */
export const TONE_OK = 'bg-emerald-500/5 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15'
/** needs a look: a rollback, an update to finish, something nobody linked yet — amber */
export const TONE_ATTN = 'bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20'
/** destructive: stop, remove, reset — rose */
export const TONE_DANGER = 'bg-rose-500/5 border border-rose-500/20 text-rose-300 hover:bg-rose-500/15'

/** no edge: the icons of a list row or a table row */
export const TONE_GHOST = 'text-slate-300 hover:bg-white/10'
export const TONE_GHOST_OK = 'text-emerald-300 hover:bg-emerald-500/10'
export const TONE_GHOST_DANGER = 'text-rose-300 hover:bg-rose-500/10'

// ── the common pairs ────────────────────────────────────────────────────────
export const BTN_TOOLBAR_QUIET = `${BTN_TOOLBAR} ${TONE_QUIET}`
/** a toolbar's go (Save and apply, Deploy, Add): emerald, once per view */
export const BTN_TOOLBAR_OK = `${BTN_TOOLBAR} ${TONE_OK}`
export const BTN_TOOLBAR_ATTN = `${BTN_TOOLBAR} ${TONE_ATTN}`
export const BTN_TOOLBAR_DANGER = `${BTN_TOOLBAR} ${TONE_DANGER}`
export const BTN_CARD_QUIET = `${BTN_CARD} ${TONE_QUIET}`
export const BTN_ICON_QUIET = `${BTN_ICON} ${TONE_QUIET}`
export const BTN_ICON_SM_QUIET = `${BTN_ICON_SM} ${TONE_QUIET}`
export const BTN_SHEET_QUIET = `${BTN_SHEET} ${TONE_QUIET}`
/** the sheet's main button: solid emerald, or rose where it destroys something */
export const BTN_SHEET_PRIMARY = `${BTN_SHEET} font-semibold text-white bg-emerald-600 hover:bg-emerald-500`
export const BTN_SHEET_DANGER = `${BTN_SHEET} font-semibold text-white bg-rose-600 hover:bg-rose-500`

/** the ring a control without a field of its own shows when the keyboard is on it */
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40'

/** the icon sizes (see the header) */
export const ICON = { pill: 10, card: 12, toolbar: 14, row: 16, hero: 20 } as const

// ── headings ────────────────────────────────────────────────────────────────
// A page's own <h1> is PageHeader's. Under it, three kinds of heading and no others:
/** the title of a panel, a card or a section of a page (an <h2>, or an <h3> inside a panel) */
export const TITLE_PANEL = 'text-sm font-semibold text-slate-200'
/** the title of a sheet or a dialog */
export const TITLE_DIALOG = 'text-base font-semibold text-slate-100'
/** the small capitals above a group of rows, fields or cards (common/SectionHeader draws it with a count and buttons) */
export const SECTION_LABEL = 'text-xs font-semibold text-slate-400 uppercase tracking-wider'
