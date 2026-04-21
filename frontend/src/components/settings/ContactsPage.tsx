import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { friendsApi } from '../../api/friends'
import { UserProfileModal } from '../modals/UserProfileModal'
import type { Friendship } from '../../types'

export function ContactsPage() {
  const [sendUsername, setSendUsername] = useState('')
  const [sendMsg, setSendMsg] = useState('')
  const [error, setError] = useState('')
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: friends = [] } = useQuery<Friendship[]>({
    queryKey: ['friends'],
    queryFn: () => friendsApi.list(),
  })

  const accepted = friends.filter(f => f.status === 'accepted')
  const incoming = friends.filter(f => f.status === 'pending' && f.direction === 'received')
  const outgoing = friends.filter(f => f.status === 'pending' && f.direction === 'sent')

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await friendsApi.sendRequest(sendUsername, sendMsg || undefined)
      setSendUsername('')
      setSendMsg('')
      queryClient.invalidateQueries({ queryKey: ['friends'] })
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Failed')
    }
  }

  async function accept(id: string) {
    await friendsApi.accept(id)
    queryClient.invalidateQueries({ queryKey: ['friends'] })
  }

  async function decline(id: string) {
    await friendsApi.decline(id)
    queryClient.invalidateQueries({ queryKey: ['friends'] })
  }

  async function remove(userId: string) {
    if (!confirm('Remove this friend?')) return
    await friendsApi.remove(userId)
    queryClient.invalidateQueries({ queryKey: ['friends'] })
  }

  return (
    <div className="page contacts-page">
      <h2>Contacts</h2>

      <section>
        <h3>Send Friend Request</h3>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={sendRequest} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input placeholder="Username" value={sendUsername} onChange={e => setSendUsername(e.target.value)} required />
          <input placeholder="Message (optional)" value={sendMsg} onChange={e => setSendMsg(e.target.value)} />
          <button type="submit">Send</button>
        </form>
      </section>

      {incoming.length > 0 && (
        <section>
          <h3>Incoming Requests</h3>
          {incoming.map(f => (
            <div key={f.friendship_id} className="friend-row">
              <strong className="friend-username-link" onClick={() => setProfileUserId(f.id)}>{f.username}</strong>
              {f.message && <em> "{f.message}"</em>}
              <button onClick={() => accept(f.friendship_id)}>Accept</button>
              <button onClick={() => decline(f.friendship_id)}>Decline</button>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h3>Sent Requests</h3>
          {outgoing.map(f => (
            <div key={f.friendship_id} className="friend-row">
              <strong className="friend-username-link" onClick={() => setProfileUserId(f.id)}>{f.username}</strong>
              <em>(pending)</em>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>Friends ({accepted.length})</h3>
        {accepted.map(f => (
          <div key={f.id} className="friend-row">
            <strong className="friend-username-link" onClick={() => setProfileUserId(f.id)}>{f.username}</strong>
            <button onClick={() => remove(f.id ?? '')}>Remove</button>
          </div>
        ))}
      </section>

      {profileUserId && (
        <UserProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}
    </div>
  )
}
