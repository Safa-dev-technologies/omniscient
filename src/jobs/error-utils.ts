import { Job } from 'bullmq';
import { deadLetterQueue } from './queue.js';

import { RetryableError, NonRetryableError, type DeadLetterJob } from './jobs.types.js';
import { logger } from '../lib/logger.js';

/**
 * Classify whether an error is retryable or not
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;
  // RetryableError is used here but linter doesn't detect it

  if (error instanceof RetryableError) return true;

  const message = error instanceof Error ? error.message : String(error);

  // Network/transient errors
  if (message.includes('ECONNRESET')) return true;
  if (message.includes('ETIMEDOUT')) return true;
  if (message.includes('ENOTFOUND')) return true;
  if (message.includes('ECONNREFUSED')) return true;
  if (message.includes('timeout')) return true;

  // API errors
  if (error instanceof Error && 'status' in error) {
    const status = (error as any).status;
    if (status === 429) return true; // Rate limit
    if (status === 503) return true; // Service unavailable
    if (status >= 500) return true; // Server errors
  }

  // HTTP status code in message
  if (message.includes('429')) return true; // Rate limit
  if (message.includes('503')) return true; // Service unavailable
  if (message.match(/5\d{2}/)) return true; // 5xx errors

  return false;
}

/**
 * Format error message for storage
 * @internal - exported for potential future use
 */

export function formatErrorMessage(_error: unknown): string {
  if (_error instanceof Error) {
    return _error.message;
  }
  return String(_error);
}

/**
 * Move a failed job to the dead letter queue
 */
export async function moveToDeadLetter<T>(
  job: Job<T>,
  error: unknown,
  originalQueue: string
): Promise<void> {
  try {
    await deadLetterQueue.add('failed-job', {
      originalQueue,
      originalJobId: job.id,
      data: job.data,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    } satisfies DeadLetterJob);

    logger.info(
      {
        jobId: job.id,
        originalQueue,
        attemptsMade: job.attemptsMade,
      },
      'Job moved to dead letter queue'
    );
  } catch (dlqError) {
    logger.error(
      {
        jobId: job.id,
        originalQueue,
        error: dlqError,
      },
      'Failed to move job to dead letter queue'
    );
    // Don't throw - we don't want DLQ failures to cascade
  }
}
