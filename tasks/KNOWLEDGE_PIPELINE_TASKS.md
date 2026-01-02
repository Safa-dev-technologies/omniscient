# Knowledge Processing Pipeline - Task Specifications

**Version:** 1.0.0
**Status:** Ready for Implementation
**Created:** 2024-12-31
**Target:** Production-Ready Knowledge Ingestion Pipeline

---

## Executive Summary

This document defines actionable tasks to complete and harden the Omniscient knowledge processing pipeline. The current implementation is **~85% complete** with all core components functional and 463 tests passing.

**Current State:**
- PDF, DOCX, TXT processors: Implemented and tested
- Recursive chunker: Implemented and tested
- Document worker: Implemented and tested
- Embedding worker: Implemented and tested
- Pinecone integration: Implemented and tested

**Gaps Identified:**
1. CSV processor lacks structured parsing (FAQ extraction)
2. No retry logic on transient failures
3. No dead letter queue for failed jobs
4. Missing rate limiting per tenant on workers
5. No progress tracking for large documents
6. Limited observability in production
7. No integration tests for end-to-end pipeline

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE INGESTION PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   Upload    │
                    │   Endpoint  │
                    └──────┬──────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BullMQ Queue                                     │
│                    "document-processing"                                 │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      DOCUMENT WORKER                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. Download file from storage (S3/local)                        │    │
│  │ 2. Select processor by MIME type                                │    │
│  │ 3. Extract text + metadata                                      │    │
│  │ 4. Chunk text using RecursiveChunker                            │    │
│  │ 5. Queue embedding job                                          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Status Transitions: PENDING → EXTRACTING → CHUNKING → EMBEDDING         │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         BullMQ Queue                                     │
│                    "embedding-generation"                                │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      EMBEDDING WORKER                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. Process chunks in batches (100 per batch)                    │    │
│  │ 2. Generate embeddings via OpenAI                               │    │
│  │ 3. Upsert vectors to Pinecone (tenant namespace)                │    │
│  │ 4. Save chunks to database                                      │    │
│  │ 5. Update source status to INDEXED                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  Status Transitions: EMBEDDING → INDEXED (or FAILED)                     │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Pinecone   │
                    │  (Vectors)  │
                    └─────────────┘
```

---

## Task 1: CSV/FAQ Processor Enhancement

### Priority: P1 (High)
### Estimated Complexity: Medium
### Files to Modify:
- `src/modules/knowledge/processors/csv.processor.ts` (new)
- `src/modules/knowledge/processors/index.ts`
- `tests/unit/knowledge/processors.test.ts`

### Current State
The TXT processor handles `text/csv` MIME type but treats it as plain text, losing structural information valuable for FAQ-style knowledge bases.

### Requirements

#### 1.1 Create CSV Processor
```typescript
// src/modules/knowledge/processors/csv.processor.ts

interface CSVProcessorOptions {
  questionColumn?: string;  // Default: 'question', 'Q', 'Question'
  answerColumn?: string;    // Default: 'answer', 'A', 'Answer'
  delimiter?: string;       // Default: ',' (auto-detect)
  hasHeader?: boolean;      // Default: true
}

interface ExtractedCSV extends ExtractedDocument {
  metadata: {
    rowCount: number;
    columnCount: number;
    columns: string[];
    isFAQ: boolean;  // True if Q&A columns detected
  };
  // For FAQ format, text should be structured as:
  // "Q: {question}\nA: {answer}\n\n"
}
```

#### 1.2 Implementation Spec

```typescript
export class CsvProcessor implements DocumentProcessor {
  mimeTypes = ['text/csv', 'application/csv'];

  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    const content = buffer.toString('utf-8');

    // Step 1: Detect delimiter (comma, semicolon, tab)
    const delimiter = this.detectDelimiter(content);

    // Step 2: Parse CSV
    const rows = this.parseCSV(content, delimiter);

    // Step 3: Detect if FAQ format
    const headers = rows[0];
    const faqColumns = this.detectFAQColumns(headers);

    // Step 4: Format output
    if (faqColumns) {
      return this.formatAsFAQ(rows, faqColumns);
    }

