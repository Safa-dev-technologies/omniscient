import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './escalation.controller.js';

/**
 * Escalation management routes
 * All routes require authentication
 */
export async function escalationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Create escalation
  fastify.post('/', {
    handler: controller.createEscalation,
  });

  // List escalations
  fastify.get('/', {
    handler: controller.listEscalations,
  });

  // Get escalation by ID
  fastify.get('/:id', {
    handler: controller.getEscalation,
  });

  // Update escalation
  fastify.patch('/:id', {
    handler: controller.updateEscalation,
  });

  // Resolve escalation
  fastify.post('/:id/resolve', {
    handler: controller.resolveEscalation,
  });

  // Create external ticket for escalation
  fastify.post('/:id/ticket', {
    handler: controller.createTicket,
  });
}
