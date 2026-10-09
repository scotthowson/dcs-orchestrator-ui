// =============================================================================
// pageKit — the few class strings the inventory and monitoring pages share
// (Networks, Volumes, Disk Analysis, Diagnostics, Topology, Activity, Live
// Events, Logs, Bookmarks, File Browser), taken from the reference pages so
// that a card, a search field and a row's hover actions look the same on each.
// Buttons, headings and the focus ring live in lib/ui.ts, fields in
// lib/fieldStyles.ts; this file holds the page card and the hover reveal.
// Only classes the theme engine restyles — nothing here is a hex.
// =============================================================================

/** a page-level card or tile (the Proxmox page's CARD) */
export const CARD = 'rounded-xl bg-white/[0.03] border border-white/5'

/** a card that leads somewhere: its edge firms up under the pointer */
export const CARD_HOVER = `${CARD} hover:border-white/10 transition-colors`

/**
 * Actions that appear when a row or card (a `group`) is pointed at or has the keyboard in it. On a device
 * without hover (a phone, a tablet) they are simply there — a hover-only button cannot be reached by touch.
 */
export const REVEAL = 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:opacity-100'
