import { api } from './client'

export const friendsApi = {
  list: () => api.get('/friends').then(r => r.data),

  sendRequest: (username: string, message?: string) =>
    api.post('/friends/request', { username, message }).then(r => r.data),

  accept: (id: string) => api.post(`/friends/request/${id}/accept`).then(r => r.data),

  decline: (id: string) => api.post(`/friends/request/${id}/decline`).then(r => r.data),

  remove: (userId: string) => api.delete(`/friends/${userId}`).then(r => r.data),

  ban: (userId: string) => api.post(`/friends/ban/${userId}`).then(r => r.data),

  unban: (userId: string) => api.delete(`/friends/ban/${userId}`).then(r => r.data),

  getUser: (username: string) => api.get(`/users/${username}`).then(r => r.data),

  getUserById: (userId: string) => api.get(`/users/id/${userId}`).then(r => r.data),

  searchUsers: (q: string) => api.get('/users/search', { params: { q } }).then(r => r.data),
}
