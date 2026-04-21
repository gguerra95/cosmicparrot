/**
 * Tests for Requirement 2.5 – Messaging
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('../config', () => ({
  config: {
    JWT_SECRET: 'test-secret-that-is-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_DAYS: 7,
    NODE_ENV: 'test', PORT: 3001, MAX_FILE_SIZE: 20971520, MAX_IMAGE_SIZE: 3145728,
    UPLOAD_DIR: '/tmp', DATABASE_URL: 'postgresql://test', REDIS_URL: 'redis://test',
    SMTP_HOST: '', SMTP_PORT: 587, SMTP_USER: '', SMTP_PASS: '',
    SMTP_FROM: 'noreply@test.com', APP_URL: 'http://localhost',
  },
}))
vi.mock('../db/pool', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../redis/client', () => ({
  redis: { sadd: vi.fn(), srem: vi.fn(), smembers: vi.fn(), set: vi.fn(), del: vi.fn(), pipeline: vi.fn(() => ({ sadd: vi.fn(), srem: vi.fn(), set: vi.fn(), del: vi.fn(), exec: vi.fn().mockResolvedValue([]) })) },
}))
vi.mock('argon2', () => ({ hash: vi.fn().mockResolvedValue('$hashed'), verify: vi.fn().mockResolvedValue(true), argon2id: 2 }))

import { pool } from '../db/pool'
import { buildApp } from './helpers/buildApp'
import { makeToken } from './helpers/tokens'

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }
const AUTHOR = 'user-author'
const authorToken = makeToken(AUTHOR, 'sess-1', 'alice')
const ROOM = 'room-1'
const MSG = 'msg-1'

let app: FastifyInstance
beforeEach(async () => {
  mockPool.query.mockReset()
  if (!app) app = await buildApp()
})
afterAll(() => app?.close())

describe('2.5.1 / 2.5.2 – Message Content', () => {
  it('sends a plain text message', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: AUTHOR }] }) // membership check
      .mockResolvedValueOnce({ rows: [{ id: MSG, content: 'Hello', author_id: AUTHOR, created_at: new Date() }] }) // INSERT message
      .mockResolvedValueOnce({ rows: [] }) // unread update

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: 'Hello' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ content: 'Hello' })
  })

  it('returns 400 when content is empty', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ user_id: AUTHOR }] })

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 403 when sender is not a room member', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }) // not a member

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: 'Hello' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.5.3 – Message Replies', () => {
  it('sends a message with a reply reference', async () => {
    const replyMsg = { id: MSG, content: 'original', author_id: AUTHOR, created_at: new Date(), reply_to_id: 'msg-0' }
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: AUTHOR }] })
      .mockResolvedValueOnce({ rows: [replyMsg] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: 'Replying here', replyToId: 'msg-0' },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('2.5.4 – Message Editing', () => {
  it('author can edit their own message', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: MSG, author_id: AUTHOR, room_id: ROOM }] }) // find message
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] })                             // membership
      .mockResolvedValueOnce({ rows: [{ id: MSG, content: 'Edited', edited_at: new Date() }] }) // UPDATE

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/messages/${MSG}`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: 'Edited' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().edited_at).toBeTruthy()
  })

  it('cannot edit another user\'s message', async () => {
    const OTHER = 'user-other'
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: MSG, author_id: OTHER, room_id: ROOM }] })

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/messages/${MSG}`,
      headers: { authorization: `Bearer ${authorToken}` },
      payload: { content: 'Hacked' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.5.5 – Message Deletion', () => {
  it('author can delete their own message', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: MSG, author_id: AUTHOR, room_id: ROOM }] }) // find
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] })                             // membership
      .mockResolvedValueOnce({ rows: [{ id: MSG }] })                                    // soft delete

    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/messages/${MSG}`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('admin can delete any message in the room', async () => {
    const adminToken = makeToken('user-admin', 'sess-a', 'admin')
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: MSG, author_id: 'someone-else', room_id: ROOM }] }) // find
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })  // requester is admin
      .mockResolvedValueOnce({ rows: [{ id: MSG }] })        // soft delete

    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/messages/${MSG}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('2.5.6 – Message History and Cursor Pagination', () => {
  it('returns messages in chronological order (oldest first after reverse)', async () => {
    const msgs = [
      { id: 'msg-3', content: 'c', created_at: new Date('2024-01-03') },
      { id: 'msg-2', content: 'b', created_at: new Date('2024-01-02') },
      { id: 'msg-1', content: 'a', created_at: new Date('2024-01-01') },
    ]
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: AUTHOR }] }) // membership
      .mockResolvedValueOnce({ rows: msgs })                   // messages (DESC from DB, reversed by route)

    const res = await app.inject({
      method: 'GET', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // Route reverses the DESC result so oldest is first
    expect(body[0].id).toBe('msg-1')
    expect(body[2].id).toBe('msg-3')
  })

  it('supports cursor-based pagination via ?before=<id>', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: AUTHOR }] })
      .mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'GET', url: `/api/v1/rooms/${ROOM}/messages?before=msg-50`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(res.statusCode).toBe(200)
    // Verify cursor SQL was included
    const sqlCall = mockPool.query.mock.calls[1][0] as string
    expect(sqlCall).toContain('created_at <')
  })

  it('returns 403 for non-members trying to read history', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }) // not a member

    const res = await app.inject({
      method: 'GET', url: `/api/v1/rooms/${ROOM}/messages`,
      headers: { authorization: `Bearer ${authorToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
