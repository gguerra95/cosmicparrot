import { useEffect, useRef, useCallback } from 'react'
import { MessageItem } from './MessageItem'
import type { Message } from '../../types'

interface Props {
  messages: Message[]
  hasMore: boolean | undefined
  loadMore: () => void
  isLoadingMore: boolean
  onReply: (msg: Message) => void
  roomId: string
  myRole?: string
  isDm?: boolean
  onUserClick: (userId: string) => void
}

export function MessageList({ messages, hasMore, loadMore, isLoadingMore, onReply, roomId, myRole, isDm, onUserClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const prevScrollHeightRef = useRef(0)

  // Track whether user is near bottom
  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  // Scroll to bottom on new messages if user was at bottom
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // Preserve scroll position when loading older messages
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (prevScrollHeightRef.current > 0) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = 0
    }
  })

  // Intersection observer for top sentinel
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
        const el = containerRef.current
        if (el) prevScrollHeightRef.current = el.scrollHeight
        loadMore()
      }
    }, { threshold: 0.1 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, loadMore])

  return (
    <div className="message-list" ref={containerRef} onScroll={handleScroll}>
      <div ref={sentinelRef} className="scroll-sentinel">
        {isLoadingMore && <div className="loading-more">Loading…</div>}
      </div>

      {messages.map(msg => (
        <MessageItem
          key={msg.id}
          message={msg}
          onReply={onReply}
          canDelete={myRole === 'owner' || myRole === 'admin'}
          roomId={roomId}
          isDm={isDm}
          onUserClick={onUserClick}
        />
      ))}

      <div ref={bottomRef} />
    </div>
  )
}
