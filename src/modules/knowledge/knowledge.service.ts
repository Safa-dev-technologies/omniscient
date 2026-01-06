import { nanoid } from 'nanoid';
import { prisma } from '../../lib/prisma.js';
import { KnowledgeSourceType } from '@prisma/client';
import { storage } from '../../lib/storage/index.js';
import { generateEmbedding } from '../../lib/llm/index.js';
import { queryVectors, getPineconeIndex } from '../../lib/pinecone.js';
import { documentQueue, crawlQueue, syncQueue } from '../../jobs/queue.js';
import { parseExpression } from 'cron-parser';
import { env } from '../../config/index.js';
import { getProcessor } from './processors/index.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import type {
  ListSourcesInput,
  SearchInput,
  CrawlUrlInput,
  ConnectNotionInput,
} from './knowledge.schema.js';
import { crawlManager } from './crawlers/crawl.manager.js';
import { NotionConnector } from './connectors/index.js';
import { encryptJson, decryptJson } from '../../utils/crypto.js';
import type { ConnectorCredentials } from './connectors/connector.interface.js';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
};

interface UploadParams {
  tenantId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  name?: string;
}

export async function uploadDocument(params: UploadParams) {
  const { tenantId, filename, mimeType, buffer, name } = params;

  // Validate mime type
  const sourceType = ALLOWED_MIME_TYPES[mimeType];
  if (!sourceType) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Check processor exists
  const processor = getProcessor(mimeType);
  if (!processor) {
    throw new Error(`No processor for file type: ${mimeType}`);
  }

  // Generate storage path
  const storagePath = `${tenantId}/${nanoid()}/${filename}`;

  // Upload to storage
  await storage.upload(storagePath, buffer, mimeType);

  // Create database record
  const source = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: name || filename,
      type: sourceType as KnowledgeSourceType,
      originalFilename: filename,
      mimeType,
      fileSize: buffer.length,
      storagePath,
      status: 'PENDING',
      pineconeNamespace: `tenant_${tenantId}`,
    },
  });

  // Queue processing job
  await documentQueue.add('PROCESS_DOCUMENT', {
    sourceId: source.id,
    tenantId,
  });

  logger.info({ sourceId: source.id, filename }, 'Document queued for processing');

  return {
    sourceId: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    message: 'Document queued for processing',
  };
}

export async function listSources(tenantId: string, params: ListSourcesInput) {
  const { status, limit, offset } = params;

  const where = {
    tenantId,
    ...(status && { status }),
  };

  const [sources, total] = await Promise.all([
    prisma.knowledgeSource.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        statusMessage: true,
        chunkCount: true,
        tokenCount: true,
        uploadedAt: true,
        indexedAt: true,
      },
    }),
    prisma.knowledgeSource.count({ where }),
  ]);

  return { sources, total, limit, offset };
}

export async function getSource(tenantId: string, sourceId: string) {
  return prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
    include: {
      _count: { select: { chunks: true } },
    },
  });
}

export async function deleteSource(tenantId: string, sourceId: string) {
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
  });

  if (!source) {
    throw new Error('Source not found');
  }

  // Delete from Pinecone (all vectors with this sourceId)
  const namespace = `tenant_${tenantId}`;
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { sourceId },
    select: { vectorId: true },
  });

  if (chunks.length > 0) {
    const { getPineconeIndex } = await import('../../lib/pinecone.js');
    const index = getPineconeIndex();
    await index.namespace(namespace).deleteMany(chunks.map((c) => c.vectorId));
  }

  // Delete file from storage
  if (source.storagePath) {
    await storage.delete(source.storagePath).catch((err) => {
      logger.warn({ err, storagePath: source.storagePath }, 'Failed to delete file from storage');
    });
  }

  // Delete from database (cascades to chunks)
  await prisma.knowledgeSource.delete({ where: { id: sourceId } });

  logger.info({ sourceId }, 'Source deleted');
}

export async function reindexSource(tenantId: string, sourceId: string) {
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
  });

  if (!source) {
    throw new Error('Source not found');
  }

  // Delete existing vectors from Pinecone
  const namespace = `tenant_${tenantId}`;
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { sourceId },
    select: { vectorId: true },
  });

  if (chunks.length > 0) {
    const index = getPineconeIndex();
    await index.namespace(namespace).deleteMany(chunks.map((c) => c.vectorId));
    logger.info({ sourceId, deletedVectors: chunks.length }, 'Deleted old vectors from Pinecone');
  }

  // Reset status
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      status: 'PENDING',
      statusMessage: null,
      chunkCount: 0,
      tokenCount: 0,
    },
  });

  // Delete existing chunks
  await prisma.knowledgeChunk.deleteMany({ where: { sourceId } });

  // Queue reprocessing
  await documentQueue.add('PROCESS_DOCUMENT', {
    sourceId: source.id,
    tenantId,
  });

  return { sourceId, status: 'PENDING', message: 'Reindex queued' };
}

