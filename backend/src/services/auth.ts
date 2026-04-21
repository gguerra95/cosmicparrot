import crypto from 'crypto'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { pool } from '../db/pool'
import { config } from '../config'
import type { JwtAccessPayload } from '../types'

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function hashToken(token: string): Promise<string> {
  return argon2.hash(token, { type: argon2.argon2id })
}

export async function verifyToken(token: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token)
  } catch {
    return false
  }
}

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN as string,
  } as jwt.SignOptions)
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, config.JWT_SECRET) as JwtAccessPayload
}

export async function createSession(
  userId: string,
  userAgent: string | null,
  ipAddress: string | null
): Promise<{ sessionId: string; refreshToken: string }> {
  const refreshToken = generateRefreshToken()
  const tokenHash = await hashToken(refreshToken)
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_EXPIRES_DAYS * 86400 * 1000)

  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4::inet, $5) RETURNING id`,
    [userId, tokenHash, userAgent, ipAddress, expiresAt]
  )
  return { sessionId: rows[0].id, refreshToken }
}

export async function rotateSession(
  sessionId: string
): Promise<{ refreshToken: string } | null> {
  const refreshToken = generateRefreshToken()
  const tokenHash = await hashToken(refreshToken)
  const expiresAt = new Date(Date.now() + config.JWT_REFRESH_EXPIRES_DAYS * 86400 * 1000)

  const { rows } = await pool.query(
    `UPDATE sessions
     SET refresh_token_hash = $1, last_used_at = NOW(), expires_at = $2
     WHERE id = $3 AND expires_at > NOW()
     RETURNING id`,
    [tokenHash, expiresAt, sessionId]
  )
  if (rows.length === 0) return null
  return { refreshToken }
}
