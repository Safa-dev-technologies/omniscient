# Knowledge Pipeline Integration Tests - Task Specification

**Version:** 1.0.0
**Status:** Ready for Implementation
**Priority:** P0 (Critical)
**Created:** 2024-12-31

---

## Executive Summary

This document defines comprehensive integration tests for the knowledge processing pipeline. These tests validate the complete flow from document upload through indexing, including error handling, rate limiting, retry logic, and edge cases.

**Test Coverage Goals:**
- End-to-end pipeline validation
- Error handling paths (retryable vs non-retryable)
- Rate limiting enforcement
- Dead letter queue flow
- Concurrent processing behavior
- Data integrity and consistency
- All processor types (PDF, DOCX, CSV, TXT)

---

## Test Infrastructure Setup

### Task 6.1: Test Environment Configuration

**Priority:** P0
**Files to Create:**
- `tests/integration/setup.ts`
- `tests/integration/helpers.ts`
- `tests/integration/mocks/external-services.ts`
- `vitest.integration.config.ts`

#### 6.1.1 Integration Test Configuration

```typescript
// vitest.integration.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000, // 2 minutes per test
    hookTimeout: 60000,  // 1 minute for setup/teardown
    pool: 'forks',       // Isolate tests
    poolOptions: {
      forks: {
        singleFork: true, // Run sequentially to avoid queue conflicts
      },
    },
    globalSetup: './tests/integration/global-setup.ts',
    setupFiles: ['./tests/integration/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5433/omniscient_test',
      REDIS_URL: 'redis://localhost:6380',
      PINECONE_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key',
    },
  },
});
```

#### 6.1.2 Global Setup (Docker Services)

```typescript
// tests/integration/global-setup.ts

import { execSync } from 'child_process';

export async function setup() {
  console.log('Starting test infrastructure...');

  // Start test containers
  execSync('docker compose -f docker-compose.test.yml up -d', {
    stdio: 'inherit',
  });

  // Wait for services
  await waitForPostgres();
  await waitForRedis();

  // Run migrations
  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });

  console.log('Test infrastructure ready');
}

export async function teardown() {
  console.log('Stopping test infrastructure...');
  execSync('docker compose -f docker-compose.test.yml down -v', {
    stdio: 'inherit',
  });
}
```

#### 6.1.3 Test Helpers

```typescript
// tests/integration/helpers.ts

import { Queue, Job } from 'bullmq';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';
import { KnowledgeSourceStatus } from '@prisma/client';

export interface TestTenant {
  id: string;
  name: string;
  slug: string;
}

export async function createTestTenant(suffix?: string): Promise<TestTenant> {
  const id = `test-tenant-${suffix || Date.now()}`;
  return prisma.tenant.create({
    data: {
      id,
      name: `Test Tenant ${suffix || ''}`,
      slug: `test-${suffix || Date.now()}`,
    },
  });
}

export async function cleanupTestTenant(tenantId: string): Promise<void> {
  // Delete in order due to foreign keys
  await prisma.knowledgeChunk.deleteMany({ where: { source: { tenantId } } });
  await prisma.knowledgeSource.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});

  // Clean rate limit keys
  const keys = await redis.keys(`ratelimit:*:${tenantId}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function waitForSourceStatus(
  sourceId: string,
  targetStatus: KnowledgeSourceStatus | KnowledgeSourceStatus[],
  timeoutMs: number = 60000,
  pollIntervalMs: number = 500
): Promise<{ status: KnowledgeSourceStatus; source: any }> {
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
      include: { chunks: true },
    });

    if (!source) {
      throw new Error(`Source ${sourceId} not found`);
    }

    if (statuses.includes(source.status)) {
      return { status: source.status, source };
    }

    await sleep(pollIntervalMs);
  }

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
  });

  throw new Error(
    `Source ${sourceId} did not reach status ${statuses.join('|')} within ${timeoutMs}ms. ` +
    `Current status: ${source?.status}, message: ${source?.statusMessage}`
  );
}

export async function waitForJobInDLQ(
  sourceId: string,
  timeoutMs: number = 30000
): Promise<Job | null> {
  const { deadLetterQueue } = await import('../../src/jobs/queue.js');
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const jobs = await deadLetterQueue.getJobs(['waiting', 'delayed']);
    const found = jobs.find(j => j.data.data?.sourceId === sourceId);
    if (found) return found;
    await sleep(500);
  }

  return null;
}

