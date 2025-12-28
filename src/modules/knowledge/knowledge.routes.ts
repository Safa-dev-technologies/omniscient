import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import * as controller from './knowledge.controller.js';

export async function knowledgeRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Upload document
  fastify.post('/upload', {
    preHandler: requirePermission('knowledge'),
    handler: controller.uploadDocument,
  });

  // List sources
  fastify.get('/sources', {
    preHandler: requirePermission('knowledge'),
    handler: controller.listSources,
  });

  // Get source details
  fastify.get('/sources/:id', {
    preHandler: requirePermission('knowledge'),
    handler: controller.getSource,
  });

  // Delete source
  fastify.delete('/sources/:id', {
    preHandler: requirePermission('knowledge'),
    handler: controller.deleteSource,
  });

  // Reindex source
  fastify.post('/sources/:id/reindex', {
    preHandler: requirePermission('knowledge'),
    handler: controller.reindexSource,
  });

  // Test search
  fastify.get('/search', {
    preHandler: requirePermission('knowledge'),
    handler: controller.searchKnowledge,
  });
}
