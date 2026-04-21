import WebSocket from 'ws'

// userId → set of open WebSocket connections (one per tab)
const userConnections = new Map<string, Set<WebSocket>>()
// roomId → set of userIds subscribed to that room
const roomSubscriptions = new Map<string, Set<string>>()

export function addConnection(userId: string, ws: WebSocket): void {
  if (!userConnections.has(userId)) userConnections.set(userId, new Set())
  userConnections.get(userId)!.add(ws)
}

export function removeConnection(userId: string, ws: WebSocket): void {
  const conns = userConnections.get(userId)
  if (!conns) return
  conns.delete(ws)
  if (conns.size === 0) userConnections.delete(userId)
}

export function subscribeRoom(userId: string, roomId: string): void {
  if (!roomSubscriptions.has(roomId)) roomSubscriptions.set(roomId, new Set())
  roomSubscriptions.get(roomId)!.add(userId)
}

export function unsubscribeRoom(userId: string, roomId: string): void {
  roomSubscriptions.get(roomId)?.delete(userId)
}

export function unsubscribeAllRooms(userId: string): void {
  for (const [, members] of roomSubscriptions) {
    members.delete(userId)
  }
}

export function sendToUser(userId: string, payload: object): void {
  const conns = userConnections.get(userId)
  if (!conns) return
  const data = JSON.stringify(payload)
  for (const ws of conns) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

export function broadcastToRoom(roomId: string, payload: object, excludeUserId?: string): void {
  const members = roomSubscriptions.get(roomId)
  if (!members) return
  const data = JSON.stringify(payload)
  for (const userId of members) {
    if (userId === excludeUserId) continue
    const conns = userConnections.get(userId)
    if (!conns) continue
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    }
  }
}

export function broadcastToUsers(userIds: string[], payload: object): void {
  const data = JSON.stringify(payload)
  for (const userId of userIds) {
    const conns = userConnections.get(userId)
    if (!conns) continue
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    }
  }
}

export function getConnectedUserIds(): string[] {
  return [...userConnections.keys()]
}

export function isConnected(userId: string): boolean {
  return (userConnections.get(userId)?.size ?? 0) > 0
}
