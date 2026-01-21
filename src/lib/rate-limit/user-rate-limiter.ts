import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { logger } from '../logger.js';
import type { UserRateLimitConfig, RateLimitResult } from './rate-limit.types.js';
import { DEFAULT_USER_RATE_LIMITS } from './rate-limit.types.js';

/**
 * Per-user rate limiter using Redis sorted sets (sliding window algorithm)
 *
 * This limiter enforces per-minute and per-hour message limits for users.
 * Uses the same pattern as TenantRateLimiter but optimized for chat messages.
 */
export class UserRateLimiter {
  private readonly keyPrefix = 'ratelimit:chat:user';

  constructor(
    private redis: Redis,
    private defaultLimits: UserRateLimitConfig = DEFAULT_USER_RATE_LIMITS
  ) {}

  /**
   * Check if user can send a message and record the attempt if allowed
   *
   * @param tenantId - Tenant ID for isolation
   * @param userId - User ID to rate limit
   * @param limits - Optional custom limits (from tenant settings)
   * @returns RateLimitResult with allowed status and metadata
   */
  async checkAndRecord(
    tenantId: string,
    userId: string,
    limits?: UserRateLimitConfig
  ): Promise<RateLimitResult> {
    const config = limits ?? this.defaultLimits;
    const now = Date.now();

    const minuteKey = `${this.keyPrefix}:${tenantId}:${userId}:minute`;
    const hourKey = `${this.keyPrefix}:${tenantId}:${userId}:hour`;

    try {
      // Clean old entries and count current window in one pipeline
      const pipeline = this.redis.multi();

      const minuteWindowStart = now - 60000;
      const hourWindowStart = now - 3600000;

      // Remove expired entries
      pipeline.zremrangebyscore(minuteKey, 0, minuteWindowStart);
      pipeline.zremrangebyscore(hourKey, 0, hourWindowStart);

      // Count current entries
      pipeline.zcount(minuteKey, minuteWindowStart, now);
      pipeline.zcount(hourKey, hourWindowStart, now);

      const results = await pipeline.exec();

      if (!results) {
        // Fail closed - block requests when Redis is unavailable to prevent abuse
        logger.error({ tenantId, userId }, 'Rate limiter pipeline returned null, blocking request');
        return this.createBlockedResult();
      }

      // Extract counts from results
      // Pipeline results are: [error, result] pairs
      const minuteCount = (results[2]?.[1] as number) || 0;
      const hourCount = (results[3]?.[1] as number) || 0;

      // Check minute limit
      if (minuteCount >= config.maxPerMinute) {
        const retryAfter = await this.calculateRetryAfter(minuteKey, minuteWindowStart, 60000, now);

        logger.info(
          { tenantId, userId, minuteCount, limit: config.maxPerMinute, retryAfter },
          'User rate limited (minute)'
        );

        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(now + retryAfter * 1000),
          retryAfter,
          limitType: 'minute',
        };
      }

      // Check hour limit
      if (hourCount >= config.maxPerHour) {
        const retryAfter = await this.calculateRetryAfter(hourKey, hourWindowStart, 3600000, now);

        logger.info(
          { tenantId, userId, hourCount, limit: config.maxPerHour, retryAfter },
          'User rate limited (hour)'
        );

        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(now + retryAfter * 1000),
          retryAfter,
          limitType: 'hour',
        };
      }

      // Allowed - record this request
      const messageId = `${now}:${randomUUID()}`;
      await this.redis
        .multi()
        .zadd(minuteKey, now, messageId)
        .expire(minuteKey, 120) // 2 minute TTL
        .zadd(hourKey, now, messageId)
        .expire(hourKey, 7200) // 2 hour TTL
        .exec();

      // Calculate remaining as the minimum of both limits
      const remaining = Math.min(
        config.maxPerMinute - minuteCount - 1,
        config.maxPerHour - hourCount - 1
      );

      return {
        allowed: true,
        remaining: Math.max(0, remaining),
        resetAt: new Date(now + 60000),
      };
    } catch (error) {
      // Fail closed - block requests when Redis is unavailable to prevent abuse
      logger.error({ tenantId, userId, error }, 'Rate limiter error, blocking request');
      return this.createBlockedResult();
    }
  }

  /**
   * Calculate how long until the user can retry
   * Based on when the oldest entry in the window will expire
   */
  private async calculateRetryAfter(
    key: string,
    windowStart: number,
    windowDuration: number,
    now: number
  ): Promise<number> {
    try {
      // Get the oldest entry in the current window
      const oldest = await this.redis.zrangebyscore(key, windowStart, '+inf', 'LIMIT', 0, 1);

      if (oldest && oldest.length > 0) {
        // Extract timestamp from the entry (format: "timestamp:uuid")
        const parts = oldest[0].split(':');
        const oldestTimestamp = parseInt(parts[0], 10);

        if (!isNaN(oldestTimestamp)) {
          // Calculate when this entry will expire
          const expiresAt = oldestTimestamp + windowDuration;
          const retryAfter = Math.ceil((expiresAt - now) / 1000);
          return Math.max(1, retryAfter);
        }
      }

      // Fallback to full window if we can't determine
      return Math.ceil(windowDuration / 1000);
    } catch {
      // On error, return conservative estimate
      return Math.ceil(windowDuration / 1000);
    }
  }

  /**
   * Create a result indicating the request is allowed
   */
  private createAllowedResult(config: UserRateLimitConfig): RateLimitResult {
    return {
      allowed: true,
      remaining: config.maxPerMinute,
      resetAt: new Date(Date.now() + 60000),
    };
  }

  /**
   * Create a result indicating the request is blocked (for error scenarios)
   * Fail closed to prevent abuse when Redis is unavailable
   */
  private createBlockedResult(): RateLimitResult {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60000),
      retryAfter: 60,
    };
  }

  /**
   * Get current usage for a user (for debugging/monitoring)
   */
  async getUsage(tenantId: string, userId: string): Promise<{ minute: number; hour: number }> {
    const now = Date.now();
    const minuteKey = `${this.keyPrefix}:${tenantId}:${userId}:minute`;
    const hourKey = `${this.keyPrefix}:${tenantId}:${userId}:hour`;

    try {
      const [minuteCount, hourCount] = await Promise.all([
        this.redis.zcount(minuteKey, now - 60000, now),
        this.redis.zcount(hourKey, now - 3600000, now),
      ]);

      return { minute: minuteCount, hour: hourCount };
    } catch (error) {
      logger.warn({ tenantId, userId, error }, 'Failed to get rate limit usage');
      return { minute: 0, hour: 0 };
    }
  }

  /**
   * Reset rate limits for a user (admin operation)
   */
  async resetLimits(tenantId: string, userId: string): Promise<void> {
    const minuteKey = `${this.keyPrefix}:${tenantId}:${userId}:minute`;
    const hourKey = `${this.keyPrefix}:${tenantId}:${userId}:hour`;

    try {
      await this.redis.del(minuteKey, hourKey);
      logger.info({ tenantId, userId }, 'Rate limits reset for user');
    } catch (error) {
      logger.warn({ tenantId, userId, error }, 'Failed to reset rate limits');
    }
  }
}

// Singleton instance
let instance: UserRateLimiter | null = null;

/**
 * Get or create the UserRateLimiter singleton
 */
export function getUserRateLimiter(redis: Redis): UserRateLimiter {
  if (!instance) {
    instance = new UserRateLimiter(redis);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetUserRateLimiter(): void {
  instance = null;
}
