/**
 * Tests for Non-Functional Requirements (section 3)
 * 3.4 – File size limits
 * 3.3 – Message size limit (3KB per message)
 * 3.2 – Pagination cap (max 100 messages per request)
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-that-is-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_DAYS: 7,
    NODE_ENV: 'test', PORT: 3001,
    MAX_FILE_SIZE: 20971520,   // 20 MB
    MAX_IMAGE_SIZE: 3145728,   // 3 MB
    UPLOAD_DIR: '/tmp/test-uploads', DATABASE_URL: 'postgresql://test', REDIS_URL: 'redis://test',
    SMTP_HOST: '', SMTP_PORT: 587, SMTP_USER: '', SMTP_PASS: '',
    SMTP_FROM: 'noreply@test.com', APP_URL: 'http://localhost',
  },
}))
vi.mock('../db/pool', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../redis/client', () => ({
  redis: { sadd: vi.fn(), srem: vi.fn(), smembers: vi.fn(), set: vi.fn(), del: vi.fn(), pipeline: vi.fn(() => ({ sadd: vi.fn(), srem: vi.fn(), set: vi.fn(), del: vi.fn(), exec: vi.fn().mockResolvedValue([]) })) },
}))
vi.mock('argon2', () => ({ hash: vi.fn().mockResolvedValue('$hashed'), verify: vi.fn().mockResolvedValue(true), argon2id: 2 }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: vi.fn().mockReturnValue(true), createReadStream: vi.fn().mockReturnValue(Buffer.from('')) }
})
vi.mock('../services/files', () => ({
  saveFile: vi.fn().mockResolvedValue({ storedPath: '2024/01/uuid.txt', isImage: false, thumbPath: null }),
  getAbsolutePath: vi.fn((p: string) => `/tmp/test-uploads/${p}`),
}))

import { pool } from '../db/pool'
import { buildApp } from './helpers/buildApp'
import { makeToken } from './helpers/tokens'

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }
const USER = 'user-1'
const token = makeToken(USER, 'sess-1', 'alice')
const ROOM = 'room-1'

let app: FastifyInstance
beforeEach(async () => {
  mockPool.query.mockReset()
  if (!app) app = await buildApp()
})
afterAll(() => app?.close())

describe('3.4 – Maximum File Sizes', () => {
  it('rejects images larger than 3 MB with 413', async () => {
    // Simulate upload of image that exceeds MAX_IMAGE_SIZE (3145728 bytes)
    // We test by checking the route logic directly with a mocked file that reports a large size
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: USER }] }) // membership

    const { saveFile } = await import('../services/files')
    // Override saveFile to capture that it would NOT be called if file too large
    vi.mocked(saveFile).mockResolvedValueOnce({ storedPath: '', isImage: true, thumbPath: null })

    // Build a multipart body with a 3MB+ image payload
    const bigImageBuffer = Buffer.alloc(3145729) // 3MB + 1 byte
    const boundary = '----TestBoundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      bigImageBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/attachments`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toMatch(/3MB/i)
  })

  it('rejects files larger than 20 MB with 413', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: USER }] })

    const bigFileBuffer = Buffer.alloc(20971521) // 20MB + 1 byte
    const boundary = '----TestBoundary2'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      bigFileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ])

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/attachments`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toMatch(/20MB/i)
  })
})

describe('3.3 / 2.5.2 – Message Size Limit (3 KB)', () => {
  it('rejects messages exceeding 3072 bytes', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: USER }] }) // membership

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'x'.repeat(3073) },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/3KB/i)
  })

  it('accepts messages exactly at the 3072-byte limit', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: USER }] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1', content: 'x'.repeat(3072), author_id: USER, created_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'x'.repeat(3072) },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('3.2 – Pagination Cap', () => {
  it('caps returned messages at 100 even if a higher limit is requested', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: USER }] })
      .mockResolvedValueOnce({ rows: [] })

    await app.inject({
      method: 'GET', url: `/api/v1/rooms/${ROOM}/messages?limit=500`,
      headers: { authorization: `Bearer ${token}` },
    })

    const sqlCall = mockPool.query.mock.calls[1][0] as string
    // Route caps at 100: Math.min(parseInt(limit), 100)
    expect(sqlCall).toContain('LIMIT $2')
    const params = mockPool.query.mock.calls[1][1] as unknown[]
    expect(params[1]).toBe(100) // capped value
  })
})

describe('3.6 – Consistency: unauthenticated requests are rejected', () => {
  it('returns 401 on all protected endpoints without a token', async () => {
    const endpoints = [
      { method: 'GET' as const,    url: '/api/v1/rooms' },
      { method: 'POST' as const,   url: '/api/v1/rooms' },
      { method: 'GET' as const,    url: '/api/v1/friends' },
      { method: 'GET' as const,    url: '/api/v1/auth/sessions' },
    ]
    for (const { method, url } of endpoints) {
      const res = await app.inject({ method, url })
      expect(res.statusCode, `${method} ${url} should return 401`).toBe(401)
    }
  })
})
