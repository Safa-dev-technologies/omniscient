import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { documentQueue, embeddingQueue } from '../../../src/jobs/queue.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { TEST_CONFIG, testSetup } from '../setup.js';
import {
  waitForJobCompletion,
  waitForSourceStatus,
  waitForAllJobs,
  verifySourceState,
  createMinimalPDF,
  createTestCSV,
} from '../helpers.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

describe('E2E Pipeline Integration', () => {
  beforeAll(async () => {
    // Ensure test tenant exists (handled by global setup)
  });

  afterAll(async () => {
    // Cleanup handled by global teardown
  });

  beforeEach(async () => {
    await testSetup();
    // Wait for queues to be empty before starting each test
    await waitForAllJobs(documentQueue, 10000).catch(() => {});
    await waitForAllJobs(embeddingQueue, 10000).catch(() => {});
  });

  it('should process PDF end-to-end', async () => {
    // 1. Upload document
    const pdfBuffer = createMinimalPDF();
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    expect(result.status).toBe('PENDING');
    expect(result.sourceId).toBeTruthy();

    // 2. Wait for document processing
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);

    // 3. Check source status is EMBEDDING
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);

    // 4. Wait for embedding processing
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    // 5. Verify final state
    await verifySourceState(result.sourceId, 'INDEXED', {
      minChunkCount: 1,
      hasChunks: true,
      hasVectorId: true,
    });

    // 6. Test search
    // Use a lower threshold and a query that matches PDF content (e.g., "attestation" or "letter")
    // The actual PDF is an attestation letter, so search for relevant terms
    const searchResults = await knowledgeService.searchKnowledge(TEST_CONFIG.tenantId, {
      q: 'attestation letter document',
      limit: 5,
      threshold: 0.3, // Lower threshold to account for semantic similarity
    });

    expect(searchResults.length).toBeGreaterThan(0);
  }, TEST_CONFIG.timeout.full);

  it('should process DOCX end-to-end', async () => {
    // Create a minimal DOCX (or use fixture if available)
    // For now, we'll skip if no fixture exists
    const docxPath = join(process.cwd(), 'tests', 'fixtures', 'sample.docx');
    let docxBuffer: Buffer;

    try {
      docxBuffer = await readFile(docxPath);
    } catch {
      // Skip test if fixture doesn't exist
      console.warn('DOCX fixture not found, skipping test');
      return;
    }

    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer,
    });

    expect(result.status).toBe('PENDING');

    // Wait for full pipeline
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    await verifySourceState(result.sourceId, 'INDEXED', {
      minChunkCount: 1,
      hasChunks: true,
    });
  }, TEST_CONFIG.timeout.full);

  it('should process CSV/FAQ end-to-end', async () => {
    const csvBuffer = createTestCSV(true, true); // FAQ format

    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.csv',
      mimeType: 'text/csv',
      buffer: csvBuffer,
    });

    expect(result.status).toBe('PENDING');

    // Wait for full pipeline
    // Use waitForSourceStatus instead of waitForJobCompletion for better reliability
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'INDEXED', TEST_CONFIG.timeout.full);

    await verifySourceState(result.sourceId, 'INDEXED', {
      minChunkCount: 1,
      hasChunks: true,
    });

    // CSV metadata (isFAQ, columns) is stored in chunk metadata, not source metadata
    // The source type is verified through the successful processing and indexing
  }, TEST_CONFIG.timeout.full);

  it('should process TXT end-to-end', async () => {
    // Content must exceed MIN_CHUNK_SIZE (100 chars) to produce chunks
    const txtContent = 'This is a comprehensive test text file designed for integration testing.\n\nIt contains multiple paragraphs with meaningful content that exceeds the minimum chunk size requirement.\n\nThe document processing system will extract this text, chunk it into manageable pieces, generate embeddings, and store them in a vector database for semantic search capabilities.\n\nThis ensures that the full pipeline works correctly from document upload through indexing and search.';
    const txtBuffer = Buffer.from(txtContent, 'utf-8');

    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'test.txt',
      mimeType: 'text/plain',
      buffer: txtBuffer,
    });

    expect(result.status).toBe('PENDING');

    // Wait for full pipeline
    await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
    await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding);

    await verifySourceState(result.sourceId, 'INDEXED', {
      minChunkCount: 1,
      hasChunks: true,
    });
  }, TEST_CONFIG.timeout.full);

  it('should handle multiple sequential uploads', async () => {
    const results = [];

    // Upload 3 documents sequentially
    for (let i = 0; i < 3; i++) {
      const pdfBuffer = createMinimalPDF();
      const result = await knowledgeService.uploadDocument({
        tenantId: TEST_CONFIG.tenantId,
        filename: `test-${i}.pdf`,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });
      results.push(result);
    }

    // Wait for all to complete
    for (const result of results) {
      await waitForJobCompletion(documentQueue, result.sourceId, TEST_CONFIG.timeout.document * 2);
      // waitForSourceStatus now handles EMBEDDING -> INDEXED progression
      await waitForSourceStatus(result.sourceId, 'EMBEDDING', TEST_CONFIG.timeout.document);
      await waitForJobCompletion(embeddingQueue, result.sourceId, TEST_CONFIG.timeout.embedding * 2);
      await verifySourceState(result.sourceId, 'INDEXED', {
        minChunkCount: 1,
      });
    }

    // Verify all sources are indexed
    const sources = await prisma.knowledgeSource.findMany({
      where: {
        tenantId: TEST_CONFIG.tenantId,
        id: { in: results.map((r) => r.sourceId) },
      },
    });

    expect(sources.length).toBe(3);
    expect(sources.every((s) => s.status === 'INDEXED')).toBe(true);
  }, TEST_CONFIG.timeout.full * 3); // Longer timeout for multiple files
});
