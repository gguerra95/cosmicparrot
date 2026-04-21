import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import authPlugin from '../../plugins/auth'
import authRoutes from '../../routes/auth'
import userRoutes from '../../routes/users'
import roomRoutes from '../../routes/rooms'
import messageRoutes from '../../routes/messages'
import attachmentRoutes from '../../routes/attachments'
import friendRoutes from '../../routes/friends'
import dmRoutes from '../../routes/dm'

export async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: true, credentials: true })
  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } })
  await app.register(rateLimit, { global: false })
  await app.register(authPlugin)
  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(userRoutes, { prefix: '/api/v1/users' })
  await app.register(roomRoutes, { prefix: '/api/v1/rooms' })
  await app.register(messageRoutes, { prefix: '/api/v1' })
  await app.register(attachmentRoutes, { prefix: '/api/v1' })
  await app.register(friendRoutes, { prefix: '/api/v1/friends' })
  await app.register(dmRoutes, { prefix: '/api/v1/dm' })
  await app.ready()
  return app
}
