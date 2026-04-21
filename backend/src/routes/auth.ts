import crypto from 'crypto'
import * as argon2 from 'argon2'
import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/pool'
import {
  createSession,
  rotateSession,
  signAccessToken,
  verifyToken,
  hashToken,
} from '../services/auth'
import { sendPasswordResetEmail } from '../services/email'
import { config } from '../config'

const COOKIE_NAME = 'refresh_token'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: config.JWT_REFRESH_EXPIRES_DAYS * 86400,
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/register
  fastify.post('/register', async (req, reply) => {
    const { email, username, password } = req.body as {
      email: string; username: string; password: string
    }
    if (!email || !username || !password) {
      return reply.status(400).send({ error: 'email, username, and password are required' })
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' })
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return reply.status(400).send({ error: 'Username must be 3-32 alphanumeric characters, underscores, or hyphens' })
    }

    const hash = await argon2.hash(password, { type: argon2.argon2id })
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username`,
        [email.toLowerCase(), username, hash]
      )
      const user = rows[0]
      const { sessionId, refreshToken } = await createSession(
        user.id,
        req.headers['user-agent'] ?? null,
        req.ip
      )
      const accessToken = signAccessToken({ sub: user.id, sid: sessionId, username: user.username })
      reply.setCookie(COOKIE_NAME, refreshToken, COOKIE_OPTS)
      reply.setCookie('sid', sessionId, { httpOnly: false, path: '/', sameSite: 'strict', secure: config.NODE_ENV === 'production', maxAge: config.JWT_REFRESH_EXPIRES_DAYS * 86400 })
      return { accessToken, user: { id: user.id, username: user.username } }
    } catch (err: any) {
      if (err.code === '23505') {
        const field = err.detail?.includes('email') ? 'Email' : 'Username'
        return reply.status(409).send({ error: `${field} already taken` })
      }
      throw err
    }
  })

  // POST /auth/login
  fastify.post('/login', async (req, reply) => {
    const { identifier, password } = req.body as { identifier: string; password: string }
    if (!identifier || !password) {
      return reply.status(400).send({ error: 'identifier and password are required' })
    }

    const { rows } = await pool.query(
      `SELECT id, username, password_hash FROM users
       WHERE (email = LOWER($1) OR LOWER(username) = LOWER($1)) AND deleted_at IS NULL`,
      [identifier]
    )
    const user = rows[0]
    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const { sessionId, refreshToken } = await createSession(
      user.id,
      req.headers['user-agent'] ?? null,
      req.ip
    )
    const accessToken = signAccessToken({ sub: user.id, sid: sessionId, username: user.username })
    reply.setCookie(COOKIE_NAME, refreshToken, COOKIE_OPTS)
    reply.setCookie('sid', sessionId, { httpOnly: false, path: '/', sameSite: 'strict', secure: config.NODE_ENV === 'production', maxAge: config.JWT_REFRESH_EXPIRES_DAYS * 86400 })
    return { accessToken, user: { id: user.id, username: user.username } }
  })

  // POST /auth/refresh
  fastify.post('/refresh', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME]
    if (!token) return reply.status(401).send({ error: 'No refresh token' })

    // Find session by iterating recent sessions — we verify the token hash
    // To avoid full table scan we store session id in a second cookie (non-sensitive)
    const sidCookie = req.cookies['sid']
    if (!sidCookie) return reply.status(401).send({ error: 'No session id' })

    const { rows } = await pool.query(
      `SELECT s.id, s.refresh_token_hash, s.expires_at, u.id as user_id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL`,
      [sidCookie]
    )
    const session = rows[0]
    if (!session || !(await verifyToken(token, session.refresh_token_hash))) {
      reply.clearCookie(COOKIE_NAME, COOKIE_OPTS)
      return reply.status(401).send({ error: 'Invalid or expired session' })
    }

    const rotated = await rotateSession(session.id)
    if (!rotated) return reply.status(401).send({ error: 'Session expired' })

    const accessToken = signAccessToken({
      sub: session.user_id,
      sid: session.id,
      username: session.username,
    })
    reply.setCookie(COOKIE_NAME, rotated.refreshToken, COOKIE_OPTS)
    reply.setCookie('sid', session.id, { httpOnly: false, path: '/', sameSite: 'strict', secure: config.NODE_ENV === 'production', maxAge: config.JWT_REFRESH_EXPIRES_DAYS * 86400 })
    return { accessToken }
  })

  // POST /auth/logout
  fastify.post('/logout', { preHandler: fastify.authenticate }, async (req, reply) => {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.sessionId])
    reply.clearCookie(COOKIE_NAME, COOKIE_OPTS)
    reply.clearCookie('sid', { path: '/' })
    return { ok: true }
  })

  // GET /auth/sessions
  fastify.get('/sessions', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT id, user_agent, ip_address, created_at, last_used_at
       FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY last_used_at DESC`,
      [req.userId]
    )
    return rows.map(s => ({ ...s, is_current: s.id === req.sessionId }))
  })

  // DELETE /auth/sessions/:id
  fastify.delete('/sessions/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await pool.query(
      'DELETE FROM sessions WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    )
    return { ok: true }
  })

  // POST /auth/forgot-password
  fastify.post('/forgot-password', async (req, reply) => {
    const { email } = req.body as { email: string }
    if (!email) return reply.status(400).send({ error: 'email is required' })

    const { rows } = await pool.query(
      'SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    )
    // Always return 200 to avoid email enumeration
    if (rows.length === 0) return { ok: true }

    const user = rows[0]
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = await hashToken(token)
    const expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    )
    await sendPasswordResetEmail(user.email, token)
    return { ok: true }
  })

  // POST /auth/reset-password
  fastify.post('/reset-password', async (req, reply) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string }
    if (!token || !newPassword) {
      return reply.status(400).send({ error: 'token and newPassword are required' })
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' })
    }

    const { rows } = await pool.query(
      `SELECT id, user_id, token_hash FROM password_reset_tokens
       WHERE expires_at > NOW() AND used_at IS NULL ORDER BY created_at DESC`,
    )

    let found = null
    for (const row of rows) {
      if (await verifyToken(token, row.token_hash)) { found = row; break }
    }
    if (!found) return reply.status(400).send({ error: 'Invalid or expired token' })

    const hash = await argon2.hash(newPassword, { type: argon2.argon2id })
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, found.user_id])
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [found.id]
    )
    // Revoke all sessions on password reset
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [found.user_id])
    return { ok: true }
  })

  // POST /auth/change-password
  fastify.post('/change-password', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string; newPassword: string
    }
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'currentPassword and newPassword are required' })
    }
    if (newPassword.length < 8) {
      return reply.status(400).send({ error: 'New password must be at least 8 characters' })
    }

    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.userId]
    )
    if (!rows[0] || !(await argon2.verify(rows[0].password_hash, currentPassword))) {
      return reply.status(401).send({ error: 'Current password is incorrect' })
    }

    const hash = await argon2.hash(newPassword, { type: argon2.argon2id })
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId])
    return { ok: true }
  })

  // DELETE /auth/account
  fastify.delete('/account', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { password } = req.body as { password: string }
    if (!password) return reply.status(400).send({ error: 'password is required' })

    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.userId]
    )
    if (!rows[0] || !(await argon2.verify(rows[0].password_hash, password))) {
      return reply.status(401).send({ error: 'Password is incorrect' })
    }

    // Delete rooms owned by user (cascades to messages + attachments)
    await pool.query(
      `UPDATE rooms SET deleted_at = NOW() WHERE owner_id = $1 AND deleted_at IS NULL`,
      [req.userId]
    )
    // Remove from other rooms
    await pool.query('DELETE FROM room_members WHERE user_id = $1', [req.userId])
    // Revoke sessions
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.userId])
    // Soft-delete user
    await pool.query(
      `UPDATE users SET deleted_at = NOW(), email = NULL, password_hash = NULL WHERE id = $1`,
      [req.userId]
    )
    reply.clearCookie(COOKIE_NAME, COOKIE_OPTS)
    return { ok: true }
  })
}

export default authRoutes
