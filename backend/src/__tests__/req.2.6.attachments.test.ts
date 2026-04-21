/**
 * Tests for Requirement 2.6 – Attachments
 * Focus: access control (2.6.4 / 2.6.5) and size limits (3.4)
 * File I/O is mocked so tests run without a filesystem.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-that-is-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_DAYS: 7,
    NODE_ENV: 'test', PORT: 3001, MAX_FILE_SIZE: 20971520, MAX_IMAGE_SIZE: 3145728,
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
  return { ...actual, existsSync: vi.fn().mockReturnValue(true), createReadStream: vi.fn().mockReturnValue(Buffer.from('file-content')) }
})
vi.mock('../services/files', () => ({
  saveFile: vi.fn().mockResolvedValue({ storedPath: '2024/01/uuid.txt', isImage: false, thumbPath: null }),
  getAbsolutePath: vi.fn((p: string) => `/tmp/test-uploads/${p}`),
}))

import { pool } from '../db/pool'
import { buildApp } from './helpers/buildApp'
import { makeToken } from './helpers/tokens'

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }
const MEMBER = 'user-member'
const OUTSIDER = 'user-outsider'
const memberToken = makeToken(MEMBER, 'sess-m', 'member')
const outsiderToken = makeToken(OUTSIDER, 'sess-o', 'outsider')
const ATT_ID = 'att-1'
const ROOM = 'room-1'

let app: FastifyInstance
beforeEach(async () => {
  mockPool.query.mockReset()
  if (!app) app = await buildApp()
})
afterAll(() => app?.close())

describe('2.6.4 – Access Control: room members only', () => {
  it('room member can download an attachment', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stored_path: '2024/01/uuid.txt', original_filename: 'doc.txt', mime_type: 'text/plain', room_id: ROOM }] })
      .mockResolvedValueOnce({ rows: [{ user_id: MEMBER }] }) // membership check passes

    const res = await app.inject({
      method: 'GET', url: `/api/v1/attachments/${ATT_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('non-member is denied access (403) to room attachment', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stored_path: '2024/01/uuid.txt', original_filename: 'doc.txt', mime_type: 'text/plain', room_id: ROOM }] })
      .mockResolvedValueOnce({ rows: [] }) // membership check fails (not a member)

    const res = await app.inject({
      method: 'GET', url: `/api/v1/attachments/${ATT_ID}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.6.5 – Persistence: banned/left user loses access', () => {
  it('user who left the room can no longer access its attachments', async () => {
    // After leaving, they are removed from room_members → same as non-member check
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stored_path: '2024/01/uuid.txt', original_filename: 'f.txt', mime_type: 'text/plain', room_id: ROOM }] })
      .mockResolvedValueOnce({ rows: [] }) // not in room_members after leaving

    const res = await app.inject({
      method: 'GET', url: `/api/v1/attachments/${ATT_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.6.3 – Attachment Metadata: original filename preserved', () => {
  it('download response includes Content-Disposition with original filename', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stored_path: '2024/01/uuid.pdf', original_filename: 'my report.pdf', mime_type: 'application/pdf', room_id: ROOM }] })
      .mockResolvedValueOnce({ rows: [{ user_id: MEMBER }] })

    const res = await app.inject({
      method: 'GET', url: `/api/v1/attachments/${ATT_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('my%20report.pdf')
  })
})
