import { Worker, Job, UnrecoverableError } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { getProcessor } from '../../modules/knowledge/processors/index.js';
import { getChunker } from '../../modules/knowledge/chunkers/index.js';
import { embeddingQueue } from '../queue.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/index.js';
import type { ProcessDocumentJob } from '../jobs.types.js';
import { RetryableError, NonRetryableError } from '../jobs.types.js';
import { isRetryable, formatErrorMessage, moveToDeadLetter } from '../error-utils.js';
import { TenantRateLimiter } from '../rate-limiter.js';
import { redis } from '../../lib/redis.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

const rateLimiter = new TenantRateLimiter(redis, 'document-processing', {
  maxConcurrent: 5,
  maxPerMinute: 20,
  maxPerHour: 200,
});

async function processDocument(job: Job<ProcessDocumentJob>) {
  const { sourceId, tenantId } = job.data;
  const startTime = Date.now();
  const timings = {
    extraction: 0,
    chunking: 0,
    queueing: 0,
  };
  let jobStarted = false; // Track if rate limiter startJob was called

  logger.info({ sourceId, attempt: job.attemptsMade + 1 }, 'Processing document');

  // Check rate limit before processing
  const canProcess = await rateLimiter.canProcess(tenantId);
  if (!canProcess) {
    logger.info({ sourceId, tenantId }, 'Rate limited, delaying job');
    // Delay and retry with jitter (20-40s)
    const delay = 30000 + Math.floor(Math.random() * 20000);
    await job.moveToDelayed(Date.now() + delay);
    return; // Return early - don't call endJob since startJob wasn't called
  }

  // Mark job as started
  await rateLimiter.startJob(tenantId, job.id!);
  jobStarted = true;

  try {
    // Get source record
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source || !source.storagePath || !source.mimeType) {
      throw new NonRetryableError('Source not found or missing required fields');
    }

    // Check if already processed or currently being processed (idempotency)
    // Skip if: INDEXED (done), EMBEDDING (past document phase), EXTRACTING/CHUNKING (in progress)
    if (['INDEXED', 'EMBEDDING', 'EXTRACTING', 'CHUNKING'].includes(source.status)) {
      logger.info(
        { sourceId, status: source.status },
        'Source already processed or in progress, skipping'
      );
      return;
    }

    // Only process if status is PENDING (or FAILED for retries)
    // Use atomic update to prevent race conditions with duplicate jobs
    const updated = await prisma.knowledgeSource.updateMany({
      where: { id: sourceId, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'EXTRACTING' },
    });

    if (updated.count === 0) {
      // Status changed between check and update - another job got here first
      logger.info({ sourceId }, 'Source status changed, skipping duplicate job');
      return;
    }

    // Download file
    const buffer = await storage.download(source.storagePath);

    // Get processor
    const processor = getProcessor(source.mimeType);
    if (!processor) {
      throw new NonRetryableError(`No processor for mime type: ${source.mimeType}`);
    }

    // Time extraction
    const extractStart = Date.now();
    const extracted = await processor.extract(buffer, source.originalFilename || 'document');
    timings.extraction = Date.now() - extractStart;

    // Validate extracted content before chunking
    if (!extracted.text || extracted.text.trim().length < 10) {
      throw new NonRetryableError(
        'Document contains no extractable text content. This may be a scanned/image-only document.'
      );
    }

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'CHUNKING' },
    });

    // Time chunking
    const chunkStart = Date.now();
    const chunker = getChunker();
    const chunks = chunker.chunk(extracted.text);
    timings.chunking = Date.now() - chunkStart;

    if (chunks.length === 0) {
      throw new NonRetryableError('No chunks generated from document');
    }

    logger.info({ sourceId, chunkCount: chunks.length }, 'Document chunked');

    // Time queueing
    const queueStart = Date.now();
    await embeddingQueue.add('GENERATE_EMBEDDINGS', {
      sourceId,
      tenantId,
      chunks: chunks.map((c) => ({
        text: c.text,
        index: c.index,
        tokenCount: c.tokenCount,
        metadata: c.metadata,
      })),
    });
    timings.queueing = Date.now() - queueStart;

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EMBEDDING' },
    });

    // Log metrics
    logger.info(
      {
        sourceId,
        tenantId,
        fileSize: source.fileSize || 0,
        mimeType: source.mimeType,
        chunkCount: chunks.length,
        timings,
        totalTimeMs: Date.now() - startTime,
      },
      'Document extraction complete'
    );
  } catch (error) {
    // Get source for error logging
    const source = await prisma.knowledgeSource
      .findUnique({
        where: { id: sourceId },
      })
      .catch(() => null);

    // Log error with timing
    logger.error(
      {
        sourceId,
        tenantId,
        timings,
        totalTimeMs: Date.now() - startTime,
        fileSize: source?.fileSize || 0,
        mimeType: source?.mimeType,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : String(error),
      },
      'Document processing failed'
    );

    // Classify error and handle appropriately
    if (isRetryable(error)) {
      logger.warn(
        { sourceId, error, attempt: job.attemptsMade + 1 },
        'Retryable error in document processing'
      );
      // Throw to trigger BullMQ retry
      throw new RetryableError('Temporary failure', error as Error);
    }

    // Non-retryable: update status and throw UnrecoverableError
    logger.error({ sourceId, error }, 'Non-retryable error in document processing');

    // Update source status to FAILED
    await prisma.knowledgeSource
      .update({
        where: { id: sourceId },
        data: {
          status: 'FAILED',
          statusMessage: formatErrorMessage(error),
        },
      })
      .catch((updateError) => {
        logger.error({ sourceId, error: updateError }, 'Failed to update source status');
      });

    // Move to dead letter queue for inspection
    await moveToDeadLetter(job, error, 'document-processing');

    // Throw UnrecoverableError so BullMQ marks job as failed (no retries)
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new UnrecoverableError(errorMessage);
  } finally {
    // Only decrement concurrent count if job was actually started
    if (jobStarted) {
      await rateLimiter.endJob(tenantId);
    }
  }
}

export const documentWorker = new Worker('document-processing', processDocument, {
  connection,
  concurrency: 2,
});

documentWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Document processing completed');
});

documentWorker.on('failed', async (job, err) => {
  if (!job) return;

  const { sourceId } = job.data;

  // Check if max retries exhausted
  const maxAttempts = job.opts.attempts || 3;
  if (job.attemptsMade >= maxAttempts) {
    logger.error(
      {
        jobId: job.id,
        sourceId,
        attempts: job.attemptsMade,
        error: err,
      },
      'Document processing permanently failed'
    );

    // Move to dead letter queue
    await moveToDeadLetter(job, err, 'document-processing');

    // Update database
    try {
      await prisma.knowledgeSource.update({
        where: { id: sourceId },
        data: {
          status: 'FAILED',
          statusMessage: `Failed after ${job.attemptsMade} attempts: ${err.message}`,
        },
      });
    } catch (updateError) {
      logger.error({ sourceId, error: updateError }, 'Failed to update source status');
    }
  } else {
    logger.warn(
      {
        jobId: job.id,
        sourceId,
        attempt: job.attemptsMade,
        nextAttempt: job.attemptsMade + 1,
        error: err,
      },
      'Document processing failed, will retry'
    );
  }
});
