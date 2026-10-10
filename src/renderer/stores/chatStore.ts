// =============================================================================
// chatStore — every chat room the dashboard is in: the active server's, and
// (Settings → Chat → "Show rooms of every server I'm signed in to") the room of
// each other server this dashboard holds a session for. One room per server (a
// fleet VM shows its hub's); each belongs to one server and one account (`key`).
//
//   · the active server's room talks through the app's client (api/client) and
//     hears the app's live stream (event "chat"); while it is down ChatBubble polls
//   · another server's room talks through a client of its own, made with THAT
//     server's address and the session it issued (`clientFor`): a token only ever
//     goes to the server that issued it, and nothing of one room is written to
//     another. Until the panel shows it, only its summary is asked (the badge, who
//     is online); its live stream (lib/chatStream) is opened while the dashboard
//     is shown
//   · the Everyone tab merges the rooms on screen only (selectEveryone)
//
// Leaving the active server empties all of it (serverScope); ChatBubble builds
// the rooms again for the next one.
// =============================================================================

import { create } from 'zustand'
import { ApiClient, ApiError, apiClient } from '../api/client'
import {
  fetchChatMessages, fetchChatSummary, sendChatMessage, editChatMessage, deleteChatMessage, clearChatRoom, fetchChatPresence,
  sendChatTyping, fetchUserProfile,
} from '../api/chat'
import { useSettingsStore } from './settingsStore'
import { onServerReset } from '../lib/serverScope'
import { openChatStream } from '../lib/chatStream'
import type { ChatLiveEvent, ChatMessage, ChatPresence, ChatRoom, ChatUserProfile } from '../../shared/types'

/** unknown: not asked yet (or no answer); on: the room exists; off: switched off, a fleet VM, an API without chat, or
 *  (another server) the session it issued is not good any more */
export type ChatStatus = 'unknown' | 'on' | 'off'

/** the Everyone tab */
export const EVERYONE = 'all'

const PAGE = 100
const TYPING_SHOWN_MS = 6000

/** what the dashboard knows of a server whose room it shows: the profile, and the session that server issued */
export interface ChatRoomSpec {
  /** the server profile's id */
  id: string
  name: string
  url: string
  user: string
  /** the session token that server issued (another server's room only; the active one uses the app's client) */
  token?: string
  active: boolean
}

export interface ChatRoomState {
  id: string
  /** server and account ("id|user") */
  key: string
  name: string
  url: string
  active: boolean
  status: ChatStatus
  /** why the room is off: chat_off, chat_on_hub, unsupported, signed_out */
  offReason: string | null
  /** oldest first, by id */
  messages: ChatMessage[]
  /** the messages were asked for (the active room always; another one once the panel shows it) */
  loaded: boolean
  hasMore: boolean
  loadingEarlier: boolean
  room: ChatRoom | null
  online: ChatPresence[]
  /** user → when their "typing" stops showing (ms) */
  typing: Record<string, number>
  /** the newest message id this person has seen (kept per server and account on this device) */
  lastReadId: number
  /** what the summary said is unread, while the messages are not loaded */
  summaryUnread: number
  /** an API before 4.0.48: no summary, its newest page is asked instead */
  noSummary: boolean
  /** its own live stream is open (another server's room) */
  live: boolean
  /** when it was last asked (ms) */
  checkedAt: number
}

interface ChatState {
  /** by server id */
  rooms: Record<string, ChatRoomState>
  /** the active server first, then the others in the order of the server list */
  order: string[]
  /** the tab shown: EVERYONE or a server id */
  tab: string
  open: boolean
  /** the room the Everyone tab posts to (null: the active server's) */
  postTo: string | null

  /** the rooms the dashboard should be in now: new ones are asked, gone ones closed */
  sync: (specs: ChatRoomSpec[]) => void
  /** the newest page of a room: first load, after its stream reconnects, the poll while it is down */
  refresh: (id: string) => Promise<void>
  /** the room without its messages (another server's, before the panel shows it) */
  peek: (id: string) => Promise<void>
  loadEarlier: (id: string) => Promise<void>
  refreshPresence: (id: string) => Promise<void>
  applyEvent: (id: string, ev: ChatLiveEvent) => void
  setOpen: (open: boolean) => void
  setTab: (tab: string) => void
  setPostTo: (id: string | null) => void
  /** what the panel shows now counts as read */
  markRead: () => void
  send: (id: string, text: string) => Promise<void>
  edit: (id: string, msgId: number, text: string) => Promise<void>
  remove: (id: string, msgId: number) => Promise<void>
  clear: (id: string) => Promise<number>
  typingNow: (id: string) => void
  /** the admin switched the active server's room in Settings: show or hide it at once */
  setEnabled: (on: boolean) => void
  /** open or close the live streams of the other servers' rooms (the dashboard shown or hidden) */
  setRemoteLive: (wanted: boolean) => void
  /** everything goes (leaving the active server) */
  resetAll: () => void
}

