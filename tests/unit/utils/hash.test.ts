import { describe, it, expect } from 'vitest';
import { hashApiKey, generateApiKey, hashContent } from '../../../src/utils/hash.js';

describe('Hash Utilities', () => {
  describe('hashApiKey', () => {
    it('should produce consistent SHA256 hash', () => {
      const key = 'omni_live_abc123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should produce 64-character hex string', () => {
      const hash = hashApiKey('test-key');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashApiKey('');

      expect(hash).toHaveLength(64);
    });

    it('should handle special characters', () => {
      const hash = hashApiKey('key!@#$%^&*()');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('generateApiKey', () => {
    it('should generate key with live prefix by default', () => {
      const result = generateApiKey();

      expect(result.key).toMatch(/^omni_live_/);
    });

    it('should generate key with live prefix when specified', () => {
      const result = generateApiKey('live');

      expect(result.key).toMatch(/^omni_live_/);
    });

    it('should generate key with test prefix when specified', () => {
      const result = generateApiKey('test');

      expect(result.key).toMatch(/^omni_test_/);
    });

    it('should return valid hash of the key', () => {
      const result = generateApiKey();
      const expectedHash = hashApiKey(result.key);

      expect(result.hash).toBe(expectedHash);
    });

    it('should return prefix as first 16 characters', () => {
      const result = generateApiKey();

      expect(result.prefix).toBe(result.key.substring(0, 16));
      expect(result.prefix).toHaveLength(16);
    });

    it('should generate unique keys each time', () => {
      const result1 = generateApiKey();
      const result2 = generateApiKey();

      expect(result1.key).not.toBe(result2.key);
      expect(result1.hash).not.toBe(result2.hash);
    });

    it('should generate key with base64url random part', () => {
      const result = generateApiKey();
      // Key format: omni_{env}_{base64url} (base64url may contain underscores)
      expect(result.key).toMatch(/^omni_(live|test)_[A-Za-z0-9_-]+$/);
    });

    it('should generate sufficiently long key for security', () => {
      const result = generateApiKey();

      // 24 bytes in base64url = 32 chars, plus "omni_live_" = ~42+ chars
      expect(result.key.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe('hashContent', () => {
    it('should produce consistent MD5 hash', () => {
      const content = 'Hello, World!';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it('should produce 32-character hex string', () => {
      const hash = hashContent('test content');

      expect(hash).toHaveLength(32);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = hashContent('content1');
      const hash2 = hashContent('content2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashContent('');

      expect(hash).toHaveLength(32);
      // MD5 of empty string is d41d8cd98f00b204e9800998ecf8427e
      expect(hash).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    it('should handle unicode content', () => {
      const hash = hashContent('Hello, World!');

      expect(hash).toHaveLength(32);
    });

    it('should handle large content', () => {
      const largeContent = 'x'.repeat(100000);
      const hash = hashContent(largeContent);

      expect(hash).toHaveLength(32);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });
});
