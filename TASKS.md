# Omniscient - Task Board

**Last Updated:** 2026-01-04
**Current Phase:** Phase 3 (Knowledge Expansion)

---

## TASK-008A: Create URL Knowledge Endpoint
**Priority:** P0 | **Estimate:** Medium | **Status:** Open

### Description
Create API endpoint for submitting URLs to crawl and ingest into knowledge base.

### Files to Modify
- `src/modules/knowledge/knowledge.routes.ts` - Add POST `/url` route
- `src/modules/knowledge/knowledge.controller.ts` - Add `crawlUrl` handler
- `src/modules/knowledge/knowledge.service.ts` - Add `createUrlSource()` function
- `src/modules/knowledge/knowledge.schema.ts` - Add `crawlUrlSchema`

### Schema Definition
```typescript
const crawlUrlSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  options: z.object({
    crawlSitemap: z.boolean().default(false),
    maxDepth: z.number().int().min(0).max(3).default(0),
    maxPages: z.number().int().min(1).max(100).default(10),
    includePatterns: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
  }).optional(),
});
```

### Endpoint
`POST /v1/knowledge/url`

### Flow
1. Validate URL format and options
2. Create KnowledgeSource with `type: 'URL'`, `sourceUrl` field, `status: 'PENDING'`
3. Queue `CRAWL_URL` job to `crawlQueue`
4. Return source ID immediately

### Reference
- Follow pattern in `knowledge.controller.ts` `uploadDocument()` handler
- Use existing `KnowledgeSourceType.URL` enum value
- Schema already has `sourceUrl` field

### Acceptance Criteria
- [ ] Endpoint accepts URL and optional crawl options
- [ ] Validates URL format (http/https only)
- [ ] Creates KnowledgeSource with status PENDING
- [ ] Queues job for async processing
- [ ] Returns `{ success: true, data: { sourceId, status, message } }`
- [ ] Rejects invalid URLs with 400 error

---

## TASK-008B: Implement Sitemap Parser
**Priority:** P0 | **Estimate:** Medium | **Status:** Open

### Description
Create sitemap parser to discover URLs from sitemap.xml files.

### Files to Create
- `src/modules/knowledge/crawlers/sitemap.parser.ts`
- `src/modules/knowledge/crawlers/crawl.types.ts`

### Interface
```typescript
// crawl.types.ts
export interface SitemapUrl {
  loc: string;
  lastmod?: Date;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export interface SitemapParserOptions {
  timeout?: number;
  maxUrls?: number;
  userAgent?: string;
}

// sitemap.parser.ts
export interface SitemapParser {
  parse(sitemapUrl: string, options?: SitemapParserOptions): Promise<SitemapUrl[]>;
  findSitemap(baseUrl: string): Promise<string | null>;
}
```

### Features
1. **Standard Sitemap Parsing**
   - Parse `sitemap.xml` format
   - Extract `<url>` elements with `<loc>`, `<lastmod>`, `<changefreq>`, `<priority>`

2. **Sitemap Index Support**
   - Detect `<sitemapindex>` root element
   - Recursively fetch nested sitemaps from `<sitemap><loc>` elements

3. **Gzip Support**
   - Handle `.xml.gz` compressed sitemaps
   - Decompress before parsing

4. **Discovery**
   - Check common locations: `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap/sitemap.xml`
   - Parse `robots.txt` for `Sitemap:` directives

### Dependencies
- Use `cheerio` for XML parsing (already in project)
- Use native `zlib` for gzip decompression

### Error Handling
- Timeout after 30 seconds
- Return empty array if sitemap not found (not an error)
- Log warnings for malformed entries, continue parsing

### Acceptance Criteria
- [ ] Parses standard sitemap.xml format
- [ ] Handles sitemap index files (nested sitemaps)
- [ ] Supports gzipped sitemaps (.xml.gz)
- [ ] Discovers sitemap from robots.txt
- [ ] Returns structured URL list with metadata
- [ ] Unit tests: `tests/unit/knowledge/sitemap.parser.test.ts`

---

## TASK-008C: Implement Crawl Manager
**Priority:** P0 | **Estimate:** Large | **Status:** Open

### Description
Create crawl state manager to orchestrate multi-page crawls with depth limiting and rate control.

### Files to Create
- `src/modules/knowledge/crawlers/crawl.manager.ts`

