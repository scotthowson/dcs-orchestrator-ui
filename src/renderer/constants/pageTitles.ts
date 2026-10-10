// =============================================================================
// The pages of the dashboard, once: for every page id its one name, its icon
// and a short line that says what the page is for.
//
// The name (`label`) is what the sidebar, the phone's tab bar and menu, the
// breadcrumb, the top bar on a phone, the command palette, the quick-action
// picker, the browser tab title and the page's own heading (PageHeader) all
// write. Nothing else should spell a page's name: use pageLabel('config') even
// inside a sentence ("Open " + pageLabel('config')), so a rename is one edit here.
//
// A new page: add its id to PageId (shared/types.ts), an entry below, its
// component to App.tsx, and its section in constants/navSections.ts (the
// sidebar, the tab strip, the phone menu and the palette follow from there).
// =============================================================================

import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Layers, Box, HardDrive, HeartPulse, Clock, Network, Database, Bookmark, Zap, FileCode,
  Archive, ScrollText, Monitor, Shield, Users, Settings2, Cog, TerminalSquare, CalendarClock, TrendingUp,
  ArrowUpCircle, Bell, Camera, LayoutTemplate, Bot, Share2, FolderOpen, PieChart, KeyRound, Timer, Puzzle, Radio,
  Download, Globe, Server, ShieldCheck, ShieldHalf, Sparkles, Eraser,
} from 'lucide-react'
import type { PageId } from '../../shared/types'

export interface PageMeta {
  /** the page's one name */
  label: string
  /** what the page is for, in one plain line: PageHeader shows it when the page has nothing livelier to say */
  subtitle: string
  /** the page's icon: sidebar, phone menu, command palette, PageHeader */
  icon: LucideIcon
  /** other names the page went by, found by the command palette's search and shown nowhere */
  aliases?: string[]
}

