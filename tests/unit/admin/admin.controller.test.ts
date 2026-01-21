import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockAdminRequest,
  mockAdminReply,
  mockPlatformStats,
  mockAdminTenant,
} from '../../fixtures/admin.fixtures.js';

// Mock admin auth
vi.mock('../../../src/modules/admin/admin.auth.js', () => ({
  verifyAdminCredentials: vi.fn(),
  getMasterApiKey: vi.fn(),
}));

// Mock admin service
vi.mock('../../../src/modules/admin/admin.service.js', () => ({
  getPlatformStats: vi.fn(),
  getTenantHealthMetrics: vi.fn(),
  getTenantStats: vi.fn(),
}));

// Mock tenant service
vi.mock('../../../src/modules/tenant/tenant.service.js', () => ({
  listTenants: vi.fn(),
  getTenant: vi.fn(),
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
  deleteTenant: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

import { verifyAdminCredentials, getMasterApiKey } from '../../../src/modules/admin/admin.auth.js';
import * as adminService from '../../../src/modules/admin/admin.service.js';
import * as tenantService from '../../../src/modules/tenant/tenant.service.js';
import * as controller from '../../../src/modules/admin/admin.controller.js';

describe('Admin Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authenticateAdmin', () => {
    it('should return 200 with master key for valid credentials', async () => {
      vi.mocked(verifyAdminCredentials).mockResolvedValue(true);
      vi.mocked(getMasterApiKey).mockReturnValue('master_test123');

      const request = mockAdminRequest({
        body: { username: 'admin', password: 'correct-password' },
      });
      const reply = mockAdminReply();

      await controller.authenticateAdmin(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.masterKey).toBe('master_test123');
      expect(reply.body.data.username).toBe('admin');
    });

    it('should return 401 for invalid credentials', async () => {
      vi.mocked(verifyAdminCredentials).mockResolvedValue(false);

      const request = mockAdminRequest({
        body: { username: 'admin', password: 'wrong-password' },
      });
      const reply = mockAdminReply();

      await controller.authenticateAdmin(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 503 when admin is not configured', async () => {
      vi.mocked(verifyAdminCredentials).mockRejectedValue(
        new Error('Admin credentials are not configured')
      );

      const request = mockAdminRequest({
        body: { username: 'admin', password: 'password' },
      });
      const reply = mockAdminReply();

      await controller.authenticateAdmin(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('should throw for other errors', async () => {
      vi.mocked(verifyAdminCredentials).mockRejectedValue(new Error('Database error'));

      const request = mockAdminRequest({
        body: { username: 'admin', password: 'password' },
      });
      const reply = mockAdminReply();

      await expect(controller.authenticateAdmin(request as any, reply)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('getPlatformAnalytics', () => {
    it('should return platform stats', async () => {
      vi.mocked(adminService.getPlatformStats).mockResolvedValue(mockPlatformStats);

      const request = mockAdminRequest();
      const reply = mockAdminReply();

      await controller.getPlatformAnalytics(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockPlatformStats);
    });
  });

  describe('getTenantList', () => {
    it('should return tenants with health metrics', async () => {
      vi.mocked(tenantService.listTenants).mockResolvedValue({ tenants: [mockAdminTenant] } as any);
      vi.mocked(adminService.getTenantHealthMetrics).mockResolvedValue([
        {
          tenantId: mockAdminTenant.id,
          tenantName: mockAdminTenant.name,
          tenantSlug: mockAdminTenant.slug,
          status: 'healthy',
          metrics: {
            failedJobsCount: 0,
            errorRate: 0,
            lastActivity: new Date().toISOString(), // Service returns ISO string
            conversationCount: 10,
            knowledgeSourceCount: 5,
            indexedSourceCount: 5,
            failedSourceCount: 0,
          },
        },
      ] as any);

      const request = mockAdminRequest({ query: {} });
      const reply = mockAdminReply();

      await controller.getTenantList(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.tenants).toHaveLength(1);
      expect(reply.body.data.tenants[0].healthStatus).toBe('healthy');
    });

    it('should filter tenants by search query', async () => {
      vi.mocked(tenantService.listTenants).mockResolvedValue({
        tenants: [
          { ...mockAdminTenant, name: 'Acme Corp' },
          { ...mockAdminTenant, id: 'other-id', name: 'Other Company' },
        ],
      } as any);
      vi.mocked(adminService.getTenantHealthMetrics).mockResolvedValue([]);

      const request = mockAdminRequest({ query: { search: 'acme' } });
      const reply = mockAdminReply();

      await controller.getTenantList(request as any, reply);

      expect(reply.body.data.tenants).toHaveLength(1);
      expect(reply.body.data.tenants[0].name).toBe('Acme Corp');
    });

    it('should paginate results', async () => {
      const tenants = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...mockAdminTenant,
          id: `tenant-${i}`,
          name: `Tenant ${i}`,
        }));

      vi.mocked(tenantService.listTenants).mockResolvedValue({ tenants } as any);
      vi.mocked(adminService.getTenantHealthMetrics).mockResolvedValue([]);

      const request = mockAdminRequest({ query: { limit: 10, offset: 5 } });
      const reply = mockAdminReply();

      await controller.getTenantList(request as any, reply);

      expect(reply.body.data.tenants).toHaveLength(10);
      expect(reply.body.data.total).toBe(20);
      expect(reply.body.data.offset).toBe(5);
      expect(reply.body.data.hasMore).toBe(true);
    });
  });

  describe('getTenantDetail', () => {
    it('should return tenant details with stats', async () => {
      vi.mocked(tenantService.getTenant).mockResolvedValue(mockAdminTenant as any);
      vi.mocked(adminService.getTenantStats).mockResolvedValue({
        tenantId: mockAdminTenant.id,
        tenantName: mockAdminTenant.name,
        tenantSlug: mockAdminTenant.slug,
        createdAt: mockAdminTenant.createdAt,
        stats: {
          conversations: { total: 10, active: 2, escalated: 1, closed: 7 },
          messages: { total: 100, last24h: 10, last7d: 30, last30d: 80 },
          knowledgeSources: {
            total: 5,
            indexed: 4,
            processing: 1,
            failed: 0,
            byType: { PDF: 3, URL: 2 },
          },
          apiKeys: { total: 2, active: 2 },
        },
        health: {
          failedJobs: 0,
          errorRate: 0,
          lastActivity: new Date().toISOString(), // Service returns ISO string
        },
      } as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
      });
      const reply = mockAdminReply();

      await controller.getTenantDetail(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.id).toBe(mockAdminTenant.id);
      expect(reply.body.data.stats.conversations.total).toBe(10);
    });

    it('should return 404 for non-existent tenant', async () => {
      vi.mocked(tenantService.getTenant).mockResolvedValue(null);

      const request = mockAdminRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
      });
      const reply = mockAdminReply();

      await controller.getTenantDetail(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('getTenantHealth', () => {
    it('should return health for specific tenant', async () => {
      vi.mocked(adminService.getTenantHealthMetrics).mockResolvedValue([
        {
          tenantId: mockAdminTenant.id,
          tenantName: mockAdminTenant.name,
          tenantSlug: mockAdminTenant.slug,
          status: 'healthy',
          metrics: {
            failedJobsCount: 0,
            errorRate: 0,
            lastActivity: new Date().toISOString(), // Service returns ISO string
            conversationCount: 10,
            knowledgeSourceCount: 5,
            indexedSourceCount: 5,
            failedSourceCount: 0,
          },
        },
      ] as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
      });
      const reply = mockAdminReply();

      await controller.getTenantHealth(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.tenantId).toBe(mockAdminTenant.id);
    });

    it('should return health for all tenants when no id provided', async () => {
      const healthMetrics = [
        { tenantId: 'tenant-1', status: 'healthy' },
        { tenantId: 'tenant-2', status: 'warning' },
      ];
      vi.mocked(adminService.getTenantHealthMetrics).mockResolvedValue(healthMetrics as any);

      const request = mockAdminRequest({ params: {} });
      const reply = mockAdminReply();

      await controller.getTenantHealth(request as any, reply);

      expect(reply.body.data).toEqual(healthMetrics);
    });
  });

  describe('createTenant', () => {
    it('should create tenant and return 201', async () => {
      vi.mocked(tenantService.createTenant).mockResolvedValue({
        tenant: mockAdminTenant,
        apiKey: { key: 'omni_live_test123' },
      } as any);

      const request = mockAdminRequest({
        body: { name: 'New Tenant', slug: 'new-tenant' },
      });
      const reply = mockAdminReply();

      await controller.createTenant(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant and return 200', async () => {
      vi.mocked(tenantService.updateTenant).mockResolvedValue({
        ...mockAdminTenant,
        name: 'Updated Name',
      } as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
        body: { name: 'Updated Name' },
      });
      const reply = mockAdminReply();

      await controller.updateTenant(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.name).toBe('Updated Name');
    });

    it('should return 404 when tenant not found', async () => {
      vi.mocked(tenantService.updateTenant).mockResolvedValue(null as any);

      const request = mockAdminRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174999' },
        body: { name: 'Updated Name' },
      });
      const reply = mockAdminReply();

      await controller.updateTenant(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('deleteTenant', () => {
    it('should delete tenant and return 200', async () => {
      vi.mocked(tenantService.deleteTenant).mockResolvedValue({ deleted: true } as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
      });
      const reply = mockAdminReply();

      await controller.deleteTenant(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
    });
  });

  describe('listTenantApiKeys', () => {
    it('should return API keys for tenant', async () => {
      vi.mocked(tenantService.listApiKeys).mockResolvedValue([
        { id: 'key-1', name: 'Production Key', keyPrefix: 'omni_live_abc' },
        { id: 'key-2', name: 'Development Key', keyPrefix: 'omni_test_xyz' },
      ] as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
      });
      const reply = mockAdminReply();

      await controller.listTenantApiKeys(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.data).toHaveLength(2);
    });
  });

  describe('createTenantApiKey', () => {
    it('should create API key and return 201', async () => {
      vi.mocked(tenantService.createApiKey).mockResolvedValue({
        id: 'new-key',
        key: 'omni_live_newkey123',
        name: 'New Key',
      } as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
        body: { name: 'New Key' },
      });
      const reply = mockAdminReply();

      await controller.createTenantApiKey(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.key).toBe('omni_live_newkey123');
    });

    it('should handle expiresIn parameter', async () => {
      vi.mocked(tenantService.createApiKey).mockResolvedValue({
        id: 'new-key',
        key: 'omni_live_newkey123',
        name: 'Expiring Key',
      } as any);

      const request = mockAdminRequest({
        params: { id: mockAdminTenant.id },
        body: { name: 'Expiring Key', expiresIn: 30 }, // 30 days
      });
      const reply = mockAdminReply();

      await controller.createTenantApiKey(request as any, reply);

      expect(tenantService.createApiKey).toHaveBeenCalledWith(
        mockAdminTenant.id,
        expect.objectContaining({
          name: 'Expiring Key',
          expiresAt: expect.any(Date),
        })
      );
    });
  });

  describe('revokeTenantApiKey', () => {
    it('should revoke API key and return 200', async () => {
      vi.mocked(tenantService.revokeApiKey).mockResolvedValue({ revoked: true } as any);

      const request = mockAdminRequest({
        params: {
          id: mockAdminTenant.id,
          keyId: '123e4567-e89b-12d3-a456-426614174001',
        },
      });
      const reply = mockAdminReply();

      await controller.revokeTenantApiKey(request as any, reply);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.body.success).toBe(true);
    });
  });
});
