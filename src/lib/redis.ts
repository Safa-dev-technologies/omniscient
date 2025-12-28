import { Redis } from 'ioredis';
import { env } from '../config/index.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error(err, 'Redis error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});
