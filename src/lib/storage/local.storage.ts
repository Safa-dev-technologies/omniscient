import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/index.js';
import type { StorageClient } from './storage.interface.js';

export class LocalStorage implements StorageClient {
  private basePath: string;

  constructor() {
    this.basePath = path.resolve(env.STORAGE_LOCAL_PATH);
    this.ensureDirectory();
  }

  private async ensureDirectory() {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  private getFullPath(key: string): string {
    return path.join(this.basePath, key);
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const fullPath = this.getFullPath(key);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);
    return fs.readFile(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await fs.unlink(fullPath);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.getFullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    // Local storage doesn't support signed URLs - return file path
    return `file://${this.getFullPath(key)}`;
  }
}

export const localStorage = new LocalStorage();
