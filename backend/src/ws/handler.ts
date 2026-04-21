import { v4 as uuidv4 } from 'uuid'
import WebSocket from 'ws'
import { pool } from '../db/pool'
import {
  registerTab, unregisterTab, setTabActive, setTabIdle,
  resetTabTtl, derivePresence,
} from '../redis/presence'
import {
  addConnection, removeConnection, subscribeRoom, unsubscribeRoom,
  unsubscribeAllRooms, sendToUser, broadcastToRoom, broadcastToUsers,
} from './broadcaster'

interface WsContext {
  userId: string
  username: string
  tabId: string
}

export async function getPeers(userId: string): Promise<string[]> {
  // Users who share a room with me OR are friends
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id
     FROM users u
     WHERE u.deleted_at IS NULL AND u.id != $1 AND (
       EXISTS (
         SELECT 1 FROM room_members rm1
         JOIN room_members rm2 ON rm1.room_id = rm2.room_id
         WHERE rm1.user_id = $1 AND rm2.user_id = u.id
       ) OR EXISTS (
         SELECT 1 FROM friendships f
         WHERE f.status = 'accepted'
           AND ((f.requester_id = $1 AND f.addressee_id = u.id) OR (f.requester_id = u.id AND f.addressee_id = $1))
       )
     )`,
    [userId]
  )
  return rows.map(r => r.id)
}

export async function handleConnection(ws: WebSocket, userId: string, username: string): Promise<void> {
  const tabId = uuidv4()
  const ctx: WsContext = { userId, username, tabId }

  addConnection(userId, ws)
  await registerTab(userId, tabId)

  // Broadcast this user's presence to peers
  const peers = await getPeers(userId)
  broadcastToUsers(peers, { type: 'presence_update', userId, status: 'online' })
  sendToUser(userId, { type: 'presence_update', userId, status: 'online' })

  // Send current presence of every peer back to the newly connected user
  const peerStatuses = await Promise.all(
    peers.map(async (peerId) => ({ peerId, status: await derivePresence(peerId) }))
  )
  for (const { peerId, status } of peerStatuses) {
    sendToUser(userId, { type: 'presence_update', userId: peerId, status })
  }

  const pingInterval = setInterval(async () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
      await resetTabTtl(userId, tabId)
    }
  }, 30_000)

  ws.on('message', async (raw: Buffer | string) => {
    let msg: { type: string; [k: string]: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    switch (msg.type) {
      case 'ping': {
        await resetTabTtl(ctx.userId, ctx.tabId)
        ws.send(JSON.stringify({ type: 'pong' }))
        break
      }

      case 'tab_active': {
        await setTabActive(ctx.userId, ctx.tabId)
        const status = await derivePresence(ctx.userId)
        const p = await getPeers(ctx.userId)
        broadcastToUsers(p, { type: 'presence_update', userId: ctx.userId, status })
        break
      }

      case 'tab_idle': {
        await setTabIdle(ctx.userId, ctx.tabId)
        const status = await derivePresence(ctx.userId)
        const p = await getPeers(ctx.userId)
        broadcastToUsers(p, { type: 'presence_update', userId: ctx.userId, status })
        break
      }

      case 'join_room': {
        const roomId = msg.roomId as string
        if (!roomId) break
        const { rows } = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, ctx.userId]
        )
        if (rows[0]) subscribeRoom(ctx.userId, roomId)
        break
      }

      case 'leave_room': {
        const roomId = msg.roomId as string
        if (roomId) unsubscribeRoom(ctx.userId, roomId)
        break
      }

      case 'typing_start': {
        const roomId = msg.roomId as string
        if (roomId) broadcastToRoom(roomId, {
          type: 'typing', roomId, userId: ctx.userId, username: ctx.username, active: true,
        }, ctx.userId)
        break
      }

      case 'typing_stop': {
        const roomId = msg.roomId as string
        if (roomId) broadcastToRoom(roomId, {
          type: 'typing', roomId, userId: ctx.userId, username: ctx.username, active: false,
        }, ctx.userId)
        break
      }

      case 'mark_read': {
        const roomId = msg.roomId as string
        if (roomId) {
          await pool.query(
            'UPDATE room_unread SET count = 0 WHERE room_id = $1 AND user_id = $2',
            [roomId, ctx.userId]
          )
          sendToUser(ctx.userId, { type: 'unread_update', roomId, count: 0 })
        }
        break
      }
    }
  })

  ws.on('close', async () => {
    clearInterval(pingInterval)
    removeConnection(ctx.userId, ws)
    unsubscribeAllRooms(ctx.userId)
    await unregisterTab(ctx.userId, ctx.tabId)

    const status = await derivePresence(ctx.userId)
    const p = await getPeers(ctx.userId)
    broadcastToUsers(p, { type: 'presence_update', userId: ctx.userId, status })
  })
}

// Called by REST routes to fanout realtime events
export function notifyNewMessage(roomId: string, message: object): void {
  broadcastToRoom(roomId, { type: 'message_new', roomId, message })
}

export function notifyEditedMessage(roomId: string, message: object): void {
  broadcastToRoom(roomId, { type: 'message_edited', roomId, message })
}

export function notifyDeletedMessage(roomId: string, messageId: string): void {
  broadcastToRoom(roomId, { type: 'message_deleted', roomId, messageId })
}

export function notifyRoomMemberEvent(
  roomId: string,
  eventType: 'room_member_joined' | 'room_member_left' | 'room_member_banned',
  data: object
): void {
  broadcastToRoom(roomId, { type: eventType, roomId, ...data })
}

export function notifyFriendRequest(addresseeId: string, request: object): void {
  sendToUser(addresseeId, { type: 'friend_request', request })
}

export function notifyFriendAccepted(requesterId: string, userId: string): void {
  sendToUser(requesterId, { type: 'friend_accepted', userId })
}

export function notifyDmMessage(channelId: string, recipientId: string, message: object): void {
  sendToUser(recipientId, { type: 'dm_new', channelId, message })
}

export function notifyUnreadUpdate(userId: string, payload: { roomId?: string; channelId?: string; count: number }): void {
  sendToUser(userId, { type: 'unread_update', ...payload })
}