### Interface
```typescript
export interface CrawlOptions {
  maxDepth: number;           // 0 = single page, 1 = page + links, etc.
  maxPages: number;           // Total pages to crawl
  includePatterns?: string[]; // Regex patterns to include
  excludePatterns?: string[]; // Regex patterns to exclude
  respectRobots: boolean;     // Default true
  delayMs: number;            // Delay between requests (default 1000)
}

export interface CrawlState {
  sourceId: string;
  tenantId: string;
  rootUrl: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  options: CrawlOptions;
  visited: Set<string>;       // URLs already crawled
  pending: Map<string, number>; // URL -> depth
  failed: Map<string, string>;  // URL -> error message
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesErrored: number;
  startedAt: Date;
  updatedAt: Date;
}

export interface CrawlManager {
  initCrawl(sourceId: string, tenantId: string, rootUrl: string, options: CrawlOptions): Promise<void>;
  getState(sourceId: string): Promise<CrawlState | null>;
  addUrl(sourceId: string, url: string, depth: number): Promise<boolean>;
  markVisited(sourceId: string, url: string): Promise<void>;
  markFailed(sourceId: string, url: string, error: string): Promise<void>;
  getNextUrl(sourceId: string): Promise<{ url: string; depth: number } | null>;
  isComplete(sourceId: string): Promise<boolean>;
  cancelCrawl(sourceId: string): Promise<void>;
  cleanupCrawl(sourceId: string): Promise<void>;
}
```

### State Storage
Store crawl state in Redis with keys:
- `crawl:{sourceId}:state` - JSON of CrawlState (excluding Sets/Maps)
- `crawl:{sourceId}:visited` - Redis SET of visited URLs
- `crawl:{sourceId}:pending` - Redis ZSET (URL -> depth as score)
- `crawl:{sourceId}:failed` - Redis HASH (URL -> error)

TTL: 24 hours after last update

### URL Filtering
```typescript
shouldCrawl(url: string, baseUrl: string, options: CrawlOptions): boolean {
  // 1. Must be same domain as baseUrl
  // 2. Must match includePatterns (if specified)
  // 3. Must NOT match excludePatterns
  // 4. Must not be in visited set
  // 5. Must not exceed maxPages limit
}
```

### Reference
- Use `src/lib/redis.ts` for Redis client
- Pattern: similar to rate limiter in `src/jobs/rate-limiter.ts`

### Acceptance Criteria
- [ ] Initializes crawl state in Redis
- [ ] Tracks visited URLs (no duplicates)
- [ ] Respects depth and page limits
- [ ] Filters URLs by include/exclude patterns
- [ ] Provides next URL for processing
- [ ] Detects crawl completion
- [ ] Supports cancellation
- [ ] Cleans up state after completion
- [ ] Unit tests with Redis mock

---

## TASK-008D: Create Crawl Worker
**Priority:** P0 | **Estimate:** Medium | **Status:** Open
**Blocked By:** TASK-008A, TASK-008B, TASK-008C

### Description
Create BullMQ worker to process crawl jobs.

### Files to Create/Modify
- `src/jobs/workers/crawl.worker.ts` - New worker
- `src/jobs/queue.ts` - Add `crawlQueue`
- `src/jobs/jobs.types.ts` - Add crawl job types

### Job Types
```typescript
// jobs.types.ts
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
```

### Queue Setup
```typescript
// queue.ts
export const crawlQueue = new Queue('crawl-processing', { connection });
```

### Worker Flow

**CRAWL_URL Job (Initial):**
1. Initialize crawl state via CrawlManager
2. Update source status to `EXTRACTING`
3. If `options.crawlSitemap`:
   - Fetch sitemap using SitemapParser
   - Add all sitemap URLs to pending (depth 0)
4. Else:
   - Add root URL to pending (depth 0)
5. Queue first batch of `CRAWL_PAGE` jobs

**CRAWL_PAGE Job (Per Page):**
1. Check if crawl cancelled → skip
2. Check rate limit (1 req/sec per domain)
3. Fetch and extract using existing `urlProcessor`
4. Store extracted content (aggregate for later)
5. If depth < maxDepth:
   - Extract links from page
   - Filter and add new URLs via CrawlManager
   - Queue new `CRAWL_PAGE` jobs
6. Mark URL as visited
7. Check if crawl complete:
   - If yes: aggregate all content, queue embedding job
   - Update source status to `CHUNKING`

### Rate Limiting
- Use existing `checkRateLimit()` pattern from document worker
- Key: `crawl:ratelimit:{domain}`
- Limit: 1 request per second per domain

### Error Handling
- Page errors don't stop crawl
- Mark failed URLs in crawl state
- Max 3 retries per page
- 4xx errors: non-retryable (skip)
- 5xx/timeout: retryable

### Reference
- Pattern: `src/jobs/workers/document.worker.ts`
- Use `urlProcessor` from `src/modules/knowledge/processors/url.processor.ts`

### Acceptance Criteria
- [ ] Queue and worker created
- [ ] Processes CRAWL_URL jobs (sitemap or single URL)
- [ ] Processes CRAWL_PAGE jobs with depth tracking
- [ ] Respects rate limits per domain
- [ ] Discovers and queues new URLs
- [ ] Handles errors gracefully (continues crawl)
- [ ] Triggers chunking/embedding after completion
- [ ] Updates source status throughout

