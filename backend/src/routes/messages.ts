import path from 'path'
import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'
import { notifyNewMessage, notifyEditedMessage, notifyDeletedMessage, notifyUnreadUpdate } from '../ws/handler'
import { deleteFile } from '../services/files'

const messageRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /rooms/:roomId/messages?before=<id>&limit=50
  fastify.get('/rooms/:roomId/messages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string }
    const { before, limit = '50' } = req.query as { before?: string; limit?: string }
    const lim = Math.min(parseInt(limit), 100)

    const { rows: memberCheck } = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, req.userId]
    )
    if (!memberCheck[0]) return reply.status(403).send({ error: 'Not a member' })

    const params: unknown[] = [roomId, lim]
    let cursor = ''
    if (before) {
      params.push(before)
      cursor = `AND m.created_at < (SELECT created_at FROM messages WHERE id = $${params.length})`
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.room_id, m.author_id, m.content, m.reply_to_id, m.edited_at, m.deleted_at,
              m.created_at, u.username as author_username, u.avatar_path as author_avatar,
              json_agg(json_build_object(
                'id', a.id, 'original_filename', a.original_filename,
                'mime_type', a.mime_type, 'file_size_bytes', a.file_size_bytes,
                'is_image', a.is_image, 'comment', a.comment
              )) FILTER (WHERE a.id IS NOT NULL) as attachments,
              rm.content as reply_content, ru.username as reply_author
       FROM messages m
       JOIN users u ON u.id = m.author_id
       LEFT JOIN attachments a ON a.message_id = m.id
       LEFT JOIN messages rm ON rm.id = m.reply_to_id
       LEFT JOIN users ru ON ru.id = rm.author_id
       WHERE m.room_id = $1 ${cursor}
       GROUP BY m.id, u.username, u.avatar_path, rm.content, ru.username
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params
    )
    return rows.reverse()
  })

  // POST /rooms/:roomId/messages
  fastify.post('/rooms/:roomId/messages', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: fastify.authenticate,
  }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string }
    const { content, replyToId } = req.body as { content: string; replyToId?: string }

    if (!content?.trim()) return reply.status(400).send({ error: 'content is required' })
    if (Buffer.byteLength(content, 'utf8') > 3072) {
      return reply.status(400).send({ error: 'Message exceeds 3KB limit' })
    }

    const { rows: memberCheck } = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, req.userId]
    )
    if (!memberCheck[0]) return reply.status(403).send({ error: 'Not a member' })

    const { rows } = await pool.query(
      `INSERT INTO messages (room_id, author_id, content, reply_to_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roomId, req.userId, content, replyToId ?? null]
    )

    // Increment unread for all other members and push WS update
    await pool.query(
      `INSERT INTO room_unread (room_id, user_id, count)
       SELECT $1, rm.user_id, 1
       FROM room_members rm WHERE rm.room_id = $1 AND rm.user_id != $2
       ON CONFLICT (room_id, user_id) DO UPDATE SET count = room_unread.count + 1`,
      [roomId, req.userId]
    )
    const { rows: unreadRows } = await pool.query(
      `SELECT user_id, count FROM room_unread WHERE room_id = $1 AND user_id != $2`,
      [roomId, req.userId]
    )
    for (const r of unreadRows) {
      notifyUnreadUpdate(r.user_id, { roomId, count: r.count })
    }
    notifyNewMessage(roomId, rows[0])

    return reply.status(201).send(rows[0])
  })

  // PATCH /messages/:id
  fastify.patch('/messages/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { content } = req.body as { content: string }
    if (!content?.trim()) return reply.status(400).send({ error: 'content is required' })
    if (Buffer.byteLength(content, 'utf8') > 3072) {
      return reply.status(400).send({ error: 'Message exceeds 3KB limit' })
    }

    const { rows } = await pool.query(
      `UPDATE messages SET content = $1, edited_at = NOW()
       WHERE id = $2 AND author_id = $3 AND deleted_at IS NULL RETURNING *`,
      [content, id, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Message not found or not yours' })
    return rows[0]
  })

  // DELETE /messages/:id - by author or room admin
  fastify.delete('/messages/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows: msgRows } = await pool.query(
      'SELECT author_id, room_id FROM messages WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )
    if (!msgRows[0]) return reply.status(404).send({ error: 'Message not found' })
    const msg = msgRows[0]

    if (msg.author_id !== req.userId) {
      const { rows: roleRows } = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [msg.room_id, req.userId]
      )
      if (!roleRows[0] || !['owner', 'admin'].includes(roleRows[0].role)) {
        return reply.status(403).send({ error: 'Cannot delete this message' })
      }
    }

    const { rows: attRows } = await pool.query(
      'SELECT stored_path, is_image FROM attachments WHERE message_id = $1',
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
      'UPDATE messages SET deleted_at = NOW(), content = NULL WHERE id = $1',
      [id]
    )
    return { ok: true }
  })

  // POST /rooms/:roomId/mark-read
  fastify.post('/rooms/:roomId/mark-read', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string }
    await pool.query(
      `UPDATE room_unread SET count = 0 WHERE room_id = $1 AND user_id = $2`,
      [roomId, req.userId]
    )
    return { ok: true }
  })

  // GET /rooms/:roomId/unread
  fastify.get('/rooms/:roomId/unread', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string }
    const { rows } = await pool.query(
      'SELECT count FROM room_unread WHERE room_id = $1 AND user_id = $2',
      [roomId, req.userId]
    )
    return { count: rows[0]?.count ?? 0 }
  })
}

export default messageRoutes
