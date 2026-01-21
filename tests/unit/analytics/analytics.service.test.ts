import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockTenantId,
  mockDateRange,
  mockOverviewData,
} from '../../fixtures/analytics.fixtures.js';

// Mock prisma
vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrisma = {
    conversation: {
      count: vi.fn(),
    },
    message: {
      count: vi.fn(),
    },
    escalation: {
      count: vi.fn(),
    },
    knowledgeSource: {
      count: vi.fn(),
    },
    knowledgeChunk: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn((str: string) => str),
  };
  return { prisma: mockPrisma };
});

// Mock redis
vi.mock('../../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null), // Cache miss by default
    setex: vi.fn().mockResolvedValue('OK'),
  },
}));

// Mock logger
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { prisma } = await import('../../../src/lib/prisma.js');
const { redis } = await import('../../../src/lib/redis.js');
import * as analyticsService from '../../../src/modules/analytics/analytics.service.js';

describe('Analytics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOverview', () => {
    it('should return overview metrics', async () => {
      // Mock all count queries - these run in parallel via Promise.all
      vi.mocked(prisma.conversation.count)
        .mockResolvedValueOnce(100) // totalConversations
        .mockResolvedValueOnce(15); // activeConversations

      vi.mocked(prisma.message.count).mockResolvedValueOnce(500); // totalMessages
      vi.mocked(prisma.escalation.count).mockResolvedValueOnce(10); // escalationCount
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValueOnce(25); // knowledgeSources
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ avg: 3.5 }]); // avgResponseTime

      const result = await analyticsService.getOverview(mockTenantId, mockDateRange);

      expect(result.totalConversations).toBe(100);
      expect(result.activeConversations).toBe(15);
      expect(result.totalMessages).toBe(500);
      expect(result.escalationCount).toBe(10);
      expect(result.knowledgeSources).toBe(25);
      expect(result.avgResponseTime).toBe(4); // Rounded
      expect(result.dateRange).toBeDefined();
    });

    it('should use cache when available', async () => {
      const cachedData = JSON.stringify(mockOverviewData);
      vi.mocked(redis.get).mockResolvedValueOnce(cachedData);

      const result = await analyticsService.getOverview(mockTenantId, mockDateRange);

      // JSON.parse converts dates to ISO strings, so compare properties individually
      expect(result.totalConversations).toBe(mockOverviewData.totalConversations);
      expect(result.activeConversations).toBe(mockOverviewData.activeConversations);
      expect(result.totalMessages).toBe(mockOverviewData.totalMessages);
      expect(result.escalationCount).toBe(mockOverviewData.escalationCount);
      expect(result.knowledgeSources).toBe(mockOverviewData.knowledgeSources);
      expect(result.avgResponseTime).toBe(mockOverviewData.avgResponseTime);
      expect(prisma.conversation.count).not.toHaveBeenCalled();
    });

    it('should cache computed results', async () => {
      vi.mocked(redis.get).mockResolvedValueOnce(null); // Cache miss
      vi.mocked(prisma.conversation.count).mockResolvedValue(100);
      vi.mocked(prisma.message.count).mockResolvedValue(500);
      vi.mocked(prisma.escalation.count).mockResolvedValue(10);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(25);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: null }]);

      await analyticsService.getOverview(mockTenantId, mockDateRange);

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('analytics:'),
        300, // TTL
        expect.any(String)
      );
    });

    it('should handle null avgResponseTime', async () => {
      vi.mocked(prisma.conversation.count).mockResolvedValue(0);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.escalation.count).mockResolvedValue(0);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: null }]);

      const result = await analyticsService.getOverview(mockTenantId, mockDateRange);

      expect(result.avgResponseTime).toBeNull();
    });

    it('should use default date range when not provided', async () => {
      vi.mocked(prisma.conversation.count).mockResolvedValue(50);
      vi.mocked(prisma.message.count).mockResolvedValue(200);
      vi.mocked(prisma.escalation.count).mockResolvedValue(5);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(10);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: 2.0 }]);

      const result = await analyticsService.getOverview(mockTenantId, {
        interval: 'day',
      });

      expect(result.dateRange.from).toBeInstanceOf(Date);
      expect(result.dateRange.to).toBeInstanceOf(Date);
    });

    it('should continue on cache error', async () => {
      vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis error'));
      vi.mocked(prisma.conversation.count).mockResolvedValue(100);
      vi.mocked(prisma.message.count).mockResolvedValue(500);
      vi.mocked(prisma.escalation.count).mockResolvedValue(10);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(25);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: 3.0 }]);

      const result = await analyticsService.getOverview(mockTenantId, mockDateRange);

      expect(result.totalConversations).toBe(100);
    });
  });

  describe('getConversationTimeSeries', () => {
    it('should return time series data grouped by interval', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { date: new Date('2024-01-01'), status: 'BOT_ACTIVE', count: BigInt(10) },
        { date: new Date('2024-01-01'), status: 'CLOSED', count: BigInt(5) },
        { date: new Date('2024-01-02'), status: 'BOT_ACTIVE', count: BigInt(12) },
      ]);

      const result = await analyticsService.getConversationTimeSeries(mockTenantId, mockDateRange);

      expect(result.data).toHaveLength(3);
      expect(result.data[0].count).toBe(10); // BigInt converted to Number
      expect(result.data[0].status).toBe('BOT_ACTIVE');
      expect(result.interval).toBe('day');
    });

    it('should handle different intervals', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

      await analyticsService.getConversationTimeSeries(mockTenantId, {
        ...mockDateRange,
        interval: 'hour',
      });

      // Verify query was called with hour interval
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('should convert BigInt counts to Numbers', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { date: new Date(), status: 'ACTIVE', count: BigInt(9007199254740991) }, // Large BigInt
      ]);

      const result = await analyticsService.getConversationTimeSeries(mockTenantId, mockDateRange);

      expect(typeof result.data[0].count).toBe('number');
    });
  });

  describe('getChannelBreakdown', () => {
    it('should return channel breakdown data', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
        { channel: 'WEB', count: BigInt(50), messages: BigInt(250) },
        { channel: 'WHATSAPP', count: BigInt(30), messages: BigInt(180) },
      ]);

      const result = await analyticsService.getChannelBreakdown(mockTenantId, mockDateRange);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].channel).toBe('WEB');
      expect(result.data[0].conversations).toBe(50);
      expect(result.data[0].messages).toBe(250);
    });

    it('should handle empty results', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);

      const result = await analyticsService.getChannelBreakdown(mockTenantId, mockDateRange);

      expect(result.data).toHaveLength(0);
    });
  });

  describe('getEscalationMetrics', () => {
    it('should return escalation metrics by reason and status', async () => {
      // Mock the three parallel queries
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { reason: 'USER_REQUEST', count: BigInt(5) },
          { reason: 'LOW_CONFIDENCE', count: BigInt(3) },
        ])
        .mockResolvedValueOnce([
          { status: 'resolved', count: BigInt(7) },
          { status: 'pending', count: BigInt(3) },
        ])
        .mockResolvedValueOnce([{ avg: 1800 }]); // avgResolutionTime

      const result = await analyticsService.getEscalationMetrics(mockTenantId, mockDateRange);

      expect(result.byReason).toHaveLength(2);
      expect(result.byReason[0].reason).toBe('USER_REQUEST');
      expect(result.byReason[0].count).toBe(5);

      expect(result.byStatus).toHaveLength(2);
      expect(result.avgResolutionTime).toBe(1800);
    });

    it('should handle null avgResolutionTime', async () => {
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ avg: null }]);

      const result = await analyticsService.getEscalationMetrics(mockTenantId, mockDateRange);

      expect(result.avgResolutionTime).toBeNull();
    });
  });

  describe('getKnowledgeStats', () => {
    it('should return knowledge source statistics', async () => {
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          { type: 'PDF', count: BigInt(15) },
          { type: 'URL', count: BigInt(8) },
        ])
        .mockResolvedValueOnce([
          { status: 'INDEXED', count: BigInt(20) },
          { status: 'FAILED', count: BigInt(2) },
        ])
        .mockResolvedValueOnce([{ avg: 60 }]); // avgChunksPerSource

      vi.mocked(prisma.knowledgeChunk.count).mockResolvedValueOnce(1500);

      const result = await analyticsService.getKnowledgeStats(mockTenantId, mockDateRange);

      expect(result.byType).toHaveLength(2);
      expect(result.byType[0].type).toBe('PDF');
      expect(result.byType[0].count).toBe(15);

      expect(result.byStatus).toHaveLength(2);
      expect(result.totalChunks).toBe(1500);
      expect(result.avgChunksPerSource).toBe(60);
    });

    it('should handle no knowledge sources', async () => {
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ avg: null }]);

      vi.mocked(prisma.knowledgeChunk.count).mockResolvedValueOnce(0);

      const result = await analyticsService.getKnowledgeStats(mockTenantId, mockDateRange);

      expect(result.byType).toHaveLength(0);
      expect(result.byStatus).toHaveLength(0);
      expect(result.totalChunks).toBe(0);
      expect(result.avgChunksPerSource).toBeNull();
    });
  });

  describe('Cache key generation', () => {
    it('should generate unique cache keys for different queries', async () => {
      vi.mocked(prisma.conversation.count).mockResolvedValue(0);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.escalation.count).mockResolvedValue(0);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: null }]);

      // First call
      await analyticsService.getOverview(mockTenantId, mockDateRange);
      const firstCacheKey = vi.mocked(redis.setex).mock.calls[0]?.[0];

      vi.clearAllMocks();

      // Second call with different date range
      const differentRange = {
        ...mockDateRange,
        from: new Date('2024-02-01'),
        to: new Date('2024-02-28'),
      };
      await analyticsService.getOverview(mockTenantId, differentRange);
      const secondCacheKey = vi.mocked(redis.setex).mock.calls[0]?.[0];

      expect(firstCacheKey).not.toBe(secondCacheKey);
    });

    it('should generate unique cache keys for different tenants', async () => {
      vi.mocked(prisma.conversation.count).mockResolvedValue(0);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.escalation.count).mockResolvedValue(0);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ avg: null }]);

      // First tenant
      await analyticsService.getOverview('tenant-1', mockDateRange);
      const firstCacheKey = vi.mocked(redis.setex).mock.calls[0]?.[0];

      vi.clearAllMocks();

      // Second tenant
      await analyticsService.getOverview('tenant-2', mockDateRange);
      const secondCacheKey = vi.mocked(redis.setex).mock.calls[0]?.[0];

      expect(firstCacheKey).not.toBe(secondCacheKey);
    });
  });
});
