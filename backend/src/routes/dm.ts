import path from 'path'
import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'
import { notifyDmMessage, notifyUnreadUpdate } from '../ws/handler'
import { deleteFile } from '../services/files'

const dmRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /dm - list DM channels for current user
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT dc.id, dc.frozen_at, dc.created_at,
              u.id as partner_id, u.username as partner_username, u.avatar_path as partner_avatar,
              COALESCE(du.count, 0) as unread_count,
              lm.content as last_message_content, lm.created_at as last_message_at
       FROM dm_channels dc
       JOIN users u ON u.id = CASE WHEN dc.user_a = $1 THEN dc.user_b ELSE dc.user_a END
       LEFT JOIN dm_unread du ON du.channel_id = dc.id AND du.user_id = $1
       LEFT JOIN LATERAL (
         SELECT content, created_at FROM dm_messages
         WHERE channel_id = dc.id AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1
       ) lm ON TRUE
       WHERE (dc.user_a = $1 OR dc.user_b = $1) AND u.deleted_at IS NULL
       ORDER BY COALESCE(lm.created_at, dc.created_at) DESC`,
      [req.userId]
    )
    return rows
  })

  // POST /dm/:userId - get or create DM channel
  fastify.post('/:userId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { userId } = req.params as { userId: string }
    if (userId === req.userId) return reply.status(400).send({ error: 'Cannot DM yourself' })

    // Check friendship
    const { rows: friendRows } = await pool.query(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.userId, userId]
    )
    if (!friendRows[0]) return reply.status(403).send({ error: 'Can only DM friends' })

    // Check bans
    const { rows: banRows } = await pool.query(
      `SELECT 1 FROM user_bans
       WHERE (banner_id = $1 AND banned_id = $2) OR (banner_id = $2 AND banned_id = $1)`,
      [req.userId, userId]
    )
    if (banRows[0]) return reply.status(403).send({ error: 'Cannot start DM' })

    const a = req.userId < userId ? req.userId : userId
    const b = req.userId < userId ? userId : req.userId

    const { rows } = await pool.query(
      `INSERT INTO dm_channels (user_a, user_b) VALUES ($1, $2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET id = dm_channels.id
       RETURNING *`,
      [a, b]
    )
    return rows[0]
  })

  // GET /dm/:channelId/messages
  fastify.get('/:channelId/messages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string }
    const { before, limit = '50' } = req.query as { before?: string; limit?: string }
    const lim = Math.min(parseInt(limit), 100)

    const { rows: access } = await pool.query(
      'SELECT 1 FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)',
      [channelId, req.userId]
    )
    if (!access[0]) return reply.status(403).send({ error: 'Access denied' })

    const params: unknown[] = [channelId, lim]
    let cursor = ''
    if (before) {
      params.push(before)
      cursor = `AND m.created_at < (SELECT created_at FROM dm_messages WHERE id = $${params.length})`
    }

    const { rows } = await pool.query(
      `SELECT m.*, u.username as author_username, u.avatar_path as author_avatar,
              json_agg(json_build_object(
                'id', a.id, 'original_filename', a.original_filename,
                'mime_type', a.mime_type, 'file_size_bytes', a.file_size_bytes,
                'is_image', a.is_image, 'comment', a.comment
              )) FILTER (WHERE a.id IS NOT NULL) as attachments
       FROM dm_messages m
       JOIN users u ON u.id = m.author_id
       LEFT JOIN dm_attachments a ON a.message_id = m.id
       WHERE m.channel_id = $1 ${cursor}
       GROUP BY m.id, u.username, u.avatar_path
       ORDER BY m.created_at DESC LIMIT $2`,
      params
    )
    return rows.reverse()
  })

  // POST /dm/:channelId/messages
  fastify.post('/:channelId/messages', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string }
    const { content, replyToId } = req.body as { content: string; replyToId?: string }
    if (!content?.trim()) return reply.status(400).send({ error: 'content is required' })
    if (Buffer.byteLength(content, 'utf8') > 3072) {
      return reply.status(400).send({ error: 'Message exceeds 3KB limit' })
    }

    const { rows: channelRows } = await pool.query(
      'SELECT * FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)',
      [channelId, req.userId]
    )
    if (!channelRows[0]) return reply.status(403).send({ error: 'Access denied' })
    if (channelRows[0].frozen_at) return reply.status(403).send({ error: 'This conversation is frozen' })

    const { rows } = await pool.query(
      `INSERT INTO dm_messages (channel_id, author_id, content, reply_to_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [channelId, req.userId, content, replyToId ?? null]
    )

    // Increment unread for partner and push WS updates
    const channel = channelRows[0]
    const partnerId = channel.user_a === req.userId ? channel.user_b : channel.user_a
    await pool.query(
      `INSERT INTO dm_unread (channel_id, user_id, count) VALUES ($1, $2, 1)
       ON CONFLICT (channel_id, user_id) DO UPDATE SET count = dm_unread.count + 1`,
      [channelId, partnerId]
    )
    const { rows: unreadRows } = await pool.query(
      'SELECT count FROM dm_unread WHERE channel_id = $1 AND user_id = $2',
      [channelId, partnerId]
    )
    notifyDmMessage(channelId, partnerId, rows[0])
    notifyUnreadUpdate(partnerId, { channelId, count: unreadRows[0]?.count ?? 1 })

    return reply.status(201).send(rows[0])
  })

  // POST /dm/:channelId/mark-read
  fastify.post('/:channelId/mark-read', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string }
    await pool.query(
      'UPDATE dm_unread SET count = 0 WHERE channel_id = $1 AND user_id = $2',
      [channelId, req.userId]
    )
    return { ok: true }
  })

  // PATCH /dm/:channelId/messages/:id
  fastify.patch('/:channelId/messages/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { channelId, id } = req.params as { channelId: string; id: string }
    const { content } = req.body as { content: string }
    if (!content?.trim()) return reply.status(400).send({ error: 'content is required' })

    const { rows } = await pool.query(
      `UPDATE dm_messages SET content = $1, edited_at = NOW()
       WHERE id = $2 AND channel_id = $3 AND author_id = $4 AND deleted_at IS NULL RETURNING *`,
      [content, id, channelId, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Message not found' })
    return rows[0]
  })

  // DELETE /dm/:channelId/messages/:id
  fastify.delete('/:channelId/messages/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { channelId, id } = req.params as { channelId: string; id: string }

    const { rows: msgRows } = await pool.query(
      'SELECT 1 FROM dm_messages WHERE id = $1 AND channel_id = $2 AND author_id = $3 AND deleted_at IS NULL',
      [id, channelId, req.userId]
    )
    if (!msgRows[0]) return reply.status(404).send({ error: 'Message not found' })

    const { rows: attRows } = await pool.query(
      'SELECT stored_path, is_image FROM dm_attachments WHERE message_id = $1',
      [id]
    )
    for (const att of attRows) {
      await deleteFile(att.stored_path)
      if (att.is_image) {
        const ext = path.extname(att.stored_path)
        await deleteFile(att.stored_path.replace(ext, '_thumb.jpg'))
      }
    }

    await pool.query(
      'UPDATE dm_messages SET deleted_at = NOW(), content = NULL WHERE id = $1',
      [id]
    )
    return { ok: true }
  })
}

export default dmRoutes
