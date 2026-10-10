// =============================================================================
// CommandPalette — Spotlight-style global search (Ctrl+K / Cmd+K)
// =============================================================================

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Search, Layers, Box, HeartPulse, Network, ScrollText, ArrowRight, Trash2, Play, Square, RotateCw,
  Command, Sun, Moon, PanelLeftClose, PanelLeft, LogOut, RefreshCw, Download, Shield, UserCircle,
  Archive, ArrowUpCircle, LayoutTemplate, Puzzle, ListChecks, Globe, Server, BookOpen,
} from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { pageMeta } from '../constants/pageTitles'
import { toggleMode, useResolvedMode } from '../lib/colorMode'
import { useSystemStore } from '../stores/systemStore'
import { useHealthStore } from '../stores/healthStore'
import { useApiLink } from '../hooks/useApiLink'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from './common/Toast'
import {
  startStack, stopStack, restartStack,
  startContainer, stopContainer, restartContainer,
  runImagePrune, triggerLogRotate, fetchHealthReport, triggerBackup,
  fetchTemplates, fetchRoutes, fetchProxmoxVms, fetchFleetMembers,
} from '../api/endpoints'
import { useStackStore } from '../stores/stackStore'
import { useContainerStore } from '../stores/containerStore'
import type { PageId, TemplateInfo, ProxmoxVm, FleetMember } from '../../shared/types'
import { ADMIN_ONLY_PAGES } from '../../shared/types'
import { technitiumEnabledNow } from '../hooks/useTechnitiumEnabled'
import ModalOverlay from './common/ModalOverlay'
import { navPages, sectionOf } from '../constants/navSections'
import { containerState, isAsleep, stackLine, STATE_META } from '../lib/containerState'

import Kbd from './common/Kbd'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandType = 'page' | 'action' | 'stack' | 'container' | 'template' | 'route' | 'vm' | 'docs'

interface CommandItem {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  type: CommandType
  keywords?: string[]
  onSelect: () => void
}

