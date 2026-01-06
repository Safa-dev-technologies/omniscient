/**
 * Notion Connector
 * Fetches pages and databases from Notion workspaces
 */

import { Client } from '@notionhq/client';
import { createHash } from 'crypto';
import type { Connector, ConnectorCredentials, FetchedArticle } from './connector.interface.js';
import { logger } from '../../../lib/logger.js';

interface NotionCredentials extends ConnectorCredentials {
  apiKey: string;
  rootPageId?: string; // Optional: specific page/database to sync
}

/**
 * Notion API connector
 * Supports fetching pages and databases from Notion workspaces
 */
export class NotionConnector implements Connector {
  readonly type = 'NOTION' as const;

  private getClient(credentials: NotionCredentials): Client {
    return new Client({ auth: credentials.apiKey });
  }

  /**
   * Test connection with Notion API
   */
  async testConnection(credentials: ConnectorCredentials): Promise<boolean> {
    const creds = credentials as NotionCredentials;
    if (!creds.apiKey) {
      return false;
    }

    const client = this.getClient(creds);

    try {
      // List users to test connection
      await client.users.list({});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch all pages from Notion
   */
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

  /**
   * Fetch pages modified since a given date
   */
  async *fetchSince(
    credentials: ConnectorCredentials,
    since: Date
  ): AsyncGenerator<FetchedArticle> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    // Use search with filter for recently edited
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      try {
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

          // Rate limiting: Notion allows 3 requests per second
          await this.delay(350);
        }

        hasMore = hasMore && response.has_more;
        cursor = response.next_cursor || undefined;
      } catch (error) {
        logger.error({ error, cursor }, 'Error fetching Notion pages');
        throw error;
      }
    }
  }

  /**
   * Get approximate count of pages
   */
  async getArticleCount(credentials: ConnectorCredentials): Promise<number> {
    const creds = credentials as NotionCredentials;
    const client = this.getClient(creds);

    // Notion doesn't have a count endpoint, so we estimate
    let count = 0;
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      try {
        const response = await client.search({
          filter: { property: 'object', value: 'page' },
          start_cursor: cursor,
          page_size: 100,
        });

        count += response.results.length;
        hasMore = response.has_more;
        cursor = response.next_cursor || undefined;

        // Rate limiting
        if (hasMore) {
          await this.delay(350);
        }
      } catch (error) {
        logger.error({ error }, 'Error counting Notion pages');
        throw error;
      }
    }

    return count;
  }

  /**
   * Search all accessible pages
   */
  private async *searchAllPages(client: Client): AsyncGenerator<FetchedArticle> {
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      try {
        const response = await client.search({
          filter: { property: 'object', value: 'page' },
          start_cursor: cursor,
          page_size: 100,
        });

        for (const result of response.results) {
          if (result.object !== 'page') continue;

          const article = await this.extractPageContent(client, result as any);
          if (article) yield article;

          // Rate limiting: 3 requests per second
          await this.delay(350);
        }

        hasMore = response.has_more;
        cursor = response.next_cursor || undefined;
      } catch (error) {
        logger.error({ error, cursor }, 'Error searching Notion pages');
        throw error;
      }
    }
  }

  /**
   * Fetch a page and its child pages recursively
   */
  private async *fetchPageAndChildren(
    client: Client,
    pageId: string
  ): AsyncGenerator<FetchedArticle> {
    try {
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
      // eslint-disable-line @typescript-eslint/no-unused-vars - error is used in logger

      // Rate limiting
      await this.delay(350);
    } catch (error) {
      logger.error({ error, pageId }, 'Error fetching Notion page and children');
      // Continue with other pages instead of failing completely
    }
  }

  /**
   * Extract content from a Notion page
   */
  private async extractPageContent(client: Client, page: any): Promise<FetchedArticle | null> {
    try {
      // Extract title from properties
      const title = this.extractTitle(page);
      if (!title) {
        logger.debug({ pageId: page.id }, 'Page has no title, skipping');
        return null;
      }

      // Get all blocks (content)
      const blocks = await this.getAllBlocks(client, page.id);
      const content = this.blocksToText(blocks);

      if (!content.trim()) {
        logger.debug({ pageId: page.id, title }, 'Page has no content, skipping');
        return null;
      }

      return {
        externalId: page.id,
        title,
        content,
        url: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
        createdAt: new Date(page.created_time),
        updatedAt: new Date(page.last_edited_time),
        checksum: this.calculateChecksum(content),
        metadata: {
          parentType: page.parent?.type,
          parentId: page.parent?.page_id || page.parent?.database_id,
        },
      };
    } catch (error) {
      logger.error({ error, pageId: page.id }, 'Failed to extract Notion page content');
      return null;
    }
  }

  /**
   * Get all blocks for a page (recursively handles nested blocks)
   */
  private async getAllBlocks(client: Client, blockId: string): Promise<any[]> {
    const blocks: any[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      try {
        const response = await client.blocks.children.list({
          block_id: blockId,
          start_cursor: cursor,
          page_size: 100,
        });

        blocks.push(...response.results);

        // Recursively fetch children of blocks that have children
        for (const block of response.results) {
          if ('has_children' in block && block.has_children) {
            const childBlocks = await this.getAllBlocks(client, block.id);
            blocks.push(...childBlocks);
          }
        }

        hasMore = response.has_more;
        cursor = response.next_cursor || undefined;

        // Rate limiting
        if (hasMore) {
          await this.delay(350);
        }
      } catch (error) {
        logger.error({ error, blockId }, 'Error fetching Notion blocks');
        throw error;
      }
    }

    return blocks;
  }

  /**
   * Extract title from page properties
   */
  private extractTitle(page: any): string {
    // Handle different property types
    const titleProp = page.properties?.title || page.properties?.Name;
    if (!titleProp) {
      // Try to get title from page object directly
      if (page.title && Array.isArray(page.title)) {
        return page.title.map((t: any) => t.plain_text || '').join('');
      }
      return '';
    }

    if (titleProp.type === 'title' && titleProp.title) {
      return titleProp.title.map((t: any) => t.plain_text || '').join('');
    }

    // Handle rich text title
    if (titleProp.type === 'rich_text' && titleProp.rich_text) {
      return titleProp.rich_text.map((t: any) => t.plain_text || '').join('');
    }

    return '';
  }

  /**
   * Convert blocks to plain text
   */
  private blocksToText(blocks: any[]): string {
    const parts: string[] = [];

    for (const block of blocks) {
      const text = this.blockToText(block);
      if (text) parts.push(text);
    }

    return parts.join('\n\n');
  }

  /**
   * Convert a single block to text
   */
  private blockToText(block: any): string {
    const type = block.type;
    const content = block[type];

    if (!content) return '';

    // Handle rich text blocks
    if (content.rich_text && Array.isArray(content.rich_text)) {
      const text = content.rich_text.map((t: any) => t.plain_text || '').join('');

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
        case 'code': {
          const codeText =
            text || content.caption?.map((c: any) => c.plain_text || '').join('') || '';
          return `\`\`\`\n${codeText}\n\`\`\``;
        }
        default:
          return text;
      }
    }

    // Handle other block types
    switch (type) {
      case 'divider':
        return '---';
      case 'table': {
        // Extract table content
        if (content.table_rows) {
          const rows = content.table_rows.map((row: any) => {
            const cells = row.cells.map((cell: any) => {
              if (cell.rich_text) {
                return cell.rich_text.map((t: any) => t.plain_text || '').join('');
              }
              return '';
            });
            return cells.join(' | ');
          });
          return rows.join('\n');
        }
        return '[Table]';
      }
      case 'image':
        return content.caption?.map((c: any) => c.plain_text || '').join('') || '[Image]';
      case 'video':
        return content.caption?.map((c: any) => c.plain_text || '').join('') || '[Video]';
      case 'file':
        return content.caption?.map((c: any) => c.plain_text || '').join('') || '[File]';
      case 'bookmark':
        return content.url || '[Bookmark]';
      case 'equation':
        return content.expression || '[Equation]';
      case 'child_page':
        return `[Page: ${content.title || 'Untitled'}]`;
      case 'child_database':
        return `[Database: ${content.title || 'Untitled'}]`;
      default:
        return '';
    }
  }

  /**
   * Calculate MD5 checksum for change detection
   */
  private calculateChecksum(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Delay for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
