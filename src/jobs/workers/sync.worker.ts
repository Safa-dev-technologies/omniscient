/**
 * Sync Worker
 * Processes sync jobs for external knowledge sources (Notion, Zendesk, etc.)
 */

import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import type { SyncSourceJob } from '../jobs.types.js';
import { KnowledgeSourceType } from '@prisma/client';
import { decryptJson } from '../../utils/crypto.js';
import type {
  ConnectorCredentials,
  FetchedArticle,
} from '../../modules/knowledge/connectors/connector.interface.js';
import { NotionConnector } from '../../modules/knowledge/connectors/index.js';
import { getChunker } from '../../modules/knowledge/chunkers/index.js';
import { generateEmbedding } from '../../lib/llm/index.js';
import { getPineconeIndex } from '../../lib/pinecone.js';

const connection = {
  host: new URL(process.env.REDIS_URL || 'redis://localhost:6379').hostname,
  port: parseInt(new URL(process.env.REDIS_URL || 'redis://localhost:6379').port || '6379', 10),
};

/**
 * Get connector instance for a source type
 */
function getConnector(type: KnowledgeSourceType) {
  switch (type) {
    case 'NOTION':
      return new NotionConnector();

    case 'ZENDESK':
      // TODO: Implement Zendesk connector
      throw new Error('Zendesk connector not yet implemented');

    default:
      throw new Error(`Unsupported connector type: ${type}`);
  }
}

/**
 * Process a sync job
 */
