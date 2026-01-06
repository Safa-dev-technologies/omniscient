import type { DocumentProcessor, ExtractedDocument } from './processor.interface.js';
import { RetryableError, NonRetryableError } from '../../../jobs/jobs.types.js';
import { logger } from '../../../lib/logger.js';
import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = require('robots-parser') as (
  url: string,
  robotstxt: string
) => {
  isAllowed: (url: string, ua?: string) => boolean | undefined;
};

interface FetchOptions {
  timeout?: number;
  maxSize?: number; // Maximum response size in bytes
  userAgent?: string;
}

const DEFAULT_OPTIONS: FetchOptions = {
  timeout: 30000, // 30 seconds
  maxSize: 10 * 1024 * 1024, // 10 MB
  userAgent: 'OmniscientBot/1.0 (+https://omniscient.ai/bot)',
};

export class UrlProcessor implements DocumentProcessor {
  mimeTypes = ['text/html', 'text/plain']; // Can handle HTML and plain text URLs

  /**
   * Extract content from a URL
   * @param buffer - Not used for URLs, but required by interface
   * @param filename - Should be a URL string when processing URLs
   */
  async extract(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
    // Check if filename is a URL
    let url: URL;
    try {
      url = new URL(filename);
    } catch (error) {
      throw new NonRetryableError(`Invalid URL: ${filename}`);
    }

    // Validate URL scheme
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new NonRetryableError(`Unsupported URL scheme: ${url.protocol}`);
    }

    // Check robots.txt
    const canCrawl = await this.checkRobotsTxt(url);
    if (!canCrawl) {
      throw new NonRetryableError(`URL is disallowed by robots.txt: ${url.href}`);
    }

    // Fetch the URL
    const html = await this.fetchUrl(url, DEFAULT_OPTIONS);

