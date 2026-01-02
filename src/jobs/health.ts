import { documentQueue, embeddingQueue, deadLetterQueue } from './queue.js';
import { logger } from '../lib/logger.js';

export interface WorkerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  queues: {
    document: {
      waiting: number;
      active: number;
      failed: number;
      completed: number;
    };
    embedding: {
      waiting: number;
      active: number;
      failed: number;
      completed: number;
    };
    deadLetter: {
      count: number;
    };
  };
  timestamp: string;
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  try {
    const [docWaiting, docActive, docFailed, docCompleted] = await Promise.all([
      documentQueue.getWaitingCount(),
      documentQueue.getActiveCount(),
      documentQueue.getFailedCount(),
      documentQueue.getCompletedCount(),
    ]);

    const [embedWaiting, embedActive, embedFailed, embedCompleted] = await Promise.all([
      embeddingQueue.getWaitingCount(),
      embeddingQueue.getActiveCount(),
      embeddingQueue.getFailedCount(),
      embeddingQueue.getCompletedCount(),
    ]);

    const dlqCount = await deadLetterQueue.getWaitingCount();

    // Determine health status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (dlqCount > 100) {
      status = 'degraded';
    }
    if (dlqCount > 500 || docFailed > 100 || embedFailed > 100) {
      status = 'unhealthy';
    }

    return {
      status,
      queues: {
        document: {
          waiting: docWaiting,
          active: docActive,
          failed: docFailed,
          completed: docCompleted,
        },
        embedding: {
          waiting: embedWaiting,
          active: embedActive,
          failed: embedFailed,
          completed: embedCompleted,
        },
        deadLetter: {
          count: dlqCount,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get worker health');
    return {
      status: 'unhealthy',
      queues: {
        document: { waiting: 0, active: 0, failed: 0, completed: 0 },
        embedding: { waiting: 0, active: 0, failed: 0, completed: 0 },
        deadLetter: { count: 0 },
      },
      timestamp: new Date().toISOString(),
    };
  }
}