// ---------------------------------------------------------------------------
// Fuzzy scoring: 0 = no match. Exact 1000, prefix ~900, word prefix 800,
// substring ~700, then an in-order character match scored by consecutive runs
// and word starts, minus a little per gap.
// ---------------------------------------------------------------------------
function fuzzyScore(q: string, text: string): number {
  const t = text.toLowerCase()
  if (!q) return 1
  if (!t) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 900 - Math.min(50, t.length) * 0.1
  if (t.split(/[\s&/:_.-]+/).some((w) => w.startsWith(q))) return 800
  const at = t.indexOf(q)
  if (at >= 0) return 700 - Math.min(100, at) * 0.5
  let ti = 0, score = 0, streak = 0
  for (const ch of q) {
    const next = t.indexOf(ch, ti)
    if (next < 0) return 0
    if (next === ti && ti > 0) { streak += 1; score += 3 + streak }
    else { streak = 0; score += 1; if (next === 0 || /[\s&/:_.-]/.test(t[next - 1])) score += 4 }
    ti = next + 1
  }
  return 100 + score - Math.max(0, ti - q.length) * 0.05
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const theme = useResolvedMode()
  const status = useSystemStore((s) => s.status)
  const healthReported = useHealthStore((s) => s.report)
  const apiLink = useApiLink()
  // the palette states the health only while the API answers
  const health = apiLink.live ? healthReported : null
  const connectionStatus = useConnectionStore((s) => s.status)
  const { isAuthenticated, logout, userRole } = useAuthStore()
  const isAdmin = userRole === 'admin'
  const currentPage = useSettingsStore((s) => s.currentPage)
  const setHealthReport = useHealthStore((s) => s.setReport)
  const stacks = useStackStore((s) => s.stacks)
  const containers = useContainerStore((s) => s.containers)
  const { addToast } = useToast()
  const isConnected = connectionStatus === 'connected'

  // Things worth finding that no store holds: templates, routes and Proxmox
  // guests. Fetched when the palette opens, kept for a minute.
  const [extra, setExtra] = useState<{ templates: TemplateInfo[]; routes: { subdomain: string; service: string; stack: string; target: string }[]; vms: ProxmoxVm[]; members: FleetMember[] }>({ templates: [], routes: [], vms: [], members: [] })
  const extraAtRef = useRef(0)
  useEffect(() => {
    if (!open || !isConnected || Date.now() - extraAtRef.current < 60000) return
    extraAtRef.current = Date.now()
    void Promise.allSettled([fetchTemplates(), fetchRoutes(), fetchProxmoxVms(), fetchFleetMembers()]).then(([t, r, v, f]) => {
      setExtra({
        templates: t.status === 'fulfilled' ? (t.value.templates ?? []) : [],
        routes: r.status === 'fulfilled' ? ((r.value as { routes?: { subdomain: string; service: string; stack: string; target: string }[] }).routes ?? []) : [],
        vms: v.status === 'fulfilled' ? (v.value.vms ?? []) : [],
        members: f.status === 'fulfilled' ? (f.value.members ?? []) : [],
      })
    })
  }, [open, isConnected])

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isAuthenticated || currentPage === 'setup') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, isAuthenticated, currentPage])

  // Ctrl+Shift+P alternative trigger via custom event from App.tsx
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-command-palette', handler)
    return () => window.removeEventListener('open-command-palette', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Build command list
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []

    // Navigation commands with rich keyword descriptions
    const pageDescriptions: Partial<Record<PageId, string>> = {
      dashboard: 'Overview, monitoring, live stats, home',
      stacks: 'Docker compose stacks, services, deploy',
      containers: 'Running containers, processes, instances',
      images: 'Docker images, layers, pull, registry',
      health: 'Container health, uptime and availability, the last 30 minutes',
      networks: 'Docker networks, bridge, overlay, DNS',
      volumes: 'Docker volumes, data persistence, mounts',
      logs: 'Log viewer, output, stdout, stderr, debug',
      system: 'System info, CPU, memory, disk, OS',
      config: 'Server configuration, API settings',
      settings: 'App settings, preferences, theme, profile',
      bookmarks: 'Saved bookmarks, favorites, pinned',
      activity: 'Event history, the live stream, the audit log',
      topology: 'Network topology, map, visualization',
      'file-browser': 'Browse files, directory, filesystem',
      templates: 'Compose templates, scaffolding, presets',
      dns: 'Traefik routes, Cloudflare DNS records, certificates',
      proxmox: 'VMs and containers on your Proxmox host: state, load, power',
      crowdsec: 'Intrusion prevention: bans, alerts, allowlist, countries, Discord alerts, ban length',
      updates: 'Image updates, available upgrades',
      trends: 'Resource trends, metrics, history, graphs',
      terminal: 'Terminal, shell, command line, exec',
      'disk-analysis': 'Disk usage, storage analysis, space',
      maintenance: 'Cleanup, dangling images, volumes, prune',
      environment: 'Environment variables, .env files, secrets',
      backup: 'Backups, config snapshots, recovery bundles, restore',
      notifications: 'Alerts, notifications, webhooks',
      automations: 'Timed and condition rules, schedules, the server crontab',
      diagnostics: 'Diagnostics, troubleshoot, debug, inspect',
      users: 'User management, accounts, permissions, two-step sign-in to your apps (Authelia)',
      export: 'Export data, download reports, backup configs',
    }
    const pageKeywords: Partial<Record<PageId, string[]>> = {
      dashboard: ['home', 'overview', 'monitor', 'live', 'stats', 'status'],
      stacks: ['compose', 'services', 'deploy', 'stack', 'docker-compose'],
      containers: ['container', 'process', 'instance', 'running', 'ps'],
      images: ['image', 'pull', 'registry', 'layer', 'tag', 'build'],
      health: ['health', 'check', 'healthy', 'unhealthy', 'diagnose', 'uptime', 'availability', 'incident', 'monitor'],
      networks: ['network', 'bridge', 'overlay', 'dns', 'subnet'],
      volumes: ['volume', 'mount', 'data', 'persist', 'storage'],
      logs: ['log', 'output', 'stdout', 'stderr', 'debug', 'tail', 'follow'],
      system: ['system', 'cpu', 'memory', 'ram', 'os', 'kernel', 'info'],
      config: ['config', 'configuration', 'api', 'server', 'port'],
      settings: ['settings', 'preferences', 'theme', 'profile', 'options', 'customize'],
      bookmarks: ['bookmark', 'favorite', 'pin', 'save'],
      activity: ['activity', 'event', 'audit', 'history', 'recent', 'live', 'stream', 'sse', 'real-time'],
      topology: ['topology', 'map', 'graph', 'visualize', 'network map'],
      'file-browser': ['file', 'browse', 'directory', 'folder', 'filesystem', 'explore'],
      templates: ['template', 'scaffold', 'preset', 'compose template'],
      dns: ['dns', 'routes', 'cloudflare', 'domain', 'traefik', 'subdomain', 'certificate'],
      technitium: ['technitium', 'dns', 'resolver', 'block', 'ads', 'kids', 'parental', 'bedtime', 'safesearch', 'dhcp'],
      proxmox: ['proxmox', 'pve', 'vm', 'virtual machine', 'lxc', 'hypervisor', 'node'],
      crowdsec: ['crowdsec', 'ban', 'unban', 'block', 'blocklist', 'allowlist', 'whitelist', 'attack', 'intrusion', 'fail2ban', 'bouncer', 'security', 'country', 'ip', 'brute force'],
      updates: ['update', 'upgrade', 'new version', 'outdated'],
      trends: ['trend', 'metric', 'chart', 'graph', 'history', 'cpu usage', 'memory usage'],
      terminal: ['terminal', 'shell', 'bash', 'exec', 'command', 'cli', 'ssh'],
      'disk-analysis': ['disk', 'storage', 'space', 'size', 'usage', 'df'],
      maintenance: ['maintenance', 'cleanup', 'dangling', 'prune', 'gc'],
      environment: ['env', 'environment', 'variable', 'secret', '.env'],
      backup: ['backup', 'restore', 'snapshot', 'recovery', 'archive', 'checkpoint', 'bundle'],
      notifications: ['notification', 'alert', 'webhook', 'notify', 'bell'],
      automations: ['automation', 'trigger', 'workflow', 'bot', 'rule', 'schedule', 'timer', 'cron', 'crontab', 'periodic', 'job'],
      diagnostics: ['diagnostic', 'troubleshoot', 'debug', 'inspect', 'doctor'],
      users: ['user', 'account', 'permission', 'role', 'invite', 'authelia', 'two-factor', '2fa', 'authenticator', 'passkey', 'totp', 'sign-in'],
      export: ['export', 'download', 'report', 'backup', 'json'],
    }

    // every page the sidebar reaches, in its order
    const allPages: PageId[] = navPages
    // Filter out admin-only pages for non-admin users
    const pages = allPages.filter((p) => (!ADMIN_ONLY_PAGES.has(p) || isAdmin) && (p !== 'technitium' || technitiumEnabledNow()))
    for (const page of pages) {
      const meta = pageMeta[page]
      items.push({
        id: `nav-${page}`,
        label: `Go to ${meta.label}`,
        // where it lives in the sidebar, so the new home of a page is learnt by using the palette
        description: [sectionOf(page)?.pages.length !== 1 ? sectionOf(page)?.label : undefined, pageDescriptions[page] ?? 'Navigate'].filter(Boolean).join(' · '),
        icon: <meta.icon size={16} />,
        type: 'page',
        // the names the page went by stay findable
        keywords: [...(pageKeywords[page] ?? [page, meta.label.toLowerCase()]), ...(meta.aliases ?? []).map((a) => a.toLowerCase())],
        onSelect: () => {
          setCurrentPage(page)
          setOpen(false)
        },
      })
    }

    // Quick info commands
    if (status) {
      items.push({
        id: 'info-containers',
        label: `${status.docker.containers.running} / ${status.docker.containers.total} Containers Running`,
        description: (status.docker.containers.sleeping ?? 0) > 0
          ? `${status.docker.containers.sleeping} asleep on demand · ${Math.max(0, status.docker.containers.stopped - (status.docker.containers.sleeping ?? 0))} stopped`
          : `${status.docker.containers.stopped} stopped`,
        icon: <Box size={16} className="text-cyan-400" />,
        type: 'action',
        keywords: ['container', 'running', 'status'],
        onSelect: () => {
          setCurrentPage('containers')
          setOpen(false)
        },
      })
      items.push({
        id: 'info-stacks',
        label: `${status.stacks.running} / ${status.stacks.total} Stacks Running`,
        description: 'Stack overview',
        icon: <Layers size={16} className="text-emerald-400" />,
        type: 'action',
        keywords: ['stack', 'running'],
        onSelect: () => {
          setCurrentPage('stacks')
          setOpen(false)
        },
      })
    }

    if (health) {
      items.push({
        id: 'info-health',
        label: `System Health: ${health.status.charAt(0).toUpperCase() + health.status.slice(1)}`,
        description: `${health.summary.healthy}/${health.summary.total} healthy`,
        icon: <HeartPulse size={16} className={
          health.status === 'healthy' ? 'text-emerald-400'
            : health.status === 'degraded' ? 'text-amber-400'
              : 'text-rose-400'
        } />,
        type: 'action',
        keywords: ['health', 'healthy', 'status'],
        onSelect: () => {
          setCurrentPage('health')
          setOpen(false)
        },
      })
    }

    // Action commands
    items.push({
      id: 'action-theme',
      label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      description: 'Toggle theme',
      icon: theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-violet-400" />,
      type: 'action',
      keywords: ['theme', 'dark', 'light', 'mode', 'toggle'],
      onSelect: () => {
        toggleMode()
        setOpen(false)
      },
    })

    items.push({
      id: 'action-sidebar',
      label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
      description: 'Toggle sidebar visibility',
      icon: sidebarCollapsed
        ? <PanelLeft size={16} className="text-cyan-400" />
        : <PanelLeftClose size={16} className="text-cyan-400" />,
      type: 'action',
      keywords: ['sidebar', 'toggle', 'collapse', 'expand', 'panel'],
      onSelect: () => {
        toggleSidebar()
        setOpen(false)
      },
    })

    items.push({
      id: 'action-refresh',
      label: 'Refresh all data',
      description: 'Re-fetch all data from server (Ctrl+R)',
      icon: <RefreshCw size={16} className="text-emerald-400" />,
      type: 'action',
      keywords: ['refresh', 'reload', 'fetch', 'update', 'data'],
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('app-refresh'))
        setOpen(false)
      },
    })

    items.push({
      id: 'action-profile',
      label: 'Edit profile',
      description: 'Update your display name, avatar, and email',
      icon: <UserCircle size={16} className="text-emerald-400" />,
      type: 'action',
      keywords: ['profile', 'avatar', 'name', 'email', 'account'],
      onSelect: () => {
        setCurrentPage('settings')
        setOpen(false)
      },
    })

    items.push({
      id: 'action-security',
      label: 'Security and password',
      description: 'Change password, view security settings',
      icon: <Shield size={16} className="text-rose-400" />,
      type: 'action',
      keywords: ['security', 'password', 'change', 'account', 'auth'],
      onSelect: () => {
        setCurrentPage('settings')
        setOpen(false)
      },
    })

    items.push({
      id: 'action-export',
      label: 'Export settings',
      description: 'Download settings as JSON backup',
      icon: <Download size={16} className="text-cyan-400" />,
      type: 'action',
      keywords: ['export', 'backup', 'settings', 'download', 'json'],
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('export-settings'))
        setOpen(false)
      },
    })

    items.push({
      id: 'action-logout',
      label: 'Sign out',
      description: 'Log out of your account',
      icon: <LogOut size={16} className="text-rose-400" />,
      type: 'action',
      keywords: ['logout', 'sign out', 'exit', 'quit'],
      onSelect: () => {
        logout()
        setOpen(false)
      },
    })

    // --- Admin-only server actions (require connection + admin) ---
    if (isConnected && isAdmin) {
      items.push({
        id: 'action-prune',
        label: 'Prune Docker images',
        description: 'Remove dangling and unused images',
        icon: <Trash2 size={16} className="text-orange-400" />,
        type: 'action',
        keywords: ['prune', 'clean', 'docker', 'images', 'dangling', 'unused'],
        onSelect: async () => {
          setOpen(false)
          try {
            const r = await runImagePrune()
            addToast({ type: r.success ? 'success' : 'error', message: r.success ? 'Stale images pruned' : 'Image prune failed' })
          } catch { addToast({ type: 'error', message: 'Image prune failed' }) }
        },
      })

      items.push({
        id: 'action-rotate-logs',
        label: 'Rotate the server logs',
        description: 'Archive and rotate the server log file',
        icon: <Archive size={16} className="text-pink-400" />,
        type: 'action',
        keywords: ['rotate', 'logs', 'archive', 'clean', 'log'],
        onSelect: async () => {
          setOpen(false)
          try {
            const r = await triggerLogRotate()
            addToast({
              type: r.success ? 'success' : 'error',
              message: r.success
                ? `Logs rotated${r.archived_as ? ` — archived as ${r.archived_as}` : ''}`
                : 'Log rotation failed',
            })
          } catch { addToast({ type: 'error', message: 'Log rotation failed' }) }
        },
      })

      items.push({
        id: 'action-backup',
        label: 'Back up now',
        description: 'Trigger a full server backup',
        icon: <Download size={16} className="text-cyan-400" />,
        type: 'action',
        keywords: ['backup', 'snapshot', 'save', 'export', 'archive'],
        onSelect: async () => {
          setOpen(false)
          try {
            const r = await triggerBackup()
            addToast({
              type: r.success ? 'success' : 'error',
              message: r.success ? `Backup started: ${r.filename}` : 'Backup failed',
            })
          } catch { addToast({ type: 'error', message: 'Backup trigger failed' }) }
        },
      })

      items.push({
        id: 'lint-all',
        label: 'Lint every compose file',
        description: 'Validate all compose files for errors and warnings',
        icon: <ListChecks size={16} className="text-cyan-400" />,
        type: 'action',
        keywords: ['validate', 'lint', 'compose', 'check', 'errors', 'warnings'],
        onSelect: () => {
          setCurrentPage('stacks')
          setOpen(false)
        },
      })

      items.push({
        id: 'check-updates',
        label: 'Check for updates',
        description: 'Check for available image and system updates',
        icon: <ArrowUpCircle size={16} className="text-emerald-400" />,
        type: 'action',
        keywords: ['update', 'upgrade', 'version', 'latest'],
        onSelect: () => {
          setCurrentPage('updates')
          setOpen(false)
        },
      })

      items.push({
        id: 'view-plugins',
        label: 'Manage plugins',
        description: 'Install, configure, and scaffold plugins',
        icon: <Puzzle size={16} className="text-violet-400" />,
        type: 'action',
        keywords: ['plugin', 'extension', 'hooks', 'install', 'scaffold'],
        onSelect: () => {
          setCurrentPage('plugins')
          setOpen(false)
        },
      })

      items.push({
        id: 'view-audit',
        label: 'Open the audit log',
        description: 'Review security audit trail and change history',
        icon: <ScrollText size={16} className="text-amber-400" />,
        type: 'action',
        keywords: ['audit', 'log', 'history', 'security', 'changes'],
        onSelect: () => {
          setCurrentPage('activity', { tab: 'audit' })
          setOpen(false)
        },
      })
    }

    // --- Server actions available to all authenticated users ---
    if (isConnected) {
      items.push({
        id: 'action-check-health',
        label: 'Run a health check',
        description: 'Fetch a fresh health report from the server',
        icon: <HeartPulse size={16} className="text-emerald-400" />,
        type: 'action',
        keywords: ['health', 'check', 'diagnose', 'status', 'monitor'],
        onSelect: async () => {
          setOpen(false)
          try {
            const report = await fetchHealthReport()
            setHealthReport(report)
            addToast({
              type: report.status === 'healthy' ? 'success' : report.status === 'degraded' ? 'warning' : 'error',
              message: `Health: ${report.status} — ${report.summary.healthy}/${report.summary.total} healthy`,
            })
          } catch { addToast({ type: 'error', message: 'Health check failed' }) }
        },
      })

      // Open a stack or a container straight from the search
      for (const stack of stacks) {
        items.push({
          id: `open-stack-${stack.name}`,
          label: stack.name,
          description: `Stack · ${stackLine(stack)}`,
          icon: <Layers size={16} className="text-cyan-400" />,
          type: 'stack',
          keywords: ['stack', 'open', stack.name.toLowerCase()],
          onSelect: () => { setCurrentPage('stacks', { highlight: stack.name }); setOpen(false) },
        })
      }
      for (const container of containers) {
        items.push({
          id: `open-container-${container.member ?? 'local'}-${container.name}`,
          label: container.name,
          description: `Container · ${isAsleep(container) ? `${STATE_META[containerState(container)].label} (on demand)` : container.state}${container.stack ? ` · ${container.stack}` : ''} · ${container.image}`,
          icon: <Box size={16} className={container.state === 'running' ? 'text-emerald-400' : 'text-slate-400'} />,
          type: 'container',
          keywords: ['container', 'open', container.name.toLowerCase(), (container.image || '').toLowerCase(), (container.stack || '').toLowerCase()],
          onSelect: () => { setCurrentPage('containers', { focusContainer: container.name }); setOpen(false) },
        })
      }
      for (const t of extra.templates) {
        items.push({
          id: `template-${t.name}`,
          label: t.title || t.name,
          description: `Template · ${t.category}${t.description ? ` · ${t.description}` : ''}`,
          icon: <LayoutTemplate size={16} className="text-violet-400" />,
          type: 'template',
          keywords: ['template', 'deploy', t.name.toLowerCase(), t.category.toLowerCase(), ...(t.tags || []).map((k) => k.toLowerCase())],
          onSelect: () => { setCurrentPage('templates', { search: t.name }); setOpen(false) },
        })
      }
      for (const r of extra.routes) {
        items.push({
          id: `route-${r.subdomain}`,
          label: r.subdomain,
          description: `Route · ${r.stack}/${r.service} → ${r.target}`,
          icon: <Globe size={16} className="text-sky-400" />,
          type: 'route',
          keywords: ['route', 'url', 'open', r.subdomain.toLowerCase(), r.service.toLowerCase(), r.stack.toLowerCase()],
          onSelect: () => { window.open(`https://${r.subdomain}`, '_blank', 'noopener'); setOpen(false) },
        })
      }
      for (const v of extra.vms) {
        items.push({
          id: `vm-${v.node}-${v.type}-${v.vmid}`,
          label: v.name,
          description: `${v.type === 'lxc' ? 'LXC container' : 'VM'} ${v.vmid} · ${v.status} · ${v.node}${v.tags?.length ? ` · ${v.tags.join(', ')}` : ''}`,
          icon: <Server size={16} className={v.status === 'running' ? 'text-emerald-400' : 'text-slate-400'} />,
          type: 'vm',
          keywords: ['vm', 'proxmox', 'lxc', String(v.vmid), v.name.toLowerCase(), v.node.toLowerCase(), ...(v.tags || []).map((k) => k.toLowerCase())],
          onSelect: () => { setCurrentPage('proxmox', { search: v.name }); setOpen(false) },
        })
      }
      for (const m of extra.members) {
        items.push({
          id: `member-${m.id}`,
          label: m.name,
          description: `Fleet member · ${m.url}${m.vmid ? ` · VM ${m.vmid}` : ''}${m.version ? ` · DCS ${m.version}` : ''}${m.reachable === false ? ' · not answering' : ''}`,
          icon: <Server size={16} className={m.reachable === false ? 'text-rose-400' : 'text-amber-400'} />,
          type: 'vm',
          keywords: ['member', 'fleet', 'hub', 'dcs', m.name.toLowerCase(), m.url.toLowerCase(), String(m.vmid ?? '')],
          onSelect: () => { setCurrentPage('proxmox', { search: m.name }); setOpen(false) },
        })
      }
      const docs: [string, string, string, string[]][] = [
        ['README', 'Install, quick start, every feature', 'https://github.com/scotthowson/dcs-orchestrator#readme', ['readme', 'help', 'guide', 'install']],
        ['Proxmox guide', 'API token, the Proxmox page, the fleet (hub + members), a Traefik in another VM', 'https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/PROXMOX.md', ['proxmox', 'guide', 'hub', 'feed', 'traefik']],
        ['Discord & webhooks', 'Webhooks, notification rules, CrowdSec alerts, the bot', 'https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/DISCORD.md', ['discord', 'webhook', 'bot', 'notifications']],
        ['API reference', 'Every endpoint with its access level', 'https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/API.md', ['api', 'endpoints', 'reference', 'curl']],
      ]
      for (const [title, desc, url, kw] of docs) {
        items.push({
          id: `docs-${title}`,
          label: `Docs: ${title}`,
          description: desc,
          icon: <BookOpen size={16} className="text-amber-400" />,
          type: 'docs',
          keywords: ['docs', 'documentation', 'help', ...kw],
          onSelect: () => { window.open(url, '_blank', 'noopener'); setOpen(false) },
        })
      }

      // The log viewer of every stack (its controls are admin-only: the block below)
      for (const stack of stacks) {
        items.push({
          id: `stack-logs-${stack.name}`,
          label: `View Logs: ${stack.name}`,
          description: `Open log viewer for ${stack.name}`,
          icon: <ScrollText size={16} className="text-cyan-400" />,
          type: 'stack',
          keywords: ['logs', 'log', 'view', 'stack', stack.name.toLowerCase(), 'output', 'tail'],
          onSelect: () => {
            setCurrentPage('logs')
            setOpen(false)
          },
        })
      }

      // The log viewer of every container (its controls are admin-only: the block below)
      for (const container of containers) {
        items.push({
          id: `container-logs-${container.member ?? 'local'}-${container.name}`,
          label: `View Logs: ${container.name}`,
          description: `Open log viewer for ${container.name}`,
          icon: <ScrollText size={16} className="text-cyan-400" />,
          type: 'container',
          keywords: ['logs', 'log', 'view', 'container', container.name.toLowerCase(), 'output', 'tail'],
          onSelect: () => {
            setCurrentPage('logs')
            setOpen(false)
          },
        })
      }
    }

    // --- Stack and container controls (admin: the API answers 403 to a user). After the list above so
    //     the palette keeps its order on an empty query ---
    if (isConnected && isAdmin) {
      for (const stack of stacks) {
        if (stack.status === 'running') {
          items.push({
            id: `stack-stop-${stack.name}`,
            label: `Stop Stack: ${stack.name}`,
            description: `${stack.running_containers} container${stack.running_containers !== 1 ? 's' : ''} running`,
            icon: <Square size={16} className="text-rose-400" />,
            type: 'stack',
            keywords: ['stop', 'stack', stack.name.toLowerCase(), 'down', 'halt'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await stopStack(stack.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Stopped ${stack.name}` : `Failed to stop ${stack.name}` })
              } catch { addToast({ type: 'error', message: `Failed to stop ${stack.name}` }) }
            },
          })
          items.push({
            id: `stack-restart-${stack.name}`,
            label: `Restart Stack: ${stack.name}`,
            description: `${stack.running_containers} container${stack.running_containers !== 1 ? 's' : ''} running`,
            icon: <RotateCw size={16} className="text-amber-400" />,
            type: 'stack',
            keywords: ['restart', 'stack', stack.name.toLowerCase(), 'reload', 'reboot'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await restartStack(stack.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Restarted ${stack.name}` : `Failed to restart ${stack.name}` })
              } catch { addToast({ type: 'error', message: `Failed to restart ${stack.name}` }) }
            },
          })
        } else {
          items.push({
            id: `stack-start-${stack.name}`,
            label: `Start Stack: ${stack.name}`,
            description: stack.sleeping ? 'Asleep on demand: starting wakes it now' : 'Currently stopped',
            icon: <Play size={16} className="text-emerald-400" />,
            type: 'stack',
            keywords: ['start', 'stack', stack.name.toLowerCase(), 'up', 'launch'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await startStack(stack.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Started ${stack.name}` : `Failed to start ${stack.name}` })
              } catch { addToast({ type: 'error', message: `Failed to start ${stack.name}` }) }
            },
          })
        }
      }
      for (const container of containers) {
        const isRunning = container.state === 'running'

        if (isRunning) {
          items.push({
            id: `container-stop-${container.member ?? 'local'}-${container.name}`,
            label: `Stop Container: ${container.name}`,
            description: `Image: ${container.image}`,
            icon: <Square size={16} className="text-rose-400" />,
            type: 'container',
            keywords: ['stop', 'container', container.name.toLowerCase(), 'down', 'halt'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await stopContainer(container.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Stopped ${container.name}` : `Failed to stop ${container.name}` })
              } catch { addToast({ type: 'error', message: `Failed to stop ${container.name}` }) }
            },
          })
          items.push({
            id: `container-restart-${container.member ?? 'local'}-${container.name}`,
            label: `Restart Container: ${container.name}`,
            description: `Image: ${container.image}`,
            icon: <RotateCw size={16} className="text-amber-400" />,
            type: 'container',
            keywords: ['restart', 'container', container.name.toLowerCase(), 'reload', 'reboot'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await restartContainer(container.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Restarted ${container.name}` : `Failed to restart ${container.name}` })
              } catch { addToast({ type: 'error', message: `Failed to restart ${container.name}` }) }
            },
          })
        } else {
          items.push({
            id: `container-start-${container.name}`,
            label: `Start Container: ${container.name}`,
            description: `Currently ${container.state}`,
            icon: <Play size={16} className="text-emerald-400" />,
            type: 'container',
            keywords: ['start', 'container', container.name.toLowerCase(), 'up', 'launch'],
            onSelect: async () => {
              setOpen(false)
              try {
                const r = await startContainer(container.name)
                addToast({ type: r.success ? 'success' : 'error', message: r.success ? `Started ${container.name}` : `Failed to start ${container.name}` })
              } catch { addToast({ type: 'error', message: `Failed to start ${container.name}` }) }
            },
          })
        }
      }
    }

    return items
  }, [setCurrentPage, status, health, isConnected, isAdmin, theme, sidebarCollapsed, toggleSidebar, updateSetting, logout, addToast, setHealthReport, stacks, containers, extra])

  // Filter commands: fuzzy. Every word of the query must match the label, the
  // description or a keyword; exact and prefix matches on the label rank
  // first, then in-order character matches ("jfin" finds Jellyfin), tighter
  // ones first. Equal scores keep their definition order.
  const filtered = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return commands
    const ranked = commands.map((cmd, order) => {
      const label = cmd.label.toLowerCase()
      const desc = cmd.description.toLowerCase()
      const kw = (cmd.keywords ?? []).join(' ').toLowerCase()
      let total = 0
      for (const w of words) {
        const sc = Math.max(fuzzyScore(w, label), fuzzyScore(w, kw) * 0.7, fuzzyScore(w, desc) * 0.5)
        if (sc <= 0) { total = 0; break }
        total += sc
      }
      return { cmd, score: total, order }
    }).filter((r) => r.score > 0)
    ranked.sort((a, b) => b.score - a.score || a.order - b.order)
    return ranked.slice(0, 60).map((r) => r.cmd)
  }, [commands, query])

  // Reset selection on filter change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault()
        filtered[selectedIndex].onSelect()
      }
    },
    [filtered, selectedIndex],
  )

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  return (
    <ModalOverlay onClose={() => setOpen(false)} label="Search" className="fixed inset-0 z-[9998] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div
        className="
          relative w-full max-w-lg
          bg-slate-900/95 backdrop-blur-2xl
          border border-white/10
          rounded-2xl shadow-2xl shadow-black/40
          overflow-hidden
          animate-scale-in
        "
        onKeyDown={handleKeyDown}
      >
        {/* Search bar */}
        <div className="flex items-center gap-3 px-4 border-b border-white/5">
          <Search size={18} className="text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything: pages, containers, stacks, templates, routes, VMs, docs…"
            className="
              flex-1 bg-transparent py-4
              text-sm text-slate-100 placeholder-slate-500
              focus:outline-none
            "
          />
          <Kbd className="shrink-0">
            ESC
          </Kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2 scrollbar-thin">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {filtered.map((cmd, idx) => {
            const isSelected = idx === selectedIndex
            const prevType = idx > 0 ? filtered[idx - 1].type : null
            const showGroupHeader = query.trim() === '' && cmd.type !== prevType
            const groupLabel = cmd.type === 'page' ? 'Pages'
              : cmd.type === 'stack' ? 'Stacks'
              : cmd.type === 'container' ? 'Containers'
              : cmd.type === 'template' ? 'Templates'
              : cmd.type === 'route' ? 'Routes'
              : cmd.type === 'vm' ? 'Proxmox'
              : cmd.type === 'docs' ? 'Documentation'
              : 'Quick Actions'
            return (
              <React.Fragment key={cmd.id}>
                {showGroupHeader && (
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{groupLabel}</span>
                  </div>
                )}
                <button
                  onClick={cmd.onSelect}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`
                    flex items-center gap-3 w-full px-4 py-2.5 text-left
                    transition-colors duration-100
                    ${isSelected
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'text-slate-300 hover:bg-white/5'
                    }
                  `}
                >
                  <div className={`
                    shrink-0 rounded-lg p-1.5
                    ${isSelected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/[0.05] text-slate-400'}
                  `}>
                    {cmd.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cmd.label}</p>
                    <p className="text-[11px] text-slate-500 truncate">{cmd.description}</p>
                  </div>
                  {cmd.type === 'stack' && (
                    <span className="shrink-0 rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">Stack</span>
                  )}
                  {cmd.type === 'container' && (
                    <span className="shrink-0 rounded-md border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">Container</span>
                  )}
                  {isSelected && (
                    <ArrowRight size={14} className="shrink-0 text-emerald-400/60" />
                  )}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {/* Result count */}
        <div className="px-4 py-1.5 text-[10px] text-slate-500 border-t border-white/[0.03]">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-white/5 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>&uarr;</Kbd>
              <Kbd>&darr;</Kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>&crarr;</Kbd>
              Select
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Command size={10} />
            <span>K to toggle</span>
          </span>
        </div>
      </div>
    </ModalOverlay>
  )
}
