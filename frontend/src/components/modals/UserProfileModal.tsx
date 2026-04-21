import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { friendsApi } from '../../api/friends'
import { dmApi } from '../../api/dm'
import { useAuthStore } from '../../stores/authStore'

interface UserProfile {
  id: string
  username: string
  avatar_path: string | null
  created_at: string
  friendship_status: 'pending' | 'accepted' | null
  friendship_direction: 'sent' | 'received' | null
  friendship_id: string | null
  i_banned_them: number | null
  they_banned_me: number | null
}

interface Props {
  userId: string
  onClose: () => void
}

export function UserProfileModal({ userId, onClose }: Props) {
  const { user: me } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['user-profile', userId],
    queryFn: () => friendsApi.getUserById(userId),
  })

  const isSelf = me?.id === userId

  async function act(fn: () => Promise<unknown>) {
    setLoading(true)
    setError('')
    try {
      await fn()
      queryClient.invalidateQueries({ queryKey: ['user-profile', userId] })
      queryClient.invalidateQueries({ queryKey: ['friends'] })
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal user-profile-modal">
        <div className="modal-header">
          <h3>User Profile</h3>
          <button onClick={onClose}>×</button>
        </div>

        <div className="modal-tab-content">
          {isLoading ? (
            <div className="user-profile-loading">Loading…</div>
          ) : profile ? (
            <div className="user-profile">
              <div className="user-profile-info">
                <div className="user-profile-avatar">
                  {profile.avatar_path ? (
                    <img src={`/api/v1/attachments/${profile.avatar_path}`} alt={profile.username} />
                  ) : (
                    <div className="user-profile-avatar-placeholder">
                      {profile.username[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="user-profile-meta">
                  <div className="user-profile-username">{profile.username}</div>
                  {isSelf && <div className="user-profile-note">This is you</div>}
                  {profile.they_banned_me && !isSelf && (
                    <div className="user-profile-note">This user has restricted interactions with you.</div>
                  )}
                  {profile.i_banned_them && !isSelf && (
                    <div className="user-profile-note user-profile-note--warn">You have banned this user.</div>
                  )}
                  {profile.friendship_status === 'accepted' && !isSelf && (
                    <div className="user-profile-friend-badge">Friends</div>
                  )}
                </div>
              </div>

              {error && <div className="error-msg">{error}</div>}

              {!isSelf && (
                <div className="user-profile-actions">
                  {profile.i_banned_them ? (
                    <button onClick={() => act(() => friendsApi.unban(userId))} disabled={loading}>
                      Unban User
                    </button>
                  ) : !profile.they_banned_me ? (
                    <>
                      {profile.friendship_status === 'accepted' ? (
                        <>
                          <button
                            className="btn-primary"
                            onClick={async () => {
                              const channel = await dmApi.openOrCreate(userId)
                              onClose()
                              navigate(`/dm/${channel.id}`)
                            }}
                            disabled={loading}
                          >
                            Send Message
                          </button>
                          <button onClick={() => act(() => friendsApi.remove(userId))} disabled={loading}>
                            Remove Friend
                          </button>
                        </>
                      ) : profile.friendship_status === 'pending' && profile.friendship_direction === 'sent' ? (
                        <button onClick={() => act(() => friendsApi.remove(userId))} disabled={loading}>
                          Cancel Request
                        </button>
                      ) : profile.friendship_status === 'pending' && profile.friendship_direction === 'received' ? (
                        <>
                          <button
                            className="btn-accept"
                            onClick={() => act(() => friendsApi.accept(profile.friendship_id!))}
                            disabled={loading}
                          >
                            Accept Request
                          </button>
                          <button
                            onClick={() => act(() => friendsApi.decline(profile.friendship_id!))}
                            disabled={loading}
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-primary"
                          onClick={() => act(() => friendsApi.sendRequest(profile.username))}
                          disabled={loading}
                        >
                          Add Friend
                        </button>
                      )}
                      <button
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`Ban ${profile.username}? This will remove your friendship and freeze any DM channel.`)) {
                            act(() => friendsApi.ban(userId))
                          }
                        }}
                        disabled={loading}
                      >
                        Ban User
                      </button>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="user-profile-loading">User not found.</div>
          )}
        </div>
      </div>
    </div>
  )
}
