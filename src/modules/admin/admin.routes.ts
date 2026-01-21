import type { FastifyInstance } from 'fastify';
import { masterKeyMiddleware } from '../../middleware/masterKey.middleware.js';
// Admin session middleware available for future use:
// import { adminSessionMiddleware } from '../../middleware/adminSession.middleware.js';
import * as controller from './admin.controller.js';

/**
 * Admin routes - protected by master key OR admin session
 *
 * Session-based auth (recommended):
 * 1. POST /auth/login - get session ID
 * 2. Include X-Admin-Session header in subsequent requests
 * 3. POST /auth/logout - revoke session
 *
 * API key auth (backwards compatible):
 * - Include Authorization: Bearer <master-key> header
 */
export async function adminRoutes(fastify: FastifyInstance) {
  // Public route - admin login (no auth required)
  // Aggressive rate limiting to prevent brute force attacks
  fastify.post('/auth/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 5 * 60 * 1000, // 5 minutes
        keyGenerator: (request) => {
          // Rate limit by IP + username combination
          const body = request.body as { username?: string } | undefined;
          const username = body?.username || 'unknown';
          return `${request.ip}-${username}`;
        },
      },
    },
    handler: controller.authenticateAdmin,
  });

  // Logout - requires session
  fastify.post('/auth/logout', {
    handler: controller.logoutAdmin,
  });

  // Session management - requires master key (admin of admins)
  fastify.get('/sessions', {
    preHandler: masterKeyMiddleware,
    handler: controller.listSessions,
  });

  fastify.delete('/sessions/:sessionId', {
    preHandler: masterKeyMiddleware,
    handler: controller.revokeSessionById,
  });

  fastify.delete('/sessions/user/:username', {
    preHandler: masterKeyMiddleware,
    handler: controller.revokeUserSessions,
  });

  // Platform analytics
  fastify.get('/platform/analytics', {
    preHandler: masterKeyMiddleware,
    handler: controller.getPlatformAnalytics,
  });

  // Tenant management
  fastify.get('/tenants', {
    preHandler: masterKeyMiddleware,
    handler: controller.getTenantList,
  });

  fastify.post('/tenants', {
    preHandler: masterKeyMiddleware,
    handler: controller.createTenant,
  });

  fastify.get('/tenants/:id', {
    preHandler: masterKeyMiddleware,
    handler: controller.getTenantDetail,
  });

  fastify.patch('/tenants/:id', {
    preHandler: masterKeyMiddleware,
    handler: controller.updateTenant,
  });

  fastify.delete('/tenants/:id', {
    preHandler: masterKeyMiddleware,
    handler: controller.deleteTenant,
  });

  // Tenant health
  fastify.get('/tenants/:id/health', {
    preHandler: masterKeyMiddleware,
    handler: controller.getTenantHealth,
  });

  fastify.get('/health', {
    preHandler: masterKeyMiddleware,
    handler: controller.getTenantHealth, // Without ID, returns all
  });

  // Tenant API key management
  fastify.get('/tenants/:id/api-keys', {
    preHandler: masterKeyMiddleware,
    handler: controller.listTenantApiKeys,
  });

  fastify.post('/tenants/:id/api-keys', {
    preHandler: masterKeyMiddleware,
    handler: controller.createTenantApiKey,
  });

  fastify.delete('/tenants/:id/api-keys/:keyId', {
    preHandler: masterKeyMiddleware,
    handler: controller.revokeTenantApiKey,
  });
}
