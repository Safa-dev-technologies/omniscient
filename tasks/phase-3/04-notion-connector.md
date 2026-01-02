# Task 04: Notion Connector

## Overview

Implement a Notion connector that can fetch pages and databases from a Notion workspace and sync them to the knowledge base.

## Current State

The database schema supports `NOTION` as a `KnowledgeSourceType`, but there's no implementation for connecting to or syncing from Notion.

## Objectives

1. Create a Notion API client using the official SDK
2. Implement page and database content extraction
3. Handle Notion's block-based content structure
4. Support incremental sync based on last_edited_time

## Files to Create/Modify

### New Files

```
src/modules/knowledge/connectors/notion.connector.ts
tests/unit/knowledge/notion.connector.test.ts
tests/fixtures/notion.fixtures.ts
```

### Modified Files

```
src/modules/knowledge/connectors/index.ts         # Export Notion connector
src/modules/knowledge/knowledge.service.ts        # Add Notion support
src/jobs/workers/sync.worker.ts                   # Add Notion sync handling
package.json                                      # Add Notion SDK
```

## Implementation Details

### 1. Notion Connector (`notion.connector.ts`)

```typescript
import { Client } from '@notionhq/client';
import type { Connector, ConnectorCredentials, FetchedArticle } from './connector.interface.js';
import { createHash } from 'crypto';

interface NotionCredentials extends ConnectorCredentials {
  apiKey: string;
  rootPageId?: string;    // Optional: specific page/database to sync
}

interface NotionPage {
  id: string;
  title: string;
  content: string;
  url: string;
  parentType: 'page' | 'database' | 'workspace';
  parentId?: string;
  createdTime: string;
  lastEditedTime: string;
  createdBy?: string;
}

export class NotionConnector implements Connector {
  readonly type = 'NOTION';

  private getClient(credentials: NotionCredentials): Client {
    return new Client({ auth: credentials.apiKey });
  }

  async testConnection(credentials: ConnectorCredentials): Promise<boolean> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    try {
      // List users to test connection
      await client.users.list({});
      return true;
    } catch {
      return false;
    }
  }

  async *fetchAll(credentials: ConnectorCredentials): AsyncGenerator<FetchedArticle> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    // If root page specified, start from there
    if (creds.rootPageId) {
      yield* this.fetchPageAndChildren(client, creds.rootPageId);
    } else {
      // Search all pages accessible to the integration
      yield* this.searchAllPages(client);
    }
  }

  async *fetchSince(credentials: ConnectorCredentials, since: Date): AsyncGenerator<FetchedArticle> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    // Use search with filter for recently edited
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const response = await client.search({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        start_cursor: cursor,
        page_size: 100,
      });

      for (const result of response.results) {
        if (result.object !== 'page') continue;

        const page = result as any;
        const lastEdited = new Date(page.last_edited_time);

        // Stop if we've gone past our sync window
        if (lastEdited < since) {
          hasMore = false;
          break;
        }

        const article = await this.extractPageContent(client, page);
        if (article) yield article;
      }

      hasMore = hasMore && response.has_more;
      cursor = response.next_cursor || undefined;
    }
  }

  async getArticleCount(credentials: ConnectorCredentials): Promise<number> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    // Notion doesn't have a count endpoint, so we estimate
    let count = 0;
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const response = await client.search({
        filter: { property: 'object', value: 'page' },
        start_cursor: cursor,
        page_size: 100,
      });

      count += response.results.length;
      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;
    }

    return count;
  }

  private async *searchAllPages(client: Client): AsyncGenerator<FetchedArticle> {
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const response = await client.search({
        filter: { property: 'object', value: 'page' },
        start_cursor: cursor,
        page_size: 100,
      });

      for (const result of response.results) {
        if (result.object !== 'page') continue;

        const article = await this.extractPageContent(client, result as any);
        if (article) yield article;

        // Rate limiting
        await this.delay(100);
      }

      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;
    }
  }

  private async *fetchPageAndChildren(client: Client, pageId: string): AsyncGenerator<FetchedArticle> {
    // Fetch the page itself
    const page = await client.pages.retrieve({ page_id: pageId });
    const article = await this.extractPageContent(client, page as any);
    if (article) yield article;

    // Fetch child pages (via blocks)
    const blocks = await this.getAllBlocks(client, pageId);

    for (const block of blocks) {
      if (block.type === 'child_page') {
        yield* this.fetchPageAndChildren(client, block.id);
      }
    }
  }

  private async extractPageContent(client: Client, page: any): Promise<FetchedArticle | null> {
    try {
      // Extract title from properties
      const title = this.extractTitle(page);
      if (!title) return null;

      // Get all blocks (content)
      const blocks = await this.getAllBlocks(client, page.id);
      const content = this.blocksToText(blocks);

      return {
        externalId: page.id,
        title,
        content,
        url: page.url,
        createdAt: new Date(page.created_time),
        updatedAt: new Date(page.last_edited_time),
        checksum: this.calculateChecksum(content),
      };
    } catch (error) {
      console.error(`Failed to extract page ${page.id}:`, error);
      return null;
    }
  }

  private async getAllBlocks(client: Client, blockId: string): Promise<any[]> {
    const blocks: any[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const response = await client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });

      blocks.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor || undefined;
    }

    return blocks;
  }

  private extractTitle(page: any): string {
    // Handle different property types
    const titleProp = page.properties?.title || page.properties?.Name;
    if (!titleProp) return '';

    if (titleProp.type === 'title' && titleProp.title) {
      return titleProp.title.map((t: any) => t.plain_text).join('');
    }

    return '';
  }

  private blocksToText(blocks: any[]): string {
    const parts: string[] = [];

    for (const block of blocks) {
      const text = this.blockToText(block);
      if (text) parts.push(text);
    }

    return parts.join('\n\n');
  }

  private blockToText(block: any): string {
    const type = block.type;
    const content = block[type];

    if (!content) return '';

    // Handle rich text blocks
    if (content.rich_text) {
      const text = content.rich_text.map((t: any) => t.plain_text).join('');

      switch (type) {
        case 'heading_1':
          return `# ${text}`;
        case 'heading_2':
          return `## ${text}`;
        case 'heading_3':
          return `### ${text}`;
        case 'bulleted_list_item':
          return `• ${text}`;
        case 'numbered_list_item':
          return `1. ${text}`;
        case 'to_do':
          return `${content.checked ? '☑' : '☐'} ${text}`;
        case 'toggle':
          return `▸ ${text}`;
        case 'quote':
          return `> ${text}`;
        case 'callout':
          return `📌 ${text}`;
        case 'code':
          return `\`\`\`\n${text}\n\`\`\``;
        default:
          return text;
      }
    }

    // Handle other block types
    switch (type) {
      case 'divider':
        return '---';
      case 'table':
        return '[Table]';
      case 'image':
        return '[Image]';
      case 'video':
        return '[Video]';
      case 'file':
        return '[File]';
      case 'bookmark':
        return content.url || '[Bookmark]';
      case 'equation':
        return content.expression || '[Equation]';
      default:
        return '';
    }
  }

  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 2. Sync Worker Update

