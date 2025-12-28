import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { getProcessor } from '../../modules/knowledge/processors/index.js';
import { getChunker } from '../../modules/knowledge/chunkers/index.js';
import { embeddingQueue } from '../queue.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/index.js';
import type { ProcessDocumentJob } from '../jobs.types.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

async function processDocument(job: Job<ProcessDocumentJob>) {
  const { sourceId, tenantId } = job.data;

  logger.info({ sourceId }, 'Processing document');

  try {
    // Get source record
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source || !source.storagePath || !source.mimeType) {
      throw new Error('Source not found or missing required fields');
    }

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EXTRACTING' },
    });

    // Download file
    const buffer = await storage.download(source.storagePath);

    // Get processor
    const processor = getProcessor(source.mimeType);
    if (!processor) {
      throw new Error(`No processor for mime type: ${source.mimeType}`);
    }

    // Extract text
    const extracted = await processor.extract(buffer, source.originalFilename || 'document');

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'CHUNKING' },
    });

    // Chunk text
    const chunker = getChunker();
    const chunks = chunker.chunk(extracted.text);

    if (chunks.length === 0) {
      throw new Error('No chunks generated from document');
    }

    logger.info({ sourceId, chunkCount: chunks.length }, 'Document chunked');

    // Queue embedding job
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

    // Update status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EMBEDDING' },
    });
  } catch (error) {
    logger.error({ sourceId, error }, 'Document processing failed');

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

export const documentWorker = new Worker('document-processing', processDocument, {
  connection,
  concurrency: 2,
});

documentWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Document processing completed');
});

documentWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err }, 'Document processing failed');
});
