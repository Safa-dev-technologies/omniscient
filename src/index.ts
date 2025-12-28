import { buildServer } from './server.js';
import { env } from './config/index.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

async function main() {
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
    logger.info(`🚀 Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
