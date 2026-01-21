import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { mockTenant } from '../../fixtures/tenant.fixtures.js';
import { mockTelegramConfig } from '../../fixtures/channel.fixtures.js';

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

vi.mock('../../../src/lib/redis.js', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
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
  getAdapter: vi.fn(),
}));

// Import after mocks
import {
  resolveTenantFromWebhook,
  verifyWebhookSignature,
  webhookRateLimit,
  checkChannelEnabled,
} from '../../../src/webhooks/webhook.middleware.js';
import { prisma } from '../../../src/lib/prisma.js';
import { redis } from '../../../src/lib/redis.js';
import { decryptJson } from '../../../src/utils/crypto.js';
import { getAdapter } from '../../../src/webhooks/webhook.service.js';

describe('Webhook Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveTenantFromWebhook', () => {
    describe('WHATSAPP', () => {
      it('should resolve tenant from WhatsApp payload phone number ID', async () => {
        const mockConfig = {
          ...mockTelegramConfig,
          channel: 'WHATSAPP',
          tenant: mockTenant,
        };

        vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([mockConfig] as any);
        vi.mocked(decryptJson).mockReturnValue({ phoneNumberId: '123456789' });

        const request = {
          body: {
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: {
                        phone_number_id: '123456789',
                      },
                    },
                  },
                ],
              },
            ],
          },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('WHATSAPP', request);

        expect(result).toEqual(mockTenant);
        expect(prisma.channelConfig.findMany).toHaveBeenCalledWith({
          where: { channel: 'WHATSAPP', enabled: true },
          include: { tenant: true },
        });
      });

      it('should return null for missing phone number ID in payload', async () => {
        const request = {
          body: { entry: [] },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('WHATSAPP', request);

        expect(result).toBeNull();
      });

      it('should return null when no matching config found', async () => {
        vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([]);

        const request = {
          body: {
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: { phone_number_id: '999999999' },
                    },
                  },
                ],
              },
            ],
          },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('WHATSAPP', request);

        expect(result).toBeNull();
      });

      it('should skip configs with decryption errors', async () => {
        const mockConfigs = [{ ...mockTelegramConfig, channel: 'WHATSAPP', tenant: mockTenant }];

        vi.mocked(prisma.channelConfig.findMany).mockResolvedValue(mockConfigs as any);
        vi.mocked(decryptJson).mockImplementation(() => {
          throw new Error('Decryption failed');
        });

        const request = {
          body: {
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: { phone_number_id: '123456789' },
                    },
                  },
                ],
              },
            ],
          },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('WHATSAPP', request);

        expect(result).toBeNull();
      });
    });

    describe('TELEGRAM', () => {
      it('should resolve tenant from URL slug', async () => {
        vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);

        const request = {
          params: { tenantSlug: 'test-company' },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('TELEGRAM', request);

        expect(result).toEqual(mockTenant);
        expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
          where: { slug: 'test-company' },
        });
      });

      it('should convert slug to lowercase', async () => {
        vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);

        const request = {
          params: { tenantSlug: 'Test-Company' },
        } as unknown as FastifyRequest;

        await resolveTenantFromWebhook('TELEGRAM', request);

        expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
          where: { slug: 'test-company' },
        });
      });

      it('should return null for missing slug', async () => {
        const request = {
          params: {},
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('TELEGRAM', request);

        expect(result).toBeNull();
      });

      it('should return null for non-existent tenant', async () => {
        vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

        const request = {
          params: { tenantSlug: 'nonexistent' },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('TELEGRAM', request);

        expect(result).toBeNull();
      });
    });

    describe('WEB', () => {
      it('should resolve tenant from URL slug', async () => {
        vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);

        const request = {
          params: { tenantSlug: 'test-company' },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('WEB', request);

        expect(result).toEqual(mockTenant);
      });
    });

    describe('unsupported channel', () => {
      it('should return null for unsupported channel', async () => {
        const request = {
          params: { tenantSlug: 'test-company' },
        } as unknown as FastifyRequest;

        const result = await resolveTenantFromWebhook('SLACK' as any, request);

        expect(result).toBeNull();
      });
    });
  });

  describe('verifyWebhookSignature', () => {
    describe('WHATSAPP', () => {
      it('should return false when signature header is missing', async () => {
        vi.mocked(getAdapter).mockResolvedValue({
          verifySignature: vi.fn().mockReturnValue(true),
        } as any);

        const request = {
          headers: {},
          rawBody: Buffer.from('{}'),
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WHATSAPP', 'tenant-123', request);

        expect(result).toBe(false);
      });

      it('should return false when rawBody is missing', async () => {
        vi.mocked(getAdapter).mockResolvedValue({
          verifySignature: vi.fn().mockReturnValue(true),
        } as any);

        const request = {
          headers: { 'x-hub-signature-256': 'sha256=abc123' },
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WHATSAPP', 'tenant-123', request);

        expect(result).toBe(false);
      });

      it('should call adapter verifySignature with correct params', async () => {
        const mockVerifySignature = vi.fn().mockReturnValue(true);
        vi.mocked(getAdapter).mockResolvedValue({
          verifySignature: mockVerifySignature,
        } as any);

        const request = {
          headers: { 'x-hub-signature-256': 'sha256=abc123' },
          rawBody: Buffer.from('{"test": "data"}'),
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WHATSAPP', 'tenant-123', request);

        expect(result).toBe(true);
        expect(mockVerifySignature).toHaveBeenCalledWith('{"test": "data"}', 'sha256=abc123');
      });

      it('should return false when verifySignature is not implemented', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);

        const request = {
          headers: { 'x-hub-signature-256': 'sha256=abc123' },
          rawBody: Buffer.from('{}'),
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WHATSAPP', 'tenant-123', request);

        expect(result).toBe(false);
      });
    });

    describe('TELEGRAM', () => {
      it('should return true when no secret token header (not configured)', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);

        const request = {
          headers: {},
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('TELEGRAM', 'tenant-123', request);

        expect(result).toBe(true);
      });

      it('should return false when config has no webhook secret', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);
        vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
          ...mockTelegramConfig,
          webhookSecret: null,
        } as any);

        const request = {
          headers: { 'x-telegram-bot-api-secret-token': 'some-token' },
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('TELEGRAM', 'tenant-123', request);

        expect(result).toBe(false);
      });

      it('should return false when token length mismatch', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);
        vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
          ...mockTelegramConfig,
          webhookSecret: 'secret123',
        } as any);

        const request = {
          headers: { 'x-telegram-bot-api-secret-token': 'short' },
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('TELEGRAM', 'tenant-123', request);

        expect(result).toBe(false);
      });

      it('should return true for matching secret token', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);
        vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
          ...mockTelegramConfig,
          webhookSecret: 'correct-secret',
        } as any);

        const request = {
          headers: { 'x-telegram-bot-api-secret-token': 'correct-secret' },
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('TELEGRAM', 'tenant-123', request);

        expect(result).toBe(true);
      });
    });

    describe('WEB', () => {
      it('should always return true for web channel', async () => {
        vi.mocked(getAdapter).mockResolvedValue({} as any);

        const request = {
          headers: {},
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WEB', 'tenant-123', request);

        expect(result).toBe(true);
      });
    });

    describe('error handling', () => {
      it('should return false when getAdapter throws', async () => {
        vi.mocked(getAdapter).mockRejectedValue(new Error('Adapter error'));

        const request = {
          headers: { 'x-hub-signature-256': 'sha256=abc123' },
          rawBody: Buffer.from('{}'),
        } as unknown as FastifyRequest;

        const result = await verifyWebhookSignature('WHATSAPP', 'tenant-123', request);

        expect(result).toBe(false);
      });
    });
  });

  describe('webhookRateLimit', () => {
    it('should allow request when under limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(1);
      vi.mocked(redis.expire).mockResolvedValue(1);

      const result = await webhookRateLimit('WHATSAPP', 'tenant-123');

      expect(result).toEqual({ allowed: true });
      expect(redis.incr).toHaveBeenCalledWith('ratelimit:webhook:tenant-123:WHATSAPP');
      expect(redis.expire).toHaveBeenCalledWith('ratelimit:webhook:tenant-123:WHATSAPP', 60);
    });

    it('should set expiry only on first request', async () => {
      vi.mocked(redis.incr).mockResolvedValue(5);

      const result = await webhookRateLimit('TELEGRAM', 'tenant-123');

      expect(result).toEqual({ allowed: true });
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('should deny request when over limit', async () => {
      vi.mocked(redis.incr).mockResolvedValue(101); // Over WhatsApp limit of 100
      vi.mocked(redis.ttl).mockResolvedValue(45);

      const result = await webhookRateLimit('WHATSAPP', 'tenant-123');

      expect(result).toEqual({ allowed: false, retryAfter: 45 });
    });

    it('should use default retry-after when ttl is negative', async () => {
      vi.mocked(redis.incr).mockResolvedValue(101);
      vi.mocked(redis.ttl).mockResolvedValue(-1);

      const result = await webhookRateLimit('WHATSAPP', 'tenant-123');

      expect(result).toEqual({ allowed: false, retryAfter: 60 });
    });

    it('should use different limits for different channels', async () => {
      // WEB has limit of 60
      vi.mocked(redis.incr).mockResolvedValue(61);
      vi.mocked(redis.ttl).mockResolvedValue(30);

      const result = await webhookRateLimit('WEB', 'tenant-123');

      expect(result).toEqual({ allowed: false, retryAfter: 30 });
    });

    it('should block request on Redis error (fail closed)', async () => {
      vi.mocked(redis.incr).mockRejectedValue(new Error('Redis connection failed'));

      const result = await webhookRateLimit('WHATSAPP', 'tenant-123');

      expect(result).toEqual({ allowed: false, retryAfter: 60 });
    });
  });

  describe('checkChannelEnabled', () => {
    it('should return enabled=true, exists=true for enabled channel', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
        enabled: true,
      } as any);

      const result = await checkChannelEnabled('tenant-123', 'WHATSAPP');

      expect(result).toEqual({ enabled: true, exists: true });
      expect(prisma.channelConfig.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_channel: {
            tenantId: 'tenant-123',
            channel: 'WHATSAPP',
          },
        },
        select: { enabled: true },
      });
    });

    it('should return enabled=false, exists=true for disabled channel', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
        enabled: false,
      } as any);

      const result = await checkChannelEnabled('tenant-123', 'TELEGRAM');

      expect(result).toEqual({ enabled: false, exists: true });
    });

    it('should return enabled=false, exists=false for non-existent channel', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      const result = await checkChannelEnabled('tenant-123', 'WEB');

      expect(result).toEqual({ enabled: false, exists: false });
    });
  });
});
