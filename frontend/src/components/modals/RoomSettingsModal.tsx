import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { roomsApi } from '../../api/rooms'
import { useAuthStore } from '../../stores/authStore'
import { friendsApi } from '../../api/friends'
import type { Room, RoomMember } from '../../types'

type Tab = 'members' | 'admins' | 'banned' | 'invitations' | 'settings'

interface Props {
  room: Room
  onClose: () => void
}

export function RoomSettingsModal({ room, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('members')
  const { user } = useAuthStore()
  const isOwner = room.owner_id === user?.id
  const isAdmin = room.my_role === 'owner' || room.my_role === 'admin'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide">
        <div className="modal-header">
          <h3>Manage Room: #{room.name}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-tabs">
          {(['members', 'admins', 'banned', 'invitations', 'settings'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'tab-active' : ''} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="modal-tab-content">
          {tab === 'members' && <MembersTab room={room} isAdmin={isAdmin} isOwner={isOwner} />}
          {tab === 'admins' && <AdminsTab room={room} isOwner={isOwner} />}
          {tab === 'banned' && <BannedTab room={room} isAdmin={isAdmin} />}
          {tab === 'invitations' && <InvitationsTab room={room} isAdmin={isAdmin} />}
          {tab === 'settings' && <SettingsTab room={room} isOwner={isOwner} onClose={onClose} />}
        </div>
      </div>
    </div>
  )
}

function MembersTab({ room, isAdmin, isOwner }: { room: Room; isAdmin: boolean; isOwner: boolean }) {
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  const { data: members = [] } = useQuery<RoomMember[]>({
    queryKey: ['room-members', room.id],
    queryFn: () => roomsApi.members(room.id),
  })

  const filtered = members.filter(m => m.username.includes(search))

  async function ban(userId: string) {
    if (!confirm('Ban this user?')) return
    await roomsApi.ban(room.id, userId)
    queryClient.invalidateQueries({ queryKey: ['room-members', room.id] })
  }

  async function remove(userId: string) {
    if (!confirm('Remove this member from the room?')) return
    await roomsApi.removeMember(room.id, userId)
    queryClient.invalidateQueries({ queryKey: ['room-members', room.id] })
  }

  async function setRole(userId: string, role: 'admin' | 'member') {
    await roomsApi.setRole(room.id, userId, role)
    queryClient.invalidateQueries({ queryKey: ['room-members', room.id] })
  }

  return (
    <div>
      <input placeholder="Search member" value={search} onChange={e => setSearch(e.target.value)} />
      <table className="members-table">
        <thead><tr><th>Username</th><th>Role</th>{isAdmin && <th>Actions</th>}</tr></thead>
        <tbody>
          {filtered.map(m => (
            <tr key={m.id}>
              <td>{m.username}</td>
              <td>{m.role}</td>
              {isAdmin && (
                <td>
                  {m.role !== 'owner' && m.id !== user?.id && (
                    <>
                      {m.role === 'member' && (
                        <button onClick={() => setRole(m.id, 'admin')}>Make admin</button>
                      )}
                      {m.role === 'admin' && isOwner && (
                        <button onClick={() => setRole(m.id, 'member')}>Remove admin</button>
                      )}
                      {(isOwner || (isAdmin && m.role === 'member')) && (
                        <button onClick={() => remove(m.id)}>Remove</button>
                      )}
                      <button onClick={() => ban(m.id)}>Ban</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AdminsTab({ room, isOwner }: { room: Room; isOwner: boolean }) {
  const queryClient = useQueryClient()
  const { data: members = [] } = useQuery<RoomMember[]>({
    queryKey: ['room-members', room.id],
    queryFn: () => roomsApi.members(room.id),
  })

  const admins = members.filter(m => m.role === 'owner' || m.role === 'admin')

  return (
    <ul>
      {admins.map(a => (
        <li key={a.id}>
          {a.username} {a.role === 'owner' ? '(owner)' : ''}
          {isOwner && a.role === 'admin' && (
            <button onClick={async () => {
              await roomsApi.setRole(room.id, a.id, 'member')
              queryClient.invalidateQueries({ queryKey: ['room-members', room.id] })
            }}>Remove admin</button>
          )}
        </li>
      ))}
    </ul>
  )
}

function BannedTab({ room, isAdmin }: { room: Room; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const { data: bans = [] } = useQuery<any[]>({
    queryKey: ['room-bans', room.id],
    queryFn: () => roomsApi.bans(room.id),
  })

  return (
    <table className="members-table">
      <thead><tr><th>Username</th><th>Banned by</th><th>Date</th>{isAdmin && <th>Actions</th>}</tr></thead>
      <tbody>
        {bans.map((b: any) => (
          <tr key={b.user_id}>
            <td>{b.username}</td>
            <td>{b.banned_by_username}</td>
            <td>{new Date(b.created_at).toLocaleString()}</td>
            {isAdmin && (
              <td>
                <button onClick={async () => {
                  await roomsApi.unban(room.id, b.user_id)
                  queryClient.invalidateQueries({ queryKey: ['room-bans', room.id] })
                }}>Unban</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function InvitationsTab({ room, isAdmin }: { room: Room; isAdmin: boolean }) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const { data: invitations = [] } = useQuery<any[]>({
    queryKey: ['room-invitations', room.id],
    queryFn: () => roomsApi.invitations(room.id),
    enabled: isAdmin,
  })

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await roomsApi.invite(room.id, username)
      setUsername('')
      queryClient.invalidateQueries({ queryKey: ['room-invitations', room.id] })
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed')
    }
  }

  return (
    <div>
      <form onSubmit={invite} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input placeholder="Invite by username" value={username} onChange={e => setUsername(e.target.value)} />
        <button type="submit">Send invite</button>
      </form>
      {error && <div className="error-msg">{error}</div>}
      {isAdmin && (
        <ul>
          {invitations.map((inv: any) => (
            <li key={inv.id}>{inv.invited_username} (invited by {inv.invited_by_username})</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsTab({ room, isOwner, onClose }: { room: Room; isOwner: boolean; onClose: () => void }) {
  const [name, setName] = useState(room.name)
  const [description, setDescription] = useState(room.description ?? '')
  const [isPrivate, setIsPrivate] = useState(room.is_private)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try {
      await roomsApi.update(room.id, { name, description, is_private: isPrivate })
      queryClient.invalidateQueries({ queryKey: ['room', room.id] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed')
    }
  }

  async function deleteRoom() {
    if (!confirm(`Delete room "${room.name}"? This cannot be undone.`)) return
    await roomsApi.delete(room.id)
    queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    onClose()
    navigate('/')
  }

  return (
    <form onSubmit={save}>
      {error && <div className="error-msg">{error}</div>}
      <label>Room name</label>
      <input value={name} onChange={e => setName(e.target.value)} required />
      <label>Description</label>
      <input value={description} onChange={e => setDescription(e.target.value)} />
      <label>
        <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} /> Public
      </label>
      <label>
        <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} /> Private
      </label>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button type="submit">Save changes</button>
        {isOwner && (
          <button type="button" className="btn-danger" onClick={deleteRoom}>Delete room</button>
        )}
      </div>
    </form>
  )
}
