import { Queue, Job } from 'bullmq';
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../../src/lib/prisma.js';
import { TEST_CONFIG as CONFIG } from './setup.js';

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a job to complete
 */
export async function waitForJobCompletion(
  queue: Queue,
  sourceId: string,
  timeout: number = CONFIG.timeout.document
): Promise<Job> {
  const start = Date.now();
  const pollInterval = 500; // Poll every 500ms

  while (Date.now() - start < timeout) {
    // Check completed jobs
    const completedJobs = await queue.getJobs(['completed'], 0, 100);
    const found = completedJobs.find((j) => j.data.sourceId === sourceId);

    if (found) {
      return found;
    }

    // Check if job is still active (not failed)
    const activeJobs = await queue.getJobs(['active'], 0, 100);
    const active = activeJobs.find((j) => j.data.sourceId === sourceId);

    if (!active) {
      // Job is not active and not completed - might be waiting or failed
      const waitingJobs = await queue.getJobs(['waiting'], 0, 100);
      const waiting = waitingJobs.find((j) => j.data.sourceId === sourceId);

      if (!waiting) {
        // Check failed jobs
        const failedJobs = await queue.getJobs(['failed'], 0, 100);
        const failed = failedJobs.find((j) => j.data.sourceId === sourceId);

        if (failed) {
          throw new Error(`Job for ${sourceId} failed: ${failed.failedReason || 'Unknown error'}`);
        }
      }
    }

    await sleep(pollInterval);
  }

  throw new Error(`Job for ${sourceId} did not complete within ${timeout}ms`);
}

/**
 * Wait for a job to fail
 */
export async function waitForJobFailure(
  queue: Queue,
  sourceId: string,
  timeout: number = CONFIG.timeout.document
): Promise<Job> {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeout) {
    const failedJobs = await queue.getJobs(['failed'], 0, 100);
    const found = failedJobs.find((j) => j.data.sourceId === sourceId);

    if (found) {
      return found;
    }

    // Check if source status is FAILED
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (source?.status === 'FAILED') {
      // Job might be in DLQ or already cleaned up
      // Return a mock job-like object or throw with helpful message
      // Since we can't return a real job, we'll throw with information
      throw new Error(`Source ${sourceId} status is FAILED. Check dead letter queue for the job.`);
    }

    await sleep(pollInterval);
  }

  throw new Error(`Job for ${sourceId} did not fail within ${timeout}ms`);
}

/**
 * Wait for source to start processing (status changes from PENDING)
 */
export async function waitForSourceProcessing(
  sourceId: string,
  timeout: number = CONFIG.timeout.document
): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeout) {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (source?.status !== 'PENDING') {
      return; // Job has started processing
    }

    await sleep(pollInterval);
  }

  throw new Error(
    `Source ${sourceId} did not start processing within ${timeout}ms. Still PENDING.`
  );
}

/**
 * Wait for source status to change
 * Handles status progression: if waiting for an intermediate status but source
 * has already progressed to a later status, returns successfully.
 */
export async function waitForSourceStatus(
  sourceId: string,
  expectedStatus: string,
  timeout: number = CONFIG.timeout.document
): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;

  // Define status progression order (earlier -> later)
  const statusOrder: Record<string, number> = {
    PENDING: 0,
    EXTRACTING: 1,
    CHUNKING: 2,
    EMBEDDING: 3,
    INDEXING: 4,
    INDEXED: 5,
    FAILED: 6,
    STALE: 7,
  };

  const expectedOrder = statusOrder[expectedStatus] ?? -1;

  while (Date.now() - start < timeout) {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source?.status) {
      await sleep(pollInterval);
      continue;
    }

    const currentStatus = source.status;
    const currentOrder = statusOrder[currentStatus] ?? -1;

    // If we reached the expected status, return success
    if (currentStatus === expectedStatus) {
      return;
    }

    // If we're waiting for an intermediate status but source has progressed further,
    // that's also success (e.g., waiting for EMBEDDING but status is already INDEXED)
    if (expectedOrder >= 0 && currentOrder > expectedOrder) {
      // Only allow progression for non-terminal states
      // If waiting for EMBEDDING and status is INDEXED, that's OK
      // But if waiting for INDEXED and status is FAILED, that's not OK
      if (expectedStatus !== 'FAILED' && currentStatus !== 'FAILED') {
        return;
      }
    }

    await sleep(pollInterval);
  }

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
  });

  throw new Error(
    `Source ${sourceId} did not reach status ${expectedStatus} within ${timeout}ms. Current status: ${source?.status}`
  );
}

/**
 * Wait for all jobs in a queue to complete
 */
export async function waitForAllJobs(
  queue: Queue,
  timeout: number = CONFIG.timeout.full
): Promise<void> {
  const start = Date.now();
  const pollInterval = 1000;

  while (Date.now() - start < timeout) {
    const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);

    if (waiting === 0 && active === 0) {
      return;
    }

    await sleep(pollInterval);
  }

  const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);

  throw new Error(
    `Queue still has ${waiting} waiting and ${active} active jobs after ${timeout}ms`
  );
}

