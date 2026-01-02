import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { generateEmbeddings } from '../../lib/llm/index.js';
import { upsertVectors } from '../../lib/pinecone.js';
import { logger } from '../../lib/logger.js';
import { env, CONSTANTS } from '../../config/index.js';
import type { GenerateEmbeddingsJob } from '../jobs.types.js';
import { RetryableError, NonRetryableError } from '../jobs.types.js';
import { isRetryable, formatErrorMessage, moveToDeadLetter } from '../error-utils.js';
import { TenantRateLimiter } from '../rate-limiter.js';
import { redis } from '../../lib/redis.js';
import { logProcessingMetrics } from '../metrics.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

const rateLimiter = new TenantRateLimiter(redis, 'embedding-generation', {
  maxConcurrent: 3, // Lower for API rate limits
  maxPerMinute: 30,
  maxPerHour: 500,
});

async function generateEmbeddingsJob(job: Job<GenerateEmbeddingsJob>) {
  const { sourceId, tenantId, chunks } = job.data;
  const startTime = Date.now();
  let embeddingTimeMs = 0;

  logger.info({ sourceId, chunkCount: chunks.length, attempt: job.attemptsMade + 1 }, 'Generating embeddings');

  // Check rate limit before processing
  const canProcess = await rateLimiter.canProcess(tenantId);
  if (!canProcess) {
    logger.info({ sourceId, tenantId }, 'Rate limited, delaying job');
    // Delay and retry with jitter (20-40s)
    const delay = 30000 + Math.floor(Math.random() * 20000);
    await job.moveToDelayed(Date.now() + delay);
    return;
  }

  // Mark job as started
  await rateLimiter.startJob(tenantId, job.id!);

  try {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new NonRetryableError('Source not found');
    }

    // Check if already indexed (idempotency)
    if (source.status === 'INDEXED') {
      logger.info({ sourceId }, 'Source already indexed, skipping');
      return;
    }

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EMBEDDING' },
    });

    const namespace = `tenant_${tenantId}`;
    const batchSize = CONSTANTS.EMBEDDING_BATCH_SIZE;
    let totalTokens = 0;
    const upsertedIds: string[] = [];

    // Process in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);

      try {
        // Generate embeddings
        const embedStart = Date.now();
        const embeddings = await generateEmbeddings(texts);
        embeddingTimeMs += Date.now() - embedStart;

        // Prepare vectors for Pinecone
        const vectors = batch.map((chunk, idx) => {
          const metadata: Record<string, string | number | boolean> = {
            text: chunk.text,
            sourceId,
            sourceName: source.name,
            chunkIndex: chunk.index,
            tenantId,
          };

          if (chunk.metadata.pageNumber !== undefined) {
            metadata.pageNumber = chunk.metadata.pageNumber as number;
          }

          if (chunk.metadata.sectionTitle) {
            metadata.sectionTitle = chunk.metadata.sectionTitle as string;
          }

          const vectorId = `chunk_${sourceId}_${chunk.index.toString().padStart(5, '0')}`;
          upsertedIds.push(vectorId);

          return {
            id: vectorId,
            values: embeddings[idx],
            metadata,
          };
        });

        // Upsert to Pinecone
        await upsertVectors(namespace, vectors);

        // Save chunks to database
        await prisma.knowledgeChunk.createMany({
          data: batch.map((chunk, idx) => ({
            sourceId,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            chunkIndex: chunk.index,
            pageNumber: chunk.metadata.pageNumber as number | undefined,
            sectionTitle: chunk.metadata.sectionTitle as string | undefined,
            vectorId: vectors[idx].id,
            metadata: chunk.metadata as any,
          })),
        });

        totalTokens += batch.reduce((sum, c) => sum + c.tokenCount, 0);

        logger.debug({ sourceId, batch: i / batchSize + 1 }, 'Batch processed');
      } catch (batchError) {
        // If this is the first batch and it fails, we can retry
        // If we've already upserted some vectors, we need to handle partial failure
        if (i === 0) {
          // First batch failed - can retry entire job
          throw batchError;
        }

        // Partial failure - log and continue with remaining batches
        logger.error(
          {
            sourceId,
            batch: i / batchSize + 1,
            error: batchError,
            upsertedCount: upsertedIds.length,
          },
          'Batch processing failed, continuing with remaining batches'
        );
        // Continue processing remaining batches
      }
    }

    // Update status to INDEXED
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'INDEXED',
        chunkCount: chunks.length,
        tokenCount: totalTokens,
        indexedAt: new Date(),
      },
    });

    logger.info({
      sourceId,
      chunkCount: chunks.length,
      totalTokens,
      embeddingTimeMs,
      totalTimeMs: Date.now() - startTime,
    }, 'Embeddings complete');
  } catch (error) {
    // Always decrement concurrent count on error
    await rateLimiter.endJob(tenantId);
    // Classify error
    if (isRetryable(error)) {
      logger.warn(
        { sourceId, error, attempt: job.attemptsMade + 1 },
        'Retryable error in embedding generation'
      );
      throw new RetryableError('Temporary failure', error as Error);
    }

    // Non-retryable: move to dead letter
    logger.error({ sourceId, error }, 'Non-retryable error in embedding generation');
    await moveToDeadLetter(job, error, 'embedding-generation');

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: formatErrorMessage(error),
      },
    });

    // Don't throw - job is "complete" (moved to DLQ)
    return;
  } finally {
    // Always decrement concurrent count
    await rateLimiter.endJob(tenantId);
  }
}

export const embeddingWorker = new Worker('embedding-generation', generateEmbeddingsJob, {
  connection,
  concurrency: 1, // Lower concurrency due to API rate limits
});

embeddingWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Embedding generation completed');
});

embeddingWorker.on('failed', async (job, err) => {
  if (!job) return;

  const { sourceId } = job.data;

  // Check if max retries exhausted
  const maxAttempts = job.opts.attempts || 5;
  if (job.attemptsMade >= maxAttempts) {
    logger.error(
      {
        jobId: job.id,
        sourceId,
        attempts: job.attemptsMade,
        error: err,
      },
      'Embedding generation permanently failed'
    );

    // Move to dead letter queue
    await moveToDeadLetter(job, err, 'embedding-generation');

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
      'Embedding generation failed, will retry'
    );
  }
});