---

## TASK-008E: Enhance URL Processor
**Priority:** P1 | **Estimate:** Small | **Status:** Open

### Description
Add link extraction capability to existing URL processor for crawler.

### Files to Modify
- `src/modules/knowledge/processors/url.processor.ts`

### New Method
```typescript
/**
 * Extract internal links from HTML page
 */
extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseUrlObj = new URL(baseUrl);
  const links = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl);

      // Filter criteria:
      // 1. Same hostname
      if (absoluteUrl.hostname !== baseUrlObj.hostname) return;

      // 2. HTTP(S) only
      if (!['http:', 'https:'].includes(absoluteUrl.protocol)) return;

      // 3. Remove fragment
      absoluteUrl.hash = '';

      // 4. Normalize (lowercase hostname, remove trailing slash)
      const normalized = absoluteUrl.href.replace(/\/$/, '');

      links.add(normalized);
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}
```

### Additional Enhancements
1. **Canonical URL Detection**
   ```typescript
   getCanonicalUrl(html: string, pageUrl: string): string {
     const $ = cheerio.load(html);
     const canonical = $('link[rel="canonical"]').attr('href');
     return canonical ? new URL(canonical, pageUrl).href : pageUrl;
   }
   ```

2. **Better Content Detection**
   - Add support for `<section>`, `<div class="content">`, `<div id="content">`
   - Detect and skip navigation, footer, sidebar

3. **Metadata Enhancement**
   - Extract JSON-LD structured data
   - Extract OpenGraph tags more comprehensively

### Acceptance Criteria
- [ ] `extractLinks()` method added
- [ ] Returns only internal links (same domain)
- [ ] Handles relative URLs correctly
- [ ] Removes duplicates and fragments
- [ ] Canonical URL detection added
- [ ] Unit tests for link extraction

---

## TASK-008F: Add Crawl Status API
**Priority:** P1 | **Estimate:** Small | **Status:** Open
**Blocked By:** TASK-008D

### Description
Add endpoints to check crawl progress and cancel running crawls.

### Files to Modify
- `src/modules/knowledge/knowledge.routes.ts`
- `src/modules/knowledge/knowledge.controller.ts`
- `src/modules/knowledge/knowledge.service.ts`

### Endpoints

**GET /v1/knowledge/sources/:id/crawl-status**
```typescript
// Response
{
  "success": true,
  "data": {
    "sourceId": "uuid",
    "status": "running",
    "rootUrl": "https://example.com",
    "pagesDiscovered": 45,
    "pagesCrawled": 12,
    "pagesErrored": 2,
    "currentDepth": 1,
    "options": {
      "maxDepth": 2,
      "maxPages": 50
    },
    "startedAt": "2026-01-04T10:00:00Z",
    "updatedAt": "2026-01-04T10:05:00Z"
  }
}
```

**POST /v1/knowledge/sources/:id/cancel-crawl**
```typescript
// Response
{
  "success": true,
  "data": {
    "sourceId": "uuid",
    "status": "cancelled",
    "pagesCrawled": 12,
    "message": "Crawl cancelled. 12 pages were processed."
  }
}
```

### Implementation
- Use CrawlManager to get/update state
- Cancel clears pending queue and marks state cancelled
- Return 404 if source not found or not a URL type
- Return 400 if crawl not running (for cancel)

### Acceptance Criteria
- [ ] Status endpoint returns real-time crawl progress
- [ ] Cancel endpoint stops running crawl
- [ ] Proper error handling (404, 400)
- [ ] Works with tenant isolation

---

## TASK-008G: Crawl Integration Tests
**Priority:** P1 | **Estimate:** Medium | **Status:** Open
**Blocked By:** TASK-008A through TASK-008F

### Description
Create comprehensive tests for URL crawling functionality.

### Files to Create
- `tests/unit/knowledge/sitemap.parser.test.ts`
- `tests/unit/knowledge/crawl.manager.test.ts`
- `tests/unit/knowledge/url.processor.links.test.ts`
- `tests/integration/knowledge/url-crawl.test.ts`

### Unit Tests

**sitemap.parser.test.ts:**
- Parse standard sitemap.xml
- Parse sitemap index with nested sitemaps
- Handle gzipped sitemap
- Find sitemap from robots.txt
- Handle missing sitemap gracefully
- Handle malformed XML

**crawl.manager.test.ts:**
- Initialize crawl state
- Add and retrieve URLs
- Mark visited/failed
- Respect depth limits
- Respect page limits
- URL filtering (include/exclude patterns)
- Detect completion
- Handle cancellation

