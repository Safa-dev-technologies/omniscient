import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrawlManager } from '../../../src/modules/knowledge/crawlers/crawl.manager.js';
import type { Redis } from 'ioredis';

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  sadd: vi.fn(),
  sismember: vi.fn(),
  scard: vi.fn(),
  zadd: vi.fn(),
  zrem: vi.fn(),
  zcard: vi.fn(),
  zrange: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
} as unknown as Redis;

describe('Crawl Manager', () => {
  let manager: CrawlManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new CrawlManager(mockRedis);
  });

  describe('initCrawl', () => {
    it('should initialize crawl state', async () => {
      vi.mocked(mockRedis.setex).mockResolvedValue('OK');
      vi.mocked(mockRedis.expire).mockResolvedValue(1);

      await manager.initCrawl('source-1', 'tenant-1', 'https://example.com', {
        crawlSitemap: false,
        maxDepth: 2,
        maxPages: 10,
      });

      expect(mockRedis.setex).toHaveBeenCalled();
      const callArgs = vi.mocked(mockRedis.setex).mock.calls[0];
      expect(callArgs[0]).toContain('crawl:source-1:state');
      // setex(key, ttl, value) - state JSON is in callArgs[2]
      const state = JSON.parse(callArgs[2] as string);
      expect(state).toMatchObject({
        sourceId: 'source-1',
        tenantId: 'tenant-1',
        rootUrl: 'https://example.com',
        status: 'pending',
      });
    });
  });

  describe('addUrl', () => {
    it('should add URL to pending queue', async () => {
      vi.mocked(mockRedis.setex).mockResolvedValue('OK');
      vi.mocked(mockRedis.expire).mockResolvedValue(1);
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'pending',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 0,
          pagesCrawled: 0,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.sismember).mockResolvedValue(0); // Not visited
      vi.mocked(mockRedis.scard).mockResolvedValue(0); // No visited yet
      vi.mocked(mockRedis.zcard).mockResolvedValue(0); // No pending yet
      vi.mocked(mockRedis.zadd).mockResolvedValue(1);

      const added = await manager.addUrl('source-1', 'https://example.com/page1', 0);

      expect(added).toBe(true);
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining('crawl:pending:source-1'),
        0,
        'https://example.com/page1'
      );
    });

    it('should filter external URLs', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'pending',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 0,
          pagesCrawled: 0,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const added = await manager.addUrl('source-1', 'https://other.com/page', 0);

      expect(added).toBe(false);
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    });

    it('should respect depth limit', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'pending',
          options: { crawlSitemap: false, maxDepth: 1, maxPages: 10 },
          pagesDiscovered: 0,
          pagesCrawled: 0,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.sismember).mockResolvedValue(0);

      const added = await manager.addUrl('source-1', 'https://example.com/page', 2);

      expect(added).toBe(false); // Depth 2 > maxDepth 1
    });
  });

  describe('markVisited', () => {
    it('should mark URL as visited and remove from pending', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'running',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 1,
          pagesCrawled: 0,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.sadd).mockResolvedValue(1);
      vi.mocked(mockRedis.zrem).mockResolvedValue(1);
      vi.mocked(mockRedis.setex).mockResolvedValue('OK');
      vi.mocked(mockRedis.expire).mockResolvedValue(1);

      await manager.markVisited('source-1', 'https://example.com/page1');

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        expect.stringContaining('crawl:visited:source-1'),
        'https://example.com/page1'
      );
      expect(mockRedis.zrem).toHaveBeenCalledWith(
        expect.stringContaining('crawl:pending:source-1'),
        'https://example.com/page1'
      );
    });
  });

  describe('getNextUrl', () => {
    it('should return URL with lowest depth', async () => {
      vi.mocked(mockRedis.zrange).mockResolvedValue([
        'https://example.com/page1',
        '0', // depth
      ]);

      const next = await manager.getNextUrl('source-1');

      expect(next).toEqual({
        url: 'https://example.com/page1',
        depth: 0,
      });
    });

    it('should return null if no pending URLs', async () => {
      vi.mocked(mockRedis.zrange).mockResolvedValue([]);

      const next = await manager.getNextUrl('source-1');

      expect(next).toBeNull();
    });
  });

  describe('isComplete', () => {
    it('should return true when pending queue is empty', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'running',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 5,
          pagesCrawled: 5,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.zcard).mockResolvedValue(0); // No pending

      const complete = await manager.isComplete('source-1');

      expect(complete).toBe(true);
    });

    it('should return false when crawl is running with pending URLs', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'running',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 5,
          pagesCrawled: 3,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.zcard).mockResolvedValue(2); // 2 pending

      const complete = await manager.isComplete('source-1');

      expect(complete).toBe(false);
    });
  });

  describe('cancelCrawl', () => {
    it('should cancel running crawl', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(
        JSON.stringify({
          sourceId: 'source-1',
          tenantId: 'tenant-1',
          rootUrl: 'https://example.com',
          status: 'running',
          options: { crawlSitemap: false, maxDepth: 2, maxPages: 10 },
          pagesDiscovered: 5,
          pagesCrawled: 3,
          pagesErrored: 0,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      vi.mocked(mockRedis.setex).mockResolvedValue('OK');
      vi.mocked(mockRedis.expire).mockResolvedValue(1);

      await manager.cancelCrawl('source-1');

      expect(mockRedis.setex).toHaveBeenCalled();
      const callArgs = vi.mocked(mockRedis.setex).mock.calls[0];
      // setex(key, ttl, value) - state JSON is in callArgs[2]
      const state = JSON.parse(callArgs[2] as string);
      expect(state.status).toBe('cancelled');
    });
  });
});
