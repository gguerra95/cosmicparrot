/**
 * Tests for Requirement 2.2 – User Presence and Sessions
 * Presence logic is pure (depends only on Redis), so we test it directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────
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

const mockPipeline = {
  sadd: vi.fn().mockReturnThis(),
  srem: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  del: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
}
vi.mock('../redis/client', () => ({
  redis: {
    sadd: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    pipeline: vi.fn(() => mockPipeline),
  },
}))

import { redis } from '../redis/client'
import {
  registerTab, unregisterTab, setTabActive, setTabIdle,
  derivePresence, tabsKey, tabIdleKey,
} from '../redis/presence'

const mockRedis = redis as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.mocked(redis.smembers).mockReset()
  vi.mocked(redis.sadd).mockReset()
  vi.mocked(redis.srem).mockReset()
  vi.clearAllMocks()
  mockPipeline.exec.mockResolvedValue([])
})

describe('2.2.1 – Presence States', () => {
  it('derives "online" when at least one tab exists and none are idle', async () => {
    vi.mocked(redis.smembers)
      .mockResolvedValueOnce(['tab-1', 'tab-2'])  // allTabs
      .mockResolvedValueOnce([])                   // idleTabs

    const status = await derivePresence('user-1')
    expect(status).toBe('online')
  })

  it('derives "offline" when no tabs are registered', async () => {
    vi.mocked(redis.smembers)
      .mockResolvedValueOnce([])   // allTabs empty
      .mockResolvedValueOnce([])   // idleTabs

    const status = await derivePresence('user-1')
    expect(status).toBe('offline')
  })
})

describe('2.2.2 – AFK Rule', () => {
  it('derives "afk" when all tabs are in the idle set', async () => {
    vi.mocked(redis.smembers)
      .mockResolvedValueOnce(['tab-1', 'tab-2'])          // allTabs
      .mockResolvedValueOnce(['tab-1', 'tab-2'])          // idleTabs (all idle)

    const status = await derivePresence('user-1')
    expect(status).toBe('afk')
  })

  it('derives "online" when at least one tab is still active', async () => {
    vi.mocked(redis.smembers)
      .mockResolvedValueOnce(['tab-1', 'tab-2'])   // allTabs
      .mockResolvedValueOnce(['tab-2'])             // only tab-2 is idle, tab-1 is active

    const status = await derivePresence('user-1')
    expect(status).toBe('online')
  })
})

describe('2.2.3 – Multi-Tab Support', () => {
  it('registerTab adds the tab to the tabs set with a TTL key', async () => {
    await registerTab('user-1', 'tab-1')
    expect(mockPipeline.sadd).toHaveBeenCalledWith(tabsKey('user-1'), 'tab-1')
    expect(mockPipeline.set).toHaveBeenCalledWith(
      expect.stringContaining('tab_ttl:user-1:tab-1'),
      '1', 'EX', expect.any(Number)
    )
    expect(mockPipeline.exec).toHaveBeenCalled()
  })

  it('unregisterTab removes tab from both tabs and idle sets', async () => {
    await unregisterTab('user-1', 'tab-1')
    expect(mockPipeline.srem).toHaveBeenCalledWith(tabsKey('user-1'), 'tab-1')
    expect(mockPipeline.srem).toHaveBeenCalledWith(tabIdleKey('user-1'), 'tab-1')
  })

  it('setTabIdle adds tab to idle set', async () => {
    vi.mocked(redis.sadd).mockResolvedValueOnce(1)
    await setTabIdle('user-1', 'tab-1')
    expect(redis.sadd).toHaveBeenCalledWith(tabIdleKey('user-1'), 'tab-1')
  })

  it('setTabActive removes tab from idle set', async () => {
    await setTabActive('user-1', 'tab-1')
    expect(mockPipeline.srem).toHaveBeenCalledWith(tabIdleKey('user-1'), 'tab-1')
  })

  it('user becomes offline only when all tabs are closed', async () => {
    // Simulate: two tabs, close one → still has one → online
    vi.mocked(redis.smembers)
      .mockResolvedValueOnce(['tab-2'])  // allTabs after closing tab-1
      .mockResolvedValueOnce([])          // none idle

    const status = await derivePresence('user-1')
    expect(status).toBe('online')
  })
})
