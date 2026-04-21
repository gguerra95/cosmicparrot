import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'

const roomRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /rooms - public room catalog, or ?my=true for user's rooms
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { search, page = '1', my } = req.query as { search?: string; page?: string; my?: string }
    const offset = (parseInt(page) - 1) * 20

    if (my === 'true') {
      // Return all rooms the user is a member of
      const { rows } = await pool.query(
        `SELECT r.id, r.name, r.description, r.is_private, r.owner_id, r.created_at,
                rm.role as my_role,
                (SELECT COUNT(*) FROM room_members rm2 WHERE rm2.room_id = r.id)::int AS member_count,
                COALESCE(ru.count, 0) as unread_count
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $1
         LEFT JOIN room_unread ru ON ru.room_id = r.id AND ru.user_id = $1
         WHERE r.deleted_at IS NULL
         ORDER BY r.name`,
        [req.userId]
      )
      return rows
    }

    const params: unknown[] = [`%${search ?? ''}%`, 20, offset, req.userId]
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.description, r.is_private, r.owner_id, r.created_at,
              COUNT(DISTINCT rm.user_id)::int AS member_count,
              myrm.role as my_role
       FROM rooms r
       LEFT JOIN room_members rm ON rm.room_id = r.id
       LEFT JOIN room_members myrm ON myrm.room_id = r.id AND myrm.user_id = $4
       WHERE r.is_private = FALSE AND r.deleted_at IS NULL
         AND (r.name ILIKE $1 OR r.description ILIKE $1)
       GROUP BY r.id, myrm.role
       ORDER BY member_count DESC, r.created_at DESC
       LIMIT $2 OFFSET $3`,
      params
    )
    return rows
  })

  // POST /rooms - create room
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { name, description, is_private } = req.body as {
      name: string; description?: string; is_private?: boolean
    }
    if (!name?.trim()) return reply.status(400).send({ error: 'name is required' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      let room
      try {
        const { rows } = await client.query(
          `INSERT INTO rooms (name, description, is_private, owner_id)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [name.trim(), description ?? null, is_private ?? false, req.userId]
        )
        room = rows[0]
      } catch (err: any) {
        if (err.code === '23505') {
          await client.query('ROLLBACK')
          return reply.status(409).send({ error: 'Room name already taken' })
        }
        throw err
      }
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [room.id, req.userId]
      )
      await client.query('COMMIT')
      return reply.status(201).send(room)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // GET /rooms/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `SELECT r.*, rm.role as my_role,
              EXISTS(SELECT 1 FROM room_bans rb WHERE rb.room_id = r.id AND rb.user_id = $2) AS is_banned
       FROM rooms r
       LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Room not found' })
    const room = rows[0]
    if (room.is_private && !room.my_role) {
      return reply.status(403).send({ error: 'Access denied' })
    }
    return room
  })

  // PATCH /rooms/:id - update settings
  fastify.patch('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { name, description, is_private } = req.body as {
      name?: string; description?: string; is_private?: boolean
    }

    const { rows: memberRows } = await pool.query(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [id, req.userId]
    )
    if (!memberRows[0] || !['owner', 'admin'].includes(memberRows[0].role)) {
      return reply.status(403).send({ error: 'Only admins can update room settings' })
    }

    try {
      const { rows } = await pool.query(
        `UPDATE rooms SET
          name = COALESCE($1, name),
          description = COALESCE($2, description),
          is_private = COALESCE($3, is_private)
         WHERE id = $4 AND deleted_at IS NULL RETURNING *`,
        [name?.trim() ?? null, description ?? null, is_private ?? null, id]
      )
      if (!rows[0]) return reply.status(404).send({ error: 'Room not found' })
      return rows[0]
    } catch (err: any) {
      if (err.code === '23505') return reply.status(409).send({ error: 'Room name already taken' })
      throw err
    }
  })

  // DELETE /rooms/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      `SELECT owner_id FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Room not found' })
    if (rows[0].owner_id !== req.userId) {
      return reply.status(403).send({ error: 'Only the owner can delete the room' })
    }
    await pool.query('UPDATE rooms SET deleted_at = NOW() WHERE id = $1', [id])
    return { ok: true }
  })

  // GET /rooms/:id/members
  fastify.get('/:id/members', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows: memberCheck } = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!memberCheck[0]) return reply.status(403).send({ error: 'Not a member' })

    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.avatar_path, rm.role, rm.joined_at
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1 AND u.deleted_at IS NULL
       ORDER BY rm.role DESC, u.username`,
      [id]
    )
    return rows
  })

  // POST /rooms/:id/join
  fastify.post('/:id/join', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows: roomRows } = await pool.query(
      'SELECT id, is_private FROM rooms WHERE id = $1 AND deleted_at IS NULL',
      [id]
    )
    if (!roomRows[0]) return reply.status(404).send({ error: 'Room not found' })
    if (roomRows[0].is_private) return reply.status(403).send({ error: 'Private room requires invitation' })

    const { rows: banRows } = await pool.query(
      'SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (banRows[0]) return reply.status(403).send({ error: 'You are banned from this room' })

    await pool.query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [id, req.userId]
    )
    return { ok: true }
  })

  // POST /rooms/:id/leave
  fastify.post('/:id/leave', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!rows[0]) return reply.status(400).send({ error: 'Not a member' })
    if (rows[0].role === 'owner') return reply.status(400).send({ error: 'Owner cannot leave. Delete the room instead.' })
    await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [id, req.userId])
    return { ok: true }
  })

  // POST /rooms/:id/invite
  fastify.post('/:id/invite', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { username } = req.body as { username: string }
    if (!username) return reply.status(400).send({ error: 'username is required' })

    const { rows: memberCheck } = await pool.query(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [id, req.userId]
    )
    if (!memberCheck[0]) return reply.status(403).send({ error: 'Not a member of this room' })

    const { rows: userRows } = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL',
      [username]
    )
    if (!userRows[0]) return reply.status(404).send({ error: 'User not found' })
    const invitedUserId = userRows[0].id

    try {
      await pool.query(
        `INSERT INTO room_invitations (room_id, invited_by, invited_user_id)
         VALUES ($1, $2, $3)`,
        [id, req.userId, invitedUserId]
      )
    } catch (err: any) {
      if (err.code === '23505') return reply.status(409).send({ error: 'Already invited' })
      throw err
    }
    return { ok: true }
  })

  // GET /rooms/:id/invitations - my pending invitations for this room (owner/admin)
  fastify.get('/:id/invitations', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows: memberCheck } = await pool.query(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2`,
      [id, req.userId]
    )
    if (!memberCheck[0] || !['owner', 'admin'].includes(memberCheck[0].role)) {
      return reply.status(403).send({ error: 'Admin access required' })
    }
    const { rows } = await pool.query(
      `SELECT ri.id, u.username as invited_username, ib.username as invited_by_username, ri.created_at
       FROM room_invitations ri
       JOIN users u ON u.id = ri.invited_user_id
       JOIN users ib ON ib.id = ri.invited_by
       WHERE ri.room_id = $1 AND ri.accepted_at IS NULL AND ri.declined_at IS NULL`,
      [id]
    )
    return rows
  })

  // POST /rooms/:id/invitations/:invId/accept
  fastify.post('/:id/invitations/:invId/accept', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, invId } = req.params as { id: string; invId: string }
    const { rows } = await pool.query(
      `SELECT * FROM room_invitations WHERE id = $1 AND room_id = $2 AND invited_user_id = $3
       AND accepted_at IS NULL AND declined_at IS NULL`,
      [invId, id, req.userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Invitation not found' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE room_invitations SET accepted_at = NOW() WHERE id = $1', [invId])
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [id, req.userId]
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    return { ok: true }
  })

  // POST /rooms/:id/invitations/:invId/decline
  fastify.post('/:id/invitations/:invId/decline', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, invId } = req.params as { id: string; invId: string }
    await pool.query(
      `UPDATE room_invitations SET declined_at = NOW()
       WHERE id = $1 AND room_id = $2 AND invited_user_id = $3`,
      [invId, id, req.userId]
    )
    return { ok: true }
  })

  // POST /rooms/:id/ban/:userId
  fastify.post('/:id/ban/:targetUserId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, targetUserId } = req.params as { id: string; targetUserId: string }
    const { rows: myRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!myRole[0] || !['owner', 'admin'].includes(myRole[0].role)) {
      return reply.status(403).send({ error: 'Admin required' })
    }
    const { rows: targetRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, targetUserId]
    )
    if (targetRole[0]?.role === 'owner') return reply.status(403).send({ error: 'Cannot ban the owner' })
    if (myRole[0].role === 'admin' && targetRole[0]?.role === 'admin') {
      return reply.status(403).send({ error: 'Admins cannot ban other admins' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [id, targetUserId])
      await client.query(
        `INSERT INTO room_bans (room_id, user_id, banned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, targetUserId, req.userId]
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    return { ok: true }
  })

  // DELETE /rooms/:id/ban/:userId - unban
  fastify.delete('/:id/ban/:targetUserId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, targetUserId } = req.params as { id: string; targetUserId: string }
    const { rows: myRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!myRole[0] || !['owner', 'admin'].includes(myRole[0].role)) {
      return reply.status(403).send({ error: 'Admin required' })
    }
    await pool.query('DELETE FROM room_bans WHERE room_id = $1 AND user_id = $2', [id, targetUserId])
    return { ok: true }
  })

  // GET /rooms/:id/bans
  fastify.get('/:id/bans', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { rows: myRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!myRole[0] || !['owner', 'admin'].includes(myRole[0].role)) {
      return reply.status(403).send({ error: 'Admin required' })
    }
    const { rows } = await pool.query(
      `SELECT rb.user_id, u.username, bu.username as banned_by_username, rb.created_at
       FROM room_bans rb
       JOIN users u ON u.id = rb.user_id
       JOIN users bu ON bu.id = rb.banned_by
       WHERE rb.room_id = $1 ORDER BY rb.created_at DESC`,
      [id]
    )
    return rows
  })

  // PATCH /rooms/:id/members/:targetUserId - change role
  fastify.patch('/:id/members/:targetUserId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, targetUserId } = req.params as { id: string; targetUserId: string }
    const { role } = req.body as { role: 'admin' | 'member' }
    if (!['admin', 'member'].includes(role)) return reply.status(400).send({ error: 'role must be admin or member' })

    const { rows: myRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!myRole[0] || !['owner', 'admin'].includes(myRole[0].role)) {
      return reply.status(403).send({ error: 'Admin required' })
    }
    const { rows: targetRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, targetUserId]
    )
    if (targetRole[0]?.role === 'owner') return reply.status(403).send({ error: 'Cannot change owner role' })

    await pool.query(
      'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
      [role, id, targetUserId]
    )
    return { ok: true }
  })

  // DELETE /rooms/:id/members/:targetUserId - remove (kick) member without ban
  fastify.delete('/:id/members/:targetUserId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id, targetUserId } = req.params as { id: string; targetUserId: string }

    const { rows: myRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, req.userId]
    )
    if (!myRole[0] || !['owner', 'admin'].includes(myRole[0].role)) {
      return reply.status(403).send({ error: 'Admin required' })
    }
    const { rows: targetRole } = await pool.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [id, targetUserId]
    )
    if (!targetRole[0]) return reply.status(404).send({ error: 'Member not found' })
    if (targetRole[0].role === 'owner') return reply.status(403).send({ error: 'Cannot remove owner' })
    if (myRole[0].role === 'admin' && targetRole[0].role === 'admin') {
      return reply.status(403).send({ error: 'Admins cannot remove other admins' })
    }

    await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [id, targetUserId])
    return { ok: true }
  })

  // GET /rooms/invitations/pending - invitations pending for me
  fastify.get('/invitations/pending', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT ri.id, r.id as room_id, r.name as room_name, r.description,
              ib.username as invited_by, ri.created_at
       FROM room_invitations ri
       JOIN rooms r ON r.id = ri.room_id AND r.deleted_at IS NULL
       JOIN users ib ON ib.id = ri.invited_by
       WHERE ri.invited_user_id = $1 AND ri.accepted_at IS NULL AND ri.declined_at IS NULL`,
      [req.userId]
    )
    return rows
  })
}

export default roomRoutes
