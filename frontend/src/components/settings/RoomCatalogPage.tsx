import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { roomsApi } from '../../api/rooms'
import type { Room } from '../../types'

export function RoomCatalogPage() {
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: rooms = [], isLoading } = useQuery<Room[]>({
    queryKey: ['room-catalog', search],
    queryFn: () => roomsApi.list(search),
  })

  async function joinRoom(id: string) {
    setError('')
    try {
      await roomsApi.join(id)
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
      navigate(`/room/${id}`)
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed to join room')
    }
  }

  return (
    <div className="page catalog-page">
      <h2>Public Rooms</h2>
      {error && <div className="error-msg">{error}</div>}
      <input
        placeholder="Search rooms…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="search-input"
      />
      {isLoading ? <p>Loading…</p> : (
        <div className="room-catalog">
          {rooms.map((r: Room) => (
            <div key={r.id} className="room-card">
              <div>
                <strong># {r.name}</strong>
                <span className="room-member-count">{r.member_count} members</span>
              </div>
              {r.description && <p>{r.description}</p>}
              <div>
                {r.my_role ? (
                  <button onClick={() => navigate(`/room/${r.id}`)}>Open</button>
                ) : (
                  <button onClick={() => joinRoom(r.id)}>Join</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
