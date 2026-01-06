import { logger } from './lib/logger.js';
import './jobs/workers/document.worker.js';
import './jobs/workers/embedding.worker.js';
import './jobs/workers/crawl.worker.js';
import './jobs/workers/sync.worker.js';
import { startSyncScheduler } from './jobs/scheduler.js';

logger.info('Workers started');

// Start sync scheduler
startSyncScheduler();
