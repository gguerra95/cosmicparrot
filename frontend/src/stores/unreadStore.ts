import { create } from 'zustand'

interface UnreadState {
  rooms: Record<string, number>
  dms: Record<string, number>
  setRoomUnread: (roomId: string, count: number) => void
  incRoomUnread: (roomId: string) => void
  setDmUnread: (channelId: string, count: number) => void
  incDmUnread: (channelId: string) => void
}

export const useUnreadStore = create<UnreadState>((set) => ({
  rooms: {},
  dms: {},
  setRoomUnread: (roomId, count) =>
    set((s) => ({ rooms: { ...s.rooms, [roomId]: count } })),
  incRoomUnread: (roomId) =>
    set((s) => ({ rooms: { ...s.rooms, [roomId]: (s.rooms[roomId] ?? 0) + 1 } })),
  setDmUnread: (channelId, count) =>
    set((s) => ({ dms: { ...s.dms, [channelId]: count } })),
  incDmUnread: (channelId) =>
    set((s) => ({ dms: { ...s.dms, [channelId]: (s.dms[channelId] ?? 0) + 1 } })),
}))
