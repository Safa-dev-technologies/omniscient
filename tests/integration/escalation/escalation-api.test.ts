import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../../src/server.js';
import { prisma } from '../../../src/lib/prisma.js';
import { TEST_CONFIG, testSetup } from '../setup.js';

describe('Escalation API Integration', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let testApiKey: string;
  let testApiKeyId: string;
  let testUserId: string;
  let testConversationId: string;
  let testEscalationId: string;

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
        email: `escalation-test-${uniqueSuffix}@example.com`,
      },
    });
    testUserId = user.id;

    // Create API key for test tenant with unique key to avoid conflicts
    const { hashApiKey } = await import('../../../src/utils/hash.js');
    const uniqueKeySuffix = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testApiKey = `omni_escalation_test_${uniqueKeySuffix}`;
    const keyHash = hashApiKey(testApiKey);
    const keyPrefix = testApiKey.substring(0, 16);

    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        keyHash,
        keyPrefix,
        name: 'Escalation Test API Key',
        permissions: { admin: true },
      },
    });
    testApiKeyId = apiKeyRecord.id;
  });

  afterAll(async () => {
    // Cleanup - only delete resources created by this test file
    await prisma.escalation.deleteMany({
      where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
    });
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
    // Clean up escalations and conversations before each test
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

  describe('POST /v1/escalations', () => {
    beforeEach(async () => {
      // Create a conversation for escalation - let Prisma auto-generate UUID
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

    it('should create escalation and update conversation status', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
          reasonDetails: 'User requested human agent',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.escalation).toMatchObject({
        conversationId: testConversationId,
        reason: 'USER_REQUEST',
        reasonDetails: 'User requested human agent',
      });
      expect(body.data.conversation.status).toBe('ESCALATED');
      expect(body.data.conversation.escalatedAt).toBeDefined();

      testEscalationId = body.data.escalation.id;
    });

    it('should return 404 when conversation not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          conversationId: '00000000-0000-4000-8000-000000000001',
          reason: 'USER_REQUEST',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 when escalation already exists', async () => {
      // Create an escalation first
      await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/v1/escalations',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          conversationId: testConversationId,
          reason: 'LOW_CONFIDENCE',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ESCALATION_EXISTS');
    });
  });

  describe('GET /v1/escalations', () => {
    beforeEach(async () => {
      // Create test conversations and escalations
      const conv1 = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });

      const conv2 = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });

      await prisma.escalation.createMany({
        data: [
          {
            conversationId: conv1.id,
            reason: 'USER_REQUEST',
          },
          {
            conversationId: conv2.id,
            reason: 'LOW_CONFIDENCE',
            resolvedAt: new Date(),
          },
        ],
      });
    });

    it('should list escalations with pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/escalations?limit=10&offset=0',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter by reason', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/escalations?reason=USER_REQUEST',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((e: any) => e.reason === 'USER_REQUEST')).toBe(true);
    });

    it('should filter by resolved status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/escalations?resolved=true',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((e: any) => e.resolvedAt !== null)).toBe(true);
    });
  });

  describe('GET /v1/escalations/:id', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });
      testConversationId = conversation.id;

      const escalation = await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });
      testEscalationId = escalation.id;
    });

    it('should return escalation with conversation', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/escalations/${testEscalationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testEscalationId);
      expect(body.data.conversation).toBeDefined();
      expect(body.data.conversation.id).toBe(testConversationId);
    });

    it('should return 404 when escalation not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/escalations/00000000-0000-4000-8000-000000000003',
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  describe('PATCH /v1/escalations/:id', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });
      testConversationId = conversation.id;

      const escalation = await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });
      testEscalationId = escalation.id;
    });

    it('should update escalation with agent info', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/v1/escalations/${testEscalationId}`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          agentId: '123e4567-e89b-12d3-a456-426614174003',
          agentName: 'John Doe',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.agentId).toBe('123e4567-e89b-12d3-a456-426614174003');
      expect(body.data.agentName).toBe('John Doe');
    });
  });

  describe('POST /v1/escalations/:id/resolve', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });
      testConversationId = conversation.id;

      const escalation = await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });
      testEscalationId = escalation.id;
    });

    it('should resolve escalation and update conversation status to RESOLVED', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/v1/escalations/${testEscalationId}/resolve`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          resolutionNotes: 'Issue resolved',
          returnedToBot: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.resolvedAt).toBeDefined();
      expect(body.data.resolutionNotes).toBe('Issue resolved');

      // Verify conversation status
      const conversation = await prisma.conversation.findUnique({
        where: { id: testConversationId },
      });
      expect(conversation?.status).toBe('RESOLVED');
      expect(conversation?.resolvedAt).toBeDefined();
    });

    it('should transition conversation to BOT_ACTIVE when returnedToBot is true', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/v1/escalations/${testEscalationId}/resolve`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          returnedToBot: true,
          resolutionNotes: 'Returned to bot',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.returnedToBot).toBe(true);

      // Verify conversation status
      const conversation = await prisma.conversation.findUnique({
        where: { id: testConversationId },
      });
      expect(conversation?.status).toBe('BOT_ACTIVE');
    });

    it('should return 400 when escalation already resolved', async () => {
      // Resolve the escalation first
      await prisma.escalation.update({
        where: { id: testEscalationId },
        data: {
          resolvedAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: `/v1/escalations/${testEscalationId}/resolve`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          returnedToBot: false,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('ALREADY_RESOLVED');
    });
  });

  describe('POST /v1/escalations/:id/ticket', () => {
    beforeEach(async () => {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId: TEST_CONFIG.tenantId,
          userId: testUserId,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });
      testConversationId = conversation.id;

      const escalation = await prisma.escalation.create({
        data: {
          conversationId: testConversationId,
          reason: 'USER_REQUEST',
        },
      });
      testEscalationId = escalation.id;
    });

    it('should create external ticket (mocked)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/v1/escalations/${testEscalationId}/ticket`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          escalationId: testEscalationId,
          system: 'zendesk',
          subject: 'Test ticket',
          description: 'Test description',
          priority: 'normal',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.ticket).toBeDefined();
      expect(body.data.ticket.system).toBe('zendesk');
      expect(body.data.escalation.externalTicketId).toBeDefined();
      expect(body.data.escalation.externalSystem).toBe('zendesk');
    });

    it('should return 400 when system invalid (Zod validation)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/v1/escalations/${testEscalationId}/ticket`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
        payload: {
          escalationId: testEscalationId,
          system: 'unsupported-system',
          subject: 'Test',
          description: 'Test',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      // Zod validation rejects invalid enum values before reaching service
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Tenant Isolation', () => {
    let otherTenantId: string;
    let otherApiKey: string;
    let otherEscalationId: string;

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
      otherApiKey = `omni_other_escalation_${otherUniqueSuffix}`;
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

      // Create conversation and escalation for other tenant
      // Don't specify ID - let Prisma auto-generate UUID
      const otherUser = await prisma.user.create({
        data: {
          tenantId: otherTenantId,
          displayName: 'Other User',
          email: `other-escalation-${otherUniqueSuffix}@example.com`,
        },
      });

      const conversation = await prisma.conversation.create({
        data: {
          tenantId: otherTenantId,
          userId: otherUser.id,
          channel: 'WEB',
          status: 'ESCALATED',
        },
      });

      const escalation = await prisma.escalation.create({
        data: {
          conversationId: conversation.id,
          reason: 'USER_REQUEST',
        },
      });
      otherEscalationId = escalation.id;
    });

    afterAll(async () => {
      // Cleanup other tenant
      await prisma.escalation.deleteMany({
        where: { conversation: { tenantId: otherTenantId } },
      });
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

    it('should not allow access to other tenant escalations', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/v1/escalations/${otherEscalationId}`,
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