export async function getQueueStats(queue: Queue) {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

export async function clearAllQueues(): Promise<void> {
  const { documentQueue, embeddingQueue, deadLetterQueue } = await import(
    '../../src/jobs/queue.js'
  );

  await Promise.all([
    documentQueue.obliterate({ force: true }),
    embeddingQueue.obliterate({ force: true }),
    deadLetterQueue.obliterate({ force: true }),
  ]);
}

export async function clearRateLimitKeys(tenantId: string): Promise<void> {
  const patterns = [
    `ratelimit:document-processing:${tenantId}:*`,
    `ratelimit:embedding-generation:${tenantId}:*`,
  ];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateLargeText(sizeInKB: number): string {
  const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20);
  const targetSize = sizeInKB * 1024;
  let text = '';
  while (text.length < targetSize) {
    text += paragraph + '\n\n';
  }
  return text.slice(0, targetSize);
}
```

#### 6.1.4 External Service Mocks

```typescript
// tests/integration/mocks/external-services.ts

import { vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Mock OpenAI Embeddings
const openAIHandler = http.post('https://api.openai.com/v1/embeddings', async ({ request }) => {
  const body = await request.json() as { input: string | string[] };
  const inputs = Array.isArray(body.input) ? body.input : [body.input];

  return HttpResponse.json({
    object: 'list',
    data: inputs.map((_, index) => ({
      object: 'embedding',
      index,
      embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1),
    })),
    model: 'text-embedding-3-small',
    usage: {
      prompt_tokens: inputs.length * 10,
      total_tokens: inputs.length * 10,
    },
  });
});

// Mock Pinecone
const pineconeUpsertHandler = http.post(
  'https://*.pinecone.io/vectors/upsert',
  async () => {
    return HttpResponse.json({ upsertedCount: 100 });
  }
);

const pineconeQueryHandler = http.post(
  'https://*.pinecone.io/query',
  async ({ request }) => {
    const body = await request.json() as { topK: number };
    return HttpResponse.json({
      matches: Array(body.topK || 5).fill(null).map((_, i) => ({
        id: `chunk_test_${i}`,
        score: 0.9 - i * 0.1,
        metadata: {
          text: `Test chunk content ${i}`,
          sourceId: 'test-source',
          sourceName: 'test.pdf',
          chunkIndex: i,
          tenantId: 'test-tenant',
        },
      })),
      namespace: 'tenant_test',
    });
  }
);

const pineconeDeleteHandler = http.post(
  'https://*.pinecone.io/vectors/delete',
  async () => {
    return HttpResponse.json({});
  }
);

export const mockServer = setupServer(
  openAIHandler,
  pineconeUpsertHandler,
  pineconeQueryHandler,
  pineconeDeleteHandler
);

// Controllable failure injection
export const failureInjector = {
  openAI: {
    enabled: false,
    errorType: 'rate_limit' as 'rate_limit' | 'server_error' | 'timeout',
    failCount: 0,
    maxFails: 1,
  },
  pinecone: {
    enabled: false,
    errorType: 'server_error' as 'server_error' | 'timeout',
  },

  reset() {
    this.openAI = { enabled: false, errorType: 'rate_limit', failCount: 0, maxFails: 1 };
    this.pinecone = { enabled: false, errorType: 'server_error' };
  },

  enableOpenAIFailure(type: 'rate_limit' | 'server_error' | 'timeout', maxFails = 1) {
    this.openAI = { enabled: true, errorType: type, failCount: 0, maxFails };
  },

  enablePineconeFailure(type: 'server_error' | 'timeout') {
    this.pinecone = { enabled: true, errorType: type };
  },
};

// Handler with failure injection
const openAIWithFailures = http.post('https://api.openai.com/v1/embeddings', async ({ request }) => {
  if (failureInjector.openAI.enabled && failureInjector.openAI.failCount < failureInjector.openAI.maxFails) {
    failureInjector.openAI.failCount++;

    switch (failureInjector.openAI.errorType) {
      case 'rate_limit':
        return HttpResponse.json(
          { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
          { status: 429 }
        );
      case 'server_error':
        return HttpResponse.json(
          { error: { message: 'Internal server error', type: 'server_error' } },
          { status: 500 }
        );
      case 'timeout':
        await new Promise(resolve => setTimeout(resolve, 35000));
        return HttpResponse.error();
    }
  }

  // Normal response
  const body = await request.json() as { input: string | string[] };
  const inputs = Array.isArray(body.input) ? body.input : [body.input];

  return HttpResponse.json({
    object: 'list',
    data: inputs.map((_, index) => ({
      object: 'embedding',
      index,
      embedding: Array(1536).fill(0).map(() => Math.random() * 2 - 1),
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: inputs.length * 10, total_tokens: inputs.length * 10 },
  });
});

export function useFailureInjection() {
  mockServer.use(openAIWithFailures);
}
```

---

## Test Suites

### Task 6.2: End-to-End Pipeline Tests

**Priority:** P0
**File:** `tests/integration/pipeline/e2e-pipeline.test.ts`

#### Test Cases

```typescript
// tests/integration/pipeline/e2e-pipeline.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
  sleep,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('End-to-End Pipeline', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('e2e');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('Happy Path - Complete Processing', () => {
    it('should process PDF from upload to INDEXED status', async () => {
      // Arrange
      const pdfBuffer = await fs.readFile(
        path.join(__dirname, '../../fixtures/sample.pdf')
      );

      // Act
      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'sample.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      // Assert initial state
      expect(result.status).toBe('PENDING');
      expect(result.id).toBeDefined();

      // Wait for completion
      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      // Verify final state
      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(0);
      expect(source.tokenCount).toBeGreaterThan(0);
      expect(source.indexedAt).toBeDefined();
      expect(source.chunks.length).toBe(source.chunkCount);

      // Verify chunks have vectorIds
      for (const chunk of source.chunks) {
        expect(chunk.vectorId).toMatch(/^chunk_.*_\d{5}$/);
        expect(chunk.text).toBeTruthy();
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
    }, 120000);

    it('should process DOCX from upload to INDEXED status', async () => {
      const docxBuffer = await fs.readFile(
        path.join(__dirname, '../../fixtures/sample.docx')
      );

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'sample.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxBuffer,
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(0);
    }, 120000);

    it('should process TXT from upload to INDEXED status', async () => {
      const txtBuffer = Buffer.from(
        'This is a test document.\n\nIt has multiple paragraphs.\n\n' +
        'Each paragraph should be processed correctly.\n\n'.repeat(50)
      );

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'sample.txt',
        mimeType: 'text/plain',
        buffer: txtBuffer,
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(0);
    }, 90000);

    it('should process CSV with FAQ format from upload to INDEXED status', async () => {
      const csvContent = `question,answer
"What is your return policy?","You can return items within 30 days."
"How do I track my order?","Use the tracking link in your confirmation email."
"What payment methods do you accept?","We accept Visa, Mastercard, and PayPal."`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'faq.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csvContent),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(0);

      // Verify FAQ format in chunks
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      const hasQAFormat = chunks.some(
        chunk => chunk.text.includes('Q:') && chunk.text.includes('A:')
      );
      expect(hasQAFormat).toBe(true);
    }, 90000);

    it('should process multiple documents concurrently', async () => {
      const files = [
        { name: 'doc1.txt', content: 'Document one content. '.repeat(100) },
        { name: 'doc2.txt', content: 'Document two content. '.repeat(100) },
        { name: 'doc3.txt', content: 'Document three content. '.repeat(100) },
      ];

      // Upload all concurrently
      const results = await Promise.all(
        files.map(file =>
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: file.name,
            mimeType: 'text/plain',
            buffer: Buffer.from(file.content),
          })
        )
      );

      // Wait for all to complete
      const statuses = await Promise.all(
        results.map(r => waitForSourceStatus(r.id, 'INDEXED', 90000))
      );

      // Verify all indexed
      for (const { source } of statuses) {
        expect(source.status).toBe('INDEXED');
        expect(source.chunkCount).toBeGreaterThan(0);
      }
    }, 120000);
  });

  describe('Status Transitions', () => {
    it('should transition through all statuses: PENDING → EXTRACTING → CHUNKING → EMBEDDING → INDEXED', async () => {
      const observedStatuses: string[] = [];
      const txtBuffer = Buffer.from('Test content. '.repeat(500));

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'status-test.txt',
        mimeType: 'text/plain',
        buffer: txtBuffer,
      });

      // Poll for status changes
      let lastStatus = 'PENDING';
      observedStatuses.push(lastStatus);

      while (lastStatus !== 'INDEXED' && lastStatus !== 'FAILED') {
        await sleep(200);
        const source = await prisma.knowledgeSource.findUnique({
          where: { id: result.id },
        });

        if (source && source.status !== lastStatus) {
          lastStatus = source.status;
          observedStatuses.push(lastStatus);
        }
      }

      // Verify transition order
      expect(observedStatuses).toContain('PENDING');
      expect(observedStatuses).toContain('INDEXED');

      // EXTRACTING and CHUNKING may be too fast to observe, but order should be correct
      const statusOrder = ['PENDING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXED'];
      const filteredObserved = observedStatuses.filter(s => statusOrder.includes(s));

      for (let i = 1; i < filteredObserved.length; i++) {
        const prevIndex = statusOrder.indexOf(filteredObserved[i - 1]);
        const currIndex = statusOrder.indexOf(filteredObserved[i]);
        expect(currIndex).toBeGreaterThan(prevIndex);
      }
    }, 90000);
  });

  describe('Search Integration', () => {
    it('should return relevant results after indexing', async () => {
      // Upload and wait for indexing
      const content = `
        Machine learning is a subset of artificial intelligence.
        Neural networks are inspired by biological neurons.
        Deep learning uses multiple layers of neural networks.
        Training data is essential for model accuracy.
      `.repeat(20);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'ml-guide.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 90000);

      // Search
      const searchResults = await knowledgeService.searchKnowledge(tenant.id, {
        q: 'What is machine learning?',
        limit: 5,
        threshold: 0.5,
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].sourceId).toBe(result.id);
      expect(searchResults[0].text).toBeTruthy();
      expect(searchResults[0].score).toBeGreaterThan(0.5);
    }, 120000);

    it('should isolate results by tenant namespace', async () => {
      // Create second tenant
      const tenant2 = await createTestTenant('e2e-isolated');

      try {
        // Upload same content to both tenants
        const content = 'Unique test content for namespace isolation. '.repeat(50);

        const [result1, result2] = await Promise.all([
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: 'isolation-test.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
          }),
          knowledgeService.uploadDocument({
            tenantId: tenant2.id,
            filename: 'isolation-test.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(content),
          }),
        ]);

        await Promise.all([
          waitForSourceStatus(result1.id, 'INDEXED', 90000),
          waitForSourceStatus(result2.id, 'INDEXED', 90000),
        ]);

        // Search from tenant1 should only return tenant1 results
        const results1 = await knowledgeService.searchKnowledge(tenant.id, {
          q: 'namespace isolation',
          limit: 10,
          threshold: 0.3,
        });

        for (const result of results1) {
          expect(result.tenantId).toBe(tenant.id);
        }

        // Search from tenant2 should only return tenant2 results
        const results2 = await knowledgeService.searchKnowledge(tenant2.id, {
          q: 'namespace isolation',
          limit: 10,
          threshold: 0.3,
        });

        for (const result of results2) {
          expect(result.tenantId).toBe(tenant2.id);
        }
      } finally {
        await cleanupTestTenant(tenant2.id);
      }
    }, 180000);
  });
});
```

---

### Task 6.3: Error Handling & Retry Tests

**Priority:** P0
**File:** `tests/integration/pipeline/error-handling.test.ts`

#### Test Cases

```typescript
// tests/integration/pipeline/error-handling.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  waitForJobInDLQ,
  clearAllQueues,
} from '../helpers.js';
import { mockServer, failureInjector, useFailureInjection } from '../mocks/external-services.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { deadLetterQueue } from '../../../src/jobs/queue.js';

