import { env } from '../../config/index.js';
import { localStorage } from './local.storage.js';
import { s3Storage } from './s3.storage.js';
import type { StorageClient } from './storage.interface.js';

export * from './storage.interface.js';

export function getStorage(): StorageClient {
  if (env.STORAGE_PROVIDER === 's3') {
    return s3Storage;
  }
  return localStorage;
}

export const storage = getStorage();
