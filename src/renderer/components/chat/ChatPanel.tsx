// =============================================================================
// ChatPanel — the rooms opened from the bubble: 380 × 520 above it on a
// computer, the whole screen on a phone. With one room it is that server's room;
// with the rooms of several servers (stores/chatStore) a tab per server plus
// Everyone, which merges them in time order with each message's server on a chip
// and posts to the server picked beside the field (the active one by default).
// Each tab carries its own unread count; the strip under the tabs says who is
// online where ("austin · on Howson's hub"), and a press opens that room.
// Messages are grouped by person, server and minute (a day line between days);
// Enter sends, Shift+Enter starts a new line. One's own messages: edit (15
// minutes) and delete, on hover or focus, or a long press on a touch screen; an
// admin of that server deletes any and may clear its room. Escape closes (or
// ends an edit), Tab stays inside. A small settings row turns browser
// notifications on.
// =============================================================================

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Switch } from '@mantine/core'
import { Check, Loader2, Pencil, Send, Settings2, Trash2, Eraser } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import {
  useChatStore, chatErrorText, roomsOn, roomUnread, selectEveryone, selectFriends, EVERYONE,
  type ChatRoomState, type EveryoneMessage,
} from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useModalA11y } from '../../hooks/useModalA11y'
import { useConfirm } from '../common/ConfirmDialog'
import { BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER } from '../../lib/ui'
import { CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'
import { Count, Pill } from '../common/Pill'
import type { ChatMessage } from '../../../shared/types'

import CloseButton from '../common/CloseButton'
import { PersonButton } from './ChatPerson'
interface Group { key: string; room: string; user: string; role: string; ts: number; day: string; items: ChatMessage[] }

function dayOf(ts: number): string {
  const d = new Date(ts * 1000)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function timeOf(ts: number, h24: boolean): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: !h24 })
}

