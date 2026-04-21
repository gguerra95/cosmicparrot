import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

function parseJwtPayload(token: string): { sub: string; username: string } | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const payload = JSON.parse(atob(padded))
    return { sub: payload.sub, username: payload.username }
  } catch {
    return null
  }
}

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err)
    }
    original._retry = true

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          original.headers.Authorization = `Bearer ${token}`
          resolve(api(original))
        })
      })
    }

    isRefreshing = true
    try {
      const { data } = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true })
      const decoded = parseJwtPayload(data.accessToken)
      if (decoded) {
        useAuthStore.getState().setAuth({ id: decoded.sub, username: decoded.username }, data.accessToken)
      } else {
        useAuthStore.getState().setToken(data.accessToken)
      }
      refreshQueue.forEach((cb) => cb(data.accessToken))
      refreshQueue = []
      original.headers.Authorization = `Bearer ${data.accessToken}`
      return api(original)
    } catch {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
      return Promise.reject(err)
    } finally {
      isRefreshing = false
    }
  }
)
