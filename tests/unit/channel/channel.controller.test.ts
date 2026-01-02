import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/channel/channel.controller.js';
import * as channelService from '../../../src/modules/channel/channel.service.js';
import {
  mockChannelFastifyRequest,
  mockChannelFastifyReply,
  mockWhatsAppCredentials,
  mockMaskedWhatsAppCredentials,
} from '../../fixtures/channel.fixtures.js';
import { mockTenant } from '../../fixtures/tenant.fixtures.js';

// Mock service
vi.mock('../../../src/modules/channel/channel.service.js');

describe('Channel Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createConfig', () => {
    it('should return 201 on successful creation', async () => {
      const request = mockChannelFastifyRequest({
        body: {
          channel: 'WHATSAPP',
          enabled: true,
          credentials: mockWhatsAppCredentials,
        },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.createConfig).mockResolvedValue({
        id: '123',
        tenantId: mockTenant.id,
        channel: 'WHATSAPP',
        enabled: true,
        webhookUrl: 'https://api.example.com/v1/webhooks/whatsapp/test-company',
        credentials: mockMaskedWhatsAppCredentials,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await controller.createConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.channel).toBe('WHATSAPP');
    });

    it('should return 409 for duplicate channel config', async () => {
      const request = mockChannelFastifyRequest({
        body: {
          channel: 'WHATSAPP',
          enabled: true,
          credentials: mockWhatsAppCredentials,
        },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.createConfig).mockRejectedValue(
        new Error('Channel WHATSAPP is already configured for this tenant')
      );

      await controller.createConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.body.error.code).toBe('CHANNEL_ALREADY_CONFIGURED');
    });

    it('should return 400 for unsupported channel', async () => {
      const request = mockChannelFastifyRequest({
        body: {
          channel: 'SLACK',
          enabled: true,
          credentials: {},
        },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.createConfig).mockRejectedValue(
        new Error('Channel SLACK is not yet implemented')
      );

      await controller.createConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('CHANNEL_NOT_SUPPORTED');
    });
  });

  describe('listConfigs', () => {
    it('should return list of channel configs', async () => {
      const request = mockChannelFastifyRequest() as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.listConfigs).mockResolvedValue([
        {
          id: '123',
          tenantId: mockTenant.id,
          channel: 'WHATSAPP',
          enabled: true,
          webhookUrl: 'https://api.example.com/v1/webhooks/whatsapp/test-company',
          credentials: mockMaskedWhatsAppCredentials,
          settings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await controller.listConfigs(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toHaveLength(1);
    });

    it('should return empty array when no configs exist', async () => {
      const request = mockChannelFastifyRequest() as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.listConfigs).mockResolvedValue([]);

      await controller.listConfigs(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toHaveLength(0);
    });
  });

  describe('getConfig', () => {
    it('should return channel config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.getConfig).mockResolvedValue({
        id: '123',
        tenantId: mockTenant.id,
        channel: 'WHATSAPP',
        enabled: true,
        webhookUrl: 'https://api.example.com/v1/webhooks/whatsapp/test-company',
        credentials: mockMaskedWhatsAppCredentials,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await controller.getConfig(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.channel).toBe('WHATSAPP');
    });

    it('should return 404 for non-existent config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'TELEGRAM' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.getConfig).mockResolvedValue(null);

      await controller.getConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('updateConfig', () => {
    it('should return updated config on success', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
        body: { enabled: false },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.updateConfig).mockResolvedValue({
        id: '123',
        tenantId: mockTenant.id,
        channel: 'WHATSAPP',
        enabled: false,
        webhookUrl: 'https://api.example.com/v1/webhooks/whatsapp/test-company',
        credentials: mockMaskedWhatsAppCredentials,
        settings: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await controller.updateConfig(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.enabled).toBe(false);
    });

    it('should return 404 for non-existent config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
        body: { enabled: false },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.updateConfig).mockRejectedValue(
        new Error('Channel config not found for channel WHATSAPP')
      );

      await controller.updateConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for unsupported channel update', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'SLACK' },
        body: { enabled: true },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.updateConfig).mockRejectedValue(
        new Error('Channel SLACK is not yet implemented')
      );

      await controller.updateConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('CHANNEL_NOT_SUPPORTED');
    });
  });

  describe('deleteConfig', () => {
    it('should return success on delete', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.deleteConfig).mockResolvedValue(undefined);

      await controller.deleteConfig(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.deleted).toBe(true);
    });

    it('should return 404 for non-existent config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.deleteConfig).mockRejectedValue(
        new Error('Channel config not found for channel WHATSAPP')
      );

      await controller.deleteConfig(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('testConnection', () => {
    it('should return test result', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.testConnection).mockResolvedValue({
        success: true,
        message: 'Connection successful',
      });

      await controller.testConnection(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.success).toBe(true);
    });

    it('should return 404 for non-existent config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.testConnection).mockRejectedValue(
        new Error('Channel config not found for channel WHATSAPP')
      );

      await controller.testConnection(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('rotateWebhookSecret', () => {
    it('should return new secret on success', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.rotateWebhookSecret).mockResolvedValue('new-secret-abc123');

      await controller.rotateWebhookSecret(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.secret).toBe('new-secret-abc123');
    });

    it('should return 404 for non-existent config', async () => {
      const request = mockChannelFastifyRequest({
        params: { channel: 'WHATSAPP' },
      }) as any;
      const reply = mockChannelFastifyReply();

      vi.mocked(channelService.rotateWebhookSecret).mockRejectedValue(
        new Error('Channel config not found for channel WHATSAPP')
      );

      await controller.rotateWebhookSecret(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });
});