    return this.formatAsTable(rows);
  }

  private detectDelimiter(content: string): string {
    // Count occurrences of each delimiter in first 5 lines
    const sample = content.split('\n').slice(0, 5).join('\n');
    const counts = {
      ',': (sample.match(/,/g) || []).length,
      ';': (sample.match(/;/g) || []).length,
      '\t': (sample.match(/\t/g) || []).length,
    };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private detectFAQColumns(headers: string[]): { q: number; a: number } | null {
    const qPatterns = ['question', 'q', 'query', 'ask', 'faq'];
    const aPatterns = ['answer', 'a', 'response', 'reply'];

    const qIndex = headers.findIndex(h =>
      qPatterns.some(p => h.toLowerCase().includes(p))
    );
    const aIndex = headers.findIndex(h =>
      aPatterns.some(p => h.toLowerCase().includes(p))
    );

    if (qIndex !== -1 && aIndex !== -1) {
      return { q: qIndex, a: aIndex };
    }
    return null;
  }
}
```

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| Empty CSV | Return empty text with rowCount: 0 |
| Single column | Treat as plain text list |
| Missing values | Skip row or use placeholder |
| Quoted fields with delimiters | Proper CSV parsing (handle `"foo,bar"`) |
| Different encodings | Detect BOM, assume UTF-8 fallback |
| Very large CSV (>10MB) | Stream processing (see Task 4) |
| Malformed rows | Log warning, skip row, continue |

### Bottlenecks

| Bottleneck | Mitigation |
|------------|------------|
| Memory for large CSVs | Stream-based parsing for files >5MB |
| Slow parsing | Use native CSV parser (csv-parse) |

### Testing Requirements

```typescript
describe('CsvProcessor', () => {
  it('should detect comma delimiter');
  it('should detect semicolon delimiter');
  it('should detect tab delimiter');
  it('should identify FAQ format columns');
  it('should format FAQ as Q&A pairs');
  it('should handle quoted fields with commas');
  it('should handle empty cells');
  it('should handle UTF-8 BOM');
  it('should handle rows with missing columns');
  it('should handle single-column CSV');
  it('should limit output for very long CSVs');
});
```

### Integration Points
- Update `getProcessor()` in `src/modules/knowledge/processors/index.ts`
- Update `ALLOWED_MIME_TYPES` in `src/modules/knowledge/knowledge.service.ts`
- No database schema changes required

---

## Task 2: Worker Retry Logic & Dead Letter Queue

### Priority: P0 (Critical)
### Estimated Complexity: Medium
### Files to Modify:
- `src/jobs/workers/document.worker.ts`
- `src/jobs/workers/embedding.worker.ts`
- `src/jobs/queue.ts`
- `src/jobs/jobs.types.ts`

### Current State
Workers have basic try/catch but no retry logic. Failed jobs are lost after single failure.

### Requirements

#### 2.1 Configure BullMQ Retry Strategy

```typescript
// src/jobs/queue.ts

export const documentQueue = new Queue('document-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      count: 1000,  // Keep last 1000 completed
      age: 86400,   // or 24 hours
    },
    removeOnFail: false, // Keep failed for inspection
  },
});

export const embeddingQueue = new Queue('embedding-generation', {
  connection,
  defaultJobOptions: {
    attempts: 5,  // More retries for API calls
    backoff: {
      type: 'exponential',
      delay: 10000, // 10s base (API rate limits)
    },
    removeOnComplete: {
      count: 1000,
      age: 86400,
    },
    removeOnFail: false,
  },
});

// Dead letter queue for permanent failures
export const deadLetterQueue = new Queue('dead-letter', { connection });
```

#### 2.2 Classify Retryable vs Non-Retryable Errors

```typescript
// src/jobs/jobs.types.ts

export class RetryableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class NonRetryableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

// Classification:
// RETRYABLE:
// - Network timeouts
// - API rate limits (429)
// - Temporary service unavailable (503)
// - Database connection errors
// - Redis connection errors
// - Pinecone transient errors

