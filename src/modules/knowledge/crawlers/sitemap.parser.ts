import * as cheerio from 'cheerio';
import { gunzip as gunzipSync } from 'zlib';
import { promisify } from 'util';
import { logger } from '../../../lib/logger.js';
import { validateUrlForSSRF } from '../../../utils/url-validator.js';
import type { SitemapUrl, SitemapParserOptions } from './crawl.types.js';

const gunzip = promisify(gunzipSync);

const DEFAULT_OPTIONS: Required<SitemapParserOptions> = {
  timeout: 30000, // 30 seconds
  maxUrls: 10000, // Maximum URLs to parse
  userAgent: 'OmniscientBot/1.0 (+https://omniscient.ai/bot)',
};

// Maximum sitemap size to prevent memory exhaustion attacks (50MB)
const MAX_SITEMAP_SIZE = 50 * 1024 * 1024;

/**
 * Parse sitemap.xml and extract URLs
 */
export async function parseSitemap(
  sitemapUrl: string,
  options?: SitemapParserOptions
): Promise<SitemapUrl[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const urls: SitemapUrl[] = [];

  try {
    // SSRF Protection: Validate sitemap URL before fetching
    const ssrfCheck = await validateUrlForSSRF(sitemapUrl);
    if (!ssrfCheck.valid) {
      logger.warn({ sitemapUrl, error: ssrfCheck.error }, 'Sitemap URL blocked by SSRF protection');
      throw new Error(`SSRF Protection: ${ssrfCheck.error}`);
    }

    // Fetch sitemap
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

    let response: Response;
    try {
      response = await fetch(sitemapUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': opts.userAgent,
          Accept: 'application/xml, text/xml, */*',
        },
      });
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Sitemap fetch timeout: ${sitemapUrl}`);
      }
      throw error;
    }

    if (!response.ok) {
      if (response.status === 404) {
        return []; // Sitemap not found is not an error
      }
      throw new Error(`Failed to fetch sitemap: HTTP ${response.status}`);
    }

    // Check if gzipped
    const contentType = response.headers.get('content-type') || '';
    const isGzipped = sitemapUrl.endsWith('.gz') || contentType.includes('gzip');

    let xmlText: string;
    if (isGzipped) {
      const buffer = await response.arrayBuffer();
      // Check compressed size first
      if (buffer.byteLength > MAX_SITEMAP_SIZE) {
        throw new Error(`Sitemap too large: ${buffer.byteLength} bytes (max ${MAX_SITEMAP_SIZE})`);
      }
      const decompressed = await gunzip(Buffer.from(buffer));
      xmlText = decompressed.toString('utf-8');
    } else {
      xmlText = await response.text();
    }

    // Validate XML size to prevent memory exhaustion (billion laughs, etc.)
    if (xmlText.length > MAX_SITEMAP_SIZE) {
      throw new Error(`Sitemap too large: ${xmlText.length} bytes (max ${MAX_SITEMAP_SIZE})`);
    }

    // Parse XML
    const $ = cheerio.load(xmlText, { xmlMode: true });

    // Check if it's a sitemap index
    const sitemapIndex = $('sitemapindex').length > 0;

    if (sitemapIndex) {
      // Parse sitemap index - recursively fetch nested sitemaps
      const sitemapUrls: string[] = [];
      $('sitemap > loc').each((_, el) => {
        const loc = $(el).text().trim();
        if (loc) {
          sitemapUrls.push(loc);
        }
      });

      logger.info(
        { sitemapUrl, nestedCount: sitemapUrls.length },
        'Found sitemap index, parsing nested sitemaps'
      );

      // Parse each nested sitemap (limit to prevent infinite recursion)
      for (const nestedUrl of sitemapUrls.slice(0, 100)) {
        // Limit nested sitemaps to prevent excessive requests
        if (urls.length >= opts.maxUrls) {
          logger.warn({ sitemapUrl, totalUrls: urls.length }, 'Reached max URLs limit');
          break;
        }

        try {
          const nestedUrls = await parseSitemap(nestedUrl, {
            ...opts,
            maxUrls: opts.maxUrls - urls.length,
          });
          urls.push(...nestedUrls);
        } catch (error) {
          logger.warn({ nestedUrl, error }, 'Failed to parse nested sitemap, continuing');
          // Continue with other sitemaps
        }
      }

      return urls.slice(0, opts.maxUrls);
    }

    // Parse standard sitemap
    $('url').each((_, el) => {
      if (urls.length >= opts.maxUrls) {
        return false; // Stop iteration
      }

      const $url = $(el);
      const loc = $url.find('loc').text().trim();
      if (!loc) {
        return; // Skip invalid entries
      }

      const lastmodText = $url.find('lastmod').text().trim();
      const changefreqText = $url.find('changefreq').text().trim();
      const priorityText = $url.find('priority').text().trim();

      // Validate and parse lastmod date
      let lastmod: Date | undefined;
      if (lastmodText) {
        const parsedDate = new Date(lastmodText);
        lastmod = !isNaN(parsedDate.getTime()) ? parsedDate : undefined;
      }

      // Validate changefreq against allowed values
      const validFreqs: Array<SitemapUrl['changefreq']> = [
        'always',
        'hourly',
        'daily',
        'weekly',
        'monthly',
        'yearly',
        'never',
      ];
      const changefreq = validFreqs.includes(changefreqText as SitemapUrl['changefreq'])
        ? (changefreqText as SitemapUrl['changefreq'])
        : undefined;

      const urlEntry: SitemapUrl = {
        loc,
        lastmod,
        changefreq,
        priority: priorityText ? parseFloat(priorityText) : undefined,
      };

      urls.push(urlEntry);
    });

    return urls;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ sitemapUrl, error: message }, 'Failed to parse sitemap');
    throw new Error(`Sitemap parsing failed: ${message}`);
  }
}

/**
 * Find sitemap URL from robots.txt or common locations
 */
export async function findSitemap(
  baseUrl: string,
  options?: SitemapParserOptions
): Promise<string | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const url = new URL(baseUrl);

    // SSRF Protection: Validate base URL before checking for sitemaps
    const ssrfCheck = await validateUrlForSSRF(baseUrl);
    if (!ssrfCheck.valid) {
      logger.warn({ baseUrl, error: ssrfCheck.error }, 'Base URL blocked by SSRF protection');
      return null;
    }

    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;

    // Check robots.txt for Sitemap directive
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for robots.txt

    try {
      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': opts.userAgent,
        },
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const robotsText = await response.text();
        // Some sites have multiple Sitemap: directives - use matchAll to get all
        const sitemapMatches = [...robotsText.matchAll(/^Sitemap:\s*(.+)$/gim)];
        if (sitemapMatches.length > 0) {
          // Return first sitemap (could be enhanced to return all or try each)
          return sitemapMatches[0][1].trim();
        }
      }
    } catch {
      clearTimeout(timeoutId);
      // robots.txt not found or error - continue to common locations
    }

    // Try common sitemap locations
    const commonPaths = [
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/sitemap/sitemap.xml',
      '/sitemap.xml.gz',
    ];

    for (const path of commonPaths) {
      const sitemapUrl = `${url.protocol}//${url.host}${path}`;
      try {
        const testResponse = await fetch(sitemapUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
          headers: {
            'User-Agent': opts.userAgent,
          },
        });

        if (testResponse.ok) {
          return sitemapUrl;
        }
      } catch {
        // Continue to next location
      }
    }

    return null;
  } catch (error) {
    logger.warn({ baseUrl, error }, 'Failed to find sitemap');
    return null;
  }
}
