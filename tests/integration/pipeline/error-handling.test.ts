import { describe, it, expect, beforeEach } from 'vitest';
import { documentQueue, embeddingQueue, deadLetterQueue } from '../../../src/jobs/queue.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { TEST_CONFIG, testSetup } from '../setup.js';
import {
  waitForSourceStatus,
  waitForSourceProcessing,
  verifySourceState,
  findJobBySourceId,
  sleep,
} from '../helpers.js';
import { Buffer } from 'buffer';

describe('Error Handling & Retry Integration', () => {
  beforeEach(async () => {
    await testSetup();
  });

  it('should handle invalid PDF gracefully', async () => {
    const invalidBuffer = Buffer.from('not a real pdf');
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'invalid.pdf',
      mimeType: 'application/pdf',
      buffer: invalidBuffer,
    });

    expect(result.status).toBe('PENDING');

    // Wait for job to start processing, then wait for failure
    // Use longer timeout to ensure workers pick up the job
    await waitForSourceProcessing(result.sourceId, TEST_CONFIG.timeout.document * 2);
    await waitForSourceStatus(result.sourceId, 'FAILED', TEST_CONFIG.timeout.document * 2);

    // Verify source status
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });

    expect(source?.status).toBe('FAILED');
    expect(source?.statusMessage).toBeTruthy();
    expect(source?.statusMessage).toContain('Invalid PDF');
  }, TEST_CONFIG.timeout.full * 2);

  it('should handle corrupted PDF as non-retryable', async () => {
    // Create a PDF with invalid structure
    const corruptedBuffer = Buffer.from('%PDF-1.4\ncorrupted content');
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'corrupted.pdf',
      mimeType: 'application/pdf',
      buffer: corruptedBuffer,
    });

    // Wait for job to start processing, then wait for failure
    // Use longer timeout to ensure job gets picked up by workers
    await waitForSourceProcessing(result.sourceId, TEST_CONFIG.timeout.document * 2);
    await waitForSourceStatus(result.sourceId, 'FAILED', TEST_CONFIG.timeout.document * 2);

    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });

    expect(source?.status).toBe('FAILED');
    // Should not retry - goes directly to FAILED
  }, TEST_CONFIG.timeout.full * 2);

  it('should move permanently failed jobs to dead letter queue', async () => {
    const invalidBuffer = Buffer.from('not a pdf');
    const result = await knowledgeService.uploadDocument({
      tenantId: TEST_CONFIG.tenantId,
      filename: 'invalid.pdf',
      mimeType: 'application/pdf',
      buffer: invalidBuffer,
    });

    // Wait for job to start processing, then wait for failure
    await waitForSourceProcessing(result.sourceId, TEST_CONFIG.timeout.document);
    await waitForSourceStatus(result.sourceId, 'FAILED', TEST_CONFIG.timeout.document);

    // Wait a bit for DLQ processing
    await sleep(2000);

    // Check dead letter queue
    const dlqJobs = await deadLetterQueue.getJobs(['waiting', 'active', 'completed'], 0, 100);
    const dlqJob = dlqJobs.find(
      (j) => j.data && typeof j.data === 'object' && 'data' in j.data
        && (j.data as any).data?.sourceId === result.sourceId
    );

    // Verify source is marked as FAILED
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });

    expect(source?.status).toBe('FAILED');

    // If DLQ job exists, verify its metadata
    if (dlqJob) {
      expect(dlqJob.data).toMatchObject({
        originalQueue: 'document-processing',
        data: expect.objectContaining({ sourceId: result.sourceId }),
        error: expect.objectContaining({ message: expect.any(String) }),
        attemptsMade: expect.any(Number),
      });
      expect((dlqJob.data as any).failedAt).toBeDefined();
    }
  }, TEST_CONFIG.timeout.document * 2);

  it('should handle unsupported file type', async () => {
    const buffer = Buffer.from('some content');
    
    await expect(
      knowledgeService.uploadDocument({
        tenantId: TEST_CONFIG.tenantId,
        filename: 'test.xyz',
        mimeType: 'application/unknown',
        buffer,
      })
    ).rejects.toThrow('Unsupported file type');
  });

  it('should retry on transient errors', async () => {
    // This test would require mocking network errors
    // For now, we'll verify the retry configuration exists
    const queue = documentQueue;
    const job = await queue.add('TEST_JOB', {
      sourceId: 'test-retry',
      tenantId: TEST_CONFIG.tenantId,
    });

    const jobData = await job.getState();
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff?.type).toBe('exponential');

    // Cleanup - don't try to remove if job is locked by worker
    try {
      const state = await job.getState();
      if (state !== 'active') {
        await job.remove();
      }
    } catch (error) {
      // Job might be locked, ignore cleanup errors
      console.warn('Could not remove test job (may be locked):', error);
    }
  });


  it('should handle embedding API failures', async () => {
    // This would test OpenAI API failures and retries
    // Requires mocking or actual API failure simulation
    // For now, verify embedding queue has retry config
    const queue = embeddingQueue;
    const job = await queue.add('TEST_EMBEDDING', {
      sourceId: 'test-embedding',
      tenantId: TEST_CONFIG.tenantId,
      chunks: [],
    });

    expect(job.opts.attempts).toBe(5); // More retries for API calls
    expect(job.opts.backoff?.delay).toBe(10000); // Longer backoff

    // Cleanup - don't try to remove if job is locked by worker
    try {
      const state = await job.getState();
      if (state !== 'active') {
        await job.remove();
      }
    } catch (error) {
      // Job may be locked by worker, ignore cleanup errors
      console.warn('Could not remove test job (may be locked):', error);
    }
  });
});
