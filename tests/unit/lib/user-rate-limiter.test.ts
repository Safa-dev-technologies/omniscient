import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { UserRateLimiter, resetUserRateLimiter } from '../../../src/lib/rate-limit/index.js';

// Mock logger
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('UserRateLimiter', () => {
  let mockRedis: {
    multi: ReturnType<typeof vi.fn>;
    zcount: ReturnType<typeof vi.fn>;
    zrangebyscore: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let rateLimiter: UserRateLimiter;

  const tenantId = 'tenant-123';
  const userId = 'user-456';

  beforeEach(() => {
    resetUserRateLimiter();

    // Create mock pipeline that returns chainable methods
    const createMockPipeline = () => {
      const pipeline = {
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(),
      };
      return pipeline;
    };

    const mockPipeline = createMockPipeline();

    mockRedis = {
      multi: vi.fn(() => mockPipeline),
      zcount: vi.fn(),
      zrangebyscore: vi.fn(),
      del: vi.fn(),
    };

    rateLimiter = new UserRateLimiter(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkAndRecord', () => {
    it('should allow requests under the minute limit', async () => {
      const pipeline = mockRedis.multi();
      // Results: [zremrangebyscore minute, zremrangebyscore hour, zcount minute, zcount hour]
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0], // zremrangebyscore minute
        [null, 0], // zremrangebyscore hour
        [null, 5], // zcount minute (under limit of 10)
        [null, 50], // zcount hour (under limit of 100)
      ]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // min(10-5-1, 100-50-1) = min(4, 49) = 4
      expect(result.retryAfter).toBeUndefined();
      expect(result.limitType).toBeUndefined();
    });

    it('should allow requests under the hour limit', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 0], // minute count = 0
        [null, 90], // hour count = 90 (under 100)
      ]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // min(10-0-1, 100-90-1) = min(9, 9) = 9
    });

    it('should deny requests at minute limit', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 10], // minute count = 10 (at limit)
        [null, 50],
      ]);

      // Mock oldest entry timestamp
      const now = Date.now();
      mockRedis.zrangebyscore.mockResolvedValue([`${now - 50000}:uuid-1`]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limitType).toBe('minute');
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });

    it('should deny requests at hour limit', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5], // minute count under limit
        [null, 100], // hour count at limit
      ]);

      // Mock oldest entry timestamp
      const now = Date.now();
      mockRedis.zrangebyscore.mockResolvedValue([`${now - 3500000}:uuid-1`]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limitType).toBe('hour');
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(3600);
    });

    it('should use tenant-specific limits when provided', async () => {
      const customLimits = { maxPerMinute: 5, maxPerHour: 50 };
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5], // At custom minute limit
        [null, 20],
      ]);

      mockRedis.zrangebyscore.mockResolvedValue([`${Date.now() - 30000}:uuid-1`]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId, customLimits);

      expect(result.allowed).toBe(false);
      expect(result.limitType).toBe('minute');
    });

    it('should fall back to default limits when not provided', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 9], // Under default limit of 10
        [null, 50],
      ]);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 10-9-1 = 0
    });

    it('should fail closed on Redis error', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis connection failed')
      );

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(60);
    });

    it('should fail closed when pipeline returns null', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await rateLimiter.checkAndRecord(tenantId, userId);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBe(60);
    });

    it('should record request on success', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5],
        [null, 50],
      ]);

      // Reset the call count after setup
      mockRedis.multi.mockClear();

      await rateLimiter.checkAndRecord(tenantId, userId);

      // Should have called multi twice - once for check, once for record
      expect(mockRedis.multi).toHaveBeenCalledTimes(2);
    });

    it('should use correct Redis key format', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5],
        [null, 50],
      ]);

      await rateLimiter.checkAndRecord(tenantId, userId);

      // Verify the zadd calls include the correct key pattern
      expect(pipeline.zadd).toHaveBeenCalled();
    });
  });

  describe('getUsage', () => {
    it('should return current minute and hour counts', async () => {
      mockRedis.zcount
        .mockResolvedValueOnce(7) // minute count
        .mockResolvedValueOnce(45); // hour count

      const usage = await rateLimiter.getUsage(tenantId, userId);

      expect(usage.minute).toBe(7);
      expect(usage.hour).toBe(45);
    });

    it('should return zeros on Redis error', async () => {
      mockRedis.zcount.mockRejectedValue(new Error('Redis error'));

      const usage = await rateLimiter.getUsage(tenantId, userId);

      expect(usage.minute).toBe(0);
      expect(usage.hour).toBe(0);
    });
  });

  describe('resetLimits', () => {
    it('should delete rate limit keys', async () => {
      mockRedis.del.mockResolvedValue(2);

      await rateLimiter.resetLimits(tenantId, userId);

      expect(mockRedis.del).toHaveBeenCalledWith(
        `ratelimit:chat:user:${tenantId}:${userId}:minute`,
        `ratelimit:chat:user:${tenantId}:${userId}:hour`
      );
    });

    it('should not throw on Redis error', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      await expect(rateLimiter.resetLimits(tenantId, userId)).resolves.not.toThrow();
    });
  });

  describe('multi-tenant isolation', () => {
    it('should use different keys for different tenants', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5],
        [null, 50],
      ]);

      // Reset the call count after setup
      mockRedis.multi.mockClear();

      await rateLimiter.checkAndRecord('tenant-A', userId);
      await rateLimiter.checkAndRecord('tenant-B', userId);

      // Each call creates a new multi() pipeline
      expect(mockRedis.multi).toHaveBeenCalledTimes(4); // 2 tenants * 2 calls each
    });

    it('should use different keys for different users', async () => {
      const pipeline = mockRedis.multi();
      (pipeline.exec as ReturnType<typeof vi.fn>).mockResolvedValue([
        [null, 0],
        [null, 0],
        [null, 5],
        [null, 50],
      ]);

      // Reset the call count after setup
      mockRedis.multi.mockClear();

      await rateLimiter.checkAndRecord(tenantId, 'user-A');
      await rateLimiter.checkAndRecord(tenantId, 'user-B');

      expect(mockRedis.multi).toHaveBeenCalledTimes(4);
    });
  });
});
