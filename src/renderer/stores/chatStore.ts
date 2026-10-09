// =============================================================================
// chatStore — the active server's chat room: its messages, who is online, who
// is typing, what is unread. One room per server (a fleet VM shows its hub's);
// the store belongs to one server and one account (`key`) and is emptied when
// either changes (ChatController). New messages arrive over the live stream
// (event "chat"); while the stream is down the controller polls instead.
// =============================================================================

import { create } from 'zustand'
import { ApiError } from '../api/client'
import {
  fetchChatMessages, sendChatMessage, editChatMessage, deleteChatMessage, clearChatRoom, fetchChatPresence,
} from '../api/chat'
import { useSettingsStore } from './settingsStore'
import type { ChatLiveEvent, ChatMessage, ChatPresence, ChatRoom } from '../../shared/types'

/** unknown: not asked yet (or no answer); on: the room exists; off: switched off, a fleet VM, or an API without chat */
export type ChatStatus = 'unknown' | 'on' | 'off'

const PAGE = 100
const TYPING_SHOWN_MS = 6000

interface ChatState {
  /** the server and account this belongs to ("" = nothing loaded) */
  key: string
  status: ChatStatus
  /** why the room is off: chat_off, chat_on_hub, unsupported */
  offReason: string | null
  /** oldest first, by id */
  messages: ChatMessage[]
  hasMore: boolean
  loadingEarlier: boolean
  room: ChatRoom | null
  online: ChatPresence[]
  /** user → when their "typing" stops showing (ms) */
  typing: Record<string, number>
  open: boolean
  /** the newest message id this person has seen (kept per server and account on this device) */
  lastReadId: number
  error: string | null

  reset: (key: string) => void
  /** the newest page: first load, after the stream reconnects, and the poll while it is down */
  refresh: () => Promise<void>
  loadEarlier: () => Promise<void>
  refreshPresence: () => Promise<void>
  applyEvent: (ev: ChatLiveEvent) => void
  setOpen: (open: boolean) => void
  markRead: () => void
  send: (text: string) => Promise<void>
  edit: (id: number, text: string) => Promise<void>
  remove: (id: number) => Promise<void>
  clear: () => Promise<number>
  /** the admin switched the room in Settings: show or hide it at once */
  setEnabled: (on: boolean) => void
}

function readKey(key: string): string { return `dcs-chat-read-${key}` }
function loadLastRead(key: string): number {
  try { const n = Number(localStorage.getItem(readKey(key))); return Number.isFinite(n) && n > 0 ? n : 0 } catch { return 0 }
}
function saveLastRead(key: string, id: number) {
  try { localStorage.setItem(readKey(key), String(id)) } catch { /* private mode */ }
}

/** one list, oldest first, the newer copy of a message winning */
function merge(list: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  if (!more.length) return list
  const byId = new Map<number, ChatMessage>()
  for (const m of list) byId.set(m.id, m)
  for (const m of more) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** why a call answered that the room is not here (null: some other trouble) */
function offReasonOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 404) return null
  const reason = typeof err.data?.reason === 'string' ? err.data.reason : ''
  return reason || 'unsupported'
}

/** the words for an error the person caused or can act on */
export function chatErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const wait = Number(err.data?.retry_after)
      return Number.isFinite(wait) && wait > 0 ? `Slow down a little: you can send again in ${wait} s.` : 'Slow down a little, then send again.'
    }
    if (err.status === 0) return 'No answer from the server. Check the connection and try again.'
    if (err.message) return err.message.endsWith('.') ? err.message : `${err.message}.`
  }
  return 'That did not work. Try again.'
}

