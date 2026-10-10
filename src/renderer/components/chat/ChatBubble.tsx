// =============================================================================
// ChatBubble — the chat in the bottom-right corner: a round button (the unread
// count of every room, a dot when someone else is online) that opens the panel
// (ChatPanel). Shown while a room is on and this device has "Show the chat
// bubble" on (Settings → Chat). It also runs the rooms (stores/chatStore):
//   · the active server's room, and with "Show rooms of every server I'm signed
//     in to" the room of every other server this dashboard holds a session for
//     (each with that server's own address and session); a switch of server or
//     account builds them again
//   · the active room hears the app's live stream (event "chat"); while it is
//     down its newest page is fetched every 5 s (usePolling), and once more when
//     it comes back. Who is online every 30 s; a room that is off each minute
//   · another server's room: its summary at first (badge, who is online); its
//     own live stream while the dashboard is shown, closed while it is hidden;
//     every 10 s its summary (or newest page, once the panel showed it) while
//     that stream is down, who is online every 30 s while it is up
//   · a browser notification for a message while the dashboard is hidden, only
//     when the person turned that on in the panel
// =============================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle, X } from 'lucide-react'
import { useChatStore, selectUnread, roomsOn, activeRoom, type ChatRoomSpec } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useServerStore } from '../../stores/serverStore'
import { useAuthStore } from '../../stores/authStore'
import { useLiveEvent, useLiveConnected } from '../../hooks/useLiveStream'
import { usePolling } from '../../hooks/usePolling'
import ChatPanel from './ChatPanel'

import { Count } from '../common/Pill'

const sameServer = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase()

/** the rooms the dashboard should be in: the active server's, then (when wanted) every other server with a session */
function useRoomSpecs(): ChatRoomSpec[] {
  const activeId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const user = useAuthStore((s) => s.currentUser)
  const across = useSettingsStore((s) => s.chatAcross) !== false
  const specs = useMemo(() => {
    const active = servers.find((s) => s.id === activeId)
    if (!active || !user) return []
    const out: ChatRoomSpec[] = [{ id: active.id, name: active.name || active.url, url: active.url, user, active: true }]
    if (!across) return out
    const seen = new Set([sameServer(active.url)])
    for (const s of servers) {
      const token = s.session?.token
      // the same server under a second profile is the same room
      if (s.id === active.id || !token || !s.session?.username || seen.has(sameServer(s.url))) continue
      seen.add(sameServer(s.url))
      out.push({ id: s.id, name: s.name || s.url, url: s.url, user: s.session.username, token, active: false })
    }
    return out
  }, [servers, activeId, user, across])
  // the same rooms again (another field of a profile changed) are no change
  const sig = JSON.stringify(specs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => specs, [sig])
}

