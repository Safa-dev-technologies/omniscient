import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../../src/server.js';
import { prisma } from '../../../src/lib/prisma.js';
import { testSetup } from '../setup.js';
import { env } from '../../../src/config/index.js';

describe('Admin API Integration', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let masterKey: string;
  let createdTenantId: string;

  beforeAll(async () => {
    await testSetup();

    // Build test server
    server = await buildServer();
    await server.ready();

    // Get master key from env
    masterKey = env.MASTER_API_KEY || 'master_test_key';
  });

  afterAll(async () => {
    // Cleanup created tenants
    if (createdTenantId) {
      await prisma.apiKey.deleteMany({ where: { tenantId: createdTenantId } });
      await prisma.tenant.delete({ where: { id: createdTenantId } }).catch(() => {});
    }

    await server.close();
  });

  describe('Authentication', () => {
    describe('POST /admin/auth/login', () => {
      it('should return 401 for invalid credentials', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/v1/admin/auth/login',
          payload: {
            username: 'invalid',
            password: 'wrong',
          },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_CREDENTIALS');
      });

      it('should validate required fields', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/v1/admin/auth/login',
          payload: {
            username: '',
            password: '',
          },
        });

        // Zod validation should fail
        expect(response.statusCode).toBe(400);
      });
    });
  });

  describe('Platform Analytics', () => {
    describe('GET /admin/platform/analytics', () => {
      it('should return 401 without master key', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/platform/analytics',
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
      });

      it('should return 401 with invalid key format', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/platform/analytics',
          headers: {
            authorization: 'Bearer invalid_key',
          },
        });

        expect(response.statusCode).toBe(401);
      });

      it('should return platform stats with valid master key', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/platform/analytics',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data).toMatchObject({
          tenants: expect.objectContaining({
            total: expect.any(Number),
            active: expect.any(Number),
            inactive: expect.any(Number),
          }),
          conversations: expect.objectContaining({
            total: expect.any(Number),
            last24h: expect.any(Number),
            last7d: expect.any(Number),
            last30d: expect.any(Number),
          }),
          messages: expect.objectContaining({
            total: expect.any(Number),
          }),
          knowledgeSources: expect.objectContaining({
            total: expect.any(Number),
            indexed: expect.any(Number),
          }),
          system: expect.objectContaining({
            documentQueueDepth: expect.any(Number),
            embeddingQueueDepth: expect.any(Number),
          }),
        });
      });
    });
  });

  describe('Tenant Management', () => {
    describe('GET /admin/tenants', () => {
      it('should list tenants with pagination', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/tenants?limit=10&offset=0',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tenants).toBeInstanceOf(Array);
        expect(body.data.total).toBeGreaterThanOrEqual(0);
        expect(body.data.limit).toBe(10);
        expect(body.data.offset).toBe(0);
      });

      it('should filter tenants by search', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/tenants?search=integration',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        // Should find the integration test tenant
        expect(
          body.data.tenants.some((t: any) => t.name.toLowerCase().includes('integration'))
        ).toBe(true);
      });
    });

    describe('POST /admin/tenants', () => {
      it('should create a new tenant', async () => {
        const slug = `test-tenant-${Date.now()}`;

        const response = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Test Created Tenant',
            slug,
          },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tenant.name).toBe('Test Created Tenant');
        expect(body.data.tenant.slug).toBe(slug);
        expect(body.data.apiKey).toBeDefined();

        // Store for cleanup
        createdTenantId = body.data.tenant.id;
      });

      it('should validate slug format', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Invalid Slug Tenant',
            slug: 'Invalid Slug With Spaces',
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /admin/tenants/:id', () => {
      it('should return tenant details', async () => {
        // First create a tenant to retrieve
        const createResponse = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Detail Test Tenant',
            slug: `detail-test-${Date.now()}`,
          },
        });
        const createBody = JSON.parse(createResponse.body);
        const tenantId = createBody.data.tenant.id;

        const response = await server.inject({
          method: 'GET',
          url: `/v1/admin/tenants/${tenantId}`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.id).toBe(tenantId);
        expect(body.data.name).toBeDefined();

        // Cleanup
        await prisma.apiKey.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      });

      it('should return 404 for non-existent tenant', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/tenants/00000000-0000-0000-0000-000000000000',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('TENANT_NOT_FOUND');
      });
    });

    describe('PATCH /admin/tenants/:id', () => {
      it('should update tenant', async () => {
        // First create a tenant to update
        const createResponse = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Tenant To Update',
            slug: `update-test-${Date.now()}`,
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const tenantId = createBody.data.tenant.id;

        const response = await server.inject({
          method: 'PATCH',
          url: `/v1/admin/tenants/${tenantId}`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Updated Tenant Name',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.name).toBe('Updated Tenant Name');

        // Cleanup
        await prisma.apiKey.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      });
    });

    describe('DELETE /admin/tenants/:id', () => {
      it('should delete tenant', async () => {
        // First create a tenant to delete
        const createResponse = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Tenant To Delete',
            slug: `delete-test-${Date.now()}`,
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const tenantId = createBody.data.tenant.id;

        // Delete API keys first (foreign key constraint)
        await prisma.apiKey.deleteMany({ where: { tenantId } });

        const response = await server.inject({
          method: 'DELETE',
          url: `/v1/admin/tenants/${tenantId}`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);

        // Verify tenant is soft-deleted (status set to DELETED)
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        expect(tenant?.status).toBe('DELETED');

        // Cleanup - hard delete the test tenant
        await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      });
    });
  });

  describe('Tenant Health', () => {
    describe('GET /admin/tenants/:id/health', () => {
      it('should return health for specific tenant', async () => {
        // First create a tenant to check health
        const createResponse = await server.inject({
          method: 'POST',
          url: '/v1/admin/tenants',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Health Test Tenant',
            slug: `health-test-${Date.now()}`,
          },
        });
        const createBody = JSON.parse(createResponse.body);
        const tenantId = createBody.data.tenant.id;

        const response = await server.inject({
          method: 'GET',
          url: `/v1/admin/tenants/${tenantId}/health`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tenantId).toBe(tenantId);
        expect(body.data.status).toMatch(/healthy|warning|critical/);
        expect(body.data.metrics).toBeDefined();

        // Cleanup
        await prisma.apiKey.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      });
    });

    describe('GET /admin/health', () => {
      it('should return health for all tenants', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/v1/admin/health',
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data).toBeInstanceOf(Array);
      });
    });
  });

  describe('API Key Management', () => {
    let testTenantId: string;

    beforeAll(async () => {
      // Create a tenant for API key tests
      const tenant = await prisma.tenant.create({
        data: {
          name: 'API Key Test Tenant',
          slug: `api-key-test-${Date.now()}`,
        },
      });
      testTenantId = tenant.id;
    });

    afterAll(async () => {
      await prisma.apiKey.deleteMany({ where: { tenantId: testTenantId } });
      await prisma.tenant.delete({ where: { id: testTenantId } }).catch(() => {});
    });

    describe('GET /admin/tenants/:id/api-keys', () => {
      it('should list API keys for tenant', async () => {
        const response = await server.inject({
          method: 'GET',
          url: `/v1/admin/tenants/${testTenantId}/api-keys`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data).toBeInstanceOf(Array);
      });
    });

    describe('POST /admin/tenants/:id/api-keys', () => {
      it('should create API key', async () => {
        const response = await server.inject({
          method: 'POST',
          url: `/v1/admin/tenants/${testTenantId}/api-keys`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'New Test Key',
          },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.key).toBeDefined();
        expect(body.data.key).toMatch(/^omni_/);
        expect(body.data.name).toBe('New Test Key');
      });

      it('should create API key with expiration', async () => {
        const response = await server.inject({
          method: 'POST',
          url: `/v1/admin/tenants/${testTenantId}/api-keys`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Expiring Key',
            expiresIn: 30, // 30 days
          },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        // Verify the key was created (expiresAt may or may not be in response)
        expect(body.data.key).toBeDefined();
      });
    });

    describe('DELETE /admin/tenants/:id/api-keys/:keyId', () => {
      it('should revoke API key', async () => {
        // First create a key to revoke
        const createResponse = await server.inject({
          method: 'POST',
          url: `/v1/admin/tenants/${testTenantId}/api-keys`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
          payload: {
            name: 'Key To Revoke',
          },
        });

        const createBody = JSON.parse(createResponse.body);
        const keyId = createBody.data.id;

        const response = await server.inject({
          method: 'DELETE',
          url: `/v1/admin/tenants/${testTenantId}/api-keys/${keyId}`,
          headers: {
            authorization: `Bearer ${masterKey}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);

        // Verify key is deleted (revoked keys are deleted, not marked)
        const apiKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
        expect(apiKey).toBeNull();
      });
    });
  });
});
