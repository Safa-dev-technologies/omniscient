import { Queue } from 'bullmq';
import { env } from '../config/index.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

export const documentQueue = new Queue('document-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed
      age: 86400, // or 24 hours
    },
    removeOnFail: false, // Keep failed for inspection
  },
});

export const embeddingQueue = new Queue('embedding-generation', {
  connection,
  defaultJobOptions: {
    attempts: 5, // More retries for API calls
    backoff: {
      type: 'exponential',
      delay: 10000, // 10s base (API rate limits)
    },
    removeOnComplete: {
      count: 1000,
      age: 86400,
    },
    removeOnFail: false,
  },
});

// Dead letter queue for permanent failures
export const deadLetterQueue = new Queue('dead-letter', { connection });

// Crawl queue for URL crawling jobs
export const crawlQueue = new Queue('crawl-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000, // 10s, 20s, 40s
    },
    removeOnComplete: {
      count: 1000,
      age: 86400,
    },
    removeOnFail: false,
  },
});

// Sync queue for external connector synchronization
export const syncQueue = new Queue('external-sync', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000, // 30s, 60s, 120s
    },
    removeOnComplete: {
      count: 500,
      age: 86400,
    },
    removeOnFail: false,
  },
});