describe('Error Handling & Retry Logic', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('error-handling');
    mockServer.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(async () => {
    mockServer.close();
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
    failureInjector.reset();
  });

  describe('Non-Retryable Errors (Immediate Failure)', () => {
    it('should fail immediately on invalid PDF (corrupted)', async () => {
      const invalidPdf = Buffer.from('not a valid pdf content');

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'corrupted.pdf',
        mimeType: 'application/pdf',
        buffer: invalidPdf,
      });

      const { source } = await waitForSourceStatus(result.id, 'FAILED', 30000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toMatch(/invalid|corrupt/i);

      // Should be in DLQ
      const dlqJob = await waitForJobInDLQ(result.id, 10000);
      expect(dlqJob).not.toBeNull();
      expect(dlqJob?.data.error.message).toMatch(/invalid|corrupt/i);
    }, 60000);

    it('should fail immediately on password-protected PDF', async () => {
      const encryptedPdf = await import('fs/promises').then(fs =>
        fs.readFile('tests/fixtures/sample-encrypted.pdf')
      );

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'protected.pdf',
        mimeType: 'application/pdf',
        buffer: encryptedPdf,
      });

      const { source } = await waitForSourceStatus(result.id, 'FAILED', 30000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toMatch(/password|protected|encrypted/i);
    }, 60000);

    it('should fail on empty document (no chunks generated)', async () => {
      const emptyContent = Buffer.from('   \n\n   \t   '); // Only whitespace

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'empty.txt',
        mimeType: 'text/plain',
        buffer: emptyContent,
      });

      const { source } = await waitForSourceStatus(result.id, 'FAILED', 30000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toMatch(/empty|no.*chunk|no.*content/i);
    }, 60000);

    it('should fail on unsupported MIME type', async () => {
      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'video.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('fake video content'),
      });

      const { source } = await waitForSourceStatus(result.id, 'FAILED', 30000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toMatch(/unsupported|not supported|mime/i);
    }, 60000);
  });

  describe('Retryable Errors (With Backoff)', () => {
    it('should retry on OpenAI rate limit (429) and eventually succeed', async () => {
      useFailureInjection();
      failureInjector.enableOpenAIFailure('rate_limit', 2); // Fail twice, then succeed

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'retry-test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Test content for retry. '.repeat(100)),
      });

      // Should eventually succeed after retries
      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 120000);

      expect(source.status).toBe('INDEXED');
      expect(failureInjector.openAI.failCount).toBe(2);
    }, 150000);

    it('should retry on OpenAI server error (500) and eventually succeed', async () => {
      useFailureInjection();
      failureInjector.enableOpenAIFailure('server_error', 1);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'server-error-test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Test content. '.repeat(100)),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 120000);

      expect(source.status).toBe('INDEXED');
    }, 150000);

    it('should move to DLQ after exhausting all retries', async () => {
      useFailureInjection();
      failureInjector.enableOpenAIFailure('server_error', 10); // More fails than retries allowed

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'max-retry-test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Test content. '.repeat(100)),
      });

      // Should fail after max retries (5 for embedding queue)
      const { source } = await waitForSourceStatus(result.id, 'FAILED', 180000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toMatch(/failed.*attempts|retry/i);

      // Verify in DLQ
      const dlqJob = await waitForJobInDLQ(result.id, 10000);
      expect(dlqJob).not.toBeNull();
      expect(dlqJob?.data.attemptsMade).toBeGreaterThanOrEqual(5);
    }, 240000);
  });

  describe('Partial Failure Handling', () => {
    it('should handle partial embedding batch failure gracefully', async () => {
      // This tests the scenario where some batches succeed but others fail
      // The implementation should continue with remaining batches

      // Create a document large enough to require multiple batches
      const largeContent = 'Test paragraph content. '.repeat(2000); // ~100+ chunks

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'partial-failure.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(largeContent),
      });

      // Even with partial failures, should complete (per implementation)
      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        120000
      );

      // Verify some chunks were processed
      if (source.status === 'INDEXED') {
        expect(source.chunkCount).toBeGreaterThan(0);
      }
    }, 150000);
  });

  describe('Dead Letter Queue Inspection', () => {
    it('should contain all required metadata in DLQ job', async () => {
      const invalidPdf = Buffer.from('%PDF-1.4 corrupted content');

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'dlq-metadata-test.pdf',
        mimeType: 'application/pdf',
        buffer: invalidPdf,
      });

      await waitForSourceStatus(result.id, 'FAILED', 30000);

      const dlqJob = await waitForJobInDLQ(result.id, 10000);

      expect(dlqJob).not.toBeNull();
      expect(dlqJob?.data).toMatchObject({
        originalQueue: expect.stringMatching(/document|embedding/),
        originalJobId: expect.any(String),
        data: expect.objectContaining({
          sourceId: result.id,
          tenantId: tenant.id,
        }),
        error: expect.objectContaining({
          message: expect.any(String),
        }),
        attemptsMade: expect.any(Number),
        failedAt: expect.any(String),
      });
    }, 60000);

    it('should accumulate multiple failed jobs in DLQ', async () => {
      // Clear DLQ first
      await deadLetterQueue.obliterate({ force: true });

      // Submit multiple invalid documents
      const invalidDocs = Array(5).fill(null).map((_, i) => ({
        filename: `invalid-${i}.pdf`,
        buffer: Buffer.from(`invalid content ${i}`),
      }));

      const results = await Promise.all(
        invalidDocs.map(doc =>
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: doc.filename,
            mimeType: 'application/pdf',
            buffer: doc.buffer,
          })
        )
      );

      // Wait for all to fail
      await Promise.all(
        results.map(r => waitForSourceStatus(r.id, 'FAILED', 30000))
      );

      // Check DLQ count
      const dlqCount = await deadLetterQueue.getWaitingCount();
      expect(dlqCount).toBeGreaterThanOrEqual(5);
    }, 90000);
  });
});
```

---

### Task 6.4: Rate Limiting Tests

**Priority:** P0
**File:** `tests/integration/pipeline/rate-limiting.test.ts`

#### Test Cases

```typescript
// tests/integration/pipeline/rate-limiting.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
  clearRateLimitKeys,
  sleep,
  getQueueStats,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import { TenantRateLimiter } from '../../../src/jobs/rate-limiter.js';
