/**
 * Error thrown when a user exceeds their rate limit
 */
export class RateLimitExceededError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  readonly statusCode = 429;
  readonly retryAfter: number;
  readonly limitType: 'minute' | 'hour';
  readonly userId: string;
  readonly remaining: number;

  constructor(params: {
    retryAfter: number;
    limitType: 'minute' | 'hour';
    userId: string;
    remaining?: number;
  }) {
    super(`Rate limit exceeded (${params.limitType}). Retry after ${params.retryAfter} seconds.`);
    this.name = 'RateLimitExceededError';
    this.retryAfter = params.retryAfter;
    this.limitType = params.limitType;
    this.userId = params.userId;
    this.remaining = params.remaining ?? 0;
  }
}
