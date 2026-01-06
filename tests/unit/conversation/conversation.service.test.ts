import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as conversationService from '../../../src/modules/conversation/conversation.service.js';

vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrisma = {
    conversation: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: {
    MAX_CONVERSATION_HISTORY: 50,
  },
  env: {
    NODE_ENV: 'test',
  },
}));

const { prisma } = await import('../../../src/lib/prisma.js');

describe('Conversation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createConversation', () => {
    it('should create conversation with all params', async () => {
      const mockConversation = {
        id: 'conv-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        channel: 'WEB',
        status: 'BOT_ACTIVE',
        metadata: { source: 'homepage' },
      };
      vi.mocked(prisma.user.findFirst).mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        displayName: 'Test User',
        email: 'test@example.com',
      } as any);
      vi.mocked(prisma.conversation.create).mockResolvedValue(mockConversation as any);

      const result = await conversationService.createConversation('tenant-1', {
        userId: 'user-1',
        channel: 'WEB',
        metadata: { source: 'homepage' },
      });

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          channel: 'WEB',
          status: 'BOT_ACTIVE',
          metadata: { source: 'homepage' },
        },
        include: expect.any(Object),
      });
      expect(result).toEqual(mockConversation);
    });

    it('should create conversation without metadata', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        displayName: 'Test User',
        email: 'test@example.com',
      } as any);
      vi.mocked(prisma.conversation.create).mockResolvedValue({
        id: 'conv-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        channel: 'WEB',
        status: 'BOT_ACTIVE',
      } as any);

      await conversationService.createConversation('tenant-1', {
        userId: 'user-1',
        channel: 'WEB',
      });

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: undefined,
        }),
        include: expect.any(Object),
      });
    });

    it('should set status to BOT_ACTIVE by default', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        displayName: 'Test User',
        email: 'test@example.com',
      } as any);
      vi.mocked(prisma.conversation.create).mockResolvedValue({ status: 'BOT_ACTIVE' } as any);

      await conversationService.createConversation('tenant-1', {
        userId: 'user-1',
        channel: 'WEB',
      });

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'BOT_ACTIVE',
        }),
        include: expect.any(Object),
      });
    });

    it('should handle different channel types', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        displayName: 'Test User',
        email: 'test@example.com',
      } as any);
      vi.mocked(prisma.conversation.create).mockResolvedValue({} as any);

      for (const channel of ['WEB', 'WHATSAPP', 'SLACK', 'EMAIL']) {
        await conversationService.createConversation('tenant-1', {
          userId: 'user-1',
          channel: channel as any,
        });

        expect(prisma.conversation.create).toHaveBeenLastCalledWith({
          data: expect.objectContaining({ channel }),
          include: expect.any(Object),
        });
      }
    });
  });

  describe('getConversationHistory', () => {
    it('should return messages in chronological order', async () => {
      const messages = [
        { id: '3', content: 'Third', createdAt: new Date('2024-01-03') },
        { id: '2', content: 'Second', createdAt: new Date('2024-01-02') },
        { id: '1', content: 'First', createdAt: new Date('2024-01-01') },
      ];
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv-1' } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue(messages as any);

      const result = await conversationService.getConversationHistory('tenant-1', 'conv-1');

      // Should be reversed to chronological order
      expect(result[0].id).toBe('1');
      expect(result[1].id).toBe('2');
      expect(result[2].id).toBe('3');
    });

    it('should respect limit parameter', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv-1' } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);

      await conversationService.getConversationHistory('tenant-1', 'conv-1', 10);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    });

    it('should use default limit when not specified', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv-1' } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);

      await conversationService.getConversationHistory('tenant-1', 'conv-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'desc' },
        take: 50, // CONSTANTS.MAX_CONVERSATION_HISTORY
      });
    });

    it('should return empty array for conversation with no messages', async () => {
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue({ id: 'conv-1' } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);

      const result = await conversationService.getConversationHistory('tenant-1', 'conv-1');

      expect(result).toEqual([]);
    });
  });
});
