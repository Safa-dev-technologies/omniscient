import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../../src/server.js';
import { prisma } from '../../../src/lib/prisma.js';
import { TEST_CONFIG, testSetup } from '../setup.js';

describe('Analytics API Integration', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let testApiKey: string;
  let testApiKeyId: string;
  let testUserId: string;

  beforeAll(async () => {
    await testSetup();

    // Build test server
    server = await buildServer();
    await server.ready();

    // Create test user
    const user = await prisma.user.create({
      data: {
        id: `analytics-test-user-${Date.now()}`,
        tenantId: TEST_CONFIG.tenantId,
        displayName: 'Analytics Test User',
        email: 'analytics-test@example.com',
      },
    });
    testUserId = user.id;

    // Create API key for test tenant
    const { hashApiKey } = await import('../../../src/utils/hash.js');
    testApiKey = `omni_analytics_test_${Date.now()}`;
    const keyHash = hashApiKey(testApiKey);
    const keyPrefix = testApiKey.substring(0, 16);

    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        keyHash,
        keyPrefix,
        name: 'Analytics Test API Key',
        permissions: { admin: true, analytics: true },
      },
    });
    testApiKeyId = apiKeyRecord.id;

    // Create test data for analytics
    await createTestData();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.escalation.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.conversation.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });
    await prisma.knowledgeChunk.deleteMany({
      where: { source: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.knowledgeSource.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });
    // Only delete the specific API key created by this test file
    if (testApiKeyId) {
      await prisma.apiKey
        .delete({
          where: { id: testApiKeyId },
        })
        .catch(() => {}); // Ignore if already deleted
    }
    // Only delete the specific user created by this test file
    if (testUserId) {
      await prisma.user
        .delete({
          where: { id: testUserId },
        })
        .catch(() => {}); // Ignore if already deleted
    }

    await server.close();
  });

  async function createTestData() {
    // Create conversations with different statuses and channels
    const conversations = await Promise.all([
      prisma.conversation.create({
        data: {
          id: `analytics-conv-1-${Date.now()}`,
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      }),
      prisma.conversation.create({
        data: {
          id: `analytics-conv-2-${Date.now()}`,
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WHATSAPP',
          status: 'CLOSED',
        },
      }),
      prisma.conversation.create({
        data: {
          id: `analytics-conv-3-${Date.now()}`,
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      }),
    ]);

    // Create messages
    for (const conv of conversations) {
      await prisma.message.createMany({
        data: [
          {
            conversationId: conv.id,
            role: 'USER',
            content: 'Test user message',
          },
          {
            conversationId: conv.id,
            role: 'ASSISTANT',
            content: 'Test assistant message',
          },
        ],
      });
    }

    // Create escalation
    await prisma.escalation.create({
      data: {
        conversationId: conversations[2].id,
        reason: 'USER_REQUEST',
        reasonDetails: 'Test escalation',
      },
    });

    // Create knowledge sources
    await prisma.knowledgeSource.createMany({
      data: [
        {
          tenantId: TEST_CONFIG.tenantId,
          name: 'Test PDF',
          type: 'PDF',
          status: 'INDEXED',
          chunkCount: 10,
          tokenCount: 1000,
        },
        {
          tenantId: TEST_CONFIG.tenantId,
          name: 'Test URL',
          type: 'URL',
          status: 'INDEXED',
          chunkCount: 5,
          tokenCount: 500,
        },
        {
          tenantId: TEST_CONFIG.tenantId,
          name: 'Failed Source',
          type: 'PDF',
          status: 'FAILED',
          chunkCount: 0,
          tokenCount: 0,
        },
      ],
    });
  }

  describe('Authentication', () => {
    it('should return 401 without API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/overview',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 with invalid API key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/overview',
        headers: {
          authorization: 'Bearer invalid_key',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/analytics/overview', () => {
    it('should return overview metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/overview',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        totalConversations: expect.any(Number),
        activeConversations: expect.any(Number),
        totalMessages: expect.any(Number),
        escalationCount: expect.any(Number),
        knowledgeSources: expect.any(Number),
        dateRange: {
          from: expect.any(String),
          to: expect.any(String),
        },
      });
    });

    it('should filter by date range', async () => {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const to = new Date();

      const response = await server.inject({
        method: 'GET',
        url: `/v1/analytics/overview?from=${from.toISOString()}&to=${to.toISOString()}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.dateRange).toBeDefined();
    });

    it('should use default date range when not provided', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/overview',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.dateRange.from).toBeDefined();
      expect(body.data.dateRange.to).toBeDefined();
    });
  });

  describe('GET /v1/analytics/conversations', () => {
    it('should return conversation time series', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/conversations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        data: expect.any(Array),
        interval: expect.any(String),
        dateRange: expect.any(Object),
      });
    });

    it('should support different intervals', async () => {
      const intervals = ['hour', 'day', 'week', 'month'];

      for (const interval of intervals) {
        const response = await server.inject({
          method: 'GET',
          url: `/v1/analytics/conversations?interval=${interval}`,
          headers: {
            authorization: `Bearer ${testApiKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data.interval).toBe(interval);
      }
    });

    it('should return data grouped by status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/conversations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Each data point should have date, status, and count
      if (body.data.data.length > 0) {
        expect(body.data.data[0]).toMatchObject({
          date: expect.any(String),
          status: expect.any(String),
          count: expect.any(Number),
        });
      }
    });
  });

  describe('GET /v1/analytics/channels', () => {
    it('should return channel breakdown', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/channels',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        data: expect.any(Array),
        dateRange: expect.any(Object),
      });
    });

    it('should include conversation and message counts per channel', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/channels',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Should have WEB and WHATSAPP channels from test data
      if (body.data.data.length > 0) {
        expect(body.data.data[0]).toMatchObject({
          channel: expect.any(String),
          conversations: expect.any(Number),
          messages: expect.any(Number),
        });
      }
    });
  });

  describe('GET /v1/analytics/escalations', () => {
    it('should return escalation metrics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        byReason: expect.any(Array),
        byStatus: expect.any(Array),
        dateRange: expect.any(Object),
      });
    });

    it('should group escalations by reason', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Should have at least one escalation reason from test data
      if (body.data.byReason.length > 0) {
        expect(body.data.byReason[0]).toMatchObject({
          reason: expect.any(String),
          count: expect.any(Number),
        });
      }
    });

    it('should include average resolution time', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // avgResolutionTime can be null if no resolved escalations
      expect(body.data).toHaveProperty('avgResolutionTime');
    });
  });

  describe('GET /v1/analytics/knowledge', () => {
    it('should return knowledge statistics', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/knowledge',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        byType: expect.any(Array),
        byStatus: expect.any(Array),
        totalChunks: expect.any(Number),
        dateRange: expect.any(Object),
      });
    });

    it('should group sources by type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/knowledge',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Should have PDF and URL types from test data
      if (body.data.byType.length > 0) {
        expect(body.data.byType[0]).toMatchObject({
          type: expect.any(String),
          count: expect.any(Number),
        });
      }
    });

    it('should group sources by status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/knowledge',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Should have INDEXED and FAILED statuses from test data
      if (body.data.byStatus.length > 0) {
        expect(body.data.byStatus[0]).toMatchObject({
          status: expect.any(String),
          count: expect.any(Number),
        });
      }
    });

    it('should include average chunks per source', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/knowledge',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // avgChunksPerSource can be null if no sources with chunks
      expect(body.data).toHaveProperty('avgChunksPerSource');
    });
  });

  describe('Tenant Isolation', () => {
    let otherTenantId: string;
    let otherApiKey: string;

    beforeAll(async () => {
      // Create another tenant
      otherTenantId = `analytics-other-tenant-${Date.now()}`;
      await prisma.tenant.create({
        data: {
          id: otherTenantId,
          name: 'Other Analytics Tenant',
          slug: `other-analytics-${Date.now()}`,
        },
      });

      // Create API key for other tenant
      const { hashApiKey } = await import('../../../src/utils/hash.js');
      otherApiKey = `omni_other_analytics_${Date.now()}`;
      const keyHash = hashApiKey(otherApiKey);
      const keyPrefix = otherApiKey.substring(0, 16);

      await prisma.apiKey.create({
        data: {
          tenantId: otherTenantId,
          keyHash,
          keyPrefix,
          name: 'Other Analytics API Key',
          permissions: { admin: true },
        },
      });
    });

    afterAll(async () => {
      await prisma.apiKey.deleteMany({ where: { tenantId: otherTenantId } });
      await prisma.tenant.delete({ where: { id: otherTenantId } });
    });

    it('should not include other tenant data in overview', async () => {
      // Get stats for other tenant (should be zero or minimal)
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/overview',
        headers: {
          authorization: `Bearer ${otherApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Other tenant should have no data
      expect(body.data.totalConversations).toBe(0);
      expect(body.data.totalMessages).toBe(0);
    });

    it('should not include other tenant data in channel breakdown', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/analytics/channels',
        headers: {
          authorization: `Bearer ${otherApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Other tenant should have no channel data
      expect(body.data.data).toHaveLength(0);
    });
  });
});
