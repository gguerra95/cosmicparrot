import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useMatch } from 'react-router-dom'
import { roomsApi } from '../../api/rooms'
import { dmApi } from '../../api/dm'
import { friendsApi } from '../../api/friends'
import { useUnreadStore } from '../../stores/unreadStore'
import { usePresenceStore } from '../../stores/presenceStore'
import { PresenceDot } from './PresenceDot'
import { CreateRoomModal } from '../modals/CreateRoomModal'
import type { Room, DmChannel, Friendship } from '../../types'

interface PendingInvitation {
  id: string
  room_id: string
  room_name: string
  description: string | null
  invited_by: string
  created_at: string
}

export function Sidebar() {
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const inRoom = useMatch('/room/:id')
  const inDm = useMatch('/contacts/:id')
  const isInChat = !!(inRoom || inDm)
  const [publicOpen, setPublicOpen] = useState(!isInChat)
  const [privateOpen, setPrivateOpen] = useState(!isInChat)

  useEffect(() => {
    if (isInChat) { setPublicOpen(false); setPrivateOpen(false) }
    else { setPublicOpen(true); setPrivateOpen(true) }
  }, [isInChat])

  const unreadRooms = useUnreadStore((s) => s.rooms)
  const unreadDms = useUnreadStore((s) => s.dms)
  const setRoomUnread = useUnreadStore((s) => s.setRoomUnread)
  const setDmUnread = useUnreadStore((s) => s.setDmUnread)
  const queryClient = useQueryClient()

  const { data: rooms = [] } = useQuery<Room[]>({
    queryKey: ['my-rooms'],
    queryFn: () => roomsApi.list(undefined, undefined, true),
    refetchInterval: 30_000,
  })

  const { data: dms = [] } = useQuery<DmChannel[]>({
    queryKey: ['dms'],
    queryFn: () => dmApi.list(),
    refetchInterval: 30_000,
  })

  const { data: friends = [] } = useQuery<Friendship[]>({
    queryKey: ['friends'],
    queryFn: () => friendsApi.list(),
  })

  const { data: pendingInvitations = [] } = useQuery<PendingInvitation[]>({
    queryKey: ['room-invitations-pending'],
    queryFn: () => roomsApi.pendingInvitations(),
    refetchInterval: 30_000,
  })

  // Seed unread store from initial API data
  useEffect(() => {
    for (const r of rooms) {
      if ((r as any).unread_count > 0) setRoomUnread(r.id, (r as any).unread_count)
    }
  }, [rooms, setRoomUnread])

  useEffect(() => {
    for (const dm of dms) {
      if ((dm as any).unread_count > 0) setDmUnread(dm.id, (dm as any).unread_count)
    }
  }, [dms, setDmUnread])

  // Build channel lookup by partner user ID so the DM badge uses the channel ID
  const dmByPartnerId = useMemo(() => {
    const map: Record<string, DmChannel> = {}
    for (const dm of dms) map[(dm as any).partner_id] = dm
    return map
  }, [dms])

  const myRooms = rooms.filter((r: Room) => r.my_role)
  const publicRooms = myRooms.filter((r: Room) => !r.is_private)
  const privateRooms = myRooms.filter((r: Room) => r.is_private)
  const acceptedFriends = friends.filter((f: Friendship) => f.status === 'accepted')

  async function acceptInvitation(inv: PendingInvitation) {
    await roomsApi.acceptInvitation(inv.room_id, inv.id)
    queryClient.invalidateQueries({ queryKey: ['room-invitations-pending'] })
    queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
  }

  async function declineInvitation(inv: PendingInvitation) {
    await roomsApi.declineInvitation(inv.room_id, inv.id)
    queryClient.invalidateQueries({ queryKey: ['room-invitations-pending'] })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>ROOMS</span>
          <button onClick={() => setShowCreateRoom(true)} title="Create room">+</button>
        </div>

        {pendingInvitations.length > 0 && (
          <div className="sidebar-group">
            <strong>▾ Pending Invitations</strong>
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="sidebar-invitation">
                <span className="sidebar-invitation-name">🔒 {inv.room_name}</span>
                <span className="sidebar-invitation-by">from {inv.invited_by}</span>
                <div className="sidebar-invitation-actions">
                  <button className="btn-accept" onClick={() => acceptInvitation(inv)}>✓</button>
                  <button className="btn-decline" onClick={() => declineInvitation(inv)}>✗</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="sidebar-group">
          <button className="sidebar-group-toggle" onClick={() => setPublicOpen(o => !o)}>
            {publicOpen ? '▾' : '▸'} Public Rooms
          </button>
          {publicOpen && publicRooms.map((r: Room) => (
            <Link key={r.id} to={`/room/${r.id}`} className="sidebar-item">
              <span># {r.name}</span>
              {(unreadRooms[r.id] ?? 0) > 0 && (
                <span className="unread-badge">{unreadRooms[r.id]}</span>
              )}
            </Link>
          ))}
        </div>

        <div className="sidebar-group">
          <button className="sidebar-group-toggle" onClick={() => setPrivateOpen(o => !o)}>
            {privateOpen ? '▾' : '▸'} Private Rooms
          </button>
          {privateOpen && privateRooms.map((r: Room) => (
            <Link key={r.id} to={`/room/${r.id}`} className="sidebar-item">
              <span>🔒 {r.name}</span>
              {(unreadRooms[r.id] ?? 0) > 0 && (
                <span className="unread-badge">{unreadRooms[r.id]}</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>CONTACTS</span>
          <Link to="/contacts" title="Manage contacts">⚙</Link>
        </div>
        {acceptedFriends.map((f: Friendship) => (
          <DmContactItem key={f.id} friend={f} unread={unreadDms} dmByPartnerId={dmByPartnerId} />
        ))}
      </div>

      {showCreateRoom && (
        <CreateRoomModal onClose={() => setShowCreateRoom(false)} />
      )}
    </aside>
  )
}

function DmContactItem({ friend, unread, dmByPartnerId }: {
  friend: Friendship
  unread: Record<string, number>
  dmByPartnerId: Record<string, DmChannel>
}) {
  const status = usePresenceStore((s) => s.getStatus(friend.id ?? ''))
  const channelId = dmByPartnerId[friend.id ?? '']?.id
  const unreadCount = channelId ? (unread[channelId] ?? 0) : 0

  return (
    <Link to={`/contacts/${friend.id}`} className="sidebar-item sidebar-contact">
      <PresenceDot status={status} />
      <span>{friend.username}</span>
      {unreadCount > 0 && (
        <span className="unread-badge">{unreadCount}</span>
      )}
    </Link>
  )
}
