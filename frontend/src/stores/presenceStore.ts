import { create } from 'zustand'
import type { PresenceStatus } from '../types'

interface PresenceState {
  statuses: Record<string, PresenceStatus>
  setStatus: (userId: string, status: PresenceStatus) => void
  getStatus: (userId: string) => PresenceStatus
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  statuses: {},
  setStatus: (userId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [userId]: status } })),
  getStatus: (userId) => get().statuses[userId] ?? 'offline',
}))
