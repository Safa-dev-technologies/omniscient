import type { FastifyRequest, FastifyReply } from 'fastify';

interface AuthCheckResult {
  authorized: boolean;
}

/**
 * Check if request has access to the specified tenant
 * Returns true if authorized, sends error response and returns false if not
 */
export function checkTenantAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string
): AuthCheckResult {
  // Master key has access to all tenants
  if (request.isMasterKey === true) {
    return { authorized: true };
  }

  // Tenant key can only access own tenant
  if (request.tenant?.id !== tenantId) {
    reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    });
    return { authorized: false };
  }

  // Must have admin permission
  if (request.apiKey?.permissions.admin !== true) {
    reply.status(403).send({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Admin permission required' },
    });
    return { authorized: false };
  }

  return { authorized: true };
}
