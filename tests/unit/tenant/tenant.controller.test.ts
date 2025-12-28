import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/tenant/tenant.controller.js';
import * as tenantService from '../../../src/modules/tenant/tenant.service.js';
import {
  mockFastifyRequest,
  mockFastifyReply,
  mockTenant,
} from '../../fixtures/tenant.fixtures.js';

// Mock service
vi.mock('../../../src/modules/tenant/tenant.service.js');

// Mock auth
vi.mock('../../../src/modules/tenant/tenant.auth.js', () => ({
  checkTenantAccess: vi.fn(() => ({ authorized: true })),
}));

describe('Tenant Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTenant', () => {
    it('should return 201 on successful creation', async () => {
      const request = mockFastifyRequest({
        body: { name: 'New Company', slug: 'new-company' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createTenant).mockResolvedValue({
        tenant: {
          id: '123',
          name: 'New Company',
          slug: 'new-company',
          status: 'ACTIVE',
          botName: 'Assistant',
          createdAt: new Date(),
        },
        apiKey: {
          id: '456',
          key: 'omni_live_xxx',
          keyPrefix: 'omni_live_',
          name: 'Initial',
          permissions: {},
          createdAt: new Date(),
        },
      });

      await controller.createTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
    });

    it('should return 400 for reserved slug', async () => {
      const request = mockFastifyRequest({
        body: { name: 'Admin', slug: 'admin' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createTenant).mockRejectedValue(
        new Error('Slug is reserved and cannot be used')
      );

      await controller.createTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate slug', async () => {
      const request = mockFastifyRequest({
        body: { name: 'Existing', slug: 'existing' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createTenant).mockRejectedValue(
        new Error('Tenant with this slug already exists')
      );

      await controller.createTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.body.error.code).toBe('CONFLICT');
    });
  });

  describe('getTenant', () => {
    it('should return tenant details', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.getTenant).mockResolvedValue(mockTenant as any);

      await controller.getTenant(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.id).toBe(mockTenant.id);
    });

    it('should return 404 for non-existent tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.getTenant).mockResolvedValue(null);

      await controller.getTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('updateTenant', () => {
    it('should return updated tenant on success', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
        body: { name: 'Updated Name' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.updateTenant).mockResolvedValue({
        ...mockTenant,
        name: 'Updated Name',
      } as any);

      await controller.updateTenant(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.name).toBe('Updated Name');
    });

    it('should return 404 for non-existent tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
        body: { name: 'New Name' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.updateTenant).mockRejectedValue(new Error('Tenant not found'));

      await controller.updateTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 404 for deleted tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
        body: { name: 'New Name' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.updateTenant).mockRejectedValue(
        new Error('Cannot update deleted tenant')
      );

      await controller.updateTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteTenant', () => {
    it('should return success on delete', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.deleteTenant).mockResolvedValue({
        deleted: true,
        tenantId: mockTenant.id,
      });

      await controller.deleteTenant(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.deleted).toBe(true);
    });

    it('should return 404 for non-existent tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.deleteTenant).mockRejectedValue(new Error('Tenant not found'));

      await controller.deleteTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 for already deleted tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.deleteTenant).mockRejectedValue(new Error('Tenant already deleted'));

      await controller.deleteTenant(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe('createApiKey', () => {
    it('should return 201 on successful creation', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
        body: {
          name: 'New Key',
          environment: 'live',
          permissions: { chat: true, knowledge: true, admin: false },
        },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createApiKey).mockResolvedValue({
        id: 'new-key-id',
        key: 'omni_live_newkey',
        keyPrefix: 'omni_live_',
        name: 'New Key',
        permissions: { chat: true, knowledge: true, admin: false },
        createdAt: new Date(),
      });

      await controller.createApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
    });

    it('should return 404 for non-existent tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
        body: { name: 'New Key' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createApiKey).mockRejectedValue(new Error('Tenant not found'));

      await controller.createApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for deleted tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
        body: { name: 'New Key' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.createApiKey).mockRejectedValue(
        new Error('Cannot create API key for deleted tenant')
      );

      await controller.createApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listApiKeys', () => {
    it('should return API keys list', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.listApiKeys).mockResolvedValue([
        {
          id: 'key-1',
          name: 'Key 1',
          keyPrefix: 'omni_live_',
          permissions: { chat: true, knowledge: true, admin: true },
          lastUsedAt: null,
          expiresAt: null,
          createdAt: new Date(),
        },
      ]);

      await controller.listApiKeys(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.apiKeys).toHaveLength(1);
    });

    it('should return 404 for non-existent tenant', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.listApiKeys).mockRejectedValue(new Error('Tenant not found'));

      await controller.listApiKeys(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });

  describe('listTenants', () => {
    it('should return paginated tenants list', async () => {
      const request = mockFastifyRequest({
        query: { limit: '20', offset: '0' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.listTenants).mockResolvedValue({
        tenants: [mockTenant as any],
        total: 1,
        limit: 20,
        offset: 0,
      });

      await controller.listTenants(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.tenants).toHaveLength(1);
      expect(reply.body.data.total).toBe(1);
    });
  });

  describe('revokeApiKey', () => {
    it('should return success on revoke', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id, keyId: '123e4567-e89b-12d3-a456-426614174001' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.revokeApiKey).mockResolvedValue({
        revoked: true,
        apiKeyId: '123e4567-e89b-12d3-a456-426614174001',
      });

      await controller.revokeApiKey(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.revoked).toBe(true);
    });

    it('should return 400 when revoking last admin key', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id, keyId: '123e4567-e89b-12d3-a456-426614174001' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.revokeApiKey).mockRejectedValue(
        new Error('Cannot revoke the last admin API key')
      );

      await controller.revokeApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent API key', async () => {
      const request = mockFastifyRequest({
        params: { id: mockTenant.id, keyId: '123e4567-e89b-12d3-a456-426614174999' },
      }) as any;
      const reply = mockFastifyReply();

      vi.mocked(tenantService.revokeApiKey).mockRejectedValue(new Error('API key not found'));

      await controller.revokeApiKey(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
    });
  });
});
