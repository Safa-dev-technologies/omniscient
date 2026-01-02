import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockTenant } from '../../fixtures/tenant.fixtures.js';

// Mock all external dependencies
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
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

vi.mock('../../../src/utils/crypto.js', () => ({
  decryptJson: vi.fn(),
}));

vi.mock('../../../src/webhooks/webhook.service.js', () => ({
  processIncomingMessage: vi.fn(),
  handleError: vi.fn(() => ({ success: false, error: 'Internal error processing webhook' })),
  getAdapter: vi.fn(),
}));

vi.mock('../../../src/webhooks/webhook.middleware.js', () => ({
  resolveTenantFromWebhook: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  webhookRateLimit: vi.fn(),
  checkChannelEnabled: vi.fn(),
}));

vi.mock('../../../src/adapters/web/index.js', () => ({
  WebAdapter: class MockWebAdapter {
    validateOrigin = vi.fn();
    getWidgetConfig = vi.fn();
  },
}));

// Import after mocks
import {
  handleWhatsAppVerification,
  handleWhatsAppWebhook,
  handleTelegramWebhook,
  handleWebMessage,
  getWebWidgetConfig,
} from '../../../src/webhooks/webhook.controller.js';
import { prisma } from '../../../src/lib/prisma.js';
import { decryptJson } from '../../../src/utils/crypto.js';
import {
  processIncomingMessage,
  handleError,
  getAdapter,
} from '../../../src/webhooks/webhook.service.js';
import {
  resolveTenantFromWebhook,
  verifyWebhookSignature,
  webhookRateLimit,
  checkChannelEnabled,
} from '../../../src/webhooks/webhook.middleware.js';

// Helper to create mock request/reply
const createMockRequest = (overrides: any = {}) => ({
  query: {},
  body: {},
  params: {},
  headers: {},
  rawBody: Buffer.from('{}'),
  ...overrides,
});

const createMockReply = () => {
  const reply: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
  };
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((data: any) => {
    reply.body = data;
    return reply;
  });
  reply.type = vi.fn((contentType: string) => {
    reply.contentType = contentType;
    return reply;
  });
  reply.header = vi.fn((key: string, value: string) => {
    reply.headers[key] = value;
    return reply;
  });
  return reply;
};

