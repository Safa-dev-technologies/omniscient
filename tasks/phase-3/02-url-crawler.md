# Task 02: URL Crawler

## Overview

Implement a URL crawler that can fetch web pages, extract meaningful content, and process them for the knowledge base.

## Current State

The database schema supports `URL` as a `KnowledgeSourceType`, but there's no implementation for fetching or processing web content.

## Objectives

1. Create a URL processor that fetches and extracts web content
2. Handle HTML parsing and content extraction
3. Support single-page and multi-page crawling
4. Respect robots.txt and rate limiting

## Files to Create/Modify

### New Files

```
src/modules/knowledge/processors/url.processor.ts
src/modules/knowledge/crawlers/web.crawler.ts
src/modules/knowledge/crawlers/crawler.interface.ts
src/modules/knowledge/crawlers/index.ts
tests/unit/knowledge/url.processor.test.ts
tests/unit/knowledge/web.crawler.test.ts
tests/fixtures/url.fixtures.ts
```

### Modified Files

```
src/modules/knowledge/processors/index.ts     # Export URL processor
src/modules/knowledge/knowledge.service.ts    # Add URL source support
src/modules/knowledge/knowledge.routes.ts     # Add URL endpoint
src/modules/knowledge/knowledge.schema.ts     # Add URL validation schema
package.json                                  # Add dependencies
```

## Implementation Details

### 1. Crawler Interface (`crawler.interface.ts`)

```typescript
export interface CrawlerOptions {
  maxPages?: number;           // Limit pages to crawl
  maxDepth?: number;           // Link traversal depth
  followLinks?: boolean;       // Follow internal links
  includePatterns?: string[];  // URL patterns to include
  excludePatterns?: string[];  // URL patterns to exclude
  respectRobotsTxt?: boolean;  // Honor robots.txt
  userAgent?: string;          // Custom user agent
  timeout?: number;            // Request timeout in ms
  delay?: number;              // Delay between requests in ms
}

export interface CrawledPage {
  url: string;
  title: string;
  content: string;           // Extracted text content
  html?: string;             // Raw HTML (optional)
  metadata: {
    description?: string;
    keywords?: string[];
    author?: string;
    publishedAt?: Date;
    lastModified?: Date;
  };
  links: string[];           // Discovered links
  statusCode: number;
  crawledAt: Date;
}

export interface Crawler {
  crawl(url: string, options?: CrawlerOptions): AsyncGenerator<CrawledPage>;
  canCrawl(url: string): Promise<boolean>;  // Check robots.txt
}
```

### 2. Web Crawler (`web.crawler.ts`)

```typescript
import type { Crawler, CrawlerOptions, CrawledPage } from './crawler.interface.js';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';

export class WebCrawler implements Crawler {
  private robotsCache = new Map<string, any>();

  async *crawl(startUrl: string, options?: CrawlerOptions): AsyncGenerator<CrawledPage> {
    // 1. Validate URL (no internal IPs, localhost)
    // 2. Check robots.txt
    // 3. Fetch page with timeout
    // 4. Parse HTML with cheerio
    // 5. Extract content (remove nav, footer, ads)
    // 6. Extract links if following
    // 7. Yield page result
    // 8. Continue to next page with delay
  }

  async canCrawl(url: string): Promise<boolean> {
    // Check robots.txt for the domain
  }

  private extractContent($: cheerio.CheerioAPI): string {
    // Remove non-content elements
    $('script, style, nav, footer, header, aside, .ads, .sidebar').remove();

    // Extract main content
    const main = $('main, article, .content, #content').first();
    if (main.length) {
      return main.text().trim();
    }

    return $('body').text().trim();
  }

  private validateUrl(url: string): void {
    // Prevent SSRF attacks
    const parsed = new URL(url);

    // Block internal IPs
    if (this.isInternalIP(parsed.hostname)) {
      throw new Error('Internal URLs are not allowed');
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS URLs are allowed');
    }
  }
}
```

### 3. URL Processor (`url.processor.ts`)

