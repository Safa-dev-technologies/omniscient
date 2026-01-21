import { randomBytes } from 'crypto';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours
const SESSION_PREFIX = 'admin:session:';

export interface AdminSession {
  sessionId: string;
  username: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a new admin session
 *
 * @param username - Admin username
 * @param metadata - Optional metadata (IP address, user agent)
 * @returns Session ID (64-character hex string)
 */
export async function createSession(
  username: string,
  metadata?: { ipAddress?: string; userAgent?: string }
): Promise<string> {
  const sessionId = randomBytes(32).toString('hex');
  const now = new Date();

  const session: AdminSession = {
    sessionId,
    username,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ipAddress: metadata?.ipAddress,
    userAgent: metadata?.userAgent,
  };

  await redis.setex(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL_SECONDS, JSON.stringify(session));

  logger.info({ username, sessionId: sessionId.substring(0, 8) + '...' }, 'Admin session created');

  return sessionId;
}

/**
 * Validate a session and refresh its TTL (sliding expiration)
 *
 * @param sessionId - Session ID to validate
 * @returns Session data if valid, null if invalid or expired
 */
export async function validateSession(sessionId: string): Promise<AdminSession | null> {
  // Basic validation - session ID should be 64 hex characters
  if (!sessionId || sessionId.length !== 64 || !/^[a-f0-9]+$/i.test(sessionId)) {
    return null;
  }

  const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!data) {
    return null;
  }

  const session: AdminSession = JSON.parse(data);

  // Update last activity and refresh TTL (sliding expiration)
  const now = new Date();
  session.lastActivityAt = now.toISOString();
  session.expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await redis.setex(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL_SECONDS, JSON.stringify(session));

  return session;
}

/**
 * Revoke a specific session
 *
 * @param sessionId - Session ID to revoke
 * @returns true if session was found and revoked, false otherwise
 */
export async function revokeSession(sessionId: string): Promise<boolean> {
  const deleted = await redis.del(`${SESSION_PREFIX}${sessionId}`);
  if (deleted > 0) {
    logger.info({ sessionId: sessionId.substring(0, 8) + '...' }, 'Admin session revoked');
  }
  return deleted > 0;
}

/**
 * Revoke all sessions for a specific username
 * Uses SCAN for non-blocking iteration (safe for production)
 *
 * @param username - Username to revoke all sessions for
 * @returns Number of sessions revoked
 */
export async function revokeAllSessions(username: string): Promise<number> {
  let cursor = '0';
  let revokedCount = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_PREFIX}*`,
      'COUNT',
      100
    );
    cursor = nextCursor;

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const session: AdminSession = JSON.parse(data);
        if (session.username === username) {
          await redis.del(key);
          revokedCount++;
        }
      }
    }
  } while (cursor !== '0');

  if (revokedCount > 0) {
    logger.info({ username, revokedCount }, 'Admin sessions revoked for user');
  }

  return revokedCount;
}

/**
 * List all active admin sessions
 * Uses SCAN for non-blocking iteration (safe for production)
 *
 * @returns Array of active sessions, sorted by last activity (most recent first)
 */
export async function listActiveSessions(): Promise<AdminSession[]> {
  let cursor = '0';
  const sessions: AdminSession[] = [];

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_PREFIX}*`,
      'COUNT',
      100
    );
    cursor = nextCursor;

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        sessions.push(JSON.parse(data));
      }
    }
  } while (cursor !== '0');

  // Sort by last activity (most recent first)
  return sessions.sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  );
}

/**
 * Get session count for monitoring
 */
export async function getSessionCount(): Promise<number> {
  let cursor = '0';
  let count = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${SESSION_PREFIX}*`,
      'COUNT',
      100
    );
    cursor = nextCursor;
    count += keys.length;
  } while (cursor !== '0');

  return count;
}
