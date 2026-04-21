import { create } from 'zustand'
import { usePresenceStore } from './presenceStore'
import { useUnreadStore } from './unreadStore'
import type { PresenceStatus } from '../types'

type MessageHandler = (msg: WsMessage) => void
type WsMessage = { type: string; [k: string]: unknown }

interface WsState {
  ws: WebSocket | null
  connected: boolean
  handlers: Set<MessageHandler>
  connect: (token: string) => void
  disconnect: () => void
  send: (msg: object) => void
  addHandler: (fn: MessageHandler) => () => void
}

export const useWsStore = create<WsState>((set, get) => ({
  ws: null,
  connected: false,
  handlers: new Set(),

  connect: (token: string) => {
    const existing = get().ws
    if (existing) existing.close()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`)

    ws.onopen = () => set({ connected: true })
    ws.onclose = () => {
      set({ connected: false, ws: null })
      // reconnect after 3 seconds
      setTimeout(() => {
        const t = token
        if (t) get().connect(t)
      }, 3000)
    }
    ws.onerror = () => ws.close()

    ws.onmessage = (event) => {
      let msg: WsMessage
      try { msg = JSON.parse(event.data) } catch { return }

      // Handle global state updates
      if (msg.type === 'presence_update') {
        usePresenceStore.getState().setStatus(
          msg.userId as string,
          msg.status as PresenceStatus
        )
      }
      if (msg.type === 'unread_update') {
        if (msg.roomId) useUnreadStore.getState().setRoomUnread(msg.roomId as string, msg.count as number)
        if (msg.channelId) useUnreadStore.getState().setDmUnread(msg.channelId as string, msg.count as number)
      }

      // Fan out to component handlers
      get().handlers.forEach((fn) => fn(msg))
    }

    set({ ws })
  },

  disconnect: () => {
    get().ws?.close()
    set({ ws: null, connected: false })
  },

  send: (msg: object) => {
    const { ws, connected } = get()
    if (ws && connected) ws.send(JSON.stringify(msg))
  },

  addHandler: (fn: MessageHandler) => {
    get().handlers.add(fn)
    return () => get().handlers.delete(fn)
  },
}))
