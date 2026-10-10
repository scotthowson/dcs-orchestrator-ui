// =============================================================================
// ChatPerson — a person in the chat: their picture (ChatAvatar: the one they
// uploaded in Settings → Profile, fetched from the server whose room it is with
// that server's session; else their emoji; else their initial on a colour that
// is always the same for the same name) and, pressed, a small card (PersonCard,
// the kit's Mantine popover): picture, name, server, online or not, status and
// bio — fetched on demand from that server (GET /users/{name}/profile). All of it
// plain text. Esc or a press outside closes the card; it is reachable with Tab
// and gives the focus back to the picture.
// =============================================================================

import { useEffect, useState } from 'react'
import { Popover } from '@mantine/core'
import { Loader2 } from 'lucide-react'
import { chatPictureSrc, chatPersonCard } from '../../stores/chatStore'
import { Dot, Pill } from '../common/Pill'
import type { ChatUserProfile } from '../../../shared/types'

/** the initial's colours: one per name, the same everywhere (identity, not status: no amber or rose) */
const HUES = ['bg-emerald-500/15 text-emerald-300', 'bg-cyan-500/15 text-cyan-300', 'bg-violet-500/15 text-violet-300', 'bg-slate-500/15 text-slate-300']
function hueOf(user: string): string {
  let h = 0
  for (let i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

/** the picture's address on the page (an object URL), or null while there is none */
function usePicture(room: string, url?: string): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    setSrc(null)
    if (!url) return
    let gone = false
    void chatPictureSrc(room, url).then((u) => { if (!gone) setSrc(u) })
    return () => { gone = true }
  }, [room, url])
  return src
}

export function ChatAvatar({ room, user, url, emoji, size = 28 }: { room: string; user: string; url?: string; emoji?: string; size?: number }) {
  const src = usePicture(room, url)
  const box = { width: size, height: size }
  if (src) return <img src={src} alt="" aria-hidden style={box} className="shrink-0 rounded-full object-cover" data-chat-avatar="picture" />
  if (emoji) return <span aria-hidden style={{ ...box, fontSize: size * 0.55 }} className="shrink-0 rounded-full bg-white/5 flex items-center justify-center leading-none" data-chat-avatar="emoji">{emoji}</span>
  return (
    <span aria-hidden style={{ ...box, fontSize: Math.max(9, size * 0.42) }} className={`shrink-0 rounded-full flex items-center justify-center font-semibold uppercase ${hueOf(user)}`} data-chat-avatar="initial">
      {user.slice(0, 1)}
    </span>
  )
}

/** a person's picture as a button: pressed, their card */
export function PersonButton({ room, roomName, user, url, emoji, size = 28, online }: {
  room: string; roomName: string; user: string; url?: string; emoji?: string; size?: number; online?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<ChatUserProfile | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!open) return
    let gone = false
    setFailed(false)
    chatPersonCard(room, user).then((c) => { if (!gone) setCard(c) }).catch(() => { if (!gone) setFailed(true) })
    return () => { gone = true }
  }, [open, room, user])

  const isOnline = card ? card.online : !!online
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withinPortal={false} trapFocus returnFocus closeOnEscape shadow="md" width={260} offset={6}>
      <Popover.Target>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${user}'s profile`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-chat-person={`${user}@${room}`}
          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <ChatAvatar room={room} user={user} url={card?.avatar_url ?? url} emoji={card?.avatar_emoji ?? emoji} size={size} />
        </button>
      </Popover.Target>
      <Popover.Dropdown p={12} data-chat-card={`${user}@${room}`} role="dialog" aria-label={`${user}'s profile`}>
        <div className="flex items-start gap-3">
          <ChatAvatar room={room} user={user} url={card?.avatar_url ?? url} emoji={card?.avatar_emoji ?? emoji} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-200 truncate" data-chat-card-name>{card?.display_name || user}</p>
            {card?.display_name && card.display_name !== user && <p className="text-[11px] text-slate-500 truncate">{user}</p>}
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <Pill size="xs" title={`An account on ${roomName}`}>{roomName}</Pill>
              {card?.role === 'admin' && <Pill size="xs" tone="attention">admin</Pill>}
            </div>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400" data-chat-card-online>
          <Dot tone={isOnline ? 'ok' : 'neutral'} />
          {isOnline ? `Online on ${roomName}` : 'Not online'}
        </p>
        {!card && !failed && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><Loader2 size={12} className="animate-spin" aria-hidden /> Reading the profile…</p>}
        {failed && <p className="mt-2 text-[11px] text-slate-500">{roomName} did not say more about {user}.</p>}
        {card?.status && (
          <p className="mt-2 text-xs text-slate-300 break-words" data-chat-card-status>{card.status_emoji ? `${card.status_emoji} ` : ''}{card.status}</p>
        )}
        {card?.bio && <p className="mt-2 text-xs text-slate-400 whitespace-pre-wrap break-words" data-chat-card-bio>{card.bio}</p>}
        {card && !card.status && !card.bio && <p className="mt-2 text-[11px] text-slate-500">No status or bio yet.</p>}
      </Popover.Dropdown>
    </Popover>
  )
}
