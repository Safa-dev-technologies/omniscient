import { nanoid } from 'nanoid';
import { prisma } from '../../lib/prisma.js';
import { KnowledgeSourceType } from '@prisma/client';
import { storage } from '../../lib/storage/index.js';
import { generateEmbedding } from '../../lib/llm/index.js';
import { queryVectors, getPineconeIndex } from '../../lib/pinecone.js';
import { documentQueue } from '../../jobs/queue.js';
import { getProcessor } from './processors/index.js';
import { logger } from '../../lib/logger.js';
import type { ListSourcesInput, SearchInput } from './knowledge.schema.js';

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
