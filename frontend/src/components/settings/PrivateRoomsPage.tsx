import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { roomsApi } from '../../api/rooms'
import type { Room } from '../../types'

interface PendingInvitation {
  id: string
  room_id: string
  room_name: string
  description: string | null
  invited_by: string
  created_at: string
}

export function PrivateRoomsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: allRooms = [] } = useQuery<Room[]>({
    queryKey: ['my-rooms'],
    queryFn: () => roomsApi.list(undefined, undefined, true),
  })

  const { data: invitations = [] } = useQuery<PendingInvitation[]>({
    queryKey: ['room-invitations-pending'],
    queryFn: () => roomsApi.pendingInvitations(),
  })

  const privateRooms = allRooms.filter((r: Room) => r.is_private && r.my_role)

  async function accept(inv: PendingInvitation) {
    await roomsApi.acceptInvitation(inv.room_id, inv.id)
    queryClient.invalidateQueries({ queryKey: ['room-invitations-pending'] })
    queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
  }

  async function decline(inv: PendingInvitation) {
    await roomsApi.declineInvitation(inv.room_id, inv.id)
    queryClient.invalidateQueries({ queryKey: ['room-invitations-pending'] })
  }

  return (
    <div className="page">
      <h2>Private Rooms</h2>

      {invitations.length > 0 && (
        <section>
          <h3>Pending Invitations</h3>
          <div className="room-catalog">
            {invitations.map((inv) => (
              <div key={inv.id} className="room-card">
                <div>
                  <strong>🔒 {inv.room_name}</strong>
                </div>
                {inv.description && <p>{inv.description}</p>}
                <p style={{ fontSize: 12 }}>Invited by {inv.invited_by}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ background: 'var(--success)', color: '#fff' }} onClick={() => accept(inv)}>
                    Accept
                  </button>
                  <button onClick={() => decline(inv)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>My Private Rooms</h3>
        {privateRooms.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            You are not a member of any private rooms yet. Ask a room owner to invite you.
          </p>
        ) : (
          <div className="room-catalog">
            {privateRooms.map((r: Room) => (
              <div key={r.id} className="room-card">
                <div>
                  <strong>🔒 {r.name}</strong>
                  <span className="room-member-count">{r.member_count} members</span>
                </div>
                {r.description && <p>{r.description}</p>}
                <div>
                  <button onClick={() => navigate(`/room/${r.id}`)}>Open</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
