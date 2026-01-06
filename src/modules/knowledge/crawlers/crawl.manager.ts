import type { Redis } from 'ioredis';
import { redis } from '../../../lib/redis.js';
import { logger } from '../../../lib/logger.js';
import type { CrawlState, CrawlOptions } from './crawl.types.js';

const STATE_TTL = 86400; // 24 hours in seconds
const STATE_KEY_PREFIX = 'crawl';
const VISITED_KEY_PREFIX = 'crawl:visited';
const PENDING_KEY_PREFIX = 'crawl:pending';
const FAILED_KEY_PREFIX = 'crawl:failed';

/**
 * Compiled regex cache for pattern matching
 * Key: sourceId, Value: { include: Array<{ pattern: string; regex?: RegExp }>, exclude: Array<{ pattern: string; regex?: RegExp }> }
 */
interface PatternCache {
  include: Array<{ pattern: string; regex?: RegExp }>;
  exclude: Array<{ pattern: string; regex?: RegExp }>;
}

/**
 * Manages crawl state in Redis
 * Tracks visited URLs, pending URLs, failed URLs, and crawl progress
 */
export class CrawlManager {
  // Cache compiled regexes per sourceId to avoid recompiling on every URL check
  private patternCache = new Map<string, PatternCache>();

  constructor(private redis: Redis) {}

  /**
   * Initialize a new crawl
   */
  async initCrawl(
    sourceId: string,
    tenantId: string,
    rootUrl: string,
    options: CrawlOptions
  ): Promise<void> {
    const state: CrawlState = {
      sourceId,
      tenantId,
      rootUrl,
      status: 'pending',
      options,
      pagesDiscovered: 0,
      pagesCrawled: 0,
      pagesErrored: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveState(sourceId, state);

    // Pre-compile regex patterns for performance
    this.compilePatterns(sourceId, options);

    logger.info({ sourceId, rootUrl }, 'Crawl initialized');
  }

  /**
   * Get current crawl state
   */
  async getState(sourceId: string): Promise<CrawlState | null> {
    const stateKey = `${STATE_KEY_PREFIX}:${sourceId}:state`;
    const stateJson = await this.redis.get(stateKey);

    if (!stateJson) {
      return null;
    }

    const state = JSON.parse(stateJson) as CrawlState;
    // Convert date strings back to Date objects
    state.startedAt = new Date(state.startedAt);
    state.updatedAt = new Date(state.updatedAt);

    return state;
  }

  /**
   * Add URL to pending queue
   * Returns true if URL was added, false if already visited or filtered out
   */
  async addUrl(sourceId: string, url: string, depth: number): Promise<boolean> {
    const state = await this.getState(sourceId);
    if (!state) {
      throw new Error(`Crawl state not found: ${sourceId}`);
    }

    // Check if URL should be crawled
    if (!this.shouldCrawl(url, state.rootUrl, sourceId, state.options)) {
      return false;
    }

    // Check if already visited
    if (await this.isVisited(sourceId, url)) {
      return false;
    }

    // Check depth limit
    if (depth > state.options.maxDepth) {
      return false;
    }

    // Check page limit
    // Note: There's a small race condition window here - between getting counts
    // and adding the URL, another process could add URLs. This is acceptable
    // for now as it only means we might slightly exceed maxPages. For strict
    // enforcement, use Redis transaction or Lua script.
    const visitedCount = await this.getVisitedCount(sourceId);
    if (visitedCount + (await this.getPendingCount(sourceId)) >= state.options.maxPages) {
      return false;
    }

    // Add to pending queue (ZSET with depth as score)
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;
    await this.redis.zadd(pendingKey, depth, url);

    // Update discovered count
    state.pagesDiscovered++;
    state.updatedAt = new Date();
    await this.saveState(sourceId, state);

    return true;
  }

  /**
   * Mark URL as visited
   */
  async markVisited(sourceId: string, url: string): Promise<void> {
    const visitedKey = `${VISITED_KEY_PREFIX}:${sourceId}`;
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;

    // Add to visited set
    await this.redis.sadd(visitedKey, url);

    // Remove from pending
    await this.redis.zrem(pendingKey, url);

    // Update state
    const state = await this.getState(sourceId);
    if (state) {
      state.pagesCrawled++;
      state.updatedAt = new Date();
      await this.saveState(sourceId, state);
    }
  }

  /**
   * Mark URL as failed
   */
  async markFailed(sourceId: string, url: string, error: string): Promise<void> {
    const failedKey = `${FAILED_KEY_PREFIX}:${sourceId}`;
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;

    // Add to failed hash
    await this.redis.hset(failedKey, url, error);

    // Remove from pending
    await this.redis.zrem(pendingKey, url);

    // Update state
    const state = await this.getState(sourceId);
    if (state) {
      state.pagesErrored++;
      state.updatedAt = new Date();
      await this.saveState(sourceId, state);
    }
  }

  /**
   * Get next URL to crawl (lowest depth first)
   *
   * Note: This method returns the URL but does NOT remove it from the pending queue.
   * The caller MUST call markVisited() after successfully processing the URL,
   * or markFailed() if processing fails. This ensures proper state tracking.
   */
  async getNextUrl(sourceId: string): Promise<{ url: string; depth: number } | null> {
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;

    // Get URL with lowest depth (score)
    const result = await this.redis.zrange(pendingKey, 0, 0, 'WITHSCORES');

    if (result.length === 0) {
      return null;
    }

    const url = result[0];
    const depth = parseInt(result[1], 10);

    return { url, depth };
  }

  /**
   * Check if crawl is complete
   */
  async isComplete(sourceId: string): Promise<boolean> {
    const state = await this.getState(sourceId);
    if (!state) {
      return true; // No state means complete
    }

    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return true;
    }

    // Check if pending queue is empty
    const pendingCount = await this.getPendingCount(sourceId);
    if (pendingCount === 0) {
      return true;
    }

    // Check if we've reached max pages
    const visitedCount = await this.getVisitedCount(sourceId);
    if (visitedCount >= state.options.maxPages) {
      return true;
    }

    return false;
  }

