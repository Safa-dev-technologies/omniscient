import type { FastifyRequest, FastifyReply } from 'fastify';
import * as adminService from './admin.service.js';
import * as tenantService from '../tenant/tenant.service.js';
import { verifyAdminCredentials, getMasterApiKey } from './admin.auth.js';
import {
  createSession,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
  getSessionCount,
} from './admin.session.js';
import {
  adminLoginSchema,
  tenantQuerySchema,
  createTenantSchema,
  updateTenantSchema,
  tenantIdParamSchema,
  apiKeyIdParamSchema,
  createApiKeySchema,
  type AdminLoginInput,
  type TenantQueryInput,
  type CreateTenantInput,
  type UpdateTenantInput,
} from './admin.schema.js';

/**
 * Admin login - verify credentials, create session, and return session ID + master API key
 */
export async function authenticateAdmin(
  request: FastifyRequest<{ Body: AdminLoginInput }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { username, password } = adminLoginSchema.parse(request.body);

    const isValid = await verifyAdminCredentials(username, password);

    if (!isValid) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
        },
      });
    }

    // Create session with metadata
    const sessionId = await createSession(username, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // Return both session ID (for session-based auth) and master key (for backwards compatibility)
    const masterKey = getMasterApiKey();

    return reply.status(200).send({
      success: true,
      data: {
        sessionId,
        masterKey,
        username,
        expiresIn: 8 * 60 * 60, // 8 hours in seconds
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Admin panel is not configured',
        },
      });
    }
    throw error;
  }
}

/**
 * Admin logout - revoke current session
 */
export async function logoutAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = request.headers['x-admin-session'] as string | undefined;

  if (!sessionId) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'MISSING_SESSION',
        message: 'No session to logout from',
      },
    });
  }

  const revoked = await revokeSession(sessionId);

  return reply.status(200).send({
    success: true,
    data: {
      revoked,
      message: revoked ? 'Session revoked successfully' : 'Session not found or already expired',
    },
  });
}

/**
 * List all active admin sessions
 */
export async function listSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessions = await listActiveSessions();

  // Mask session IDs for security (only show first/last 4 chars)
  const maskedSessions = sessions.map((session) => ({
    ...session,
    sessionId: `${session.sessionId.substring(0, 4)}...${session.sessionId.substring(60)}`,
  }));

  const count = await getSessionCount();

  return reply.status(200).send({
    success: true,
    data: {
      sessions: maskedSessions,
      total: count,
    },
  });
}

/**
 * Revoke a specific admin session by ID
 */
export async function revokeSessionById(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { sessionId } = request.params;

  if (!sessionId || sessionId.length !== 64) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'INVALID_SESSION_ID',
        message: 'Invalid session ID format',
      },
    });
  }

  const revoked = await revokeSession(sessionId);

  return reply.status(200).send({
    success: true,
    data: {
      revoked,
      message: revoked ? 'Session revoked successfully' : 'Session not found or already expired',
    },
  });
}

/**
 * Revoke all sessions for a specific username
 */
export async function revokeUserSessions(
  request: FastifyRequest<{ Params: { username: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { username } = request.params;

  if (!username) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'INVALID_USERNAME',
        message: 'Username is required',
      },
    });
  }

  const revokedCount = await revokeAllSessions(username);

  return reply.status(200).send({
    success: true,
    data: {
      revokedCount,
      message: `${revokedCount} session(s) revoked for user ${username}`,
    },
  });
}

/**
 * Get platform-wide analytics
 */
export async function getPlatformAnalytics(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const stats = await adminService.getPlatformStats();

  return reply.status(200).send({
    success: true,
    data: stats,
  });
}

/**
 * List all tenants with optional filtering and pagination
 */
export async function getTenantList(
  request: FastifyRequest<{ Querystring: TenantQueryInput }>,
  reply: FastifyReply
): Promise<void> {
  const query = tenantQuerySchema.parse(request.query);

  // Get all tenants (no pagination here, we filter in memory)
  const { tenants } = await tenantService.listTenants({
    limit: 1000, // Fetch all for admin view
    offset: 0,
  });

  // Get health metrics for all tenants
  const healthMetrics = await adminService.getTenantHealthMetrics();

  // Create a map for quick lookup
  const healthMap = new Map(healthMetrics.map((h) => [h.tenantId, h]));

  // Combine tenant data with health metrics
  const tenantsWithHealth = tenants.map((tenant) => {
    const health = healthMap.get(tenant.id);
    return {
      ...tenant,
      health: health?.metrics || null,
      healthStatus: health?.status || 'healthy',
    };
  });

  // Apply search filter
  let filteredTenants = tenantsWithHealth;
  if (query.search) {
    const searchLower = query.search.toLowerCase();
    filteredTenants = filteredTenants.filter(
      (t) =>
        t.name.toLowerCase().includes(searchLower) || t.slug.toLowerCase().includes(searchLower)
    );
  }

  // Apply status filter
  if (query.status !== 'all') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    filteredTenants = filteredTenants.filter((t) => {
      const lastActivityDate = t.health?.lastActivity ? new Date(t.health.lastActivity) : null;
      const isActive = lastActivityDate && lastActivityDate > thirtyDaysAgo;
      return query.status === 'active' ? isActive : !isActive;
    });
  }

  // Sort
  filteredTenants.sort((a, b) => {
    let aVal: any, bVal: any;

    switch (query.sortBy) {
      case 'name':
        aVal = a.name;
        bVal = b.name;
        break;
      case 'lastActivity':
        aVal = a.health?.lastActivity ? new Date(a.health.lastActivity).getTime() : 0;
        bVal = b.health?.lastActivity ? new Date(b.health.lastActivity).getTime() : 0;
        break;
      case 'createdAt':
      default:
        aVal = a.createdAt.getTime();
        bVal = b.createdAt.getTime();
        break;
    }

    if (query.sortOrder === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });

  // Pagination
  const total = filteredTenants.length;
  const paginatedTenants = filteredTenants.slice(query.offset, query.offset + query.limit);

  return reply.status(200).send({
    success: true,
    data: {
      tenants: paginatedTenants,
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + query.limit < total,
    },
  });
}

