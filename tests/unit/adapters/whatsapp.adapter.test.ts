import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Channel } from '@prisma/client';
import { WhatsAppAdapter } from '../../../src/adapters/whatsapp/whatsapp.adapter.js';
import {
  mockWhatsAppTextMessage,
  mockWhatsAppStatusUpdate,
  mockWhatsAppImageMessage,
  mockWhatsAppButtonMessage,
  mockWhatsAppApiSuccess,
  mockWhatsAppApiError,
  mockWhatsAppCredentials,
} from '../../fixtures/whatsapp.fixtures.js';
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

// Mock env
vi.mock('../../../src/config/index.js', () => ({
  env: {},
}));

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;

  beforeEach(async () => {
    adapter = new WhatsAppAdapter();
    await adapter.initialize({
      tenantId: 'test-tenant',
      channel: Channel.WHATSAPP,
      credentials: mockWhatsAppCredentials,
    } as AdapterConfig);
  });

  describe('initialize', () => {
    it('should initialize successfully with valid credentials', async () => {
      const newAdapter = new WhatsAppAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.WHATSAPP,
          credentials: mockWhatsAppCredentials,
        } as AdapterConfig)
      ).resolves.not.toThrow();
    });

    it('should throw error for invalid channel', async () => {
      const newAdapter = new WhatsAppAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.TELEGRAM,
          credentials: mockWhatsAppCredentials,
        } as AdapterConfig)
      ).rejects.toThrow('Invalid channel for WhatsAppAdapter');
    });

    it('should throw error for missing credentials', async () => {
      const newAdapter = new WhatsAppAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.WHATSAPP,
          credentials: {} as any,
        } as AdapterConfig)
      ).rejects.toThrow('Missing required WhatsApp credentials');
    });
  });

  describe('verifyWebhook', () => {
    it('should return challenge for valid verify token', () => {
      const result = adapter.verifyWebhook({
        mode: 'subscribe',
        token: mockWhatsAppCredentials.webhookVerifyToken,
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(true);
      expect(result.challenge).toBe('challenge_string');
    });

    it('should reject invalid verify token', () => {
      const result = adapter.verifyWebhook({
        mode: 'subscribe',
        token: 'WRONG_TOKEN',
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(false);
    });

    it('should reject non-subscribe mode', () => {
      const result = adapter.verifyWebhook({
        mode: 'unsubscribe',
        token: mockWhatsAppCredentials.webhookVerifyToken,
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(false);
    });

    it('should return false if not initialized', () => {
      const newAdapter = new WhatsAppAdapter();
      const result = newAdapter.verifyWebhook({
        mode: 'subscribe',
        token: 'token',
        challenge: 'challenge',
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('parseIncoming', () => {
    it('should parse text message correctly', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppTextMessage);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello, I need help');
      expect(result!.externalUserId).toBe('15559876543');
      expect(result!.channel).toBe(Channel.WHATSAPP);
      expect(result!.contentType).toBe('text');
      expect(result!.hasMedia).toBe(false);
    });

    it('should return null for status updates', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppStatusUpdate);

      expect(result).toBeNull();
    });

    it('should parse image message with hasMedia=true', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppImageMessage);

      expect(result).not.toBeNull();
      expect(result!.hasMedia).toBe(true);
      expect(result!.contentType).toBe('image');
      expect(result!.mediaType).toBe('image/jpeg');
      expect(result!.metadata?.mediaId).toBeDefined();
    });

    it('should parse button/interactive message', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppButtonMessage);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('option1'); // Button ID
      expect(result!.contentType).toBe('text');
    });

    it('should include sender name in metadata', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppTextMessage);

      expect(result!.senderName).toBe('John Doe');
      expect(result!.senderPhone).toBe('15559876543');
    });

    it('should handle malformed payload gracefully', async () => {
      // Payload without entry array should return null (no messages found)
      const result = await adapter.parseIncoming({ invalid: 'data' } as any);
      expect(result).toBeNull();
    });

    it('should throw error if signature verification fails when appSecret is set', async () => {
      // Mock adapter with appSecret for signature verification
      const adapterWithSecret = new WhatsAppAdapter();
      await adapterWithSecret.initialize({
        tenantId: 'test-tenant',
        channel: Channel.WHATSAPP,
        credentials: { ...mockWhatsAppCredentials, appSecret: 'test_secret' },
      } as AdapterConfig);

      // Try with missing signature header (should fail)
      await expect(adapterWithSecret.parseIncoming(mockWhatsAppTextMessage, {})).rejects.toThrow(
        'Missing webhook signature'
      );

      // Try with invalid signature (should fail)
      await expect(
        adapterWithSecret.parseIncoming(mockWhatsAppTextMessage, {
          'x-hub-signature-256': 'sha256=invalid',
        })
      ).rejects.toThrow('Invalid webhook signature');
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should send text message successfully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWhatsAppApiSuccess,
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.xxx');
    });

    it('should handle API error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWhatsAppApiError,
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid access token');
    });

    it('should reject empty content', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject whitespace-only content', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: '   \n\t  ',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject content exceeding 4096 characters', async () => {
      const longContent = 'x'.repeat(5000);
      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: longContent,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('should format phone number correctly', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWhatsAppApiSuccess,
      } as Response);

      await adapter.sendMessage({
        externalUserId: '+1 (555) 987-6543',
        content: 'Hello!',
      });

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.to).toBe('15559876543'); // Formatted phone number (removed non-digits)
    });

    it('should send interactive message with buttons', async () => {
      const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockWhatsAppApiSuccess,
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Choose an option',
        buttons: [
          { id: 'opt1', text: 'Option 1', payload: 'opt1' },
          { id: 'opt2', text: 'Option 2', payload: 'opt2' },
        ],
      });

      expect(result.success).toBe(true);

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.type).toBe('interactive');
      expect(body.interactive.type).toBe('button');
      expect(body.interactive.action.buttons).toHaveLength(2);
    });

    it('should limit buttons to 3', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Choose',
        buttons: [
          { id: '1', text: '1', payload: '1' },
          { id: '2', text: '2', payload: '2' },
          { id: '3', text: '3', payload: '3' },
          { id: '4', text: '4', payload: '4' },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Too many buttons');
    });

    it('should handle network errors', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('isHealthy', () => {
    it('should return true when initialized', async () => {
      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(true);
    });
  });
});
