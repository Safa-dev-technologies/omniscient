import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as channelService from '../../../src/modules/channel/channel.service.js';
import {
  mockChannelConfig,
  mockTelegramConfig,
  mockWebConfig,
  mockWhatsAppCredentials,
  mockWebCredentials,
  mockEncryptedCredentials,
} from '../../fixtures/channel.fixtures.js';
import { mockTenant } from '../../fixtures/tenant.fixtures.js';

// Mock Prisma
vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrismaLocal = {
    tenant: {
      findUnique: vi.fn(),
    },
    channelConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    prisma: mockPrismaLocal,
  };
});

// Mock crypto utilities
vi.mock('../../../src/utils/crypto.js', () => ({
  encrypt: vi.fn(() => mockEncryptedCredentials),
  decryptJson: vi.fn(() => mockWhatsAppCredentials),
  generateWebhookSecret: vi.fn(() => 'generated-webhook-secret-123'),
}));

// Mock logger
vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Get mocked modules
const { prisma } = await import('../../../src/lib/prisma.js');
const { encrypt, decryptJson, generateWebhookSecret } =
  await import('../../../src/utils/crypto.js');

describe('Channel Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createConfig', () => {
    it('should create a channel configuration', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.channelConfig.create).mockResolvedValue(mockChannelConfig);

      const result = await channelService.createConfig(mockTenant.id, {
        channel: 'WHATSAPP',
        enabled: true,
        credentials: mockWhatsAppCredentials,
      });

      expect(result.id).toBe(mockChannelConfig.id);
      expect(result.channel).toBe('WHATSAPP');
      expect(result.enabled).toBe(true);
      expect(encrypt).toHaveBeenCalled();
      expect(generateWebhookSecret).toHaveBeenCalled();
    });

    it('should reject duplicate channel configuration', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);

      await expect(
        channelService.createConfig(mockTenant.id, {
          channel: 'WHATSAPP',
          enabled: true,
          credentials: mockWhatsAppCredentials,
        })
      ).rejects.toThrow('Channel WHATSAPP is already configured for this tenant');
    });

    it('should reject non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(
        channelService.createConfig('non-existent-id', {
          channel: 'WHATSAPP',
          enabled: true,
          credentials: mockWhatsAppCredentials,
        })
      ).rejects.toThrow('Tenant not found');
    });

    it('should reject unsupported channel types', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(
        channelService.createConfig(mockTenant.id, {
          channel: 'SLACK' as any,
          enabled: true,
          credentials: {},
        })
      ).rejects.toThrow('Channel SLACK is not yet implemented');
    });

    it('should validate WhatsApp credentials', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(
        channelService.createConfig(mockTenant.id, {
          channel: 'WHATSAPP',
          enabled: true,
          credentials: { phoneNumberId: '' }, // Missing required fields
        })
      ).rejects.toThrow();
    });

    it('should validate Telegram credentials', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(
        channelService.createConfig(mockTenant.id, {
          channel: 'TELEGRAM',
          enabled: true,
          credentials: { botToken: 'invalid-format' }, // Invalid format
        })
      ).rejects.toThrow('Invalid Telegram bot token format');
    });

    it('should validate Web credentials', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(
        channelService.createConfig(mockTenant.id, {
          channel: 'WEB',
          enabled: true,
          credentials: { allowedOrigins: [] }, // Empty array
        })
      ).rejects.toThrow();
    });
  });

  describe('listConfigs', () => {
    it('should return all channel configs for a tenant', async () => {
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
        mockChannelConfig,
        mockTelegramConfig,
      ]);

      const result = await channelService.listConfigs(mockTenant.id);

      expect(result).toHaveLength(2);
      expect(result[0].channel).toBe('WHATSAPP');
      expect(result[1].channel).toBe('TELEGRAM');
    });

    it('should return empty array when no configs exist', async () => {
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([]);

      const result = await channelService.listConfigs(mockTenant.id);

      expect(result).toHaveLength(0);
    });

    it('should mask credentials in response', async () => {
      vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([mockChannelConfig]);

      const result = await channelService.listConfigs(mockTenant.id);

      expect(decryptJson).toHaveBeenCalled();
      // Credentials should be masked (contain ****)
      expect(result[0].credentials).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return specific channel config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);

      const result = await channelService.getConfig(mockTenant.id, 'WHATSAPP');

      expect(result?.id).toBe(mockChannelConfig.id);
      expect(result?.channel).toBe('WHATSAPP');
    });

    it('should return null for non-existent config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      const result = await channelService.getConfig(mockTenant.id, 'TELEGRAM');

      expect(result).toBeNull();
    });

    it('should mask credentials in response', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);

      await channelService.getConfig(mockTenant.id, 'WHATSAPP');

      expect(decryptJson).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update channel config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);
      vi.mocked(prisma.channelConfig.update).mockResolvedValue({
        ...mockChannelConfig,
        enabled: false,
      });

      const result = await channelService.updateConfig(mockTenant.id, 'WHATSAPP', {
        enabled: false,
      });

      expect(result.enabled).toBe(false);
    });

    it('should merge credentials on update', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);
      vi.mocked(prisma.channelConfig.update).mockResolvedValue(mockChannelConfig);

      await channelService.updateConfig(mockTenant.id, 'WHATSAPP', {
        credentials: { accessToken: 'new-token-value' },
      });

      // Should decrypt existing credentials and merge
      expect(decryptJson).toHaveBeenCalled();
      expect(encrypt).toHaveBeenCalled();
    });

    it('should reject update for non-existent config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(
        channelService.updateConfig(mockTenant.id, 'WHATSAPP', { enabled: false })
      ).rejects.toThrow('Channel config not found for channel WHATSAPP');
    });
  });

  describe('deleteConfig', () => {
    it('should delete channel config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);
      vi.mocked(prisma.channelConfig.delete).mockResolvedValue(mockChannelConfig);

      await expect(channelService.deleteConfig(mockTenant.id, 'WHATSAPP')).resolves.toBeUndefined();

      expect(prisma.channelConfig.delete).toHaveBeenCalled();
    });

    it('should reject delete for non-existent config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(channelService.deleteConfig(mockTenant.id, 'WHATSAPP')).rejects.toThrow(
        'Channel config not found for channel WHATSAPP'
      );
    });
  });

  describe('testConnection', () => {
    it('should return success for enabled config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);

      const result = await channelService.testConnection(mockTenant.id, 'WHATSAPP');

      expect(result.success).toBe(true);
    });

    it('should return failure for disabled config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue({
        ...mockChannelConfig,
        enabled: false,
      });

      const result = await channelService.testConnection(mockTenant.id, 'WHATSAPP');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Channel is disabled');
    });

    it('should reject for non-existent config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(channelService.testConnection(mockTenant.id, 'WHATSAPP')).rejects.toThrow(
        'Channel config not found for channel WHATSAPP'
      );
    });
  });

  describe('rotateWebhookSecret', () => {
    it('should generate new webhook secret', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);
      vi.mocked(prisma.channelConfig.update).mockResolvedValue({
        ...mockChannelConfig,
        webhookSecret: 'generated-webhook-secret-123',
      });

      const result = await channelService.rotateWebhookSecret(mockTenant.id, 'WHATSAPP');

      expect(result).toBe('generated-webhook-secret-123');
      expect(generateWebhookSecret).toHaveBeenCalled();
      expect(prisma.channelConfig.update).toHaveBeenCalled();
    });

    it('should reject for non-existent config', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(null);

      await expect(channelService.rotateWebhookSecret(mockTenant.id, 'WHATSAPP')).rejects.toThrow(
        'Channel config not found for channel WHATSAPP'
      );
    });
  });

  describe('generateWebhookUrl', () => {
    it('should generate correct webhook URL', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(mockTenant);

      const result = await channelService.generateWebhookUrl(mockTenant.id, 'WHATSAPP');

      expect(result).toContain('/v1/webhooks/whatsapp/');
      expect(result).toContain(mockTenant.slug);
    });

    it('should reject for non-existent tenant', async () => {
      vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

      await expect(channelService.generateWebhookUrl('non-existent', 'WHATSAPP')).rejects.toThrow(
        'Tenant not found'
      );
    });
  });

  describe('credential masking', () => {
    it('should mask string credentials with ****...', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockChannelConfig);
      vi.mocked(decryptJson).mockReturnValue(mockWhatsAppCredentials);

      const result = await channelService.getConfig(mockTenant.id, 'WHATSAPP');

      // Check that credentials are masked
      expect(result?.credentials.accessToken).toContain('****');
      expect(result?.credentials.phoneNumberId).toContain('****');
    });

    it('should show array count for array credentials', async () => {
      vi.mocked(prisma.channelConfig.findUnique).mockResolvedValue(mockWebConfig);
      vi.mocked(decryptJson).mockReturnValue(mockWebCredentials);

      const result = await channelService.getConfig(mockTenant.id, 'WEB');

      // Array values should show count
      expect(result?.credentials.allowedOrigins).toContain('2 items');
    });
  });
});
