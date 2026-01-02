import { beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { documentQueue, embeddingQueue, deadLetterQueue } from '../../src/jobs/queue.js';
import { redis } from '../../src/lib/redis.js';
import { getPineconeIndex } from '../../src/lib/pinecone.js';

/**
 * Integration test configuration
 */
export const TEST_CONFIG = {
  tenantId: 'test-tenant-integration',
  tenantSlug: 'integration-test',
  get namespace() {
    return `tenant_${this.tenantId}`; // Matches format: tenant_{tenantId}
  },
  timeout: {
    document: 60000, // 60 seconds (increased for larger PDFs)
    embedding: 60000, // 60 seconds (increased for larger PDFs)
    full: 180000, // 3 minutes (increased for full pipeline with larger PDFs)
  },
};

/**
 * Global setup - runs once before all tests
 */
export async function globalSetup() {
  // Ensure Redis connection
  if (!redis.status || redis.status === 'end') {
    await redis.connect();
  }

  // Create test tenant
  try {
    await prisma.tenant.upsert({
      where: { id: TEST_CONFIG.tenantId },
      create: {
        id: TEST_CONFIG.tenantId,
        name: 'Integration Test Tenant',
        slug: TEST_CONFIG.tenantSlug,
      },
      update: {
        name: 'Integration Test Tenant',
        slug: TEST_CONFIG.tenantSlug,
      },
    });
  } catch (error) {
    console.warn('Test tenant may already exist:', error);
  }
}

/**
 * Global teardown - runs once after all tests
 */
export async function globalTeardown() {
  // Cleanup test data
  try {
    // Delete all test knowledge sources and chunks
    await prisma.knowledgeChunk.deleteMany({
      where: {
        source: {
          tenantId: TEST_CONFIG.tenantId,
        },
      },
    });

    await prisma.knowledgeSource.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });

    // Delete test tenant
    await prisma.tenant.delete({
      where: { id: TEST_CONFIG.tenantId },
    }).catch(() => {
      // Ignore if already deleted
    });

    // Clean up Pinecone namespace
    try {
      const index = getPineconeIndex();
      await index.namespace(TEST_CONFIG.namespace).deleteAll();
    } catch (error) {
      console.warn('Failed to cleanup Pinecone namespace:', error);
    }

    // Clean up queues
    await documentQueue.obliterate({ force: true }).catch(() => {});
    await embeddingQueue.obliterate({ force: true }).catch(() => {});
    await deadLetterQueue.obliterate({ force: true }).catch(() => {});
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

/**
 * Per-test setup - runs before each test
 * Note: We don't delete sources here because tests run in parallel across files.
 * Source cleanup happens in globalTeardown only.
 */
export async function testSetup() {
  // Clear rate limit keys to ensure clean state for each test
  // This prevents jobs from being blocked by stale concurrent counters from previous tests
  await Promise.all([
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:concurrent`),
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:minute`),
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:hour`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:concurrent`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:minute`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:hour`),
  ]).catch(() => {
    // Ignore errors if Redis keys don't exist
  });

  // Brief pause to allow queue state to settle
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Per-test teardown - runs after each test
 */
export async function testTeardown() {
  // Clean up any test-specific data
  // (Most cleanup happens in global teardown)
}
