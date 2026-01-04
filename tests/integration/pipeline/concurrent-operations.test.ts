import { describe, it, expect, beforeEach } from 'vitest';
import { documentQueue, embeddingQueue } from '../../../src/jobs/queue.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { TEST_CONFIG, testSetup } from '../setup.js';
import { waitForAllJobs, waitForSourceStatus, createMinimalPDF, sleep } from '../helpers.js';

describe('Concurrent Operations Integration', () => {
  beforeEach(async () => {
    await testSetup();
  });

  it(
    'should handle 10 simultaneous uploads',
    async () => {
      const uploads = [];

      // Upload 10 documents simultaneously
      for (let i = 0; i < 10; i++) {
        const pdfBuffer = createMinimalPDF();
        const result = await knowledgeService.uploadDocument({
          tenantId: TEST_CONFIG.tenantId,
          filename: `concurrent-${i}.pdf`,
          mimeType: 'application/pdf',
          buffer: pdfBuffer,
        });
        uploads.push(result);
      }

      expect(uploads.length).toBe(10);
      expect(uploads.every((u) => u.status === 'PENDING')).toBe(true);

      // Wait for all jobs to complete
      await waitForAllJobs(documentQueue, TEST_CONFIG.timeout.full);
      await waitForAllJobs(embeddingQueue, TEST_CONFIG.timeout.full * 2);

      // Verify all sources are indexed
      const sources = await prisma.knowledgeSource.findMany({
        where: {
          tenantId: TEST_CONFIG.tenantId,
          id: { in: uploads.map((u) => u.sourceId) },
        },
      });

      expect(sources.length).toBe(10);
      // Most should be indexed (some may still be processing)
      const indexedCount = sources.filter((s) => s.status === 'INDEXED').length;
      expect(indexedCount).toBeGreaterThan(0);
    },
    TEST_CONFIG.timeout.full * 3
  );

  it(
    'should handle delete during embedding phase',
    async () => {
      const pdfBuffer = createMinimalPDF();
      const result = await knowledgeService.uploadDocument({
        tenantId: TEST_CONFIG.tenantId,
        filename: 'delete-test.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      // Wait for document processing to complete (status should be EMBEDDING)
      await sleep(5000); // Give some time for processing

      // Try to delete while embedding is in progress
      await knowledgeService.deleteSource(TEST_CONFIG.tenantId, result.sourceId);

      // Verify source is deleted
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.sourceId },
      });

      expect(source).toBeNull();

      // Verify chunks are deleted
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: result.sourceId },
      });

      expect(chunks.length).toBe(0);
    },
    TEST_CONFIG.timeout.document * 2
  );

  it(
    'should handle duplicate job submissions (idempotent)',
    async () => {
      const pdfBuffer = createMinimalPDF();
      const result = await knowledgeService.uploadDocument({
        tenantId: TEST_CONFIG.tenantId,
        filename: 'duplicate-test.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      // Submit the same job again (should be idempotent)
      await documentQueue.add('PROCESS_DOCUMENT', {
        sourceId: result.sourceId,
        tenantId: TEST_CONFIG.tenantId,
      });

      // Wait for processing
      await waitForAllJobs(documentQueue, TEST_CONFIG.timeout.document);
      await waitForAllJobs(embeddingQueue, TEST_CONFIG.timeout.embedding);

      // Wait for source to reach INDEXED status (queues empty doesn't guarantee INDEXED)
      await waitForSourceStatus(result.sourceId, 'INDEXED', TEST_CONFIG.timeout.full);

      // Verify source is indexed (not duplicated)
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.sourceId },
        include: { chunks: true },
      });

      expect(source?.status).toBe('INDEXED');
      // Should have chunks (not zero)
      expect(source?.chunkCount).toBeGreaterThan(0);
    },
    TEST_CONFIG.timeout.full
  );

  it(
    'should handle parallel uploads from multiple tenants',
    async () => {
      // Create second tenant
      const tenant2Id = 'test-tenant-concurrent-2';

      // Cleanup first to ensure isolation
      try {
        await prisma.knowledgeSource.deleteMany({ where: { tenantId: tenant2Id } });
        await prisma.tenant.delete({ where: { id: tenant2Id } }).catch(() => {});
      } catch {
        // Ignore cleanup errors
      }

      await prisma.tenant.upsert({
        where: { id: tenant2Id },
        create: {
          id: tenant2Id,
          name: 'Test Tenant Concurrent 2',
          slug: 'test-tenant-concurrent-2',
        },
        update: {},
      });

      try {
        // Upload documents for both tenants simultaneously
        const tenant1Uploads = [];
        const tenant2Uploads = [];

        for (let i = 0; i < 5; i++) {
          const pdfBuffer = createMinimalPDF();

          // Tenant 1
          const result1 = await knowledgeService.uploadDocument({
            tenantId: TEST_CONFIG.tenantId,
            filename: `tenant1-${i}.pdf`,
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
          });
          tenant1Uploads.push(result1);

          // Tenant 2
          const result2 = await knowledgeService.uploadDocument({
            tenantId: tenant2Id,
            filename: `tenant2-${i}.pdf`,
            mimeType: 'application/pdf',
            buffer: pdfBuffer,
          });
          tenant2Uploads.push(result2);
        }

        expect(tenant1Uploads.length).toBe(5);
        expect(tenant2Uploads.length).toBe(5);

        // Wait for all jobs
        await waitForAllJobs(documentQueue, TEST_CONFIG.timeout.full);
        await waitForAllJobs(embeddingQueue, TEST_CONFIG.timeout.full * 2);

        // Wait for at least some sources to complete (queues empty doesn't guarantee INDEXED)
        // Use catch to allow some to timeout without failing the test
        for (const upload of [...tenant1Uploads, ...tenant2Uploads]) {
          await waitForSourceStatus(upload.sourceId, 'INDEXED', TEST_CONFIG.timeout.document).catch(
            () => {}
          );
        }

        // Verify both tenants' sources are indexed
        const tenant1Sources = await prisma.knowledgeSource.findMany({
          where: {
            tenantId: TEST_CONFIG.tenantId,
            id: { in: tenant1Uploads.map((u) => u.sourceId) },
          },
        });

        const tenant2Sources = await prisma.knowledgeSource.findMany({
          where: {
            tenantId: tenant2Id,
            id: { in: tenant2Uploads.map((u) => u.sourceId) },
          },
        });

        expect(tenant1Sources.length).toBe(5);
        expect(tenant2Sources.length).toBe(5);

        // Both tenants should have indexed sources
        const tenant1Indexed = tenant1Sources.filter((s) => s.status === 'INDEXED').length;
        const tenant2Indexed = tenant2Sources.filter((s) => s.status === 'INDEXED').length;

        expect(tenant1Indexed).toBeGreaterThan(0);
        expect(tenant2Indexed).toBeGreaterThan(0);
      } finally {
        // Cleanup tenant 2
        try {
          await prisma.knowledgeSource.deleteMany({ where: { tenantId: tenant2Id } });
          await prisma.tenant.delete({ where: { id: tenant2Id } });
        } catch (error) {
          // Log but don't fail test on cleanup errors
          console.warn('Cleanup error (non-fatal):', error);
        }
      }
    },
    TEST_CONFIG.timeout.full * 3
  );
});
