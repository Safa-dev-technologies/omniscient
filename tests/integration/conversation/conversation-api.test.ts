import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../../src/server.js';
import { prisma } from '../../../src/lib/prisma.js';
import { TEST_CONFIG, testSetup } from '../setup.js';
import type { FastifyInstance } from 'fastify';

describe('Conversation API Integration', () => {
  let server: FastifyInstance;
  let testApiKey: string;
  let testApiKeyId: string;
  let testUserId: string;
  let testConversationId: string;

  beforeAll(async () => {
    await testSetup();

    // Build test server
    server = await buildServer();
    await server.ready();

    // Create test user with unique email to avoid conflicts with parallel tests
    // Don't specify ID - let Prisma auto-generate UUID
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const user = await prisma.user.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        displayName: 'Test User',
        email: `conversation-test-${uniqueSuffix}@example.com`,
      },
    });
    testUserId = user.id;

    // Create API key for test tenant with unique key to avoid conflicts
    const { hashApiKey } = await import('../../../src/utils/hash.js');
    testApiKey = `omni_conversation_test_${uniqueSuffix}`;
    const keyHash = hashApiKey(testApiKey);
    const keyPrefix = testApiKey.substring(0, 16);

    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        keyHash,
        keyPrefix,
        name: 'Conversation Test API Key',
        permissions: { admin: true },
      },
    });
    testApiKeyId = apiKeyRecord.id;
  });

  afterAll(async () => {
    // Cleanup - only delete resources created by this test file
    await prisma.message.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.conversation.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });
    // Only delete the specific API key created by this test, not all keys for the tenant
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

  beforeEach(async () => {
    // Clean up conversations before each test
    // Order matters: escalations -> messages -> conversations (foreign key constraints)
    await prisma.escalation.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.message.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
    await prisma.conversation.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });
  });

  describe('POST /v1/conversations', () => {
    it('should create a conversation', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/conversations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          userId: testUserId,
          channel: 'WEB',
          metadata: { source: 'test' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        userId: testUserId,
        channel: 'WEB',
        status: 'BOT_ACTIVE',
        metadata: { source: 'test' },
      });
      expect(body.data.id).toBeDefined();
      testConversationId = body.data.id;
    });

    it('should validate userId exists', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/conversations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          userId: '00000000-0000-4000-8000-000000000001',
          channel: 'WEB',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/conversations',
        payload: {
          userId: testUserId,
          channel: 'WEB',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/conversations', () => {
    beforeEach(async () => {
      // Create test conversations - no ID specified, Prisma generates UUIDs
      await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WHATSAPP',
          status: 'ESCALATED',
        },
      });
    });

    it('should list conversations with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/conversations?limit=10&offset=0',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/conversations?status=ESCALATED',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((c: any) => c.status === 'ESCALATED')).toBe(true);
    });

    it('should filter by channel', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/conversations?channel=WHATSAPP',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((c: any) => c.channel === 'WHATSAPP')).toBe(true);
    });
  });

  describe('GET /v1/conversations/:id', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      testConversationId = conversation.id;
    });

    it('should return conversation with messages and escalation', async () => {
      // Create a message (use uppercase enum value)
      await prisma.message.create({
        data: {
          conversationId: testConversationId,
          role: 'USER',
          content: 'Hello',
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/v1/conversations/${testConversationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testConversationId);
      expect(body.data.messages).toBeDefined();
      expect(Array.isArray(body.data.messages)).toBe(true);
    });

    it('should return 404 when conversation not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/conversations/00000000-0000-4000-8000-000000000002',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  describe('PATCH /v1/conversations/:id', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      testConversationId = conversation.id;
    });

    it('should update conversation metadata', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/v1/conversations/${testConversationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          metadata: { updated: true, source: 'api' },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.metadata).toMatchObject({ updated: true, source: 'api' });
    });

    it('should update conversation status', async () => {
      // Valid transitions from BOT_ACTIVE: ESCALATED, RESOLVED, CLOSED
      // Using RESOLVED which doesn't require an escalation record
      const response = await server.inject({
        method: 'PATCH',
        url: `/v1/conversations/${testConversationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          status: 'RESOLVED',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('RESOLVED');
    });
  });

  describe('POST /v1/conversations/:id/transition', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      testConversationId = conversation.id;
    });

    it('should transition status from BOT_ACTIVE to ESCALATED', async () => {
      // Create escalation record first - required for transitioning to ESCALATED
      await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/v1/conversations/${testConversationId}/transition`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          status: 'ESCALATED',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ESCALATED');
    });

    it('should reject invalid transitions', async () => {
      // Try to transition from BOT_ACTIVE directly to HUMAN_ACTIVE (invalid)
      // Valid transitions from BOT_ACTIVE are: ESCALATED, RESOLVED, CLOSED
      const response = await server.inject({
        method: 'POST',
        url: `/v1/conversations/${testConversationId}/transition`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          status: 'HUMAN_ACTIVE',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_TRANSITION');
    });
  });

  describe('GET /v1/conversations/:id/history', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      testConversationId = conversation.id;

      // Create messages in chronological order
      await prisma.message.createMany({
        data: [
          {
            conversationId: testConversationId,
            role: 'USER',
            content: 'First message',
            createdAt: new Date('2024-01-01'),
          },
          {
            conversationId: testConversationId,
            role: 'ASSISTANT',
            content: 'Response',
            createdAt: new Date('2024-01-02'),
          },
          {
            conversationId: testConversationId,
            role: 'USER',
            content: 'Second message',
            createdAt: new Date('2024-01-03'),
          },
        ],
      });
    });

    it('should return messages in chronological order', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/conversations/${testConversationId}/history`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(3);
      // Messages should be in chronological order (oldest first)
      expect(body.data[0].content).toBe('First message');
      expect(body.data[1].content).toBe('Response');
      expect(body.data[2].content).toBe('Second message');
    });

    it('should respect limit parameter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/conversations/${testConversationId}/history?limit=2`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBe(2);
    });
  });

  describe('DELETE /v1/conversations/:id', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      testConversationId = conversation.id;
    });

    it('should close conversation', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/v1/conversations/${testConversationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify conversation is closed
      const conversation = await prisma.conversation.findUnique({
        where: { id: testConversationId },
      });
      expect(conversation?.status).toBe('CLOSED');
      expect(conversation?.closedAt).toBeDefined();
    });
  });

  describe('Tenant Isolation', () => {
    let otherTenantId: string;
    let otherApiKey: string;
    let otherConversationId: string;

    beforeAll(async () => {
      // Create another tenant
      otherTenantId = 'test-tenant-other';
      await prisma.tenant.upsert({
        where: { id: otherTenantId },
        create: {
          id: otherTenantId,
          name: 'Other Tenant',
          slug: 'other-tenant',
        },
        update: {},
      });

      // Create API key for other tenant with unique key
      const { hashApiKey } = await import('../../../src/utils/hash.js');
      const otherUniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      otherApiKey = `omni_other_conversation_${otherUniqueSuffix}`;
      const keyHash = hashApiKey(otherApiKey);
      const keyPrefix = otherApiKey.substring(0, 16);

      await prisma.apiKey.create({
        data: {
          tenantId: otherTenantId,
          keyHash,
          keyPrefix,
          name: 'Other API Key',
          permissions: { admin: true },
        },
      });

      // Create conversation for other tenant
      // Don't specify IDs - let Prisma auto-generate UUIDs
      const otherUser = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          displayName: 'Other User',
          email: `other-conversation-${otherUniqueSuffix}@example.com`,
        },
      });

      const conversation = await prisma.conversation.create({
        data: {
          tenantId: otherTenantId,
          userId: otherUser.id,
          channel: 'WEB',
          status: 'BOT_ACTIVE',
        },
      });
      otherConversationId = conversation.id;
    });

    afterAll(async () => {
      // Cleanup other tenant
      await prisma.message.deleteMany({
        where: { conversation: { tenantId: otherTenantId } },
      });
      await prisma.conversation.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.apiKey.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.user.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.tenant.delete({
        where: { id: otherTenantId },
      });
    });

    it('should not allow access to other tenant conversations', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/conversations/${otherConversationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });
});