export async function searchKnowledge(tenantId: string, params: SearchInput) {
  const { q, limit, threshold } = params;

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(q);

  // Query Pinecone
  const namespace = `tenant_${tenantId}`;
  const matches = await queryVectors(namespace, queryEmbedding, limit, threshold);

  // Format results
  return matches.map((match) => ({
    score: match.score,
    text: match.metadata?.text as string | undefined,
    sourceName: match.metadata?.sourceName as string | undefined,
    sourceId: match.metadata?.sourceId as string | undefined,
    chunkIndex: match.metadata?.chunkIndex as number | undefined,
    pageNumber: match.metadata?.pageNumber as number | undefined,
  }));
}

/**
 * Create URL source and queue crawl job
 */
export async function createUrlSource(tenantId: string, input: CrawlUrlInput) {
  const { url, name, options } = input;

  // Validate URL format (http/https only)
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    throw new Error(
      `Unsupported URL scheme: ${urlObj.protocol}. Only http and https are supported.`
    );
  }

  // Default options
  const crawlOptions = {
    crawlSitemap: options?.crawlSitemap ?? false,
    maxDepth: options?.maxDepth ?? 0,
    maxPages: options?.maxPages ?? 10,
    includePatterns: options?.includePatterns,
    excludePatterns: options?.excludePatterns,
  };

  // Create database record
  const source = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name: name || urlObj.hostname,
      type: 'URL' as KnowledgeSourceType,
      sourceUrl: url,
      mimeType: 'text/html',
      status: 'PENDING',
      pineconeNamespace: `tenant_${tenantId}`,
    },
  });

  // Queue crawl job
  await crawlQueue.add('CRAWL_URL', {
    type: 'CRAWL_URL',
    sourceId: source.id,
    tenantId,
    url,
    options: crawlOptions,
  });

  logger.info({ sourceId: source.id, url }, 'URL crawl queued');

  return {
    sourceId: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    message: 'URL crawl queued for processing',
  };
}

/**
 * Get crawl status for a URL source
 */
export async function getCrawlStatus(tenantId: string, sourceId: string) {
  // Verify source exists and belongs to tenant
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
  });

  if (!source) {
    throw new Error('Source not found');
  }

  if (source.type !== 'URL') {
    throw new Error('Source is not a URL type');
  }

  // Get crawl state
  const state = await crawlManager.getState(sourceId);

  if (!state) {
    // No crawl state means crawl hasn't started or completed and cleaned up
    return {
      sourceId,
      status: 'not_started',
      message: 'Crawl has not started or has been completed and cleaned up',
    };
  }

  // Calculate current depth (max depth of pending URLs)
  const pendingKey = `crawl:pending:${sourceId}`;
  const pendingUrls = await redis.zrange(pendingKey, 0, -1, 'WITHSCORES');
  let currentDepth = 0;
  if (pendingUrls.length > 0) {
    // Get max depth from pending URLs (scores are at odd indices)
    const depths = pendingUrls
      .filter((_: string, i: number) => i % 2 === 1)
      .map((d: string) => parseInt(d, 10));
    currentDepth = Math.max(...depths, 0);
  }

  return {
    sourceId: state.sourceId,
    status: state.status,
    rootUrl: state.rootUrl,
    pagesDiscovered: state.pagesDiscovered,
    pagesCrawled: state.pagesCrawled,
    pagesErrored: state.pagesErrored,
    currentDepth,
    options: {
      maxDepth: state.options.maxDepth,
      maxPages: state.options.maxPages,
      crawlSitemap: state.options.crawlSitemap,
    },
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };
}

/**
 * Cancel a running crawl
 */
