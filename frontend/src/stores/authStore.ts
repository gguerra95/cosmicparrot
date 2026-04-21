import { create } from 'zustand'

interface AuthUser {
  id: string
  username: string
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  bootstrapped: boolean
  setAuth: (user: AuthUser, token: string) => void
  setToken: (token: string) => void
  clearAuth: () => void
  setBootstrapped: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  bootstrapped: false,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setToken: (accessToken) => set({ accessToken }),
  clearAuth: () => set({ user: null, accessToken: null }),
  setBootstrapped: () => set({ bootstrapped: true }),
}))