// NON-RETRYABLE:
// - Invalid file format
// - Unsupported MIME type
// - File not found (deleted)
// - Authentication errors (401)
// - Invalid API key
// - Malformed document
```

#### 2.3 Implement Error Classification in Workers

```typescript
// src/jobs/workers/document.worker.ts

import { RetryableError, NonRetryableError } from '../jobs.types.js';

async function processDocument(job: Job<ProcessDocumentJob>) {
  const { sourceId, tenantId } = job.data;

  try {
    // ... existing logic ...
  } catch (error) {
    // Classify error
    if (isRetryable(error)) {
      logger.warn({ sourceId, error, attempt: job.attemptsMade }, 'Retryable error');
      throw new RetryableError('Temporary failure', error as Error);
    }

    // Non-retryable: move to dead letter
    logger.error({ sourceId, error }, 'Non-retryable error');
    await moveToDeadLetter(job, error);

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: formatErrorMessage(error),
      },
    });

    // Don't throw - job is "complete" (moved to DLQ)
    return;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;

  const message = error instanceof Error ? error.message : String(error);

  // Network/transient errors
  if (message.includes('ECONNRESET')) return true;
  if (message.includes('ETIMEDOUT')) return true;
  if (message.includes('ENOTFOUND')) return true;

  // API errors
  if (error instanceof Error && 'status' in error) {
    const status = (error as any).status;
    if (status === 429) return true; // Rate limit
    if (status === 503) return true; // Service unavailable
    if (status >= 500) return true;  // Server errors
  }

  return false;
}

async function moveToDeadLetter(job: Job, error: unknown) {
  await deadLetterQueue.add('failed-document', {
    originalQueue: 'document-processing',
    originalJobId: job.id,
    data: job.data,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  });
}
```

#### 2.4 Add Failed Job Event Handler

```typescript
// src/jobs/workers/document.worker.ts

documentWorker.on('failed', async (job, err) => {
  if (!job) return;

  const { sourceId } = job.data;

  // Check if max retries exhausted
  if (job.attemptsMade >= (job.opts.attempts || 3)) {
    logger.error({
      jobId: job.id,
      sourceId,
      attempts: job.attemptsMade,
      error: err
    }, 'Document processing permanently failed');

    // Move to dead letter queue
    await moveToDeadLetter(job, err);

    // Update database
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: `Failed after ${job.attemptsMade} attempts: ${err.message}`,
      },
    });
  } else {
    logger.warn({
      jobId: job.id,
      sourceId,
      attempt: job.attemptsMade,
      nextAttempt: job.attemptsMade + 1,
      error: err,
    }, 'Document processing failed, will retry');
  }
});
```

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| Job fails during status update | Idempotent status checks |
| Pinecone partial upsert failure | Track upserted IDs, resume from last |
| OpenAI rate limit mid-batch | Smaller batch + exponential backoff |
| Redis connection lost | BullMQ handles reconnection |
| Worker crash mid-processing | Job stays in queue, picked up by another worker |
| Duplicate job submission | Check source status before processing |

### Bottlenecks

| Bottleneck | Mitigation |
|------------|------------|
| Rate limits stacking up | Per-tenant rate limiting (Task 3) |
| Retry storms | Exponential backoff with jitter |
| DLQ growing unbounded | Scheduled cleanup job |

### Testing Requirements

```typescript
describe('Document Worker Retry Logic', () => {
  it('should retry on network timeout');
  it('should retry on 429 rate limit');
  it('should retry on 503 service unavailable');
  it('should NOT retry on invalid file format');
  it('should NOT retry on 401 auth error');
  it('should move to DLQ after max retries');
  it('should update source status on permanent failure');
  it('should track attempt count in logs');
});
```

---

## Task 3: Per-Tenant Rate Limiting on Workers

### Priority: P1 (High)
### Estimated Complexity: Medium
### Files to Modify:
- `src/jobs/queue.ts`
- `src/jobs/workers/document.worker.ts`
- `src/jobs/workers/embedding.worker.ts`
- `src/lib/redis.ts`

### Current State
No rate limiting per tenant. One tenant uploading 1000 PDFs can starve others.

### Requirements

#### 3.1 Implement Tenant Rate Limiter

```typescript
// src/jobs/rate-limiter.ts

import { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';

interface RateLimitConfig {
  maxConcurrent: number;  // Max concurrent jobs per tenant
  maxPerMinute: number;   // Max jobs started per minute
  maxPerHour: number;     // Max jobs started per hour
}

const DEFAULT_LIMITS: RateLimitConfig = {
  maxConcurrent: 5,    // 5 concurrent document processing jobs
  maxPerMinute: 20,    // 20 jobs/minute
  maxPerHour: 200,     // 200 jobs/hour
};

export class TenantRateLimiter {
  constructor(
    private redis: Redis,
    private queueName: string,
    private limits: RateLimitConfig = DEFAULT_LIMITS
  ) {}

  async canProcess(tenantId: string): Promise<boolean> {
    const now = Date.now();
    const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
    const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;
    const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;

    // Check concurrent limit
    const concurrent = await this.redis.get(concurrentKey);
    if (concurrent && parseInt(concurrent) >= this.limits.maxConcurrent) {
      return false;
    }

    // Check per-minute limit
    const minuteCount = await this.redis.zcount(minuteKey, now - 60000, now);
    if (minuteCount >= this.limits.maxPerMinute) {
      return false;
    }

    // Check per-hour limit
    const hourCount = await this.redis.zcount(hourKey, now - 3600000, now);
    if (hourCount >= this.limits.maxPerHour) {
      return false;
    }

    return true;
  }

  async startJob(tenantId: string, jobId: string): Promise<void> {
    const now = Date.now();
    const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
    const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;
    const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;

    await this.redis
      .multi()
      // Increment concurrent
      .incr(concurrentKey)
      .expire(concurrentKey, 3600) // 1 hour TTL
      // Add to minute window
      .zadd(minuteKey, now, jobId)
      .expire(minuteKey, 120) // 2 minute TTL
      // Add to hour window
      .zadd(hourKey, now, jobId)
      .expire(hourKey, 7200) // 2 hour TTL
      .exec();
  }

  async endJob(tenantId: string): Promise<void> {
    const concurrentKey = `ratelimit:${this.queueName}:${tenantId}:concurrent`;
    await this.redis.decr(concurrentKey);
  }

  async cleanupOldEntries(tenantId: string): Promise<void> {
    const now = Date.now();
    const minuteKey = `ratelimit:${this.queueName}:${tenantId}:minute`;
    const hourKey = `ratelimit:${this.queueName}:${tenantId}:hour`;

    await this.redis
      .multi()
      .zremrangebyscore(minuteKey, 0, now - 60000)
      .zremrangebyscore(hourKey, 0, now - 3600000)
      .exec();
  }
}
```

#### 3.2 Integrate with Workers

```typescript
// src/jobs/workers/document.worker.ts

import { TenantRateLimiter } from '../rate-limiter.js';

const rateLimiter = new TenantRateLimiter(redis, 'document-processing', {
  maxConcurrent: 5,
  maxPerMinute: 20,
  maxPerHour: 200,
});

async function processDocument(job: Job<ProcessDocumentJob>) {
  const { sourceId, tenantId } = job.data;

  // Check rate limit before processing
  const canProcess = await rateLimiter.canProcess(tenantId);
  if (!canProcess) {
    logger.info({ sourceId, tenantId }, 'Rate limited, delaying job');
    // Delay and retry
    await job.moveToDelayed(Date.now() + 30000); // 30 second delay
    return;
  }

  // Mark job as started
  await rateLimiter.startJob(tenantId, job.id!);

  try {
    // ... existing processing logic ...
  } finally {
    // Always decrement concurrent count
    await rateLimiter.endJob(tenantId);
  }
}
```

#### 3.3 Add Tenant Tier Support (Future)

```typescript
// For future: different limits per tenant tier
interface TenantTier {
  name: 'free' | 'starter' | 'pro' | 'enterprise';
  limits: RateLimitConfig;
}

const TIER_LIMITS: Record<string, RateLimitConfig> = {
  free: { maxConcurrent: 2, maxPerMinute: 5, maxPerHour: 50 },
  starter: { maxConcurrent: 5, maxPerMinute: 20, maxPerHour: 200 },
  pro: { maxConcurrent: 10, maxPerMinute: 50, maxPerHour: 500 },
  enterprise: { maxConcurrent: 25, maxPerMinute: 100, maxPerHour: 2000 },
};
```

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| Worker crash before decrement | TTL on concurrent key (auto-expires) |
| Redis unavailable | Fail open (allow processing) with warning |
| Clock skew between workers | Use Redis server time (TIME command) |
| Delayed job storms | Jitter on delay (random 20-40s) |

### Testing Requirements

```typescript
describe('TenantRateLimiter', () => {
  it('should allow jobs under concurrent limit');
  it('should block jobs at concurrent limit');
  it('should allow jobs under per-minute limit');
  it('should block jobs at per-minute limit');
  it('should decrement concurrent on job end');
  it('should cleanup old window entries');
  it('should handle Redis failures gracefully');
});
```

---

## Task 4: Large Document Streaming Support

### Priority: P2 (Medium)
### Estimated Complexity: High
### Files to Modify:
- `src/jobs/workers/document.worker.ts`
- `src/modules/knowledge/processors/pdf.processor.ts`
- `src/modules/knowledge/chunkers/recursive.chunker.ts`

### Current State
Documents are loaded entirely into memory. Large PDFs (>50MB) can cause OOM errors.

### Requirements

#### 4.1 Stream-Based Processing for Large Files

```typescript
// src/jobs/workers/document.worker.ts

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

async function processDocument(job: Job<ProcessDocumentJob>) {
  const { sourceId } = job.data;

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
  });

  if (!source?.fileSize) {
    throw new NonRetryableError('Source missing file size');
  }

  // Choose processing strategy based on size
  if (source.fileSize > LARGE_FILE_THRESHOLD) {
    await processLargeDocument(job, source);
  } else {
    await processSmallDocument(job, source);
  }
}

