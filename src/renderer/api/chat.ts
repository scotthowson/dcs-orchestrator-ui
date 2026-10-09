// =============================================================================
// Chat API — the server's room (one per DCS server, everyone signed in to it).
// Always the server itself, never a fleet VM: a VM's room is its hub's.
// A 404 with reason "chat_off" means the room is switched off; "chat_on_hub"
// a VM of a fleet; a 404 without a reason an API older than the chat.
// =============================================================================

import { apiClient } from './client'
import type { ChatMessagesResponse, ChatMessageResponse, ChatPresenceResponse } from '../../shared/types'

/** GET /chat/messages — the newest `limit` messages, or those before an id (older) */
export function fetchChatMessages(opts: { limit?: number; before?: number } = {}): Promise<ChatMessagesResponse> {
  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.before) q.set('before', String(opts.before))
  const qs = q.toString()
  return apiClient.get<ChatMessagesResponse>(`/chat/messages${qs ? `?${qs}` : ''}`)
}

/** POST /chat/messages — plain text, 1-2000 characters */
export function sendChatMessage(text: string): Promise<ChatMessageResponse> {
  return apiClient.post<ChatMessageResponse>('/chat/messages', { text })
}

/** PUT /chat/messages/{id} — one's own message, within 15 minutes */
export function editChatMessage(id: number, text: string): Promise<ChatMessageResponse> {
  return apiClient.put<ChatMessageResponse>(`/chat/messages/${id}`, { text })
}

/** DELETE /chat/messages/{id} — one's own, or any as an admin */
export function deleteChatMessage(id: number): Promise<ChatMessageResponse> {
  return apiClient.delete<ChatMessageResponse>(`/chat/messages/${id}`)
}

/** DELETE /chat/messages — every message goes (admin) */
export function clearChatRoom(): Promise<{ success: boolean; removed: number }> {
  return apiClient.delete<{ success: boolean; removed: number }>('/chat/messages')
}

/** GET /chat/presence — who has a dashboard open on this server now (also marks the caller as here) */
export function fetchChatPresence(): Promise<ChatPresenceResponse> {
  return apiClient.get<ChatPresenceResponse>('/chat/presence')
}

/** POST /chat/typing — the caller is typing (the server sends it on at most every 3 s) */
export function sendChatTyping(): Promise<{ ok: boolean; sent: boolean }> {
  return apiClient.post<{ ok: boolean; sent: boolean }>('/chat/typing')
}
