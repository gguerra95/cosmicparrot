import { api } from './client'

export const roomsApi = {
  list: (search?: string, page?: number, my?: boolean) =>
    api.get('/rooms', { params: { search, page, my: my ? 'true' : undefined } }).then(r => r.data),

  get: (id: string) => api.get(`/rooms/${id}`).then(r => r.data),

  create: (name: string, description: string, is_private: boolean) =>
    api.post('/rooms', { name, description, is_private }).then(r => r.data),

  update: (id: string, data: { name?: string; description?: string; is_private?: boolean }) =>
    api.patch(`/rooms/${id}`, data).then(r => r.data),

  delete: (id: string) => api.delete(`/rooms/${id}`).then(r => r.data),

  members: (id: string) => api.get(`/rooms/${id}/members`).then(r => r.data),

  join: (id: string) => api.post(`/rooms/${id}/join`).then(r => r.data),

  leave: (id: string) => api.post(`/rooms/${id}/leave`).then(r => r.data),

  invite: (id: string, username: string) =>
    api.post(`/rooms/${id}/invite`, { username }).then(r => r.data),

  invitations: (id: string) => api.get(`/rooms/${id}/invitations`).then(r => r.data),

  acceptInvitation: (roomId: string, invId: string) =>
    api.post(`/rooms/${roomId}/invitations/${invId}/accept`).then(r => r.data),

  declineInvitation: (roomId: string, invId: string) =>
    api.post(`/rooms/${roomId}/invitations/${invId}/decline`).then(r => r.data),

  pendingInvitations: () => api.get('/rooms/invitations/pending').then(r => r.data),

  ban: (roomId: string, userId: string) =>
    api.post(`/rooms/${roomId}/ban/${userId}`).then(r => r.data),

  unban: (roomId: string, userId: string) =>
    api.delete(`/rooms/${roomId}/ban/${userId}`).then(r => r.data),

  bans: (roomId: string) => api.get(`/rooms/${roomId}/bans`).then(r => r.data),

  setRole: (roomId: string, userId: string, role: 'admin' | 'member') =>
    api.patch(`/rooms/${roomId}/members/${userId}`, { role }).then(r => r.data),

  removeMember: (roomId: string, userId: string) =>
    api.delete(`/rooms/${roomId}/members/${userId}`).then(r => r.data),

  myRooms: () =>
    api.get('/rooms', { params: { my: true } }).then(r => r.data),
}
