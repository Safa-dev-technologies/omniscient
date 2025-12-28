import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { generateEmbeddings } from '../../lib/llm/index.js';
import { upsertVectors } from '../../lib/pinecone.js';
import { logger } from '../../lib/logger.js';
import { env, CONSTANTS } from '../../config/index.js';
import type { GenerateEmbeddingsJob } from '../jobs.types.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

async function generateEmbeddingsJob(job: Job<GenerateEmbeddingsJob>) {
  const { sourceId, tenantId, chunks } = job.data;

  logger.info({ sourceId, chunkCount: chunks.length }, 'Generating embeddings');

  try {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      throw new Error('Source not found');
    }

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EMBEDDING' },
    });

    const namespace = `tenant_${tenantId}`;
    const batchSize = CONSTANTS.EMBEDDING_BATCH_SIZE;
    let totalTokens = 0;

    // Process in batches
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);

      // Generate embeddings
      const embeddings = await generateEmbeddings(texts);

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

        return {
          id: `chunk_${sourceId}_${chunk.index.toString().padStart(5, '0')}`,
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

    logger.info({ sourceId, chunkCount: chunks.length, totalTokens }, 'Embeddings complete');
  } catch (error) {
    logger.error({ sourceId, error }, 'Embedding generation failed');

    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

export const embeddingWorker = new Worker('embedding-generation', generateEmbeddingsJob, {
  connection,
  concurrency: 1, // Lower concurrency due to API rate limits
});

embeddingWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Embedding generation completed');
});

embeddingWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err }, 'Embedding generation failed');
});
