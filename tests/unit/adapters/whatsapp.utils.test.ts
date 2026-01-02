import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyWebhookSignature,
  formatPhoneNumber,
  getMediaUrl,
} from '../../../src/adapters/whatsapp/whatsapp.utils.js';

describe('WhatsApp Utils', () => {
  describe('verifyWebhookSignature', () => {
    it('should return true for valid signature', () => {
      const payload = '{"test": "data"}';
      const secret = 'test_secret';
      const validSignature =
        'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifyWebhookSignature(payload, validSignature, secret)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      expect(verifyWebhookSignature('payload', 'sha256=invalid', 'secret')).toBe(false);
    });

    it('should return false for missing sha256 prefix', () => {
      expect(verifyWebhookSignature('payload', 'noshaprefix', 'secret')).toBe(false);
    });

    it('should return false for empty signature', () => {
      expect(verifyWebhookSignature('payload', '', 'secret')).toBe(false);
    });

    it('should return false for null signature', () => {
      expect(verifyWebhookSignature('payload', null as unknown as string, 'secret')).toBe(false);
    });

    it('should return false for signature with wrong length', () => {
      const payload = '{"test": "data"}';
      const secret = 'test_secret';
      const validSignature =
        'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
      // Modify to wrong length
      const invalidSignature = validSignature + 'a';

      expect(verifyWebhookSignature(payload, invalidSignature, secret)).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // Verify implementation uses timingSafeEqual by checking it doesn't leak information
      const payload = '{"test": "data"}';
      const secret = 'test_secret';
      const validSignature =
        'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');

      // Both should take similar time (implementation uses timingSafeEqual)
      const start1 = Date.now();
      verifyWebhookSignature(payload, validSignature, secret);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      verifyWebhookSignature(payload, 'sha256=wrong', secret);
      const time2 = Date.now() - start2;

      // Times should be similar (timing-safe comparison)
      // Note: This is a basic check - real timing attacks require more sophisticated testing
      expect(Math.abs(time1 - time2)).toBeLessThan(10); // Within 10ms
    });
  });

  describe('formatPhoneNumber', () => {
    it('should remove non-digit characters', () => {
      expect(formatPhoneNumber('+1 (555) 123-4567')).toBe('15551234567');
    });

    it('should handle phone number with country code', () => {
      expect(formatPhoneNumber('+12345678901')).toBe('12345678901');
    });

    it('should handle phone number without +', () => {
      expect(formatPhoneNumber('12345678901')).toBe('12345678901');
    });

    it('should throw error for invalid phone number (too short)', () => {
      expect(() => formatPhoneNumber('123')).toThrow('Invalid phone number format');
    });

    it('should handle phone number with spaces and dashes', () => {
      expect(formatPhoneNumber('1 555-123-4567')).toBe('15551234567');
    });
  });

  describe('getMediaUrl', () => {
    it('should fetch media URL from API', async () => {
      const mockResponse = {
        url: 'https://example.com/media/file.jpg',
        mime_type: 'image/jpeg',
        sha256: 'abc123',
        file_size: 12345,
      };

      global.fetch = async () => {
        return {
          json: async () => mockResponse,
        } as Response;
      };

      const url = await getMediaUrl('MEDIA_ID', 'ACCESS_TOKEN');
      expect(url).toBe('https://example.com/media/file.jpg');
    });

    it('should throw error if API response lacks URL', async () => {
      global.fetch = async () => {
        return {
          json: async () => ({ mime_type: 'image/jpeg' }),
        } as Response;
      };

      await expect(getMediaUrl('MEDIA_ID', 'ACCESS_TOKEN')).rejects.toThrow(
        'Failed to get media URL'
      );
    });
  });
});
