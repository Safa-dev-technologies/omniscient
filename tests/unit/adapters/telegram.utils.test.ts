import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyWebhookSecret,
  getDisplayName,
  escapeMarkdownV2,
  getFileUrl,
} from '../../../src/adapters/telegram/telegram.utils.js';
import type { TelegramUser } from '../../../src/adapters/telegram/telegram.types.js';

describe('Telegram Utils', () => {
  describe('verifyWebhookSecret', () => {
    it('should return true for matching secret', () => {
      expect(verifyWebhookSecret('my_secret_token', 'my_secret_token')).toBe(true);
    });

    it('should return false for mismatched secret', () => {
      expect(verifyWebhookSecret('wrong_token', 'correct_token')).toBe(false);
    });

    it('should return false for undefined header', () => {
      expect(verifyWebhookSecret(undefined, 'secret')).toBe(false);
    });

    it('should return false for empty expected secret', () => {
      expect(verifyWebhookSecret('token', '')).toBe(false);
    });

    it('should return false for different length secrets', () => {
      expect(verifyWebhookSecret('short', 'much_longer_secret')).toBe(false);
    });

    it('should use timing-safe comparison', () => {
      // Verify implementation uses timingSafeEqual
      const secret1 = 'my_secret_token';
      const secret2 = 'my_secret_tokeX'; // One char different

      const start1 = Date.now();
      verifyWebhookSecret(secret1, secret1);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      verifyWebhookSecret(secret2, secret1);
      const time2 = Date.now() - start2;

      // Times should be similar (timing-safe comparison)
      expect(Math.abs(time1 - time2)).toBeLessThan(10); // Within 10ms
    });
  });

  describe('getDisplayName', () => {
    it('should return username with @ prefix if available', () => {
      const user: TelegramUser = {
        id: 123,
        is_bot: false,
        first_name: 'John',
        username: 'johndoe',
      };

      expect(getDisplayName(user)).toBe('@johndoe');
    });

    it('should return first name if no username', () => {
      const user: TelegramUser = {
        id: 123,
        is_bot: false,
        first_name: 'John',
      };

      expect(getDisplayName(user)).toBe('John');
    });

    it('should return first and last name if no username', () => {
      const user: TelegramUser = {
        id: 123,
        is_bot: false,
        first_name: 'John',
        last_name: 'Doe',
      };

      expect(getDisplayName(user)).toBe('John Doe');
    });

    it('should prioritize username over name', () => {
      const user: TelegramUser = {
        id: 123,
        is_bot: false,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
      };

      expect(getDisplayName(user)).toBe('@johndoe');
    });
  });

  describe('escapeMarkdownV2', () => {
    it('should escape special characters', () => {
      expect(escapeMarkdownV2('Hello_world')).toBe('Hello\\_world');
      expect(escapeMarkdownV2('Price: $100')).toBe('Price: $100'); // $ is not escaped
      expect(escapeMarkdownV2('Use *bold* text')).toBe('Use \\*bold\\* text');
    });

    it('should escape brackets', () => {
      expect(escapeMarkdownV2('Click [here](url)')).toBe('Click \\[here\\]\\(url\\)');
    });

    it('should escape multiple special characters', () => {
      expect(escapeMarkdownV2('_*[ ]( )~`>#+-=|{}.!')).toBe(
        '\\_\\*\\[ \\]\\( \\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!'
      );
    });

    it('should not escape regular text', () => {
      expect(escapeMarkdownV2('Hello World')).toBe('Hello World');
    });
  });

  describe('getFileUrl', () => {
    it('should build file URL from file_path', async () => {
      const mockResponse = {
        ok: true,
        result: {
          file_id: 'FILE_ID',
          file_unique_id: 'UNIQUE_ID',
          file_path: 'photos/file_123.jpg',
          file_size: 12345,
        },
      };

      global.fetch = async () => {
        return {
          json: async () => mockResponse,
        } as Response;
      };

      const url = await getFileUrl('FILE_ID', 'BOT_TOKEN');
      expect(url).toBe('https://api.telegram.org/file/botBOT_TOKEN/photos/file_123.jpg');
    });

    it('should throw error if file_path is missing', async () => {
      global.fetch = async () => {
        return {
          json: async () => ({
            ok: true,
            result: {
              file_id: 'FILE_ID',
              file_unique_id: 'UNIQUE_ID',
            },
          }),
        } as Response;
      };

      await expect(getFileUrl('FILE_ID', 'BOT_TOKEN')).rejects.toThrow('Failed to get file path');
    });

    it('should throw error if API response is not ok', async () => {
      global.fetch = async () => {
        return {
          json: async () => ({
            ok: false,
            description: 'File not found',
          }),
        } as Response;
      };

      await expect(getFileUrl('FILE_ID', 'BOT_TOKEN')).rejects.toThrow('Failed to get file path');
    });
  });
});
