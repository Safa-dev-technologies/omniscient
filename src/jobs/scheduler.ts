/**
 * Sync Scheduler
 * Periodically checks for knowledge sources that need syncing and queues sync jobs
 */

import { prisma } from '../lib/prisma.js';
import { syncQueue } from './queue.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/index.js';
import cronParser from 'cron-parser';
import type { KnowledgeSourceType } from '@prisma/client';

const CONNECTOR_TYPES: KnowledgeSourceType[] = ['NOTION', 'ZENDESK'];

/**
 * Calculate next sync time based on cron expression
 */
function calculateNextSync(cronExpression: string): Date {
  try {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toDate();
  } catch (error) {
    logger.error({ error, cronExpression }, 'Invalid cron expression');
    // Default to 24 hours from now if cron is invalid
    const nextSync = new Date();
    nextSync.setHours(nextSync.getHours() + env.SYNC_DEFAULT_INTERVAL_HOURS);
    return nextSync;
  }
}

/**
 * Check and queue sync jobs for sources that are due
 */
export async function checkAndQueueSyncs(): Promise<void> {
  const now = new Date();

  try {
    // Find all connector sources with sync schedules that are due
    const sourcesToSync = await prisma.knowledgeSource.findMany({
      where: {
        type: {
          in: CONNECTOR_TYPES,
        },
        syncSchedule: {
          not: null,
        },
        OR: [
          {
            nextSyncAt: {
              lte: now,
            },
          },
          {
            nextSyncAt: null,
          },
        ],
        lastSyncStatus: {
          not: 'in_progress', // Skip if already syncing
        },
      },
    });

    logger.debug({ count: sourcesToSync.length }, 'Found sources due for sync');

    for (const source of sourcesToSync) {
      try {
        // Skip if no credentials
        if (!source.credentials) {
          logger.warn({ sourceId: source.id }, 'Source has no credentials, skipping sync');
          continue;
        }

        // Queue sync job
        await syncQueue.add(
          'SYNC_SOURCE',
          {
            type: 'SYNC_SOURCE',
            sourceId: source.id,
            tenantId: source.tenantId,
            sourceType: source.type,
          },
          {
            jobId: `sync-${source.id}-${Date.now()}`, // Unique job ID per source
          }
        );

        // Mark as in_progress
        const nextSyncAt = source.syncSchedule ? calculateNextSync(source.syncSchedule) : null;

        await prisma.knowledgeSource.update({
          where: { id: source.id },
          data: {
            lastSyncStatus: 'in_progress',
            nextSyncAt,
          },
        });

        logger.info(
          { sourceId: source.id, tenantId: source.tenantId, type: source.type, nextSyncAt },
          'Queued sync job'
        );
      } catch (error) {
        logger.error({ error, sourceId: source.id }, 'Failed to queue sync job');
        // Mark as failed
        await prisma.knowledgeSource.update({
          where: { id: source.id },
          data: {
            lastSyncStatus: 'failed',
          },
        });
      }
    }
  } catch (error) {
    logger.error({ error }, 'Error checking for syncs');
  }
}

/**
 * Start the sync scheduler
 * Runs checkAndQueueSyncs on a configurable interval
 */
export function startSyncScheduler(): void {
  const intervalMs = env.SYNC_SCHEDULER_INTERVAL * 1000; // Convert seconds to milliseconds

  logger.info({ intervalSeconds: env.SYNC_SCHEDULER_INTERVAL }, 'Starting sync scheduler');

  // Run immediately on start
  checkAndQueueSyncs().catch((error) => {
    logger.error({ error }, 'Error in initial sync check');
  });

  // Then run on interval
  setInterval(() => {
    checkAndQueueSyncs().catch((error) => {
      logger.error({ error }, 'Error in scheduled sync check');
    });
  }, intervalMs);
}
