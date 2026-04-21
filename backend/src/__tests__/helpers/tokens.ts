import jwt from 'jsonwebtoken'

export const TEST_SECRET = 'test-secret-that-is-32-chars-long!!'

export function makeToken(
  userId: string,
  sessionId = 'sess-1',
  username = 'alice'
): string {
  return jwt.sign({ sub: userId, sid: sessionId, username }, TEST_SECRET, { expiresIn: '1h' })
}
