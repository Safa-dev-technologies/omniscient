import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Channel } from '@prisma/client';
import { TelegramAdapter } from '../../../src/adapters/telegram/telegram.adapter.js';
import {
  mockTelegramTextMessage,
  mockTelegramCallbackQuery,
  mockTelegramPhotoMessage,
  mockTelegramSystemMessage,
  mockTelegramChannelPost,
  mockTelegramApiSuccess,
  mockTelegramApiError,
  mockTelegramCredentials,
} from '../../fixtures/telegram.fixtures.js';
import type { AdapterConfig } from '../../../src/adapters/adapter.types.js';

// Mock logger
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(async () => {
    adapter = new TelegramAdapter();

    // Mock getMe API call for initialization
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: 123456789,
          username: 'TestBot',
          first_name: 'Test Bot',
        },
      }),
    } as Response);

    await adapter.initialize({
      tenantId: 'test-tenant',
      channel: Channel.TELEGRAM,
      credentials: mockTelegramCredentials,
    } as AdapterConfig);
  });

  describe('initialize', () => {
    it('should initialize successfully with valid credentials', async () => {
      const newAdapter = new TelegramAdapter();
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            id: 123456789,
            username: 'TestBot',
            first_name: 'Test Bot',
          },
        }),
      } as Response);

      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.TELEGRAM,
          credentials: mockTelegramCredentials,
        } as AdapterConfig)
      ).resolves.not.toThrow();
    });

    it('should throw error for invalid channel', async () => {
      const newAdapter = new TelegramAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.WHATSAPP,
          credentials: mockTelegramCredentials,
        } as AdapterConfig)
      ).rejects.toThrow('Invalid channel for TelegramAdapter');
    });

    it('should throw error for invalid bot token', async () => {
      const newAdapter = new TelegramAdapter();
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Unauthorized',
        }),
      } as Response);

      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.TELEGRAM,
          credentials: mockTelegramCredentials,
        } as AdapterConfig)
      ).rejects.toThrow('Invalid bot token');
    });
  });

  describe('verifySignature', () => {
    it('should return true for matching secret', () => {
      const result = adapter.verifySignature?.('payload', mockTelegramCredentials.webhookSecret!);
      expect(result).toBe(true);
    });

    it('should return false for non-matching secret', () => {
      const result = adapter.verifySignature?.('payload', 'wrong_secret');
      expect(result).toBe(false);
    });

    it('should return false for empty secret', () => {
      const result = adapter.verifySignature?.('payload', '');
      expect(result).toBe(false);
    });
  });

  describe('parseIncoming', () => {
    const validHeaders = {
      'x-telegram-bot-api-secret-token': mockTelegramCredentials.webhookSecret!,
    };

    it('should parse text message correctly', async () => {
      const result = await adapter.parseIncoming(mockTelegramTextMessage, validHeaders);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello, I need help');
      expect(result!.externalUserId).toBe('987654321');
      expect(result!.channel).toBe(Channel.TELEGRAM);
      expect(result!.contentType).toBe('text');
      expect(result!.hasMedia).toBe(false);
      expect(result!.senderName).toBe('@johndoe');
      expect(result!.senderUsername).toBe('johndoe');
    });

    it('should parse callback query (button click)', async () => {
      const result = await adapter.parseIncoming(mockTelegramCallbackQuery, validHeaders);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('button_clicked');
      expect(result!.externalUserId).toBe('987654321');
      expect(result!.metadata?.isCallbackQuery).toBe(true);
    });

    it('should parse photo message with hasMedia=true', async () => {
      const result = await adapter.parseIncoming(mockTelegramPhotoMessage, validHeaders);

      expect(result).not.toBeNull();
      expect(result!.hasMedia).toBe(true);
      expect(result!.contentType).toBe('image');
      expect(result!.mediaType).toBe('image/jpeg');
      expect(result!.content).toBe('This is a photo'); // Caption
    });

    it('should return null for system messages', async () => {
      const result = await adapter.parseIncoming(mockTelegramSystemMessage, validHeaders);
      expect(result).toBeNull();
    });

    it('should return null for channel posts', async () => {
      const result = await adapter.parseIncoming(mockTelegramChannelPost, validHeaders);
      expect(result).toBeNull();
    });

    it('should handle malformed payload', async () => {
      // Payload that doesn't match TelegramUpdate structure should parse but return null
      // (no message or callback_query found)
      const malformedPayload = { update_id: 123 }; // Missing message and callback_query
      const result = await adapter.parseIncoming(malformedPayload, validHeaders);
      expect(result).toBeNull(); // No message to process
    });

    it('should reject message with invalid secret header', async () => {
      const invalidHeaders = {
        'x-telegram-bot-api-secret-token': 'wrong_secret',
      };

      await expect(adapter.parseIncoming(mockTelegramTextMessage, invalidHeaders)).rejects.toThrow(
        'Invalid webhook secret'
      );
    });

    it('should reject message with missing secret header', async () => {
      await expect(adapter.parseIncoming(mockTelegramTextMessage, {})).rejects.toThrow(
        'Invalid webhook secret'
      );
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should send text message successfully', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTelegramApiSuccess,
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('100');
    });

    it('should handle API error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTelegramApiError,
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid bot token');
    });

    it('should reject empty content', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject whitespace-only content', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: '   \n\t  ',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject content exceeding 4096 characters', async () => {
      const longContent = 'x'.repeat(5000);
      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: longContent,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('should reject too many buttons', async () => {
      const buttons = Array.from({ length: 101 }, (_, i) => ({
        id: `opt${i}`,
        text: `Option ${i}`,
        payload: `opt${i}`,
      }));

      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Choose',
        buttons,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many buttons');
    });

    it('should send message with inline keyboard', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTelegramApiSuccess,
      } as Response);
      global.fetch = mockFetch;

      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Choose an option',
        buttons: [
          { id: 'opt1', text: 'Option 1', payload: 'opt1' },
          { id: 'opt2', text: 'Option 2', payload: 'opt2' },
        ],
      });

      expect(result.success).toBe(true);

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.reply_markup).toBeDefined();
      expect(body.reply_markup.inline_keyboard).toHaveLength(1); // One row
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2); // Two buttons
    });

    it('should limit buttons per row (max 8)', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockTelegramApiSuccess,
      } as Response);
      global.fetch = mockFetch;

      const buttons = Array.from({ length: 10 }, (_, i) => ({
        id: `opt${i}`,
        text: `Option ${i}`,
        payload: `opt${i}`,
      }));

      await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Choose',
        buttons,
      });

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1]!.body as string);
      // Should be split into rows of 8
      expect(body.reply_markup.inline_keyboard.length).toBeGreaterThan(1);
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.sendMessage({
        externalUserId: '987654321',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('answerCallbackQuery', () => {
    it('should answer callback query successfully', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: true }),
      } as Response);

      const result = await adapter.answerCallbackQuery('callback123', 'Button clicked!');
      expect(result).toBe(true);
    });

    it('should handle API error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, description: 'Query timeout' }),
      } as Response);

      const result = await adapter.answerCallbackQuery('callback123');
      expect(result).toBe(false);
    });
  });

  describe('isHealthy', () => {
    it('should return true when initialized', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      } as Response);

      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should return false when API is down', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false }),
      } as Response);

      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(false);
    });
  });
});
