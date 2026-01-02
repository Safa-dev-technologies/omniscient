import crypto from 'node:crypto';
import { env } from '../config/index.js';
import { logger } from '../lib/logger.js';

/**
 * Encryption utility for sensitive data (credentials, tokens, etc.)
 * Uses AES-256-GCM for authenticated encryption
 *
 * ⚠️ SECURITY: Never log encrypted values or keys
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits for GCM tag
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment
 * Key should be a 64-character hex string (32 bytes = 256 bits)
 */
/**
 * Get encryption key from environment
 * Key should be a 64-character hex string (32 bytes = 256 bits)
 *
 * ⚠️ SECURITY: In production, this MUST be set. For development, a warning is logged.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    // In development, warn but don't fail (allows running without encryption key for testing)
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(
        "ENCRYPTION_KEY not set. Credentials will not be encrypted. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
      // Return a default key for development (DO NOT USE IN PRODUCTION)
      return crypto.randomBytes(32);
    }
    throw new Error(
      "ENCRYPTION_KEY environment variable is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt data using AES-256-GCM
 *
 * @param plaintext - Data to encrypt (string or Buffer)
 * @returns Encrypted data as hex string (format: iv:tag:ciphertext)
 */
export function encrypt(plaintext: string | Buffer): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Combine IV, tag, and ciphertext as hex strings
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    logger.error({ error }, 'Encryption failed');
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data encrypted with encrypt()
 *
 * @param encryptedData - Encrypted data as hex string (format: iv:tag:ciphertext)
 * @returns Decrypted data as Buffer
 * @throws Error if decryption fails (invalid key, corrupted data, etc.)
 */
export function decrypt(encryptedData: string): Buffer {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, tagHex, ciphertextHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    logger.error({ error }, 'Decryption failed');
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Decrypt data and return as string
 *
 * @param encryptedData - Encrypted data as hex string
 * @returns Decrypted data as UTF-8 string
 */
export function decryptToString(encryptedData: string): string {
  return decrypt(encryptedData).toString('utf8');
}

/**
 * Encrypt JSON object
 *
 * @param obj - Object to encrypt
 * @returns Encrypted JSON string
 */
export function encryptJson(obj: Record<string, unknown>): string {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
}

/**
 * Decrypt JSON object
 *
 * @param encryptedData - Encrypted JSON string
 * @returns Decrypted object
 */
export function decryptJson<T = Record<string, unknown>>(encryptedData: string): T {
  const jsonString = decryptToString(encryptedData);
  return JSON.parse(jsonString) as T;
}

/**
 * Generate a secure random webhook secret
 *
 * @param length - Number of bytes (default: 32)
 * @returns Hex string
 */
export function generateWebhookSecret(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
