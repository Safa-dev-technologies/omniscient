import { describe, it, expect } from 'vitest';
import { crawlUrlSchema } from '../../../src/modules/knowledge/knowledge.schema.js';
import {
  isSafePattern,
  isValidRegex,
  safePatternSchema,
  MAX_PATTERNS_COUNT,
} from '../../../src/utils/regex-validator.js';

describe('Regex Validator', () => {
  describe('isSafePattern', () => {
    it('should accept simple patterns', () => {
      expect(isSafePattern('/blog/.*')).toBe(true);
      expect(isSafePattern('/docs/.*')).toBe(true);
      expect(isSafePattern('^/api/v[0-9]+/')).toBe(true);
    });

    it('should accept empty pattern', () => {
      expect(isSafePattern('')).toBe(true);
    });

    it('should reject patterns with nested quantifiers (ReDoS)', () => {
      expect(isSafePattern('(a+)+')).toBe(false);
      expect(isSafePattern('(a+)+b')).toBe(false);
      expect(isSafePattern('(.*)*')).toBe(false);
      expect(isSafePattern('([a-zA-Z]+)*')).toBe(false);
      expect(isSafePattern('(a?){25}')).toBe(false);
    });

    it('should reject patterns over 100 characters', () => {
      const longPattern = 'a'.repeat(101);
      expect(isSafePattern(longPattern)).toBe(false);
    });

    it('should accept patterns exactly at 100 characters', () => {
      const pattern = 'a'.repeat(100);
      expect(isSafePattern(pattern)).toBe(true);
    });
  });

  describe('isValidRegex', () => {
    it('should accept valid regex patterns', () => {
      expect(isValidRegex('/blog/.*')).toBe(true);
      expect(isValidRegex('^/api/v\\d+/')).toBe(true);
      expect(isValidRegex('[a-z]+')).toBe(true);
    });

    it('should reject invalid regex syntax', () => {
      expect(isValidRegex('[')).toBe(false);
      expect(isValidRegex('(')).toBe(false);
      expect(isValidRegex('*')).toBe(false);
      expect(isValidRegex('[z-a]')).toBe(false);
    });
  });

  describe('safePatternSchema', () => {
    it('should accept safe patterns', () => {
      const result = safePatternSchema.safeParse('/blog/.*');
      expect(result.success).toBe(true);
    });

    it('should reject ReDoS patterns', () => {
      const result = safePatternSchema.safeParse('(a+)+b');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Unsafe regex');
      }
    });

    it('should reject patterns over 100 chars', () => {
      const result = safePatternSchema.safeParse('a'.repeat(101));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('100 characters');
      }
    });

    it('should reject invalid regex syntax', () => {
      const result = safePatternSchema.safeParse('[');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Invalid regex');
      }
    });
  });
});

describe('crawlUrlSchema pattern validation', () => {
  describe('includePatterns', () => {
    it('should accept valid safe patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: ['/blog/.*', '/docs/.*'] },
      });
      expect(result.success).toBe(true);
    });

    it('should reject ReDoS patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: ['(a+)+b'] },
      });
      expect(result.success).toBe(false);
    });

    it('should reject nested quantifier patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: ['(.*)*'] },
      });
      expect(result.success).toBe(false);
    });

    it('should reject patterns over 100 chars', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: ['a'.repeat(101)] },
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than MAX_PATTERNS_COUNT patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: Array(MAX_PATTERNS_COUNT + 1).fill('/path/.*') },
      });
      expect(result.success).toBe(false);
    });

    it('should accept exactly MAX_PATTERNS_COUNT patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: Array(MAX_PATTERNS_COUNT).fill('/path/.*') },
      });
      expect(result.success).toBe(true);
    });

    it('should accept empty patterns array', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: [] },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('excludePatterns', () => {
    it('should accept valid safe patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { excludePatterns: ['/admin/.*', '/private/.*'] },
      });
      expect(result.success).toBe(true);
    });

    it('should reject ReDoS patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { excludePatterns: ['([a-zA-Z]+)*'] },
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than MAX_PATTERNS_COUNT patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { excludePatterns: Array(MAX_PATTERNS_COUNT + 1).fill('/path/.*') },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('both patterns together', () => {
    it('should accept valid include and exclude patterns together', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: {
          includePatterns: ['/blog/.*', '/docs/.*'],
          excludePatterns: ['/blog/draft/.*'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject if any pattern is unsafe', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: {
          includePatterns: ['/blog/.*'],
          excludePatterns: ['(a+)+'], // ReDoS pattern
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('without patterns', () => {
    it('should accept request without options', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should accept request with options but no patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: {
          crawlSitemap: true,
          maxDepth: 2,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should accept glob-like patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: {
          includePatterns: ['/products/[0-9]+', '/category/[a-z-]+', '/blog/\\d{4}/\\d{2}/'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid regex syntax in patterns', () => {
      const result = crawlUrlSchema.safeParse({
        url: 'https://example.com',
        options: { includePatterns: ['['] },
      });
      expect(result.success).toBe(false);
    });
  });
});
