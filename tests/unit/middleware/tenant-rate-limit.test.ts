import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock redis before importing the middleware
vi.mock('../../../src/lib/redis.js', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import {
  tenantRateLimit,
  getTenantRateLimitStatus,
} from '../../../src/middleware/tenant-rate-limit.middleware.js';
import { redis } from '../../../src/lib/redis.js';
import { logger } from '../../../src/lib/logger.js';

describe('Tenant Rate Limit Middleware', () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      tenant: { id: 'tenant-123' } as any,
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    };
  });

  describe('tenantRateLimit', () => {
    it('should allow request when under limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(redis.incr).toHaveBeenCalledWith('ratelimit:tenant:chat:tenant-123');
      expect(redis.expire).toHaveBeenCalledWith('ratelimit:tenant:chat:tenant-123', 60);
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 59);
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it('should set expiry only on first request in window', async () => {
      vi.mocked(redis.incr).mockResolvedValue(5);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(redis.expire).not.toHaveBeenCalled();
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 55);
    });

    it('should reject request when over limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(61); // Over chat limit of 60
      vi.mocked(redis.ttl).mockResolvedValue(45);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(429);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many chat requests. Please try again in 45 seconds.',
        },
      });
      expect(mockReply.header).toHaveBeenCalledWith('Retry-After', 45);
    });

    it('should use different limits for different operation types', async () => {
      // Upload limit is 10/min
      vi.mocked(redis.incr).mockResolvedValue(11);
      vi.mocked(redis.ttl).mockResolvedValue(30);

      const middleware = tenantRateLimit('upload');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(429);
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: expect.stringContaining('upload'),
          }),
        })
      );
    });

    it('should use crawl limit of 5/min', async () => {
      vi.mocked(redis.incr).mockResolvedValue(6);
      vi.mocked(redis.ttl).mockResolvedValue(50);

      const middleware = tenantRateLimit('crawl');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(429);
    });

    it('should use search limit of 100/min', async () => {
      vi.mocked(redis.incr).mockResolvedValue(99);

      const middleware = tenantRateLimit('search');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.status).not.toHaveBeenCalled();
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 1);
    });

    it('should fail closed on Redis error (block request)', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('Redis connection failed'));

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.status).toHaveBeenCalledWith(503);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Rate limiting service temporarily unavailable. Please try again.',
        },
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should skip rate limiting when tenant is not set', async () => {
      mockRequest.tenant = undefined;

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(redis.incr).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      expect(mockReply.status).not.toHaveBeenCalled();
    });

    it('should use default window when ttl is negative', async () => {
      vi.mocked(redis.incr).mockResolvedValue(61);
      vi.mocked(redis.ttl).mockResolvedValue(-1);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.header).toHaveBeenCalledWith('Retry-After', 60);
    });

    it('should use correct Redis key format', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1);

      const middleware = tenantRateLimit('upload');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(redis.incr).toHaveBeenCalledWith('ratelimit:tenant:upload:tenant-123');
    });
  });

  describe('getTenantRateLimitStatus', () => {
    it('should return current rate limit status', async () => {
      vi.mocked(redis.get).mockResolvedValue('25');
      vi.mocked(redis.ttl).mockResolvedValue(30);

      const status = await getTenantRateLimitStatus('tenant-123', 'chat');

      expect(status).toEqual({
        count: 25,
        remaining: 35, // 60 - 25
        resetIn: 30,
      });
    });

    it('should return defaults when key does not exist', async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.ttl).mockResolvedValue(-2);

      const status = await getTenantRateLimitStatus('tenant-123', 'chat');

      expect(status).toEqual({
        count: 0,
        remaining: 60,
        resetIn: 0,
      });
    });

    it('should return defaults on Redis error', async () => {
      vi.mocked(redis.get).mockRejectedValue(new Error('Redis error'));

      const status = await getTenantRateLimitStatus('tenant-123', 'upload');

      expect(status).toEqual({
        count: 0,
        remaining: 10, // upload limit
        resetIn: 0,
      });
    });
  });

  describe('multi-tenant isolation', () => {
    it('should use different keys for different tenants', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1);

      const middleware = tenantRateLimit('chat');

      mockRequest.tenant = { id: 'tenant-A' } as any;
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      mockRequest.tenant = { id: 'tenant-B' } as any;
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(redis.incr).toHaveBeenCalledWith('ratelimit:tenant:chat:tenant-A');
      expect(redis.incr).toHaveBeenCalledWith('ratelimit:tenant:chat:tenant-B');
    });
  });

  describe('rate limit headers', () => {
    it('should always set rate limit headers on success', async () => {
      vi.mocked(redis.incr).mockResolvedValue(30);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 30);
    });

    it('should set remaining to 0 when at limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(60);

      const middleware = tenantRateLimit('chat');
      await middleware(mockRequest as FastifyRequest, mockReply as FastifyReply);

      expect(mockReply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });
  });
});
