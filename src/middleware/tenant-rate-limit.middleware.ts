import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Rate limit configuration per operation type
 * Limits are per tenant, per minute
 */
const TENANT_LIMITS = {
  chat: { max: 60, windowSeconds: 60 }, // 60 req/min
  upload: { max: 10, windowSeconds: 60 }, // 10 req/min
  crawl: { max: 5, windowSeconds: 60 }, // 5 req/min
  search: { max: 100, windowSeconds: 60 }, // 100 req/min
} as const;

type LimitType = keyof typeof TENANT_LIMITS;

/**
 * Per-tenant rate limiting middleware factory
 *
 * Creates a preHandler that enforces rate limits per tenant for specific operation types.
 * Fails closed (blocks requests) when Redis is unavailable to prevent abuse.
 *
 * @param type - The operation type to rate limit (chat, upload, crawl, search)
 * @returns Fastify preHandler function
 *
 * @example
 * fastify.post('/chat', {
 *   preHandler: [requirePermission('chat'), tenantRateLimit('chat')],
 *   handler: controller.chat,
 * });
 */
export function tenantRateLimit(type: LimitType) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Auth middleware must have already set request.tenant
    const tenantId = request.tenant?.id;
    if (!tenantId) {
      // No tenant = auth middleware should have blocked this already
      // Log as warning for debugging but don't block (auth will handle it)
      logger.warn({ type }, 'Tenant rate limit called without tenant context');
      return;
    }

    const limit = TENANT_LIMITS[type];
    const key = `ratelimit:tenant:${type}:${tenantId}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        // Set expiry on first request in window
        await redis.expire(key, limit.windowSeconds);
      }

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', limit.max);
      reply.header('X-RateLimit-Remaining', Math.max(0, limit.max - count));

      if (count > limit.max) {
        const ttl = await redis.ttl(key);
        const retryAfter = ttl > 0 ? ttl : limit.windowSeconds;
        reply.header('Retry-After', retryAfter);

        logger.info({ tenantId, type, count, limit: limit.max, retryAfter }, 'Tenant rate limited');

        reply.status(429).send({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many ${type} requests. Please try again in ${retryAfter} seconds.`,
          },
        });
        return;
      }
    } catch (error) {
      // Fail closed - block requests when Redis is unavailable to prevent abuse
      logger.error({ error, tenantId, type }, 'Tenant rate limit check failed, blocking request');

      reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Rate limiting service temporarily unavailable. Please try again.',
        },
      });
      return;
    }
  };
}

/**
 * Get current rate limit status for a tenant (for monitoring/debugging)
 */
export async function getTenantRateLimitStatus(
  tenantId: string,
  type: LimitType
): Promise<{ count: number; remaining: number; resetIn: number }> {
  const limit = TENANT_LIMITS[type];
  const key = `ratelimit:tenant:${type}:${tenantId}`;

  try {
    const [countStr, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);

    const count = countStr ? parseInt(countStr, 10) : 0;

    return {
      count,
      remaining: Math.max(0, limit.max - count),
      resetIn: ttl > 0 ? ttl : 0,
    };
  } catch {
    return { count: 0, remaining: limit.max, resetIn: 0 };
  }
}
