import { vi } from 'vitest';

export const mockTenantId = '123e4567-e89b-12d3-a456-426614174000';

export const mockDateRange = {
  from: new Date('2024-01-01'),
  to: new Date('2024-01-31'),
  interval: 'day' as const,
};

export const mockOverviewData = {
  totalConversations: 100,
  activeConversations: 15,
  totalMessages: 500,
  escalationCount: 10,
  knowledgeSources: 25,
  avgResponseTime: 3.5,
  dateRange: {
    from: mockDateRange.from,
    to: mockDateRange.to,
  },
};

export const mockConversationTimeSeriesData = {
  data: [
    { date: new Date('2024-01-01'), status: 'BOT_ACTIVE', count: 10 },
    { date: new Date('2024-01-01'), status: 'CLOSED', count: 5 },
    { date: new Date('2024-01-02'), status: 'BOT_ACTIVE', count: 12 },
    { date: new Date('2024-01-02'), status: 'ESCALATED', count: 2 },
  ],
  interval: 'day',
  dateRange: {
    from: mockDateRange.from,
    to: mockDateRange.to,
  },
};

export const mockChannelBreakdownData = {
  data: [
    { channel: 'WEB', conversations: 50, messages: 250 },
    { channel: 'WHATSAPP', conversations: 30, messages: 180 },
    { channel: 'TELEGRAM', conversations: 20, messages: 70 },
  ],
  dateRange: {
    from: mockDateRange.from,
    to: mockDateRange.to,
  },
};

export const mockEscalationMetricsData = {
  byReason: [
    { reason: 'USER_REQUEST', count: 5 },
    { reason: 'LOW_CONFIDENCE', count: 3 },
    { reason: 'SENSITIVE_TOPIC', count: 2 },
  ],
  byStatus: [
    { status: 'resolved', count: 7 },
    { status: 'pending', count: 3 },
  ],
  avgResolutionTime: 1800, // 30 minutes in seconds
  dateRange: {
    from: mockDateRange.from,
    to: mockDateRange.to,
  },
};

export const mockKnowledgeStatsData = {
  byType: [
    { type: 'PDF', count: 15 },
    { type: 'URL', count: 8 },
    { type: 'NOTION', count: 2 },
  ],
  byStatus: [
    { status: 'INDEXED', count: 20 },
    { status: 'PROCESSING', count: 3 },
    { status: 'FAILED', count: 2 },
  ],
  totalChunks: 1500,
  avgChunksPerSource: 60,
  dateRange: {
    from: mockDateRange.from,
    to: mockDateRange.to,
  },
};

// Mock Fastify request for analytics routes
export const mockAnalyticsRequest = (overrides = {}) => ({
  tenant: {
    id: mockTenantId,
    name: 'Test Tenant',
  },
  query: {},
  params: {},
  ...overrides,
});

// Mock Fastify reply
export const mockAnalyticsReply = () => {
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
