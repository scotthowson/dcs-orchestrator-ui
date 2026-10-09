// =============================================================================
// Notifications — ntfy and Discord: rules, history, test, status, webhooks
// =============================================================================

import { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Switch } from '@mantine/core'
import { Bell, Plus, Trash2, Send, CheckCircle, XCircle, Loader2, AlertTriangle, BookOpen, Clock, Shield, Cpu, HardDrive, Box, Layers, Package, Webhook, ExternalLink, Zap, ChevronDown, Play, Power, HeartPulse, Archive, Rocket, RefreshCw, MessageCircle } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD_QUIET, BTN_ICON, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_OK, TONE_GHOST_DANGER, FOCUS_RING } from '../lib/ui'
import { INPUT, CAPTION as LABEL } from '../lib/fieldStyles'
import {
  fetchNotificationRules,
  createNotificationRule,
  deleteNotificationRule,
  fetchNotificationHistory,
  sendTestNotification,
  fetchConfig,
  fetchWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
} from '../api/endpoints'
import type { NotificationRule, NotificationHistoryEntry, Webhook as WebhookType } from '../../shared/types'
import { LoadingState, EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'

import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

type TriggerType =
  | 'container_unhealthy'
  | 'container_stopped'
  | 'container_high_cpu'
  | 'container_high_memory'
  | 'disk_warning'
  | 'stack_down'
  | 'image_stale'
  | 'deploy_complete'
  | 'update_available'
  | 'stack_failed'
  | 'health_change'
  | 'backup_complete'
  | 'backup_failed'
  | 'automation_run'
  | 'proxmox_vm_stopped'
  | 'proxmox_vm_started'
  | 'fleet_member_joined'
  | 'fleet_member_down'
  | 'fleet_member_up'
  | 'fleet_vm_ready'
  | 'fleet_vm_failed'
  | 'docker_engine_update'

type Priority = 'urgent' | 'high' | 'default' | 'low'

const TRIGGER_OPTIONS: { value: TriggerType; label: string }[] = [
  { value: 'container_unhealthy', label: 'Container unhealthy' },
  { value: 'container_stopped', label: 'Container stopped' },
  { value: 'container_high_cpu', label: 'High CPU' },
  { value: 'container_high_memory', label: 'High memory' },
  { value: 'disk_warning', label: 'Disk warning' },
  { value: 'stack_down', label: 'Stack down' },
  { value: 'image_stale', label: 'Image stale' },
  { value: 'deploy_complete', label: 'Deploy complete' },
  { value: 'update_available', label: 'Update available' },
  { value: 'stack_failed', label: 'Stack failed' },
  { value: 'health_change', label: 'Health changed' },
  { value: 'backup_complete', label: 'Backup finished' },
  { value: 'backup_failed', label: 'Backup failed' },
  { value: 'automation_run', label: 'Automation ran' },
  { value: 'proxmox_vm_stopped', label: 'VM stopped on its own' },
  { value: 'proxmox_vm_started', label: 'VM started' },
  { value: 'fleet_member_joined', label: 'Fleet member joined' },
  { value: 'fleet_member_down', label: 'Fleet member stopped answering' },
  { value: 'fleet_member_up', label: 'Fleet member back' },
  { value: 'fleet_vm_ready', label: 'VM built and joined' },
  { value: 'fleet_vm_failed', label: 'VM build failed' },
  { value: 'docker_engine_update', label: 'Docker Engine updated' },
]

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'default', label: 'Default' },
  { value: 'low', label: 'Low' },
]

/** Available template variables for notification messages */
const TEMPLATE_VARIABLES = [
  { var: '{stack}', desc: 'Stack name (e.g. media-services)' },
  { var: '{container}', desc: 'Container name (e.g. Plex)' },
  { var: '{status}', desc: 'Current status (e.g. unhealthy, stopped)' },
  { var: '{event}', desc: 'Event type (e.g. container_unhealthy)' },
  { var: '{timestamp}', desc: 'Current date/time' },
  { var: '{hostname}', desc: 'Server hostname' },
  { var: '{template}', desc: 'Template name (deploys)' },
  { var: '{action}', desc: 'What was attempted (stack failures)' },
  { var: '{mount}', desc: 'Mount point (disk warnings)' },
  { var: '{message}', desc: 'Details (updates, backups, health, automations)' },
]