```typescript
// In sync.worker.ts - add Notion handling

import { NotionConnector } from '../modules/knowledge/connectors/notion.connector.js';

function getConnector(type: KnowledgeSourceType): Connector {
  switch (type) {
    case 'ZENDESK':
      return new ZendeskConnector();
    case 'NOTION':
      return new NotionConnector();
    default:
      throw new Error(`Unsupported connector type: ${type}`);
  }
}
```

## Notion API Reference

### Authentication
- Uses Integration Token (Internal Integration)
- Rate limit: 3 requests per second
- Pages must be shared with the integration

### Endpoints Used
- `POST /v1/search` - Search accessible pages
- `GET /v1/pages/:id` - Get page details
- `GET /v1/blocks/:id/children` - Get page content blocks
- `GET /v1/users` - Test connection

### Block Types Supported
- `paragraph`, `heading_1/2/3`
- `bulleted_list_item`, `numbered_list_item`
- `to_do`, `toggle`, `quote`, `callout`
- `code`, `divider`, `table`
- `image`, `video`, `file`, `bookmark`
- `equation`, `child_page`

## Dependencies

Add to `package.json`:
```json
{
  "dependencies": {
    "@notionhq/client": "^2.2.14"
  }
}
```

## Acceptance Criteria

- [ ] Notion API key can be validated (test connection)
- [ ] All accessible pages can be fetched
- [ ] Specific page/database can be synced (root page option)
- [ ] Page content is extracted from blocks
- [ ] Rich text is converted to plain text
- [ ] Block types are handled appropriately
- [ ] Child pages are traversed
- [ ] Incremental sync works (by last_edited_time)
- [ ] Rate limiting is respected
- [ ] Credentials are encrypted at rest

## Test Cases

1. **Valid API key test**
2. **Invalid API key test**
3. **Fetch all pages**
4. **Fetch from root page**
5. **Incremental sync**
6. **Block type conversion**
   - Paragraphs
   - Headings
   - Lists
   - Code blocks
   - Callouts
7. **Child page traversal**
8. **Empty page handling**
9. **Rate limiting handling**
10. **Large workspace pagination**

## Security Considerations

- [ ] Store API key encrypted
- [ ] Never log API key
- [ ] Handle token revocation gracefully
- [ ] Respect page permissions (integration sees only shared pages)

## Notion Integration Setup

Users need to:
1. Go to https://www.notion.so/my-integrations
2. Create a new integration
3. Copy the Internal Integration Token
4. Share pages/databases with the integration

## Estimated Complexity

**Medium** - Notion's block-based structure requires careful content extraction.
