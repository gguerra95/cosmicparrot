import fs from 'fs'
import path from 'path'
import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'
import { saveFile, getAbsolutePath } from '../services/files'
import { config } from '../config'

const attachmentRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /rooms/:roomId/attachments
  fastify.post('/rooms/:roomId/attachments', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { roomId } = req.params as { roomId: string }

    const { rows: memberCheck } = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, req.userId]
    )
    if (!memberCheck[0]) return reply.status(403).send({ error: 'Not a member' })

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    const isImage = data.mimetype.startsWith('image/')
    const maxSize = isImage ? config.MAX_IMAGE_SIZE : config.MAX_FILE_SIZE
    if (buffer.length > maxSize) {
      return reply.status(413).send({ error: `File exceeds ${isImage ? '3MB' : '20MB'} limit` })
    }

    const comment = (data.fields['comment'] as any)?.value ?? null

    const { storedPath, isImage: detectedImage, thumbPath } = await saveFile(buffer, data.filename, data.mimetype)

    // Create a stub message to attach to
    const { rows: msgRows } = await pool.query(
      `INSERT INTO messages (room_id, author_id, content) VALUES ($1, $2, $3) RETURNING id`,
      [roomId, req.userId, null]
    )
    const messageId = msgRows[0].id

    const { rows } = await pool.query(
      `INSERT INTO attachments (message_id, uploader_id, original_filename, stored_path, mime_type, file_size_bytes, is_image, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [messageId, req.userId, data.filename, storedPath, data.mimetype, buffer.length, detectedImage, comment]
    )

    await pool.query(
      `INSERT INTO room_unread (room_id, user_id, count)
       SELECT $1, rm.user_id, 1 FROM room_members rm WHERE rm.room_id = $1 AND rm.user_id != $2
       ON CONFLICT (room_id, user_id) DO UPDATE SET count = room_unread.count + 1`,
      [roomId, req.userId]
    )

    return reply.status(201).send({
      messageId,
      attachmentId: rows[0].id,
      original_filename: data.filename,
      mime_type: data.mimetype,
      file_size_bytes: buffer.length,
      is_image: detectedImage,
      has_thumb: !!thumbPath,
    })
  })

  // POST /dm/:channelId/attachments
  fastify.post('/dm/:channelId/attachments', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { channelId } = req.params as { channelId: string }

    const { rows: channelRows } = await pool.query(
      'SELECT * FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)',
      [channelId, req.userId]
    )
    if (!channelRows[0]) return reply.status(403).send({ error: 'Access denied' })
    if (channelRows[0].frozen_at) return reply.status(403).send({ error: 'Conversation is frozen' })

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    const isImage = data.mimetype.startsWith('image/')
    const maxSize = isImage ? config.MAX_IMAGE_SIZE : config.MAX_FILE_SIZE
    if (buffer.length > maxSize) {
      return reply.status(413).send({ error: `File exceeds ${isImage ? '3MB' : '20MB'} limit` })
    }

    const comment = (data.fields['comment'] as any)?.value ?? null
    const { storedPath, isImage: detectedImage } = await saveFile(buffer, data.filename, data.mimetype)

    const { rows: msgRows } = await pool.query(
      `INSERT INTO dm_messages (channel_id, author_id, content) VALUES ($1, $2, NULL) RETURNING id`,
      [channelId, req.userId]
    )
    const messageId = msgRows[0].id

    const { rows } = await pool.query(
      `INSERT INTO dm_attachments (message_id, uploader_id, original_filename, stored_path, mime_type, file_size_bytes, is_image, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [messageId, req.userId, data.filename, storedPath, data.mimetype, buffer.length, detectedImage, comment]
    )

    return reply.status(201).send({ messageId, attachmentId: rows[0].id })
  })

  // GET /attachments/:id - download with access control
  fastify.get('/attachments/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Check room attachments
    const { rows: attRows } = await pool.query(
      `SELECT a.stored_path, a.original_filename, a.mime_type, m.room_id
       FROM attachments a JOIN messages m ON m.id = a.message_id
       WHERE a.id = $1`,
      [id]
    )

    if (attRows[0]) {
      const att = attRows[0]
      const { rows: memberCheck } = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [att.room_id, req.userId]
      )
      if (!memberCheck[0]) return reply.status(403).send({ error: 'Access denied' })

      const filePath = getAbsolutePath(att.stored_path)
      if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File not found' })

      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(att.original_filename)}"`)
      reply.header('Content-Type', att.mime_type)
      return reply.send(fs.createReadStream(filePath))
    }

    // Check DM attachments
    const { rows: dmAttRows } = await pool.query(
      `SELECT a.stored_path, a.original_filename, a.mime_type, m.channel_id
       FROM dm_attachments a JOIN dm_messages m ON m.id = a.message_id
       WHERE a.id = $1`,
      [id]
    )
    if (!dmAttRows[0]) return reply.status(404).send({ error: 'Attachment not found' })

    const dmAtt = dmAttRows[0]
    const { rows: dmAccess } = await pool.query(
      'SELECT 1 FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)',
      [dmAtt.channel_id, req.userId]
    )
    if (!dmAccess[0]) return reply.status(403).send({ error: 'Access denied' })

    const filePath = getAbsolutePath(dmAtt.stored_path)
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'File not found' })

    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(dmAtt.original_filename)}"`)
    reply.header('Content-Type', dmAtt.mime_type)
    return reply.send(fs.createReadStream(filePath))
  })

  // GET /attachments/:id/thumb
  fastify.get('/attachments/:id/thumb', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Room attachment thumbnail
    const { rows } = await pool.query(
      `SELECT a.stored_path, m.room_id FROM attachments a JOIN messages m ON m.id = a.message_id
       WHERE a.id = $1 AND a.is_image = TRUE`,
      [id]
    )
    if (rows[0]) {
      const { rows: memberCheck } = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [rows[0].room_id, req.userId]
      )
      if (!memberCheck[0]) return reply.status(403).send({ error: 'Access denied' })

      const ext = path.extname(rows[0].stored_path)
      const thumbPath = getAbsolutePath(rows[0].stored_path.replace(ext, '_thumb.jpg'))
      const origPath = getAbsolutePath(rows[0].stored_path)
      const servePath = fs.existsSync(thumbPath) ? thumbPath : origPath

      reply.header('Content-Type', 'image/jpeg')
      return reply.send(fs.createReadStream(servePath))
    }

    // DM attachment thumbnail
    const { rows: dmRows } = await pool.query(
      `SELECT a.stored_path, m.channel_id FROM dm_attachments a JOIN dm_messages m ON m.id = a.message_id
       WHERE a.id = $1 AND a.is_image = TRUE`,
      [id]
    )
    if (!dmRows[0]) return reply.status(404).send({ error: 'Not found' })

    const { rows: dmAccess } = await pool.query(
      'SELECT 1 FROM dm_channels WHERE id = $1 AND (user_a = $2 OR user_b = $2)',
      [dmRows[0].channel_id, req.userId]
    )
    if (!dmAccess[0]) return reply.status(403).send({ error: 'Access denied' })

    const ext = path.extname(dmRows[0].stored_path)
    const thumbPath = getAbsolutePath(dmRows[0].stored_path.replace(ext, '_thumb.jpg'))
    const origPath = getAbsolutePath(dmRows[0].stored_path)
    const servePath = fs.existsSync(thumbPath) ? thumbPath : origPath

    reply.header('Content-Type', 'image/jpeg')
    return reply.send(fs.createReadStream(servePath))
  })
}

export default attachmentRoutes