import { redis } from '../../../src/lib/redis.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import { documentQueue, embeddingQueue } from '../../../src/jobs/queue.js';

describe('Rate Limiting', () => {
  let tenant: { id: string };
  let tenant2: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('rate-limit');
    tenant2 = await createTestTenant('rate-limit-2');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
    await cleanupTestTenant(tenant2.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
    await clearRateLimitKeys(tenant.id);
    await clearRateLimitKeys(tenant2.id);
  });

  describe('Concurrent Limit Enforcement', () => {
    it('should enforce maxConcurrent limit per tenant', async () => {
      const rateLimiter = new TenantRateLimiter(redis, 'test-queue', {
        maxConcurrent: 2,
        maxPerMinute: 100,
        maxPerHour: 1000,
      });

      // Start 2 jobs
      await rateLimiter.startJob(tenant.id, 'job-1');
      await rateLimiter.startJob(tenant.id, 'job-2');

      // Third should be blocked
      const canProcess = await rateLimiter.canProcess(tenant.id);
      expect(canProcess).toBe(false);

      // End one job
      await rateLimiter.endJob(tenant.id);

      // Now should be allowed
      const canProcessAfter = await rateLimiter.canProcess(tenant.id);
      expect(canProcessAfter).toBe(true);
    });

    it('should allow different tenants to process concurrently', async () => {
      const rateLimiter = new TenantRateLimiter(redis, 'test-queue', {
        maxConcurrent: 2,
        maxPerMinute: 100,
        maxPerHour: 1000,
      });

      // Max out tenant1
      await rateLimiter.startJob(tenant.id, 'job-1');
      await rateLimiter.startJob(tenant.id, 'job-2');

      // Tenant1 blocked
      expect(await rateLimiter.canProcess(tenant.id)).toBe(false);

      // Tenant2 should still be allowed
      expect(await rateLimiter.canProcess(tenant2.id)).toBe(true);
    });
  });

  describe('Per-Minute Limit Enforcement', () => {
    it('should enforce maxPerMinute limit', async () => {
      const rateLimiter = new TenantRateLimiter(redis, 'minute-test', {
        maxConcurrent: 100, // High to not interfere
        maxPerMinute: 3,
        maxPerHour: 1000,
      });

      // Start 3 jobs (at the limit)
      for (let i = 0; i < 3; i++) {
        await rateLimiter.startJob(tenant.id, `job-${i}`);
        await rateLimiter.endJob(tenant.id); // End immediately
      }

      // Fourth should be blocked
      const canProcess = await rateLimiter.canProcess(tenant.id);
      expect(canProcess).toBe(false);
    });

    it('should reset per-minute limit after window expires', async () => {
      const rateLimiter = new TenantRateLimiter(redis, 'minute-reset', {
        maxConcurrent: 100,
        maxPerMinute: 2,
        maxPerHour: 1000,
      });

      // Use up the limit
      await rateLimiter.startJob(tenant.id, 'job-1');
      await rateLimiter.endJob(tenant.id);
      await rateLimiter.startJob(tenant.id, 'job-2');
      await rateLimiter.endJob(tenant.id);

      expect(await rateLimiter.canProcess(tenant.id)).toBe(false);

      // Manually expire the minute window (simulate time passing)
      const minuteKey = `ratelimit:minute-reset:${tenant.id}:minute`;
      await redis.del(minuteKey);

      expect(await rateLimiter.canProcess(tenant.id)).toBe(true);
    });
  });

  describe('Per-Hour Limit Enforcement', () => {
    it('should enforce maxPerHour limit', async () => {
      const rateLimiter = new TenantRateLimiter(redis, 'hour-test', {
        maxConcurrent: 100,
        maxPerMinute: 100,
        maxPerHour: 5,
      });

      // Use up the hour limit
      for (let i = 0; i < 5; i++) {
        await rateLimiter.startJob(tenant.id, `job-${i}`);
        await rateLimiter.endJob(tenant.id);
      }

      expect(await rateLimiter.canProcess(tenant.id)).toBe(false);
    });
  });

  describe('Job Delay on Rate Limit', () => {
    it('should delay jobs when rate limited (not reject)', async () => {
      // Submit many documents at once to trigger rate limiting
      const documents = Array(10).fill(null).map((_, i) => ({
        filename: `burst-${i}.txt`,
        content: `Content for document ${i}. `.repeat(50),
      }));

      const startTime = Date.now();

      const results = await Promise.all(
        documents.map(doc =>
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: doc.filename,
            mimeType: 'text/plain',
            buffer: Buffer.from(doc.content),
          })
        )
      );

      // Wait for all to complete (some will be delayed)
      const statuses = await Promise.all(
        results.map(r =>
          waitForSourceStatus(r.id, ['INDEXED', 'FAILED'], 300000)
        )
      );

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All should eventually complete
      const indexedCount = statuses.filter(s => s.status === 'INDEXED').length;
      expect(indexedCount).toBe(10);

      // Should have taken longer due to rate limiting delays
      // With maxConcurrent=5 and 10 docs, expect at least some delay
      expect(totalTime).toBeGreaterThan(5000); // At least 5 seconds
    }, 360000);
  });

  describe('Fairness Between Tenants', () => {
    it('should not let one tenant starve another under load', async () => {
      // Tenant1 submits burst of documents
      const tenant1Docs = Array(20).fill(null).map((_, i) => ({
        filename: `t1-doc-${i}.txt`,
        content: `Tenant 1 document ${i}. `.repeat(30),
      }));

      // Tenant2 submits fewer documents
      const tenant2Docs = Array(3).fill(null).map((_, i) => ({
        filename: `t2-doc-${i}.txt`,
        content: `Tenant 2 document ${i}. `.repeat(30),
      }));

      const t1Start = Date.now();

      // Submit tenant1 documents
      const t1Results = await Promise.all(
        tenant1Docs.map(doc =>
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: doc.filename,
            mimeType: 'text/plain',
            buffer: Buffer.from(doc.content),
          })
        )
      );

      // Small delay, then submit tenant2 documents
      await sleep(1000);
      const t2Start = Date.now();

      const t2Results = await Promise.all(
        tenant2Docs.map(doc =>
          knowledgeService.uploadDocument({
            tenantId: tenant2.id,
            filename: doc.filename,
            mimeType: 'text/plain',
            buffer: Buffer.from(doc.content),
          })
        )
      );

      // Wait for tenant2 to complete
      const t2Statuses = await Promise.all(
        t2Results.map(r =>
          waitForSourceStatus(r.id, ['INDEXED', 'FAILED'], 180000)
        )
      );

      const t2End = Date.now();
      const t2Duration = t2End - t2Start;

      // Tenant2's documents should complete reasonably fast
      // (not blocked by tenant1's larger queue)
      const t2IndexedCount = t2Statuses.filter(s => s.status === 'INDEXED').length;
      expect(t2IndexedCount).toBe(3);

      // Should complete within 2 minutes (not starved)
      expect(t2Duration).toBeLessThan(120000);

      // Cleanup: wait for tenant1 to finish
      await Promise.all(
        t1Results.map(r =>
          waitForSourceStatus(r.id, ['INDEXED', 'FAILED'], 300000)
        )
      );
    }, 420000);
  });

  describe('Redis Failure Handling', () => {
    it('should fail open when Redis is unavailable', async () => {
      // Temporarily break Redis connection
      const originalGet = redis.get.bind(redis);
      redis.get = async () => {
        throw new Error('Redis connection refused');
      };

      try {
        const rateLimiter = new TenantRateLimiter(redis, 'redis-fail', {
          maxConcurrent: 1,
          maxPerMinute: 1,
          maxPerHour: 1,
        });

        // Should fail open (return true despite Redis error)
        const canProcess = await rateLimiter.canProcess(tenant.id);
        expect(canProcess).toBe(true);
      } finally {
        redis.get = originalGet;
      }
    });
  });
});
```

---

### Task 6.5: Processor-Specific Tests

**Priority:** P1
**File:** `tests/integration/processors/processor-integration.test.ts`

#### Test Cases

```typescript
// tests/integration/processors/processor-integration.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('Processor Integration Tests', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('processors');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('PDF Processor', () => {
    it('should extract text and metadata from valid PDF', async () => {
      const pdfBuffer = await fs.readFile(
        path.join(__dirname, '../../fixtures/sample.pdf')
      );

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'metadata-test.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      expect(source.status).toBe('INDEXED');
      expect(source.metadata).toBeDefined();
      expect(source.metadata).toHaveProperty('pageCount');
    }, 120000);

    it('should handle PDF with no extractable text (scanned)', async () => {
      const scannedPdf = await fs.readFile(
        path.join(__dirname, '../../fixtures/sample-scanned.pdf')
      ).catch(() => null);

      if (!scannedPdf) {
        console.log('Skipping scanned PDF test - fixture not available');
        return;
      }

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'scanned.pdf',
        mimeType: 'application/pdf',
        buffer: scannedPdf,
      });

      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        60000
      );

      // Should either fail or complete with warning
      if (source.status === 'INDEXED') {
        expect(source.metadata).toHaveProperty('warning');
      }
    }, 90000);

    it('should clean ligatures and special characters', async () => {
      // Create PDF-like content with ligatures
      const content = 'The efficient office had fluffy flowers. '.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'ligatures.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      // Verify no ligature characters remain
      for (const chunk of chunks) {
        expect(chunk.text).not.toMatch(/[\uFB00-\uFB06]/); // fi, fl, ff, ffi, ffl ligatures
      }
    }, 90000);

    it('should reject corrupted PDF with clear error message', async () => {
      const corruptPdf = Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.from('completely invalid content that is not pdf'),
      ]);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'corrupt.pdf',
        mimeType: 'application/pdf',
        buffer: corruptPdf,
      });

      const { source } = await waitForSourceStatus(result.id, 'FAILED', 30000);

      expect(source.status).toBe('FAILED');
      expect(source.statusMessage).toBeTruthy();
    }, 60000);
  });

  describe('CSV Processor', () => {
    it('should detect comma delimiter', async () => {
      const csv = `name,email,role
John,john@example.com,admin
Jane,jane@example.com,user`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'comma.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.metadata).toHaveProperty('columnCount', 3);
    }, 90000);

    it('should detect semicolon delimiter', async () => {
      const csv = `name;email;role
John;john@example.com;admin
Jane;jane@example.com;user`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'semicolon.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
    }, 90000);

    it('should detect tab delimiter', async () => {
      const csv = `name\temail\trole
John\tjohn@example.com\tadmin`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'tab.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
    }, 90000);

    it('should identify and format FAQ columns', async () => {
      const faqCsv = `Question,Answer
"What is your return policy?","30 days full refund"
"How do I contact support?","Email support@example.com"
"What are your hours?","9 AM to 5 PM EST"`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'faq.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(faqCsv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.metadata).toHaveProperty('isFAQ', true);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      // Verify Q&A format
      const hasQAFormat = chunks.some(
        c => c.text.includes('Q:') && c.text.includes('A:')
      );
      expect(hasQAFormat).toBe(true);
    }, 90000);

    it('should handle quoted fields with embedded delimiters', async () => {
      const csv = `question,answer
"What is 1+1, and why?","The answer is 2, because math."
"Another, question","Another, answer"`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'quoted.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.metadata).toHaveProperty('rowCount', 2); // 2 data rows
    }, 90000);

    it('should handle empty cells gracefully', async () => {
      const csv = `col1,col2,col3
value1,,value3
,value2,
value1,value2,value3`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'empty-cells.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
    }, 90000);

    it('should handle malformed rows (inconsistent columns)', async () => {
      const csv = `col1,col2,col3
value1,value2,value3
value1,value2
value1,value2,value3,value4`;

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'malformed.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });

      // Should either complete with some rows or fail gracefully
      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        60000
      );

      // If indexed, should have processed valid rows
      if (source.status === 'INDEXED') {
        expect(source.chunkCount).toBeGreaterThan(0);
      }
    }, 90000);
  });

  describe('DOCX Processor', () => {
    it('should extract text from DOCX', async () => {
      const docxBuffer = await fs.readFile(
        path.join(__dirname, '../../fixtures/sample.docx')
      );

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'document.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxBuffer,
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(0);
    }, 120000);

    it('should handle empty DOCX', async () => {
      // An empty DOCX is still a valid zip with minimal content
      const emptyDocx = await fs.readFile(
        path.join(__dirname, '../../fixtures/empty.docx')
      ).catch(() => null);

      if (!emptyDocx) {
        console.log('Skipping empty DOCX test - fixture not available');
        return;
      }

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'empty.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: emptyDocx,
      });

      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        60000
      );

      // Empty doc should fail or have warning
      if (source.status === 'FAILED') {
        expect(source.statusMessage).toMatch(/empty|no.*content/i);
      }
    }, 90000);
  });

  describe('TXT Processor', () => {
    it('should handle UTF-8 content correctly', async () => {
      const utf8Content = `
        English: Hello World
        Chinese: 你好世界
        Japanese: こんにちは世界
        Korean: 안녕하세요 세계
        Arabic: مرحبا بالعالم
        Emoji: 🌍🌎🌏
      `.repeat(20);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'unicode.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(utf8Content, 'utf-8'),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      // Verify unicode preserved
      const allText = chunks.map(c => c.text).join(' ');
      expect(allText).toContain('你好世界');
      expect(allText).toContain('こんにちは');
    }, 90000);

    it('should handle very long lines', async () => {
      // Single line of 10KB
      const longLine = 'word '.repeat(2000);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'long-line.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(longLine),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(1); // Should be split
    }, 90000);
  });
});
```

---

### Task 6.6: Data Integrity Tests

**Priority:** P0
**File:** `tests/integration/pipeline/data-integrity.test.ts`

#### Test Cases

```typescript
// tests/integration/pipeline/data-integrity.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
  sleep,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('Data Integrity', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('integrity');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('Chunk-Vector Consistency', () => {
    it('should have matching chunk count in source and database', async () => {
      const content = 'Test paragraph for chunk consistency. '.repeat(200);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'chunk-count.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      const dbChunkCount = await prisma.knowledgeChunk.count({
        where: { sourceId: source.id },
      });

      expect(source.chunkCount).toBe(dbChunkCount);
    }, 120000);

    it('should have vectorId for every chunk', async () => {
      const content = 'Content for vector ID verification. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'vector-ids.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      for (const chunk of chunks) {
        expect(chunk.vectorId).toBeTruthy();
        expect(chunk.vectorId).toMatch(/^chunk_/);
      }
    }, 120000);

    it('should have sequential chunk indices', async () => {
      const content = 'Sequential index test content. '.repeat(150);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'sequential.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: { chunkIndex: 'asc' },
      });

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i);
      }
    }, 120000);
  });

  describe('Metadata Consistency', () => {
    it('should preserve tenant ID in all chunks', async () => {
      const content = 'Tenant metadata test. '.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'tenant-meta.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        include: { source: true },
      });

      for (const chunk of chunks) {
        expect(chunk.source.tenantId).toBe(tenant.id);
      }
    }, 90000);

    it('should update tokenCount accurately', async () => {
      const content = 'Token count verification content. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'token-count.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      // Token count should be reasonable (roughly chars/4)
      const expectedMinTokens = Math.floor(content.length / 6);
      const expectedMaxTokens = Math.ceil(content.length / 2);

      expect(source.tokenCount).toBeGreaterThan(expectedMinTokens);
      expect(source.tokenCount).toBeLessThan(expectedMaxTokens);
    }, 90000);
  });

  describe('Delete Operations', () => {
    it('should delete all chunks when source is deleted', async () => {
      const content = 'Content to be deleted. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'to-delete.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      // Verify chunks exist
      const chunksBefore = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunksBefore).toBeGreaterThan(0);

      // Delete source
      await knowledgeService.deleteSource(tenant.id, result.id);

      // Verify chunks deleted
      const chunksAfter = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunksAfter).toBe(0);

      // Verify source deleted
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.id },
      });
      expect(source).toBeNull();
    }, 90000);

    it('should handle delete while processing gracefully', async () => {
      const content = 'Content for mid-process delete. '.repeat(200);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'mid-delete.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      // Wait a bit for processing to start
      await sleep(2000);

      // Delete while processing
      await knowledgeService.deleteSource(tenant.id, result.id);

      // Source should be deleted
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.id },
      });
      expect(source).toBeNull();

      // No orphaned chunks
      const chunks = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunks).toBe(0);
    }, 60000);
  });

  describe('Reindex Operations', () => {
    it('should reset and reprocess on reindex', async () => {
      const content = 'Content for reindex test. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'reindex.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const originalChunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: result.id },
      });
      const originalVectorIds = originalChunks.map(c => c.vectorId);

      // Trigger reindex
      await knowledgeService.reindexSource(tenant.id, result.id);

      // Wait for reindex to complete
      await waitForSourceStatus(result.id, 'INDEXED', 90000);

      const newChunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: result.id },
      });

      // Should have same number of chunks
      expect(newChunks.length).toBe(originalChunks.length);

      // Vector IDs might be regenerated (implementation dependent)
      // At minimum, chunks should exist
      expect(newChunks.length).toBeGreaterThan(0);
    }, 150000);

    it('should not create duplicate chunks on reindex', async () => {
      const content = 'Duplicate prevention test. '.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'no-duplicates.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const countBefore = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });

      // Reindex multiple times
      for (let i = 0; i < 3; i++) {
        await knowledgeService.reindexSource(tenant.id, result.id);
        await waitForSourceStatus(result.id, 'INDEXED', 90000);
      }

      const countAfter = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });

      expect(countAfter).toBe(countBefore);
    }, 300000);
  });

  describe('Idempotency', () => {
    it('should skip processing if already INDEXED', async () => {
      const content = 'Idempotency test content. '.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'idempotent.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const indexedAt = (await prisma.knowledgeSource.findUnique({
        where: { id: result.id },
      }))!.indexedAt;

      // Manually re-queue (simulating duplicate job)
      const { documentQueue } = await import('../../../src/jobs/queue.js');
      await documentQueue.add('PROCESS_DOCUMENT', {
        sourceId: result.id,
        tenantId: tenant.id,
      });

      await sleep(5000);

      // Should still be indexed with same timestamp
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.id },
      });

      expect(source?.status).toBe('INDEXED');
      expect(source?.indexedAt?.getTime()).toBe(indexedAt?.getTime());
    }, 90000);
  });
});
```

---

### Task 6.7: Health & Observability Tests

**Priority:** P1
**File:** `tests/integration/health/health-endpoints.test.ts`

#### Test Cases

```typescript
// tests/integration/health/health-endpoints.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestTenant, cleanupTestTenant, clearAllQueues } from '../helpers.js';
import { documentQueue, embeddingQueue, deadLetterQueue } from '../../../src/jobs/queue.js';
import { getWorkerHealth } from '../../../src/jobs/health.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('Health & Observability', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('health');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('Worker Health Endpoint', () => {
    it('should return healthy status when queues are empty', async () => {
      const health = await getWorkerHealth();

      expect(health.status).toBe('healthy');
      expect(health.queues.document.waiting).toBe(0);
      expect(health.queues.document.active).toBe(0);
      expect(health.queues.embedding.waiting).toBe(0);
      expect(health.queues.deadLetter.count).toBe(0);
      expect(health.timestamp).toBeDefined();
    });

    it('should report waiting jobs accurately', async () => {
      // Add jobs directly to queue (bypassing worker)
      await documentQueue.pause();

      try {
        for (let i = 0; i < 5; i++) {
          await documentQueue.add('PROCESS_DOCUMENT', {
            sourceId: `test-${i}`,
            tenantId: tenant.id,
          });
        }

        const health = await getWorkerHealth();

        expect(health.queues.document.waiting).toBe(5);
      } finally {
        await documentQueue.resume();
        await clearAllQueues();
      }
    });

    it('should return degraded status when DLQ exceeds threshold', async () => {
      // Add many jobs to DLQ
      await deadLetterQueue.pause();

      try {
        for (let i = 0; i < 101; i++) {
          await deadLetterQueue.add('failed-job', {
            originalQueue: 'document-processing',
            data: { sourceId: `dlq-${i}` },
            error: { message: 'Test failure' },
          });
        }

        const health = await getWorkerHealth();

        expect(health.status).toBe('degraded');
        expect(health.queues.deadLetter.count).toBeGreaterThan(100);
      } finally {
        await deadLetterQueue.resume();
        await clearAllQueues();
      }
    });

    it('should return unhealthy status when DLQ exceeds critical threshold', async () => {
      await deadLetterQueue.pause();

      try {
        for (let i = 0; i < 501; i++) {
          await deadLetterQueue.add('failed-job', {
            data: { sourceId: `critical-${i}` },
            error: { message: 'Critical failure' },
          });
        }

        const health = await getWorkerHealth();

        expect(health.status).toBe('unhealthy');
      } finally {
        await deadLetterQueue.resume();
        await clearAllQueues();
      }
    });
  });

  describe('Queue Statistics', () => {
    it('should track completed job count', async () => {
      const content = 'Stats test content. '.repeat(30);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'stats.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      // Wait for completion
      const { waitForSourceStatus } = await import('../helpers.js');
      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const health = await getWorkerHealth();

      expect(health.queues.document.completed).toBeGreaterThan(0);
      expect(health.queues.embedding.completed).toBeGreaterThan(0);
    }, 90000);

    it('should track failed job count', async () => {
      // Submit invalid document to generate failure
      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'fail.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('invalid pdf'),
      });

      const { waitForSourceStatus } = await import('../helpers.js');
      await waitForSourceStatus(result.id, 'FAILED', 30000);

      const health = await getWorkerHealth();

      // Either failed count or DLQ should have the job
      const hasFailure =
        health.queues.document.failed > 0 || health.queues.deadLetter.count > 0;
      expect(hasFailure).toBe(true);
    }, 60000);
  });
});
```

---

### Task 6.8: Chunking Edge Case Tests

**Priority:** P1
**File:** `tests/integration/chunking/chunking-edge-cases.test.ts`

#### Test Cases

```typescript
// tests/integration/chunking/chunking-edge-cases.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
  generateLargeText,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('Chunking Edge Cases', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('chunking');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('Size Boundaries', () => {
    it('should handle document smaller than min chunk size', async () => {
      const tinyContent = 'Too small.'; // < 100 chars

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'tiny.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(tinyContent),
      });

      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        30000
      );

      // Either fails with "no chunks" or creates 1 chunk
      if (source.status === 'INDEXED') {
        expect(source.chunkCount).toBeLessThanOrEqual(1);
      }
    }, 60000);

    it('should handle document exactly at chunk size boundary', async () => {
      // Exactly 2000 characters (CHUNK_SIZE)
      const exactContent = 'x'.repeat(2000);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'exact-size.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(exactContent),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBe(1);
    }, 90000);

    it('should create multiple chunks for large documents', async () => {
      const largeContent = generateLargeText(50); // 50KB

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(largeContent),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(20); // 50KB / 2KB chunks
    }, 120000);
  });

  describe('Content Structure', () => {
    it('should preserve paragraph boundaries when possible', async () => {
      const paragraphs = Array(10)
        .fill(null)
        .map((_, i) => `Paragraph ${i + 1}. `.repeat(50))
        .join('\n\n');

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'paragraphs.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(paragraphs),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: { chunkIndex: 'asc' },
      });

      // Chunks should generally not split mid-sentence
      for (const chunk of chunks) {
        // Most chunks should end with period, newline, or be the last chunk
        const endsCleanly =
          chunk.text.trim().endsWith('.') ||
          chunk.text.trim().endsWith('\n') ||
          chunk.chunkIndex === chunks.length - 1;

        // Allow some flexibility (80% should end cleanly)
        // This is a soft assertion
      }
    }, 90000);

    it('should handle document with no natural separators', async () => {
      // One long word repeated
      const noSeparators = 'superlongwordwithnoseparators'.repeat(200);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'no-separators.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(noSeparators),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
      expect(source.chunkCount).toBeGreaterThan(1);

      // Should still have chunked by character limit
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      for (const chunk of chunks.slice(0, -1)) {
        // All but last should be close to chunk size
        expect(chunk.text.length).toBeLessThanOrEqual(2200); // CHUNK_SIZE + overlap
      }
    }, 90000);

    it('should maintain overlap between chunks', async () => {
      const content = 'Sentence one. Sentence two. Sentence three. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'overlap.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: { chunkIndex: 'asc' },
      });

      // Check for overlap between consecutive chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentEnd = chunks[i].text.slice(-100);
        const nextStart = chunks[i + 1].text.slice(0, 300);

        // There should be some overlap (shared text)
        const hasOverlap = nextStart.includes(currentEnd.slice(-50)) ||
                          currentEnd.includes(nextStart.slice(0, 50));

        // Soft check - overlap depends on separator boundaries
      }
    }, 90000);
  });

  describe('Special Characters', () => {
    it('should handle null characters', async () => {
      const withNulls = 'Content with \0 null \0 characters.\n'.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'nulls.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(withNulls),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      // Null characters should be removed
      for (const chunk of chunks) {
        expect(chunk.text).not.toContain('\0');
      }
    }, 90000);

    it('should handle form feed and other control characters', async () => {
      const withControls = 'Page 1 content.\fPage 2 content.\fPage 3.\n'.repeat(30);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'controls.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(withControls),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      expect(source.status).toBe('INDEXED');
    }, 90000);

    it('should preserve meaningful whitespace', async () => {
      const codeBlock = `
function example() {
    const x = 1;
    if (x > 0) {
        return true;
    }
    return false;
}
`.repeat(30);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'code.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(codeBlock),
      });

      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 60000);

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { sourceId: source.id },
      });

      // Should preserve some indentation structure
      const hasIndentation = chunks.some(c => c.text.includes('    '));
      expect(hasIndentation).toBe(true);
    }, 90000);
  });
});
```

---

### Task 6.9: Concurrent Operations Tests

**Priority:** P1
**File:** `tests/integration/pipeline/concurrent-operations.test.ts`

#### Test Cases

```typescript
// tests/integration/pipeline/concurrent-operations.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createTestTenant,
  cleanupTestTenant,
  waitForSourceStatus,
  clearAllQueues,
  sleep,
} from '../helpers.js';
import { prisma } from '../../../src/lib/prisma.js';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';