export async function cancelCrawl(tenantId: string, sourceId: string) {
  // Verify source exists and belongs to tenant
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
  });

  if (!source) {
    throw new Error('Source not found');
  }

  if (source.type !== 'URL') {
    throw new Error('Source is not a URL type');
  }

  // Get crawl state
  const state = await crawlManager.getState(sourceId);

  if (!state) {
    throw new Error('Crawl state not found - crawl may not have started');
  }

  if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
    throw new Error(`Crawl is already ${state.status}`);
  }

  // Cancel crawl
  await crawlManager.cancelCrawl(sourceId);

  // Update source status
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      status: 'FAILED',
      statusMessage: 'Crawl cancelled by user',
    },
  });

  return {
    sourceId,
    status: 'cancelled',
    pagesCrawled: state.pagesCrawled,
    message: `Crawl cancelled. ${state.pagesCrawled} pages were processed.`,
  };
}

/**
 * Connect a Notion workspace
 */
export async function connectNotion(tenantId: string, input: ConnectNotionInput) {
  const { name, apiKey, rootPageId } = input;

  // Create connector instance
  const connector = new NotionConnector();

  // Test connection
  const credentials: ConnectorCredentials = { apiKey, rootPageId };
  const isValid = await connector.testConnection(credentials);
  if (!isValid) {
    throw new Error('Failed to connect to Notion: Invalid API key or insufficient permissions');
  }

  // Encrypt credentials
  const encryptedCredentials = encryptJson(credentials);

  // Create source record
  const source = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name,
      type: 'NOTION',
      credentials: encryptedCredentials as any, // Prisma Json type
      status: 'PENDING',
      sourceUrl: rootPageId ? `https://notion.so/${rootPageId.replace(/-/g, '')}` : undefined,
    },
  });

  logger.info({ sourceId: source.id, tenantId }, 'Notion workspace connected');

  // Set default sync schedule if not provided (daily at 2 AM)
  const defaultSchedule = '0 2 * * *';
  const nextSyncAt = calculateNextSync(defaultSchedule);

  // Update source with sync schedule
  await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: {
      syncSchedule: defaultSchedule,
      nextSyncAt,
    },
  });

  // Queue initial sync immediately
  await syncQueue.add(
    'SYNC_SOURCE',
    {
      type: 'SYNC_SOURCE',
      sourceId: source.id,
      tenantId,
      sourceType: 'NOTION',
    },
    {
      jobId: `sync-${source.id}-${Date.now()}`,
    }
  );

  return {
    sourceId: source.id,
    status: source.status,
    name: source.name,
    type: source.type,
    message: 'Notion workspace connected successfully. Initial sync queued.',
  };
}

/**
 * Get connector for a source type
 */
function getConnector(type: KnowledgeSourceType) {
  switch (type) {
    case 'NOTION':
      return new NotionConnector();
    default:
      throw new Error(`Unsupported connector type: ${type}`);
  }
}

/**
 * Trigger manual sync for a source
 */
export async function syncSource(tenantId: string, sourceId: string) {
  // Verify source exists and belongs to tenant
  const source = await prisma.knowledgeSource.findFirst({
    where: { id: sourceId, tenantId },
  });

  if (!source) {
    throw new Error('Source not found');
  }

  // Only connector types can be synced
  const connectorTypes: KnowledgeSourceType[] = ['NOTION', 'ZENDESK'];
  if (!connectorTypes.includes(source.type)) {
    throw new Error(`Source type ${source.type} does not support syncing`);
  }

  // Decrypt credentials
  if (!source.credentials) {
    throw new Error('Source has no credentials');
  }

  // Prisma returns Json type which can be string or object
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

  // Update source status
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      status: 'PENDING',
      statusMessage: 'Sync queued',
    },
  });

  // Queue sync job
  await syncQueue.add(
    'SYNC_SOURCE',
    {
      type: 'SYNC_SOURCE',
      sourceId,
      tenantId,
      sourceType: source.type,
    },
    {
      jobId: `sync-${sourceId}-${Date.now()}`,
    }
  );

  logger.info({ sourceId, tenantId, type: source.type }, 'Sync queued for source');

  return {
    sourceId,
    status: 'PENDING',
    message: 'Sync queued successfully',
  };
}

/**
 * Calculate next sync time from cron expression
 */
function calculateNextSync(cronExpression: string): Date {
  try {
    const interval = parseExpression(cronExpression);
    return interval.next().toDate();
  } catch (error) {
    logger.error({ error, cronExpression }, 'Invalid cron expression, using default');
    // Default to 24 hours from now
    const nextSync = new Date();
    nextSync.setHours(nextSync.getHours() + env.SYNC_DEFAULT_INTERVAL_HOURS);
    return nextSync;
  }
}
