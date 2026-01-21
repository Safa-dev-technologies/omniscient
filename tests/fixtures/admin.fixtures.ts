import { vi } from 'vitest';
import type {
  Tenant,
  Conversation,
  Message,
  KnowledgeSource,
  Escalation,
  ApiKey,
} from '@prisma/client';

// Mock tenant for admin tests
export const mockAdminTenant: Tenant = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Test Company',
  slug: 'test-company',
  status: 'ACTIVE',
  botName: 'TestBot',
  systemPrompt: 'You are a helpful assistant',
  welcomeMessage: 'Hello!',
  fallbackMessage: 'I cannot help with that',
  monthlyMessageLimit: 10000,
  monthlyMessagesUsed: 500,
  settings: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export const mockAdminTenant2: Tenant = {
  ...mockAdminTenant,
  id: '223e4567-e89b-12d3-a456-426614174001',
  name: 'Another Company',
  slug: 'another-company',
  status: 'SUSPENDED',
};

export const mockConversation: Partial<Conversation> = {
  id: '333e4567-e89b-12d3-a456-426614174002',
  tenantId: mockAdminTenant.id,
  status: 'BOT_ACTIVE',
  channel: 'WEB',
  startedAt: new Date('2024-01-10'),
  lastActivityAt: new Date('2024-01-15'),
};

export const mockMessage: Partial<Message> = {
  id: '444e4567-e89b-12d3-a456-426614174003',
  conversationId: mockConversation.id!,
  role: 'USER',
  content: 'Hello',
  createdAt: new Date('2024-01-15'),
};

export const mockKnowledgeSource: Partial<KnowledgeSource> = {
  id: '555e4567-e89b-12d3-a456-426614174004',
  tenantId: mockAdminTenant.id,
  name: 'Test Document',
  type: 'PDF',
  status: 'INDEXED',
  chunkCount: 10,
  tokenCount: 1000,
  uploadedAt: new Date('2024-01-05'),
};

export const mockEscalation: Partial<Escalation> = {
  id: '666e4567-e89b-12d3-a456-426614174005',
  conversationId: mockConversation.id!,
  reason: 'USER_REQUEST',
  createdAt: new Date('2024-01-15'),
  resolvedAt: null,
};

export const mockApiKey: ApiKey = {
  id: '777e4567-e89b-12d3-a456-426614174006',
  tenantId: mockAdminTenant.id,
  name: 'Production Key',
  keyHash: 'hashed_value',
  keyPrefix: 'omni_live_abc',
  permissions: { chat: true, knowledge: true, admin: true },
  lastUsedAt: new Date('2024-01-15'),
  expiresAt: null,
  createdAt: new Date('2024-01-01'),
};

// Platform stats mock data
export const mockPlatformStats = {
  tenants: {
    total: 2,
    active: 1,
    inactive: 1,
  },
  conversations: {
    total: 100,
    last24h: 10,
    last7d: 50,
    last30d: 100,
  },
  messages: {
    total: 500,
    last24h: 50,
    last7d: 250,
    last30d: 500,
  },
  knowledgeSources: {
    total: 20,
    indexed: 15,
    processing: 3,
    failed: 2,
  },
  system: {
    documentQueueDepth: 5,
    embeddingQueueDepth: 10,
    crawlQueueDepth: 2,
    syncQueueDepth: 0,
    deadLetterQueueDepth: 1,
  },
};

// Admin auth mock data
export const validAdminCredentials = {
  username: 'admin',
  password: 'correct-password',
};

export const mockMasterKey = 'master_test123456789abcdef';

// Mock Fastify request for admin routes
export const mockAdminRequest = (overrides = {}) => ({
  headers: {
    authorization: `Bearer ${mockMasterKey}`,
  },
  body: {},
  params: {},
  query: {},
  isMasterKey: true,
  ...overrides,
});

// Mock Fastify reply
export const mockAdminReply = () => {
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