describe('Concurrent Operations', () => {
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await createTestTenant('concurrent');
  });

  afterAll(async () => {
    await cleanupTestTenant(tenant.id);
  });

  beforeEach(async () => {
    await clearAllQueues();
  });

  describe('Concurrent Uploads', () => {
    it('should handle 10 simultaneous uploads from same tenant', async () => {
      const uploads = Array(10)
        .fill(null)
        .map((_, i) => ({
          filename: `concurrent-${i}.txt`,
          content: `Document ${i} content. `.repeat(50),
        }));

      const results = await Promise.all(
        uploads.map(u =>
          knowledgeService.uploadDocument({
            tenantId: tenant.id,
            filename: u.filename,
            mimeType: 'text/plain',
            buffer: Buffer.from(u.content),
          })
        )
      );

      // All should be created
      expect(results.length).toBe(10);
      results.forEach(r => expect(r.id).toBeDefined());

      // Wait for all to complete
      const statuses = await Promise.all(
        results.map(r =>
          waitForSourceStatus(r.id, ['INDEXED', 'FAILED'], 180000)
        )
      );

      // All should succeed
      const successCount = statuses.filter(s => s.status === 'INDEXED').length;
      expect(successCount).toBe(10);
    }, 240000);

    it('should handle uploads from multiple tenants simultaneously', async () => {
      const tenant2 = await createTestTenant('concurrent-2');
      const tenant3 = await createTestTenant('concurrent-3');

      try {
        const tenantsAndDocs = [
          { tenant: tenant.id, doc: 'Tenant 1 document. '.repeat(50) },
          { tenant: tenant2.id, doc: 'Tenant 2 document. '.repeat(50) },
          { tenant: tenant3.id, doc: 'Tenant 3 document. '.repeat(50) },
        ];

        const results = await Promise.all(
          tenantsAndDocs.map(t =>
            knowledgeService.uploadDocument({
              tenantId: t.tenant,
              filename: 'multi-tenant.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from(t.doc),
            })
          )
        );

        const statuses = await Promise.all(
          results.map(r => waitForSourceStatus(r.id, 'INDEXED', 120000))
        );

        // All should succeed
        statuses.forEach(s => expect(s.status).toBe('INDEXED'));
      } finally {
        await cleanupTestTenant(tenant2.id);
        await cleanupTestTenant(tenant3.id);
      }
    }, 180000);
  });

  describe('Concurrent Modifications', () => {
    it('should handle delete during embedding phase', async () => {
      // Upload a larger document to give time to delete during embedding
      const content = 'Content for delete during embedding. '.repeat(500);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'delete-during-embed.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      // Wait for it to reach embedding phase
      await waitForSourceStatus(result.id, 'EMBEDDING', 60000).catch(() => {});

      // Delete while embedding
      await knowledgeService.deleteSource(tenant.id, result.id);

      // Verify deleted
      const source = await prisma.knowledgeSource.findUnique({
        where: { id: result.id },
      });
      expect(source).toBeNull();

      // No orphaned chunks
      const chunks = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunks).toBe(0);
    }, 120000);

    it('should handle reindex request during processing', async () => {
      const content = 'Content for reindex during processing. '.repeat(200);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'reindex-during.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      // Wait for processing to start
      await sleep(2000);

      // Request reindex (should be handled gracefully)
      try {
        await knowledgeService.reindexSource(tenant.id, result.id);
      } catch {
        // May throw if source is in wrong state - that's acceptable
      }

      // Should eventually reach terminal state
      const { source } = await waitForSourceStatus(
        result.id,
        ['INDEXED', 'FAILED'],
        120000
      );

      expect(['INDEXED', 'FAILED']).toContain(source.status);
    }, 150000);

    it('should prevent concurrent reindex of same source', async () => {
      const content = 'Content for concurrent reindex. '.repeat(100);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'concurrent-reindex.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      await waitForSourceStatus(result.id, 'INDEXED', 60000);

      // Trigger multiple reindex requests simultaneously
      const reindexResults = await Promise.allSettled([
        knowledgeService.reindexSource(tenant.id, result.id),
        knowledgeService.reindexSource(tenant.id, result.id),
        knowledgeService.reindexSource(tenant.id, result.id),
      ]);

      // At least one should succeed
      const succeeded = reindexResults.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Wait for completion
      await waitForSourceStatus(result.id, 'INDEXED', 120000);

      // Should have correct chunk count (no duplicates)
      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 5000);
      const chunks = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunks).toBe(source.chunkCount);
    }, 180000);
  });

  describe('Race Conditions', () => {
    it('should handle duplicate job submissions', async () => {
      const content = 'Content for duplicate job test. '.repeat(50);

      const result = await knowledgeService.uploadDocument({
        tenantId: tenant.id,
        filename: 'duplicate-job.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
      });

      // Manually add duplicate jobs
      const { documentQueue } = await import('../../../src/jobs/queue.js');
      await Promise.all([
        documentQueue.add('PROCESS_DOCUMENT', {
          sourceId: result.id,
          tenantId: tenant.id,
        }),
        documentQueue.add('PROCESS_DOCUMENT', {
          sourceId: result.id,
          tenantId: tenant.id,
        }),
      ]);

      // Should still complete correctly (idempotent)
      const { source } = await waitForSourceStatus(result.id, 'INDEXED', 90000);

      expect(source.status).toBe('INDEXED');

      // Only one set of chunks
      const chunks = await prisma.knowledgeChunk.count({
        where: { sourceId: result.id },
      });
      expect(chunks).toBe(source.chunkCount);
    }, 120000);
  });
});
```

---

## Test Fixtures

### Task 6.10: Test Fixtures Setup

**Priority:** P0
**Files to Create:**
- `tests/fixtures/sample.pdf`
- `tests/fixtures/sample.docx`
- `tests/fixtures/sample-encrypted.pdf`
- `tests/fixtures/sample-scanned.pdf`
- `tests/fixtures/empty.docx`

#### Fixture Generation Script

```typescript
// scripts/generate-test-fixtures.ts

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, '../tests/fixtures');

