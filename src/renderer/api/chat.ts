// =============================================================================
// Chat API — a server's room (one per DCS server, everyone signed in to it).
// Always the server itself, never a fleet VM: a VM's room is its hub's.
// A 404 with reason "chat_off" means the room is switched off; "chat_on_hub"
// a VM of a fleet; a 404 without a reason an API older than the chat.
//
// Every call takes the client of the server whose room it is: the active
// server's `apiClient` by default, or the client the chat keeps for another
// server the dashboard is signed in to (stores/chatStore, that server's own
// address and session). A room is never read or written with another server's
// session.
// =============================================================================

import { apiClient, type ApiClient } from './client'
import type { ChatMessagesResponse, ChatMessageResponse, ChatPresenceResponse, ChatSummaryResponse, ChatUserProfile } from '../../shared/types'

/** GET /chat/messages — the newest `limit` messages, or those before an id (older) */
export function fetchChatMessages(opts: { limit?: number; before?: number } = {}, client: ApiClient = apiClient): Promise<ChatMessagesResponse> {
  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.before) q.set('before', String(opts.before))
  const qs = q.toString()
  return client.get<ChatMessagesResponse>(`/chat/messages${qs ? `?${qs}` : ''}`)
}

/** GET /chat/summary — the room without its messages (who is online, the newest id); with `after`, how many came since */
export function fetchChatSummary(after: number | null, client: ApiClient = apiClient): Promise<ChatSummaryResponse> {
  return client.get<ChatSummaryResponse>(`/chat/summary${after !== null ? `?after=${after}` : ''}`)
}

/** POST /chat/messages — plain text, 1-2000 characters */
export function sendChatMessage(text: string, client: ApiClient = apiClient): Promise<ChatMessageResponse> {
  return client.post<ChatMessageResponse>('/chat/messages', { text })
}

/** PUT /chat/messages/{id} — one's own message, within 15 minutes */
export function editChatMessage(id: number, text: string, client: ApiClient = apiClient): Promise<ChatMessageResponse> {
  return client.put<ChatMessageResponse>(`/chat/messages/${id}`, { text })
}

/** DELETE /chat/messages/{id} — one's own, or any as an admin */
export function deleteChatMessage(id: number, client: ApiClient = apiClient): Promise<ChatMessageResponse> {
  return client.delete<ChatMessageResponse>(`/chat/messages/${id}`)
}

/** DELETE /chat/messages — every message goes (admin) */
export function clearChatRoom(client: ApiClient = apiClient): Promise<{ success: boolean; removed: number }> {
  return client.delete<{ success: boolean; removed: number }>('/chat/messages')
}

/** GET /chat/presence — who has a dashboard open on this server now (also marks the caller as here) */
export function fetchChatPresence(client: ApiClient = apiClient): Promise<ChatPresenceResponse> {
  return client.get<ChatPresenceResponse>('/chat/presence')
}

/** GET /users/{name}/profile — what a person shows the others (picture, display name, status, bio; an API before 4.0.48: 404) */
export function fetchUserProfile(user: string, client: ApiClient = apiClient): Promise<ChatUserProfile> {
  return client.get<ChatUserProfile>(`/users/${encodeURIComponent(user)}/profile`)
}

/** POST /chat/typing — the caller is typing (the server sends it on at most every 3 s) */
export function sendChatTyping(client: ApiClient = apiClient): Promise<{ ok: boolean; sent: boolean }> {
  return client.post<{ ok: boolean; sent: boolean }>('/chat/typing')
}