/** consecutive messages of one person on one server within the same minute share a header */
function groupMessages(list: EveryoneMessage[]): Group[] {
  const out: Group[] = []
  for (const { room, m } of list) {
    const day = dayOf(m.ts)
    const last = out[out.length - 1]
    if (last && last.room === room && last.user === m.user && last.day === day && Math.floor(last.items[last.items.length - 1].ts / 60) === Math.floor(m.ts / 60)) {
      last.items.push(m)
    } else {
      out.push({ key: `g${room}-${m.id}`, room, user: m.user, role: m.role, ts: m.ts, day, items: [m] })
    }
  }
  return out
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export default function ChatPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()

  const rooms = useChatStore((s) => s.rooms)
  const order = useChatStore((s) => s.order)
  const tab = useChatStore((s) => s.tab)
  const postTo = useChatStore((s) => s.postTo)
  const on = useChatStore(useShallow((s) => roomsOn(s)))
  const friends = useMemo(() => selectFriends({ rooms, order }), [rooms, order])
  const h24 = useSettingsStore((s) => s.use24hClock) !== false
  const notify = useSettingsStore((s) => s.chatNotify)
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  // several rooms: tabs (Everyone, then one per server); one room: just that room
  const several = on.length > 1
  const view: ChatRoomState | null = several ? (tab === EVERYONE ? null : rooms[tab] ?? null) : on[0] ?? null
  const everyone = several && !view
  const listed = useMemo<EveryoneMessage[]>(
    () => (view ? view.messages.map((m) => ({ room: view.id, m })) : selectEveryone({ rooms, order })),
    [view, rooms, order],
  )
  const groups = useMemo(() => groupMessages(listed), [listed])
  // each room's pictures by person: from its messages, then who is online (the fresher)
  const pictures = useMemo(() => {
    const out = new Map<string, Map<string, { url?: string; emoji?: string }>>()
    for (const r of on) {
      const m = new Map<string, { url?: string; emoji?: string }>()
      for (const x of r.messages) if (x.avatar_url || x.avatar_emoji) m.set(x.user, { url: x.avatar_url, emoji: x.avatar_emoji })
      for (const p of r.online) if (p.avatar_url || p.avatar_emoji) m.set(p.user, { url: p.avatar_url, emoji: p.avatar_emoji })
      out.set(r.id, m)
    }
    return out
  }, [on])

  // where the field posts: the room shown, or in Everyone the one picked (the active server's by default)
  const writable = on.filter((r) => r.room?.me.can_post)
  const target: ChatRoomState | null = view
    ? view
    : (postTo && writable.find((r) => r.id === postTo)) || writable.find((r) => r.active) || writable[0] || null
  const canPost = !!target?.room?.me.can_post
  const maxLen = target?.room?.max_length ?? 2000
  const meOf = (id: string) => rooms[id]?.room?.me.user ?? ''

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ room: string; id: number; text: string } | null>(null)
  const [actionsFor, setActionsFor] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [notifyNote, setNotifyNote] = useState<string | null>(null)
  const typingSentAt = useRef(0)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Escape ends an edit first, then closes the panel (handled below, not by the hook)
  useModalA11y(ref, onClose, { closeOnEscape: false, initialFocus: inputRef })

  // stay at the bottom when something arrives and the list was at the bottom (or it is ours); keep the place when older
  // ones load; a new tab starts at the bottom
  const atBottom = useRef(true)
  /** the oldest message shown before (its id), to tell older ones loading from new ones arriving */
  const prevFirst = useRef<number | null>(null)
  const prevHeight = useRef(0)
  const prevView = useRef<string>('')
  const viewKey = view?.id ?? EVERYONE
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const first = listed[0]?.m.id ?? null
    const lastItem = listed[listed.length - 1]
    // older ones load only in a single room's tab (Show earlier messages)
    const olderLoaded = prevView.current === viewKey && !!view && prevFirst.current !== null && first !== null && first < prevFirst.current
    if (olderLoaded) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
    } else if (prevView.current !== viewKey || atBottom.current || (lastItem && lastItem.m.user === meOf(lastItem.room))) {
      el.scrollTop = el.scrollHeight
      atBottom.current = true
    }
    prevView.current = viewKey
    prevFirst.current = first
    prevHeight.current = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed, viewKey])
  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    prevHeight.current = el.scrollHeight
  }

  // who is typing: in the room shown, or in Everyone in any room (with its server)
  const typingNames = (view ? [view] : on).flatMap((r) =>
    Object.keys(r.typing).filter((u) => u !== r.room?.me.user).map((u) => (several && !view ? `${u} (${r.name})` : u)))
  const onlineNames = view && !several
    ? [...view.online].sort((a, b) => a.user.localeCompare(b.user)).map((p) => (p.user === view.room?.me.user ? `${p.user} (you)` : p.user))
    : []

  const send = async () => {
    const text = draft.trim()
    if (!text || sending || !target) return
    if (text.length > maxLen) { setError(`A message is at most ${maxLen} characters.`); return }
    setSending(true); setError(null)
    try {
      await useChatStore.getState().send(target.id, text)
      setDraft('')
      atBottom.current = true
    } catch (err) {
      setError(chatErrorText(err))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const onDraftChange = (v: string) => {
    setDraft(v)
    if (error) setError(null)
    if (v.trim() && canPost && target && Date.now() - typingSentAt.current > 3000) {
      typingSentAt.current = Date.now()
      useChatStore.getState().typingNow(target.id)
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) { setError('A message cannot be empty: delete it instead.'); return }
    try {
      await useChatStore.getState().edit(editing.room, editing.id, text)
      setEditing(null); setError(null)
      inputRef.current?.focus()
    } catch (err) {
      setError(chatErrorText(err))
    }
  }

  const remove = async (room: string, m: ChatMessage) => {
    const mine = m.user === meOf(room)
    const where = several ? ` on ${rooms[room]?.name ?? 'that server'}` : ''
    const ok = await confirm({
      title: mine ? 'Delete your message?' : `Delete ${m.user}'s message?`,
      message: mine
        ? `It is removed for everyone${where}. The room shows that a message was deleted.`
        : `It is removed for everyone${where}, and that server's audit log records that you removed it (without its text).`,
      confirmLabel: 'Delete message',
      danger: true,
    })
    if (!ok) return
    try { await useChatStore.getState().remove(room, m.id); setActionsFor(null) } catch (err) { setError(chatErrorText(err)) }
    inputRef.current?.focus()
  }

  const clearRoom = async (r: ChatRoomState) => {
    const ok = await confirm({
      title: several ? `Clear the room on ${r.name}?` : 'Clear the room?',
      message: `Every message goes, for everyone on ${several ? r.name : 'this server'}. The audit log records that you cleared it.`,
      confirmLabel: 'Clear the room',
      danger: true,
    })
    if (!ok) return
    try { await useChatStore.getState().clear(r.id); setError(null) } catch (err) { setError(chatErrorText(err)) }
  }

  const toggleNotify = async (enable: boolean) => {
    setNotifyNote(null)
    if (!enable) { updateSetting('chatNotify', false); return }
    if (typeof Notification === 'undefined') { setNotifyNote('This browser cannot show notifications.'); return }
    let perm = Notification.permission
    if (perm === 'default') { try { perm = await Notification.requestPermission() } catch { perm = 'denied' } }
    if (perm !== 'granted') { setNotifyNote('The browser blocks notifications for this site. Allow them in its site settings first.'); return }
    updateSetting('chatNotify', true)
  }

  // Escape anywhere while the panel is the top layer (a confirmation over it takes the key itself): an edit ends first,
  // then the actions shown by a long press, then the panel closes. On the document, so it also works when the focus was
  // lost (a deleted message's button)
  const escRef = useRef<() => void>(() => {})
  escRef.current = () => {
    if (editing) { setEditing(null); inputRef.current?.focus(); return }
    if (actionsFor !== null) { setActionsFor(null); return }
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // a person's card takes the key itself (it closes, the panel stays)
      if (document.querySelector('[data-chat-card]')) return
      e.preventDefault()
      escRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const startPress = (k: string) => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => setActionsFor(k), 450)
  }
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  useEffect(() => () => endPress(), [])

  // the tabs: Everyone, then each server; arrows move between them
  const tabIds = [EVERYONE, ...on.map((r) => r.id)]
  const shownTab = view ? view.id : EVERYONE
  const selectTab = (id: string) => { setEditing(null); setActionsFor(null); useChatStore.getState().setTab(id) }
  const onTabKey = (e: ReactKeyboardEvent) => {
    const i = tabIds.indexOf(shownTab)
    let next: string
    switch (e.key) {
      case 'ArrowRight': next = tabIds[(i + 1) % tabIds.length]; break
      case 'ArrowLeft': next = tabIds[(i - 1 + tabIds.length) % tabIds.length]; break
      case 'Home': next = tabIds[0]; break
      case 'End': next = tabIds[tabIds.length - 1]; break
      default: return
    }
    e.preventDefault()
    selectTab(next)
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLButtonElement>(`[data-chat-tab="${next}"]`)?.focus())
  }
  const everyoneUnread = on.reduce((n, r) => n + roomUnread(r), 0)

  const now = Date.now() / 1000
  const subtitle = view ? `Everyone signed in to ${view.room?.name || view.name || 'this server'}` : `Every server you are signed in to (${on.length})`
  const clearable = view && view.room?.me.can_moderate ? view : null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Chat"
      data-chat-panel
      className="fixed inset-0 z-[90] flex flex-col bg-slate-950 safe-area-top safe-area-bottom animate-fade-in
        md:inset-auto md:right-8 md:bottom-28 md:w-[380px] md:h-[520px] md:max-h-[calc(100vh-9rem)] md:rounded-2xl md:border md:border-white/10 md:bg-slate-900/95 md:backdrop-blur-xl md:shadow-2xl md:shadow-black/50 md:overflow-hidden"
    >
      {/* header: the room, who is online, the small settings, clear (admin), close */}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2 border-b border-white/5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-200">Chat</h2>
          <p className="text-[11px] text-slate-500 truncate" title={subtitle} data-chat-subtitle>{subtitle}</p>
          {!several && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400" aria-live="polite">
              <span aria-hidden className={`h-2 w-2 rounded-full shrink-0 ${onlineNames.length ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span className="truncate" data-chat-online>{onlineNames.length ? `Online: ${onlineNames.join(', ')}` : 'Nobody else is online'}</span>
            </p>
          )}
        </div>
        <button type="button" aria-label="Chat settings" title="Chat settings" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
          <Settings2 size={15} aria-hidden />
        </button>
        {clearable && (
          <button type="button" aria-label={several ? `Clear the room on ${clearable.name}` : 'Clear the room'} title="Clear the room" onClick={() => void clearRoom(clearable)} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
            <Eraser size={15} aria-hidden />
          </button>
        )}
        <CloseButton label="Close the chat" title="Close (Esc)" onClick={onClose} />
      </div>

      {/* several servers: a tab each and Everyone, then who is online where */}
      {several && (
        <div className="border-b border-white/5 px-3 pt-2 pb-2 space-y-2">
          <div ref={tabsRef} role="tablist" aria-label="Rooms" className="flex gap-1.5 overflow-x-auto scrollbar-thin" onKeyDown={onTabKey}>
            {tabIds.map((id) => {
              const r = id === EVERYONE ? null : rooms[id]
              const n = r ? roomUnread(r) : everyoneUnread
              const sel = id === shownTab
              const label = r ? r.name : 'Everyone'
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  tabIndex={sel ? 0 : -1}
                  data-chat-tab={id}
                  data-chat-live={r && !r.active ? (r.live ? 'on' : 'off') : undefined}
                  title={r ? `The room on ${r.name}${r.active ? ' (the server in use)' : ''}` : 'Every room together, in time order'}
                  aria-label={n > 0 ? `${label}, ${n} unread` : label}
                  onClick={() => selectTab(id)}
                  className={`shrink-0 max-w-[10rem] h-7 px-2.5 rounded-full border text-[11px] flex items-center gap-1.5 transition-colors ${sel ? CHOICE_ON : CHOICE_OFF}`}
                >
                  <span className="truncate">{label}</span>
                  {n > 0 && <Count tone={sel ? 'ok' : 'neutral'} n={n > 99 ? '99+' : n} />}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin" data-chat-friends aria-label="Who is online" role="group">
            <span aria-hidden className={`h-2 w-2 rounded-full shrink-0 ${friends.length ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {friends.length === 0 && <span className="text-[11px] text-slate-500">Nobody else is online</span>}
            {friends.map((f) => (
              <span key={`${f.room}|${f.user}`} className="shrink-0 h-6 pl-0.5 pr-0.5 rounded-full bg-white/5 flex items-center gap-1">
                <PersonButton room={f.room} roomName={f.roomName} user={f.user} url={f.avatar_url} emoji={f.avatar_emoji} size={20} online />
                <button
                  type="button"
                  data-chat-friend={`${f.user}@${f.room}`}
                  onClick={() => selectTab(f.room)}
                  title={`Open the room on ${f.roomName}`}
                  className="h-6 pr-1.5 rounded-full text-[11px] text-slate-300 hover:text-slate-200 transition-colors"
                >
                  {f.user} · {f.active ? 'here' : `on ${f.roomName}`}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="px-4 py-2.5 border-b border-white/5 bg-white/[0.02] space-y-1.5">
          <Switch
            label="Browser notifications"
            description="A notification for a message while the dashboard is in the background (this device)."
            checked={!!notify}
            onChange={(e) => void toggleNotify(e.currentTarget.checked)}
            color="emerald"
            size="sm"
          />
          {notifyNote && <p className="text-[11px] text-amber-300">{notifyNote}</p>}
          <p className="text-[11px] text-slate-500">
            {view
              ? `Kept ${view.room?.retention.days ?? 30} days (at most ${view.room?.retention.max_messages ?? 2000} messages) on ${several ? view.name : 'this server'}. `
              : 'Each server keeps its own room; this view only puts them side by side. '}
            The bubble and the other servers' rooms are in Settings → Chat.
          </p>
        </div>
      )}

      {/* the messages */}
      <div ref={listRef} onScroll={onScroll} role="log" aria-label="Messages" aria-live="polite" className="flex-1 overflow-y-auto scrollbar-thin overscroll-contain px-3 py-2" data-chat-list data-chat-view={viewKey}>
        {view?.hasMore && (
          <div className="flex justify-center py-1.5">
            <button type="button" onClick={() => void useChatStore.getState().loadEarlier(view.id)} disabled={view.loadingEarlier} className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1.5 disabled:opacity-50">
              {view.loadingEarlier && <Loader2 size={12} className="animate-spin" aria-hidden />} Show earlier messages
            </button>
          </div>
        )}
        {groups.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-1">
            <p className="text-sm text-slate-300">No messages yet</p>
            <p className="text-xs text-slate-500">{everyone ? 'Say hello on any of your servers.' : 'Say hello to everyone on this server.'}</p>
            {view?.room?.cleared_by && <p className="text-[11px] text-slate-600 mt-1">{view.room.cleared_by} cleared the room.</p>}
          </div>
        )}
        {groups.map((g, gi) => {
          const r = rooms[g.room]
          const me = meOf(g.room)
          const roomCanPost = !!r?.room?.me.can_post
          const roomAdmin = !!r?.room?.me.can_moderate
          const editWindow = r?.room?.edit_window ?? 900
          return (
            <Fragment key={g.key}>
              {(gi === 0 || groups[gi - 1].day !== g.day) && (
                <div className="flex items-center gap-2 my-2" role="separator" aria-label={g.day}>
                  <span className="h-px flex-1 bg-white/5" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{g.day}</span>
                  <span className="h-px flex-1 bg-white/5" />
                </div>
              )}
              <div className="flex gap-2.5 py-1.5" data-chat-group={g.user} data-chat-room={g.room}>
                <PersonButton
                  room={g.room}
                  roomName={r?.name ?? ''}
                  user={g.user}
                  url={pictures.get(g.room)?.get(g.user)?.url}
                  emoji={pictures.get(g.room)?.get(g.user)?.emoji}
                  online={!!r?.online.some((p) => p.user === g.user)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-slate-200 truncate">{g.user}{g.user === me ? ' (you)' : ''}</span>
                    {g.role === 'admin' && <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300">admin</span>}
                    {everyone && r && (
                      <span data-chat-server={r.id} className="self-center min-w-0 max-w-[8rem] flex"><Pill size="xs" title={`Sent on ${r.name}`} className="max-w-full truncate">{r.name}</Pill></span>
                    )}
                    <time className="text-[10px] text-slate-500 tabular-nums shrink-0" dateTime={new Date(g.ts * 1000).toISOString()}>{timeOf(g.ts, h24)}</time>
                  </div>
                  {g.items.map((m) => {
                    const k = `${g.room}:${m.id}`
                    const mine = m.user === me
                    const canEdit = mine && roomCanPost && !m.deleted && now - m.ts <= editWindow
                    const canDelete = !m.deleted && (mine || roomAdmin)
                    const isEditing = editing?.room === g.room && editing.id === m.id
                    const showActions = actionsFor === k
                    return (
                      <div
                        key={m.id}
                        data-chat-message={m.id}
                        className="group relative -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-white/[0.03]"
                        onTouchStart={() => (canEdit || canDelete) && startPress(k)}
                        onTouchEnd={endPress}
                        onTouchMove={endPress}
                        onContextMenu={(e) => { if (canEdit || canDelete) { e.preventDefault(); setActionsFor(k) } }}
                      >
                        {m.deleted ? (
                          <p className="text-xs italic text-slate-500">{m.deleted_by && m.deleted_by !== m.user ? `Message removed by ${m.deleted_by}` : 'Message deleted'}</p>
                        ) : isEditing ? (
                          <div className="space-y-1">
                            <textarea
                              autoFocus
                              aria-label="Edit your message"
                              value={editing.text}
                              maxLength={r?.room?.max_length ?? 2000}
                              rows={Math.min(5, Math.max(1, editing.text.split('\n').length))}
                              onChange={(e) => setEditing({ room: g.room, id: m.id, text: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void saveEdit() } }}
                              className="w-full resize-none rounded-md bg-white/5 border border-white/10 px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50"
                            />
                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                              <button type="button" onClick={() => void saveEdit()} className="flex items-center gap-1 text-emerald-300 hover:text-emerald-400"><Check size={11} aria-hidden /> Save</button>
                              <button type="button" onClick={() => setEditing(null)} className="hover:text-slate-300">Cancel</button>
                              <span>Enter saves, Esc cancels</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words pr-14" data-chat-text>
                            {m.text}
                            {m.edited ? <span className="ml-1 text-[10px] text-slate-500" title={`Edited ${timeOf(m.edited, h24)}`}>(edited)</span> : null}
                          </p>
                        )}
                        {!isEditing && (canEdit || canDelete) && (
                          <div className={`absolute top-0 right-0 flex items-center gap-0.5 rounded-md bg-slate-900 border border-white/10 p-0.5 shadow-lg transition-opacity ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'}`}>
                            {canEdit && (
                              <button type="button" aria-label="Edit message" title="Edit (for 15 minutes)" onClick={() => { setActionsFor(null); setEditing({ room: g.room, id: m.id, text: m.text }) }} className="h-6 w-6 rounded flex items-center justify-center text-slate-300 hover:bg-white/10">
                                <Pencil size={12} aria-hidden />
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" aria-label={mine ? 'Delete message' : `Delete ${m.user}'s message`} title="Delete" onClick={() => void remove(g.room, m)} className="h-6 w-6 rounded flex items-center justify-center text-rose-300 hover:bg-rose-500/10">
                                <Trash2 size={12} aria-hidden />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      {/* who is typing, the error, where it goes (Everyone), the field */}
      <div className="px-3 pb-3 pt-1.5 border-t border-white/5">
        <p className="h-4 text-[11px] text-slate-500 truncate" aria-live="polite">
          {typingNames.length ? `${names(typingNames)} ${typingNames.length === 1 ? 'is' : 'are'} typing…` : ''}
        </p>
        {error && <p role="alert" className="text-[11px] text-rose-400 mb-1">{error}</p>}
        {everyone && writable.length > 1 && target && (
          <label className="flex items-center gap-2 mb-1.5 text-[11px] text-slate-500">
            <span className="shrink-0">Post to</span>
            <select
              data-chat-post-to
              value={target.id}
              onChange={(e) => useChatStore.getState().setPostTo(e.target.value)}
              className="min-w-0 flex-1 h-7 rounded-md bg-white/5 border border-white/10 px-2 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500/50"
            >
              {writable.map((r) => <option key={r.id} value={r.id}>{r.name}{r.active ? ' (in use)' : ''}</option>)}
            </select>
          </label>
        )}
        {canPost && target ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label={several ? `Message to ${target.name}` : 'Message'}
              placeholder={several ? `Message everyone on ${target.name}` : 'Message everyone on this server'}
              value={draft}
              maxLength={maxLen}
              rows={Math.min(5, Math.max(1, draft.split('\n').length))}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
              className="flex-1 resize-none rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 scrollbar-thin"
            />
            <button
              type="button"
              aria-label="Send"
              title="Send (Enter)"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="h-9 w-9 shrink-0 rounded-xl flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              {sending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-2">
            {everyone ? 'Every room here is read-only for your accounts.' : `This room is read-only for your account on ${several && view ? view.name : 'this server'}.`}
          </p>
        )}
        {canPost && draft.length > maxLen - 200 && (
          <p className="mt-1 text-[10px] text-slate-500 text-right tabular-nums">{draft.length} / {maxLen}</p>
        )}
        {canPost && <p className="mt-1 text-[10px] text-slate-600 hidden md:block">Enter sends · Shift+Enter for a new line</p>}
      </div>
    </div>
  )
}