  /**
   * Cancel a running crawl
   */
  async cancelCrawl(sourceId: string): Promise<void> {
    const state = await this.getState(sourceId);
    if (!state) {
      return;
    }

    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return; // Already finished
    }

    state.status = 'cancelled';
    state.updatedAt = new Date();
    await this.saveState(sourceId, state);

    logger.info({ sourceId }, 'Crawl cancelled');
  }

  /**
   * Clean up crawl state (remove all Redis keys)
   * Also clears pattern cache
   */
  async cleanupCrawl(sourceId: string): Promise<void> {
    // Clear pattern cache
    this.patternCache.delete(sourceId);

    const stateKey = `${STATE_KEY_PREFIX}:${sourceId}:state`;
    const visitedKey = `${VISITED_KEY_PREFIX}:${sourceId}`;
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;
    const failedKey = `${FAILED_KEY_PREFIX}:${sourceId}`;

    await Promise.all([
      this.redis.del(stateKey),
      this.redis.del(visitedKey),
      this.redis.del(pendingKey),
      this.redis.del(failedKey),
    ]);

    logger.info({ sourceId }, 'Crawl state cleaned up');
  }

  /**
   * Update crawl status
   */
  async updateStatus(sourceId: string, status: CrawlState['status']): Promise<void> {
    const state = await this.getState(sourceId);
    if (!state) {
      return;
    }

    state.status = status;
    state.updatedAt = new Date();
    await this.saveState(sourceId, state);
  }

  /**
   * Compile regex patterns and cache them for a crawl
   */
  private compilePatterns(sourceId: string, options: CrawlOptions): void {
    const cache: PatternCache = {
      include: [],
      exclude: [],
    };

    // Compile include patterns
    if (options.includePatterns && options.includePatterns.length > 0) {
      for (const pattern of options.includePatterns) {
        try {
          const regex = new RegExp(pattern);
          cache.include.push({ pattern, regex });
        } catch {
          // Invalid regex - will be handled as literal string in shouldCrawl
          cache.include.push({ pattern });
        }
      }
    }

    // Compile exclude patterns
    if (options.excludePatterns && options.excludePatterns.length > 0) {
      for (const pattern of options.excludePatterns) {
        try {
          const regex = new RegExp(pattern);
          cache.exclude.push({ pattern, regex });
        } catch {
          // Invalid regex - will be handled as literal string in shouldCrawl
          cache.exclude.push({ pattern });
        }
      }
    }

    this.patternCache.set(sourceId, cache);
  }

  /**
   * Check if URL should be crawled based on filters
   */
  private shouldCrawl(
    url: string,
    baseUrl: string,
    sourceId: string,
    options: CrawlOptions
  ): boolean {
    try {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(baseUrl);

      // 1. Must be same domain as baseUrl
      if (urlObj.hostname !== baseUrlObj.hostname) {
        return false;
      }

      // 2. Must match includePatterns (if specified)
      const cache = this.patternCache.get(sourceId);
      if (options.includePatterns && options.includePatterns.length > 0) {
        const matches = options.includePatterns.some((pattern, index) => {
          const cached = cache?.include[index];
          if (cached?.regex) {
            return cached.regex.test(url);
          }
          // Invalid regex or no cache - treat as literal string
          return url.includes(pattern);
        });
        if (!matches) {
          return false;
        }
      }

      // 3. Must NOT match excludePatterns
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        const matches = options.excludePatterns.some((pattern, index) => {
          const cached = cache?.exclude[index];
          if (cached?.regex) {
            return cached.regex.test(url);
          }
          // Invalid regex or no cache - treat as literal string
          return url.includes(pattern);
        });
        if (matches) {
          return false;
        }
      }

      return true;
    } catch {
      // Invalid URL
      return false;
    }
  }

  /**
   * Check if URL has been visited
   */
  private async isVisited(sourceId: string, url: string): Promise<boolean> {
    const visitedKey = `${VISITED_KEY_PREFIX}:${sourceId}`;
    const result = await this.redis.sismember(visitedKey, url);
    return result === 1;
  }

  /**
   * Get count of visited URLs
   */
  private async getVisitedCount(sourceId: string): Promise<number> {
    const visitedKey = `${VISITED_KEY_PREFIX}:${sourceId}`;
    return await this.redis.scard(visitedKey);
  }

  /**
   * Get count of pending URLs
   */
  private async getPendingCount(sourceId: string): Promise<number> {
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;
    return await this.redis.zcard(pendingKey);
  }

  /**
   * Save crawl state to Redis
   */
  private async saveState(sourceId: string, state: CrawlState): Promise<void> {
    const stateKey = `${STATE_KEY_PREFIX}:${sourceId}:state`;
    const stateJson = JSON.stringify(state);

    // Save with TTL
    await this.redis.setex(stateKey, STATE_TTL, stateJson);

    // Also update TTL on related keys
    const visitedKey = `${VISITED_KEY_PREFIX}:${sourceId}`;
    const pendingKey = `${PENDING_KEY_PREFIX}:${sourceId}`;
    const failedKey = `${FAILED_KEY_PREFIX}:${sourceId}`;

    await Promise.all([
      this.redis.expire(visitedKey, STATE_TTL),
      this.redis.expire(pendingKey, STATE_TTL),
      this.redis.expire(failedKey, STATE_TTL),
    ]);
  }
}

// Export singleton instance
export const crawlManager = new CrawlManager(redis);
