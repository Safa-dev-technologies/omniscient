import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/chat/chat.controller.js';
import * as chatService from '../../../src/modules/chat/chat.service.js';

vi.mock('../../../src/modules/chat/chat.service.js');

const mockFastifyReply = () => {
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    body: null,
  };
  reply.send.mockImplementation((data: any) => {
    reply.body = data;
    return reply;
  });
  return reply;
};

const mockFastifyRequest = (overrides: any = {}) => ({
  tenant: {
    id: 'tenant-1',
    botName: 'TestBot',
    systemPrompt: null,
    fallbackMessage: null,
  },
  body: {},
  params: {},
  query: {},
  ...overrides,
});

describe('Chat Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('chat', () => {
    it('should return success response with chat result', async () => {
      const mockResult = {
        response: 'Hello!',
        conversationId: '123e4567-e89b-12d3-a456-426614174000',
        messageId: '123e4567-e89b-12d3-a456-426614174001',
        confidence: 0.9,
        sources: [],
        shouldEscalate: false,
      };
      vi.mocked(chatService.processChat).mockResolvedValue(mockResult);

      const request = mockFastifyRequest({
        body: { message: 'Hi', sessionId: 'session-1' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.chat(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResult);
    });

    it('should use default channel WEB if not provided', async () => {
      vi.mocked(chatService.processChat).mockResolvedValue({} as any);

      const request = mockFastifyRequest({
        body: { message: 'Hi' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.chat(request, reply);

      expect(chatService.processChat).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'WEB',
        })
      );
    });

    it('should pass metadata to service', async () => {
      vi.mocked(chatService.processChat).mockResolvedValue({} as any);

      const request = mockFastifyRequest({
        body: { message: 'Hi', metadata: { page: 'pricing' } },
      }) as any;
      const reply = mockFastifyReply();

      await controller.chat(request, reply);

      expect(chatService.processChat).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { page: 'pricing' },
        })
      );
    });
  });

  describe('getConversation', () => {
    it('should return conversation data', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      const mockConversation = {
        id: conversationId,
        messages: [],
        status: 'BOT_ACTIVE',
      };
      vi.mocked(chatService.getConversation).mockResolvedValue(mockConversation as any);

      const request = mockFastifyRequest({
        params: { id: conversationId },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getConversation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockConversation);
    });

    it('should return 404 for non-existent conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174001';
      vi.mocked(chatService.getConversation).mockResolvedValue(null);

      const request = mockFastifyRequest({
        params: { id: conversationId },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getConversation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('sendMessage', () => {
    it('should send message and return result', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      const mockResult = {
        response: 'Reply',
        conversationId,
        messageId: '123e4567-e89b-12d3-a456-426614174002',
        confidence: 0.85,
        sources: [],
        shouldEscalate: false,
      };
      vi.mocked(chatService.sendMessageToConversation).mockResolvedValue(mockResult);

      const request = mockFastifyRequest({
        params: { id: conversationId },
        body: { message: 'Follow up' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.sendMessage(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResult);
    });
  });

  describe('escalateConversation', () => {
    it('should escalate conversation', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      vi.mocked(chatService.escalateConversation).mockResolvedValue({
        escalated: true,
        conversationId,
      });

      const request = mockFastifyRequest({
        params: { id: conversationId },
        body: {},
      }) as any;
      const reply = mockFastifyReply();

      await controller.escalateConversation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.escalated).toBe(true);
    });

    it('should pass optional reason', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      vi.mocked(chatService.escalateConversation).mockResolvedValue({
        escalated: true,
        conversationId,
      });

      const request = mockFastifyRequest({
        params: { id: conversationId },
        body: { reason: 'User frustrated' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.escalateConversation(request, reply);

      expect(chatService.escalateConversation).toHaveBeenCalledWith(
        'tenant-1',
        conversationId,
        'User frustrated'
      );
    });
  });

  describe('closeConversation', () => {
    it('should close conversation and return success', async () => {
      const conversationId = '123e4567-e89b-12d3-a456-426614174000';
      vi.mocked(chatService.closeConversation).mockResolvedValue(undefined);

      const request = mockFastifyRequest({
        params: { id: conversationId },
      }) as any;
      const reply = mockFastifyReply();

      await controller.closeConversation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.closed).toBe(true);
    });
  });
});
