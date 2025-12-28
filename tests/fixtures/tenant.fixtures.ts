import type { Tenant, ApiKey } from '@prisma/client';
import { vi } from 'vitest';

export const mockTenant: Tenant = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Company',
  slug: 'test-company',
  status: 'ACTIVE',
  botName: 'TestBot',
  systemPrompt: 'You are a helpful assistant',
  welcomeMessage: 'Hello!',
  fallbackMessage: 'I cannot help with that',
  monthlyMessageLimit: 10000,
  monthlyMessagesUsed: 0,
  settings: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

export const mockApiKey: ApiKey = {
  id: '123e4567-e89b-12d3-a456-426614174001',
  tenantId: mockTenant.id,
  name: 'Test API Key',
  keyHash: 'hashed_key_value',
  keyPrefix: 'omni_test_abc',
  permissions: { chat: true, knowledge: true, admin: true },
  lastUsedAt: null,
  expiresAt: null,
  createdAt: new Date('2024-01-01'),
};

export const createTenantInput = {
  name: 'New Company',
  slug: 'new-company',
  botName: 'NewBot',
  monthlyMessageLimit: 10000,
};

export const mockFastifyRequest = (overrides = {}) => ({
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
    id: mockApiKey.id,
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

export const mockFastifyReply = () => {
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