**url.processor.links.test.ts:**
- Extract internal links
- Ignore external links
- Handle relative URLs
- Remove fragments
- Deduplicate URLs
- Handle malformed hrefs

### Integration Tests

**url-crawl.test.ts:**
```typescript
describe('URL Crawl Integration', () => {
  // Setup: Create tenant, mock HTTP responses

  it('should crawl single URL', async () => {
    // POST /v1/knowledge/url with maxDepth: 0
    // Wait for processing
    // Verify source indexed with content
  });

  it('should crawl with sitemap', async () => {
    // Mock sitemap.xml response
    // POST /v1/knowledge/url with crawlSitemap: true
    // Verify all sitemap URLs processed
  });

  it('should respect depth limit', async () => {
    // Mock pages with links
    // POST /v1/knowledge/url with maxDepth: 1
    // Verify only 2 levels crawled
  });

  it('should respect page limit', async () => {
    // POST /v1/knowledge/url with maxPages: 5
    // Verify max 5 pages crawled
  });

  it('should filter URLs by pattern', async () => {
    // POST with includePatterns/excludePatterns
    // Verify filtering works
  });

  it('should report crawl status', async () => {
    // Start crawl
    // GET crawl-status
    // Verify progress reported
  });

  it('should cancel running crawl', async () => {
    // Start crawl
    // POST cancel-crawl
    // Verify stopped
  });

  it('should handle page errors gracefully', async () => {
    // Mock some 404 responses
    // Verify crawl continues, errors tracked
  });
});
```

### Mocking
- Mock HTTP responses with `nock` or similar
- Mock Redis for unit tests
- Use real Redis for integration tests (via docker)

### Acceptance Criteria
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Tests cover happy paths and error cases
- [ ] Mocking correctly isolates external dependencies
- [ ] Tests run in CI pipeline

---

## TASK-009: Implement Notion Connector
**Priority:** P2 | **Estimate:** Large | **Status:** Open (Phase 3)

### Description
Add ability to sync knowledge from Notion workspaces.

### Files to Create
- `src/modules/knowledge/connectors/notion.connector.ts`
- `src/modules/knowledge/connectors/connector.interface.ts`

### Requirements
1. OAuth integration with Notion API
2. List accessible pages/databases
3. Extract page content as text
4. Handle Notion block types (paragraphs, lists, tables, etc.)
5. Track sync state for incremental updates
6. Store connection credentials securely (encrypted)

### API Endpoints
- `POST /v1/knowledge/connect/notion` - Start OAuth flow
- `GET /v1/knowledge/connect/notion/callback` - OAuth callback
- `POST /v1/knowledge/sources/:id/sync` - Trigger manual sync

### Acceptance Criteria
- [ ] OAuth flow works
- [ ] Pages extracted as text
- [ ] Incremental sync supported
- [ ] Integration tests with mocked Notion API

---

## TASK-010: Implement Sync Scheduling
**Priority:** P2 | **Estimate:** Medium | **Status:** Open (Phase 3)

### Description
Add cron-based scheduling for external source synchronization.

### Files to Create/Modify
- `src/jobs/workers/sync.worker.ts` (enhance)
- `src/jobs/scheduler.ts` (new)

### Requirements
1. Configure sync frequency per source (hourly, daily, weekly)
2. Add sync schedule to `KnowledgeSource` model
3. Create scheduler that queues sync jobs
4. Handle overlapping syncs (skip if already running)
5. Track last sync time and status

### Database Changes
```prisma
// Add to KnowledgeSource model
syncSchedule    String?    // cron expression
lastSyncStatus  String?    // success, failed, in_progress
nextSyncAt      DateTime?
```

### Acceptance Criteria
- [ ] Scheduler runs on configurable interval
- [ ] Sync jobs queued per schedule
- [ ] No duplicate syncs for same source
- [ ] Sync status tracked and queryable

---

## Task Dependencies

```
TASK-008A (endpoint) ──────┐
TASK-008B (sitemap) ───────┼─→ TASK-008D (worker) ──→ TASK-008F (status API)
TASK-008C (crawl manager) ─┘           │                      │
                                       ↓                      ↓
TASK-008E (enhance processor) ←────────┴──────────→ TASK-008G (tests)

TASK-009 (Notion) ─────┐
                       ├─→ Phase 3 Complete
TASK-010 (Scheduling) ─┘
```

**Parallel Work:**
- TASK-008A, 008B, 008C can start simultaneously
- TASK-008E can be done anytime
- TASK-008D requires 008A, 008B, 008C
- TASK-008F requires 008D
- TASK-008G requires all 008 tasks

---

## Assignment Template

When assigning a task, include:
```
Task: TASK-XXX
Assignee: [agent/developer]
Due: [date if applicable]
Notes: [any additional context]
```
