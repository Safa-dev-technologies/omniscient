import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as chatService from '../../../src/modules/chat/chat.service.js';
import {
  mockUser,
  mockConversation,
  mockTenant,
  mockBotResponse,
  mockMessage,
} from '../../fixtures/chat.fixtures.js';

vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ settings: null }),
    },
    conversation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
    escalation: {
      create: vi.fn(),
    },
    $transaction: vi.fn((arr) => Promise.all(arr)),
  };
  return { prisma: mockPrisma };
});

vi.mock('../../../src/modules/bot/bot.engine.js', () => ({
  botEngine: {
    generateResponse: vi.fn(),
  },
}));

vi.mock('../../../src/modules/conversation/conversation.service.js', () => ({
  createConversation: vi.fn(),
  getConversationHistory: vi.fn(() => []),
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/lib/redis.js', () => ({
  redis: {},
}));

vi.mock('../../../src/lib/rate-limit/index.js', () => ({
  getUserRateLimiter: vi.fn(() => ({
    checkAndRecord: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
  })),
  RateLimitExceededError: class RateLimitExceededError extends Error {
    code = 'RATE_LIMIT_EXCEEDED';
    statusCode = 429;
    retryAfter: number;
    limitType: 'minute' | 'hour';
    userId: string;
    constructor(params: { retryAfter: number; limitType: 'minute' | 'hour'; userId: string }) {
      super(`Rate limit exceeded (${params.limitType})`);
      this.retryAfter = params.retryAfter;
      this.limitType = params.limitType;
      this.userId = params.userId;
    }
  },
}));

const { prisma } = await import('../../../src/lib/prisma.js');
const { botEngine } = await import('../../../src/modules/bot/bot.engine.js');
const conversationServiceMock =
  await import('../../../src/modules/conversation/conversation.service.js');

describe('Chat Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processChat', () => {
    const baseParams = {
      tenantId: 'tenant-1',
      tenant: mockTenant,
      message: 'Hello',
      sessionId: 'session-abc',
      channel: 'WEB',
    };

    it('should find existing user by sessionId', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', webSessionId: 'session-abc' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should create new user if sessionId not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          webSessionId: 'session-abc',
        },
      });
    });

    it('should create new user with random sessionId if none provided', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat({ ...baseParams, sessionId: undefined });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          webSessionId: expect.any(String), // Random UUID
        }),
      });
    });

    it('should find active conversation for user', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          userId: mockUser.id,
          status: { in: ['BOT_ACTIVE', 'HUMAN_ACTIVE'] },
        },
        orderBy: { lastActivityAt: 'desc' },
      });
    });

    it('should create new conversation if none exists', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      vi.mocked(conversationServiceMock.createConversation).mockResolvedValue(
        mockConversation as any
      );
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(conversationServiceMock.createConversation).toHaveBeenCalledWith('tenant-1', {
        userId: mockUser.id,
        channel: 'WEB',
        metadata: undefined,
      });
    });

    it('should return escalation response if conversation is ESCALATED', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        ...mockConversation,
        status: 'ESCALATED',
      } as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);

      const result = await chatService.processChat(baseParams);

      expect(result.response).toContain('escalated to a human agent');
      expect(botEngine.generateResponse).not.toHaveBeenCalled();
    });

    it('should return escalation response if conversation is HUMAN_ACTIVE', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        ...mockConversation,
        status: 'HUMAN_ACTIVE',
      } as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);

      const result = await chatService.processChat(baseParams);

      expect(result.response).toContain('escalated to a human agent');
    });

    it('should save user message to database', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
        data: {
          conversationId: mockConversation.id,
          role: 'USER',
          content: 'Hello',
        },
      });
    });

    it('should save assistant message to database', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create)
        .mockResolvedValueOnce(mockMessage as any) // User message
        .mockResolvedValueOnce({ ...mockMessage, role: 'ASSISTANT', id: 'msg-assistant' } as any); // Assistant message
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          role: 'ASSISTANT',
          content: mockBotResponse.response,
          confidenceScore: mockBotResponse.confidence,
          tokensUsed: mockBotResponse.tokensUsed,
        }),
      });
    });

    it('should update conversation lastActivityAt', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      await chatService.processChat(baseParams);

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: mockConversation.id },
        data: { lastActivityAt: expect.any(Date) },
      });
    });

    it('should trigger escalation if botResponse.shouldEscalate is true', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue({
        ...mockBotResponse,
        shouldEscalate: true,
        escalationReason: 'LOW_CONFIDENCE',
      });
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}]);

      await chatService.processChat(baseParams);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: mockConversation.id },
        data: {
          status: 'ESCALATED',
          escalatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('sendMessageToConversation', () => {
    const baseParams = {
      tenantId: 'tenant-1',
      tenant: mockTenant,
      conversationId: 'conv-123',
      message: 'Hello',
    };

    it('should send message to existing conversation', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any);
      vi.mocked(botEngine.generateResponse).mockResolvedValue(mockBotResponse);

      const result = await chatService.sendMessageToConversation(baseParams);

      expect(result.conversationId).toBe('conv-123');
      expect(result.response).toBe(mockBotResponse.response);
    });

    it('should throw for invalid conversationId', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);

      await expect(chatService.sendMessageToConversation(baseParams)).rejects.toThrow(
        'Conversation not found'
      );
    });

    it('should throw for closed conversation', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({
        ...mockConversation,
        status: 'CLOSED',
      } as any);

      await expect(chatService.sendMessageToConversation(baseParams)).rejects.toThrow(
        'Conversation is closed'
      );
    });
  });

  describe('getConversation', () => {
    it('should return conversation with messages and escalation', async () => {
      const fullConversation = {
        ...mockConversation,
        messages: [mockMessage],
        escalation: null,
      };
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(fullConversation as any);

      const result = await chatService.getConversation('tenant-1', 'conv-123');

      expect(result).toEqual(fullConversation);
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
        where: { id: 'conv-123', tenantId: 'tenant-1' },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          escalation: true,
        },
      });
    });

    it('should return null for non-existent conversation', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);

      const result = await chatService.getConversation('tenant-1', 'invalid');

      expect(result).toBeNull();
    });
  });

  describe('escalateConversation', () => {
    it('should throw for invalid conversationId', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);

      await expect(chatService.escalateConversation('tenant-1', 'invalid')).rejects.toThrow(
        'Conversation not found'
      );
    });

    it('should update status and create escalation record', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}]);

      const result = await chatService.escalateConversation(
        'tenant-1',
        'conv-123',
        'User frustrated'
      );

      expect(result).toEqual({ escalated: true, conversationId: 'conv-123' });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('closeConversation', () => {
    it('should throw for invalid conversationId', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);

      await expect(chatService.closeConversation('tenant-1', 'invalid')).rejects.toThrow(
        'Conversation not found'
      );
    });

    it('should update status to CLOSED', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(mockConversation as any);

      await chatService.closeConversation('tenant-1', 'conv-123');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: {
          status: 'CLOSED',
          closedAt: expect.any(Date),
        },
      });
    });
  });
});