async function processLargeDocument(
  job: Job<ProcessDocumentJob>,
  source: KnowledgeSource
) {
  const { sourceId, tenantId } = job.data;

  logger.info({ sourceId, fileSize: source.fileSize }, 'Processing large document with streaming');

  // Update with progress tracking
  await job.updateProgress(0);

  // Get read stream from storage
  const stream = await storage.getReadStream(source.storagePath!);

  // Process in streaming fashion
  const processor = getStreamProcessor(source.mimeType!);
  let totalChunks = 0;
  let processedBytes = 0;

  const chunkBatch: Chunk[] = [];
  const BATCH_SIZE = 50; // Queue embeddings every 50 chunks

  for await (const textSegment of processor.extractStream(stream)) {
    // Update progress
    processedBytes += textSegment.bytes;
    await job.updateProgress(Math.floor((processedBytes / source.fileSize!) * 100));

    // Chunk the segment
    const chunks = chunker.chunk(textSegment.text);
    chunkBatch.push(...chunks);

    // Queue batch for embedding when threshold reached
    if (chunkBatch.length >= BATCH_SIZE) {
      await queueChunkBatch(sourceId, tenantId, chunkBatch.splice(0, BATCH_SIZE), totalChunks);
      totalChunks += BATCH_SIZE;
    }
  }

  // Queue remaining chunks
  if (chunkBatch.length > 0) {
    await queueChunkBatch(sourceId, tenantId, chunkBatch, totalChunks);
  }
}
```

#### 4.2 Progress Tracking

```typescript
// src/modules/knowledge/knowledge.schema.ts

// Add to source response
interface KnowledgeSourceWithProgress {
  // ... existing fields ...
  progress?: {
    stage: 'extracting' | 'chunking' | 'embedding' | 'indexing';
    percent: number;
    chunksProcessed?: number;
    totalChunks?: number;
  };
}