/**
 * Get detailed information for a specific tenant
 */
export async function getTenantDetail(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = tenantIdParamSchema.parse(request.params);

  // Get tenant basic info
  const tenant = await tenantService.getTenant(id);

  if (!tenant) {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      },
    });
  }

  // Get detailed stats
  const stats = await adminService.getTenantStats(id);

  return reply.status(200).send({
    success: true,
    data: {
      ...tenant,
      stats: stats?.stats,
      health: stats?.health,
    },
  });
}

/**
 * Get health metrics for a specific tenant or all tenants
 */
export async function getTenantHealth(
  request: FastifyRequest<{ Params: { id?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const tenantId = request.params.id;

  if (tenantId) {
    // Validate UUID
    tenantIdParamSchema.parse({ id: tenantId });
  }

  const healthMetrics = await adminService.getTenantHealthMetrics(tenantId);

  return reply.status(200).send({
    success: true,
    data: tenantId ? healthMetrics[0] : healthMetrics,
  });
}

/**
 * Create a new tenant (proxies to existing tenant service)
 */
export async function createTenant(
  request: FastifyRequest<{ Body: CreateTenantInput }>,
  reply: FastifyReply
): Promise<void> {
  const input = createTenantSchema.parse(request.body);

  const tenant = await tenantService.createTenant({
    name: input.name,
    slug: input.slug,
    botName: input.botName ?? 'Assistant',
    monthlyMessageLimit: input.monthlyMessageLimit ?? 10000,
    systemPrompt: input.systemPrompt,
    welcomeMessage: input.welcomeMessage,
    fallbackMessage: input.fallbackMessage,
    settings: input.settings as Record<string, unknown> | undefined,
  });

  return reply.status(201).send({
    success: true,
    data: tenant,
  });
}

/**
 * Update a tenant (proxies to existing tenant service)
 */
export async function updateTenant(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateTenantInput }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = tenantIdParamSchema.parse(request.params);
  const input = updateTenantSchema.parse(request.body);

  const tenant = await tenantService.updateTenant(id, {
    name: input.name,
    botName: input.botName,
    systemPrompt: input.systemPrompt,
    welcomeMessage: input.welcomeMessage,
    fallbackMessage: input.fallbackMessage,
    monthlyMessageLimit: input.monthlyMessageLimit,
    settings: input.settings as Record<string, unknown> | null | undefined,
    status: input.status,
  });

  if (!tenant) {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      },
    });
  }

  return reply.status(200).send({
    success: true,
    data: tenant,
  });
}

/**
 * Delete a tenant (proxies to existing tenant service)
 */
export async function deleteTenant(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = tenantIdParamSchema.parse(request.params);

  await tenantService.deleteTenant(id);

  return reply.status(200).send({
    success: true,
    data: { message: 'Tenant deleted successfully' },
  });
}

/**
 * List API keys for a tenant
 */
export async function listTenantApiKeys(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = tenantIdParamSchema.parse(request.params);

  const apiKeys = await tenantService.listApiKeys(id);

  return reply.status(200).send({
    success: true,
    data: apiKeys,
  });
}

/**
 * Create API key for a tenant
 */
export async function createTenantApiKey(
  request: FastifyRequest<{ Params: { id: string }; Body: any }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = tenantIdParamSchema.parse(request.params);
  const input = createApiKeySchema.parse(request.body);

  const apiKey = await tenantService.createApiKey(id, {
    name: input.name,
    environment: input.environment ?? 'live',
    expiresAt: input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 24 * 60 * 60 * 1000)
      : undefined,
    permissions: input.permissions ?? { chat: true, knowledge: true, admin: false },
  });

  return reply.status(201).send({
    success: true,
    data: apiKey,
  });
}

/**
 * Revoke API key for a tenant
 */
export async function revokeTenantApiKey(
  request: FastifyRequest<{ Params: { id: string; keyId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { id, keyId } = apiKeyIdParamSchema.parse(request.params);

  await tenantService.revokeApiKey(id, keyId);

  return reply.status(200).send({
    success: true,
    data: { message: 'API key revoked successfully' },
  });
}
