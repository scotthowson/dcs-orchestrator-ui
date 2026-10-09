// =============================================================================
// ChatPanel — the room opened from the bubble: 380 × 520 above it on a
// computer, the whole screen on a phone. Messages grouped by person and minute
// (a day line between days), who is online, who is typing; Enter sends,
// Shift+Enter starts a new line. One's own messages: edit (15 minutes) and
// delete, on hover or focus, or a long press on a touch screen; an admin
// deletes any and may clear the room. Escape closes (or ends an edit), Tab
// stays inside. A small settings row turns browser notifications on.
// =============================================================================

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Switch } from '@mantine/core'
import { Check, Loader2, Pencil, Send, Settings2, Trash2, Eraser } from 'lucide-react'
import { useChatStore, chatErrorText } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useModalA11y } from '../../hooks/useModalA11y'
import { useConfirm } from '../common/ConfirmDialog'
import { sendChatTyping } from '../../api/chat'
import { BTN_ICON_SM, TONE_GHOST, TONE_GHOST_DANGER } from '../../lib/ui'
import type { ChatMessage } from '../../../shared/types'

import CloseButton from '../common/CloseButton'
interface Group { key: string; user: string; role: string; ts: number; day: string; items: ChatMessage[] }

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

/** consecutive messages of one person within the same minute share a header */
function groupMessages(list: ChatMessage[]): Group[] {
  const out: Group[] = []
  for (const m of list) {
    const day = dayOf(m.ts)
    const last = out[out.length - 1]
    if (last && last.user === m.user && last.day === day && Math.floor(last.items[last.items.length - 1].ts / 60) === Math.floor(m.ts / 60)) {
      last.items.push(m)
    } else {
      out.push({ key: `g${m.id}`, user: m.user, role: m.role, ts: m.ts, day, items: [m] })
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
  const confirm = useConfirm()

  const messages = useChatStore((s) => s.messages)
  const room = useChatStore((s) => s.room)
  const online = useChatStore((s) => s.online)
  const typing = useChatStore((s) => s.typing)
  const hasMore = useChatStore((s) => s.hasMore)
  const loadingEarlier = useChatStore((s) => s.loadingEarlier)
  const h24 = useSettingsStore((s) => s.use24hClock) !== false
  const notify = useSettingsStore((s) => s.chatNotify)
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  const me = room?.me.user ?? ''
  const canPost = !!room?.me.can_post
  const isAdmin = !!room?.me.can_moderate
  const maxLen = room?.max_length ?? 2000
  const editWindow = room?.edit_window ?? 900

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [actionsFor, setActionsFor] = useState<number | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [notifyNote, setNotifyNote] = useState<string | null>(null)
  const typingSentAt = useRef(0)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Escape ends an edit first, then closes the panel (handled below, not by the hook)
  useModalA11y(ref, onClose, { closeOnEscape: false, initialFocus: inputRef })

  const groups = useMemo(() => groupMessages(messages), [messages])

  // stay at the bottom when something arrives and the list was at the bottom (or it is ours); keep the place when older ones load
  const atBottom = useRef(true)
  const prevFirst = useRef<number | null>(null)
  const prevHeight = useRef(0)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const first = messages[0]?.id ?? null
    if (prevFirst.current !== null && first !== null && first < prevFirst.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current + el.scrollTop
    } else if (atBottom.current || messages[messages.length - 1]?.user === me) {
      el.scrollTop = el.scrollHeight
    }
    prevFirst.current = first
    prevHeight.current = el.scrollHeight
  }, [messages, me])
  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    prevHeight.current = el.scrollHeight
  }

  const othersTyping = Object.keys(typing).filter((u) => u !== me)
  const onlineNames = [...online].sort((a, b) => a.user.localeCompare(b.user)).map((p) => (p.user === me ? `${p.user} (you)` : p.user))

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    if (text.length > maxLen) { setError(`A message is at most ${maxLen} characters.`); return }
    setSending(true); setError(null)
    try {
      await useChatStore.getState().send(text)
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
    if (v.trim() && canPost && Date.now() - typingSentAt.current > 3000) {
      typingSentAt.current = Date.now()
      sendChatTyping().catch(() => {})
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) { setError('A message cannot be empty: delete it instead.'); return }
    try {
      await useChatStore.getState().edit(editing.id, text)
      setEditing(null); setError(null)
      inputRef.current?.focus()
    } catch (err) {
      setError(chatErrorText(err))
    }
  }

  const remove = async (m: ChatMessage) => {
    const mine = m.user === me
    const ok = await confirm({
      title: mine ? 'Delete your message?' : `Delete ${m.user}'s message?`,
      message: mine ? 'It is removed for everyone. The room shows that a message was deleted.' : 'It is removed for everyone, and the audit log records that you removed it (without its text).',
      confirmLabel: 'Delete message',
      danger: true,
    })
    if (!ok) return
    try { await useChatStore.getState().remove(m.id); setActionsFor(null) } catch (err) { setError(chatErrorText(err)) }
    inputRef.current?.focus()
  }

  const clearRoom = async () => {
    const ok = await confirm({
      title: 'Clear the room?',
      message: 'Every message goes, for everyone on this server. The audit log records that you cleared it.',
      confirmLabel: 'Clear the room',
      danger: true,
    })
    if (!ok) return
    try { await useChatStore.getState().clear(); setError(null) } catch (err) { setError(chatErrorText(err)) }
  }

  const toggleNotify = async (on: boolean) => {
    setNotifyNote(null)
    if (!on) { updateSetting('chatNotify', false); return }
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
      e.preventDefault()
      escRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const startPress = (id: number) => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = setTimeout(() => setActionsFor(id), 450)
  }
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  useEffect(() => () => endPress(), [])

  const now = Date.now() / 1000

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
          <p className="text-[11px] text-slate-500 truncate" title={room?.name}>Everyone signed in to {room?.name || 'this server'}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400" aria-live="polite">
            <span aria-hidden className={`h-2 w-2 rounded-full shrink-0 ${onlineNames.length ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className="truncate" data-chat-online>{onlineNames.length ? `Online: ${onlineNames.join(', ')}` : 'Nobody else is online'}</span>
          </p>
        </div>
        <button type="button" aria-label="Chat settings" title="Chat settings" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
          <Settings2 size={15} aria-hidden />
        </button>
        {isAdmin && (
          <button type="button" aria-label="Clear the room" title="Clear the room" onClick={() => void clearRoom()} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
            <Eraser size={15} aria-hidden />
          </button>
        )}
        <CloseButton label="Close the chat" title="Close (Esc)" onClick={onClose} />
      </div>

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
            Kept {room?.retention.days ?? 30} days (at most {room?.retention.max_messages ?? 2000} messages). The bubble itself is in Settings → Chat.
          </p>
        </div>
      )}

      {/* the messages */}
      <div ref={listRef} onScroll={onScroll} role="log" aria-label="Messages" aria-live="polite" className="flex-1 overflow-y-auto scrollbar-thin overscroll-contain px-3 py-2" data-chat-list>
        {hasMore && (
          <div className="flex justify-center py-1.5">
            <button type="button" onClick={() => void useChatStore.getState().loadEarlier()} disabled={loadingEarlier} className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1.5 disabled:opacity-50">
              {loadingEarlier && <Loader2 size={12} className="animate-spin" aria-hidden />} Show earlier messages
            </button>
          </div>
        )}
        {groups.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-1">
            <p className="text-sm text-slate-300">No messages yet</p>
            <p className="text-xs text-slate-500">Say hello to everyone on this server.</p>
            {room?.cleared_by && <p className="text-[11px] text-slate-600 mt-1">{room.cleared_by} cleared the room.</p>}
          </div>
        )}
        {groups.map((g, gi) => (
          <Fragment key={g.key}>
            {(gi === 0 || groups[gi - 1].day !== g.day) && (
              <div className="flex items-center gap-2 my-2" role="separator" aria-label={g.day}>
                <span className="h-px flex-1 bg-white/5" />
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{g.day}</span>
                <span className="h-px flex-1 bg-white/5" />
              </div>
            )}
            <div className="flex gap-2.5 py-1.5" data-chat-group={g.user}>
              <div aria-hidden className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold uppercase ${g.user === me ? 'accent-bg-subtle accent-text' : 'bg-white/5 text-slate-300'}`}>
                {g.user.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold text-slate-200 truncate">{g.user}{g.user === me ? ' (you)' : ''}</span>
                  {g.role === 'admin' && <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-300">admin</span>}
                  <time className="text-[10px] text-slate-500 tabular-nums" dateTime={new Date(g.ts * 1000).toISOString()}>{timeOf(g.ts, h24)}</time>
                </div>
                {g.items.map((m) => {
                  const mine = m.user === me
                  const canEdit = mine && canPost && !m.deleted && now - m.ts <= editWindow
                  const canDelete = !m.deleted && (mine || isAdmin)
                  const isEditing = editing?.id === m.id
                  const showActions = actionsFor === m.id
                  return (
                    <div
                      key={m.id}
                      data-chat-message={m.id}
                      className="group relative -mx-1.5 px-1.5 py-0.5 rounded-md hover:bg-white/[0.03]"
                      onTouchStart={() => (canEdit || canDelete) && startPress(m.id)}
                      onTouchEnd={endPress}
                      onTouchMove={endPress}
                      onContextMenu={(e) => { if (canEdit || canDelete) { e.preventDefault(); setActionsFor(m.id) } }}
                    >
                      {m.deleted ? (
                        <p className="text-xs italic text-slate-500">{m.deleted_by && m.deleted_by !== m.user ? `Message removed by ${m.deleted_by}` : 'Message deleted'}</p>
                      ) : isEditing ? (
                        <div className="space-y-1">
                          <textarea
                            autoFocus
                            aria-label="Edit your message"
                            value={editing.text}
                            maxLength={maxLen}
                            rows={Math.min(5, Math.max(1, editing.text.split('\n').length))}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
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
                            <button type="button" aria-label="Edit message" title="Edit (for 15 minutes)" onClick={() => { setActionsFor(null); setEditing({ id: m.id, text: m.text }) }} className="h-6 w-6 rounded flex items-center justify-center text-slate-300 hover:bg-white/10">
                              <Pencil size={12} aria-hidden />
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" aria-label={mine ? 'Delete message' : `Delete ${m.user}'s message`} title="Delete" onClick={() => void remove(m)} className="h-6 w-6 rounded flex items-center justify-center text-rose-300 hover:bg-rose-500/10">
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
        ))}
      </div>

      {/* who is typing, the error, the field */}
      <div className="px-3 pb-3 pt-1.5 border-t border-white/5">
        <p className="h-4 text-[11px] text-slate-500 truncate" aria-live="polite">
          {othersTyping.length ? `${names(othersTyping)} ${othersTyping.length === 1 ? 'is' : 'are'} typing…` : ''}
        </p>
        {error && <p role="alert" className="text-[11px] text-rose-400 mb-1">{error}</p>}
        {canPost ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label="Message"
              placeholder="Message everyone on this server"
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
          <p className="text-xs text-slate-500 py-2">This room is read-only for your account on this server.</p>
        )}
        {canPost && draft.length > maxLen - 200 && (
          <p className="mt-1 text-[10px] text-slate-500 text-right tabular-nums">{draft.length} / {maxLen}</p>
        )}
        {canPost && <p className="mt-1 text-[10px] text-slate-600 hidden md:block">Enter sends · Shift+Enter for a new line</p>}
      </div>
    </div>
  )
}