    // Parse and extract content
    return this.extractFromHtml(html, url.href);
  }

  /**
   * Check if URL is allowed by robots.txt
   */
  private async checkRobotsTxt(url: URL): Promise<boolean> {
    try {
      const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
      const robotsResponse = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(5000), // 5 second timeout for robots.txt
      });

      if (!robotsResponse.ok) {
        // If robots.txt doesn't exist or returns error, allow crawling
        return true;
      }

      const robotsText = await robotsResponse.text();
      const robots = robotsParser(robotsUrl, robotsText);

      // Check if our user agent can fetch this URL
      // isAllowed returns boolean | undefined, treat undefined as allowed (fail open)
      const isAllowed = robots.isAllowed(url.href, DEFAULT_OPTIONS.userAgent || 'OmniscientBot');
      return isAllowed !== false; // Only disallow if explicitly false
    } catch (error) {
      // If robots.txt check fails, allow crawling (fail open)
      logger.warn({ url: url.href, error }, 'Failed to check robots.txt, allowing crawl');
      return true;
    }
  }

  /**
   * Fetch URL content with timeout and size limits
   */
  private async fetchUrl(url: URL, options: FetchOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(url.href, {
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent || DEFAULT_OPTIONS.userAgent!,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow', // Follow redirects
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          // Client errors are non-retryable
          throw new NonRetryableError(`HTTP ${response.status}: ${response.statusText}`);
        }
        // Server errors might be retryable
        throw new RetryableError(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        logger.warn({ url: url.href, contentType }, 'Unexpected content type, proceeding anyway');
      }

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (
        contentLength &&
        parseInt(contentLength, 10) > (options.maxSize || DEFAULT_OPTIONS.maxSize!)
      ) {
        throw new NonRetryableError(`Content too large: ${contentLength} bytes`);
      }

      // Read response with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        throw new RetryableError('No response body');
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      const maxSize = options.maxSize || DEFAULT_OPTIONS.maxSize!;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          reader.cancel();
          throw new NonRetryableError(`Content exceeds maximum size: ${totalSize} bytes`);
        }

        chunks.push(value);
      }

      // Combine chunks into string
      const buffer = Buffer.concat(chunks);
      return buffer.toString('utf-8');
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof NonRetryableError || error instanceof RetryableError) {
        throw error;
      }

      // Classify fetch errors
      const message = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.constructor.name : '';

      // Timeout errors
      if (
        errorName === 'AbortError' ||
        message.includes('timeout') ||
        message.includes('aborted')
      ) {
        throw new RetryableError(`Request timeout: ${url.href}`, error as Error);
      }

      // Network errors (retryable)
      if (
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('ENOTFOUND') ||
        message.includes('ECONNREFUSED') ||
        message.includes('network')
      ) {
        throw new RetryableError(`Network error: ${message}`, error as Error);
      }

      // DNS errors (retryable)
      if (message.includes('getaddrinfo') || message.includes('DNS')) {
        throw new RetryableError(`DNS error: ${message}`, error as Error);
      }

      // Unknown errors - assume retryable
      throw new RetryableError(`Failed to fetch URL: ${message}`, error as Error);
    }
  }

  /**
   * Extract text and metadata from HTML
   */
  private extractFromHtml(html: string, url: string): ExtractedDocument {
    try {
      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, noscript, iframe, embed, object').remove();

      // Extract metadata
      let title =
        $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('title').text() ||
        '';

      let description =
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="twitter:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        '';

      let author =
        $('meta[name="author"]').attr('content') ||
        $('meta[property="article:author"]').attr('content') ||
        $('meta[property="article:author:first_name"]').attr('content') ||
        $('[rel="author"]').text() ||
        $('.author, .byline').first().text().trim() ||
        '';

      // Extract JSON-LD structured data
      let jsonLdData: Record<string, unknown> | undefined;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const jsonText = $(el).html();
          if (jsonText) {
            const parsed = JSON.parse(jsonText);
            if (Array.isArray(parsed)) {
              jsonLdData = parsed[0] as Record<string, unknown>;
            } else {
              jsonLdData = parsed as Record<string, unknown>;
            }
          }
        } catch {
          // Invalid JSON, skip
        }
      });

      // Enhance metadata from JSON-LD
      if (jsonLdData) {
        if (jsonLdData.name && !title) {
          title = String(jsonLdData.name);
        }
        if (jsonLdData.description && !description) {
          description = String(jsonLdData.description);
        }
        if (jsonLdData.author && !author) {
          const authorObj = jsonLdData.author as { name?: string };
          if (authorObj?.name) {
            author = authorObj.name;
          }
        }
      }

      // Extract main content
      // Try to find main content area with better detection
      let mainContent = $('article').first();
      if (mainContent.length === 0) {
        mainContent = $('main').first();
      }
      if (mainContent.length === 0) {
        mainContent = $('[role="main"]').first();
      }
      if (mainContent.length === 0) {
        // Try common content class/id patterns
        mainContent = $(
          '.content, #content, .main-content, #main-content, .post-content, .article-content'
        ).first();
      }
      if (mainContent.length === 0) {
        // Try section elements
        mainContent = $('section').first();
      }
      if (mainContent.length === 0) {
        // Fallback to body (but remove nav, footer, sidebar)
        const body = $('body');
        body.find('nav, footer, aside, .sidebar, .navigation, header').remove();
        mainContent = body;
      }

      // Extract text from main content
      let text = mainContent.text();

      // If no text found, try body
      if (!text || text.trim().length === 0) {
        text = $('body').text();
      }

      // Clean up text
      text = this.cleanText(text);

      if (!text || text.trim().length === 0) {
        logger.warn({ url }, 'No text content extracted from URL');
        return {
          text: '',
          metadata: {
            title: title.trim() || undefined,
            description: description.trim() || undefined,
            author: author.trim() || undefined,
            url,
            warning: 'No text content extracted',
          },
        };
      }

      return {
        text,
        metadata: {
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          author: author.trim() || undefined,
          url,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RetryableError(`Failed to parse HTML: ${message}`, error as Error);
    }
  }

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

  /**
   * Get canonical URL from page
   */
  getCanonicalUrl(html: string, pageUrl: string): string {
    try {
      const $ = cheerio.load(html);
      const canonical = $('link[rel="canonical"]').attr('href');
      if (canonical) {
        return new URL(canonical, pageUrl).href;
      }
      return pageUrl;
    } catch {
      return pageUrl;
    }
  }

  /**
   * Clean extracted text
   */
  private cleanText(text: string): string {
    return (
      text
        // Remove excessive whitespace
        .replace(/\s+/g, ' ')
        // Remove null characters
        .replace(/\0/g, '')
        // Normalize line breaks
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove multiple consecutive newlines
        .replace(/\n{3,}/g, '\n\n')
        // Normalize quotes
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        // Remove leading/trailing whitespace from each line
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n')
        .trim()
    );
  }
}

export const urlProcessor = new UrlProcessor();
