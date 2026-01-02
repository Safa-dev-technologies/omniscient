import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Channel } from '@prisma/client';

// Mock all external dependencies
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    channelConfig: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

vi.mock('../../../src/modules/chat/chat.service.js', () => ({
  processChat: vi.fn(),
}));

vi.mock('../../../src/utils/crypto.js', () => ({
  decryptJson: vi.fn(() => ({
    phoneNumberId: 'PHONE_ID',
    accessToken: 'ACCESS_TOKEN',
    webhookVerifyToken: 'VERIFY_TOKEN',
  })),
}));

vi.mock('../../../src/adapters/whatsapp/index.js', () => ({
  WhatsAppAdapter: class MockWhatsAppAdapter {
    parseIncoming = vi.fn();
    sendMessage = vi.fn();
    initialize = vi.fn();
  },
}));

vi.mock('../../../src/adapters/telegram/index.js', () => ({
  TelegramAdapter: class MockTelegramAdapter {
    parseIncoming = vi.fn();
    sendMessage = vi.fn();
    initialize = vi.fn();
  },
}));

vi.mock('../../../src/adapters/web/index.js', () => ({
  WebAdapter: class MockWebAdapter {
    parseIncoming = vi.fn();
    sendMessage = vi.fn();
    initialize = vi.fn();
  },
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import * as webhookService from '../../../src/webhooks/webhook.service.js';
import { prisma } from '../../../src/lib/prisma.js';

describe('Webhook Service', () => {
  const mockTenant = {
    id: 'tenant-123',
    name: 'Test Tenant',
    slug: 'test-tenant',
    botName: 'TestBot',
    systemPrompt: 'You are a helpful assistant.',
    fallbackMessage: 'Sorry, I could not understand.',
  };

  const mockChannelConfig = {
    id: 'config-123',
    tenantId: 'tenant-123',
    channel: 'WHATSAPP' as Channel,
    enabled: true,
    credentials: 'encrypted_credentials',
    webhookUrl: 'https://example.com/webhook',
    webhookSecret: 'secret123',
    settings: null,
    tenant: mockTenant,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear adapter cache between tests
    webhookService.clearAdapterCache('tenant-123');
    webhookService.clearAdapterCache('tenant-456');
    webhookService.clearAdapterCache('tenant-789');
  });

  describe('clearAdapterCache', () => {
    it('should clear adapter cache for specific tenant/channel', () => {
      webhookService.clearAdapterCache('test-tenant', Channel.WHATSAPP);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should clear all adapters for tenant when channel not specified', () => {
      webhookService.clearAdapterCache('test-tenant');
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('getAdapter', () => {
    it('should throw error for non-existent channel config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(webhookService.getAdapter('tenant-789', Channel.TELEGRAM)).rejects.toThrow(
        'Channel config not found'
      );
    });

    it('should throw error for disabled channel', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
        ...mockChannelConfig,
        tenantId: 'tenant-456',
        enabled: false,
      } as any);

      await expect(webhookService.getAdapter('tenant-456', Channel.WHATSAPP)).rejects.toThrow(
        'Channel WHATSAPP is disabled for tenant'
      );
    });

    it('should create adapter for valid config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig as any);

      const adapter = await webhookService.getAdapter('tenant-123', Channel.WHATSAPP);

      expect(adapter).toBeDefined();
      expect(prisma.channelConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should cache adapter on subsequent calls', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig as any);

      const adapter1 = await webhookService.getAdapter('tenant-123', Channel.WHATSAPP);
      const adapter2 = await webhookService.getAdapter('tenant-123', Channel.WHATSAPP);

      // Same instance should be returned
      expect(adapter1).toBe(adapter2);
      // Config should only be fetched once due to caching
      expect(prisma.channelConfig.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleError', () => {
    it('should return error result without exposing internal details', () => {
      const error = new Error('Internal database error with sensitive info');
      const result = webhookService.handleError(error, Channel.WHATSAPP, 'test-tenant');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error processing webhook');
      expect(result.error).not.toContain('database');
      expect(result.error).not.toContain('sensitive');
    });

    it('should handle errors with no message', () => {
      const error = new Error();
      const result = webhookService.handleError(error, Channel.TELEGRAM, 'test-tenant');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error processing webhook');
    });

    it('should mask SQL injection errors', () => {
      const error = new Error('SQL syntax error near DROP TABLE users');
      const result = webhookService.handleError(error, Channel.WEB, 'test-tenant');

      expect(result.error).toBe('Internal error processing webhook');
      expect(result.error).not.toContain('SQL');
      expect(result.error).not.toContain('DROP');
    });

    it('should mask connection errors', () => {
      const error = new Error('Connection refused to database at 192.168.1.100:5432');
      const result = webhookService.handleError(error, Channel.WHATSAPP, 'test-tenant');

      expect(result.error).toBe('Internal error processing webhook');
      expect(result.error).not.toContain('192.168');
      expect(result.error).not.toContain('5432');
    });

    it('should mask authentication errors', () => {
      const error = new Error('Authentication failed for user admin with password');
      const result = webhookService.handleError(error, Channel.TELEGRAM, 'test-tenant');

      expect(result.error).toBe('Internal error processing webhook');
      expect(result.error).not.toContain('admin');
      expect(result.error).not.toContain('password');
    });

    it('should handle TypeError', () => {
      const error = new TypeError('Cannot read property of undefined');
      const result = webhookService.handleError(error, Channel.WEB, 'test-tenant');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error processing webhook');
    });

    it('should handle ReferenceError', () => {
      const error = new ReferenceError('someVariable is not defined');
      const result = webhookService.handleError(error, Channel.WHATSAPP, 'test-tenant');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error processing webhook');
    });
  });
});
