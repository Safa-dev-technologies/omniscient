import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockAdminTenant } from '../../fixtures/admin.fixtures.js';

// Mock prisma
vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrisma = {
    tenant: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    conversation: {
      count: vi.fn(),
    },
    message: {
      count: vi.fn(),
    },
    knowledgeSource: {
      count: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock redis
vi.mock('../../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock job queues
vi.mock('../../../src/jobs/queue.js', () => ({
  documentQueue: { count: vi.fn().mockResolvedValue(5) },
  embeddingQueue: { count: vi.fn().mockResolvedValue(10) },
  crawlQueue: { count: vi.fn().mockResolvedValue(2) },
  syncQueue: { count: vi.fn().mockResolvedValue(0) },
  deadLetterQueue: { count: vi.fn().mockResolvedValue(1) },
}));

const { prisma } = await import('../../../src/lib/prisma.js');
import * as adminService from '../../../src/modules/admin/admin.service.js';

describe('Admin Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPlatformStats', () => {
    it('should return complete platform statistics', async () => {
      // Mock with implementation to handle parallel Promise.all calls
      let tenantCallCount = 0;
      vi.mocked(prisma.tenant.count).mockImplementation(async () => {
        tenantCallCount++;
        // First call is total, second call has where clause for active
        return tenantCallCount === 1 ? 10 : 8;
      });

      let convCallCount = 0;
      vi.mocked(prisma.conversation.count).mockImplementation(async () => {
        convCallCount++;
        const values = [1000, 50, 200, 500]; // total, 24h, 7d, 30d
        return values[convCallCount - 1] || 0;
      });

      let msgCallCount = 0;
      vi.mocked(prisma.message.count).mockImplementation(async () => {
        msgCallCount++;
        const values = [5000, 250, 1000, 2500]; // total, 24h, 7d, 30d
        return values[msgCallCount - 1] || 0;
      });

      let ksCallCount = 0;
      vi.mocked(prisma.knowledgeSource.count).mockImplementation(async () => {
        ksCallCount++;
        const values = [100, 80, 15, 5]; // total, indexed, processing, failed
        return values[ksCallCount - 1] || 0;
      });

      const result = await adminService.getPlatformStats();

      expect(result.tenants.total).toBe(10);
      expect(result.tenants.active).toBe(8);
      expect(result.tenants.inactive).toBe(2);

      expect(result.conversations.total).toBe(1000);
      expect(result.conversations.last24h).toBe(50);
      expect(result.conversations.last7d).toBe(200);
      expect(result.conversations.last30d).toBe(500);

      expect(result.messages.total).toBe(5000);
      expect(result.messages.last24h).toBe(250);

      expect(result.knowledgeSources.total).toBe(100);
      expect(result.knowledgeSources.indexed).toBe(80);
      expect(result.knowledgeSources.processing).toBe(15);
      expect(result.knowledgeSources.failed).toBe(5);

      expect(result.system.documentQueueDepth).toBe(5);
      expect(result.system.embeddingQueueDepth).toBe(10);
      expect(result.system.crawlQueueDepth).toBe(2);
      expect(result.system.syncQueueDepth).toBe(0);
      expect(result.system.deadLetterQueueDepth).toBe(1);
    });

    it('should handle zero counts correctly', async () => {
      vi.mocked(prisma.tenant.count).mockResolvedValue(0);
      vi.mocked(prisma.conversation.count).mockResolvedValue(0);
      vi.mocked(prisma.message.count).mockResolvedValue(0);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);

      const result = await adminService.getPlatformStats();

      expect(result.tenants.total).toBe(0);
      expect(result.tenants.active).toBe(0);
      expect(result.tenants.inactive).toBe(0);
      expect(result.conversations.total).toBe(0);
      expect(result.messages.total).toBe(0);
      expect(result.knowledgeSources.total).toBe(0);
    });
  });

  describe('getTenantHealthMetrics', () => {
    it('should return health metrics for all tenants', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [
            {
              id: 'conv-1',
              lastActivityAt: new Date(),
            },
          ],
          knowledgeSources: [{ status: 'INDEXED' }, { status: 'INDEXED' }, { status: 'FAILED' }],
          _count: {
            conversations: 10,
          },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics();

      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe(mockAdminTenant.id);
      expect(result[0].tenantName).toBe(mockAdminTenant.name);
      expect(result[0].metrics.knowledgeSourceCount).toBe(3);
      expect(result[0].metrics.indexedSourceCount).toBe(2);
      expect(result[0].metrics.failedSourceCount).toBe(1);
      expect(result[0].metrics.conversationCount).toBe(10);
    });

    it('should return health metrics for a specific tenant', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [],
          knowledgeSources: [{ status: 'INDEXED' }],
          _count: {
            conversations: 5,
          },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics(mockAdminTenant.id);

      expect(result).toHaveLength(1);
      expect(result[0].tenantId).toBe(mockAdminTenant.id);
    });

    it('should mark tenant as healthy with no failed sources', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [{ id: 'conv-1', lastActivityAt: new Date() }],
          knowledgeSources: [{ status: 'INDEXED' }, { status: 'INDEXED' }],
          _count: { conversations: 5 },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics();

      expect(result[0].status).toBe('healthy');
      expect(result[0].metrics.errorRate).toBe(0);
    });

    it('should mark tenant as warning with some failed sources', async () => {
      // 1 failed out of 10 = 10% error rate (> 5% but < 20% = warning)
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [{ id: 'conv-1', lastActivityAt: new Date() }],
          knowledgeSources: [
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'INDEXED' },
            { status: 'FAILED' }, // 1 out of 10 = 10% error rate
          ],
          _count: { conversations: 5 },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics();

      expect(result[0].status).toBe('warning');
      expect(result[0].metrics.failedSourceCount).toBe(1);
    });

    it('should mark tenant as critical with many failed sources', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [{ id: 'conv-1', lastActivityAt: new Date() }],
          knowledgeSources: [
            { status: 'FAILED' },
            { status: 'FAILED' },
            { status: 'FAILED' },
            { status: 'FAILED' },
            { status: 'FAILED' },
            { status: 'FAILED' },
          ],
          _count: { conversations: 5 },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics();

      expect(result[0].status).toBe('critical');
      expect(result[0].metrics.failedSourceCount).toBe(6);
    });

    it('should mark tenant as warning with stale activity', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 45); // 45 days ago

      vi.mocked(prisma.tenant.findMany).mockResolvedValue([
        {
          id: mockAdminTenant.id,
          name: mockAdminTenant.name,
          slug: mockAdminTenant.slug,
          conversations: [{ id: 'conv-1', lastActivityAt: oldDate }],
          knowledgeSources: [{ status: 'INDEXED' }],
          _count: { conversations: 5 },
        },
      ] as any);

      const result = await adminService.getTenantHealthMetrics();

      expect(result[0].status).toBe('warning');
    });

    it('should return empty array when no tenants exist', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);

      const result = await adminService.getTenantHealthMetrics();

      expect(result).toHaveLength(0);
    });
  });

  describe('getTenantStats', () => {
    it('should return detailed stats for existing tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: mockAdminTenant.id,
        name: mockAdminTenant.name,
        slug: mockAdminTenant.slug,
        createdAt: mockAdminTenant.createdAt,
        conversations: [
          { id: 'conv-1', status: 'BOT_ACTIVE', lastActivityAt: new Date() },
          { id: 'conv-2', status: 'ESCALATED', lastActivityAt: new Date() },
          { id: 'conv-3', status: 'CLOSED', lastActivityAt: new Date() },
        ],
        knowledgeSources: [
          { status: 'INDEXED', type: 'PDF' },
          { status: 'INDEXED', type: 'PDF' },
          { status: 'FAILED', type: 'URL' },
        ],
        apiKeys: [{ id: 'key-1' }, { id: 'key-2' }],
      } as any);

      vi.mocked(prisma.message.count)
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(10) // last24h
        .mockResolvedValueOnce(30) // last7d
        .mockResolvedValueOnce(80); // last30d

      const result = await adminService.getTenantStats(mockAdminTenant.id);

      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe(mockAdminTenant.id);
      expect(result!.tenantName).toBe(mockAdminTenant.name);
      expect(result!.tenantSlug).toBe(mockAdminTenant.slug);

      // Conversation stats
      expect(result!.stats.conversations.total).toBe(3);
      expect(result!.stats.conversations.active).toBe(1);
      expect(result!.stats.conversations.escalated).toBe(1);
      expect(result!.stats.conversations.closed).toBe(1);

      // Message stats
      expect(result!.stats.messages.total).toBe(100);
      expect(result!.stats.messages.last24h).toBe(10);

      // Knowledge source stats
      expect(result!.stats.knowledgeSources.total).toBe(3);
      expect(result!.stats.knowledgeSources.indexed).toBe(2);
      expect(result!.stats.knowledgeSources.failed).toBe(1);
      expect(result!.stats.knowledgeSources.byType).toEqual({ PDF: 2, URL: 1 });

      // API key stats (all existing keys are active - revoked keys are deleted)
      expect(result!.stats.apiKeys.total).toBe(2);
      expect(result!.stats.apiKeys.active).toBe(2);

      // Health stats
      expect(result!.health.failedJobs).toBe(1);
      expect(result!.health.errorRate).toBeCloseTo(33.33, 1);
    });

    it('should return null for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      const result = await adminService.getTenantStats('non-existent-id');

      expect(result).toBeNull();
    });

    it('should handle tenant with no data', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: mockAdminTenant.id,
        name: mockAdminTenant.name,
        slug: mockAdminTenant.slug,
        createdAt: mockAdminTenant.createdAt,
        conversations: [],
        knowledgeSources: [],
        apiKeys: [],
      } as any);

      vi.mocked(prisma.message.count).mockResolvedValue(0);

      const result = await adminService.getTenantStats(mockAdminTenant.id);

      expect(result).not.toBeNull();
      expect(result!.stats.conversations.total).toBe(0);
      expect(result!.stats.messages.total).toBe(0);
      expect(result!.stats.knowledgeSources.total).toBe(0);
      expect(result!.stats.apiKeys.total).toBe(0);
      expect(result!.health.errorRate).toBe(0);
      expect(result!.health.lastActivity).toBeNull();
    });

    it('should calculate correct lastActivity from conversations', async () => {
      const recentDate = new Date('2024-01-20');
      const oldDate = new Date('2024-01-10');

      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        id: mockAdminTenant.id,
        name: mockAdminTenant.name,
        slug: mockAdminTenant.slug,
        createdAt: mockAdminTenant.createdAt,
        conversations: [
          { id: 'conv-1', status: 'BOT_ACTIVE', lastActivityAt: oldDate },
          { id: 'conv-2', status: 'CLOSED', lastActivityAt: recentDate },
        ],
        knowledgeSources: [],
        apiKeys: [],
      } as any);

      vi.mocked(prisma.message.count).mockResolvedValue(0);

      const result = await adminService.getTenantStats(mockAdminTenant.id);

      // Service returns lastActivity as ISO string
      expect(result!.health.lastActivity).toEqual(recentDate.toISOString());
    });
  });
});
