import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { messagesApi } from '../../api/messages'
import { useWsStore } from '../../stores/wsStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'
import { UserProfileModal } from '../modals/UserProfileModal'
import { useInfiniteDmMessages } from '../../hooks/useInfiniteMessages'
import type { DmChannel, Message } from '../../types'

export function DmView() {
  const { channelId } = useParams<{ channelId: string }>()
  const { send } = useWsStore()
  const { setDmUnread } = useUnreadStore()
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)

  const { data: channel } = useQuery<DmChannel>({
    queryKey: ['dm-channel', channelId],
    queryFn: () => api.get(`/dm`).then(r => r.data.find((c: DmChannel) => c.id === channelId)),
    enabled: !!channelId,
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteDmMessages(channelId!)

  useEffect(() => {
    if (channelId) {
      messagesApi.dmMarkRead(channelId)
      setDmUnread(channelId, 0)
    }
  }, [channelId, setDmUnread])

  const messages = data?.pages.flat() ?? []

  if (!channel || !channelId) return <div className="chat-placeholder">Select a conversation</div>

  return (
    <div className="chat-layout">
      <div className="chat-main">
        <div className="chat-header">
          <h2>@ <span className="dm-partner-link" onClick={() => setProfileUserId(channel.partner_id)}>{channel.partner_username}</span></h2>
          {channel.frozen_at && (
            <span className="frozen-banner">This conversation is frozen</span>
          )}
        </div>

        <MessageList
          messages={messages}
          hasMore={hasNextPage}
          loadMore={fetchNextPage}
          isLoadingMore={isFetchingNextPage}
          onReply={setReplyTo}
          roomId={channelId}
          isDm
          onUserClick={setProfileUserId}
        />

        {!channel.frozen_at && (
          <MessageInput
            roomId={channelId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSent={() => {}}
            isDm
          />
        )}
      </div>

      {profileUserId && (
        <UserProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
        />
      )}
    </div>
  )
}
