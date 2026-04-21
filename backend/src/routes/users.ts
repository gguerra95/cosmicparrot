import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'

const userRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /users/me
  fastify.get('/me', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      'SELECT id, email, username, avatar_path, created_at FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' })
    return rows[0]
  })

  // GET /users/:username - public profile
  fastify.get('/:username', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { username } = req.params as { username: string }
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.avatar_path, u.created_at,
              f.status as friendship_status,
              CASE WHEN f.requester_id = $2 THEN 'sent' ELSE 'received' END as friendship_direction,
              f.id as friendship_id,
              (SELECT 1 FROM user_bans WHERE banner_id = $2 AND banned_id = u.id) as i_banned_them,
              (SELECT 1 FROM user_bans WHERE banner_id = u.id AND banned_id = $2) as they_banned_me
       FROM users u
       LEFT JOIN friendships f ON (
         (f.requester_id = $2 AND f.addressee_id = u.id) OR
         (f.requester_id = u.id AND f.addressee_id = $2)
       ) AND f.status != 'declined'
       WHERE u.username = $1 AND u.deleted_at IS NULL`,
      [username, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' })
    return rows[0]
  })

  // GET /users/id/:userId - get user by ID with relationship status
  fastify.get('/id/:userId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string }
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.avatar_path, u.created_at,
              f.status as friendship_status,
              CASE WHEN f.requester_id = $2 THEN 'sent' ELSE 'received' END as friendship_direction,
              f.id as friendship_id,
              (SELECT 1 FROM user_bans WHERE banner_id = $2 AND banned_id = u.id) as i_banned_them,
              (SELECT 1 FROM user_bans WHERE banner_id = u.id AND banned_id = $2) as they_banned_me
       FROM users u
       LEFT JOIN friendships f ON (
         (f.requester_id = $2 AND f.addressee_id = u.id) OR
         (f.requester_id = u.id AND f.addressee_id = $2)
       ) AND f.status != 'declined'
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'User not found' })
    return rows[0]
  })

  // GET /users/search?q=...
  fastify.get('/search', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { q } = req.query as { q?: string }
    if (!q || q.length < 2) return []
    const { rows } = await pool.query(
      `SELECT id, username, avatar_path FROM users
       WHERE username ILIKE $1 AND deleted_at IS NULL AND id != $2
       ORDER BY username LIMIT 20`,
      [`${q}%`, req.userId]
    )
    return rows
  })
}

export default userRoutes
