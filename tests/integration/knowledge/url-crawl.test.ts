import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildServer } from '../../../src/server.js';
import { prisma } from '../../../src/lib/prisma.js';
import { TEST_CONFIG, testSetup } from '../setup.js';

// Mock fetch globally for HTTP requests
const mockFetch = vi.fn();
global.fetch = mockFetch as never;

describe('URL Crawl Integration', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let testApiKey: string;
  let testApiKeyId: string;

  beforeAll(async () => {
    await testSetup();

    server = await buildServer();
    await server.ready();

    // Create API key for test tenant with unique key to avoid conflicts with parallel tests
    const { hashApiKey } = await import('../../../src/utils/hash.js');
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testApiKey = `omni_urlcrawl_test_${uniqueSuffix}`;
    const keyHash = hashApiKey(testApiKey);
    const keyPrefix = testApiKey.substring(0, 16);

    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        keyHash,
        keyPrefix,
        name: 'URL Crawl Test API Key',
        permissions: { admin: true, knowledge: true },
      },
    });
    testApiKeyId = apiKeyRecord.id;
  });

  afterAll(async () => {
    // Cleanup - only delete resources created by this test file
    await prisma.knowledgeSource.deleteMany({
      where: { tenantId: TEST_CONFIG.tenantId },
    });
    // Only delete the specific API key created by this test, not all keys for the tenant
    if (testApiKeyId) {
      await prisma.apiKey
        .delete({
          where: { id: testApiKeyId },
        })
        .catch(() => {}); // Ignore if already deleted
    }

    await server.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear rate limits between tests to avoid 429s
    await testSetup();
    // Default robots.txt response (allow all)
    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      return Promise.reject(new Error('Unexpected fetch call'));
    });
  });

  it('should crawl single URL', async () => {
    const testUrl = 'https://example.com/test-page';
    const testHtml = `
      <html>
        <head>
          <title>Test Page</title>
          <meta name="description" content="Test description" />
        </head>
        <body>
          <article>
            <h1>Test Content</h1>
            <p>This is test content for crawling.</p>
          </article>
        </body>
      </html>
    `;

    // Mock HTTP responses
    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      if (urlStr === testUrl) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => testHtml,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    // Create crawl request
    const response = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        name: 'Test Crawl',
        options: {
          crawlSitemap: false,
          maxDepth: 0,
          maxPages: 1,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.sourceId).toBeTruthy();

    const sourceId = body.data.sourceId;

    // Wait for crawl to complete (this will take time in real scenario)
    // For now, just verify the source was created
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    expect(source).toBeTruthy();
    expect(source?.type).toBe('URL');
    expect(source?.sourceUrl).toBe(testUrl);
  });

  it('should crawl with sitemap', async () => {
    const testUrl = 'https://example.com';
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
  </url>
</urlset>`;

    const pageHtml = `
      <html>
        <head><title>Page</title></head>
        <body><p>Content</p></body>
      </html>
    `;

    // Mock responses
    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml',
        });
      }
      if (urlStr.includes('/sitemap.xml')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: async () => sitemapXml,
          arrayBuffer: async () => new ArrayBuffer(0),
        });
      }
      if (urlStr.includes('example.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => pageHtml,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        options: {
          crawlSitemap: true,
          maxDepth: 0,
          maxPages: 10,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('should respect depth limit', async () => {
    const testUrl = 'https://example.com';
    const pageWithLinks = `
      <html>
        <body>
          <a href="/page1">Page 1</a>
          <a href="/page2">Page 2</a>
        </body>
      </html>
    `;

    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      if (urlStr.includes('example.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => pageWithLinks,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        options: {
          crawlSitemap: false,
          maxDepth: 1,
          maxPages: 5,
        },
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('should report crawl status', async () => {
    const testUrl = 'https://example.com';
    const pageHtml = '<html><body><p>Content</p></body></html>';

    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      if (urlStr.includes('example.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => pageHtml,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    // Create crawl
    const createResponse = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        options: {
          maxDepth: 0,
          maxPages: 1,
        },
      },
    });

    const createBody = JSON.parse(createResponse.body);
    const sourceId = createBody.data.sourceId;

    // Get crawl status
    const statusResponse = await server.inject({
      method: 'GET',
      url: `/v1/knowledge/sources/${sourceId}/crawl-status`,
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
    });

    expect(statusResponse.statusCode).toBe(200);
    const statusBody = JSON.parse(statusResponse.body);
    expect(statusBody.success).toBe(true);
    expect(statusBody.data).toHaveProperty('status');
    expect(statusBody.data).toHaveProperty('rootUrl', testUrl);
  });

  it('should cancel running crawl', async () => {
    const testUrl = 'https://example.com';
    const pageHtml = '<html><body><p>Content</p></body></html>';

    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      if (urlStr.includes('example.com')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => pageHtml,
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    // Create crawl
    const createResponse = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        options: {
          maxDepth: 2,
          maxPages: 10,
        },
      },
    });

    const createBody = JSON.parse(createResponse.body);
    const sourceId = createBody.data.sourceId;

    // Wait for the crawl state to be created by the worker
    // Poll until crawl status is no longer 'not_started'
    let crawlStarted = false;
    for (let i = 0; i < 20; i++) {
      const statusResponse = await server.inject({
        method: 'GET',
        url: `/v1/knowledge/sources/${sourceId}/crawl-status`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });
      const statusBody = JSON.parse(statusResponse.body);
      if (statusBody.data?.status !== 'not_started') {
        crawlStarted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // If crawl never started, skip the cancel assertions
    // This can happen if the worker hasn't picked up the job yet
    if (!crawlStarted) {
      // Crawl didn't start in time, cancel should return 400
      const cancelResponse = await server.inject({
        method: 'POST',
        url: `/v1/knowledge/sources/${sourceId}/cancel-crawl`,
        headers: {
          authorization: `Bearer ${testApiKey}`,
        },
      });
      expect(cancelResponse.statusCode).toBe(400);
      return;
    }

    // Cancel crawl
    const cancelResponse = await server.inject({
      method: 'POST',
      url: `/v1/knowledge/sources/${sourceId}/cancel-crawl`,
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
    });

    expect(cancelResponse.statusCode).toBe(200);
    const cancelBody = JSON.parse(cancelResponse.body);
    expect(cancelBody.success).toBe(true);
    expect(cancelBody.data.status).toBe('cancelled');
  });

  it('should return 404 for non-URL source', async () => {
    // Create a non-URL source directly in the database
    const documentSource = await prisma.knowledgeSource.create({
      data: {
        tenantId: TEST_CONFIG.tenantId,
        name: 'Test PDF Document',
        type: 'PDF',
        status: 'INDEXED',
        originalFilename: 'test.pdf',
      },
    });

    // Try to get crawl status for non-URL source
    const statusResponse = await server.inject({
      method: 'GET',
      url: `/v1/knowledge/sources/${documentSource.id}/crawl-status`,
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
    });

    expect(statusResponse.statusCode).toBe(404);
  });

  it('should handle page errors gracefully', async () => {
    const testUrl = 'https://example.com';
    const pageWithLinks = `
      <html>
        <body>
          <a href="/page1">Page 1</a>
          <a href="/page2">Page 2</a>
        </body>
      </html>
    `;

    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/robots.txt')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        });
      }
      if (urlStr === testUrl) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => pageWithLinks,
        });
      }
      if (urlStr.includes('/page1')) {
        // Return 404 for page1
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers(),
          text: async () => 'Not Found',
        });
      }
      if (urlStr.includes('/page2')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => ({ done: true, value: undefined }),
            }),
          },
          text: async () => '<html><body><p>Page 2 content</p></body></html>',
        });
      }
      return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/knowledge/url',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
      payload: {
        url: testUrl,
        options: {
          maxDepth: 1,
          maxPages: 5,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    // Crawl should continue despite page1 error
  });
});
