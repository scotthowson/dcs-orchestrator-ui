// =============================================================================
// ChatBubble — the server's chat room in the bottom-right corner: a round
// button (unread count, a dot when someone else is online) that opens the
// panel (ChatPanel). Shown while the server's room is on and this device has
// "Show the chat bubble" on (Settings → Chat). It also runs the room:
//   · the store belongs to the active server and account; a switch empties it
//   · new messages come over the live stream (event "chat"); while the stream
//     is down the newest page is fetched every 5 s instead (usePolling), and once
//     more when it comes back (what was missed meanwhile)
//   · who is online every 30 s; a room that is off is asked again each minute
//   · a browser notification for a message while the dashboard is hidden, only
//     when the person turned that on in the panel
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, X } from 'lucide-react'
import { useChatStore, selectUnread } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useServerStore } from '../../stores/serverStore'
import { useAuthStore } from '../../stores/authStore'
import { useLiveEvent, useLiveConnected } from '../../hooks/useLiveStream'
import { usePolling } from '../../hooks/usePolling'
import ChatPanel from './ChatPanel'

import { Count } from '../common/Pill'
function useChatRoom() {
  const serverId = useServerStore((s) => s.activeServerId)
  const user = useAuthStore((s) => s.currentUser)
  const key = serverId && user ? `${serverId}|${user}` : ''

  // the room of this server and this account, from scratch
  useEffect(() => {
    const st = useChatStore.getState()
    if (st.key !== key) st.reset(key)
    if (key) void useChatStore.getState().refresh()
  }, [key])

  // live events
  useLiveEvent('chat', (msg) => {
    const ev = msg.data
    if (ev && typeof ev === 'object' && 'type' in ev) useChatStore.getState().applyEvent(ev)
  })

  // the stream down: poll; back up: catch up once. A room with no answer yet is asked again, one that is off each minute.
  // (the room keeps going while the window is hidden: a message then is a notification)
  const status = useChatStore((s) => s.status)
  const live = useLiveConnected()
  const room = { requireConnection: false, whenHidden: 'run' } as const
  const refreshRoom = useCallback(() => useChatStore.getState().refresh(), [])
  usePolling(refreshRoom, 5000, { ...room, enabled: !!key && status === 'on' && !live })
  usePolling(refreshRoom, status === 'unknown' ? 15000 : 60000, { ...room, enabled: !!key && status !== 'on' })
  usePolling(useCallback(() => useChatStore.getState().refreshPresence(), []), 30000, { ...room, enabled: !!key && status === 'on' })
  const wasLive = useRef(live)
  useEffect(() => {
    if (live && !wasLive.current && key && useChatStore.getState().status === 'on') void useChatStore.getState().refresh()
    wasLive.current = live
  }, [live, key])

  // a typing note fades on its own
  const typing = useChatStore((s) => s.typing)
  useEffect(() => {
    const users = Object.keys(typing)
    if (!users.length) return
    const next = Math.min(...users.map((u) => typing[u])) - Date.now()
    const t = setTimeout(() => {
      const now = Date.now()
      const cur = useChatStore.getState().typing
      const kept = Object.fromEntries(Object.entries(cur).filter(([, until]) => until > now))
      useChatStore.setState({ typing: kept })
    }, Math.max(250, next))
    return () => clearTimeout(t)
  }, [typing])

  // what arrives while the panel is open and the window shown is read; a notification for one while hidden (when asked for)
  const notifiedRef = useRef(0)
  useEffect(() => useChatStore.subscribe((s, prev) => {
    if (s.messages === prev.messages || !s.messages.length) return
    const newest = s.messages[s.messages.length - 1]
    if (s.open && document.visibilityState === 'visible') s.markRead()
    if (prev.status !== 'on' || !prev.messages.length && notifiedRef.current === 0) { notifiedRef.current = newest.id; return }
    if (newest.id <= notifiedRef.current) return
    notifiedRef.current = newest.id
    if (newest.deleted || newest.user === s.room?.me.user || document.visibilityState === 'visible') return
    if (!useSettingsStore.getState().chatNotify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try {
      const n = new Notification(`${newest.user} in the chat`, { body: newest.text.slice(0, 160), tag: 'dcs-chat' })
      n.onclick = () => { window.focus(); useChatStore.getState().setOpen(true); n.close() }
    } catch { /* a browser that only allows them from a service worker */ }
  }), [])
  useEffect(() => {
    const onVisible = () => { const s = useChatStore.getState(); if (s.open && document.visibilityState === 'visible') s.markRead() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}

export default function ChatBubble() {
  useChatRoom()
  const status = useChatStore((s) => s.status)
  const open = useChatStore((s) => s.open)
  const setOpen = useChatStore((s) => s.setOpen)
  const unread = useChatStore(selectUnread)
  const othersOnline = useChatStore((s) => s.online.filter((p) => p.user !== s.room?.me.user).length)
  const shown = useSettingsStore((s) => s.chatBubble) !== false

  // the bubble switched off on this device, or the room gone: the panel goes too
  useEffect(() => { if ((!shown || status !== 'on') && open) setOpen(false) }, [shown, status, open, setOpen])

  if (status !== 'on' || !shown) return null
  const label = open ? 'Close the chat' : unread > 0 ? `Open the chat, ${unread} unread` : 'Open the chat'

  return createPortal(
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-chat-bubble
        onClick={() => setOpen(!open)}
        className={`lift-over-savebar fixed bottom-16 right-5 md:bottom-14 md:right-8 z-40 h-11 w-11 rounded-full backdrop-blur-md border shadow-lg shadow-black/40
          flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40
          ${open ? 'bg-emerald-600 border-emerald-500/30 text-white' : 'bg-slate-900/80 border-white/10 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/30'}`}
      >
        {open ? <X size={18} aria-hidden /> : <MessageCircle size={18} aria-hidden />}
        {!open && unread > 0 && (
          <Count alert n={unread > 9 ? '9+' : unread} className="absolute -top-1 -right-1" />
        )}
        {!open && othersOnline > 0 && (
          <span aria-hidden title="Someone else is online" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
        )}
      </button>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
    </>,
    document.body,
  )
}
