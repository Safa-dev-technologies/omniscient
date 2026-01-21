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

  // Create test tenant with verification
  try {
    const tenant = await prisma.tenant.upsert({
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

    // Verify tenant was created
    if (!tenant || tenant.id !== TEST_CONFIG.tenantId) {
      throw new Error(`Failed to create/verify test tenant: ${TEST_CONFIG.tenantId}`);
    }
  } catch (error) {
    console.error('Failed to setup test tenant:', error);
    throw new Error(
      `Test tenant setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Global teardown - runs once after all tests
 * Deletes in order respecting FK constraints
 */
export async function globalTeardown() {
  // Cleanup test data in FK-safe order
  try {
    // 1. Delete escalations (references conversations)
    await prisma.escalation
      .deleteMany({
        where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
      })
      .catch(() => {});

    // 2. Delete messages (references conversations)
    await prisma.message
      .deleteMany({
        where: { conversation: { tenantId: TEST_CONFIG.tenantId } },
      })
      .catch(() => {});

    // 3. Delete conversations (references users, tenants)
    await prisma.conversation
      .deleteMany({
        where: { tenantId: TEST_CONFIG.tenantId },
      })
      .catch(() => {});

    // 4. Delete knowledge chunks (references sources)
    await prisma.knowledgeChunk
      .deleteMany({
        where: { source: { tenantId: TEST_CONFIG.tenantId } },
      })
      .catch(() => {});

    // 5. Delete knowledge sources (references tenants)
    await prisma.knowledgeSource
      .deleteMany({
        where: { tenantId: TEST_CONFIG.tenantId },
      })
      .catch(() => {});

    // 6. Delete channel configs (references tenants)
    await prisma.channelConfig
      .deleteMany({
        where: { tenantId: TEST_CONFIG.tenantId },
      })
      .catch(() => {});

    // 7. Delete API keys (references tenants)
    await prisma.apiKey
      .deleteMany({
        where: { tenantId: TEST_CONFIG.tenantId },
      })
      .catch(() => {});

    // 8. Delete users (references tenants)
    await prisma.user
      .deleteMany({
        where: { tenantId: TEST_CONFIG.tenantId },
      })
      .catch(() => {});

    // 9. Finally delete tenant
    await prisma.tenant.delete({ where: { id: TEST_CONFIG.tenantId } }).catch(() => {});

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
  // Also clear tenant-level API rate limits to prevent 429s in sequential tests
  await Promise.all([
    // Worker rate limits
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:concurrent`),
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:minute`),
    redis.del(`ratelimit:document-processing:${TEST_CONFIG.tenantId}:hour`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:concurrent`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:minute`),
    redis.del(`ratelimit:embedding-processing:${TEST_CONFIG.tenantId}:hour`),
    // Tenant API rate limits (from tenant-rate-limit.middleware.ts)
    redis.del(`ratelimit:tenant:chat:${TEST_CONFIG.tenantId}`),
    redis.del(`ratelimit:tenant:upload:${TEST_CONFIG.tenantId}`),
    redis.del(`ratelimit:tenant:crawl:${TEST_CONFIG.tenantId}`),
    redis.del(`ratelimit:tenant:search:${TEST_CONFIG.tenantId}`),
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
