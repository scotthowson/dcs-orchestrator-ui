// =============================================================================
// chatStream — the live feed of another server's chat room: GET /stream?only=chat
// on THAT server, with the session that server issued (in the Authorization
// header, never in the address). The active server's room rides on the app's
// own stream (lib/sse); this one is opened by the chat (stores/chatStore) for
// each other server the dashboard is signed in to, only while the dashboard is
// shown, and closed when it hides or leaves. It carries the room's events and a
// heartbeat, nothing else (an API before 4.0.48 ignores only=chat and sends its
// Docker events and metrics too: they are skipped here). It reconnects with a
// backoff; a refused session (401/403) ends it for good.
// =============================================================================

import type { ChatLiveEvent } from '../../shared/types'

export interface ChatStreamHandlers {
  onEvent: (ev: ChatLiveEvent) => void
  /** the stream opened (true) or dropped (false) */
  onStatus: (open: boolean) => void
  /** the server refused the session: the stream is not opened again */
  onRefused: () => void
}

/** open the room's stream of `baseUrl` with `token`; returns the close */
export function openChatStream(baseUrl: string, token: string, h: ChatStreamHandlers): () => void {
  const url = `${baseUrl.replace(/\/$/, '')}/stream?only=chat`
  let abort: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let attempts = 0
  let open = false
  const setOpen = (v: boolean) => { if (v !== open) { open = v; try { h.onStatus(v) } catch { /* a listener's trouble */ } } }

  const read = async () => {
    const mine = new AbortController()
    abort = mine
    let refused = false
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: mine.signal,
      })
      if (!res.ok || !res.body) {
        refused = res.status === 401 || res.status === 403
        throw new Error(`stream answered ${res.status}`)
      }
      attempts = 0
      setOpen(true)
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let event = 'message'
      let data: string[] = []
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let nl: number
        while ((nl = buffer.search(/\r\n|\n|\r/)) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + (buffer.startsWith('\r\n', nl) ? 2 : 1))
          if (line === '') {
            if (event === 'chat' && data.length) {
              try {
                const ev = JSON.parse(data.join('\n'))
                if (ev && typeof ev === 'object' && typeof ev.type === 'string') h.onEvent(ev as ChatLiveEvent)
              } catch { /* not JSON */ }
            }
            event = 'message'
            data = []
          } else if (!line.startsWith(':')) {
            const colon = line.indexOf(':')
            const field = colon < 0 ? line : line.slice(0, colon)
            const v = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
            if (field === 'event') event = v
            else if (field === 'data') data.push(v)
          }
        }
      }
    } catch {
      // closed by us, refused, or the connection dropped
    }
    if (closed || abort !== mine) return
    abort = null
    setOpen(false)
    if (refused) { closed = true; h.onRefused(); return }
    if (attempts >= 20) return
    const delay = Math.min(2000 * Math.pow(2, Math.min(attempts, 4)), 30000)
    attempts++
    timer = setTimeout(() => { timer = null; if (!closed) void read() }, delay)
  }

  void read()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    timer = null
    const a = abort
    abort = null
    a?.abort()
    setOpen(false)
  }
}