function readKey(key: string): string { return `dcs-chat-read-${key}` }
function loadLastRead(key: string): number {
  try { const n = Number(localStorage.getItem(readKey(key))); return Number.isFinite(n) && n > 0 ? n : 0 } catch { return 0 }
}
function saveLastRead(key: string, id: number) {
  try { localStorage.setItem(readKey(key), String(id)) } catch { /* private mode */ }
}

/** one list, oldest first, the newer copy of a message winning (an edit or a deletion heard live comes without the
 *  writer's picture: the copy before keeps it) */
function merge(list: ChatMessage[], more: ChatMessage[]): ChatMessage[] {
  if (!more.length) return list
  const byId = new Map<number, ChatMessage>()
  for (const m of list) byId.set(m.id, m)
  for (const m of more) {
    const old = byId.get(m.id)
    byId.set(m.id, old && !m.avatar_url && !m.avatar_emoji && (old.avatar_url || old.avatar_emoji) ? { ...m, avatar_url: old.avatar_url, avatar_emoji: old.avatar_emoji } : m)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** why a call answered that the room is not here (null: some other trouble) */
function offReasonOf(err: unknown, active: boolean): string | null {
  if (!(err instanceof ApiError)) return null
  // another server's session that it does not take any more: that room is left (its own sign-in is that server's business)
  if (!active && err.status === 401) return 'signed_out'
  if (err.status !== 404) return null
  const reason = typeof err.data?.reason === 'string' ? err.data.reason : ''
  return reason || 'unsupported'
}

/** the words for an error the person caused or can act on */
export function chatErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const wait = Math.round(err.retryAfterMs / 1000)
      return wait > 0 ? `Slow down a little: you can send again in ${wait} s.` : 'Slow down a little, then send again.'
    }
    if (err.status === 0) return 'No answer from the server. Check the connection and try again.'
    if (err.message) return err.message.endsWith('.') ? err.message : `${err.message}.`
  }
  return 'That did not work. Try again.'
}

// ── the clients and streams of the other servers' rooms ───────────────────────
// One client per server id, made with that server's address and token; a new address or token makes a new one.
const remoteClients = new Map<string, { url: string; token: string; client: ApiClient }>()
const remoteStreams = new Map<string, () => void>()
/** the dashboard is shown: the other rooms' streams are open (setRemoteLive) */
let remoteLiveWanted = false

/** pictures already fetched, by room and address: an object URL (null: none to show) */
const pictures = new Map<string, Promise<string | null>>()

/**
 * A person's picture as an address the page can show: fetched from the server whose room it is, with THAT server's
 * session (the address alone would need the session in the URL), kept for this run. null when there is none.
 */
