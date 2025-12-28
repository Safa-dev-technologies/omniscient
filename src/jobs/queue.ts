import { Queue } from 'bullmq';
import { env } from '../config/index.js';

const connection = {
  host: new URL(env.REDIS_URL).hostname,
  port: parseInt(new URL(env.REDIS_URL).port || '6379', 10),
};

export const documentQueue = new Queue('document-processing', { connection });
export const embeddingQueue = new Queue('embedding-generation', { connection });