export const useChatStore = create<ChatState>((set, get) => {
  /** a call for one server/account whose answer arrives after a switch is dropped */
  const still = (key: string) => get().key === key

  const takeRoom = (room: ChatRoom | undefined) => {
    if (!room) return
    set({ room, online: room.members_online ?? [] })
  }

  return {
    key: '',
    status: 'unknown',
    offReason: null,
    messages: [],
    hasMore: false,
    loadingEarlier: false,
    room: null,
    online: [],
    typing: {},
    open: false,
    lastReadId: 0,
    error: null,

    reset: (key) => set({
      key, status: 'unknown', offReason: null, messages: [], hasMore: false, loadingEarlier: false, room: null,
      online: [], typing: {}, open: false, lastReadId: key ? loadLastRead(key) : 0, error: null,
    }),

    refresh: async () => {
      const key = get().key
      if (!key) return
      try {
        const res = await fetchChatMessages({ limit: PAGE })
        if (!still(key)) return
        const prev = get()
        // a room cleared since we last looked: what we hold is gone
        const cleared = !!res.room?.cleared_at && res.room.cleared_at !== prev.room?.cleared_at && !!prev.room
        const base = cleared ? [] : prev.messages
        // the newest page replaces its own range (edits and deletions made while the stream was down); older pages stay
        const oldestNew = res.messages[0]?.id ?? Infinity
        const kept = base.filter((m) => m.id < oldestNew)
        const firstLoad = prev.status !== 'on'
        let lastReadId = prev.lastReadId
        // the first time this device sees the room, what is already there counts as read
        if (lastReadId === 0 && res.messages.length) { lastReadId = res.messages[res.messages.length - 1].id; saveLastRead(key, lastReadId) }
        set({
          status: 'on', offReason: null, messages: merge(kept, res.messages),
          hasMore: firstLoad || cleared ? res.has_more : prev.hasMore || res.has_more,
          lastReadId, error: null,
        })
        takeRoom(res.room)
      } catch (err) {
        if (!still(key)) return
        const off = offReasonOf(err)
        if (off) set({ status: 'off', offReason: off, open: false, messages: [], room: null, online: [] })
        // anything else (no answer, a 500): keep what is shown; the next refresh tries again
      }
    },

    loadEarlier: async () => {
      const { key, messages, loadingEarlier } = get()
      if (!key || loadingEarlier || !messages.length) return
      set({ loadingEarlier: true })
      try {
        const res = await fetchChatMessages({ limit: PAGE, before: messages[0].id })
        if (!still(key)) return
        set({ messages: merge(get().messages, res.messages), hasMore: res.has_more, loadingEarlier: false })
      } catch (err) {
        if (still(key)) set({ loadingEarlier: false, error: chatErrorText(err) })
      }
    },

    refreshPresence: async () => {
      const key = get().key
      if (!key || get().status !== 'on') return
      try {
        const res = await fetchChatPresence()
        if (still(key)) set({ online: res.online ?? [] })
      } catch (err) {
        if (still(key) && offReasonOf(err)) void get().refresh()
      }
    },

    applyEvent: (ev) => {
      const st = get()
      if (!st.key) return
      switch (ev.type) {
        case 'message':
        case 'edit':
        case 'delete': {
          if (st.status !== 'on' || !ev.message || typeof ev.message.id !== 'number') return
          const typing = { ...st.typing }
          if (ev.type === 'message') delete typing[ev.message.user]
          // a sender is plainly here
          const online = ev.type === 'message' && !st.online.some((p) => p.user === ev.message.user)
            ? [...st.online, { user: ev.message.user, role: ev.message.role, seen: ev.message.ts }]
            : st.online
          set({ messages: merge(st.messages, [ev.message]), typing, online })
          return
        }
        case 'clear':
          if (st.status === 'on') set({ messages: [], hasMore: false, room: st.room ? { ...st.room, cleared_at: ev.ts, cleared_by: ev.by } : st.room })
          return
        case 'typing':
          if (st.status === 'on' && ev.user && ev.user !== st.room?.me.user) set({ typing: { ...st.typing, [ev.user]: Date.now() + TYPING_SHOWN_MS } })
          return
        case 'state':
          get().setEnabled(!!ev.enabled)
          return
      }
    },

    setOpen: (open) => {
      set({ open })
      if (open) get().markRead()
    },

    markRead: () => {
      const { key, messages, lastReadId } = get()
      const newest = messages.length ? messages[messages.length - 1].id : 0
      if (key && newest > lastReadId) { saveLastRead(key, newest); set({ lastReadId: newest }) }
    },

    send: async (text) => {
      const key = get().key
      const res = await sendChatMessage(text)
      if (!still(key)) return
      set({ messages: merge(get().messages, [res.message]) })
      get().markRead()
    },

    edit: async (id, text) => {
      const key = get().key
      const res = await editChatMessage(id, text)
      if (still(key)) set({ messages: merge(get().messages, [res.message]) })
    },

    remove: async (id) => {
      const key = get().key
      const res = await deleteChatMessage(id)
      if (still(key)) set({ messages: merge(get().messages, [res.message]) })
    },

    clear: async () => {
      const key = get().key
      const res = await clearChatRoom()
      if (still(key)) set({ messages: [], hasMore: false })
      return res.removed ?? 0
    },

    setEnabled: (on) => {
      if (!on) { set({ status: 'off', offReason: 'chat_off', open: false, messages: [], room: null, online: [], typing: {} }); return }
      if (get().status !== 'on') void get().refresh()
    },
  }
})

/** messages from someone else that came after what this person last saw */
export function selectUnread(s: Pick<ChatState, 'messages' | 'lastReadId' | 'room'>): number {
  const me = s.room?.me.user
  let n = 0
  for (const m of s.messages) if (m.id > s.lastReadId && m.user !== me && !m.deleted) n++
  return n
}

/** the bubble is on screen: the room is on and this device shows it (BackToTop moves up to make room) */
export function useChatBubbleShown(): boolean {
  const on = useChatStore((s) => s.status === 'on')
  const wanted = useSettingsStore((s) => s.chatBubble) !== false
  return on && wanted
}