// Store progress in Redis for real-time access
async function updateProgress(sourceId: string, progress: Progress) {
  await redis.setex(
    `progress:${sourceId}`,
    3600, // 1 hour TTL
    JSON.stringify(progress)
  );
}

async function getProgress(sourceId: string): Promise<Progress | null> {
  const data = await redis.get(`progress:${sourceId}`);
  return data ? JSON.parse(data) : null;
}
```

### Edge Cases to Handle

| Edge Case | Handling |
|-----------|----------|
| Stream interruption | Checkpoint progress, resume from last position |
| Memory pressure during batch | Smaller batch sizes, back-pressure |
| Very large single page | Split page text into sub-chunks |
| Corrupted PDF mid-stream | Skip corrupted pages, log warning |

---

## Task 5: Enhanced Observability

### Priority: P1 (High)
### Estimated Complexity: Low
### Files to Modify:
- `src/jobs/workers/document.worker.ts`
- `src/jobs/workers/embedding.worker.ts`
- `src/lib/logger.ts`

### Requirements

#### 5.1 Structured Logging with Metrics

```typescript
// src/lib/metrics.ts

interface ProcessingMetrics {
  sourceId: string;
  tenantId: string;
  fileSize: number;
  mimeType: string;
  chunkCount: number;
  tokenCount: number;
  extractionTimeMs: number;
  chunkingTimeMs: number;
  embeddingTimeMs: number;
  totalTimeMs: number;
  success: boolean;
  errorType?: string;
}

export function logProcessingMetrics(metrics: ProcessingMetrics) {
  logger.info({
    event: 'document_processed',
    ...metrics,
    // Calculate derived metrics
    tokensPerChunk: metrics.tokenCount / metrics.chunkCount,
    bytesPerSecond: metrics.fileSize / (metrics.totalTimeMs / 1000),
    embedsPerSecond: metrics.chunkCount / (metrics.embeddingTimeMs / 1000),
  }, 'Document processing complete');
}
```

#### 5.2 Add Timing to Workers

```typescript
// src/jobs/workers/document.worker.ts

async function processDocument(job: Job<ProcessDocumentJob>) {
  const startTime = Date.now();
  const timings = {
    extraction: 0,
    chunking: 0,
    queueing: 0,
  };

  try {
    // ... download file ...

    // Time extraction
    const extractStart = Date.now();
    const extracted = await processor.extract(buffer, source.originalFilename!);
    timings.extraction = Date.now() - extractStart;

    // Time chunking
    const chunkStart = Date.now();
    const chunks = chunker.chunk(extracted.text);
    timings.chunking = Date.now() - chunkStart;

    // Time queueing
    const queueStart = Date.now();
    await embeddingQueue.add('GENERATE_EMBEDDINGS', { ... });
    timings.queueing = Date.now() - queueStart;

    logger.info({
      sourceId,
      tenantId,
      fileSize: source.fileSize,
      mimeType: source.mimeType,
      chunkCount: chunks.length,
      timings,
      totalTimeMs: Date.now() - startTime,
    }, 'Document extraction complete');

  } catch (error) {
    logger.error({
      sourceId,
      tenantId,
      timings,
      totalTimeMs: Date.now() - startTime,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : String(error),
    }, 'Document processing failed');
    throw error;
  }
}
```

#### 5.3 Health Check Endpoint for Workers

```typescript
// src/jobs/health.ts

import { documentQueue, embeddingQueue, deadLetterQueue } from './queue.js';

