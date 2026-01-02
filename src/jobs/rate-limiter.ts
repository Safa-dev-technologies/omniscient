import type { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface RateLimitConfig {
  maxConcurrent: number; // Max concurrent jobs per tenant
  maxPerMinute: number; // Max jobs started per minute
  maxPerHour: number; // Max jobs started per hour
}

const DEFAULT_LIMITS: RateLimitConfig = {
  maxConcurrent: 5, // 5 concurrent document processing jobs
  maxPerMinute: 20, // 20 jobs/minute
  maxPerHour: 200, // 200 jobs/hour
};

export class TenantRateLimiter {
  constructor(
    private redis: Redis,
    private queueName: string,
    private limits: RateLimitConfig = DEFAULT_LIMITS
  ) {}

  async canProcess(tenantId: string): Promise<boolean> {
    try {
      const now = Date.now();
      const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
      const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;
      const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;

      // Check concurrent limit
      const concurrent = await this.redis.get(concurrentKey);
      if (concurrent && parseInt(concurrent) >= this.limits.maxConcurrent) {
        logger.debug({ tenantId, queueName: this.queueName, concurrent }, 'Rate limited: concurrent limit');
        return false;
      }

      // Check per-minute limit
      const minuteCount = await this.redis.zcount(minuteKey, now - 60000, now);
      if (minuteCount >= this.limits.maxPerMinute) {
        logger.debug({ tenantId, queueName: this.queueName, minuteCount }, 'Rate limited: per-minute limit');
        return false;
      }

      // Check per-hour limit
      const hourCount = await this.redis.zcount(hourKey, now - 3600000, now);
      if (hourCount >= this.limits.maxPerHour) {
        logger.debug({ tenantId, queueName: this.queueName, hourCount }, 'Rate limited: per-hour limit');
        return false;
      }

      return true;
    } catch (error) {
      // Fail open - allow processing if Redis is unavailable
      logger.warn({ tenantId, queueName: this.queueName, error }, 'Rate limiter error, allowing processing');
      return true;
    }
  }

  async startJob(tenantId: string, jobId: string): Promise<void> {
    try {
      const now = Date.now();
      const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
      const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;
      const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;

      await this.redis
        .multi()
        // Increment concurrent
        .incr(concurrentKey)
        .expire(concurrentKey, 3600) // 1 hour TTL
        // Add to minute window
        .zadd(minuteKey, now, jobId)
        .expire(minuteKey, 120) // 2 minute TTL
        // Add to hour window
        .zadd(hourKey, now, jobId)
        .expire(hourKey, 7200) // 2 hour TTL
        .exec();
    } catch (error) {
      logger.warn({ tenantId, jobId, error }, 'Failed to track job start in rate limiter');
      // Don't throw - rate limiting is best effort
    }
  }

  async endJob(tenantId: string): Promise<void> {
    try {
      const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;
      await this.redis.decr(concurrentKey);
    } catch (error) {
      logger.warn({ tenantId, error }, 'Failed to decrement concurrent count');
      // Don't throw - rate limiting is best effort
    }
  }

  async cleanupOldEntries(tenantId: string): Promise<void> {
    try {
      const now = Date.now();
      const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
      const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;

      await this.redis
        .multi()
        .zremrangebyscore(minuteKey, 0, now - 60000)
        .zremrangebyscore(hourKey, 0, now - 3600000)
        .exec();
    } catch (error) {
      logger.warn({ tenantId, error }, 'Failed to cleanup rate limit entries');
      // Don't throw - cleanup is best effort
    }
  }
}
