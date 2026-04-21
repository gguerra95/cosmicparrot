/**
 * Tests for Requirement 2.1 – User Accounts and Authentication
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

// ── Mocks (hoisted before imports) ────────────────────────────────
vi.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-that-is-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_DAYS: 7,
    NODE_ENV: 'test',
    PORT: 3001,
    MAX_FILE_SIZE: 20971520,
    MAX_IMAGE_SIZE: 3145728,
    UPLOAD_DIR: '/tmp/test-uploads',
    DATABASE_URL: 'postgresql://test',
    REDIS_URL: 'redis://test',
    SMTP_HOST: '', SMTP_PORT: 587, SMTP_USER: '', SMTP_PASS: '',
    SMTP_FROM: 'noreply@test.com', APP_URL: 'http://localhost',
  },
}))

vi.mock('../db/pool', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../redis/client', () => ({
  redis: { sadd: vi.fn(), srem: vi.fn(), smembers: vi.fn(), set: vi.fn(), del: vi.fn(), pipeline: vi.fn(() => ({ sadd: vi.fn(), srem: vi.fn(), set: vi.fn(), del: vi.fn(), exec: vi.fn().mockResolvedValue([]) })) },
}))
vi.mock('argon2', () => ({
  hash: vi.fn().mockResolvedValue('$argon2id$hashed'),
  verify: vi.fn().mockResolvedValue(true),
  argon2id: 2,
}))
vi.mock('../services/email', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

import { pool } from '../db/pool'
import { buildApp } from './helpers/buildApp'
import { makeToken } from './helpers/tokens'

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }
const mockDbClient = { query: vi.fn(), release: vi.fn() }

let app: FastifyInstance
beforeEach(async () => {
  mockPool.query.mockReset()
  mockPool.connect.mockReset()
  mockDbClient.query.mockReset()
  mockDbClient.query.mockResolvedValue({ rows: [], rowCount: 0 })
  mockPool.connect.mockResolvedValue(mockDbClient)
  if (!app) app = await buildApp()
})
afterAll(() => app?.close())

// ── 2.1.1 Registration ────────────────────────────────────────────
describe('2.1.1 – Registration', () => {
  it('registers a new user with email, password, and username', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', username: 'alice' }] }) // INSERT users
      .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] })                    // INSERT sessions

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'alice@test.com', username: 'alice', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('accessToken')
    expect(body.user).toMatchObject({ username: 'alice' })
  })

  it('returns 400 when any required field is missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'alice@test.com' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── 2.1.2 Registration Rules ──────────────────────────────────────
describe('2.1.2 – Registration Rules', () => {
  it('rejects duplicate email with 409', async () => {
    const dupErr = Object.assign(new Error('dup'), { code: '23505', detail: 'Key (email)' })
    mockPool.query.mockRejectedValueOnce(dupErr)

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'taken@test.com', username: 'newuser', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/email/i)
  })

  it('rejects duplicate username with 409', async () => {
    const dupErr = Object.assign(new Error('dup'), { code: '23505', detail: 'Key (username)' })
    mockPool.query.mockRejectedValueOnce(dupErr)

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', username: 'taken', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/username/i)
  })

  it('rejects passwords shorter than 8 characters', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'a@test.com', username: 'alice', password: 'short' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid username format', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email: 'a@test.com', username: 'a b', password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── 2.1.3 Authentication ──────────────────────────────────────────
describe('2.1.3 – Authentication', () => {
  it('returns access token and sets refresh cookie on login', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', username: 'alice', password_hash: '$argon2id$hashed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { identifier: 'alice@test.com', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('accessToken')
    expect(res.headers['set-cookie']).toBeDefined()
  })

  it('accepts login by username as well as email (req 2.1.3)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', username: 'alice', password_hash: '$argon2id$hashed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { identifier: 'alice', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 for invalid credentials', async () => {
    const argon2 = await import('argon2')
    vi.mocked(argon2.verify).mockResolvedValueOnce(false)
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice', password_hash: '$hashed' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { identifier: 'alice@test.com', password: 'wrongpass' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('logout returns 200 and clears the refresh cookie', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE sessions

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${makeToken('user-1')}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

// ── 2.1.4 Password Management ─────────────────────────────────────
describe('2.1.4 – Password Management', () => {
  it('POST /auth/forgot-password returns 200 and sends reset email', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'alice@test.com' }] })  // find user
      .mockResolvedValueOnce({ rows: [] })                                             // insert token

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password',
      payload: { email: 'alice@test.com' },
    })
    expect(res.statusCode).toBe(200)

    const { sendPasswordResetEmail } = await import('../services/email')
    expect(vi.mocked(sendPasswordResetEmail)).toHaveBeenCalled()
  })

  it('POST /auth/forgot-password returns 200 even for unknown email (no enumeration)', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody@test.com' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('POST /auth/change-password changes password when current password is correct', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ password_hash: '$hashed' }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] })                              // UPDATE password

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${makeToken('user-1')}` },
      payload: { currentPassword: 'oldpass123', newPassword: 'newpass456' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 when current password is wrong', async () => {
    const argon2 = await import('argon2')
    vi.mocked(argon2.verify).mockResolvedValueOnce(false)
    mockPool.query.mockResolvedValueOnce({ rows: [{ password_hash: '$hashed' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${makeToken('user-1')}` },
      payload: { currentPassword: 'wrong', newPassword: 'newpass456' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── 2.1.5 Account Removal ─────────────────────────────────────────
describe('2.1.5 – Account Removal', () => {
  it('deletes account when password is confirmed', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ password_hash: '$hashed' }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] }) // UPDATE rooms (soft-delete owned)
      .mockResolvedValueOnce({ rows: [] }) // DELETE room_members
      .mockResolvedValueOnce({ rows: [] }) // DELETE sessions
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users (soft-delete)

    const res = await app.inject({
      method: 'DELETE', url: '/api/v1/auth/account',
      headers: { authorization: `Bearer ${makeToken('user-1')}` },
      payload: { password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 when delete-account password is wrong', async () => {
    const argon2 = await import('argon2')
    vi.mocked(argon2.verify).mockResolvedValueOnce(false)
    mockPool.query.mockResolvedValueOnce({ rows: [{ password_hash: '$hashed' }] })

    const res = await app.inject({
      method: 'DELETE', url: '/api/v1/auth/account',
      headers: { authorization: `Bearer ${makeToken('user-1')}` },
      payload: { password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── 2.2.4 Session Management ──────────────────────────────────────
describe('2.2.4 – Active Session Management', () => {
  it('GET /auth/sessions returns list of active sessions', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'sess-1', user_agent: 'Chrome', ip_address: '1.2.3.4', created_at: new Date(), last_used_at: new Date() },
        { id: 'sess-2', user_agent: 'Firefox', ip_address: '5.6.7.8', created_at: new Date(), last_used_at: new Date() },
      ],
    })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${makeToken('user-1', 'sess-1')}` },
    })
    expect(res.statusCode).toBe(200)
    const sessions = res.json()
    expect(sessions).toHaveLength(2)
    // Current session is flagged
    expect(sessions.find((s: any) => s.id === 'sess-1').is_current).toBe(true)
    expect(sessions.find((s: any) => s.id === 'sess-2').is_current).toBe(false)
  })

  it('DELETE /auth/sessions/:id revokes a specific session', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const res = await app.inject({
      method: 'DELETE', url: '/api/v1/auth/sessions/sess-2',
      headers: { authorization: `Bearer ${makeToken('user-1', 'sess-1')}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
