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
