import crypto from 'node:crypto';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import type { WebSession } from './web.types.js';

/**
 * Session storage interface
 * Abstracts Redis vs in-memory storage
 */
interface SessionStorage {
  get(key: string): Promise<WebSession | null>;
  set(key: string, value: WebSession, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Redis-based session storage
 */
class RedisSessionStorage implements SessionStorage {
  private prefix = 'web:session:';

  private getKey(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  async get(sessionId: string): Promise<WebSession | null> {
    const key = this.getKey(sessionId);
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as WebSession;
  }

  async set(sessionId: string, session: WebSession, ttlSeconds: number): Promise<void> {
    const key = this.getKey(sessionId);
    await redis.setex(key, ttlSeconds, JSON.stringify(session));
  }

  async delete(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId);
    await redis.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const fullPattern = `${this.prefix}${pattern}`;
    const keys = await redis.keys(fullPattern);
    return keys.map((k) => k.replace(this.prefix, ''));
  }
}

/**
 * In-memory session storage (for development/testing)
 */
class MemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, { session: WebSession; expiresAt: number }>();

  async get(sessionId: string): Promise<WebSession | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return entry.session;
  }

  async set(sessionId: string, session: WebSession, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(sessionId, { session, expiresAt });
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async keys(pattern: string): Promise<string[]> {
    // Simple pattern matching (supports * wildcard)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const keys: string[] = [];
    for (const [key] of this.sessions) {
      if (regex.test(key)) {
        keys.push(key);
      }
    }
    return keys;
  }
}

/**
 * Session Manager
 * Handles web session lifecycle
 */
class SessionManager {
  private storage: SessionStorage;
  private defaultTtlMinutes: number;

  constructor(useRedis: boolean = true, defaultTtlMinutes: number = 30) {
    this.storage = useRedis ? new RedisSessionStorage() : new MemorySessionStorage();
    this.defaultTtlMinutes = defaultTtlMinutes;
  }

  /**
   * Generate a new session ID
   */
  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  /**
   * Validate session ID format (UUID v4)
   */
  validateSessionId(sessionId: string): boolean {
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(sessionId);
  }

  /**
   * Get or create session
   * If sessionId is provided and valid, retrieves it; otherwise creates new
   */
  async getOrCreateSession(
    tenantId: string,
    sessionId?: string,
    metadata?: Record<string, unknown>
  ): Promise<WebSession> {
    // If sessionId provided, try to get it
    if (sessionId) {
      if (!this.validateSessionId(sessionId)) {
        throw new Error('Invalid session ID format');
      }

      const existing = await this.storage.get(sessionId);
      if (existing && existing.tenantId === tenantId) {
        // Update last activity
        existing.lastActivityAt = new Date();
        await this.touchSession(sessionId);
        return existing;
      }
      // If session doesn't exist or belongs to different tenant, create new
    }

    // Create new session
    const newSessionId = this.generateSessionId();
    const now = new Date();
    const session: WebSession = {
      sessionId: newSessionId,
      tenantId,
      createdAt: now,
      lastActivityAt: now,
      metadata: metadata || {},
    };

    const ttlSeconds = this.defaultTtlMinutes * 60;
    await this.storage.set(newSessionId, session, ttlSeconds);

    logger.debug({ sessionId: newSessionId, tenantId }, 'Web session created');

    return session;
  }

  /**
   * Get existing session
   */
  async getSession(sessionId: string): Promise<WebSession | null> {
    if (!this.validateSessionId(sessionId)) {
      return null;
    }
    return this.storage.get(sessionId);
  }

  /**
   * Update session activity (extends TTL)
   */
  async touchSession(sessionId: string): Promise<void> {
    const session = await this.storage.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.lastActivityAt = new Date();
    const ttlSeconds = this.defaultTtlMinutes * 60;
    await this.storage.set(sessionId, session, ttlSeconds);
  }

  /**
   * Link session to conversation
   */
  async linkConversation(sessionId: string, conversationId: string): Promise<void> {
    const session = await this.storage.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.conversationId = conversationId;
    const ttlSeconds = this.defaultTtlMinutes * 60;
    await this.storage.set(sessionId, session, ttlSeconds);
  }

  /**
   * Link session to user
   */
  async linkUser(sessionId: string, userId: string): Promise<void> {
    const session = await this.storage.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.userId = userId;
    const ttlSeconds = this.defaultTtlMinutes * 60;
    await this.storage.set(sessionId, session, ttlSeconds);
  }

  /**
   * Clean up expired sessions
   * Returns number of sessions cleaned
   */
  async cleanExpiredSessions(maxAgeMinutes: number): Promise<number> {
    // This is a simplified implementation
    // In production with Redis, you'd use TTL-based cleanup
    // For memory storage, we check expiration on get
    // This method is mainly for explicit cleanup
    return 0; // Placeholder - actual cleanup handled by TTL
  }

  /**
   * Validate session belongs to tenant
   */
  async validateSession(sessionId: string, tenantId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    return session !== null && session.tenantId === tenantId;
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.delete(sessionId);
  }
}

/**
 * Create session manager instance
 * Uses Redis if available, falls back to memory
 */
export function createSessionManager(
  useRedis: boolean = true,
  defaultTtlMinutes: number = 30
): SessionManager {
  return new SessionManager(useRedis, defaultTtlMinutes);
}

export type { SessionManager };
