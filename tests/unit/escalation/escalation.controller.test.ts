import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/escalation/escalation.controller.js';
import * as escalationService from '../../../src/modules/escalation/escalation.service.js';

vi.mock('../../../src/modules/escalation/escalation.service.js');

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
  },
  body: {},
  params: {},
  query: {},
  ...overrides,
});

describe('Escalation Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createEscalation', () => {
    it('should return 201 on successful creation', async () => {
      const mockResult = {
        escalation: {
          id: '123e4567-e89b-12d3-a456-426614174001',
          conversationId: '123e4567-e89b-12d3-a456-426614174000',
          reason: 'USER_REQUEST',
        },
        conversation: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          status: 'ESCALATED',
        },
      };

      vi.mocked(escalationService.createEscalation).mockResolvedValue(mockResult as any);

      const request = mockFastifyRequest({
        body: {
          conversationId: '123e4567-e89b-12d3-a456-426614174000',
          reason: 'USER_REQUEST',
          reasonDetails: 'User requested human agent',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.createEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResult);
      expect(escalationService.createEscalation).toHaveBeenCalledWith('tenant-1', {
        conversationId: '123e4567-e89b-12d3-a456-426614174000',
        reason: 'USER_REQUEST',
        reasonDetails: 'User requested human agent',
      });
    });

    it('should return 404 when conversation not found', async () => {
      vi.mocked(escalationService.createEscalation).mockRejectedValue(
        new Error('Conversation not found')
      );

      const request = mockFastifyRequest({
        body: {
          conversationId: '123e4567-e89b-12d3-a456-426614174000',
          reason: 'USER_REQUEST',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.createEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 409 when escalation already exists', async () => {
      vi.mocked(escalationService.createEscalation).mockRejectedValue(
        new Error('Conversation already has an escalation')
      );

      const request = mockFastifyRequest({
        body: {
          conversationId: '123e4567-e89b-12d3-a456-426614174000',
          reason: 'USER_REQUEST',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.createEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(409);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('ESCALATION_EXISTS');
    });

    it('should validate input schema', async () => {
      const request = mockFastifyRequest({
        body: {
          conversationId: 'invalid-uuid',
          reason: 'INVALID_REASON',
        },
      }) as any;
      const reply = mockFastifyReply();

      await expect(controller.createEscalation(request, reply)).rejects.toThrow();
    });
  });

  describe('getEscalation', () => {
    it('should return escalation with relations', async () => {
      const mockEscalation = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        conversationId: '123e4567-e89b-12d3-a456-426614174000',
        reason: 'USER_REQUEST',
        conversation: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          user: { id: '123e4567-e89b-12d3-a456-426614174004', displayName: 'Test User' },
        },
      };

      vi.mocked(escalationService.getEscalation).mockResolvedValue(mockEscalation as any);

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getEscalation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockEscalation);
      expect(escalationService.getEscalation).toHaveBeenCalledWith(
        'tenant-1',
        '123e4567-e89b-12d3-a456-426614174001'
      );
    });

    it('should return 404 when escalation not found', async () => {
      vi.mocked(escalationService.getEscalation).mockRejectedValue(
        new Error('Escalation not found')
      );

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('listEscalations', () => {
    it('should return paginated list of escalations', async () => {
      const mockEscalations = [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          reason: 'USER_REQUEST',
          conversation: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            user: { id: '123e4567-e89b-12d3-a456-426614174004', displayName: 'Test User' },
          },
        },
        {
          id: '123e4567-e89b-12d3-a456-426614174002',
          reason: 'LOW_CONFIDENCE',
          conversation: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            user: { id: '123e4567-e89b-12d3-a456-426614174004', displayName: 'Test User' },
          },
        },
      ] as any;

      vi.mocked(escalationService.listEscalations).mockResolvedValue({
        escalations: mockEscalations,
        pagination: {
          total: 2,
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      });

      const request = mockFastifyRequest({
        query: { limit: 20, offset: 0 },
      }) as any;
      const reply = mockFastifyReply();

      await controller.listEscalations(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockEscalations);
      expect(reply.body.pagination.total).toBe(2);
      expect(escalationService.listEscalations).toHaveBeenCalledWith('tenant-1', {
        limit: 20,
        offset: 0,
      });
    });

    it('should apply query filters', async () => {
      vi.mocked(escalationService.listEscalations).mockResolvedValue({
        escalations: [],
        pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
      });

      const request = mockFastifyRequest({
        query: {
          reason: 'USER_REQUEST',
          resolved: false,
          limit: 10,
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.listEscalations(request, reply);

      expect(escalationService.listEscalations).toHaveBeenCalledWith('tenant-1', {
        reason: 'USER_REQUEST',
        resolved: false,
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('updateEscalation', () => {
    it('should update and return escalation', async () => {
      const mockUpdated = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        agentId: '123e4567-e89b-12d3-a456-426614174003',
        agentName: 'John Doe',
      };

      vi.mocked(escalationService.updateEscalation).mockResolvedValue(mockUpdated as any);

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          agentId: '123e4567-e89b-12d3-a456-426614174003',
          agentName: 'John Doe',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.updateEscalation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockUpdated);
      expect(escalationService.updateEscalation).toHaveBeenCalledWith(
        'tenant-1',
        '123e4567-e89b-12d3-a456-426614174001',
        expect.objectContaining({
          agentId: '123e4567-e89b-12d3-a456-426614174003',
          agentName: 'John Doe',
        })
      );
    });

    it('should return 404 when escalation not found', async () => {
      vi.mocked(escalationService.updateEscalation).mockRejectedValue(
        new Error('Escalation not found')
      );

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: { agentName: 'John' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.updateEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('resolveEscalation', () => {
    it('should resolve escalation successfully', async () => {
      const mockResolved = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        resolvedAt: new Date(),
        resolutionNotes: 'Issue resolved',
        returnedToBot: false,
      };

      vi.mocked(escalationService.resolveEscalation).mockResolvedValue(mockResolved as any);

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          resolutionNotes: 'Issue resolved',
          returnedToBot: false,
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.resolveEscalation(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResolved);
      expect(escalationService.resolveEscalation).toHaveBeenCalledWith(
        'tenant-1',
        '123e4567-e89b-12d3-a456-426614174001',
        expect.objectContaining({
          resolutionNotes: 'Issue resolved',
          returnedToBot: false,
        })
      );
    });

    it('should return 404 when escalation not found', async () => {
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('Escalation not found')
      );

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: { returnedToBot: false },
      }) as any;
      const reply = mockFastifyReply();

      await controller.resolveEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when escalation already resolved', async () => {
      vi.mocked(escalationService.resolveEscalation).mockRejectedValue(
        new Error('Escalation already resolved')
      );

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: { returnedToBot: false },
      }) as any;
      const reply = mockFastifyReply();

      await controller.resolveEscalation(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('ALREADY_RESOLVED');
    });

    it('should handle returnedToBot flag', async () => {
      vi.mocked(escalationService.resolveEscalation).mockResolvedValue({} as any);

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          returnedToBot: true,
          resolutionNotes: 'Returned to bot',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.resolveEscalation(request, reply);

      expect(escalationService.resolveEscalation).toHaveBeenCalledWith(
        'tenant-1',
        '123e4567-e89b-12d3-a456-426614174001',
        expect.objectContaining({
          returnedToBot: true,
          resolutionNotes: 'Returned to bot',
        })
      );
    });
  });

  describe('createTicket', () => {
    it('should create external ticket successfully', async () => {
      const mockResult = {
        escalation: {
          id: '123e4567-e89b-12d3-a456-426614174001',
          externalTicketId: 'zd-123',
          externalSystem: 'zendesk',
        },
        ticket: {
          ticketId: 'zd-123',
          system: 'zendesk',
          url: 'https://test.zendesk.com/tickets/123',
        },
      };

      vi.mocked(escalationService.createEscalationTicket).mockResolvedValue(mockResult as any);

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          escalationId: '123e4567-e89b-12d3-a456-426614174001',
          system: 'zendesk',
          subject: 'Test ticket',
          description: 'Test description',
          priority: 'normal',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.createTicket(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResult);
      expect(escalationService.createEscalationTicket).toHaveBeenCalledWith(
        'tenant-1',
        '123e4567-e89b-12d3-a456-426614174001',
        expect.objectContaining({
          system: 'zendesk',
          subject: 'Test ticket',
          description: 'Test description',
          priority: 'normal',
        })
      );
    });

    it('should return 404 when escalation not found', async () => {
      vi.mocked(escalationService.createEscalationTicket).mockRejectedValue(
        new Error('Escalation not found')
      );

      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          escalationId: '123e4567-e89b-12d3-a456-426614174001',
          system: 'zendesk',
          subject: 'Test',
          description: 'Test',
        },
      }) as any;
      const reply = mockFastifyReply();

      await controller.createTicket(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.success).toBe(false);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });

    it('should validate input schema', async () => {
      const request = mockFastifyRequest({
        params: { id: '123e4567-e89b-12d3-a456-426614174001' },
        body: {
          system: 'invalid-system',
          subject: '',
        },
      }) as any;
      const reply = mockFastifyReply();

      await expect(controller.createTicket(request, reply)).rejects.toThrow();
    });
  });
});
