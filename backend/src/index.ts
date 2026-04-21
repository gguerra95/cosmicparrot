import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'

import { config } from './config'
import { runMigrations } from './db/migrate'
import { pool } from './db/pool'
import { redis } from './redis/client'

import authPlugin from './plugins/auth'
import authRoutes from './routes/auth'
import userRoutes from './routes/users'
import roomRoutes from './routes/rooms'
import messageRoutes from './routes/messages'
import attachmentRoutes from './routes/attachments'
import friendRoutes from './routes/friends'
import dmRoutes from './routes/dm'
import { handleConnection, getPeers } from './ws/handler'
import { verifyAccessToken } from './services/auth'
import { startPresenceWatcher } from './redis/presenceWatcher'

async function start() {
  await runMigrations()
  await startPresenceWatcher(getPeers)

  const fastify = Fastify({
    logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
  })

  await fastify.register(helmet, { contentSecurityPolicy: false })
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  })
  await fastify.register(cookie)
  await fastify.register(multipart, {
    limits: { fileSize: config.MAX_FILE_SIZE },
  })
  await fastify.register(rateLimit, {
    global: false,
  })
  await fastify.register(websocket)
  await fastify.register(authPlugin)

  // Health check
  fastify.get('/api/v1/health', async () => ({ ok: true }))

  // REST routes
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' })
  await fastify.register(userRoutes, { prefix: '/api/v1/users' })
  await fastify.register(roomRoutes, { prefix: '/api/v1/rooms' })
  await fastify.register(messageRoutes, { prefix: '/api/v1' })
  await fastify.register(attachmentRoutes, { prefix: '/api/v1' })
  await fastify.register(friendRoutes, { prefix: '/api/v1/friends' })
  await fastify.register(dmRoutes, { prefix: '/api/v1/dm' })

  // WebSocket endpoint
  fastify.get('/ws', { websocket: true }, (socket: any, req) => {
    const token = (req.query as { token?: string }).token
    if (!token) { socket.close(4001, 'Unauthorized'); return }
    try {
      const payload = verifyAccessToken(token)
      handleConnection(socket, payload.sub, payload.username).catch(() => socket.close(4001, 'Error'))
    } catch {
      socket.close(4001, 'Invalid token')
    }
  })

  // Global error handler
  fastify.setErrorHandler((error, req, reply) => {
    fastify.log.error(error)
    reply.status(error.statusCode ?? 500).send({ error: error.message ?? 'Internal server error' })
  })

  const address = await fastify.listen({ port: config.PORT, host: '0.0.0.0' })
  fastify.log.info(`Server listening at ${address}`)
}

start().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
