import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession, type AdminSession } from '../modules/admin/admin.session.js';
import { logger } from '../lib/logger.js';

// Extend FastifyRequest to include adminSession
declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSession;
  }
}

/**
 * Middleware to require and validate admin session
 *
 * Expects session ID in X-Admin-Session header.
 * On success, attaches session to request.adminSession.
 * On failure, returns 401 with appropriate error code.
 */
export async function adminSessionMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const sessionId = request.headers['x-admin-session'] as string | undefined;

  if (!sessionId) {
    logger.debug({ path: request.url }, 'Admin session required but not provided');
    return reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin session required. Include X-Admin-Session header.',
      },
    });
  }

  const session = await validateSession(sessionId);

  if (!session) {
    logger.debug({ path: request.url }, 'Admin session invalid or expired');
    return reply.status(401).send({
      success: false,
      error: {
        code: 'SESSION_EXPIRED',
        message: 'Session expired or invalid. Please log in again.',
      },
    });
  }

  // Attach session to request for use in handlers
  request.adminSession = session;
}

/**
 * Optional middleware that validates session if present but doesn't require it
 * Useful for endpoints that have different behavior for authenticated vs anonymous
 */
export async function optionalAdminSessionMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const sessionId = request.headers['x-admin-session'] as string | undefined;

  if (sessionId) {
    const session = await validateSession(sessionId);
    if (session) {
      request.adminSession = session;
    }
  }
}