async function processSyncJob(job: Job<SyncSourceJob>) {
  const { sourceId, tenantId, sourceType } = job.data;

  logger.info({ sourceId, tenantId, sourceType }, 'Processing sync job');

  try {
    // Get source with credentials - use compound lookup with tenantId for isolation
    // This prevents race conditions where sourceId could be reused after deletion
    const source = await prisma.knowledgeSource.findFirst({
      where: { id: sourceId, tenantId },
    });

    if (!source) {
      throw new Error(`Source not found: ${sourceId} for tenant ${tenantId}`);
    }

    // Verify it's a connector type
    const connectorTypes: KnowledgeSourceType[] = ['NOTION', 'ZENDESK'];
    if (!connectorTypes.includes(source.type)) {
      throw new Error(`Source type ${source.type} does not support syncing`);
    }

    // Decrypt credentials
    if (!source.credentials) {
      throw new Error('Source has no credentials');
    }

    const credentialsStr =
      typeof source.credentials === 'string'
        ? source.credentials
        : JSON.stringify(source.credentials);
    const credentials = decryptJson<ConnectorCredentials>(credentialsStr);

    // Get connector
    const connector = getConnector(source.type);

    // Test connection
    const isValid = await connector.testConnection(credentials);
    if (!isValid) {
      throw new Error('Connection test failed. Please reconnect the source.');
    }

    // Determine if full or incremental sync
    const since = source.lastSyncedAt || undefined;
    const articles = since
      ? connector.fetchSince(credentials, since)
      : connector.fetchAll(credentials);

    let added = 0;
    let updated = 0;
    const errors: string[] = [];

    // Process articles
    for await (const article of articles) {
      try {
        // Check if article exists (by externalId in metadata)
        const existingChunk = await prisma.knowledgeChunk.findFirst({
          where: {
            sourceId,
            metadata: {
              path: ['externalId'],
              equals: article.externalId,
            },
          },
        });

        if (existingChunk) {
          // Check if content changed
          const existingChecksum = (existingChunk.metadata as Record<string, unknown>)?.checksum as
            | string
            | undefined;

          if (existingChecksum !== article.checksum) {
            // Update existing chunk
            await updateArticle(sourceId, article, existingChunk.id);
            updated++;
          }
          // Else: no change, skip
        } else {
          // Add new article
          await addArticle(sourceId, tenantId, article);
          added++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to process article ${article.externalId}: ${errorMsg}`);
        logger.error({ error, articleId: article.externalId }, 'Error processing article');
      }
    }

    // Update source status
    const now = new Date();
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        status: 'INDEXED',
        statusMessage: `Sync completed: ${added} added, ${updated} updated`,
      },
    });

    logger.info(
      { sourceId, tenantId, added, updated, errors: errors.length },
      'Sync job completed'
    );

    return {
      sourceId,
      added,
      updated,
      errors: errors.length,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error, sourceId, tenantId }, 'Sync job failed');

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        lastSyncStatus: 'failed',
        statusMessage: `Sync failed: ${errorMsg}`,
      },
    });

    throw error;
  }
}

/**
 * Add a new article to the knowledge base
 */
async function addArticle(
  sourceId: string,
  tenantId: string,
  article: FetchedArticle
): Promise<void> {
  // Get source to get namespace
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { pineconeNamespace: true },
  });

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // Chunk the content
  const chunker = getChunker();
  const chunks = chunker.chunk(article.content);

  // Generate embeddings and index
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk.text);

    // Create vector ID
    const vectorId = `chunk_${sourceId}_${i.toString().padStart(5, '0')}`;

    // Store chunk in database
    await prisma.knowledgeChunk.create({
      data: {
        id: vectorId,
        sourceId,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        chunkIndex: chunk.index,
        vectorId,
        metadata: {
          title: article.title,
          url: article.url,
          externalId: article.externalId,
          checksum: article.checksum,
          section: article.section,
          category: article.category,
          author: article.author,
          ...article.metadata,
        } as any,
      },
    });

    // Index in Pinecone
    const namespace = `tenant_${tenantId}`;
    const index = await getPineconeIndex();
    await index.namespace(namespace).upsert([
      {
        id: vectorId,
        values: embedding,
        metadata: {
          sourceId,
          tenantId,
          text: chunk.text.substring(0, 1000), // Store first 1000 chars for retrieval
          chunkIndex: chunk.index,
          title: article.title,
          externalId: article.externalId,
        },
      },
    ]);
  }

  // Update source chunk count
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      chunkCount: {
        increment: chunks.length,
      },
    },
  });
}

/**
 * Update an existing article
 */
async function updateArticle(
  sourceId: string,
  article: FetchedArticle,
  _existingChunkId: string
): Promise<void> {
  // Get source
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { tenantId: true, pineconeNamespace: true },
  });

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // Delete old chunks for this article
  const oldChunks = await prisma.knowledgeChunk.findMany({
    where: {
      sourceId,
      metadata: {
        path: ['externalId'],
        equals: article.externalId,
      },
    },
  });

  // Get source to get tenantId for namespace
  const sourceForNamespace = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { tenantId: true },
  });

  if (!sourceForNamespace) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const namespace = `tenant_${sourceForNamespace.tenantId}`;
  const index = await getPineconeIndex();

  // Delete vectors from Pinecone
  if (oldChunks.length > 0) {
    const vectorIds = oldChunks.map((c) => c.id);
    await index.namespace(namespace).deleteMany(vectorIds);
  }

  // Delete chunks from database
  for (const chunk of oldChunks) {
    await prisma.knowledgeChunk.delete({ where: { id: chunk.id } });
  }

  // Add new chunks (same as addArticle)
  await addArticle(sourceId, source.tenantId, article);

  // Update source chunk count (decrement old, increment new)
  const chunker = getChunker();
  const newChunks = chunker.chunk(article.content);

  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      chunkCount: {
        increment: newChunks.length - oldChunks.length,
      },
    },
  });
}

// Create worker
const syncWorker = new Worker('external-sync', processSyncJob, {
  connection,
  concurrency: 5, // Process up to 5 sync jobs concurrently
});

syncWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, sourceId: job.data.sourceId }, 'Sync job completed');
});

syncWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, sourceId: job?.data.sourceId, error }, 'Sync job failed');
});

logger.info('Sync worker started');