/** Premade notification rule templates */
interface PresetTemplate {
  name: string
  description: string
  trigger: TriggerType
  priority: Priority
  tags: string[]
  title_template: string
  message_template: string
  icon: React.ElementType
  iconBg: string
  iconText: string
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    name: 'Container health alert',
    description: 'Alert when any container becomes unhealthy',
    trigger: 'container_unhealthy',
    priority: 'urgent',
    tags: ['warning', 'docker', 'health'],
    title_template: '⚠️ {container} is Unhealthy',
    message_template: 'Container {container} in {stack} has become unhealthy. Check logs and restart if needed.',
    icon: HeartPulse,
    iconBg: 'bg-rose-500/10 border-rose-500/15',
    iconText: 'text-rose-400',
  },
  {
    name: 'Stack down alert',
    description: 'Notify when a stack is stopped or goes down',
    trigger: 'stack_down',
    priority: 'high',
    tags: ['warning', 'stack', 'down'],
    title_template: '🔴 Stack Down — {stack}',
    message_template: 'Stack {stack} has been stopped on {hostname} at {timestamp}.',
    icon: Power,
    iconBg: 'bg-amber-500/10 border-amber-500/15',
    iconText: 'text-amber-400',
  },
  {
    name: 'Container stopped',
    description: 'Alert when a container stops unexpectedly',
    trigger: 'container_stopped',
    priority: 'high',
    tags: ['container', 'stopped'],
    title_template: '⏹️ {container} Stopped',
    message_template: '{container} in {stack} has stopped. Status: {status}.',
    icon: Box,
    iconBg: 'bg-amber-500/10 border-amber-500/15',
    iconText: 'text-amber-400',
  },
  {
    name: 'Disk space warning',
    description: 'Alert when disk usage exceeds threshold',
    trigger: 'disk_warning',
    priority: 'urgent',
    tags: ['disk', 'storage', 'warning'],
    title_template: '💾 Disk Space Critical',
    message_template: 'Disk usage on {hostname} is critically high. Free up space immediately.',
    icon: HardDrive,
    iconBg: 'bg-rose-500/10 border-rose-500/15',
    iconText: 'text-rose-400',
  },
  {
    name: 'Image update available',
    description: 'Notify when container images have updates',
    trigger: 'image_stale',
    priority: 'low',
    tags: ['update', 'image'],
    title_template: '📦 Image Updates Available',
    message_template: `Container images have upstream updates available. Check the ${pageLabel('updates')} page.`,
    icon: Package,
    iconBg: 'bg-cyan-500/10 border-cyan-500/15',
    iconText: 'text-cyan-400',
  },
  {
    name: 'Deploy complete',
    description: 'Confirm when a template deployment finishes',
    trigger: 'deploy_complete',
    priority: 'default',
    tags: ['deploy', 'success'],
    title_template: '✅ {template} deployed',
    message_template: '{template} is up in {stack} on {hostname}.',
    icon: Play,
    iconBg: 'bg-emerald-500/10 border-emerald-500/15',
    iconText: 'text-emerald-400',
  },
  {
    name: 'Health changed',
    description: 'One message each time the server goes healthy, degraded or critical',
    trigger: 'health_change',
    priority: 'high',
    tags: ['health'],
    title_template: '💓 {hostname} is {status}',
    message_template: '{message}',
    icon: HeartPulse,
    iconBg: 'bg-rose-500/10 border-rose-500/15',
    iconText: 'text-rose-400',
  },
  {
    name: 'Backup finished',
    description: 'Know when a backup lands, with its name and size',
    trigger: 'backup_complete',
    priority: 'low',
    tags: ['backup'],
    title_template: '💾 Backup finished',
    message_template: '{message}',
    icon: Archive,
    iconBg: 'bg-cyan-500/10 border-cyan-500/15',
    iconText: 'text-cyan-400',
  },
  {
    name: 'Stack failed',
    description: 'A start, restart or deploy left a stack broken',
    trigger: 'stack_failed',
    priority: 'urgent',
    tags: ['stack', 'failed'],
    title_template: '💥 {stack} failed to {action}',
    message_template: `Stack {stack} on {hostname} did not come up cleanly ({action}). Open its activity log on the ${pageLabel('stacks')} page.`,
    icon: Zap,
    iconBg: 'bg-rose-500/10 border-rose-500/15',
    iconText: 'text-rose-400',
  },
]

function triggerIcon(trigger: string) {
  switch (trigger) {
    case 'container_unhealthy': return <Shield size={11} />
    case 'container_stopped': return <XCircle size={11} />
    case 'container_high_cpu': return <Cpu size={11} />
    case 'container_high_memory': return <HardDrive size={11} />
    case 'disk_warning': return <HardDrive size={11} />
    case 'stack_down': return <Layers size={11} />
    case 'image_stale': return <Package size={11} />
    default: return <Bell size={11} />
  }
}

function triggerColor(trigger: string): string {
  switch (trigger) {
    case 'container_unhealthy': return 'bg-rose-500/15 text-rose-400 border-rose-500/20'
    case 'container_stopped': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    case 'container_high_cpu': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    case 'container_high_memory': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    case 'disk_warning': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    case 'stack_down': return 'bg-rose-500/15 text-rose-400 border-rose-500/20'
    case 'image_stale': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/20'
  }
}

function triggerLabel(trigger: string): string {
  return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'urgent': return 'bg-rose-500/15 text-rose-400 border-rose-500/20'
    case 'high': return 'bg-amber-500/15 text-amber-400 border-amber-500/20'
    case 'default': return 'bg-slate-500/15 text-slate-400 border-slate-500/20'
    case 'low': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/20'
  }
}

function historyPriorityAccent(priority: string): string {
  switch (priority) {
    case 'urgent': return 'border-l-rose-500'
    case 'high': return 'border-l-amber-500'
    case 'default': return 'border-l-slate-500'
    case 'low': return 'border-l-cyan-500'
    default: return 'border-l-slate-500'
  }
}

function statusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-emerald-400'
  if (code >= 400) return 'text-rose-400'
  return 'text-amber-400'
}

/** a link inside a sentence */
const LINK_BTN = `h-auto text-cyan-400 hover:underline rounded ${FOCUS_RING}`
/** the button that folds a section open and shut: it is the section's heading */
const SECTION_TOGGLE = `flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-400 rounded transition-colors ${FOCUS_RING}`
/** All · Essentials · None beside a list of choices */
const MINI_LINK = `px-2 min-w-[2rem] h-8 sm:h-6 rounded hover:underline ${FOCUS_RING}`

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ts
  }
}

// ---------------------------------------------------------------------------
// Notifications Page
// ---------------------------------------------------------------------------