export async function getWorkerHealth() {
  const [docWaiting, docActive, docFailed] = await Promise.all([
    documentQueue.getWaitingCount(),
    documentQueue.getActiveCount(),
    documentQueue.getFailedCount(),
  ]);

  const [embedWaiting, embedActive, embedFailed] = await Promise.all([
    embeddingQueue.getWaitingCount(),
    embeddingQueue.getActiveCount(),
    embeddingQueue.getFailedCount(),
  ]);

  const dlqCount = await deadLetterQueue.getWaitingCount();

  return {
    status: dlqCount > 100 ? 'degraded' : 'healthy',
    queues: {
      document: { waiting: docWaiting, active: docActive, failed: docFailed },
      embedding: { waiting: embedWaiting, active: embedActive, failed: embedFailed },
      deadLetter: { count: dlqCount },
    },
    timestamp: new Date().toISOString(),
  };
}
```

---

## Task 6: Integration Tests

### Priority: P0 (Critical)
### Estimated Complexity: Medium
### Files to Create:
- `tests/integration/knowledge-pipeline.test.ts`

### Requirements

#### 6.1 End-to-End Pipeline Test

```typescript
// tests/integration/knowledge-pipeline.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { documentQueue, embeddingQueue } from '../../src/jobs/queue.js';
import { prisma } from '../../src/lib/prisma.js';
import * as knowledgeService from '../../src/modules/knowledge/knowledge.service.js';

describe('Knowledge Pipeline Integration', () => {
  const testTenantId = 'test-tenant-integration';

  beforeAll(async () => {
    // Setup test tenant
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Integration Test Tenant',
        slug: 'integration-test',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.knowledgeSource.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.tenant.delete({ where: { id: testTenantId } });
  });

  it('should process PDF end-to-end', async () => {
    // 1. Upload document
    const pdfBuffer = await fs.readFile('tests/fixtures/sample.pdf');
    const result = await knowledgeService.uploadDocument({
      tenantId: testTenantId,
      filename: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });

    expect(result.status).toBe('PENDING');

    // 2. Wait for document processing
    await waitForJobCompletion(documentQueue, result.sourceId, 30000);

    // 3. Check source status is EMBEDDING
    let source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });
    expect(source?.status).toBe('EMBEDDING');

    // 4. Wait for embedding processing
    await waitForJobCompletion(embeddingQueue, result.sourceId, 60000);

    // 5. Verify final state
    source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
      include: { chunks: true },
    });

    expect(source?.status).toBe('INDEXED');
    expect(source?.chunkCount).toBeGreaterThan(0);
    expect(source?.chunks.length).toBeGreaterThan(0);

    // 6. Test search
    const searchResults = await knowledgeService.searchKnowledge(testTenantId, {
      q: 'test query from pdf content',
      limit: 5,
      threshold: 0.5,
    });

    expect(searchResults.length).toBeGreaterThan(0);
  }, 120000); // 2 minute timeout

  it('should handle invalid PDF gracefully', async () => {
    const invalidBuffer = Buffer.from('not a real pdf');
    const result = await knowledgeService.uploadDocument({
      tenantId: testTenantId,
      filename: 'invalid.pdf',
      mimeType: 'application/pdf',
      buffer: invalidBuffer,
    });

    // Wait for processing to fail
    await waitForJobFailure(documentQueue, result.sourceId, 30000);

    const source = await prisma.knowledgeSource.findUnique({
      where: { id: result.sourceId },
    });

    expect(source?.status).toBe('FAILED');
    expect(source?.statusMessage).toBeTruthy();
  });
});

async function waitForJobCompletion(queue: Queue, sourceId: string, timeout: number) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const jobs = await queue.getJobs(['completed']);
    const found = jobs.find(j => j.data.sourceId === sourceId);
    if (found) return;
    await sleep(500);
  }
  throw new Error(`Job for ${sourceId} did not complete within ${timeout}ms`);
}
```

---

## Task 7: PDF Processor Hardening

### Priority: P1 (High)
### Estimated Complexity: Medium
### Files to Modify:
- `src/modules/knowledge/processors/pdf.processor.ts`

### Current State
Uses `pdf-parse` which works but lacks robustness for edge cases.

### Requirements

#### 7.1 Add Fallback and Error Recovery

```typescript
// src/modules/knowledge/processors/pdf.processor.ts

import pdfParse from 'pdf-parse';
import { NonRetryableError, RetryableError } from '../../../jobs/jobs.types.js';
import { logger } from '../../../lib/logger.js';

export class PdfProcessor implements DocumentProcessor {
  mimeTypes = ['application/pdf'];

  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    // Validate PDF header
    if (!this.isValidPdf(buffer)) {
      throw new NonRetryableError(`Invalid PDF file: ${filename}`);
    }