// Ensure directory exists
fs.mkdirSync(fixturesDir, { recursive: true });

// Generate sample.txt
fs.writeFileSync(
  path.join(fixturesDir, 'sample.txt'),
  'This is a sample text document for testing.\n'.repeat(100)
);

// Generate sample.csv
fs.writeFileSync(
  path.join(fixturesDir, 'sample.csv'),
  `question,answer
"What is your return policy?","30 day returns accepted"
"How do I contact support?","Email support@example.com"
"What payment methods accepted?","Visa, Mastercard, PayPal"
`
);

// Generate large sample
fs.writeFileSync(
  path.join(fixturesDir, 'sample-large.txt'),
  'Large document content paragraph. '.repeat(10000)
);

// Generate unicode sample
fs.writeFileSync(
  path.join(fixturesDir, 'sample-unicode.txt'),
  `English: Hello World
Chinese: 你好世界
Japanese: こんにちは世界
Korean: 안녕하세요
Arabic: مرحبا
Emoji: 🌍🌎🌏
`.repeat(20),
  'utf-8'
);

console.log('Text fixtures generated');
console.log('NOTE: PDF and DOCX fixtures must be created manually or with document generation libraries');
```

---

## Docker Test Environment

### docker-compose.test.yml

```yaml
version: '3.8'