export default function Notifications() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()

  // UI state
  const [showAddModal, setShowAddModal] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [sendingTest, setSendingTest] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Webhook state
  const [webhooksExpanded, setWebhooksExpanded] = useState(true)
  const [showAddWebhook, setShowAddWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState<Set<string>>(new Set(WEBHOOK_DEFAULT_EVENTS))
  const [creatingWebhook, setCreatingWebhook] = useState(false)
  const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null)
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null)

  // Add-rule form state
  const [newName, setNewName] = useState('')
  const [newTrigger, setNewTrigger] = useState<TriggerType>('container_unhealthy')
  const [newTarget, setNewTarget] = useState('*')
  const [newPriority, setNewPriority] = useState<Priority>('default')
  const [newTags, setNewTags] = useState('')
  const [newCooldown, setNewCooldown] = useState('')
  const [newTitleTemplate, setNewTitleTemplate] = useState('')
  const [newMessageTemplate, setNewMessageTemplate] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  // Polling
  const { data: rulesData, loading: rulesLoading, refresh: refreshRules } = usePolling(
    fetchNotificationRules, 10000, { enabled: isConnected },
  )
  const { data: historyData, loading: historyLoading, refresh: refreshHistory } = usePolling(
    fetchNotificationHistory, 30000, { enabled: isConnected },
  )
  const { data: configData } = usePolling(
    fetchConfig, 30000, { enabled: isConnected },
  )

  // Webhook polling
  const { data: webhooksData, refresh: refreshWebhooks } = usePolling(
    fetchWebhooks, 15000, { enabled: isConnected },
  )

  const rules: NotificationRule[] = useMemo(() => rulesData?.rules ?? [], [rulesData])
  const history: NotificationHistoryEntry[] = useMemo(() => historyData?.history ?? [], [historyData])
  const webhooks: WebhookType[] = useMemo(() => webhooksData?.webhooks ?? [], [webhooksData])
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const ntfyConfigured = configData?.ntfy_configured ?? false
  const discordConfigured = configData?.discord_configured ?? false
  const discordHint = configData?.discord_webhook_hint ?? ''
  const ntfyUrl = configData?.ntfy_url ?? ''

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSendTest = useCallback(async () => {
    setSendingTest(true)
    try {
      const res = await sendTestNotification({ title: 'DCS Test', message: 'Test notification from DCS Orchestrator', priority: 'default' })
      if (res.success) {
        addToast({ type: 'success', message: 'Test notification sent successfully' })
      } else {
        addToast({ type: 'error', message: res.message || 'Failed to send test notification' })
      }
      refreshHistory()
    } catch (err) {
      // the server says why (no channel, a webhook that answered 4xx, a 403): show its words
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send test notification' })
    } finally {
      setSendingTest(false)
    }
  }, [addToast, refreshHistory])

  const handleToggleRule = useCallback(async (rule: NotificationRule) => {
    setTogglingId(rule.id)
    try {
      await createNotificationRule({ ...rule, enabled: !rule.enabled })
      addToast({ type: 'success', message: `Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}` })
      refreshRules()
    } catch {
      addToast({ type: 'error', message: 'Failed to toggle rule' })
    } finally {
      setTogglingId(null)
    }
  }, [addToast, refreshRules])

  const handleDeleteRule = useCallback(async (rule: NotificationRule) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `"${rule.name}" stops sending notifications. This cannot be undone.`,
      confirmLabel: 'Delete rule',
      danger: true,
    })
    if (!ok) return
    setDeletingId(rule.id)
    try {
      await deleteNotificationRule(rule.id)
      addToast({ type: 'success', message: 'Notification rule deleted' })
      refreshRules()
    } catch {
      addToast({ type: 'error', message: 'Failed to delete rule' })
    } finally {
      setDeletingId(null)
    }
  }, [addToast, confirm, refreshRules])

  const resetForm = useCallback(() => {
    setNewName('')
    setNewTrigger('container_unhealthy')
    setNewTarget('*')
    setNewPriority('default')
    setNewTags('')
    setNewCooldown('')
    setNewTitleTemplate('')
    setNewMessageTemplate('')
  }, [])

  const handleCreateRule = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean)
      await createNotificationRule({
        name: newName.trim(),
        trigger: newTrigger,
        target: newTarget.trim() || '*',
        priority: newPriority,
        tags,
        enabled: true,
        title_template: newTitleTemplate.trim(),
        message_template: newMessageTemplate.trim(),
        ...(newCooldown.trim() !== '' && /^\d{1,6}$/.test(newCooldown.trim()) ? { cooldown_minutes: Number(newCooldown.trim()) } : {}),
      })
      addToast({ type: 'success', message: `Rule "${newName.trim()}" created` })
      setShowAddModal(false)
      resetForm()
      refreshRules()
    } catch {
      addToast({ type: 'error', message: 'Failed to create notification rule' })
    } finally {
      setCreating(false)
    }
  }, [newName, newTrigger, newTarget, newPriority, newTags, newCooldown, newTitleTemplate, newMessageTemplate, addToast, refreshRules, resetForm])

  /** Apply a preset template to the form */
  const applyPreset = useCallback((preset: PresetTemplate) => {
    setNewName(preset.name)
    setNewTrigger(preset.trigger)
    setNewPriority(preset.priority)
    setNewTags(preset.tags.join(', '))
    setNewTitleTemplate(preset.title_template)
    setNewMessageTemplate(preset.message_template)
    setNewTarget('*')
    setShowAddModal(true)
  }, [])

  // Webhook handlers
  const handleCreateWebhook = useCallback(async () => {
    if (!webhookUrl.trim() || creatingWebhook) return
    setCreatingWebhook(true)
    try {
      await createWebhook({
        url: webhookUrl.trim(),
        events: Array.from(webhookEvents),
        enabled: true,
      })
      addToast({ type: 'success', message: 'Webhook created' })
      setShowAddWebhook(false)
      setWebhookUrl('')
      setWebhookEvents(new Set(WEBHOOK_DEFAULT_EVENTS))
      refreshWebhooks()
    } catch {
      addToast({ type: 'error', message: 'Failed to create webhook' })
    } finally {
      setCreatingWebhook(false)
    }
  }, [webhookUrl, webhookEvents, creatingWebhook, addToast, refreshWebhooks])

  const handleDeleteWebhook = useCallback(async (wh: WebhookType) => {
    const ok = await confirm({
      title: 'Delete this webhook?',
      message: `${wh.url}\n\nNothing is sent to this address any more. This cannot be undone.`,
      confirmLabel: 'Delete webhook',
      danger: true,
    })
    if (!ok) return
    setDeletingWebhookId(wh.id)
    try {
      await deleteWebhook(wh.id)
      addToast({ type: 'success', message: 'Webhook deleted' })
      refreshWebhooks()
    } catch {
      addToast({ type: 'error', message: 'Failed to delete webhook' })
    } finally {
      setDeletingWebhookId(null)
    }
  }, [addToast, confirm, refreshWebhooks])

  const handleTestWebhook = useCallback(async (id: string) => {
    setTestingWebhookId(id)
    try {
      const res = await testWebhook(id)
      // the server's own sentence about the answer (status 0 = unreachable); an older API only sends the code
      if (res.success) {
        addToast({ type: 'success', message: res.message || `Webhook test sent (${res.status_code})` })
      } else {
        addToast({ type: 'error', message: res.message || `Webhook test failed (${res.status_code})` })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to test webhook' })
    } finally {
      setTestingWebhookId(null)
    }
  }, [addToast])

  const toggleWebhookEvent = useCallback((event: string) => {
    setWebhookEvents((prev) => {
      const next = new Set(prev)
      if (next.has(event)) next.delete(event)
      else next.add(event)
      return next
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Disconnected
  // ---------------------------------------------------------------------------

  if (!isConnected) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader page="notifications" />
        <EmptyState
          icon={<Bell size={28} />}
          title="Connect to a server to manage notifications"
          hint={`Choose a server from the server menu in the sidebar, or add one on the ${pageLabel('settings')} page.`}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="notifications"
        subtitle={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} configured`}
        actions={<>
          <button
            onClick={() => setShowGuide(!showGuide)}
            aria-expanded={showGuide}
            aria-controls="notification-guide"
            aria-label="Guide"
            className={BTN_TOOLBAR_QUIET}
          >
            <BookOpen size={14} />
            <span className="hidden sm:inline">Guide</span>
          </button>
          {/* (admin: a test is a send, the API answers 403 to a user) */}
          {isAdmin && (
            <button
              onClick={handleSendTest}
              disabled={sendingTest || (!ntfyConfigured && !discordConfigured)}
              aria-label="Send test"
              className={BTN_TOOLBAR_QUIET}
              title={ntfyConfigured || discordConfigured ? 'Send a test notification on every configured channel' : 'No channel is configured yet'}
            >
              {sendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span className="hidden sm:inline">Send test</span>
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowAddModal(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              <Plus size={14} />
              Add rule
            </button>
          )}
        </>}
      />

      {/* ── Guide ──────────────────────────────────────────────────────── */}
      {showGuide && (
        <div id="notification-guide" className="surface overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-cyan-400" />
              <h2 className="text-sm font-semibold text-slate-200">Notification guide</h2>
            </div>
            <Hint label="Close the guide">
              <CloseButton label="Close the guide" size="sm" onClick={() => setShowGuide(false)} />
            </Hint>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-sm text-slate-400">
              Create notification rules that fire automatically when events occur. Customize the ntfy message title, body, priority, and tags. Use template variables to include dynamic context.
            </p>

            {/* How it works */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { n: 1, title: 'Create a rule', text: 'Choose a trigger event, set priority, and write your notification message using template variables.' },
                { n: 2, title: 'Event fires', text: 'When the trigger event occurs (container down, stack stopped, etc.), DCS evaluates all matching rules.' },
                { n: 3, title: 'ntfy sends', text: 'Variables are substituted and the notification is pushed to your ntfy topic instantly.' },
              ].map((step) => (
                <div key={step.n} className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-md accent-bg-subtle accent-text flex items-center justify-center text-[10px] font-bold">{step.n}</div>
                    <span className="text-xs font-medium text-slate-300">{step.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{step.text}</p>
                </div>
              ))}
            </div>

            {/* Template variables */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 mb-2">Template variables</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <div key={v.var} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.03]">
                    <code className="text-cyan-400 text-[10px] font-mono font-medium bg-cyan-500/10 px-1.5 py-0.5 rounded">{v.var}</code>
                    <span className="text-[10px] text-slate-500 truncate">{v.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Example */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 mb-2">Example notification</h3>
              <div className="rounded-lg bg-slate-950/60 border border-white/5 p-3 font-mono text-[11px] space-y-1">
                <p className="text-slate-500">Title:</p>
                <p className="text-slate-200 ml-2">⚠️ {'{'}<span className="text-cyan-400">container</span>{'}'} is Unhealthy</p>
                <p className="text-slate-500 mt-2">Message:</p>
                <p className="text-slate-300 ml-2">Container {'{'}<span className="text-cyan-400">container</span>{'}'} in {'{'}<span className="text-cyan-400">stack</span>{'}'} has become unhealthy at {'{'}<span className="text-cyan-400">timestamp</span>{'}'}.</p>
                <p className="text-slate-500 mt-2">Sends as:</p>
                <p className="text-emerald-300 ml-2">⚠️ Plex is Unhealthy</p>
                <p className="text-slate-300 ml-2">Container Plex in media-services has become unhealthy at 2026-03-30 21:15:00.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick add presets (adding a rule is for admins) ─────────────── */}
      {isAdmin && <div className="surface p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={14} className="text-slate-400" />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick add — notification presets</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PRESET_TEMPLATES.map((preset) => {
            const PresetIcon = preset.icon
            // rules made before the names were written in sentence case still count
            const alreadyExists = rules.some((r) => r.trigger === preset.trigger && r.name.toLowerCase() === preset.name.toLowerCase())
            return (
              <button
                key={preset.name}
                onClick={() => !alreadyExists && applyPreset(preset)}
                disabled={alreadyExists}
                className={`
                  group text-left rounded-xl border p-3.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40
                  ${alreadyExists
                    ? 'border-white/[0.03] bg-white/[0.01] opacity-50 cursor-default'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20 cursor-pointer press'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${preset.iconBg} ${preset.iconText}`}>
                    <PresetIcon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200 group-hover:text-slate-100 transition-colors">{preset.name}</span>
                      {alreadyExists && (
                        <span className="text-[9px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded-full">Added</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{preset.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${priorityColor(preset.priority)}`}>
                        {preset.priority}
                      </span>
                      <span className="text-[9px] text-slate-500">{preset.tags.join(', ')}</span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>}

      {/* ── Channels: ntfy and Discord, side by side ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── ntfy connection status ──────────────────────────────────────── */}
        <div className="surface p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-3 h-3 rounded-full ${ntfyConfigured ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                {ntfyConfigured && (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-30" />
                )}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200">ntfy status</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {ntfyConfigured
                    ? 'Connected and ready to send notifications'
                    : 'ntfy is not configured on this server'}
                </p>
              </div>
            </div>
            {ntfyConfigured && ntfyUrl && (
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Endpoint</span>
                <code className="text-xs font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                  {ntfyUrl}
                </code>
              </div>
            )}
          </div>
          {ntfyConfigured && ntfyUrl && (
            <div className="sm:hidden mt-3 pt-3 border-t border-white/[0.03]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Endpoint</span>
              <code className="text-xs font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/5 break-all">
                {ntfyUrl}
              </code>
            </div>
          )}
          {!ntfyConfigured && (
            <div className="mt-3 pt-3 border-t border-white/[0.03]">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/15">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-400/90">
                  Set <span className="font-mono">NTFY_URL</span> and <span className="font-mono">NTFY_TOPIC</span> under <button type="button" onClick={() => setCurrentPage('config')} className={LINK_BTN}>{pageLabel('config')} → Notifications</button> to enable push notifications.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Discord channel */}
        <div className="surface p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-3 h-3 rounded-full ${discordConfigured ? 'bg-indigo-400' : 'bg-slate-600'}`} />
                {discordConfigured && (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-indigo-400 animate-ping opacity-30" />
                )}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Discord</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {discordConfigured
                    ? 'Every rule also posts a rich embed to your channel'
                    : 'Post every notification to a Discord channel as a rich embed'}
                </p>
              </div>
            </div>
            {discordConfigured && discordHint && (
              <code className="whitespace-nowrap hidden sm:inline text-xs font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/5" title="The end of the webhook URL">webhook {discordHint}</code>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.03]">
            {discordConfigured ? (
              <p className="text-[11px] text-slate-500">
                Each event lands as an embed with a colour and emoji per event, the stack, container and status as fields, your server as the author line and a link back here. Repeats are held back by the rule's cooldown. Name, avatar and cooldowns live under <button type="button" onClick={() => setCurrentPage('config')} className={LINK_BTN}>{pageLabel('config')} → Notifications</button>; CrowdSec bans use the same webhook. Commands from Discord are the separate <button type="button" onClick={() => setCurrentPage('templates')} className={LINK_BTN}>DCS Discord Bot</button> template — the full walkthrough is docs/DISCORD.md in the DCS repository.
              </p>
            ) : (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/15">
                <MessageCircle size={14} className="text-indigo-300 mt-0.5 shrink-0" />
                <p className="text-[11px] text-indigo-200/90">
                  In Discord: Server Settings → Integrations → Webhooks → New Webhook, copy its URL and paste it as <span className="font-mono">DISCORD_WEBHOOK_URL</span> under <button type="button" onClick={() => setCurrentPage('config')} className={LINK_BTN}>{pageLabel('config')} → Notifications</button> (a <span className="font-mono">{'${SECRETS_…}'}</span> reference works too).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Rule list ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Notification rules</h2>

        {/* Loading */}
        {rulesLoading && !rulesData && (
          <div className="space-y-2" role="status" aria-label="Loading notification rules">
            {[1, 2].map((i) => <div key={i} className="rounded-xl h-[72px] skeleton" />)}
          </div>
        )}

        {/* Empty state */}
        {rulesData && rules.length === 0 && (
          <div className="surface">
            <EmptyState
              compact
              icon={<Bell size={28} />}
              title="No notification rules yet"
              hint={isAdmin ? 'Pick a preset above to start, or write your own rule.' : 'An admin can add rules.'}
              action={isAdmin ? (
                <button onClick={() => setShowAddModal(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                  <Plus size={14} />
                  Create first rule
                </button>
              ) : undefined}
            />
          </div>
        )}

        {/* Rule cards */}
        {rules.length > 0 && (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`surface p-4 md:p-6 transition-all ${
                  !rule.enabled ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {/* Left: name + badges */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate">{rule.name}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Trigger badge */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${triggerColor(rule.trigger)}`}>
                        {triggerIcon(rule.trigger)}
                        {triggerLabel(rule.trigger)}
                      </span>
                      {/* Priority badge */}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${priorityColor(rule.priority)}`}>
                        {rule.priority}
                      </span>
                      {/* Target */}
                      {rule.target && rule.target !== '*' && (
                        <span className="text-[10px] text-slate-500 font-mono bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/5">
                          {rule.target}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: on/off + delete (admin only) */}
                  {isAdmin && (
                  <div className="flex items-center gap-3 shrink-0">
                    <Switch
                      aria-label={`Rule ${rule.name} enabled`}
                      checked={rule.enabled}
                      disabled={togglingId === rule.id}
                      onChange={() => handleToggleRule(rule)}
                    />
                    <Hint label="Delete rule">
                      <button
                        onClick={() => handleDeleteRule(rule)}
                        disabled={deletingId === rule.id}
                        aria-label={`Delete rule ${rule.name}`}
                        className={`${BTN_ICON} ${TONE_GHOST_DANGER}`}
                      >
                        {deletingId === rule.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </Hint>
                  </div>
                  )}
                </div>

                {/* Tags row */}
                {rule.tags && rule.tags.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {rule.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] text-slate-500 bg-white/[0.03] px-1.5 py-0.5 rounded border border-white/5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Notification history (collapsible) ───────────────────────────── */}
      <div>
        <h2 className="mb-3">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            aria-expanded={historyExpanded}
            className={SECTION_TOGGLE}
          >
            <Clock size={13} />
            Notification history
            <span className="text-[10px] font-normal normal-case text-slate-500">
              ({history.length} {history.length === 1 ? 'entry' : 'entries'})
            </span>
            <ChevronDown size={14} className={`ml-1 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} />
          </button>
        </h2>

        {historyExpanded && (
          <div className="animate-fade-in">
            {/* Loading */}
            {historyLoading && !historyData && <LoadingState compact label="Loading history…" />}

            {/* Empty state */}
            {historyData && history.length === 0 && (
              <div className="surface">
                <EmptyState
                  compact
                  icon={<Clock size={28} />}
                  title="No notifications sent yet"
                  hint="They appear here as your rules fire, or when you send a test."
                />
              </div>
            )}

            {/* Timeline */}
            {history.length > 0 && (
              <div className="space-y-2">
                {history.map((entry) => (
                  <div
                    key={entry.timestamp}
                    className={`surface p-4 md:p-5 border-l-2 ${historyPriorityAccent(entry.priority)}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Type badge */}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${triggerColor(entry.type)}`}>
                            {triggerIcon(entry.type)}
                            {triggerLabel(entry.type)}
                          </span>
                          {/* Priority badge */}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${priorityColor(entry.priority)}`}>
                            {entry.priority}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 truncate">{entry.title}</p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Status code */}
                        <span className={`text-xs font-mono font-semibold ${statusCodeColor(entry.status_code)}`}>
                          {entry.status_code === 200 ? (
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle size={12} />
                              200
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <XCircle size={12} />
                              {entry.status_code}
                            </span>
                          )}
                        </span>
                        {/* Timestamp */}
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Webhooks ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3">
          <button
            onClick={() => setWebhooksExpanded(!webhooksExpanded)}
            aria-expanded={webhooksExpanded}
            className={SECTION_TOGGLE}
          >
            <Webhook size={13} />
            Webhooks
            <span className="text-[10px] font-normal normal-case text-slate-500">
              ({webhooks.length} {webhooks.length === 1 ? 'webhook' : 'webhooks'})
            </span>
            <ChevronDown size={14} className={`ml-1 transition-transform ${webhooksExpanded ? 'rotate-180' : ''}`} />
          </button>
        </h2>

        {webhooksExpanded && (
          <div className="space-y-3 animate-fade-in">
            {/* Add webhook button — admin only */}
            {isAdmin && (
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setShowAddWebhook(!showAddWebhook)}
                  aria-expanded={showAddWebhook}
                  className={`${BTN_TOOLBAR} ${TONE_OK}`}
                >
                  <Plus size={14} />
                  Add webhook
                </button>
              </div>
            )}

            {/* Inline add webhook form */}
            {showAddWebhook && (
              <div className="surface border-cyan-500/20 p-4 md:p-5 space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 mb-1">
                  <Webhook size={14} className="text-cyan-400" />
                  <h3 className="text-xs font-semibold text-slate-300">New webhook</h3>
                </div>

                {/* URL input */}
                <div>
                  <label htmlFor="webhook-url" className={LABEL}>Webhook URL</label>
                  <input
                    id="webhook-url"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://example.com/webhook"
                    className={`${INPUT} font-mono`}
                  />
                </div>

                {/* Event checkboxes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span id="webhook-events-label" className="text-[10px] text-slate-500 uppercase tracking-wider block">Events <span className="normal-case text-slate-600">· {webhookEvents.size} selected</span></span>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button type="button" onClick={() => setWebhookEvents(new Set(WEBHOOK_EVENT_TYPES.map((e) => e.value)))} className={`${MINI_LINK} text-cyan-400`}>All</button>
                      <button type="button" onClick={() => setWebhookEvents(new Set(WEBHOOK_DEFAULT_EVENTS))} className={`${MINI_LINK} text-cyan-400`}>Essentials</button>
                      <button type="button" onClick={() => setWebhookEvents(new Set())} className={`${MINI_LINK} text-slate-500`}>None</button>
                    </div>
                  </div>
                  <div className="space-y-3" role="group" aria-labelledby="webhook-events-label">
                    {WEBHOOK_EVENT_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="text-[10px] font-semibold text-slate-400 mb-1.5">{group.label}</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {group.events.map((evt) => (
                            <button
                              key={evt.value}
                              type="button"
                              aria-pressed={webhookEvents.has(evt.value)}
                              onClick={() => toggleWebhookEvent(evt.value)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                                webhookEvents.has(evt.value)
                                  ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20'
                                  : 'bg-white/[0.03] text-slate-500 border-white/5 hover:bg-white/5'
                              }`}
                            >
                              {webhookEventIcon(evt.value)}
                              {evt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">A Discord webhook URL gets the same embeds as the notification channel; a Slack URL gets text; anything else a JSON envelope.</p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => setShowAddWebhook(false)} className={BTN_TOOLBAR_QUIET}>
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateWebhook}
                    disabled={creatingWebhook || !webhookUrl.trim()}
                    className={`${BTN_TOOLBAR} ${TONE_OK}`}
                  >
                    {creatingWebhook ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Create webhook
                  </button>
                </div>
              </div>
            )}

            {/* Loading */}
            {!webhooksData && (
              <div className="space-y-2" role="status" aria-label="Loading webhooks">
                <div className="rounded-xl h-[72px] skeleton" />
              </div>
            )}

            {/* Empty state */}
            {webhooksData && webhooks.length === 0 && (
              <div className="surface">
                <EmptyState
                  compact
                  icon={<Webhook size={28} />}
                  title="No webhooks configured"
                  hint="Add a webhook to receive event notifications via HTTP."
                />
              </div>
            )}

            {/* Webhook list */}
            {webhooks.length > 0 && (
              <div className="space-y-2">
                {webhooks.map((wh) => (
                  <div
                    key={wh.id}
                    className={`surface p-4 md:p-5 transition-all ${
                      !wh.enabled ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      {/* Left: URL + events */}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <ExternalLink size={12} className="text-cyan-400 flex-shrink-0" />
                          <code className="text-xs font-mono text-slate-300 truncate">{wh.url}</code>
                          {wh.enabled ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-500/15 text-slate-500 border border-slate-500/20">
                              Disabled
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {wh.events.map((evt) => (
                            <span
                              key={evt}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium bg-white/5 text-slate-500 border border-white/5"
                            >
                              {webhookEventIcon(evt)}
                              {evt}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Test — admin only (a send: the API answers 403 to a user) */}
                        {isAdmin && (
                          <Hint label="Send a test payload">
                            <button
                              onClick={() => handleTestWebhook(wh.id)}
                              disabled={testingWebhookId === wh.id}
                              className={BTN_CARD_QUIET}
                            >
                              {testingWebhookId === wh.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                              Test
                            </button>
                          </Hint>
                        )}

                        {/* Delete — admin only */}
                        {isAdmin && (
                          <Hint label="Delete webhook">
                            <button
                              onClick={() => handleDeleteWebhook(wh)}
                              disabled={deletingWebhookId === wh.id}
                              aria-label={`Delete webhook ${wh.url}`}
                              className={`${BTN_ICON} ${TONE_GHOST_DANGER}`}
                            >
                              {deletingWebhookId === wh.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </Hint>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add rule modal (inline overlay) ─────────────────────────────── */}
      {showAddModal && createPortal(
        <ModalOverlay onClose={() => setShowAddModal(false)} className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false) }}
        >
          <div className="w-full sm:max-w-lg sm:mx-4 max-h-[92vh] bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-2xl shadow-2xl shadow-black/40 animate-slide-up sm:animate-scale-in overflow-hidden max-h-[90vh] overflow-y-auto scrollbar-thin">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 sticky top-0 bg-slate-900/95 backdrop-blur-sm z-10">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-200">New notification rule</h3>
              </div>
              <CloseButton onClick={() => setShowAddModal(false)} />
            </div>

            {/* Form */}
            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label htmlFor="rule-name" className={LABEL}>Rule name</label>
                <input
                  id="rule-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Critical container alerts"
                  className={INPUT}
                />
              </div>

              {/* Trigger type */}
              <div>
                <label htmlFor="rule-trigger" className={LABEL}>Trigger type</label>
                <select id="rule-trigger"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value as TriggerType)}
                  className={`${INPUT} appearance-none cursor-pointer`}
                >
                  {TRIGGER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-200">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target */}
              <div>
                <label htmlFor="rule-target" className={LABEL}>
                  Target
                  <span className="text-slate-500 ml-1 normal-case">(container, stack, or * for all)</span>
                </label>
                <input
                  id="rule-target"
                  type="text"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  placeholder="*"
                  className={`${INPUT} font-mono`}
                />
              </div>

              {/* Priority */}
              <div>
                <span id="rule-priority-label" className={LABEL}>Priority</span>
                <div className="flex gap-2" role="radiogroup" aria-labelledby="rule-priority-label">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={newPriority === opt.value}
                      onClick={() => setNewPriority(opt.value)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                        newPriority === opt.value
                          ? priorityColor(opt.value).replace('/15', '/25')
                          : 'bg-white/[0.03] text-slate-500 border-white/5 hover:bg-white/5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label htmlFor="rule-tags" className={LABEL}>
                  Tags
                  <span className="text-slate-500 ml-1 normal-case">(comma-separated, optional)</span>
                </label>
                <input
                  id="rule-tags"
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="warning, server, docker"
                  className={INPUT}
                />
              </div>

              {/* Cooldown */}
              <div>
                <label htmlFor="rule-cooldown" className={LABEL}>
                  Repeat at most every
                  <span className="text-slate-500 ml-1 normal-case">(minutes; blank = the event's default: 60 for container rules, 6 h for disk space, a day for image updates, always for deploys, backups and health changes)</span>
                </label>
                <input
                  id="rule-cooldown"
                  type="number"
                  min={0}
                  max={999999}
                  value={newCooldown}
                  onChange={(e) => setNewCooldown(e.target.value)}
                  placeholder="default"
                  className={`${INPUT} !w-40`}
                />
              </div>

              {/* Notification message section */}
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Send size={12} className="text-slate-400" />
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">ntfy message</span>
                </div>

                {/* Title template */}
                <div className="mb-3">
                  <label htmlFor="rule-title" className={LABEL}>
                    Title
                    <span className="text-slate-600 ml-1 normal-case">— use {'{'}<span className="text-cyan-400">variables</span>{'}'} for dynamic content</span>
                  </label>
                  <input
                    id="rule-title"
                    type="text"
                    value={newTitleTemplate}
                    onChange={(e) => setNewTitleTemplate(e.target.value)}
                    placeholder="e.g. ⚠️ {container} is {status}"
                    className={INPUT}
                  />
                </div>

                {/* Message template */}
                <div className="mb-3">
                  <label htmlFor="rule-message" className={LABEL}>Message body</label>
                  <textarea
                    id="rule-message"
                    value={newMessageTemplate}
                    onChange={(e) => setNewMessageTemplate(e.target.value)}
                    rows={3}
                    placeholder="e.g. Container {container} in {stack} needs attention. Status: {status}"
                    className={`${INPUT} resize-none`}
                  />
                </div>

                {/* Quick variable buttons */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert a variable into the message body">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <button
                      key={v.var}
                      type="button"
                      onClick={() => {
                        // Insert at the end of message template
                        setNewMessageTemplate((prev) => prev ? `${prev} ${v.var}` : v.var)
                      }}
                      className="h-8 sm:h-6 px-2 rounded-md text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/15 hover:bg-cyan-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      title={v.desc}
                    >
                      {v.var}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
              <button onClick={() => setShowAddModal(false)} className={BTN_SHEET_QUIET}>
                Cancel
              </button>
              <button
                onClick={handleCreateRule}
                disabled={creating || !newName.trim()}
                className={BTN_SHEET_PRIMARY}
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Create rule
              </button>
            </div>
          </div>
        </ModalOverlay>,
        document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Webhook constants & helpers
// ---------------------------------------------------------------------------

/** Everything a webhook can subscribe to: audit events the server records, grouped for the picker */
const WEBHOOK_EVENT_GROUPS: { label: string; events: { value: string; label: string }[] }[] = [
  { label: 'Containers', events: [
    { value: 'container_stopped', label: 'Stopped on its own' },
    { value: 'container_unhealthy', label: 'Unhealthy' },
    { value: 'container_recovered', label: 'Recovered' },
    { value: 'container_start', label: 'Started from DCS' },
    { value: 'container_stop', label: 'Stopped from DCS' },
    { value: 'container_restart', label: 'Restarted' },
    { value: 'container_recreate', label: 'Recreated' },
    { value: 'container_remove', label: 'Removed' },
    { value: 'container_reset', label: 'Nuked & reinstalled' },
  ] },
  { label: 'Stacks & deploys', events: [
    { value: 'deploy', label: 'Deployed' },
    { value: 'undeploy', label: 'Undeployed' },
    { value: 'stack_start', label: 'Stack started' },
    { value: 'stack_stop', label: 'Stack stopped' },
    { value: 'stack_restart', label: 'Stack restarted' },
    { value: 'stack_update', label: 'Stack updated' },
    { value: 'automation_run', label: 'Automation ran' },
  ] },
  { label: 'Health & space', events: [
    { value: 'health_change', label: 'Overall health changed' },
    { value: 'disk_warning', label: 'Disk space low' },
  ] },
  { label: 'Backups & DCS', events: [
    { value: 'backup_complete', label: 'Backup finished' },
    { value: 'backup_failed', label: 'Backup failed' },
    { value: 'recovery_bundle', label: 'Recovery bundle made' },
    { value: 'recovery_restore', label: 'Recovery restored' },
    { value: 'system_update', label: 'DCS updated' },
    { value: 'system_rollback', label: 'DCS rolled back' },
    { value: 'api_restart', label: 'API restarted' },
  ] },
  { label: 'Security & accounts', events: [
    { value: 'login_fail', label: 'Failed sign-in' },
    { value: 'lockout', label: 'Account locked out' },
    { value: 'login_ok', label: 'Sign-in' },
    { value: 'user_create', label: 'User created' },
    { value: 'user_role', label: 'Role changed' },
    { value: 'crowdsec_unban', label: 'CrowdSec unban' },
  ] },
  { label: 'Proxmox', events: [
    { value: 'proxmox_vm_stopped', label: 'VM stopped on its own' },
    { value: 'proxmox_vm_started', label: 'VM started (not by DCS)' },
    { value: 'proxmox_vm_start', label: 'VM started by DCS' },
    { value: 'proxmox_vm_shutdown', label: 'VM shut down by DCS' },
    { value: 'proxmox_vm_stop', label: 'VM stopped by DCS' },
    { value: 'proxmox_vm_reboot', label: 'VM rebooted by DCS' },
    { value: 'proxmox_vm_reset', label: 'VM reset by DCS' },
  ] },
  { label: 'Fleet', events: [
    { value: 'fleet_member_joined', label: 'A member joined the hub' },
    { value: 'fleet_member_down', label: 'A member stopped answering' },
    { value: 'fleet_member_up', label: 'A member answers again' },
    { value: 'fleet_member_added', label: 'Member added by address' },
    { value: 'fleet_member_removed', label: 'Member removed' },
    { value: 'fleet_proxy', label: 'Action on a member through the hub' },
  ] },
]
const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENT_GROUPS.flatMap((g) => g.events)
const WEBHOOK_DEFAULT_EVENTS = ['container_stopped', 'container_unhealthy', 'container_recovered', 'deploy', 'undeploy', 'stack_start', 'stack_stop', 'health_change', 'disk_warning', 'backup_complete', 'backup_failed']

function webhookEventIcon(event: string) {
  switch (event) {
    case 'deploy': return <Rocket size={9} />
    case 'undeploy': case 'container_remove': return <Trash2 size={9} />
    case 'health_change': case 'container_unhealthy': case 'container_recovered': return <HeartPulse size={9} />
    case 'backup_complete': case 'backup_failed': case 'recovery_bundle': case 'recovery_restore': return <Archive size={9} />
    case 'stack_start': case 'container_start': return <Play size={9} />
    case 'stack_stop': case 'container_stop': case 'container_stopped': return <Power size={9} />
    case 'stack_restart': case 'container_restart': case 'container_recreate': case 'stack_update': case 'system_update': case 'system_rollback': case 'api_restart': return <RefreshCw size={9} />
    case 'disk_warning': return <HardDrive size={9} />
    case 'login_fail': case 'lockout': case 'login_ok': case 'user_create': case 'user_role': case 'crowdsec_unban': return <Shield size={9} />
    case 'container_reset': return <Zap size={9} />
    case 'automation_run': return <Zap size={9} />
    default: return <Bell size={9} />
  }
}
