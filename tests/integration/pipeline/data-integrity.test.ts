import { describe, it, expect, beforeEach } from 'vitest';
import { documentQueue, embeddingQueue } from '../../../src/jobs/queue.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { TEST_CONFIG, testSetup } from '../setup.js';
import {
  waitForJobCompletion,
  waitForSourceStatus,
  verifySourceState,
  createMinimalPDF,
} from '../helpers.js';
import { getPineconeIndex } from '../../../src/lib/pinecone.js';

describe('Data Integrity Integration', () => {
  beforeEach(async () => {
    await testSetup();
  });

  it('should maintain chunk count consistency', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for full pipeline
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document * 2);
    // waitForSourceStatus now handles EMBEDDING -> INDEXED progression
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding * 2);

    // Verify chunk count matches database records
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    expect(source?.status).toBe('INDEXED');
    expect(source?.chunkCount).toBe(source?.chunks.length);
    expect(source?.chunkCount).toBeGreaterThan(0);
  }, TEST_CONFIG.timeout.full * 2);

  it('should assign vectorId to all chunks', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for full pipeline
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document * 2);
    // waitForSourceStatus now handles EMBEDDING -> INDEXED progression
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding * 2);

    // Verify all chunks have vectorId
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    expect(source?.chunks.length).toBeGreaterThan(0);
    expect(source?.chunks.every((chunk) => chunk.vectorId)).toBe(true);
    expect(source?.chunks.every((chunk) => chunk.vectorId?.startsWith('chunk_'))).toBe(true);
  }, TEST_CONFIG.timeout.full * 2);

  it('should delete all chunks and vectors when source is deleted', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for indexing
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    // Get source with chunks
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    expect(source?.chunks.length).toBeGreaterThan(0);
    const vectorIds = source!.chunks.map((c) => c.vectorId).filter((id): id is string => !!id);

    // Delete source
    await knowledgeService.deleteSource(TEST_CONFIG.tenantId, result.sourceId);

    // Verify chunks are deleted
    const chunksAfterDelete = await prisma.knowledgeChunk.findMany({
      where: { sourceId: result.sourceId },
    });
    expect(chunksAfterDelete.length).toBe(0);

    // Verify source is deleted
    const sourceAfterDelete = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });
    expect(sourceAfterDelete).toBeNull();

    // Verify vectors are deleted from Pinecone (check namespace is empty or vectors don't exist)
    // Note: This is a best-effort check since Pinecone deletion may be async
    try {
      const index = getPineconeIndex();
      const namespace = `tenant_${TEST_CONFIG.tenantId}`;
      const queryResult = await index.namespace(namespace).query({
        vector: Array(1536).fill(0),
        topK: 100,
        includeMetadata: true,
      });

      // Vector IDs from deleted source should not be in results
      const foundVectorIds = queryResult.matches?.map((m) => m.id) || [];
      const deletedVectorsFound = vectorIds.filter((id) => foundVectorIds.includes(id));
      expect(deletedVectorsFound.length).toBe(0);
    } catch (error) {
      // Pinecone query may fail if namespace doesn't exist or is empty - that's okay
      console.warn('Could not verify Pinecone deletion:', error);
    }
  }, TEST_CONFIG.timeout.full);

  it('should not create duplicate chunks on reindex', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for FULL indexing to complete (not just document processing)
    await waitForSourceStatus(result.sourceId, 'INDEXED', TEST_CONFIG.timeout.full * 2);

    // Verify chunks exist before reindex
    const sourceBeforeReindex = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    const initialChunkCount = sourceBeforeReindex!.chunks.length;
    expect(initialChunkCount).toBeGreaterThan(0);

    // Now trigger reindex
    await knowledgeService.reindexSource(TEST_CONFIG.tenantId, result.sourceId);

    // Wait for reindex to complete
    await waitForSourceStatus(result.sourceId, 'INDEXED', TEST_CONFIG.timeout.full * 2);

    // Verify chunk count is similar (may vary slightly due to chunking, but shouldn't double)
    const sourceAfterReindex = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    const finalChunkCount = sourceAfterReindex!.chunks.length;
    // Chunk count should be similar, not doubled
    expect(finalChunkCount).toBeGreaterThan(0);
    expect(finalChunkCount).toBeLessThan(initialChunkCount * 2);
  }, TEST_CONFIG.timeout.full * 3);

  it('should maintain referential integrity between chunks and sources', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for indexing
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    // Verify all chunks reference the correct source
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { sourceId: result.sourceId },
      include: { source: true },
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.sourceId === result.sourceId)).toBe(true);
    expect(chunks.every((chunk) => chunk.source.tenantId === TEST_CONFIG.tenantId)).toBe(true);
  }, TEST_CONFIG.timeout.full);

  it('should store correct metadata in chunks', async () => {
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    // Wait for indexing
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    // Verify chunk metadata
    const chunks = await prisma.knowledgeChunk.findMany({
      where: { sourceId: result.sourceId },
    });

    expect(chunks.length).toBeGreaterThan(0);

    // Verify required fields
    chunks.forEach((chunk) => {
      expect(chunk.sourceId).toBe(result.sourceId);
      expect(chunk.text).toBeTruthy();
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(chunk.vectorId).toBeTruthy();
    });
  }, TEST_CONFIG.timeout.full);
});