/**
 * Get job by source ID from any state
 */
export async function findJobBySourceId(queue: Queue, sourceId: string): Promise<Job | null> {
  const states: Array<'completed' | 'active' | 'waiting' | 'failed' | 'delayed'> = [
    'completed',
    'active',
    'waiting',
    'failed',
    'delayed',
  ];

  for (const state of states) {
    const jobs = await queue.getJobs([state], 0, 100);
    const found = jobs.find((j) => j.data.sourceId === sourceId);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Create a test file buffer
 */
export function createTestFileBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

/**
 * Create a valid PDF buffer for testing
 * Loads from fixture file if available, otherwise falls back to base64
 */
export function createMinimalPDF(): Buffer {
  try {
    // Use process.cwd() for reliable path resolution in vitest
    const fixturePath = join(process.cwd(), 'tests/fixtures/Attestation_Letter 3.pdf');
    return readFileSync(fixturePath);
  } catch {
    try {
      // Fallback to sample.pdf if Attestation Letter doesn't exist
      const samplePath = join(process.cwd(), 'tests/fixtures/sample.pdf');
      return readFileSync(samplePath);
    } catch {
      // Final fallback to base64-encoded PDF if no fixtures exist
      const base64PDF =
        'JVBERi0xLjQKJdPr6eEKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA0IDAgUgo+Pgo+PgovQ29udGVudHMgNSAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgowIDEwMCBUZAooVGVzdCBQREYgQ29udGVudCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAzMDYgMDAwMDAgbiAKMDAwMDAwMDM1MyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQyNAolJUVPRg==';
      return Buffer.from(base64PDF, 'base64');
    }
  }
}

/**
 * Create a test CSV buffer
 * Note: Content must exceed MIN_CHUNK_SIZE (100 chars) to produce chunks
 */
export function createTestCSV(hasHeader: boolean = true, isFAQ: boolean = false): Buffer {
  if (isFAQ) {
    // Content must exceed 100 chars to pass chunking
    const content = hasHeader
      ? 'Question,Answer\nWhat is this product?,This is a comprehensive test product designed to help users understand document processing and knowledge management systems.\nHow does the system work?,The system works by extracting text from documents, chunking them into manageable pieces, generating embeddings, and storing them in a vector database for semantic search.\nWhat are the key features?,Key features include multi-tenant support, automatic document processing, FAQ detection, and real-time search capabilities.\n'
      : 'What is this product?,This is a comprehensive test product designed to help users understand document processing and knowledge management systems with advanced features.\nHow does it work?,It works by processing documents, extracting text content, chunking them into manageable pieces, generating embeddings, and storing them in a vector database for semantic search capabilities.\nWhat are the benefits?,The system provides real-time search, multi-tenant support, automatic document processing, and intelligent FAQ detection to help organizations manage their knowledge effectively.\n';
    return Buffer.from(content, 'utf-8');
  }

  const content = hasHeader
    ? 'Name,Age,City,Occupation,Description\nJohn Smith,30,New York,Software Engineer,A passionate developer who loves building scalable applications and learning new technologies.\nJane Doe,25,London,Data Scientist,An expert in machine learning and statistical analysis with experience in various industries.\nBob Wilson,35,San Francisco,Product Manager,Experienced in leading cross-functional teams and delivering innovative products to market.\n'
    : 'John Smith,30,New York,Software Engineer,A passionate developer who loves building scalable applications and learning new technologies in various programming languages.\nJane Doe,25,London,Data Scientist,An expert in machine learning and statistical analysis with extensive experience in various industries and data-driven decision making.\nBob Wilson,35,San Francisco,Product Manager,Experienced in leading cross-functional teams and delivering innovative products to market with a focus on user experience.\n';
  return Buffer.from(content, 'utf-8');
}

/**
 * Verify source state in database
 */
export async function verifySourceState(
  sourceId: string,
  expectedStatus: string,
  options?: {
    minChunkCount?: number;
    hasChunks?: boolean;
    hasVectorId?: boolean;
  }
): Promise<void> {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    include: { chunks: true },
  });

  if (!source) {
    throw new Error(`Source ${sourceId} not found`);
  }

  if (source.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus}, got ${source.status}`);
  }

  if (options?.minChunkCount !== undefined) {
    if ((source.chunkCount || 0) < options.minChunkCount) {
      throw new Error(
        `Expected at least ${options.minChunkCount} chunks, got ${source.chunkCount}`
      );
    }
  }

  if (options?.hasChunks !== undefined) {
    const hasChunks = source.chunks.length > 0;
    if (hasChunks !== options.hasChunks) {
      throw new Error(`Expected hasChunks=${options.hasChunks}, got ${hasChunks}`);
    }
  }

  if (options?.hasVectorId) {
    const chunksWithoutVectorId = source.chunks.filter((c) => !c.vectorId);
    if (chunksWithoutVectorId.length > 0) {
      throw new Error(`${chunksWithoutVectorId.length} chunks missing vectorId`);
    }
  }
}
