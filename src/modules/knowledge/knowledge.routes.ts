import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { tenantRateLimit } from '../../middleware/tenant-rate-limit.middleware.js';
import * as controller from './knowledge.controller.js';

export async function knowledgeRoutes(fastify: FastifyInstance) {
  // All routes require authentication
  fastify.addHook('preHandler', authMiddleware);

  // Upload document (rate limited)
  fastify.post('/upload', {
    preHandler: [requirePermission('knowledge'), tenantRateLimit('upload')],
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

  // Test search (rate limited)
  fastify.get('/search', {
    preHandler: [requirePermission('knowledge'), tenantRateLimit('search')],
    handler: controller.searchKnowledge,
  });

  // Crawl URL (rate limited)
  fastify.post('/url', {
    preHandler: [requirePermission('knowledge'), tenantRateLimit('crawl')],
    handler: controller.crawlUrl,
  });

  // Get crawl status
  fastify.get('/sources/:id/crawl-status', {
    preHandler: requirePermission('knowledge'),
    handler: controller.getCrawlStatus,
  });

  // Cancel crawl
  fastify.post('/sources/:id/cancel-crawl', {
    preHandler: requirePermission('knowledge'),
    handler: controller.cancelCrawl,
  });

  // Connect Notion workspace
  fastify.post('/connect/notion', {
    preHandler: requirePermission('knowledge'),
    handler: controller.connectNotion,
  });

  // Trigger manual sync
  fastify.post('/sources/:id/sync', {
    preHandler: requirePermission('knowledge'),
    handler: controller.syncSource,
  });
}
