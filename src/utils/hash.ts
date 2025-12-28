import crypto from 'node:crypto';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(environment: 'live' | 'test' = 'live'): {
  key: string;
  hash: string;
  prefix: string;
} {
  const random = crypto.randomBytes(24).toString('base64url');
  const key = `omni_${environment}_${random}`;
  const hash = hashApiKey(key);
  const prefix = key.substring(0, 16);

  return { key, hash, prefix };
}

export function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}
