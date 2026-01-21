import { Worker, Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/index.js';
import type { CrawlUrlJob, CrawlPageJob } from '../jobs.types.js';
import { NonRetryableError } from '../jobs.types.js';
import { isRetryable, moveToDeadLetter } from '../error-utils.js';
import { crawlQueue, embeddingQueue } from '../queue.js';
import { redis } from '../../lib/redis.js';
import { crawlManager } from '../../modules/knowledge/crawlers/crawl.manager.js';
import { parseSitemap, findSitemap } from '../../modules/knowledge/crawlers/sitemap.parser.js';
import { urlProcessor } from '../../modules/knowledge/processors/url.processor.js';
import { getChunker } from '../../modules/knowledge/chunkers/index.js';
import { validateUrlForSSRF } from '../../utils/url-validator.js';

const MAX_REDIRECTS = 5;

/**
 * Fetch URL with SSRF-safe redirect handling
 * Validates each redirect destination before following
 */
async function safeFetchWithRedirects(
  url: string,
  options: RequestInit = {},
  redirectCount = 0
): Promise<Response> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
  }

  // Validate URL before fetching
  const ssrfCheck = await validateUrlForSSRF(url);
  if (!ssrfCheck.valid) {
    throw new Error(`SSRF Protection: ${ssrfCheck.error}`);
  }

  const response = await fetch(url, {
    ...options,
    redirect: 'manual', // Don't auto-follow redirects
  });

  // Handle redirects manually with SSRF validation
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect response missing location header`);
    }

    // Resolve relative URLs
    const redirectUrl = new URL(location, url).href;

    logger.debug({ from: url, to: redirectUrl }, 'Following redirect with SSRF check');

    return safeFetchWithRedirects(redirectUrl, options, redirectCount + 1);
  }

  return response;
}

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

// Rate limiter per domain (1 request per second)
async function checkDomainRateLimit(domain: string): Promise<boolean> {
  const key = `crawl:ratelimit:${domain}`;
  const now = Date.now();
  const lastRequest = await redis.get(key);

  if (lastRequest) {
    const timeSinceLastRequest = now - parseInt(lastRequest, 10);
    if (timeSinceLastRequest < 1000) {
      // Less than 1 second since last request
      return false;
    }
  }

  // Update last request time
  await redis.setex(key, 60, now.toString()); // 60 second TTL
  return true;
}

// Store extracted content per source
const extractedContent = new Map<
  string,
  Array<{ url: string; text: string; metadata: Record<string, unknown> }>
>();

/**
 * Process CRAWL_URL job (initial crawl setup)
 */
async function processCrawlUrl(job: Job<CrawlUrlJob>) {
  const { sourceId, tenantId, url, options } = job.data;

  logger.info({ sourceId, url, options }, 'Starting URL crawl');

  try {
    // Get source record
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });

    if (!source || source.type !== 'URL') {
      throw new NonRetryableError('Source not found or not a URL type');
    }

    // Check if crawl cancelled
    const state = await crawlManager.getState(sourceId);
    if (state?.status === 'cancelled') {
      logger.info({ sourceId }, 'Crawl cancelled, skipping');
      return;
    }

    // Initialize crawl state
    await crawlManager.initCrawl(sourceId, tenantId, url, options);
    await crawlManager.updateStatus(sourceId, 'running');

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'EXTRACTING' },
    });

    // Initialize content storage
    extractedContent.set(sourceId, []);

    // If sitemap crawl, fetch and add URLs
    if (options.crawlSitemap) {
      logger.info({ sourceId, url }, 'Fetching sitemap');
      const sitemapUrl = await findSitemap(url);
      if (sitemapUrl) {
        const sitemapUrls = await parseSitemap(sitemapUrl);
        logger.info({ sourceId, sitemapUrlCount: sitemapUrls.length }, 'Found sitemap URLs');

        // Add all sitemap URLs to pending (depth 0)
        for (const sitemapUrl of sitemapUrls) {
          await crawlManager.addUrl(sourceId, sitemapUrl.loc, 0);
        }
      } else {
        logger.warn({ sourceId, url }, 'Sitemap not found, crawling root URL only');
        await crawlManager.addUrl(sourceId, url, 0);
      }
    } else {
      // Single URL crawl
      await crawlManager.addUrl(sourceId, url, 0);
    }

    // Queue first batch of CRAWL_PAGE jobs
    const batchSize = Math.min(10, options.maxPages);
    for (let i = 0; i < batchSize; i++) {
      const next = await crawlManager.getNextUrl(sourceId);
      if (!next) {
        break;
      }

      await crawlQueue.add('CRAWL_PAGE', {
        type: 'CRAWL_PAGE',
        sourceId,
        tenantId,
        url: next.url,
        depth: next.depth,
      });
    }

    logger.info({ sourceId }, 'Crawl initialized, pages queued');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ sourceId, error: message }, 'Crawl URL job failed');

    await crawlManager.updateStatus(sourceId, 'failed');
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: message,
      },
    });

    throw error;
  }
}

/**
 * Process CRAWL_PAGE job (crawl individual page)
 */
async function processCrawlPage(job: Job<CrawlPageJob>) {
  const { sourceId, tenantId, url, depth } = job.data;

  logger.info({ sourceId, url, depth }, 'Crawling page');

  try {
    // Check if crawl cancelled
    const state = await crawlManager.getState(sourceId);
    if (!state || state.status === 'cancelled') {
      logger.info({ sourceId, url }, 'Crawl cancelled, skipping page');
      return;
    }

    // Check domain rate limit
    const urlObj = new URL(url);
    const canCrawl = await checkDomainRateLimit(urlObj.hostname);
    if (!canCrawl) {
      // Delay and retry
      const delay = 2000 + Math.floor(Math.random() * 1000); // 2-3 seconds
      await job.moveToDelayed(Date.now() + delay);
      return;
    }

    // Extract content using URL processor
    const extracted = await urlProcessor.extract(Buffer.alloc(0), url);

    // Store extracted content
    const content = extractedContent.get(sourceId) || [];
    content.push({
      url,
      text: extracted.text,
      metadata: {
        ...extracted.metadata,
        depth,
        crawledAt: new Date().toISOString(),
      },
    });
    extractedContent.set(sourceId, content);

    // Mark as visited
    await crawlManager.markVisited(sourceId, url);

    // If depth < maxDepth, extract links and queue new pages
    // Note: We need to fetch the HTML again to extract links, or store it
    // For now, we'll fetch it again (could be optimized)
    if (depth < state.options.maxDepth) {
      try {
        // Re-fetch HTML to extract links using SSRF-safe fetch
        const response = await safeFetchWithRedirects(url);
        const html = await response.text();
        const links = urlProcessor.extractLinks(html, url);
        logger.info({ sourceId, url, linkCount: links.length }, 'Extracted links from page');

        for (const link of links) {
          // SSRF Protection: Validate discovered links before adding
          const linkSsrfCheck = await validateUrlForSSRF(link);
          if (!linkSsrfCheck.valid) {
            logger.debug(
              { sourceId, link, error: linkSsrfCheck.error },
              'Discovered link blocked by SSRF protection'
            );
            continue;
          }

          const added = await crawlManager.addUrl(sourceId, link, depth + 1);
          if (added) {
            // Queue new page job
            await crawlQueue.add('CRAWL_PAGE', {
              type: 'CRAWL_PAGE',
              sourceId,
              tenantId,
              url: link,
              depth: depth + 1,
            });
          }
        }
      } catch (fetchError) {
        // Log but don't fail the job - link extraction is optional
        const fetchMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        logger.warn({ sourceId, url, error: fetchMsg }, 'Failed to fetch URL for link extraction');
      }
    }

    // Check if crawl is complete
    const isComplete = await crawlManager.isComplete(sourceId);
    if (isComplete) {
      await finalizeCrawl(sourceId, tenantId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ sourceId, url, error: message }, 'Page crawl failed');

    // Mark as failed but continue crawl
    await crawlManager.markFailed(sourceId, url, message);

    // Check if we should retry
    if (isRetryable(error) && job.attemptsMade < 3) {
      throw error; // Retry
    }

    // Check if crawl is complete (even with errors)
    const isComplete = await crawlManager.isComplete(sourceId);
    if (isComplete) {
      await finalizeCrawl(sourceId, tenantId);
    }
  }
}

/**
 * Finalize crawl: aggregate content, chunk, and queue embedding
 */
async function finalizeCrawl(sourceId: string, tenantId: string): Promise<void> {
  logger.info({ sourceId }, 'Finalizing crawl');

  try {
    const state = await crawlManager.getState(sourceId);
    if (!state) {
      throw new Error('Crawl state not found');
    }

    // Get all extracted content
    const content = extractedContent.get(sourceId) || [];
    extractedContent.delete(sourceId);

    if (content.length === 0) {
      throw new NonRetryableError('No content extracted from crawl');
    }

    // Aggregate all text
    const aggregatedText = content
      .map((c) => {
        const metadata = Object.entries(c.metadata)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return `[URL: ${c.url}${metadata ? `, ${metadata}` : ''}]\n${c.text}`;
      })
      .join('\n\n---\n\n');

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: 'CHUNKING' },
    });

    // Chunk aggregated content
    const chunker = getChunker();
    const chunks = chunker.chunk(aggregatedText);

    if (chunks.length === 0) {
      throw new NonRetryableError('No chunks generated from crawled content');
    }

    logger.info(
      { sourceId, chunkCount: chunks.length, pageCount: content.length },
      'Crawl content chunked'
    );

    // Queue embedding job
    await embeddingQueue.add('GENERATE_EMBEDDINGS', {
      sourceId,
      tenantId,
      chunks: chunks.map((c) => ({
        text: c.text,
        index: c.index,
        tokenCount: c.tokenCount,
        metadata: {
          ...c.metadata,
          sourceType: 'URL',
          pageCount: content.length,
        },
      })),
    });

    // Update crawl status
    await crawlManager.updateStatus(sourceId, 'completed');

    // Update source status
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'EMBEDDING',
        chunkCount: chunks.length,
      },
    });

    logger.info({ sourceId }, 'Crawl finalized, embedding queued');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ sourceId, error: message }, 'Failed to finalize crawl');

    await crawlManager.updateStatus(sourceId, 'failed');
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        statusMessage: message,
      },
    });

    throw error;
  }
}

// Create worker
const worker = new Worker(
  'crawl-processing',
  async (job: Job<CrawlUrlJob | CrawlPageJob>) => {
    if (job.name === 'CRAWL_URL') {
      await processCrawlUrl(job as Job<CrawlUrlJob>);
    } else if (job.name === 'CRAWL_PAGE') {
      await processCrawlPage(job as Job<CrawlPageJob>);
    } else {
      throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 crawl jobs concurrently
  }
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'Crawl job completed');
});

worker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, 'Crawl job failed');

  if (job) {
    const isRetryableError = isRetryable(err);
    if (!isRetryableError) {
      await moveToDeadLetter(job, err, 'crawl-processing');
    }
  }
});

logger.info('Crawl worker started');

export { worker };
