import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'

const friendRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /friends - list friends + pending requests
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { rows: friends } = await pool.query(
      `SELECT u.id, u.username, u.avatar_path,
              CASE WHEN f.requester_id = $1 THEN 'sent' ELSE 'received' END as direction,
              f.status, f.id as friendship_id, f.message
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status IN ('accepted', 'pending') AND u.deleted_at IS NULL
       ORDER BY f.updated_at DESC`,
      [req.userId]
    )
    return friends
  })

  // POST /friends/request - send friend request by username
  fastify.post('/request', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { username, message } = req.body as { username: string; message?: string }
    if (!username) return reply.status(400).send({ error: 'username is required' })

    const { rows: userRows } = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL',
      [username]
    )
    if (!userRows[0]) return reply.status(404).send({ error: 'User not found' })
    const addresseeId = userRows[0].id
    if (addresseeId === req.userId) return reply.status(400).send({ error: 'Cannot friend yourself' })

    // Check if banned
    const { rows: banRows } = await pool.query(
      `SELECT 1 FROM user_bans WHERE (banner_id = $1 AND banned_id = $2) OR (banner_id = $2 AND banned_id = $1)`,
      [req.userId, addresseeId]
    )
    if (banRows[0]) return reply.status(403).send({ error: 'Cannot send friend request' })

    try {
      const { rows } = await pool.query(
        `INSERT INTO friendships (requester_id, addressee_id, message) VALUES ($1, $2, $3) RETURNING *`,
        [req.userId, addresseeId, message ?? null]
      )
      return reply.status(201).send(rows[0])
    } catch (err: any) {
      if (err.code === '23505') return reply.status(409).send({ error: 'Friend request already sent' })
      throw err
    }
  })

  // POST /friends/request/:id/accept
  fastify.post('/request/:id/accept', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `UPDATE friendships SET status = 'accepted', updated_at = NOW()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING *`,
      [id, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Friend request not found' })
    return rows[0]
  })

  // POST /friends/request/:id/decline
  fastify.post('/request/:id/decline', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await pool.query(
      `UPDATE friendships SET status = 'declined', updated_at = NOW()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
      [id, req.userId]
    )
    return { ok: true }
  })

  // DELETE /friends/:userId - remove friend or cancel pending request
  fastify.delete('/:userId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string }
    await pool.query(
      `DELETE FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status IN ('accepted', 'pending')`,
      [req.userId, userId]
    )
    return { ok: true }
  })

  // POST /users/:userId/ban - user-to-user ban
  fastify.post('/ban/:userId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string }
    if (userId === req.userId) return reply.status(400).send({ error: 'Cannot ban yourself' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO user_bans (banner_id, banned_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.userId, userId]
      )
      // Remove friendship
      await client.query(
        `DELETE FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [req.userId, userId]
      )
      // Freeze DM channel
      const a = req.userId < userId ? req.userId : userId
      const b = req.userId < userId ? userId : req.userId
      await client.query(
        `UPDATE dm_channels SET frozen_at = NOW()
         WHERE user_a = $1 AND user_b = $2 AND frozen_at IS NULL`,
        [a, b]
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    return { ok: true }
  })

  // DELETE /users/:userId/ban - remove ban
  fastify.delete('/ban/:userId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string }
    await pool.query(
      'DELETE FROM user_bans WHERE banner_id = $1 AND banned_id = $2',
      [req.userId, userId]
    )
    return { ok: true }
  })
}

export default friendRoutes
