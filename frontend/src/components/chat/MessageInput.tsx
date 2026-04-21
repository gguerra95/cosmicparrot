import { useState, useRef, useEffect } from 'react'
import EmojiPicker from 'emoji-picker-react'
import { messagesApi } from '../../api/messages'
import { useWsStore } from '../../stores/wsStore'
import { api } from '../../api/client'
import type { Message } from '../../types'

interface Props {
  roomId: string
  replyTo: Message | null
  onCancelReply: () => void
  onSent: () => void
  isDm?: boolean
}

export function MessageInput({ roomId, replyTo, onCancelReply, onSent, isDm }: Props) {
  const [text, setText] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [fileComment, setFileComment] = useState('')
  const send = useWsStore((s) => s.send)
  const typingRef = useRef(false)
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function startTyping() {
    if (!typingRef.current) {
      typingRef.current = true
      send({ type: 'typing_start', roomId })
    }
    clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => {
      typingRef.current = false
      send({ type: 'typing_stop', roomId })
    }, 2000)
  }

  async function handleSend() {
    const content = text.trim()
    if (!content) return
    typingRef.current = false
    clearTimeout(typingTimeout.current)
    send({ type: 'typing_stop', roomId })
    setText('')
    try {
      if (isDm) {
        await messagesApi.dmSend(roomId, content, replyTo?.id)
      } else {
        await messagesApi.send(roomId, content, replyTo?.id)
      }
      onCancelReply()
      onSent()
    } catch (err: any) {
      setText(content) // restore on error
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleFileUpload(file: File, comment: string) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      if (comment.trim()) form.append('comment', comment.trim())
      const endpoint = isDm
        ? `/dm/${roomId}/attachments`
        : `/rooms/${roomId}/attachments`
      await api.post(endpoint, form)
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) { setPendingFile(file); setFileComment('') }
    e.target.value = ''
  }

  async function confirmUpload() {
    if (!pendingFile) return
    const file = pendingFile
    const comment = fileComment
    setPendingFile(null)
    setFileComment('')
    await handleFileUpload(file, comment)
  }

  function cancelUpload() {
    setPendingFile(null)
    setFileComment('')
  }

  // Clipboard paste for files
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) { e.preventDefault(); setPendingFile(file); setFileComment('') }
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  return (
    <div className="message-input-area">
      {replyTo && (
        <div className="reply-preview">
          <span>Replying to <strong>{replyTo.author_username}</strong>: {replyTo.content}</span>
          <button onClick={onCancelReply}>×</button>
        </div>
      )}
      {pendingFile && (
        <div className="attachment-preview">
          <span className="attachment-filename">{pendingFile.name}</span>
          <input
            className="attachment-comment-input"
            placeholder="Add a comment (optional)"
            value={fileComment}
            onChange={e => setFileComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmUpload() } }}
            autoFocus
          />
          <button onClick={confirmUpload} disabled={uploading}>Upload</button>
          <button onClick={cancelUpload}>Cancel</button>
        </div>
      )}
      <div className="message-input-row">
        <button className="input-btn" onClick={() => setShowEmoji(e => !e)} title="Emoji">😊</button>
        <label className="input-btn" title="Attach file">
          📎
          <input type="file" style={{ display: 'none' }} onChange={handleFileChange} />
        </label>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => { setText(e.target.value); startTyping() }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          rows={1}
          className="message-textarea"
        />
        <button className="send-btn" onClick={handleSend} disabled={!text.trim() || uploading}>
          Send
        </button>
      </div>
      {showEmoji && (
        <div className="emoji-picker-wrapper">
          <EmojiPicker
            onEmojiClick={(e) => { setText(t => t + e.emoji); setShowEmoji(false) }}
            height={350}
          />
        </div>
      )}
    </div>
  )
}
