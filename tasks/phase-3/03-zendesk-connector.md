# Task 03: Zendesk Connector

## Overview

Implement a Zendesk connector that can fetch help center articles and sync them to the knowledge base.

## Current State

The database schema supports `ZENDESK` as a `KnowledgeSourceType`, but there's no implementation for connecting to or syncing from Zendesk.

## Objectives

1. Create a Zendesk API client for fetching articles
2. Implement article extraction and processing
3. Support incremental sync (only fetch changed articles)
4. Store connector credentials securely

## Files to Create/Modify

### New Files

```
src/modules/knowledge/connectors/connector.interface.ts
src/modules/knowledge/connectors/zendesk.connector.ts
src/modules/knowledge/connectors/index.ts
src/jobs/workers/sync.worker.ts
tests/unit/knowledge/zendesk.connector.test.ts
tests/fixtures/zendesk.fixtures.ts
```

### Modified Files

```
src/modules/knowledge/knowledge.service.ts    # Add connector support
src/modules/knowledge/knowledge.routes.ts     # Add connect endpoint
src/modules/knowledge/knowledge.schema.ts     # Add connector schemas
src/config/env.ts                             # Add Zendesk config (optional)
package.json                                  # Add dependencies
```

## Implementation Details

### 1. Connector Interface (`connector.interface.ts`)

```typescript
export interface ConnectorCredentials {
  [key: string]: string | number | boolean;
}

export interface ConnectorConfig {
  type: KnowledgeSourceType;
  credentials: ConnectorCredentials;
  settings?: Record<string, unknown>;
}

export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  errors: string[];
  lastSyncedAt: Date;
}

export interface FetchedArticle {
  externalId: string;
  title: string;
  content: string;          // HTML or plain text
  url: string;
  section?: string;
  category?: string;
  labels?: string[];
  author?: string;
  createdAt: Date;
  updatedAt: Date;
  checksum: string;         // For change detection
}

export interface Connector {
  readonly type: KnowledgeSourceType;

  // Test connection with credentials
  testConnection(credentials: ConnectorCredentials): Promise<boolean>;

  // Fetch all articles (for initial sync)
  fetchAll(credentials: ConnectorCredentials): AsyncGenerator<FetchedArticle>;

  // Fetch only changed articles (for incremental sync)
  fetchSince(credentials: ConnectorCredentials, since: Date): AsyncGenerator<FetchedArticle>;

  // Get article count (for progress tracking)
  getArticleCount(credentials: ConnectorCredentials): Promise<number>;
}
```

### 2. Zendesk Connector (`zendesk.connector.ts`)

```typescript
import type { Connector, ConnectorCredentials, FetchedArticle } from './connector.interface.js';
import { createHash } from 'crypto';

interface ZendeskCredentials extends ConnectorCredentials {
  subdomain: string;
  email: string;
  apiToken: string;
}

interface ZendeskArticle {
  id: number;
  title: string;
  body: string;
  html_url: string;
  section_id: number;
  author_id: number;
  label_names: string[];
  created_at: string;
  updated_at: string;
}

export class ZendeskConnector implements Connector {
  readonly type = 'ZENDESK';

  private getBaseUrl(subdomain: string): string {
    return `https://${subdomain}.zendesk.com/api/v2`;
  }

  private getAuthHeader(credentials: ZendeskCredentials): string {
    const auth = Buffer.from(`${credentials.email}/token:${credentials.apiToken}`).toString('base64');
    return `Basic ${auth}`;
  }

  async testConnection(credentials: ConnectorCredentials): Promise<boolean> {
    const creds = credentials as ZendeskCredentials;
    const url = `${this.getBaseUrl(creds.subdomain)}/users/me.json`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: this.getAuthHeader(creds) },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *fetchAll(credentials: ConnectorCredentials): AsyncGenerator<FetchedArticle> {
    const creds = credentials as ZendeskCredentials;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${this.getBaseUrl(creds.subdomain)}/help_center/articles.json?page=${page}&per_page=100`;
      const response = await fetch(url, {
        headers: { Authorization: this.getAuthHeader(creds) },
      });

      if (!response.ok) {
        throw new Error(`Zendesk API error: ${response.status}`);
      }

      const data = await response.json();
      const articles: ZendeskArticle[] = data.articles || [];

      for (const article of articles) {
        yield this.transformArticle(article);
      }

      hasMore = data.next_page !== null;
      page++;

      // Rate limiting delay
      await this.delay(100);
    }
  }

  async *fetchSince(credentials: ConnectorCredentials, since: Date): AsyncGenerator<FetchedArticle> {
    const creds = credentials as ZendeskCredentials;
    const sinceISO = since.toISOString();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${this.getBaseUrl(creds.subdomain)}/help_center/incremental/articles.json?start_time=${Math.floor(since.getTime() / 1000)}`;
      const response = await fetch(url, {
        headers: { Authorization: this.getAuthHeader(creds) },
      });

      if (!response.ok) {
        throw new Error(`Zendesk API error: ${response.status}`);
      }

      const data = await response.json();
      const articles: ZendeskArticle[] = data.articles || [];

      for (const article of articles) {
        yield this.transformArticle(article);
      }

      hasMore = data.end_of_stream === false;
      page++;

      await this.delay(100);
    }
  }

  async getArticleCount(credentials: ConnectorCredentials): Promise<number> {
    const creds = credentials as ZendeskCredentials;
    const url = `${this.getBaseUrl(creds.subdomain)}/help_center/articles/count.json`;

    const response = await fetch(url, {
      headers: { Authorization: this.getAuthHeader(creds) },
    });

    if (!response.ok) {
      throw new Error(`Zendesk API error: ${response.status}`);
    }

    const data = await response.json();
    return data.count?.value || 0;
  }

  private transformArticle(article: ZendeskArticle): FetchedArticle {
    // Strip HTML for plain text content
    const plainText = this.stripHtml(article.body);

    return {
      externalId: article.id.toString(),
      title: article.title,
      content: plainText,
      url: article.html_url,
      labels: article.label_names,
      createdAt: new Date(article.created_at),
      updatedAt: new Date(article.updated_at),
      checksum: this.calculateChecksum(article.body),
    };
  }

  private stripHtml(html: string): string {
    // Use cheerio or regex to strip HTML
    return html.replace(/<[^>]*>/g, '').trim();
  }

  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3. Sync Worker (`sync.worker.ts`)

