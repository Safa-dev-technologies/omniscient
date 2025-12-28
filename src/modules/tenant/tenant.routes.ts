import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { masterKeyMiddleware } from '../../middleware/masterKey.middleware.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './tenant.controller.js';

/**
 * Combined middleware: try master key first, fall back to tenant key
 * IMPORTANT: If auth header starts with 'master_', we ONLY try master key auth.
 * We only fall back to tenant auth for non-master key formats.
 */
async function masterOrTenantAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  // If it looks like a master key, ONLY try master key auth
  if (authHeader?.startsWith('Bearer master_')) {
    await masterKeyMiddleware(request, reply);
    // masterKeyMiddleware either sets isMasterKey=true or sends error response
    // Either way, we're done - don't fall through to tenant auth
    return;
  }

  // Not a master key format, use tenant key auth
  await authMiddleware(request, reply);
}

/**
 * Tenant routes with mixed authentication:
 * - Master key routes: create, list, delete (full admin access)
 * - Tenant key routes: get, update, API key management (scoped to own tenant with admin permission)
 */
export async function tenantRoutes(fastify: FastifyInstance) {
  // Routes that require master key only
  fastify.post('/', {
    preHandler: masterKeyMiddleware,
    handler: controller.createTenant,
  });

  fastify.get('/', {
    preHandler: masterKeyMiddleware,
    handler: controller.listTenants,
  });

  fastify.delete('/:id', {
    preHandler: masterKeyMiddleware,
    handler: controller.deleteTenant,
  });

  // Routes that accept either master key OR tenant key (with admin permission)
  fastify.get('/:id', {
    preHandler: masterOrTenantAuth,
    handler: controller.getTenant,
  });

  fastify.patch('/:id', {
    preHandler: masterOrTenantAuth,
    handler: controller.updateTenant,
  });

  fastify.post('/:id/api-keys', {
    preHandler: masterOrTenantAuth,
    handler: controller.createApiKey,
  });

  fastify.get('/:id/api-keys', {
    preHandler: masterOrTenantAuth,
    handler: controller.listApiKeys,
  });

  fastify.delete('/:id/api-keys/:keyId', {
    preHandler: masterOrTenantAuth,
    handler: controller.revokeApiKey,
  });
}
