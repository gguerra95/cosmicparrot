import { api } from './client'

export const dmApi = {
  list: () => api.get('/dm').then(r => r.data),
  openOrCreate: (userId: string) => api.post(`/dm/${userId}`).then(r => r.data),
}
