export interface ProcessDocumentJob {
  sourceId: string;
  tenantId: string;
}

export interface GenerateEmbeddingsJob {
  sourceId: string;
  tenantId: string;
  chunks: Array<{
    text: string;
    index: number;
    tokenCount: number;
    metadata: Record<string, unknown>;
  }>;
}

export interface DeadLetterJob {
  originalQueue: string;
  originalJobId: string | undefined;
  data: unknown;
  error: {
    message: string;
    stack?: string;
  };
  attemptsMade: number;
  failedAt: string;
}

export interface CrawlOptions {
  crawlSitemap: boolean;
  maxDepth: number;
  maxPages: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface CrawlUrlJob {
  type: 'CRAWL_URL';
  sourceId: string;
  tenantId: string;
  url: string;
  options: CrawlOptions;
}

export interface CrawlPageJob {
  type: 'CRAWL_PAGE';
  sourceId: string;
  tenantId: string;
  url: string;
  depth: number;
}

export interface SyncSourceJob {
  type: 'SYNC_SOURCE';
  sourceId: string;
  tenantId: string;
  sourceType: string;
}

/**
 * Retryable errors are transient failures that may succeed on retry
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RetryableError';
    if (cause) {
      this.stack = cause.stack;
    }
  }
}

/**
 * Non-retryable errors are permanent failures that won't succeed on retry
 */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'NonRetryableError';
    if (cause) {
      this.stack = cause.stack;
    }
  }
}
