import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tenantService from '../../../src/modules/tenant/tenant.service.js';
import { mockTenant, mockApiKey, createTenantInput } from '../../fixtures/tenant.fixtures.js';

vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrismaLocal = {
    tenant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    apiKey: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    analyticsEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn(mockPrismaLocal)),
  };
  return {
    prisma: mockPrismaLocal,
  };
});

// Get the actual mocked prisma to use in tests
const { prisma } = await import('../../../src/lib/prisma.js');

// Mock other dependencies
vi.mock('../../../src/lib/pinecone.js', () => ({
  deleteNamespace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/hash.js', () => ({
  generateApiKey: vi.fn(() => ({
    key: 'omni_live_testkey123',
    hash: 'hashed_value',
    prefix: 'omni_live_test',
  })),
}));

describe('Tenant Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTenant', () => {
    it('should create tenant with initial API key', async () => {
      const createdTenant = {
        ...mockTenant,
        name: createTenantInput.name,
        slug: createTenantInput.slug,
        botName: createTenantInput.botName,
      };
      vi.mocked(prisma.tenant.create).mockResolvedValue(createdTenant);
      vi.mocked(prisma.apiKey.create).mockResolvedValue(mockApiKey);
      vi.mocked(prisma.analyticsEvent.create).mockResolvedValue({} as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        return fn(prisma) as any;
      });

      const result = await tenantService.createTenant(createTenantInput);

      expect(result.tenant.slug).toBe(createTenantInput.slug);
      expect(result.apiKey.key).toBe('omni_live_testkey123');
    });

    it('should reject reserved slugs', async () => {
      await expect(
        tenantService.createTenant({ ...createTenantInput, slug: 'admin' })
      ).rejects.toThrow('Slug is reserved and cannot be used');
    });

    it('should handle duplicate slug via P2002 error', async () => {
      const p2002Error: any = new Error('Unique constraint failed');
      p2002Error.code = 'P2002';
      p2002Error.meta = { target: ['slug'] };

      vi.mocked(prisma.$transaction).mockRejectedValue(p2002Error);

      await expect(tenantService.createTenant(createTenantInput)).rejects.toThrow(
        'Tenant with this slug already exists'
      );
    });
  });

  describe('getTenant', () => {
    it('should return tenant details', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);

      const result = await tenantService.getTenant(mockTenant.id);

      expect(result?.id).toBe(mockTenant.id);
      expect(result?.name).toBe(mockTenant.name);
    });

    it('should return null for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      const result = await tenantService.getTenant('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('updateTenant', () => {
    it('should update tenant fields', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.tenant.update).mockResolvedValue({
        ...mockTenant,
        name: 'Updated Name',
      });

      const result = await tenantService.updateTenant(mockTenant.id, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
    });

    it('should reject update for deleted tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        ...mockTenant,
        status: 'DELETED',
      });

      await expect(tenantService.updateTenant(mockTenant.id, { name: 'New Name' })).rejects.toThrow(
        'Cannot update deleted tenant'
      );
    });

    it('should reject update for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(
        tenantService.updateTenant('non-existent', { name: 'New Name' })
      ).rejects.toThrow('Tenant not found');
    });
  });

  describe('deleteTenant', () => {
    it('should soft delete tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.tenant.update).mockResolvedValue({
        ...mockTenant,
        status: 'DELETED',
      });
      vi.mocked(prisma.analyticsEvent.create).mockResolvedValue({} as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
        return fn(prisma) as any;
      });

      const result = await tenantService.deleteTenant(mockTenant.id);

      expect(result.deleted).toBe(true);
    });

    it('should reject delete for already deleted tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        ...mockTenant,
        status: 'DELETED',
      });

      await expect(tenantService.deleteTenant(mockTenant.id)).rejects.toThrow(
        'Tenant already deleted'
      );
    });

    it('should reject delete for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(tenantService.deleteTenant('non-existent-id')).rejects.toThrow(
        'Tenant not found'
      );
    });
  });

  describe('listTenants', () => {
    it('should return paginated list of tenants', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([mockTenant]);
      vi.mocked(prisma.tenant.count).mockResolvedValue(1);

      const result = await tenantService.listTenants({
        limit: 20,
        offset: 0,
      });

      expect(result.tenants).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should filter by status', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([mockTenant]);
      vi.mocked(prisma.tenant.count).mockResolvedValue(1);

      await tenantService.listTenants({
        status: 'ACTIVE',
        limit: 20,
        offset: 0,
      });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'ACTIVE' }),
        })
      );
    });

    it('should search by name or slug', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([mockTenant]);
      vi.mocked(prisma.tenant.count).mockResolvedValue(1);

      await tenantService.listTenants({
        search: 'test',
        limit: 20,
        offset: 0,
      });

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.any(Object) }),
              expect.objectContaining({ slug: expect.any(Object) }),
            ]),
          }),
        })
      );
    });

    it('should return empty list when no tenants exist', async () => {
      vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);
      vi.mocked(prisma.tenant.count).mockResolvedValue(0);

      const result = await tenantService.listTenants({
        limit: 20,
        offset: 0,
      });

      expect(result.tenants).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('createApiKey', () => {
    it('should create API key for active tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.apiKey.create).mockResolvedValue(mockApiKey);

      const result = await tenantService.createApiKey(mockTenant.id, {
        name: 'New Key',
        environment: 'live',
        permissions: { chat: true, knowledge: true, admin: false },
      });

      expect(result.key).toBe('omni_live_testkey123');
    });

    it('should reject API key creation for deleted tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        ...mockTenant,
        status: 'DELETED',
      });

      await expect(
        tenantService.createApiKey(mockTenant.id, {
          name: 'New Key',
          environment: 'live',
          permissions: { chat: true, knowledge: true, admin: false },
        })
      ).rejects.toThrow('Cannot create API key for deleted tenant');
    });

    it('should reject API key creation for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(
        tenantService.createApiKey('non-existent-id', {
          name: 'New Key',
          environment: 'live',
          permissions: { chat: true, knowledge: true, admin: false },
        })
      ).rejects.toThrow('Tenant not found');
    });
  });

  describe('listApiKeys', () => {
    it('should return API keys for existing tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.apiKey.findMany).mockResolvedValue([mockApiKey]);

      const result = await tenantService.listApiKeys(mockTenant.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockApiKey.id);
    });

    it('should reject for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(tenantService.listApiKeys('non-existent')).rejects.toThrow('Tenant not found');
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke non-admin API key', async () => {
      const nonAdminKey = {
        ...mockApiKey,
        permissions: { chat: true, knowledge: true, admin: false },
      };
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(nonAdminKey);
      vi.mocked(prisma.apiKey.delete).mockResolvedValue(nonAdminKey);

      const result = await tenantService.revokeApiKey(mockTenant.id, nonAdminKey.id);

      expect(result.revoked).toBe(true);
    });

    it('should allow revoking admin key if other admin keys exist', async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(mockApiKey);
      vi.mocked(prisma.apiKey.findMany).mockResolvedValue([
        { permissions: { admin: true } },
      ] as any);
      vi.mocked(prisma.apiKey.delete).mockResolvedValue(mockApiKey);

      const result = await tenantService.revokeApiKey(mockTenant.id, mockApiKey.id);

      expect(result.revoked).toBe(true);
    });

    it('should reject revoking last admin key', async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(mockApiKey);
      vi.mocked(prisma.apiKey.findMany).mockResolvedValue([]);

      await expect(tenantService.revokeApiKey(mockTenant.id, mockApiKey.id)).rejects.toThrow(
        'Cannot revoke the last admin API key'
      );
    });

    it('should reject revoking non-existent API key', async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

      await expect(
        tenantService.revokeApiKey(mockTenant.id, 'non-existent-key-id')
      ).rejects.toThrow('API key not found');
    });
  });
});
