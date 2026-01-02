import type { ChannelConfig } from '@prisma/client';
import { vi } from 'vitest';
import { mockTenant } from './tenant.fixtures.js';

export const mockWhatsAppCredentials = {
  phoneNumberId: '1234567890',
  accessToken: 'EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  webhookVerifyToken: 'my-verify-token-12345',
  businessAccountId: '9876543210',
};

export const mockTelegramCredentials = {
  botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
  webhookSecret: 'telegram-webhook-secret-1234567890',
};

export const mockWebCredentials = {
  allowedOrigins: ['https://example.com', 'https://app.example.com'],
  rateLimit: 100,
  sessionTimeout: 60,
};

export const mockMaskedWhatsAppCredentials = {
  phoneNumberId: '****...7890',
  accessToken: '****...xxxx',
  webhookVerifyToken: '****...2345',
  businessAccountId: '****...3210',
};

export const mockEncryptedCredentials = 'abc123def456:tag789:ciphertext000111222333';

export const mockChannelConfig: ChannelConfig = {
  id: '123e4567-e89b-12d3-a456-426614174100',
  tenantId: mockTenant.id,
  channel: 'WHATSAPP',
  enabled: true,
  credentials: mockEncryptedCredentials,
  webhookUrl: 'https://api.omniscient.ai/v1/webhooks/whatsapp/test-company',
  webhookSecret: 'webhook-secret-abc123def456',
  settings: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockTelegramConfig: ChannelConfig = {
  id: '123e4567-e89b-12d3-a456-426614174101',
  tenantId: mockTenant.id,
  channel: 'TELEGRAM',
  enabled: true,
  credentials: mockEncryptedCredentials,
  webhookUrl: 'https://api.omniscient.ai/v1/webhooks/telegram/test-company',
  webhookSecret: 'webhook-secret-telegram-123',
  settings: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockWebConfig: ChannelConfig = {
  id: '123e4567-e89b-12d3-a456-426614174102',
  tenantId: mockTenant.id,
  channel: 'WEB',
  enabled: true,
  credentials: mockEncryptedCredentials,
  webhookUrl: null,
  webhookSecret: 'webhook-secret-web-123',
  settings: { theme: 'dark' },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const createChannelConfigInput = {
  channel: 'WHATSAPP' as const,
  enabled: true,
  credentials: mockWhatsAppCredentials,
  settings: {},
};

export const mockChannelFastifyRequest = (overrides = {}) => ({
  tenant: {
    id: mockTenant.id,
    slug: mockTenant.slug,
    name: mockTenant.name,
    botName: mockTenant.botName,
    systemPrompt: mockTenant.systemPrompt,
    welcomeMessage: mockTenant.welcomeMessage,
    fallbackMessage: mockTenant.fallbackMessage,
    settings: null,
  },
  apiKey: {
    id: '123e4567-e89b-12d3-a456-426614174001',
    permissions: { chat: true, knowledge: true, admin: true },
  },
  isMasterKey: false,
  headers: {
    authorization: 'Bearer omni_test_abc123',
  },
  body: {},
  params: {},
  query: {},
  ...overrides,
});

export const mockChannelFastifyReply = () => {
  const reply: any = {
    statusCode: 200,
    sent: false,
    body: null,
  };
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((data: any) => {
    reply.sent = true;
    reply.body = data;
    return reply;
  });
  return reply;
};
