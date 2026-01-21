import { loadSecretsFromAWS } from './config/secrets.js';

/**
 * Bootstrap the workers
 *
 * Secrets must be loaded BEFORE importing modules that validate env vars.
 * This ensures AWS Secrets Manager values are available during env validation.
 */
async function bootstrap(): Promise<void> {
  // Load secrets first (before env validation)
  await loadSecretsFromAWS();

  // Now import modules that depend on validated env
  const { logger } = await import('./lib/logger.js');
  const { initSentry, captureException } = await import('./lib/sentry.js');

  // Initialize Sentry for error tracking (no-op if DSN not configured)
  initSentry();

  // Import workers (these have side effects that register with BullMQ)
  await import('./jobs/workers/document.worker.js');
  await import('./jobs/workers/embedding.worker.js');
  await import('./jobs/workers/crawl.worker.js');
  await import('./jobs/workers/sync.worker.js');

  // Start sync scheduler
  const { startSyncScheduler } = await import('./jobs/scheduler.js');
  startSyncScheduler();

  logger.info('Workers started');

  // Capture unhandled rejections
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error({ reason }, 'Unhandled rejection in worker process');
    captureException(reason, { context: 'unhandledRejection' });
  });

  // Capture uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error({ error }, 'Uncaught exception in worker process');
    captureException(error, { context: 'uncaughtException' });
    // Give Sentry time to send the error before exiting
    setTimeout(() => process.exit(1), 1000);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start workers:', error);
  process.exit(1);
});
