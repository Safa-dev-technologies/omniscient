import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { env, CONSTANTS } from './config/index.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error.middleware.js';

// Route imports (to be added as modules are built)
import { tenantRoutes } from './modules/tenant/tenant.routes.js';
import { knowledgeRoutes } from './modules/knowledge/knowledge.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';

export async function buildServer() {
  const server = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // Register plugins
  await server.register(cors, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await server.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await server.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
  });

  await server.register(multipart, {
    limits: {
      fileSize: CONSTANTS.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: CONSTANTS.MAX_FILES_PER_UPLOAD,
    },
  });

  // Error handler
  server.setErrorHandler(errorHandler);

  // Health check
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API version prefix
  server.register(
    async (api) => {
      // Register routes here as modules are built
      api.register(tenantRoutes, { prefix: '/tenants' });
      api.register(knowledgeRoutes, { prefix: '/knowledge' });
      api.register(chatRoutes, { prefix: '/chat' });

      // Placeholder route
      api.get('/', async () => {
        return { message: 'Omniscient API v1' };
      });
    },
    { prefix: `/${env.API_VERSION}` }
  );

  // Serve static files (after API routes to avoid conflicts)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  await server.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/',
  });

  // Serve index.html for root path
  server.get('/', async (request, reply) => {
    return reply.sendFile('index.html');
  });

  return server;
}
