import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/knowledge/knowledge.controller.js';
import * as service from '../../../src/modules/knowledge/knowledge.service.js';

vi.mock('../../../src/modules/knowledge/knowledge.service.js');

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
  tenant: { id: 'tenant-1' },
  params: {},
  query: {},
  body: {},
  file: vi.fn(),
  ...overrides,
});

describe('Knowledge Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadDocument', () => {
    it('should return 201 on successful upload', async () => {
      const mockFile = {
        filename: 'test.pdf',
        mimetype: 'application/pdf',
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('content')),
        fields: {},
      };

      vi.mocked(service.uploadDocument).mockResolvedValue({
        sourceId: 'source-1',
        name: 'test.pdf',
        type: 'PDF',
        status: 'PENDING',
        message: 'Document queued for processing',
      });

      const request = mockFastifyRequest({
        file: vi.fn().mockResolvedValue(mockFile),
      }) as any;
      const reply = mockFastifyReply();

      await controller.uploadDocument(request, reply);

      expect(reply.status).toHaveBeenCalledWith(201);
      expect(reply.body.success).toBe(true);
      expect(reply.body.data.sourceId).toBe('source-1');
    });

    it('should return 400 when no file uploaded', async () => {
      const request = mockFastifyRequest({
        file: vi.fn().mockResolvedValue(null),
      }) as any;
      const reply = mockFastifyReply();

      await controller.uploadDocument(request, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error.code).toBe('VALIDATION_ERROR');
      expect(reply.body.error.message).toBe('No file uploaded');
    });

    it('should extract name from multipart fields', async () => {
      const mockFile = {
        filename: 'test.pdf',
        mimetype: 'application/pdf',
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('content')),
        fields: {
          name: { type: 'field', value: 'Custom Document Name' },
        },
      };

      vi.mocked(service.uploadDocument).mockResolvedValue({
        sourceId: 'source-1',
        name: 'Custom Document Name',
        type: 'PDF',
        status: 'PENDING',
        message: 'Document queued for processing',
      });

      const request = mockFastifyRequest({
        file: vi.fn().mockResolvedValue(mockFile),
      }) as any;
      const reply = mockFastifyReply();

      await controller.uploadDocument(request, reply);

      expect(service.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Custom Document Name',
        })
      );
    });

    it('should handle array of name fields', async () => {
      const mockFile = {
        filename: 'test.pdf',
        mimetype: 'application/pdf',
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('content')),
        fields: {
          name: [{ type: 'field', value: 'First Name' }],
        },
      };

      vi.mocked(service.uploadDocument).mockResolvedValue({
        sourceId: 'source-1',
        name: 'First Name',
        type: 'PDF',
        status: 'PENDING',
        message: 'Document queued for processing',
      });

      const request = mockFastifyRequest({
        file: vi.fn().mockResolvedValue(mockFile),
      }) as any;
      const reply = mockFastifyReply();

      await controller.uploadDocument(request, reply);

      expect(service.uploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'First Name',
        })
      );
    });
  });

  describe('listSources', () => {
    it('should return paginated sources list', async () => {
      vi.mocked(service.listSources).mockResolvedValue({
        sources: [{ id: 'source-1', name: 'Doc', type: 'PDF', status: 'INDEXED' }] as any,
        total: 1,
        limit: 20,
        offset: 0,
      });

      const request = mockFastifyRequest({
        query: { limit: '20', offset: '0' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.listSources(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.sources).toHaveLength(1);
      expect(reply.body.data.total).toBe(1);
    });
  });

  describe('getSource', () => {
    it('should return source data', async () => {
      const mockSource = {
        id: 'source-1',
        name: 'Document',
        type: 'PDF',
        status: 'INDEXED',
        _count: { chunks: 10 },
      };
      vi.mocked(service.getSource).mockResolvedValue(mockSource as any);

      const request = mockFastifyRequest({
        params: { id: 'source-1' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getSource(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockSource);
    });

    it('should return 404 for non-existent source', async () => {
      vi.mocked(service.getSource).mockResolvedValue(null);

      const request = mockFastifyRequest({
        params: { id: 'invalid' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.getSource(request, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('deleteSource', () => {
    it('should delete source and return success', async () => {
      vi.mocked(service.deleteSource).mockResolvedValue(undefined);

      const request = mockFastifyRequest({
        params: { id: 'source-1' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.deleteSource(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.deleted).toBe(true);
    });
  });

  describe('reindexSource', () => {
    it('should trigger reindex and return result', async () => {
      vi.mocked(service.reindexSource).mockResolvedValue({
        sourceId: 'source-1',
        status: 'PENDING',
        message: 'Reindex queued',
      });

      const request = mockFastifyRequest({
        params: { id: 'source-1' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.reindexSource(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data.status).toBe('PENDING');
    });
  });

  describe('searchKnowledge', () => {
    it('should return search results', async () => {
      const mockResults = [
        {
          score: 0.9,
          text: 'Matching content',
          sourceId: 'source-1',
          sourceName: 'FAQ',
          chunkIndex: 0,
        },
      ];
      vi.mocked(service.searchKnowledge).mockResolvedValue(mockResults);

      const request = mockFastifyRequest({
        query: { q: 'search query', limit: '5', threshold: '0.7' },
      }) as any;
      const reply = mockFastifyReply();

      await controller.searchKnowledge(request, reply);

      expect(reply.body.success).toBe(true);
      expect(reply.body.data).toEqual(mockResults);
    });
  });
});