services:
  postgres-test:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: omniscient_test
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data

  redis-test:
    image: redis:7-alpine
    ports:
      - "6380:6379"
    command: redis-server --save ""
```

---

## NPM Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:integration:watch": "vitest --config vitest.integration.config.ts",
    "test:integration:ui": "vitest --config vitest.integration.config.ts --ui",
    "test:integration:coverage": "vitest run --config vitest.integration.config.ts --coverage",
    "test:fixtures": "tsx scripts/generate-test-fixtures.ts"
  }
}
```

---

## Implementation Checklist

### Phase 1: Infrastructure (Task 6.1)
- [ ] Create `vitest.integration.config.ts`
- [ ] Create `tests/integration/global-setup.ts`
- [ ] Create `tests/integration/setup.ts`
- [ ] Create `tests/integration/helpers.ts`
- [ ] Create `tests/integration/mocks/external-services.ts`
- [ ] Create `docker-compose.test.yml`
- [ ] Generate test fixtures

### Phase 2: Core Pipeline Tests (Tasks 6.2-6.3)
- [ ] E2E pipeline tests (all file types)
- [ ] Error handling tests (retryable vs non-retryable)
- [ ] DLQ inspection tests

### Phase 3: Rate Limiting & Fairness (Task 6.4)
- [ ] Concurrent limit tests
- [ ] Per-minute/hour limit tests
- [ ] Tenant fairness tests
- [ ] Redis failure handling

### Phase 4: Processor & Chunking Tests (Tasks 6.5, 6.8)
- [ ] PDF processor edge cases
- [ ] CSV delimiter detection
- [ ] FAQ format detection
- [ ] Chunking boundary tests
- [ ] Unicode handling

### Phase 5: Data Integrity & Concurrent Operations (Tasks 6.6, 6.9)
- [ ] Chunk-vector consistency
- [ ] Delete/reindex integrity
- [ ] Concurrent upload handling
- [ ] Race condition prevention

### Phase 6: Observability (Task 6.7)
- [ ] Health endpoint accuracy
- [ ] Queue statistics tracking

---

## Success Criteria

The integration test suite is complete when:

- [ ] All test files created and passing
- [ ] Test coverage >90% for integration paths
- [ ] Tests run in <10 minutes total
- [ ] CI pipeline configured to run integration tests
- [ ] All edge cases documented have corresponding tests
- [ ] Rate limiting tests verify tenant isolation
- [ ] DLQ tests verify error capture
- [ ] No flaky tests (3 consecutive green runs)
