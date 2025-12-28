import { prisma } from '../../lib/prisma.js';
import { generateApiKey } from '../../utils/hash.js';
import { CONSTANTS } from '../../config/index.js';
import { deleteNamespace } from '../../lib/pinecone.js';
import { logger } from '../../lib/logger.js';
import type { Prisma } from '@prisma/client';
import type {
  CreateTenantInput,
  UpdateTenantInput,
  ListTenantsInput,
  CreateApiKeyInput,
} from './tenant.schema.js';
import type {
  TenantCreateResult,
  TenantListItem,
  TenantDetails,
  ApiKeyListItem,
} from './tenant.types.js';

/**
 * Check if slug is reserved
 */
function isReservedSlug(slug: string): boolean {
  return (CONSTANTS.RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase());
}

/**
 * Create a new tenant with an initial API key
 */
export async function createTenant(input: CreateTenantInput): Promise<TenantCreateResult> {
  const normalizedSlug = input.slug.toLowerCase();

  // Check reserved slugs
  if (isReservedSlug(normalizedSlug)) {
    throw new Error('Slug is reserved and cannot be used');
  }

  // Generate initial API key (do this before transaction to avoid holding lock)
  const { key, hash, prefix } = generateApiKey('live');

  // Create tenant and API key in a transaction
  // Handle unique constraint violation for slug race condition
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: input.name,
          slug: normalizedSlug,
          botName: input.botName,
          systemPrompt: input.systemPrompt,
          welcomeMessage: input.welcomeMessage,
          fallbackMessage: input.fallbackMessage,
          monthlyMessageLimit: input.monthlyMessageLimit,
          settings: input.settings as Prisma.InputJsonValue | undefined,
          status: 'ACTIVE',
        },
      });

      const apiKey = await tx.apiKey.create({
        data: {
          tenantId: tenant.id,
          name: 'Initial API Key',
          keyHash: hash,
          keyPrefix: prefix,
          permissions: {
            chat: true,
            knowledge: true,
            admin: true, // First key gets admin permission
          },
        },
      });

      // Log analytics event
      await tx.analyticsEvent.create({
        data: {
          tenantId: tenant.id,
          eventType: 'tenant_created',
          metadata: {
            name: tenant.name,
            slug: tenant.slug,
          },
        },
      });

      return { tenant, apiKey };
    });
  } catch (error: any) {
    // Handle Prisma unique constraint violation (P2002)
    if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
      throw new Error('Tenant with this slug already exists');
    }
    throw error;
  }

  logger.info({ tenantId: result.tenant.id, slug: normalizedSlug }, 'Tenant created');

  return {
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      slug: result.tenant.slug,
      status: result.tenant.status,
      botName: result.tenant.botName,
      createdAt: result.tenant.createdAt,
    },
    apiKey: {
      id: result.apiKey.id,
      key, // ONLY TIME the raw key is exposed
      keyPrefix: prefix,
      name: result.apiKey.name,
      permissions: result.apiKey.permissions as Record<string, boolean>,
      createdAt: result.apiKey.createdAt,
    },
  };
}

/**
 * List tenants with filtering and pagination
 */
export async function listTenants(input: ListTenantsInput) {
  const { status, limit, offset, search } = input;

  const where: Prisma.TenantWhereInput = {};
  if (status) {
    where.status = status;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search.toLowerCase(), mode: 'insensitive' } },
    ];
  }

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        botName: true,
        monthlyMessageLimit: true,
        monthlyMessagesUsed: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    tenants: tenants as TenantListItem[],
    total,
    limit,
    offset,
  };
}

/**
 * Get tenant details by ID
 */
export async function getTenant(tenantId: string): Promise<TenantDetails | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    return null;
  }

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    botName: tenant.botName,
    systemPrompt: tenant.systemPrompt,
    welcomeMessage: tenant.welcomeMessage,
    fallbackMessage: tenant.fallbackMessage,
    monthlyMessageLimit: tenant.monthlyMessageLimit,
    monthlyMessagesUsed: tenant.monthlyMessagesUsed,
    settings: tenant.settings as Record<string, unknown> | null,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

/**
 * Update tenant
 */
