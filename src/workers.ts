import { logger } from './lib/logger.js';
import './jobs/workers/document.worker.js';
import './jobs/workers/embedding.worker.js';

logger.info('Workers started');
