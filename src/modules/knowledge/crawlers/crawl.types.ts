/**
 * Types for URL crawling functionality
 */

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

export interface CrawlOptions {
  crawlSitemap: boolean;
  maxDepth: number;
  maxPages: number;
  includePatterns?: string[];
  excludePatterns?: string[];
  respectRobots?: boolean;
  delayMs?: number;
}

export interface CrawlState {
  sourceId: string;
  tenantId: string;
  rootUrl: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  options: CrawlOptions;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesErrored: number;
  startedAt: Date;
  updatedAt: Date;
}
