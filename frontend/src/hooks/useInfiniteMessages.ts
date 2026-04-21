import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { messagesApi } from '../api/messages'
import { useWsStore } from '../stores/wsStore'
import type { Message } from '../types'

export function useInfiniteMessages(roomId: string) {
  const queryClient = useQueryClient()
  const addHandler = useWsStore((s) => s.addHandler)

  const query = useInfiniteQuery({
    queryKey: ['messages', roomId],
    queryFn: ({ pageParam }) => messagesApi.list(roomId, pageParam as string | undefined),
    getNextPageParam: (firstPage: Message[]) =>
      firstPage.length === 50 ? firstPage[0]?.id : undefined,
    initialPageParam: undefined as string | undefined,
    select: (data) => ({
      pages: [...data.pages].reverse(),
      pageParams: [...data.pageParams].reverse(),
    }),
  })

  useEffect(() => {
    const remove = addHandler((msg) => {
      if (msg.type === 'message_new' && msg.roomId === roomId) {
        queryClient.setQueryData(['messages', roomId], (old: any) => {
          if (!old) return old
          const pages = [...old.pages]
          const lastPage = [...(pages[pages.length - 1] ?? [])]
          lastPage.push(msg.message as Message)
          pages[pages.length - 1] = lastPage
          return { ...old, pages }
        })
      }
      if (msg.type === 'message_edited' && msg.roomId === roomId) {
        queryClient.setQueryData(['messages', roomId], (old: any) => {
          if (!old) return old
          const updated = msg.message as Message
          const pages = old.pages.map((page: Message[]) =>
            page.map((m) => (m.id === updated.id ? updated : m))
          )
          return { ...old, pages }
        })
      }
      if (msg.type === 'message_deleted' && msg.roomId === roomId) {
        queryClient.setQueryData(['messages', roomId], (old: any) => {
          if (!old) return old
          const pages = old.pages.map((page: Message[]) =>
            page.map((m) => m.id === msg.messageId ? { ...m, deleted_at: new Date().toISOString(), content: null } : m)
          )
          return { ...old, pages }
        })
      }
    })
    return remove
  }, [roomId, addHandler, queryClient])

  return query
}

export function useInfiniteDmMessages(channelId: string) {
  const queryClient = useQueryClient()
  const addHandler = useWsStore((s) => s.addHandler)

  const query = useInfiniteQuery({
    queryKey: ['dm_messages', channelId],
    queryFn: ({ pageParam }) => messagesApi.dmList(channelId, pageParam as string | undefined),
    getNextPageParam: (firstPage: Message[]) =>
      firstPage.length === 50 ? firstPage[0]?.id : undefined,
    initialPageParam: undefined as string | undefined,
    select: (data) => ({
      pages: [...data.pages].reverse(),
      pageParams: [...data.pageParams].reverse(),
    }),
  })

  useEffect(() => {
    const remove = addHandler((msg) => {
      if (msg.type === 'dm_new' && msg.channelId === channelId) {
        queryClient.setQueryData(['dm_messages', channelId], (old: any) => {
          if (!old) return old
          const pages = [...old.pages]
          const lastPage = [...(pages[pages.length - 1] ?? [])]
          lastPage.push(msg.message as Message)
          pages[pages.length - 1] = lastPage
          return { ...old, pages }
        })
      }
    })
    return remove
  }, [channelId, addHandler, queryClient])

  return query
}
