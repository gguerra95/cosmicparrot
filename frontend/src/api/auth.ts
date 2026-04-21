import { api } from './client'

export const authApi = {
  register: (email: string, username: string, password: string) =>
    api.post('/auth/register', { email, username, password }).then(r => r.data),

  login: (identifier: string, password: string) =>
    api.post('/auth/login', { identifier, password }).then(r => r.data),

  logout: () => api.post('/auth/logout').then(r => r.data),

  me: () => api.get('/users/me').then(r => r.data),

  sessions: () => api.get('/auth/sessions').then(r => r.data),

  revokeSession: (id: string) => api.delete(`/auth/sessions/${id}`).then(r => r.data),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }).then(r => r.data),

  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, newPassword }).then(r => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data),

  deleteAccount: (password: string) =>
    api.delete('/auth/account', { data: { password } }).then(r => r.data),
}
