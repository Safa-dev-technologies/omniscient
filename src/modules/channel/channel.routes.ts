import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import * as controller from './channel.controller.js';

/**
 * Channel configuration routes
 * All routes require authentication and admin permission
 */
export async function channelRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // All routes require admin permission (channel config is sensitive)
  fastify.addHook('preHandler', requirePermission('admin'));

  // Create channel config
  fastify.post('/', {
    handler: controller.createConfig,
  });

  // List all channel configs
  fastify.get('/', {
    handler: controller.listConfigs,
  });

  // Get specific channel config
  fastify.get('/:channel', {
    handler: controller.getConfig,
  });

  // Update channel config
  fastify.patch('/:channel', {
    handler: controller.updateConfig,
  });

  // Delete channel config
  fastify.delete('/:channel', {
    handler: controller.deleteConfig,
  });

  // Test channel connection
  fastify.post('/:channel/test', {
    handler: controller.testConnection,
  });

  // Rotate webhook secret
  fastify.post('/:channel/rotate-secret', {
    handler: controller.rotateWebhookSecret,
  });
}