export const pageMeta: Record<PageId, PageMeta> = {
  dashboard: { label: 'Dashboard', subtitle: 'Overview of your Docker environment', icon: LayoutDashboard },
  stacks: { label: 'Stacks', subtitle: 'Start, stop, edit and deploy your Compose stacks', icon: Layers, aliases: ['Stack Manager'] },
  containers: { label: 'Containers', subtitle: 'Manage and monitor all Docker containers', icon: Box },
  images: { label: 'Images', subtitle: 'Track image freshness and check the registries for updates', icon: HardDrive },
  health: { label: 'Health', subtitle: 'Every container, live, with its last 30 minutes', icon: HeartPulse, aliases: ['Health Monitor', 'Uptime', 'Uptime Monitor', 'Availability'] },
  uptime: { label: 'Uptime', subtitle: 'Container availability and uptime tracking across all stacks', icon: Clock, aliases: ['Uptime Monitor'] },
  networks: { label: 'Networks', subtitle: 'Docker networks and the containers connected to them', icon: Network },
  volumes: { label: 'Volumes', subtitle: 'Docker volumes and persistent data', icon: Database },
  bookmarks: { label: 'Bookmarks', subtitle: 'Pin your favorite pages, stacks and containers for quick access', icon: Bookmark },
  activity: { label: 'Activity', subtitle: 'Everything that happened on your servers: history, the live stream and who did what', icon: Zap, aliases: ['Activity Timeline', 'Live Events', 'Live Event Feed', 'Audit Log'] },
  maintenance: { label: 'Cleanup', subtitle: 'Reclaim disk space: unused Docker data, old logs and caches', icon: Eraser, aliases: ['Maintenance', 'Docker cleanup'] },
  environment: { label: 'Environment', subtitle: 'The root and per-stack .env files', icon: FileCode, aliases: ['Environment Variables'] },
  backup: { label: 'Backups', subtitle: 'Save your servers and bring them back: backups, config snapshots and recovery bundles', icon: Archive, aliases: ['Backup', 'Backup & Restore', 'Snapshots', 'System Snapshots', 'Recovery bundle'] },
  logs: { label: 'Logs', subtitle: 'Framework logs with filtering and search', icon: ScrollText, aliases: ['Log Viewer'] },
  system: { label: 'System', subtitle: 'Server resources, Docker runtime and maintenance tools', icon: Monitor, aliases: ['System Info', 'System Information'] },
  diagnostics: { label: 'Diagnostics', subtitle: 'System health, resource use and alerts in depth', icon: Shield },
  users: { label: 'Users', subtitle: 'Registered users, invite codes and the sign-in to your apps', icon: Users, aliases: ['User Management'] },
  config: { label: 'Config', subtitle: 'Environment variables, feature flags and server settings', icon: Settings2, aliases: ['Server Config', 'Server Configuration'] },
  settings: { label: 'Settings', subtitle: 'Connection, appearance, preferences and more', icon: Cog },
  terminal: { label: 'Terminal', subtitle: 'Run commands on the server', icon: TerminalSquare },
  cronjobs: { label: 'Cron Jobs', subtitle: 'Timed commands from the server crontab', icon: CalendarClock },
  trends: { label: 'Trends', subtitle: 'Historical resource usage', icon: TrendingUp, aliases: ['Resource Trends'] },
  updates: { label: 'Updates', subtitle: 'DCS framework and Docker image updates', icon: ArrowUpCircle, aliases: ['Image Updates', 'System Updates'] },
  notifications: { label: 'Notifications', subtitle: 'Alerts, webhooks and notification rules', icon: Bell, aliases: ['Notification Center'] },
  snapshots: { label: 'Snapshots', subtitle: 'Create, restore and manage configuration snapshots', icon: Camera, aliases: ['System Snapshots'] },
  templates: { label: 'Templates', subtitle: 'Deploy ready-made stacks from the gallery', icon: LayoutTemplate, aliases: ['Stack Templates'] },
  automations: { label: 'Automation', subtitle: 'Do something at a time, or when something happens, on any of your servers', icon: Bot, aliases: ['Automations', 'Schedules', 'Scheduled Tasks', 'Cron Jobs', 'Crontab'] },
  topology: { label: 'Topology', subtitle: 'Stacks, containers and network connections as a map', icon: Share2, aliases: ['Network Topology'] },
  'file-browser': { label: 'File Browser', subtitle: 'Browse files inside running containers', icon: FolderOpen },
  'disk-analysis': { label: 'Disk Analysis', subtitle: 'Docker disk usage breakdown', icon: PieChart },
  secrets: { label: 'Secrets', subtitle: 'Encrypted values injected into stacks at start', icon: KeyRound, aliases: ['Secrets Manager'] },
  schedules: { label: 'Schedules', subtitle: 'Automated tasks that run on a schedule', icon: Timer, aliases: ['Scheduled Tasks'] },
  plugins: { label: 'Plugins', subtitle: 'Extend DCS with templates and lifecycle hooks', icon: Puzzle },
  'event-feed': { label: 'Live Events', subtitle: 'Server events as they happen', icon: Radio, aliases: ['Live Event Feed'] },
  export: { label: 'Export', subtitle: 'Download server data, reports and configurations', icon: Download, aliases: ['Export Center'] },
  dns: { label: 'DNS & Routes', subtitle: 'Traefik routes and Cloudflare DNS records', icon: Globe },
  technitium: { label: 'Technitium', subtitle: "The home's DNS: what is asked and blocked, the kids' groups and their bedtime, both servers in step", icon: ShieldHalf, aliases: ['Technitium DNS', 'Parental controls', 'Kids'] },
  proxmox: { label: 'Proxmox', subtitle: 'VMs and containers on your Proxmox host', icon: Server },
  crowdsec: { label: 'CrowdSec', subtitle: 'Bans, alerts, the allowlist, countries and Discord alerts for the intrusion prevention on your servers', icon: ShieldCheck },
  setup: { label: 'Setup Wizard', subtitle: 'Guided first-run configuration', icon: Sparkles },
}

/** the page's one name (the id itself for a page this build does not know) */
export function pageLabel(id: PageId): string {
  return pageMeta[id]?.label ?? id
}

/** id → name, for the places that list pages */
export const pageTitles = Object.fromEntries((Object.keys(pageMeta) as PageId[]).map((id) => [id, pageMeta[id].label])) as Record<PageId, string>
