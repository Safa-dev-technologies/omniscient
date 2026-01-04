import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './conversation.controller.js';

/**
 * Conversation management routes
 * All routes require authentication
 */
export async function conversationRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Create conversation
  fastify.post('/', {
    handler: controller.createConversation,
  });

  // List conversations
  fastify.get('/', {
    handler: controller.listConversations,
  });

  // Get conversation by ID
  fastify.get('/:id', {
    handler: controller.getConversation,
  });

  // Update conversation
  fastify.patch('/:id', {
    handler: controller.updateConversation,
  });

  // Transition conversation status
  fastify.post('/:id/transition', {
    handler: controller.transitionStatus,
  });

  // Get conversation history (messages)
  fastify.get('/:id/history', {
    handler: controller.getHistory,
  });

  // Get allowed status transitions
  fastify.get('/:id/transitions', {
    handler: controller.getAllowedTransitions,
  });

  // Delete conversation (close it)
  fastify.delete('/:id', {
    handler: controller.deleteConversation,
  });
}
