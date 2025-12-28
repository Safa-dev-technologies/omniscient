import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import * as controller from './chat.controller.js';

export async function chatRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Simple stateless chat (creates/continues conversation automatically)
  fastify.post('/', {
    preHandler: requirePermission('chat'),
    handler: controller.chat,
  });

  // Get conversation history
  fastify.get('/conversations/:id', {
    preHandler: requirePermission('chat'),
    handler: controller.getConversation,
  });

  // Send message to existing conversation
  fastify.post('/conversations/:id/messages', {
    preHandler: requirePermission('chat'),
    handler: controller.sendMessage,
  });

  // Escalate conversation
  fastify.post('/conversations/:id/escalate', {
    preHandler: requirePermission('chat'),
    handler: controller.escalateConversation,
  });

  // Close conversation
  fastify.post('/conversations/:id/close', {
    preHandler: requirePermission('chat'),
    handler: controller.closeConversation,
  });
}
