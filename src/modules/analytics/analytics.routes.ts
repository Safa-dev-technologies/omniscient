import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './analytics.controller.js';

/**
 * Analytics routes
 * All routes require authentication
 */
export async function analyticsRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Overview metrics
  fastify.get('/overview', {
    handler: controller.getOverview,
  });

  // Conversation time series
  fastify.get('/conversations', {
    handler: controller.getConversationTimeSeries,
  });

  // Channel breakdown
  fastify.get('/channels', {
    handler: controller.getChannelBreakdown,
  });

  // Escalation metrics
  fastify.get('/escalations', {
    handler: controller.getEscalationMetrics,
  });

  // Knowledge statistics
  fastify.get('/knowledge', {
    handler: controller.getKnowledgeStats,
  });
}