export async function updateTenant(tenantId: string, input: UpdateTenantInput) {
  // Check if tenant exists and is not deleted
  const existing = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!existing) {
    throw new Error('Tenant not found');
  }

  if (existing.status === 'DELETED') {
    throw new Error('Cannot update deleted tenant');
  }

  // Build update data (only include defined fields)
  const updateData: Prisma.TenantUpdateInput = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.botName !== undefined) updateData.botName = input.botName;
  if (input.systemPrompt !== undefined) updateData.systemPrompt = input.systemPrompt;
  if (input.welcomeMessage !== undefined) updateData.welcomeMessage = input.welcomeMessage;
  if (input.fallbackMessage !== undefined) updateData.fallbackMessage = input.fallbackMessage;
  if (input.monthlyMessageLimit !== undefined)
    updateData.monthlyMessageLimit = input.monthlyMessageLimit;
  if (input.settings !== undefined) updateData.settings = input.settings as Prisma.InputJsonValue;
  if (input.status !== undefined) updateData.status = input.status;

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
  });

  logger.info({ tenantId }, 'Tenant updated');

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    botName: tenant.botName,
    systemPrompt: tenant.systemPrompt,
    welcomeMessage: tenant.welcomeMessage,
    fallbackMessage: tenant.fallbackMessage,
    monthlyMessageLimit: tenant.monthlyMessageLimit,
    monthlyMessagesUsed: tenant.monthlyMessagesUsed,
    settings: tenant.settings as Record<string, unknown> | null,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

/**
 * Soft delete tenant (set status to DELETED)
 */
export async function deleteTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  if (tenant.status === 'DELETED') {
    throw new Error('Tenant already deleted');
  }

  await prisma.$transaction(async (tx) => {
    // Soft delete tenant
    await tx.tenant.update({
      where: { id: tenantId },
      data: { status: 'DELETED' },
    });

    // Log analytics event
    await tx.analyticsEvent.create({
      data: {
        tenantId,
        eventType: 'tenant_deleted',
        metadata: {
          name: tenant.name,
          slug: tenant.slug,
        },
      },
    });
  });

  // Clean up Pinecone namespace (async, don't await to avoid blocking)
  const namespace = `tenant_${tenantId}`;
  deleteNamespace(namespace).catch((err) => {
    logger.error({ err, tenantId, namespace }, 'Failed to delete Pinecone namespace');
  });

  logger.info({ tenantId }, 'Tenant deleted');

  return { deleted: true, tenantId };
}

/**
 * Create API key for tenant
 */
export async function createApiKey(
  tenantId: string,
  input: CreateApiKeyInput
): Promise<{
  id: string;
  key: string;
  keyPrefix: string;
  name: string;
  permissions: Record<string, boolean>;
  createdAt: Date;
}> {
  // Verify tenant exists and is active
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  if (tenant.status === 'DELETED') {
    throw new Error('Cannot create API key for deleted tenant');
  }

  // Generate API key
  const { key, hash, prefix } = generateApiKey(input.environment);

  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId,
      name: input.name,
      keyHash: hash,
      keyPrefix: prefix,
      permissions: input.permissions,
      expiresAt: input.expiresAt,
    },
  });

  logger.info({ tenantId, apiKeyId: apiKey.id, keyPrefix: prefix }, 'API key created');

  return {
    id: apiKey.id,
    key, // ONLY TIME the raw key is exposed
    keyPrefix: prefix,
    name: apiKey.name,
    permissions: apiKey.permissions as Record<string, boolean>,
    createdAt: apiKey.createdAt,
  };
}

/**
 * List API keys for tenant
 */
export async function listApiKeys(tenantId: string): Promise<ApiKeyListItem[]> {
  // Verify tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      permissions: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return apiKeys.map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    permissions: key.permissions as Record<string, boolean>,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
  }));
}

/**
 * Revoke (delete) API key
 * Prevents revoking the last admin key to avoid lockout
 */
export async function revokeApiKey(tenantId: string, apiKeyId: string) {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, tenantId },
  });

  if (!apiKey) {
    throw new Error('API key not found');
  }

  // Check if this is an admin key
  const permissions = apiKey.permissions as Record<string, boolean>;
  if (permissions.admin === true) {
    // Check if any remaining keys have admin permission
    const remainingAdminKeys = await prisma.apiKey.findMany({
      where: {
        tenantId,
        id: { not: apiKeyId },
      },
      select: { permissions: true },
    });

    const hasOtherAdminKey = remainingAdminKeys.some(
      (k) => (k.permissions as Record<string, boolean>).admin === true
    );

    if (!hasOtherAdminKey) {
      throw new Error('Cannot revoke the last admin API key');
    }
  }

  await prisma.apiKey.delete({
    where: { id: apiKeyId },
  });

  logger.info({ tenantId, apiKeyId, keyPrefix: apiKey.keyPrefix }, 'API key revoked');

  return { revoked: true, apiKeyId };
}
