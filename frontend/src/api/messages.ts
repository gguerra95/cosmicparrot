import { api } from './client'

export const messagesApi = {
  list: (roomId: string, before?: string) =>
    api.get(`/rooms/${roomId}/messages`, { params: { before, limit: 50 } }).then(r => r.data),

  send: (roomId: string, content: string, replyToId?: string) =>
    api.post(`/rooms/${roomId}/messages`, { content, replyToId }).then(r => r.data),

  edit: (id: string, content: string) =>
    api.patch(`/messages/${id}`, { content }).then(r => r.data),

  delete: (id: string) => api.delete(`/messages/${id}`).then(r => r.data),

  markRead: (roomId: string) => api.post(`/rooms/${roomId}/mark-read`).then(r => r.data),

  // DM messages
  dmList: (channelId: string, before?: string) =>
    api.get(`/dm/${channelId}/messages`, { params: { before } }).then(r => r.data),

  dmSend: (channelId: string, content: string, replyToId?: string) =>
    api.post(`/dm/${channelId}/messages`, { content, replyToId }).then(r => r.data),

  dmEdit: (channelId: string, id: string, content: string) =>
    api.patch(`/dm/${channelId}/messages/${id}`, { content }).then(r => r.data),

  dmDelete: (channelId: string, id: string) =>
    api.delete(`/dm/${channelId}/messages/${id}`).then(r => r.data),

  dmMarkRead: (channelId: string) => api.post(`/dm/${channelId}/mark-read`).then(r => r.data),
}
