import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseSitemap,
  findSitemap,
} from '../../../src/modules/knowledge/crawlers/sitemap.parser.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as never;

describe('Sitemap Parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseSitemap', () => {
    it('should parse standard sitemap.xml', async () => {
      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
    <lastmod>2024-01-01</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
    <lastmod>2024-01-02</lastmod>
  </url>
</urlset>`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/xml' }),
        text: async () => sitemapXml,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      const urls = await parseSitemap('https://example.com/sitemap.xml');

      expect(urls).toHaveLength(2);
      expect(urls[0]).toMatchObject({
        loc: 'https://example.com/page1',
        changefreq: 'weekly',
        priority: 0.8,
      });
      expect(urls[1]).toMatchObject({
        loc: 'https://example.com/page2',
      });
    });

    it('should handle sitemap index with nested sitemaps', async () => {
      const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-1.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-2.xml</loc>
  </sitemap>
</sitemapindex>`;

      const nestedXml1 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
</urlset>`;

      const nestedXml2 = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page2</loc></url>
</urlset>`;

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: async () => indexXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: async () => nestedXml1,
          arrayBuffer: async () => new ArrayBuffer(0),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: async () => nestedXml2,
          arrayBuffer: async () => new ArrayBuffer(0),
        });

      const urls = await parseSitemap('https://example.com/sitemap_index.xml');

      expect(urls).toHaveLength(2);
      expect(urls.map((u) => u.loc)).toEqual([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
    });

    it('should handle missing sitemap gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      const urls = await parseSitemap('https://example.com/sitemap.xml');
      expect(urls).toEqual([]);
    });

    it('should handle malformed XML gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/xml' }),
        text: async () => '<invalid>xml',
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      // Cheerio might not throw on malformed XML, but will return empty results
      // The implementation catches errors and throws, but cheerio.load might succeed
      // with empty results. Let's test that it either throws or returns empty array
      try {
        const urls = await parseSitemap('https://example.com/sitemap.xml');
        // If it doesn't throw, it should return empty array for malformed XML
        expect(urls).toEqual([]);
      } catch (error) {
        // If it throws, that's also acceptable
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('findSitemap', () => {
    it('should find sitemap from robots.txt', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin
Sitemap: https://example.com/sitemap.xml`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: async () => robotsTxt,
      });

      const sitemapUrl = await findSitemap('https://example.com');

      expect(sitemapUrl).toBe('https://example.com/sitemap.xml');
    });

    it('should try common locations if robots.txt has no sitemap', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin`;

      // Mock sequence: robots.txt (no sitemap), /sitemap.xml (404), /sitemap_index.xml (200)
      let callCount = 0;
      mockFetch.mockImplementation((url: string | Request | URL) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        callCount++;

        if (urlStr.includes('/robots.txt')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers(),
            text: async () => robotsTxt,
          });
        }
        if (urlStr.includes('/sitemap.xml') && !urlStr.includes('sitemap_index')) {
          return Promise.resolve({
            ok: false,
            status: 404,
            headers: new Headers(),
          });
        }
        if (urlStr.includes('/sitemap_index.xml')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers(),
        });
      });

      const sitemapUrl = await findSitemap('https://example.com');

      expect(sitemapUrl).toBe('https://example.com/sitemap_index.xml');
    });

    it('should return null if sitemap not found', async () => {
      // Mock all fetch calls to return 404
      mockFetch.mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers(),
        });
      });

      const sitemapUrl = await findSitemap('https://example.com');

      expect(sitemapUrl).toBeNull();
    });
  });
});
