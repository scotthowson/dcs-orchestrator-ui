// =============================================================================
// The sidebar's sections, once: ten entries, and every page of the dashboard
// in exactly one of them. A section opens on a tab bar of its pages; a page
// keeps its own id, so a link, a bookmark, the command palette or a
// notification that opens `uptime` still opens Uptime (as the Uptime tab of
// Monitoring).
//
// The sidebar, the tab bar over a page (SectionTabs), the phone's menu, the
// command palette, Ctrl+1…0 and Settings → Sidebar & pages all read this file.
// A new page: one line in SECTION_OF below (TypeScript refuses a page that has
// no section), plus what pageTitles.ts asks for.
// =============================================================================

import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Layers, Server, Boxes, Activity, ShieldCheck, Wrench, Timer, TerminalSquare, Cog } from 'lucide-react'
import type { PageId } from '../../shared/types'

export type SectionId =
  | 'dashboard' | 'stacks' | 'fleet' | 'docker' | 'monitoring'
  | 'security' | 'maintenance' | 'automation' | 'tools' | 'settings'

/**
 * Pages that became a view of another page (4.0.31: Uptime is Health's "Last 30 min", Live Events is a tab of
 * Activity, Schedules and Cron Jobs are Automation, Snapshots are a view of Backups). Their ids stay valid: opening
 * one opens the page it moved into, on its view (PAGE_ALIASES), so links, bookmarks, cards and saved pages still work.
 */
export type AliasPageId = 'uptime' | 'event-feed' | 'schedules' | 'cronjobs' | 'snapshots'

/** the pages the sidebar reaches (the setup wizard is a screen of its own; an alias opens the page it moved into) */
export type NavPageId = Exclude<PageId, 'setup' | AliasPageId>

/** where each moved page lives now, and the navigation payload that opens its view there (the page reads it with consumeNavigationPayload) */
export const PAGE_ALIASES: Record<AliasPageId, { to: NavPageId; payload: Record<string, unknown> }> = {
  uptime: { to: 'health', payload: { view: 'timeline' } },
  'event-feed': { to: 'activity', payload: { tab: 'live' } },
  schedules: { to: 'automations', payload: { tab: 'rules', kind: 'timed' } },
  cronjobs: { to: 'automations', payload: { tab: 'cron' } },
  snapshots: { to: 'backup', payload: { view: 'snapshots' } },
}

export function isAliasPage(page: PageId): page is AliasPageId {
  return Object.prototype.hasOwnProperty.call(PAGE_ALIASES, page)
}

/** the page to show for an id, and the payload to open it with (a payload given by the caller wins over the alias's) */
export function resolvePage(page: PageId, payload?: Record<string, unknown> | null): { page: PageId; payload: Record<string, unknown> | null } {
  if (!isAliasPage(page)) return { page, payload: payload ?? null }
  const a = PAGE_ALIASES[page]
  return { page: a.to, payload: { ...a.payload, ...(payload ?? {}) } }
}

/** where each page lives; the order here is the order of the tabs */
const SECTION_OF = {
  dashboard: 'dashboard',

  stacks: 'stacks',
  templates: 'stacks',
  environment: 'stacks',

  proxmox: 'fleet',
  topology: 'fleet',

  containers: 'docker',
  images: 'docker',
  volumes: 'docker',
  networks: 'docker',
  'disk-analysis': 'docker',

  health: 'monitoring',
  trends: 'monitoring',
  diagnostics: 'monitoring',
  activity: 'monitoring',
  logs: 'monitoring',

  crowdsec: 'security',
  dns: 'security',
  secrets: 'security',
  users: 'security',

  updates: 'maintenance',
  backup: 'maintenance',
  export: 'maintenance',
  maintenance: 'maintenance',

  automations: 'automation',

  terminal: 'tools',
  'file-browser': 'tools',
  bookmarks: 'tools',
  plugins: 'tools',

  settings: 'settings',
  notifications: 'settings',
  config: 'settings',
  system: 'settings',
} as const satisfies Record<NavPageId, SectionId>

export interface NavSection {
  id: SectionId
  label: string
  icon: LucideIcon
  /** one line for the phone menu and Settings → Sidebar & pages */
  hint: string
  /** its pages, in tab order; the first is where the section opens the first time */
  pages: NavPageId[]
}

const SECTION_META: { id: SectionId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Your cards, laid out your way' },
  { id: 'stacks', label: 'Stacks', icon: Layers, hint: 'Your Compose stacks, the template gallery and their .env files' },
  { id: 'fleet', label: 'Fleet', icon: Server, hint: 'Proxmox, the VMs and how everything connects' },
  { id: 'docker', label: 'Docker', icon: Boxes, hint: 'Containers, images, volumes, networks and disk use' },
  { id: 'monitoring', label: 'Monitoring', icon: Activity, hint: 'Health, uptime, history, events and logs' },
  { id: 'security', label: 'Security', icon: ShieldCheck, hint: 'CrowdSec, domains and routes, secrets and users' },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, hint: 'Updates, backups and snapshots, exports and cleanup' },
  { id: 'automation', label: 'Automation', icon: Timer, hint: 'Timed and conditional rules, and the server crontab' },
  { id: 'tools', label: 'Tools', icon: TerminalSquare, hint: 'Terminal, file browser, bookmarks and plugins' },
  { id: 'settings', label: 'Settings', icon: Cog, hint: 'This dashboard, notifications and the server' },
]

export const navSections: NavSection[] = SECTION_META.map((s) => ({
  ...s,
  pages: (Object.keys(SECTION_OF) as NavPageId[]).filter((p) => SECTION_OF[p] === s.id),
}))

const byId = new Map(navSections.map((s) => [s.id, s]))

/** the section a page lives in (an alias: the section of the page it moved into; undefined for the setup wizard) */
export function sectionOf(page: PageId): NavSection | undefined {
  const p = isAliasPage(page) ? PAGE_ALIASES[page].to : page
  return p === 'setup' ? undefined : byId.get(SECTION_OF[p])
}

export function sectionById(id: SectionId): NavSection {
  return byId.get(id)!
}

/** every page the sidebar reaches, in sidebar-then-tab order */
export const navPages: NavPageId[] = navSections.flatMap((s) => s.pages)

/** pages that can't be hidden: without them there is no way back to Settings → Sidebar & pages */
export const UNHIDEABLE: ReadonlySet<PageId> = new Set<PageId>(['dashboard', 'settings'])

/**
 * The pages of a section this person sees: the admin-only ones only for an admin,
 * the ones they hid not at all, except the page they are on right now (they got
 * there from the palette or a link, and the tab bar should say where they are).
 */
export function visiblePages(section: NavSection, opts: { isAdmin: boolean; hidden: readonly PageId[]; adminOnly: ReadonlySet<PageId>; current?: PageId }): NavPageId[] {
  return section.pages.filter((p) =>
    (opts.isAdmin || !opts.adminOnly.has(p)) && (p === opts.current || UNHIDEABLE.has(p) || !opts.hidden.includes(p)))
}

// the tab each section was last on, so going back to a section returns to it (this window only)
const lastTab = new Map<SectionId, NavPageId>()

export function rememberTab(page: PageId): void {
  const s = sectionOf(page)
  if (s && !isAliasPage(page)) lastTab.set(s.id, page as NavPageId)
}

/** where clicking a section goes: the tab it was last on while that is still shown, else its first shown tab */
export function sectionTarget(section: NavSection, shown: NavPageId[]): NavPageId | undefined {
  const last = lastTab.get(section.id)
  return last && shown.includes(last) ? last : shown[0]
}