describe('Webhook Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleWhatsAppVerification', () => {
    it('should return challenge for valid verification', async () => {
      const mockConfig = {
        tenantId: mockTenant.id,
        credentials: 'encrypted',
      };
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([mockConfig] as any);
      vi.mocked(decryptJson).mockReturnValue({ webhookVerifyToken: 'my-verify-token' });

      const request = createMockRequest({
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'my-verify-token',
          'hub.challenge': 'challenge123',
        },
      });
      const reply = createMockReply();

      await handleWhatsAppVerification(request as any, reply as any);

      expect(reply.type).toHaveBeenCalledWith('text/plain');
      expect(reply.send).toHaveBeenCalledWith('challenge123');
    });

    it('should return 403 for invalid verify token', async () => {
      const mockConfig = {
        tenantId: mockTenant.id,
        credentials: 'encrypted',
      };
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([mockConfig] as any);
      vi.mocked(decryptJson).mockReturnValue({ webhookVerifyToken: 'correct-token' });

      const request = createMockRequest({
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'challenge123',
        },
      });
      const reply = createMockReply();

      await handleWhatsAppVerification(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
    });

    it('should return 403 when mode is not subscribe', async () => {
      const request = createMockRequest({
        query: {
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'my-verify-token',
          'hub.challenge': 'challenge123',
        },
      });
      const reply = createMockReply();

      await handleWhatsAppVerification(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('should skip configs with decryption errors', async () => {
      const mockConfigs = [
        { tenantId: 'tenant-1', credentials: 'encrypted1' },
        { tenantId: 'tenant-2', credentials: 'encrypted2' },
      ];
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue(mockConfigs as any);
      vi.mocked(decryptJson)
        .mockImplementationOnce(() => {
          throw new Error('Decryption failed');
        })
        .mockReturnValueOnce({ webhookVerifyToken: 'my-verify-token' });

      const request = createMockRequest({
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'my-verify-token',
          'hub.challenge': 'challenge123',
        },
      });
      const reply = createMockReply();

      await handleWhatsAppVerification(request as any, reply as any);

      expect(reply.type).toHaveBeenCalledWith('text/plain');
      expect(reply.send).toHaveBeenCalledWith('challenge123');
    });
  });

  describe('handleWhatsAppWebhook', () => {
    it('should return 200 for unknown tenant (security)', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(null);

      const request = createMockRequest({ body: {} });
      const reply = createMockReply();

      await handleWhatsAppWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true });
    });

    it('should return 401 for invalid signature', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(verifyWebhookSignature).mockResolvedValue(false);

      const request = createMockRequest({ body: {} });
      const reply = createMockReply();

      await handleWhatsAppWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid signature' });
    });

    it('should process message and return 200', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
      vi.mocked(processIncomingMessage).mockResolvedValue({ success: true });

      const request = createMockRequest({
        body: { test: 'payload' },
        headers: { 'x-hub-signature-256': 'sha256=abc123' },
      });
      const reply = createMockReply();

      await handleWhatsAppWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true });
    });

    it('should return 200 even on error (WhatsApp requirement)', async () => {
      vi.mocked(resolveTenantFromWebhook).mockRejectedValue(new Error('Database error'));

      const request = createMockRequest({ body: {} });
      const reply = createMockReply();

      await handleWhatsAppWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handleTelegramWebhook', () => {
    it('should return 404 for unknown tenant', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(null);

      const request = createMockRequest({ params: { tenantSlug: 'unknown' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Tenant not found' });
    });

    it('should return 404 for non-configured channel', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: false, exists: false });

      const request = createMockRequest({ params: { tenantSlug: 'test-company' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Channel not configured' });
    });

    it('should return 503 for disabled channel', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: false, exists: true });

      const request = createMockRequest({ params: { tenantSlug: 'test-company' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Channel temporarily unavailable',
      });
    });

    it('should return 429 when rate limited', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: false, retryAfter: 30 });

      const request = createMockRequest({ params: { tenantSlug: 'test-company' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(429);
      expect(reply.header).toHaveBeenCalledWith('Retry-After', '30');
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Too many requests' });
    });

    it('should return 401 for invalid secret token', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });
      vi.mocked(verifyWebhookSignature).mockResolvedValue(false);

      const request = createMockRequest({ params: { tenantSlug: 'test-company' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid secret token' });
    });

    it('should return 500 when processing fails', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });
      vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
      vi.mocked(processIncomingMessage).mockResolvedValue({
        success: false,
        error: 'Processing failed',
      });

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        body: {},
        headers: {},
      });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Internal error' });
    });

    it('should return 200 on successful processing', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });
      vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
      vi.mocked(processIncomingMessage).mockResolvedValue({ success: true });

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        body: {},
        headers: {},
      });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true });
    });

    it('should handle errors with handleError', async () => {
      vi.mocked(resolveTenantFromWebhook).mockRejectedValue(new Error('Database error'));

      const request = createMockRequest({ params: { tenantSlug: 'test-company' } });
      const reply = createMockReply();

      await handleTelegramWebhook(request as any, reply as any);

      expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'TELEGRAM', 'test-company');
      expect(reply.status).toHaveBeenCalledWith(500);
    });
  });

  describe('handleWebMessage', () => {
    it('should return 404 for unknown tenant', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(null);

      const request = createMockRequest({ params: { tenantSlug: 'unknown' }, headers: {} });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Tenant not found' });
    });

    it('should return 503 for disabled channel', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: false, exists: true });

      const request = createMockRequest({ params: { tenantSlug: 'test-company' }, headers: {} });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(503);
    });

    it('should return 403 for invalid origin', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = {
        validateOrigin: vi.fn().mockReturnValue(false),
      };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: { origin: 'https://malicious.com' },
      });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Invalid origin' });
    });

    it('should set CORS headers for valid origin', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = {
        validateOrigin: vi.fn().mockReturnValue(true),
      };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });
      vi.mocked(processIncomingMessage).mockResolvedValue({ success: true });

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: { origin: 'https://example.com' },
        body: {},
      });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://example.com'
      );
      expect(reply.header).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('should return 429 when rate limited', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = {
        validateOrigin: vi.fn().mockReturnValue(true),
      };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: false, retryAfter: 45 });

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(429);
      expect(reply.header).toHaveBeenCalledWith('Retry-After', '45');
    });

    it('should return 400 when processing fails', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = { validateOrigin: vi.fn().mockReturnValue(true) };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });
      vi.mocked(processIncomingMessage).mockResolvedValue({
        success: false,
        error: 'Invalid message format',
      });

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: {},
        body: {},
      });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid message format',
      });
    });

    it('should return 200 with data on success', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = { validateOrigin: vi.fn().mockReturnValue(true) };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(webhookRateLimit).mockResolvedValue({ allowed: true });

      const mockResult = { success: true, response: 'Hello!' };
      vi.mocked(processIncomingMessage).mockResolvedValue(mockResult);

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: {},
        body: { message: 'Hi' },
      });
      const reply = createMockReply();

      await handleWebMessage(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true, data: mockResult });
    });
  });

  describe('getWebWidgetConfig', () => {
    it('should return 404 for unknown tenant', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(null);

      const request = createMockRequest({ params: { tenantSlug: 'unknown' }, headers: {} });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('should return 503 for disabled channel', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: false, exists: true });

      const request = createMockRequest({ params: { tenantSlug: 'test-company' }, headers: {} });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(503);
    });

    it('should return 403 for invalid origin', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = { validateOrigin: vi.fn().mockReturnValue(false) };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: { origin: 'https://malicious.com' },
      });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('should return widget config on success', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockConfig = {
        theme: 'dark',
        botName: 'TestBot',
        welcomeMessage: 'Hello!',
      };
      const mockAdapter = {
        validateOrigin: vi.fn().mockReturnValue(true),
        getWidgetConfig: vi.fn().mockReturnValue(mockConfig),
      };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
        slug: 'test-company',
        botName: 'TestBot',
        welcomeMessage: 'Hello!',
        settings: { theme: 'dark' },
      } as any);

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith({ success: true, data: mockConfig });
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://example.com'
      );
    });

    it('should return 404 when tenant not found in DB', async () => {
      vi.mocked(resolveTenantFromWebhook).mockResolvedValue(mockTenant);
      vi.mocked(checkChannelEnabled).mockResolvedValue({ enabled: true, exists: true });

      const mockAdapter = { validateOrigin: vi.fn().mockReturnValue(true) };
      vi.mocked(getAdapter).mockResolvedValue(mockAdapter as any);
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      const request = createMockRequest({
        params: { tenantSlug: 'test-company' },
        headers: {},
      });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Tenant not found' });
    });

    it('should handle errors with 500', async () => {
      vi.mocked(resolveTenantFromWebhook).mockRejectedValue(new Error('Database error'));

      const request = createMockRequest({ params: { tenantSlug: 'test-company' }, headers: {} });
      const reply = createMockReply();

      await getWebWidgetConfig(request as any, reply as any);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({ success: false, error: 'Internal error' });
    });
  });
});
