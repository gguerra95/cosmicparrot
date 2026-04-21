import { redis } from './client'
import type { PresenceStatus } from '../types'

const TAB_TTL = 90 // seconds — reset on ping

export function tabsKey(userId: string) { return `tabs:${userId}` }
export function tabIdleKey(userId: string) { return `tab_idle:${userId}` }
export function tabTtlKey(userId: string, tabId: string) { return `tab_ttl:${userId}:${tabId}` }

export async function registerTab(userId: string, tabId: string): Promise<void> {
  const pipe = redis.pipeline()
  pipe.sadd(tabsKey(userId), tabId)
  pipe.set(tabTtlKey(userId, tabId), '1', 'EX', TAB_TTL)
  await pipe.exec()
}

export async function unregisterTab(userId: string, tabId: string): Promise<void> {
  const pipe = redis.pipeline()
  pipe.srem(tabsKey(userId), tabId)
  pipe.srem(tabIdleKey(userId), tabId)
  pipe.del(tabTtlKey(userId, tabId))
  await pipe.exec()
}

export async function setTabActive(userId: string, tabId: string): Promise<void> {
  const pipe = redis.pipeline()
  pipe.srem(tabIdleKey(userId), tabId)
  pipe.set(tabTtlKey(userId, tabId), '1', 'EX', TAB_TTL)
  await pipe.exec()
}

export async function setTabIdle(userId: string, tabId: string): Promise<void> {
  await redis.sadd(tabIdleKey(userId), tabId)
}

export async function resetTabTtl(userId: string, tabId: string): Promise<void> {
  await redis.set(tabTtlKey(userId, tabId), '1', 'EX', TAB_TTL)
}

export async function derivePresence(userId: string): Promise<PresenceStatus> {
  const [allTabs, idleTabs] = await Promise.all([
    redis.smembers(tabsKey(userId)),
    redis.smembers(tabIdleKey(userId)),
  ])

  if (allTabs.length === 0) return 'offline'
  if (idleTabs.length >= allTabs.length) return 'afk'
  return 'online'
}
