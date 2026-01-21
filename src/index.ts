import { loadSecretsFromAWS } from './config/secrets.js';

/**
 * Bootstrap the application
 *
 * Secrets must be loaded BEFORE importing modules that validate env vars.
 * This ensures AWS Secrets Manager values are available during env validation.
 */
async function bootstrap(): Promise<void> {
  // Load secrets first (before env validation)
  await loadSecretsFromAWS();

  // Now import modules that depend on validated env
  const { buildServer } = await import('./server.js');
  const { env } = await import('./config/index.js');
  const { logger } = await import('./lib/logger.js');
  const { prisma } = await import('./lib/prisma.js');
  const { redis } = await import('./lib/redis.js');

  const server = await buildServer();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      await server.close();
      await prisma.$disconnect();
      await redis.quit();

      logger.info('Server shut down successfully');
      process.exit(0);
    });
  });

  try {
    await server.listen({ port: env.PORT, host: env.HOST });
    logger.info(`Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
