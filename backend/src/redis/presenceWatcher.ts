import Redis from 'ioredis'
import { config } from '../config'
import { unregisterTab, derivePresence } from './presence'
import { sendToUser, broadcastToUsers } from '../ws/broadcaster'

// Separate connection — a subscribed client cannot issue regular commands
const subscriber = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 })

subscriber.on('error', (err) => console.error('[redis:watcher] error', err))

// Pattern: tab_ttl:{userId}:{tabId}
const TTL_KEY_RE = /^tab_ttl:([^:]+):(.+)$/

type PeersFn = (userId: string) => Promise<string[]>

export async function startPresenceWatcher(getPeers: PeersFn): Promise<void> {
  // Enable expired-key events (E = keyevent, x = expired)
  try {
    await subscriber.config('SET', 'notify-keyspace-events', 'Ex')
  } catch (err) {
    console.warn('[redis:watcher] Could not set notify-keyspace-events — offline detection via TTL disabled', err)
    return
  }
  await subscriber.subscribe('__keyevent@0__:expired')

  subscriber.on('message', async (_channel: string, key: string) => {
    const m = key.match(TTL_KEY_RE)
    if (!m) return
    const [, userId, tabId] = m

    await unregisterTab(userId, tabId)

    const [status, peers] = await Promise.all([
      derivePresence(userId),
      getPeers(userId),
    ])
    broadcastToUsers(peers, { type: 'presence_update', userId, status })
    sendToUser(userId, { type: 'presence_update', userId, status })
  })
}
