import { useState } from 'react'
import { format } from 'date-fns'
import { messagesApi } from '../../api/messages'
import { useAuthStore } from '../../stores/authStore'
import type { Message } from '../../types'

interface Props {
  message: Message
  onReply: (msg: Message) => void
  canDelete: boolean
  roomId: string
  isDm?: boolean
  onUserClick: (userId: string) => void
}

export function MessageItem({ message: msg, onReply, canDelete, roomId, isDm, onUserClick }: Props) {
  const { user } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(msg.content ?? '')
  const isOwn = msg.author_id === user?.id

  async function saveEdit() {
    if (!editContent.trim()) return
    if (isDm && msg.channel_id) {
      await messagesApi.dmEdit(msg.channel_id, msg.id, editContent)
    } else {
      await messagesApi.edit(msg.id, editContent)
    }
    setEditing(false)
  }

  async function deleteMsg() {
    if (!confirm('Delete this message?')) return
    if (isDm && msg.channel_id) {
      await messagesApi.dmDelete(msg.channel_id, msg.id)
    } else {
      await messagesApi.delete(msg.id)
    }
  }

  if (msg.deleted_at) {
    return (
      <div className="message message--deleted">
        <span className="message-author message-author--clickable" onClick={() => onUserClick(msg.author_id)}>{msg.author_username}</span>
        <span className="message-deleted-text">[message deleted]</span>
      </div>
    )
  }

  return (
    <div className="message">
      {msg.reply_to_id && msg.reply_content !== null && (
        <div className="message-reply-quote">
          <span className="reply-author">{msg.reply_author}</span>
          <span className="reply-text">{msg.reply_content ?? '[deleted]'}</span>
        </div>
      )}
      <div className="message-header">
        <span className="message-author message-author--clickable" onClick={() => onUserClick(msg.author_id)}>{msg.author_username}</span>
        <span className="message-time">{format(new Date(msg.created_at), 'HH:mm')}</span>
        {msg.edited_at && <span className="message-edited">edited</span>}
      </div>

      {editing ? (
        <div className="message-edit">
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } }}
            autoFocus
          />
          <button onClick={saveEdit}>Save</button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="message-content">{msg.content}</div>
      )}

      {msg.attachments?.map(att => (
        <div key={att.id} className="message-attachment">
          {att.is_image ? (
            <img
              src={`/api/v1/attachments/${att.id}/thumb`}
              alt={att.original_filename}
              className="attachment-image"
              onClick={() => window.open(`/api/v1/attachments/${att.id}`, '_blank')}
            />
          ) : (
            <a href={`/api/v1/attachments/${att.id}`} download={att.original_filename} className="attachment-file">
              📎 {att.original_filename}
            </a>
          )}
          {att.comment && <span className="attachment-comment">{att.comment}</span>}
        </div>
      ))}

      <div className="message-actions">
        <button onClick={() => onReply(msg)} title="Reply">↩</button>
        {isOwn && !editing && (
          <button onClick={() => { setEditing(true); setEditContent(msg.content ?? '') }} title="Edit">✏</button>
        )}
        {(isOwn || canDelete) && (
          <button onClick={deleteMsg} title="Delete">🗑</button>
        )}
      </div>
    </div>
  )
}