    try {
      const result = await pdfParse(buffer, {
        max: 0, // No page limit
        version: 'v2.0.550', // Lock to known working version
      });

      // Validate extraction result
      if (!result.text || result.text.trim().length === 0) {
        logger.warn({ filename, numPages: result.numpages }, 'PDF extracted with no text');
        // This might be a scanned PDF - could add OCR fallback here
        return {
          text: '',
          metadata: {
            pageCount: result.numpages,
            title: result.info?.Title,
            author: result.info?.Author,
            warning: 'No text extracted - PDF may be scanned/image-based',
          },
        };
      }

      // Clean extracted text
      const cleanedText = this.cleanText(result.text);

      return {
        text: cleanedText,
        metadata: {
          pageCount: result.numpages,
          title: result.info?.Title,
          author: result.info?.Author,
        },
      };

    } catch (error) {
      // Classify error
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('encrypted') || message.includes('password')) {
        throw new NonRetryableError(`PDF is password protected: ${filename}`);
      }

      if (message.includes('corrupt') || message.includes('invalid')) {
        throw new NonRetryableError(`PDF is corrupted: ${filename}`);
      }

      // Unknown error - might be transient
      throw new RetryableError(`PDF extraction failed: ${message}`, error as Error);
    }
  }

  private isValidPdf(buffer: Buffer): boolean {
    // Check PDF magic bytes
    return buffer.length > 4 && buffer.toString('ascii', 0, 5) === '%PDF-';
  }

  private cleanText(text: string): string {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove null characters
      .replace(/\0/g, '')
      // Fix broken ligatures
      .replace(/ﬁ/g, 'fi')
      .replace(/ﬂ/g, 'fl')
      .replace(/ﬀ/g, 'ff')
      // Normalize quotes
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      // Remove page break markers
      .replace(/\f/g, '\n\n')
      .trim();
  }
}
```

---

## Implementation Order

### Phase 1: Stability (Tasks 2, 7)
1. **Task 2: Retry Logic & DLQ** - Critical for production
2. **Task 7: PDF Hardening** - Most common file type

### Phase 2: Scalability (Tasks 3, 5)
3. **Task 3: Per-Tenant Rate Limiting** - Prevent abuse
4. **Task 5: Observability** - Need metrics before scaling

### Phase 3: Features (Tasks 1, 4)
5. **Task 1: CSV Processor** - New file type support
6. **Task 4: Large Document Streaming** - Handle edge cases

### Phase 4: Verification (Task 6)
7. **Task 6: Integration Tests** - Validate everything works

---

## Non-Goals (Explicitly Out of Scope)

The following are NOT part of this task specification:

1. **URL Crawler** - Separate task spec needed
2. **Zendesk/Notion Connectors** - Phase 3 features
3. **Admin Dashboard** - Phase 4 feature
4. **Multi-language Support** - Phase 5 feature
5. **OCR for Scanned PDFs** - Future enhancement
6. **Real-time Processing Status WebSocket** - Future enhancement

---

## Success Criteria

The knowledge pipeline is production-ready when:

- [ ] All 7 tasks implemented
- [ ] Unit test coverage >80% for new code
- [ ] Integration tests pass reliably
- [ ] Can process 100 PDFs concurrently without failure
- [ ] P95 latency for single document <30 seconds
- [ ] No OOM errors on 50MB files
- [ ] Graceful degradation under load (rate limiting works)
- [ ] All failures logged with actionable information
- [ ] Dead letter queue processing documented

---

## Appendix: Test Fixtures Needed

```
tests/fixtures/
├── sample.pdf           # Normal multi-page PDF
├── sample.docx          # Normal Word document
├── sample.txt           # Plain text file
├── sample.csv           # CSV with FAQ columns
├── sample-large.pdf     # >10MB PDF for streaming tests
├── sample-scanned.pdf   # Image-only PDF (no text)
├── sample-encrypted.pdf # Password-protected PDF
├── sample-corrupt.pdf   # Intentionally corrupted
└── sample-unicode.txt   # Unicode edge cases
```
