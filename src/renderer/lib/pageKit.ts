// =============================================================================
// pageKit — the few class strings the inventory and monitoring pages share
// (Networks, Volumes, Disk Analysis, Diagnostics, Topology, Activity, Live
// Events, Logs, Bookmarks, File Browser), taken from the reference pages so
// that a card, a search field and a row's hover actions look the same on each.
// Buttons, headings and the focus ring live in lib/ui.ts, fields in
// lib/fieldStyles.ts; this file holds the page card and the hover reveal.
// Only classes the theme engine restyles — nothing here is a hex.
// =============================================================================

/**
 * The quiet surface (index.css `.surface`): every panel, tile, list and table of a page — one fill, one hairline,
 * the theme's radius, no blur and no shadow in the dark look (a hairline shadow in the light one). The raised
 * surface is `glass`, for what floats over the page (sheets, dialogs, menus, toasts). A tone edge
 * (`border-rose-500/30`) or a hover edge (`hover:border-white/10`) added beside it wins over its own.
 */
export const CARD = 'surface'

/** the parts of a page, one under the other: 16 px apart on a phone, 24 from md up (every page's root) */
export const PAGE_STACK = 'space-y-4 md:space-y-6'

/** a card that leads somewhere: its edge firms up under the pointer */
export const CARD_HOVER = `${CARD} hover:border-white/10 transition-colors`

/**
 * Actions that appear when a row or card (a `group`) is pointed at or has the keyboard in it. On a device
 * without hover (a phone, a tablet) they are simply there — a hover-only button cannot be reached by touch.
 */
export const REVEAL = 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:opacity-100'
