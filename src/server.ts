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
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { initSentry } from './lib/sentry.js';

// Route imports (to be added as modules are built)
import { tenantRoutes } from './modules/tenant/tenant.routes.js';
import { knowledgeRoutes } from './modules/knowledge/knowledge.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { channelRoutes } from './modules/channel/channel.routes.js';
import { conversationRoutes } from './modules/conversation/conversation.routes.js';
import { escalationRoutes } from './modules/escalation/escalation.routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { webhookRoutes } from './webhooks/webhook.routes.js';

export async function buildServer() {
  // Initialize Sentry for error tracking (no-op if DSN not configured)
  initSentry();

  const server = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // Register plugins
  // CORS: Use explicit allowlist even in development for security
  const allowedOrigins =
    env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGINS?.split(',') ?? [])
      : [
          'http://localhost:3000',
          'http://localhost:3001', // Tenant dashboard
          'http://localhost:3002', // Admin dashboard
          'http://localhost:5173',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001',
          'http://127.0.0.1:3002',
          'http://127.0.0.1:5173',
        ];

  await server.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
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

  // Health check types
  interface HealthCheck {
    name: string;
    status: 'healthy' | 'unhealthy';
    latencyMs: number;
    error?: string;
  }

  /**
   * Check a dependency and return health status with latency
   */
  async function checkDependency(name: string, checkFn: () => Promise<void>): Promise<HealthCheck> {
    const start = Date.now();
    try {
      await checkFn();
      return {
        name,
        status: 'healthy',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Detailed health check - checks all dependencies with latency
  server.get('/health', async (request, reply) => {
    const checks = await Promise.all([
      checkDependency('database', async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
      checkDependency('redis', async () => {
        await redis.ping();
      }),
    ]);

    const allHealthy = checks.every((c) => c.status === 'healthy');

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      checks,
    });
  });

  // Lightweight liveness probe - for Kubernetes liveness checks
  // Fast response, no external calls - just confirms process is running
  server.get('/health/live', async () => {
    return { status: 'alive', timestamp: new Date().toISOString() };
  });

  // Readiness probe - can the service accept traffic?
  // Checks critical dependencies (DB and Redis)
  server.get('/health/ready', async (request, reply) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      return reply.send({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
      logger.warn({ error }, 'Readiness check failed');
      return reply.status(503).send({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Dependency check failed',
      });
    }
  });

  // Worker health check
  server.get('/health/workers', async () => {
    const { getWorkerHealth } = await import('./jobs/health.js');
    return getWorkerHealth();
  });

  // API version prefix
  server.register(
    async (api) => {
      // Register routes here as modules are built
      api.register(tenantRoutes, { prefix: '/tenants' });
      api.register(knowledgeRoutes, { prefix: '/knowledge' });
      api.register(chatRoutes, { prefix: '/chat' });
      api.register(channelRoutes, { prefix: '/channels' });
      api.register(conversationRoutes, { prefix: '/conversations' });
      api.register(escalationRoutes, { prefix: '/escalations' });
      api.register(analyticsRoutes, { prefix: '/analytics' });
      api.register(adminRoutes, { prefix: '/admin' });
      api.register(webhookRoutes, { prefix: '/webhooks' });

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
