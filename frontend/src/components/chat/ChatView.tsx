import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { roomsApi } from '../../api/rooms'
import { messagesApi } from '../../api/messages'
import { useWsStore } from '../../stores/wsStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { useAuthStore } from '../../stores/authStore'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { MembersPanel } from '../layout/MembersPanel'
import { RoomSettingsModal } from '../modals/RoomSettingsModal'
import { UserProfileModal } from '../modals/UserProfileModal'
import { useInfiniteMessages } from '../../hooks/useInfiniteMessages'
import type { Message, Room } from '../../types'

function NotMemberBanner({ room, onRejoin, error }: { room: Room; onRejoin: () => void; error: string }) {
  return (
    <div className="not-member-banner">
      <div className="not-member-banner-text">
        <span>You are not a part of this room.</span>
        {error && <span className="not-member-error">{error}</span>}
      </div>
      {!room.is_banned && !room.is_private && (
        <button className="btn-primary" onClick={onRejoin}>Rejoin</button>
      )}
    </div>
  )
}

export function ChatView() {
  const { roomId } = useParams<{ roomId: string }>()
  const { user } = useAuthStore()
  const { send, addHandler } = useWsStore()
  const { setRoomUnread } = useUnreadStore()
  const queryClient = useQueryClient()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [rejoinError, setRejoinError] = useState('')

  const { data: room } = useQuery<Room>({
    queryKey: ['room', roomId],
    queryFn: () => roomsApi.get(roomId!),
    enabled: !!roomId,
  })

  async function handleRejoin() {
    if (!roomId) return
    setRejoinError('')
    try {
      await roomsApi.join(roomId)
      queryClient.invalidateQueries({ queryKey: ['room', roomId] })
      queryClient.invalidateQueries({ queryKey: ['my-rooms'] })
    } catch (err: any) {
      setRejoinError(err.response?.data?.error ?? 'Failed to join room')
    }
  }

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteMessages(roomId!)

  // Join room on WS
  useEffect(() => {
    if (roomId) {
      send({ type: 'join_room', roomId })
      messagesApi.markRead(roomId)
      setRoomUnread(roomId, 0)
    }
    return () => {
      if (roomId) send({ type: 'leave_room', roomId })
    }
  }, [roomId, send, setRoomUnread])

  // Typing indicators
  useEffect(() => {
    const remove = addHandler((msg) => {
      if (msg.type === 'typing' && msg.roomId === roomId && msg.userId !== user?.id) {
        const name = msg.username as string
        if (msg.active) {
          setTypingUsers(prev => prev.includes(name) ? prev : [...prev, name])
          // Auto-clear after 3s
          setTimeout(() => setTypingUsers(prev => prev.filter(u => u !== name)), 3000)
        } else {
          setTypingUsers(prev => prev.filter(u => u !== name))
        }
      }
    })
    return remove
  }, [roomId, addHandler, user?.id])

  const messages = data?.pages.flat() ?? []

  if (!room || !roomId) return <div className="chat-placeholder">Select a room</div>

  return (
    <div className="chat-layout">
      <div className="chat-main">
        <div className="chat-header">
          <div>
            <h2># {room.name}</h2>
            {room.description && <p className="chat-description">{room.description}</p>}
          </div>
          <button className="btn-secondary" onClick={() => setShowSettings(true)}>Manage room</button>
        </div>

        <div className={`chat-messages-wrapper${room.my_role ? '' : ' chat-messages--locked'}`}>
          <MessageList
            messages={messages}
            hasMore={hasNextPage}
            loadMore={fetchNextPage}
            isLoadingMore={isFetchingNextPage}
            onReply={setReplyTo}
            roomId={roomId}
            myRole={room.my_role}
            onUserClick={setProfileUserId}
          />
        </div>

        {typingUsers.length > 0 && room.my_role && (
          <div className="typing-indicator">
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}

        {room.my_role ? (
          <MessageInput
            roomId={roomId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSent={() => {}}
          />
        ) : (
          <NotMemberBanner room={room} onRejoin={handleRejoin} error={rejoinError} />
        )}
      </div>

      <MembersPanel roomId={roomId} myRole={room.my_role} onUserClick={setProfileUserId} />

      {showSettings && (
        <RoomSettingsModal
          room={room}
          onClose={() => setShowSettings(false)}
        />
      )}

      {profileUserId && (
        <UserProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}
    </div>
  )
}
