// =============================================================================
// ChatSettingsPanel — Settings → Chat: the bubble on this device, and for an
// admin the server's own switch (CHAT_ENABLED, through GET/POST /config) and
// whether users may write (CHAT_USERS_CAN_POST). Switching the room off hides
// the bubble on every dashboard at once (the live stream says so).
// =============================================================================

import { useEffect, useState } from 'react'
import { Switch } from '@mantine/core'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { useChatStore } from '../../stores/chatStore'
import { fetchConfig, updateConfig } from '../../api/endpoints'
import { chatErrorText } from '../../stores/chatStore'

export default function ChatSettingsPanel() {
  const bubble = useSettingsStore((s) => s.chatBubble) !== false
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const status = useChatStore((s) => s.status)
  const offReason = useChatStore((s) => s.offReason)

  // the server's switches (admins): null until read, or when the server has no chat
  const [server, setServer] = useState<{ enabled: boolean; usersPost: boolean } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isAdmin) return
    let gone = false
    fetchConfig().then((c) => {
      if (gone || typeof c.chat_enabled !== 'boolean') return
      setServer({ enabled: c.chat_enabled, usersPost: c.chat_users_can_post !== false })
    }).catch(() => {})
    return () => { gone = true }
  }, [isAdmin])

  const save = async (key: 'CHAT_ENABLED' | 'CHAT_USERS_CAN_POST', on: boolean) => {
    setSaving(key); setError(null)
    try {
      await updateConfig({ [key]: on ? 'true' : 'false' })
      setServer((s) => (s ? { ...s, ...(key === 'CHAT_ENABLED' ? { enabled: on } : { usersPost: on }) } : s))
      if (key === 'CHAT_ENABLED') useChatStore.getState().setEnabled(on)
      else void useChatStore.getState().refresh()
    } catch (err) {
      setError(chatErrorText(err))
    } finally {
      setSaving(null)
    }
  }

  const note = status === 'off'
    ? offReason === 'chat_on_hub' ? 'This server is part of a fleet: its chat room is on the hub.'
      : offReason === 'unsupported' ? 'This server has no chat yet (it needs DCS Orchestrator with the chat room).'
        : 'The chat is switched off on this server.'
    : null

  return (
    <div className="space-y-4" data-chat-settings>
      <p className="text-xs text-slate-400 max-w-prose leading-relaxed">
        One room per server for everyone signed in to it. The bubble sits in the bottom-right corner; messages arrive live.
      </p>
      <Switch
        label="Show the chat bubble"
        description="On this device only. Hiding it does not leave the room: turn it back on any time."
        checked={bubble}
        onChange={(e) => updateSetting('chatBubble', e.currentTarget.checked)}
        color="emerald"
        size="sm"
      />
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
      {isAdmin && server && (
        <div className="border-t border-white/[0.03] pt-4 space-y-3">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">This server (every account)</p>
          <Switch
            label="Chat on this server"
            description="Off hides the bubble on every dashboard and keeps the messages. Saved as CHAT_ENABLED in .env."
            checked={server.enabled}
            disabled={saving !== null}
            onChange={(e) => void save('CHAT_ENABLED', e.currentTarget.checked)}
            color="emerald"
            size="sm"
          />
          <Switch
            label="Users may write"
            description="Off keeps accounts with the user role to reading; admins always write. CHAT_USERS_CAN_POST."
            checked={server.usersPost}
            disabled={saving !== null || !server.enabled}
            onChange={(e) => void save('CHAT_USERS_CAN_POST', e.currentTarget.checked)}
            color="emerald"
            size="sm"
          />
          {error && <p role="alert" className="text-[11px] text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  )
}
