/**
 * Tests for Requirement 2.4 – Chat Rooms
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
const mockDbClient = { query: vi.fn(), release: vi.fn() }
const OWNER = 'user-owner'
const MEMBER = 'user-member'
const ADMIN = 'user-admin'
const ownerToken = makeToken(OWNER, 'sess-owner', 'owner')
const memberToken = makeToken(MEMBER, 'sess-member', 'member')

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

describe('2.4.1 / 2.4.2 – Room Creation and Properties', () => {
  it('any authenticated user can create a room', async () => {
    mockDbClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'room-1', name: 'general', is_private: false, owner_id: OWNER }] }) // INSERT room
      .mockResolvedValueOnce({}) // INSERT owner member
      .mockResolvedValueOnce({}) // COMMIT

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'general', description: 'Main channel', is_private: false },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'general', is_private: false })
  })

  it('returns 409 when room name is already taken', async () => {
    mockDbClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
      .mockResolvedValueOnce({}) // ROLLBACK

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'taken' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('can create a private room', async () => {
    mockDbClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: 'room-2', name: 'secret', is_private: true, owner_id: OWNER }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'secret', is_private: true },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().is_private).toBe(true)
  })
})

describe('2.4.3 – Public Room Catalog', () => {
  it('returns public rooms with name, description, and member count', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'room-1', name: 'general', description: 'Main', is_private: false, member_count: 42, my_role: null },
      ],
    })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/rooms',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
    const rooms = res.json()
    expect(rooms[0]).toMatchObject({ name: 'general', member_count: 42 })
  })

  it('supports search by room name', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/rooms?search=eng',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
    // Verify search param was passed to query
    const queryCall = mockPool.query.mock.calls[0]
    expect(queryCall[1]).toContain('%eng%')
  })

  it('does not include private rooms in the public catalog', async () => {
    // Public catalog filters WHERE is_private = FALSE (enforced in SQL)
    // Test that the query string contains the filter
    mockPool.query.mockResolvedValueOnce({ rows: [] })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/rooms',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
    const sqlCall = mockPool.query.mock.calls[0][0] as string
    expect(sqlCall).toContain('is_private = FALSE')
  })
})

describe('2.4.4 – Private Room Access', () => {
  it('returns 403 when a non-member tries to access a private room', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'room-2', name: 'secret', is_private: true, my_role: null, is_banned: false }],
    })

    const res = await app.inject({
      method: 'GET', url: '/api/v1/rooms/room-2',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.4.5 – Joining and Leaving', () => {
  it('authenticated user can join a public room', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'room-1', is_private: false }] }) // room exists
      .mockResolvedValueOnce({ rows: [] })                                      // not banned
      .mockResolvedValueOnce({ rows: [] })                                      // INSERT member

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-1/join',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 403 when joining a private room directly', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'room-2', is_private: true }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-2/join',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('member can leave a room', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] }) // membership check
      .mockResolvedValueOnce({ rows: [] })                    // DELETE member

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-1/leave',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('owner cannot leave their own room', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ role: 'owner' }] })

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-1/leave',
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/owner/i)
  })
})

describe('2.4.6 – Room Deletion', () => {
  it('owner can delete the room', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ owner_id: OWNER }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] })                     // UPDATE deleted_at

    const res = await app.inject({
      method: 'DELETE', url: '/api/v1/rooms/room-1',
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('non-owner cannot delete the room', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ owner_id: OWNER }] })

    const res = await app.inject({
      method: 'DELETE', url: '/api/v1/rooms/room-1',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.4.7 – Admin Roles', () => {
  it('admin can change member role', async () => {
    const adminToken = makeToken(ADMIN, 'sess-admin', 'admin')
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })  // requester is admin
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] }) // target is not owner
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE role

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/rooms/room-1/members/${MEMBER}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('non-admin cannot change roles', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ role: 'member' }] })

    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/rooms/room-1/members/${OWNER}`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('2.4.8 – Room Ban Rules', () => {
  it('admin can ban a member (remove + add to ban list)', async () => {
    const adminToken = makeToken(ADMIN, 'sess-admin', 'admin')
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })  // requester role
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] }) // target role
    mockDbClient.query
      .mockResolvedValueOnce({})  // BEGIN
      .mockResolvedValueOnce({})  // DELETE member
      .mockResolvedValueOnce({})  // INSERT ban
      .mockResolvedValueOnce({})  // COMMIT

    const res = await app.inject({
      method: 'POST', url: `/api/v1/rooms/room-1/ban/${MEMBER}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('banned user cannot rejoin the room', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'room-1', is_private: false }] }) // room
      .mockResolvedValueOnce({ rows: [{ user_id: MEMBER }] })                  // ban record exists

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-1/join',
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/banned/i)
  })

  it('admin can unban a user', async () => {
    const adminToken = makeToken(ADMIN, 'sess-admin', 'admin')
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] }) // requester role
      .mockResolvedValueOnce({ rows: [] })                   // DELETE ban

    const res = await app.inject({
      method: 'DELETE', url: `/api/v1/rooms/room-1/ban/${MEMBER}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('2.4.9 – Room Invitations', () => {
  it('member can invite another user to a private room', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] }) // requester is member
      .mockResolvedValueOnce({ rows: [{ id: 'user-invite' }] }) // find target user
      .mockResolvedValueOnce({ rows: [] })                        // INSERT invitation

    const res = await app.inject({
      method: 'POST', url: '/api/v1/rooms/room-2/invite',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { username: 'newuser' },
    })
    expect(res.statusCode).toBe(200)
  })
})
