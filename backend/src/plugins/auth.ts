import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../services/auth'

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    try {
      const payload = verifyAccessToken(token)
      req.userId = payload.sub
      req.sessionId = payload.sid
      req.username = payload.username
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }
  })
}

export default fp(authPlugin)

// Augment Fastify instance
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}
