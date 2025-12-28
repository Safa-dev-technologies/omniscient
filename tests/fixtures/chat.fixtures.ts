export const mockUser = {
  id: 'user-123',
  tenantId: 'tenant-1',
  webSessionId: 'session-abc',
  createdAt: new Date(),
};

export const mockConversation = {
  id: 'conv-123',
  tenantId: 'tenant-1',
  userId: 'user-123',
  channel: 'WEB',
  status: 'BOT_ACTIVE',
  lastActivityAt: new Date(),
};

export const mockTenant = {
  id: 'tenant-1',
  botName: 'TestBot',
  systemPrompt: null,
  fallbackMessage: null,
};

export const mockBotResponse = {
  response: 'Here is your answer.',
  confidence: 0.85,
  tokensUsed: 150,
  sources: [
    {
      sourceId: 'src-1',
      sourceName: 'FAQ',
      chunkIndex: 0,
      sectionTitle: 'Returns',
      score: 0.9,
    },
  ],
  shouldEscalate: false,
};

export const mockMessage = {
  id: 'msg-123',
  conversationId: 'conv-123',
  role: 'USER',
  content: 'Hello',
  createdAt: new Date(),
};
