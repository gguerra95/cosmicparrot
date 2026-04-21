/**
 * Tests for Requirement 2.3 – Contacts / Friends
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
const ALICE = 'user-alice'
const BOB = 'user-bob'
const aliceToken = makeToken(ALICE, 'sess-alice', 'alice')
const bobToken = makeToken(BOB, 'sess-bob', 'bob')

let app: FastifyInstance
beforeEach(async () => {
  mockPool.query.mockReset()
  if (!app) app = await buildApp()
})
afterAll(() => app?.close())

describe('2.3.1 / 2.3.2 – Friend List and Sending Requests', () => {
  it('GET /friends returns list of friends and pending requests', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: BOB, username: 'bob', avatar_path: null, direction: 'sent', status: 'accepted', friendship_id: 'f-1', message: null },
      ],
    })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/friends',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(1)
  })

  it('sends a friend request by username', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: BOB }] })       // find user by username
      .mockResolvedValueOnce({ rows: [] })                    // check bans
      .mockResolvedValueOnce({ rows: [{ id: 'f-1', requester_id: ALICE, addressee_id: BOB }] }) // INSERT

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: 'bob', message: 'Hey!' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('returns 404 when target username does not exist', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: 'nobody' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 409 when a request already exists', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: BOB }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: { username: 'bob' },
    })
    expect(res.statusCode).toBe(409)
  })
})

describe('2.3.3 – Friendship Confirmation', () => {
  it('accepts a pending friend request', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'f-1', requester_id: BOB, addressee_id: ALICE, status: 'accepted' }],
    })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request/f-1/accept',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 404 when request does not exist or is not addressed to this user', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request/f-1/accept',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('declines a pending friend request', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'f-1' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request/f-1/decline',
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('2.3.4 – Removing Friends', () => {
  it('removes a friend', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/friends/${BOB}`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('2.3.5 – User-to-User Ban', () => {
  it('banning a user blocks future friend requests from them', async () => {
    // First establish a ban
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: BOB }] })   // find user
      .mockResolvedValueOnce({ rows: [{ id: 'ban-1' }] }) // INSERT ban
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // DELETE friendship
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })    // freeze DM

    const banRes = await app.inject({
      method: 'POST', url: `/api/v1/friends/${BOB}/ban`,
      headers: { authorization: `Bearer ${aliceToken}` },
    })
    expect(banRes.statusCode).toBe(200)
  })

  it('banned user cannot send a friend request (returns 403)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: ALICE }] })  // find target user
      .mockResolvedValueOnce({ rows: [{ id: 'ban-1' }] }) // ban check returns a row

    const res = await app.inject({
      method: 'POST', url: '/api/v1/friends/request',
      headers: { authorization: `Bearer ${bobToken}` },
      payload: { username: 'alice' },
    })
    expect(res.statusCode).toBe(403)
  })
})