export function chatPictureSrc(roomId: string, path: string): Promise<string | null> {
  const key = `${roomId}|${path}`
  const known = pictures.get(key)
  if (known) return known
  const client = clientFor(useChatStore.getState().rooms[roomId])
  if (!client || !path.startsWith('/users/')) return Promise.resolve(null)
  const base = client.getBaseUrl()
  const token = client.getAuthToken()
  const p = fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async (r) => (r.ok && /^image\//.test(r.headers.get('content-type') || '') ? URL.createObjectURL(await r.blob()) : null))
    .catch(() => null)
  pictures.set(key, p)
  // a failure is not kept: the next showing asks again
  void p.then((u) => { if (!u) pictures.delete(key) })
  return p
}

/** what a person shows the others, from the server whose room it is (with that server's session) */
export function chatPersonCard(roomId: string, user: string): Promise<ChatUserProfile> {
  const client = clientFor(useChatStore.getState().rooms[roomId])
  if (!client) return Promise.reject(new Error('That room is not open any more.'))
  return fetchUserProfile(user, client)
}

function dropPictures() {
  for (const p of pictures.values()) void p.then((u) => { if (u) URL.revokeObjectURL(u) })
  pictures.clear()
}

function clientFor(room: ChatRoomState | undefined): ApiClient | null {
  if (!room) return null
  if (room.active) return apiClient
  return remoteClients.get(room.id)?.client ?? null
}

function dropRemote(id: string) {
  remoteStreams.get(id)?.()
  remoteStreams.delete(id)
  const c = remoteClients.get(id)
  if (c) c.client.cancelAll()
  remoteClients.delete(id)
}

function freshRoom(spec: ChatRoomSpec): ChatRoomState {
  const key = `${spec.id}|${spec.user}`
  return {
    id: spec.id, key, name: spec.name, url: spec.url, active: spec.active,
    status: 'unknown', offReason: null, messages: [], loaded: false, hasMore: false, loadingEarlier: false,
    room: null, online: [], typing: {}, lastReadId: loadLastRead(key), summaryUnread: 0, noSummary: false, live: false, checkedAt: 0,
  }
}

export const useChatStore = create<ChatState>((set, get) => {
  /** a call for one room whose answer arrives after the room changed hands (another account, gone) is dropped */
  const still = (id: string, key: string) => get().rooms[id]?.key === key
  const patch = (id: string, p: Partial<ChatRoomState> | ((r: ChatRoomState) => Partial<ChatRoomState>)) => {
    const r = get().rooms[id]
    if (!r) return
    set({ rooms: { ...get().rooms, [id]: { ...r, ...(typeof p === 'function' ? p(r) : p) } } })
  }
  const goneOff = (id: string, reason: string) => {
    patch(id, { status: 'off', offReason: reason, messages: [], loaded: false, room: null, online: [], typing: {}, summaryUnread: 0, live: false })
    if (reason === 'signed_out') { remoteStreams.get(id)?.(); remoteStreams.delete(id) }
    const st = get()
    if (st.tab === id) set({ tab: st.order[0] ?? EVERYONE })
    if (st.postTo === id) set({ postTo: null })
  }

  const openStream = (id: string) => {
    const r = get().rooms[id]
    const c = remoteClients.get(id)
    if (!r || r.active || !c || r.status !== 'on' || remoteStreams.has(id)) return
    const key = r.key
    remoteStreams.set(id, openChatStream(c.url, c.token, {
      onEvent: (ev) => { if (still(id, key)) get().applyEvent(id, ev) },
      onStatus: (open) => {
        if (!still(id, key)) return
        patch(id, { live: open })
        // back up: what was missed meanwhile
        if (open) void (get().rooms[id]?.loaded ? get().refresh(id) : get().peek(id))
      },
      onRefused: () => { if (still(id, key)) goneOff(id, 'signed_out') },
    }))
  }

  return {
    rooms: {},
    order: [],
    tab: EVERYONE,
    open: false,
    postTo: null,

    sync: (specs) => {
      const prev = get().rooms
      const rooms: Record<string, ChatRoomState> = {}
      const fresh: string[] = []
      for (const spec of specs) {
        let old: ChatRoomState | undefined = prev[spec.id]
        const key = `${spec.id}|${spec.user}`
        if (spec.active) {
          dropRemote(spec.id)
        } else {
          const c = remoteClients.get(spec.id)
          if (!c || c.url !== spec.url || c.token !== spec.token) {
            // another address or another session: a client of its own for it, and the room starts afresh
            dropRemote(spec.id)
            const client = new ApiClient(spec.url)
            client.setAuthToken(spec.token ?? null)
            remoteClients.set(spec.id, { url: spec.url, token: spec.token ?? '', client })
            old = undefined
          }
        }
        if (old && old.key === key && old.active === spec.active && old.url === spec.url) {
          rooms[spec.id] = old.name === spec.name ? old : { ...old, name: spec.name }
        } else {
          rooms[spec.id] = freshRoom(spec)
          fresh.push(spec.id)
        }
      }
      for (const id of Object.keys(prev)) if (!rooms[id]) dropRemote(id)
      const order = specs.map((s) => s.id)
      const st = get()
      set({
        rooms, order,
        tab: st.tab === EVERYONE || rooms[st.tab] ? st.tab : EVERYONE,
        postTo: st.postTo && rooms[st.postTo] ? st.postTo : null,
      })
      for (const id of fresh) void (rooms[id].active ? get().refresh(id) : get().peek(id))
    },

    refresh: async (id) => {
      const r0 = get().rooms[id]
      const client = clientFor(r0)
      if (!r0 || !client) return
      const key = r0.key
      try {
        const res = await fetchChatMessages({ limit: PAGE }, client)
        if (!still(id, key)) return
        const prev = get().rooms[id]
        // a room cleared since we last looked: what we hold is gone
        const cleared = !!res.room?.cleared_at && res.room.cleared_at !== prev.room?.cleared_at && !!prev.room
        const base = cleared ? [] : prev.messages
        // the newest page replaces its own range (edits and deletions made while the stream was down); older pages stay
        const oldestNew = res.messages[0]?.id ?? Infinity
        const kept = base.filter((m) => m.id < oldestNew)
        const firstLoad = !prev.loaded || prev.status !== 'on'
        let lastReadId = prev.lastReadId
        // the first time this device sees the room, what is already there counts as read
        if (lastReadId === 0 && res.messages.length) { lastReadId = res.messages[res.messages.length - 1].id; saveLastRead(key, lastReadId) }
        patch(id, {
          status: 'on', offReason: null, messages: merge(kept, res.messages), loaded: true,
          hasMore: firstLoad || cleared ? res.has_more : prev.hasMore || res.has_more,
          lastReadId, summaryUnread: 0, checkedAt: Date.now(),
          ...(res.room ? { room: res.room, online: res.room.members_online ?? [] } : {}),
        })
        if (!prev.active && remoteLiveWanted) openStream(id)
      } catch (err) {
        if (!still(id, key)) return
        const off = offReasonOf(err, r0.active)
        if (off) goneOff(id, off)
        else patch(id, { checkedAt: Date.now() })
        // anything else (no answer, a 500): keep what is shown; the next refresh tries again
      }
    },

    peek: async (id) => {
      const r0 = get().rooms[id]
      const client = clientFor(r0)
      if (!r0 || !client) return
      if (r0.loaded || r0.noSummary) return get().refresh(id)
      const key = r0.key
      try {
        const res = await fetchChatSummary(r0.lastReadId > 0 ? r0.lastReadId : null, client)
        if (!still(id, key)) return
        const room = res.room
        let lastReadId = get().rooms[id].lastReadId
        // the first time this device sees the room, what is already there counts as read
        if (lastReadId === 0 && room.latest_id > 0) { lastReadId = room.latest_id; saveLastRead(key, lastReadId) }
        patch(id, {
          status: 'on', offReason: null, room, online: room.members_online ?? [], lastReadId,
          summaryUnread: typeof res.unread === 'number' ? res.unread : 0, checkedAt: Date.now(),
        })
        if (remoteLiveWanted) openStream(id)
      } catch (err) {
        if (!still(id, key)) return
        // an API without the summary: its newest page instead (which also says whether it has a room at all)
        if (err instanceof ApiError && err.status === 404 && !err.data?.reason) { patch(id, { noSummary: true }); return get().refresh(id) }
        const off = offReasonOf(err, r0.active)
        if (off) goneOff(id, off)
        else patch(id, { checkedAt: Date.now() })
      }
    },

    loadEarlier: async (id) => {
      const r0 = get().rooms[id]
      const client = clientFor(r0)
      if (!r0 || !client || r0.loadingEarlier || !r0.messages.length) return
      const key = r0.key
      patch(id, { loadingEarlier: true })
      try {
        const res = await fetchChatMessages({ limit: PAGE, before: r0.messages[0].id }, client)
        if (!still(id, key)) return
        patch(id, (r) => ({ messages: merge(r.messages, res.messages), hasMore: res.has_more, loadingEarlier: false }))
      } catch {
        if (still(id, key)) patch(id, { loadingEarlier: false })
      }
    },

    refreshPresence: async (id) => {
      const r0 = get().rooms[id]
      const client = clientFor(r0)
      if (!r0 || !client || r0.status !== 'on') return
      const key = r0.key
      try {
        const res = await fetchChatPresence(client)
        if (still(id, key)) patch(id, { online: res.online ?? [], checkedAt: Date.now() })
      } catch (err) {
        if (still(id, key) && offReasonOf(err, r0.active)) void get().refresh(id)
      }
    },

    applyEvent: (id, ev) => {
      const r = get().rooms[id]
      if (!r) return
      switch (ev.type) {
        case 'message':
        case 'edit':
        case 'delete': {
          if (r.status !== 'on' || !ev.message || typeof ev.message.id !== 'number') return
          const typing = { ...r.typing }
          if (ev.type === 'message') delete typing[ev.message.user]
          // a sender is plainly here
          const online = ev.type === 'message' && !r.online.some((p) => p.user === ev.message.user)
            ? [...r.online, { user: ev.message.user, role: ev.message.role, seen: ev.message.ts }]
            : r.online
          if (!r.loaded) {
            // the messages are not held yet: the count is what changes
            const counts = ev.type === 'message' && ev.message.id > r.lastReadId && ev.message.user !== r.room?.me.user
            patch(id, {
              typing, online, summaryUnread: r.summaryUnread + (counts ? 1 : 0),
              room: r.room && ev.message.id > r.room.latest_id ? { ...r.room, latest_id: ev.message.id } : r.room,
            })
            if (ev.type === 'delete') void get().peek(id)
            return
          }
          patch(id, { messages: merge(r.messages, [ev.message]), typing, online })
          return
        }
        case 'clear':
          if (r.status === 'on') patch(id, { messages: [], hasMore: false, summaryUnread: 0, room: r.room ? { ...r.room, cleared_at: ev.ts, cleared_by: ev.by } : r.room })
          return
        case 'typing':
          if (r.status === 'on' && ev.user && ev.user !== r.room?.me.user) patch(id, { typing: { ...r.typing, [ev.user]: Date.now() + TYPING_SHOWN_MS } })
          return
        case 'state':
          if (!ev.enabled) goneOff(id, 'chat_off')
          else if (r.status !== 'on') void get().refresh(id)
          return
      }
    },

    setOpen: (open) => {
      set({ open })
      if (!open) return
      // the panel shows the messages of the tab: another server's are asked now
      const { tab, rooms } = get()
      for (const r of Object.values(rooms)) {
        if (r.status === 'on' && !r.loaded && (tab === EVERYONE || tab === r.id)) void get().refresh(r.id)
      }
      get().markRead()
    },

    setTab: (tab) => {
      const st = get()
      if (tab !== EVERYONE && !st.rooms[tab]) return
      set({ tab })
      if (st.open) get().setOpen(true)
    },

    setPostTo: (id) => set({ postTo: id }),

    markRead: () => {
      const { rooms, tab, open } = get()
      if (!open) return
      let next = rooms
      for (const r of Object.values(rooms)) {
        if (r.status !== 'on' || (tab !== EVERYONE && tab !== r.id)) continue
        const newest = r.loaded ? (r.messages.length ? r.messages[r.messages.length - 1].id : 0) : (r.room?.latest_id ?? 0)
        if (newest > r.lastReadId || r.summaryUnread) {
          if (newest > r.lastReadId) saveLastRead(r.key, newest)
          next = { ...next, [r.id]: { ...r, lastReadId: Math.max(newest, r.lastReadId), summaryUnread: 0 } }
        }
      }
      if (next !== rooms) set({ rooms: next })
    },

    send: async (id, text) => {
      const r = get().rooms[id]
      const client = clientFor(r)
      if (!r || !client) throw new Error('That room is not open any more.')
      const res = await sendChatMessage(text, client)
      if (!still(id, r.key)) return
      patch(id, (cur) => ({ messages: cur.loaded ? merge(cur.messages, [res.message]) : cur.messages }))
      if (!get().rooms[id]?.loaded) void get().refresh(id)
      get().markRead()
    },

    edit: async (id, msgId, text) => {
      const r = get().rooms[id]
      const client = clientFor(r)
      if (!r || !client) return
      const res = await editChatMessage(msgId, text, client)
      if (still(id, r.key)) patch(id, (cur) => ({ messages: merge(cur.messages, [res.message]) }))
    },

    remove: async (id, msgId) => {
      const r = get().rooms[id]
      const client = clientFor(r)
      if (!r || !client) return
      const res = await deleteChatMessage(msgId, client)
      if (still(id, r.key)) patch(id, (cur) => ({ messages: merge(cur.messages, [res.message]) }))
    },

    clear: async (id) => {
      const r = get().rooms[id]
      const client = clientFor(r)
      if (!r || !client) return 0
      const res = await clearChatRoom(client)
      if (still(id, r.key)) patch(id, { messages: [], hasMore: false })
      return res.removed ?? 0
    },

    typingNow: (id) => {
      const client = clientFor(get().rooms[id])
      if (client) sendChatTyping(client).catch(() => {})
    },

    setEnabled: (on) => {
      const active = Object.values(get().rooms).find((r) => r.active)
      if (!active) return
      if (!on) { goneOff(active.id, 'chat_off'); return }
      if (active.status !== 'on') void get().refresh(active.id)
    },

    setRemoteLive: (wanted) => {
      remoteLiveWanted = wanted
      for (const r of Object.values(get().rooms)) {
        if (r.active) continue
        if (wanted) openStream(r.id)
        else if (remoteStreams.has(r.id)) { remoteStreams.get(r.id)?.(); remoteStreams.delete(r.id); patch(r.id, { live: false }) }
      }
    },

    resetAll: () => {
      for (const id of [...remoteClients.keys(), ...remoteStreams.keys()]) dropRemote(id)
      dropPictures()
      set({ rooms: {}, order: [], tab: EVERYONE, open: false, postTo: null })
    },
  }
})

// ── selectors ─────────────────────────────────────────────────────────────────

/** messages from someone else that came after what this person last saw, in one room */
export function roomUnread(r: ChatRoomState | undefined): number {
  if (!r || r.status !== 'on') return 0
  if (!r.loaded) return r.summaryUnread
  const me = r.room?.me.user
  let n = 0
  for (const m of r.messages) if (m.id > r.lastReadId && m.user !== me && !m.deleted) n++
  return n
}

/** the rooms that are on, in order (the active server first) */
export function roomsOn(s: Pick<ChatState, 'rooms' | 'order'>): ChatRoomState[] {
  return s.order.map((id) => s.rooms[id]).filter((r): r is ChatRoomState => !!r && r.status === 'on')
}

/** the active server's room */
export function activeRoom(s: Pick<ChatState, 'rooms' | 'order'>): ChatRoomState | undefined {
  return Object.values(s.rooms).find((r) => r.active)
}

/** the unread of every room that is on (the bubble's badge) */
export function selectUnread(s: Pick<ChatState, 'rooms' | 'order'>): number {
  return roomsOn(s).reduce((n, r) => n + roomUnread(r), 0)
}

/** one message of the Everyone tab: which room it is from */
export interface EveryoneMessage { room: string; m: ChatMessage }

/** every room's messages in time order (on screen only: nothing of one room goes to another) */
export function selectEveryone(s: Pick<ChatState, 'rooms' | 'order'>): EveryoneMessage[] {
  const out: EveryoneMessage[] = []
  for (const r of roomsOn(s)) for (const m of r.messages) out.push({ room: r.id, m })
  const rank = new Map(s.order.map((id, i) => [id, i]))
  return out.sort((a, b) => a.m.ts - b.m.ts || (rank.get(a.room) ?? 0) - (rank.get(b.room) ?? 0) || a.m.id - b.m.id)
}

/** who is online, across the rooms that are on: one entry per person and server, never this person themself */
export interface Friend { user: string; role: string; room: string; roomName: string; active: boolean; seen: number; avatar_url?: string; avatar_emoji?: string }
export function selectFriends(s: Pick<ChatState, 'rooms' | 'order'>): Friend[] {
  const out: Friend[] = []
  for (const r of roomsOn(s)) {
    const me = r.room?.me.user
    for (const p of r.online) if (p.user !== me) out.push({ user: p.user, role: p.role, room: r.id, roomName: r.name, active: r.active, seen: p.seen, avatar_url: p.avatar_url, avatar_emoji: p.avatar_emoji })
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.user.localeCompare(b.user) || a.roomName.localeCompare(b.roomName))
}

/** the bubble is on screen: a room is on and this device shows it (BackToTop moves up to make room) */
export function useChatBubbleShown(): boolean {
  const on = useChatStore((s) => roomsOn(s).length > 0)
  const wanted = useSettingsStore((s) => s.chatBubble) !== false
  return on && wanted
}

// the rooms are the server's and the account's: nothing of them stays when the dashboard leaves (ChatBubble builds the
// next server's)
onServerReset(() => useChatStore.getState().resetAll())
