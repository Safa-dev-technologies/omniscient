import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Channel } from '@prisma/client';
import { WebAdapter } from '../../../src/adapters/web/web.adapter.js';
import {
  mockWebMessage,
  mockWebMessageNoSession,
  mockWebMessageEmpty,
  mockWebMessageTooLong,
  mockWebCredentials,
} from '../../fixtures/web.fixtures.js';
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

// Mock session manager
const mockGetOrCreateSession = vi.fn();
vi.mock('../../../src/adapters/web/web.session.js', async () => {
  const actual = await vi.importActual('../../../src/adapters/web/web.session.js');
  return {
    ...actual,
    createSessionManager: vi.fn(() => ({
      getOrCreateSession: mockGetOrCreateSession,
      getSession: vi.fn(),
      touchSession: vi.fn(),
      linkConversation: vi.fn(),
      validateSession: vi.fn(async () => true),
      deleteSession: vi.fn(),
    })),
  };
});

describe('WebAdapter', () => {
  let adapter: WebAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetOrCreateSession.mockImplementation(async (tenantId: string, sessionId?: string) => ({
      sessionId: sessionId || '550e8400-e29b-41d4-a716-446655440000',
      tenantId,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    }));

    adapter = new WebAdapter();
    await adapter.initialize({
      tenantId: 'test-tenant',
      channel: Channel.WEB,
      credentials: mockWebCredentials,
    } as AdapterConfig);
  });

  describe('initialize', () => {
    it('should initialize successfully with valid credentials', async () => {
      const newAdapter = new WebAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.WEB,
          credentials: mockWebCredentials,
        } as AdapterConfig)
      ).resolves.not.toThrow();
    });

    it('should throw error for invalid channel', async () => {
      const newAdapter = new WebAdapter();
      await expect(
        newAdapter.initialize({
          tenantId: 'test-tenant',
          channel: Channel.WHATSAPP,
          credentials: mockWebCredentials,
        } as AdapterConfig)
      ).rejects.toThrow('Invalid channel for WebAdapter');
    });
  });

  describe('validateOrigin', () => {
    it('should return true for allowed origin', () => {
      expect(adapter.validateOrigin('https://example.com')).toBe(true);
    });

    it('should return false for disallowed origin', () => {
      expect(adapter.validateOrigin('https://evil.com')).toBe(false);
    });

    it('should handle trailing slashes', () => {
      const adapterWithTrailingSlash = new WebAdapter();
      adapterWithTrailingSlash.initialize({
        tenantId: 'test-tenant',
        channel: Channel.WEB,
        credentials: {
          allowedOrigins: ['https://example.com/'],
          rateLimit: 20,
          sessionTimeout: 30,
        },
      } as AdapterConfig);

      expect(adapterWithTrailingSlash.validateOrigin('https://example.com')).toBe(true);
      expect(adapterWithTrailingSlash.validateOrigin('https://example.com/')).toBe(true);
    });

    it('should be case-insensitive', () => {
      const adapterCaseSensitive = new WebAdapter();
      adapterCaseSensitive.initialize({
        tenantId: 'test-tenant',
        channel: Channel.WEB,
        credentials: {
          allowedOrigins: ['https://Example.com'],
          rateLimit: 20,
          sessionTimeout: 30,
        },
      } as AdapterConfig);

      expect(adapterCaseSensitive.validateOrigin('https://example.com')).toBe(true);
    });

    it('should return false for null origin', () => {
      expect(adapter.validateOrigin(null as unknown as string)).toBe(false);
    });

    it('should return false for empty origin', () => {
      expect(adapter.validateOrigin('')).toBe(false);
    });
  });

  describe('parseIncoming', () => {
    it('should parse valid message correctly', async () => {
      const result = await adapter.parseIncoming(mockWebMessage, {
        origin: 'https://example.com',
      });

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello, I need help');
      expect(result!.externalUserId).toBeDefined();
      expect(result!.channel).toBe(Channel.WEB);
      expect(result!.contentType).toBe('text');
      expect(result!.hasMedia).toBe(false);
    });

    it('should create new session if sessionId not provided', async () => {
      const result = await adapter.parseIncoming(mockWebMessageNoSession, {
        origin: 'https://example.com',
      });

      expect(result).not.toBeNull();
      expect(result!.externalUserId).toBeDefined();
    });

    it('should reject empty content', async () => {
      await expect(
        adapter.parseIncoming(mockWebMessageEmpty, {
          origin: 'https://example.com',
        })
      ).rejects.toThrow('Message content cannot be empty');
    });

    it('should reject content exceeding 4096 characters', async () => {
      await expect(
        adapter.parseIncoming(mockWebMessageTooLong, {
          origin: 'https://example.com',
        })
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should reject invalid origin', async () => {
      await expect(
        adapter.parseIncoming(mockWebMessage, {
          origin: 'https://evil.com',
        })
      ).rejects.toThrow('Invalid origin');
    });

    it('should return null for file uploads (not yet supported)', async () => {
      const fileMessage = {
        ...mockWebMessage,
        contentType: 'file',
      };

      const result = await adapter.parseIncoming(fileMessage, {
        origin: 'https://example.com',
      });

      expect(result).toBeNull();
    });

    it('should handle invalid session ID format (delegates to session manager)', async () => {
      // Mock session manager to throw error for invalid session ID
      mockGetOrCreateSession.mockRejectedValueOnce(new Error('Invalid session ID format'));

      const invalidSessionMessage = {
        ...mockWebMessage,
        sessionId: 'not-a-uuid',
      };

      // Session manager will throw for invalid format
      await expect(
        adapter.parseIncoming(invalidSessionMessage, {
          origin: 'https://example.com',
        })
      ).rejects.toThrow('Invalid session ID format');
    });
  });

  describe('sendMessage', () => {
    it('should throw error (web adapter does not support sendMessage)', async () => {
      await expect(
        adapter.sendMessage({
          externalUserId: 'session-123',
          content: 'Hello',
        })
      ).rejects.toThrow('Web adapter does not support sendMessage');
    });
  });

  describe('getWidgetConfig', () => {
    it('should return widget configuration', () => {
      const tenant = {
        slug: 'test-tenant',
        botName: 'TestBot',
        welcomeMessage: 'Welcome!',
        settings: {
          widget: {
            primaryColor: '#FF0000',
            position: 'left',
            placeholder: 'Type here...',
          },
        },
      };

      const config = adapter.getWidgetConfig(tenant as any);

      expect(config.tenantSlug).toBe('test-tenant');
      expect(config.botName).toBe('TestBot');
      expect(config.welcomeMessage).toBe('Welcome!');
      expect(config.primaryColor).toBe('#FF0000');
      expect(config.position).toBe('left');
      expect(config.placeholder).toBe('Type here...');
    });

    it('should use default values when settings not provided', () => {
      const tenant = {
        slug: 'test-tenant',
        botName: 'TestBot',
        welcomeMessage: null,
        settings: null,
      };

      const config = adapter.getWidgetConfig(tenant as any);

      expect(config.primaryColor).toBe('#0066cc');
      expect(config.position).toBe('right');
      expect(config.placeholder).toBe('Type your message...');
    });
  });

  describe('isHealthy', () => {
    it('should return true when initialized', async () => {
      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(true);
    });
  });
});