```typescript
import type { DocumentProcessor, ExtractedDocument, ProcessorOptions } from './processor.interface.js';
import { WebCrawler } from '../crawlers/web.crawler.js';

interface URLProcessorOptions extends ProcessorOptions {
  crawlOptions?: CrawlerOptions;
}

export class URLProcessor implements DocumentProcessor {
  private crawler = new WebCrawler();

  // URL processor doesn't use buffer, it fetches from URL
  canProcess(mimeType: string): boolean {
    return mimeType === 'text/uri-list' || mimeType === 'application/x-url';
  }

  async extractFromUrl(url: string, options?: URLProcessorOptions): Promise<ExtractedDocument> {
    const pages: CrawledPage[] = [];

    for await (const page of this.crawler.crawl(url, options?.crawlOptions)) {
      pages.push(page);
    }

    // Combine all pages into single document
    const combinedText = pages
      .map(p => `# ${p.title}\n\n${p.content}`)
      .join('\n\n---\n\n');

    return {
      text: combinedText,
      metadata: {
        pageCount: pages.length,
        title: pages[0]?.title,
        urls: pages.map(p => p.url),
      },
      pages: pages.map(p => ({
        pageNumber: pages.indexOf(p) + 1,
        content: p.content,
        metadata: p.metadata,
      })),
    };
  }
}
```

### 4. Knowledge Service Updates

```typescript
// In knowledge.service.ts

export async function createUrlSource(
  tenantId: string,
  url: string,
  name: string,
  options?: URLSourceOptions
): Promise<KnowledgeSource> {
  // 1. Validate URL
  // 2. Create source record with type: URL
  // 3. Queue crawl job
  // 4. Return source
}
```

### 5. New API Endpoint

```typescript
// In knowledge.routes.ts

fastify.post<{
  Body: { url: string; name: string; options?: URLSourceOptions };
}>('/url', {
  schema: createUrlSourceSchema,
  preHandler: [authenticate],
}, async (request, reply) => {
  const source = await createUrlSource(
    request.tenant.id,
    request.body.url,
    request.body.name,
    request.body.options
  );
  return reply.status(201).send({ success: true, data: source });
});
```

## Content Extraction Strategy

### Elements to Remove
- `<script>`, `<style>` - Code
- `<nav>`, `<header>`, `<footer>` - Navigation
- `<aside>`, `.sidebar` - Sidebars
- `.ads`, `.advertisement` - Ads
- `.comments`, `#comments` - Comments
- `.social-share` - Social buttons

### Elements to Prioritize
- `<main>`, `<article>` - Main content
- `.content`, `#content` - Content areas
- `<h1>` - `<h6>` - Headings (preserve structure)
- `<p>` - Paragraphs
- `<ul>`, `<ol>`, `<li>` - Lists

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "cheerio": "^1.0.0-rc.12",
    "robots-parser": "^3.0.1"
  },
  "devDependencies": {
    "@types/robots-parser": "^3.0.0"
  }
}
```

## Acceptance Criteria

- [ ] Single URL can be fetched and content extracted
- [ ] Multi-page crawling works with depth limit
- [ ] robots.txt is respected
- [ ] Rate limiting is applied between requests
- [ ] Internal IPs and localhost are blocked (SSRF prevention)
- [ ] HTML content is cleaned (scripts, styles removed)
- [ ] Main content is extracted intelligently
- [ ] Metadata is extracted (title, description, author)
- [ ] Links are discovered for follow-up crawling
- [ ] Timeout handling works correctly
- [ ] API endpoint accepts URL sources

## Test Cases

1. **Single page crawl**
2. **Multi-page crawl with depth limit**
3. **robots.txt blocking**
4. **SSRF prevention (localhost, internal IPs)**
5. **Timeout handling**
6. **Invalid URL handling**
7. **404/500 error handling**
8. **Content extraction from various layouts**
9. **Metadata extraction**
10. **Rate limiting between requests**

## Security Considerations

- [ ] Validate URLs before crawling (no SSRF)
- [ ] Block internal IPs (10.x, 172.16.x, 192.168.x, 127.x)
- [ ] Block localhost and local domains
- [ ] Limit redirect following
- [ ] Set reasonable timeouts
- [ ] Rate limit requests
- [ ] Sanitize extracted content
- [ ] Limit total crawled pages per source

## Estimated Complexity

**Medium** - Requires careful security handling and content extraction logic.
