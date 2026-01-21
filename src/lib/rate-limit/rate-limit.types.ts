/**
 * Configuration for user-level rate limiting
 */
export interface UserRateLimitConfig {
  /** Maximum messages allowed per minute */
  maxPerMinute: number;
  /** Maximum messages allowed per hour */
  maxPerHour: number;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** When the rate limit window resets */
  resetAt: Date;
  /** Seconds until the user can retry (only set if not allowed) */
  retryAfter?: number;
  /** Which limit was hit (only set if not allowed) */
  limitType?: 'minute' | 'hour';
}

/**
 * Tenant settings for rate limiting
 */
export interface TenantRateLimitSettings {
  chat?: UserRateLimitConfig;
}

/**
 * Default rate limits for users (free tier)
 */
export const DEFAULT_USER_RATE_LIMITS: UserRateLimitConfig = {
  maxPerMinute: 10,
  maxPerHour: 100,
};

/**
 * Suggested tier-based rate limits
 * Tenants can configure these in their settings.rateLimits.chat
 */
export const TIER_RATE_LIMITS = {
  free: { maxPerMinute: 10, maxPerHour: 100 },
  starter: { maxPerMinute: 20, maxPerHour: 300 },
  professional: { maxPerMinute: 50, maxPerHour: 1000 },
  enterprise: { maxPerMinute: 100, maxPerHour: 5000 },
} as const;
