import { describe, it, expect } from 'vitest';
import { estimateTokens, truncateToTokenLimit } from '../../../src/utils/token-counter.js';

describe('Token Counter Utilities', () => {
  describe('estimateTokens', () => {
    it('should estimate ~4 characters per token', () => {
      const text = 'Hello World'; // 11 chars
      const tokens = estimateTokens(text);

      // 11 / 4 = 2.75, ceil = 3
      expect(tokens).toBe(3);
    });

    it('should return 0 for empty string', () => {
      const tokens = estimateTokens('');

      expect(tokens).toBe(0);
    });

    it('should ceil the result', () => {
      // 5 chars / 4 = 1.25, should be 2
      const tokens = estimateTokens('Hello');

      expect(tokens).toBe(2);
    });

    it('should handle exact multiples of 4', () => {
      // 8 chars / 4 = 2
      const tokens = estimateTokens('12345678');

      expect(tokens).toBe(2);
    });

    it('should handle single character', () => {
      const tokens = estimateTokens('a');

      // 1 / 4 = 0.25, ceil = 1
      expect(tokens).toBe(1);
    });

    it('should handle long text', () => {
      const text = 'x'.repeat(1000);
      const tokens = estimateTokens(text);

      // 1000 / 4 = 250
      expect(tokens).toBe(250);
    });

    it('should handle text with spaces and punctuation', () => {
      const text = 'Hello, World! How are you?'; // 26 chars
      const tokens = estimateTokens(text);

      // 26 / 4 = 6.5, ceil = 7
      expect(tokens).toBe(7);
    });

    it('should handle unicode characters', () => {
      const text = '😀😁😂🤣'; // 4 emoji chars (but each may be multiple bytes)
      const tokens = estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('should not truncate text within limit', () => {
      const text = 'Hello World'; // 11 chars = ~3 tokens
      const result = truncateToTokenLimit(text, 10); // 10 tokens = 40 chars

      expect(result).toBe(text);
    });

    it('should truncate text exceeding limit', () => {
      const text = 'x'.repeat(100); // 100 chars = 25 tokens
      const result = truncateToTokenLimit(text, 10); // 10 tokens = 40 chars

      // Should be 40 - 3 = 37 chars + '...'
      expect(result).toHaveLength(40);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should add ellipsis when truncating', () => {
      const text = 'This is a very long text that needs to be truncated';
      const result = truncateToTokenLimit(text, 5); // 5 tokens = 20 chars

      expect(result.endsWith('...')).toBe(true);
    });

    it('should return exact text when at limit', () => {
      const text = 'x'.repeat(40); // 40 chars = 10 tokens
      const result = truncateToTokenLimit(text, 10);

      expect(result).toBe(text);
    });

    it('should handle empty text', () => {
      const result = truncateToTokenLimit('', 10);

      expect(result).toBe('');
    });

    it('should handle zero token limit', () => {
      const text = 'Hello';
      const result = truncateToTokenLimit(text, 0);

      // 0 tokens = 0 chars, but -3 for ellipsis = negative, so substring handles it
      expect(result).toBe('...');
    });

    it('should handle small token limit', () => {
      const text = 'Hello World';
      const result = truncateToTokenLimit(text, 1); // 1 token = 4 chars

      // 4 - 3 = 1 char + '...' = 4 chars total
      expect(result).toHaveLength(4);
      expect(result).toBe('H...');
    });

    it('should preserve content before truncation point', () => {
      const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 26 chars
      const result = truncateToTokenLimit(text, 3); // 3 tokens = 12 chars

      // 12 - 3 = 9 chars + '...'
      expect(result).toBe('ABCDEFGHI...');
    });

    it('should handle large token limits', () => {
      const text = 'Short text';
      const result = truncateToTokenLimit(text, 10000);

      expect(result).toBe(text);
    });
  });
});