function useChatRooms() {
  const specs = useRoomSpecs()
  useEffect(() => { useChatStore.getState().sync(specs) }, [specs])

  // the active room: live events of the app's stream
  const activeId = specs[0]?.id ?? ''
  useLiveEvent('chat', (msg) => {
    const ev = msg.data
    if (activeId && ev && typeof ev === 'object' && 'type' in ev) useChatStore.getState().applyEvent(activeId, ev)
  })

  // the stream down: poll; back up: catch up once. A room with no answer yet is asked again, one that is off each minute.
  // (the room keeps going while the window is hidden: a message then is a notification)
  const status = useChatStore((s) => s.rooms[activeId]?.status ?? 'unknown')
  const live = useLiveConnected()
  const room = { requireConnection: false, whenHidden: 'run' } as const
  const refreshRoom = useCallback(() => (activeId ? useChatStore.getState().refresh(activeId) : Promise.resolve()), [activeId])
  usePolling(refreshRoom, 5000, { ...room, enabled: !!activeId && status === 'on' && !live })
  usePolling(refreshRoom, status === 'unknown' ? 15000 : 60000, { ...room, enabled: !!activeId && status !== 'on' })
  usePolling(useCallback(() => (activeId ? useChatStore.getState().refreshPresence(activeId) : Promise.resolve()), [activeId]), 30000, { ...room, enabled: !!activeId && status === 'on' })
  const wasLive = useRef(live)
  useEffect(() => {
    if (live && !wasLive.current && activeId && useChatStore.getState().rooms[activeId]?.status === 'on') void useChatStore.getState().refresh(activeId)
    wasLive.current = live
  }, [live, activeId])

  // the other servers' rooms: their own streams while the dashboard is shown (and the bubble wanted), and a poll for
  // what a stream does not say (or while it is down)
  const bubble = useSettingsStore((s) => s.chatBubble) !== false
  const remotes = specs.length > 1
  useEffect(() => {
    if (!remotes) return
    const apply = () => useChatStore.getState().setRemoteLive(bubble && document.visibilityState === 'visible')
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => { document.removeEventListener('visibilitychange', apply); useChatStore.getState().setRemoteLive(false) }
  }, [remotes, bubble])
  const pollRemotes = useCallback(async () => {
    const st = useChatStore.getState()
    const now = Date.now()
    await Promise.allSettled(Object.values(st.rooms).filter((r) => !r.active).map((r) => {
      if (r.status === 'off') return r.offReason === 'signed_out' || now - r.checkedAt < 60000 ? null : st.peek(r.id)
      if (r.status === 'unknown' && r.checkedAt && now - r.checkedAt < 60000) return null
      if (r.status === 'on' && r.live) {
        if (now - r.checkedAt < 30000) return null
        return r.loaded ? st.refreshPresence(r.id) : st.peek(r.id)
      }
      return r.loaded ? st.refresh(r.id) : st.peek(r.id)
    }))
  }, [])
  usePolling(pollRemotes, 10000, { requireConnection: false, enabled: remotes })

  // a typing note fades on its own
  const typingSig = useChatStore((s) => Object.values(s.rooms).map((r) => Object.values(r.typing).join(',')).join('|'))
  useEffect(() => {
    const all = Object.values(useChatStore.getState().rooms).flatMap((r) => Object.values(r.typing))
    if (!all.length) return
    const t = setTimeout(() => {
      const now = Date.now()
      const st = useChatStore.getState()
      let rooms = st.rooms
      for (const r of Object.values(st.rooms)) {
        const kept = Object.fromEntries(Object.entries(r.typing).filter(([, until]) => until > now))
        if (Object.keys(kept).length !== Object.keys(r.typing).length) rooms = { ...rooms, [r.id]: { ...r, typing: kept } }
      }
      if (rooms !== st.rooms) useChatStore.setState({ rooms })
    }, Math.max(250, Math.min(...all) - Date.now()))
    return () => clearTimeout(t)
  }, [typingSig])

  // what arrives while the panel is open and the window shown is read; a notification for one while hidden (when asked for)
  const notified = useRef(new Map<string, number>())
  useEffect(() => useChatStore.subscribe((s, prev) => {
    const changed = Object.values(s.rooms).filter((r) => r.messages !== prev.rooms[r.id]?.messages && r.messages.length)
    if (!changed.length) return
    if (s.open && document.visibilityState === 'visible') s.markRead()
    const several = roomsOn(s).length > 1
    for (const r of changed) {
      const newest = r.messages[r.messages.length - 1]
      const seen = notified.current.get(r.key)
      notified.current.set(r.key, Math.max(seen ?? 0, newest.id))
      // the first messages a room shows are not news
      if (seen === undefined || newest.id <= seen) continue
      if (newest.deleted || newest.user === r.room?.me.user || document.visibilityState === 'visible') continue
      if (!useSettingsStore.getState().chatNotify || typeof Notification === 'undefined' || Notification.permission !== 'granted') continue
      try {
        const n = new Notification(several ? `${newest.user} in the chat on ${r.name}` : `${newest.user} in the chat`, { body: newest.text.slice(0, 160), tag: `dcs-chat-${r.id}` })
        n.onclick = () => { window.focus(); const st = useChatStore.getState(); st.setTab(several ? r.id : st.tab); st.setOpen(true); n.close() }
      } catch { /* a browser that only allows them from a service worker */ }
    }
  }), [])
  useEffect(() => {
    const onVisible = () => { const s = useChatStore.getState(); if (s.open && document.visibilityState === 'visible') s.markRead() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}

export default function ChatBubble() {
  useChatRooms()
  const anyOn = useChatStore((s) => roomsOn(s).length > 0)
  const open = useChatStore((s) => s.open)
  const setOpen = useChatStore((s) => s.setOpen)
  const unread = useChatStore(selectUnread)
  const othersOnline = useChatStore((s) => roomsOn(s).some((r) => r.online.some((p) => p.user !== r.room?.me.user)))
  const activeOn = useChatStore((s) => activeRoom(s)?.status === 'on')
  const shown = useSettingsStore((s) => s.chatBubble) !== false

  // the bubble switched off on this device, or every room gone: the panel goes too
  useEffect(() => { if ((!shown || !anyOn) && open) setOpen(false) }, [shown, anyOn, open, setOpen])

  if (!anyOn || !shown) return null
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
        data-chat-active-room={activeOn ? 'on' : 'off'}
        onClick={() => setOpen(!open)}
        className={`lift-over-savebar fixed bottom-16 right-5 md:bottom-14 md:right-8 z-40 h-11 w-11 rounded-full backdrop-blur-md border shadow-lg shadow-black/40
          flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40
          ${open ? 'bg-emerald-600 border-emerald-500/30 text-white' : 'bg-slate-900/80 border-white/10 text-slate-300 hover:text-emerald-400 hover:border-emerald-500/30'}`}
      >
        {open ? <X size={18} aria-hidden /> : <MessageCircle size={18} aria-hidden />}
        {!open && unread > 0 && (
          <Count alert n={unread > 9 ? '9+' : unread} className="absolute -top-1 -right-1" />
        )}
        {!open && othersOnline && (
          <span aria-hidden title="Someone else is online" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
        )}
      </button>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
    </>,
    document.body,
  )
}