```typescript
import { Worker } from 'bullmq';
import { ZendeskConnector } from '../modules/knowledge/connectors/zendesk.connector.js';
import { prisma } from '../lib/prisma.js';
import { decryptJson } from '../utils/crypto.js';

const syncWorker = new Worker('external-sync', async (job) => {
  const { sourceId, tenantId, type } = job.data;

  // Get source with credentials
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // Decrypt credentials
  const credentials = decryptJson(source.credentials as string);

  // Get connector
  const connector = getConnector(type);

  // Determine if full or incremental sync
  const since = source.lastSyncedAt;
  const articles = since
    ? connector.fetchSince(credentials, since)
    : connector.fetchAll(credentials);

  let added = 0, updated = 0;

  for await (const article of articles) {
    // Check if article exists
    const existing = await prisma.knowledgeChunk.findFirst({
      where: {
        sourceId,
        metadata: { path: ['externalId'], equals: article.externalId },
      },
    });

    if (existing) {
      // Check if changed
      if (existing.metadata?.checksum !== article.checksum) {
        await updateArticle(sourceId, article);
        updated++;
      }
    } else {
      await addArticle(sourceId, article);
      added++;
    }
  }

  // Update last synced timestamp
  await prisma.knowledgeSource.update({
    where: { id: sourceId },
    data: { lastSyncedAt: new Date() },
  });

  return { added, updated };
}, { connection: redisConnection, concurrency: 1 });
```

### 4. Knowledge Service Updates

```typescript
// In knowledge.service.ts

export async function connectSource(
  tenantId: string,
  type: KnowledgeSourceType,
  name: string,
  credentials: ConnectorCredentials
): Promise<KnowledgeSource> {
  // 1. Get connector for type
  const connector = getConnector(type);

  // 2. Test connection
  const isValid = await connector.testConnection(credentials);
  if (!isValid) {
    throw new Error('Failed to connect: Invalid credentials');
  }

  // 3. Encrypt credentials
  const encryptedCredentials = encryptJson(credentials);

  // 4. Create source record
  const source = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      name,
      type,
      credentials: encryptedCredentials,
      status: 'PENDING',
    },
  });

  // 5. Queue initial sync
  await syncQueue.add('SYNC_EXTERNAL', {
    sourceId: source.id,
    tenantId,
    type,
  });

  return source;
}
```

### 5. API Endpoint

```typescript
// In knowledge.routes.ts

fastify.post<{
  Body: {
    type: 'ZENDESK' | 'NOTION';
    name: string;
    credentials: Record<string, string>;
  };
}>('/connect', {
  schema: connectSourceSchema,
  preHandler: [authenticate],
}, async (request, reply) => {
  const source = await connectSource(
    request.tenant.id,
    request.body.type,
    request.body.name,
    request.body.credentials
  );
  return reply.status(201).send({ success: true, data: source });
});
```

## Zendesk API Reference

### Authentication
- Uses Basic Auth with email/token: `{email}/token:{api_token}`
- Rate limit: 400 requests per minute

### Endpoints Used
- `GET /api/v2/users/me.json` - Test connection
- `GET /api/v2/help_center/articles.json` - List articles (paginated)
- `GET /api/v2/help_center/incremental/articles.json` - Incremental export
- `GET /api/v2/help_center/articles/count.json` - Article count

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "cheerio": "^1.0.0-rc.12"  // For HTML stripping (shared with URL crawler)
  }
}
```

Note: Using native `fetch` instead of a Zendesk SDK for simplicity and fewer dependencies.

## Acceptance Criteria

- [ ] Zendesk credentials can be validated (test connection)
- [ ] All articles can be fetched (initial sync)
- [ ] Changed articles can be fetched (incremental sync)
- [ ] Articles are converted to plain text
- [ ] Credentials are encrypted at rest
- [ ] Rate limiting is respected
- [ ] Sync progress is tracked
- [ ] Errors are handled gracefully
- [ ] API endpoint works for connecting Zendesk

## Test Cases

1. **Valid credentials test**
2. **Invalid credentials test**
3. **Fetch all articles**
4. **Incremental sync**
5. **Rate limiting handling**
6. **API error handling (401, 404, 500)**
7. **Empty help center handling**
8. **Large article set pagination**
9. **HTML stripping**
10. **Checksum-based change detection**

## Security Considerations

- [ ] Store credentials encrypted (AES-256)
- [ ] Never log credentials
- [ ] Mask credentials in API responses
- [ ] Validate subdomain format
- [ ] Handle token expiration gracefully

## Estimated Complexity

**Medium** - Straightforward API integration but requires careful sync logic.
