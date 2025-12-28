import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as knowledgeService from '../../../src/modules/knowledge/knowledge.service.js';
import {
  mockKnowledgeSource,
  mockKnowledgeChunk,
  mockPineconeMatch,
} from '../../fixtures/knowledge.fixtures.js';

vi.mock('../../../src/lib/prisma.js', () => {
  const mockPrisma = {
    knowledgeSource: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    knowledgeChunk: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

vi.mock('../../../src/lib/storage/index.js', () => ({
  storage: {
    upload: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../../src/lib/llm/index.js', () => ({
  generateEmbedding: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
}));

vi.mock('../../../src/lib/pinecone.js', () => {
  const mockDeleteMany = vi.fn();
  const mockNamespace = vi.fn(() => ({ deleteMany: mockDeleteMany }));
  return {
    queryVectors: vi.fn(),
    getPineconeIndex: vi.fn(() => ({
      namespace: mockNamespace,
    })),
  };
});

vi.mock('../../../src/jobs/queue.js', () => ({
  documentQueue: {
    add: vi.fn(),
  },
}));

vi.mock('../../../src/modules/knowledge/processors/index.js', () => ({
  getProcessor: vi.fn((mimeType: string) => {
    const supported = [
      'application/pdf',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    return supported.includes(mimeType) ? {} : null;
  }),
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { prisma } = await import('../../../src/lib/prisma.js');
const { storage } = await import('../../../src/lib/storage/index.js');
const { generateEmbedding } = await import('../../../src/lib/llm/index.js');
const { queryVectors, getPineconeIndex } = await import('../../../src/lib/pinecone.js');
const { documentQueue } = await import('../../../src/jobs/queue.js');
const { getProcessor } = await import('../../../src/modules/knowledge/processors/index.js');

describe('Knowledge Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset getProcessor to return a processor for supported types
    vi.mocked(getProcessor).mockImplementation((mimeType: string) => {
      const supported = [
        'application/pdf',
        'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      return supported.includes(mimeType) ? {} : null;
    });
  });

  describe('uploadDocument', () => {
    const baseParams = {
      tenantId: 'tenant-1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test content'),
    };

    it('should upload PDF document successfully', async () => {
      vi.mocked(prisma.knowledgeSource.create).mockResolvedValue(mockKnowledgeSource as any);

      const result = await knowledgeService.uploadDocument(baseParams);

      expect(storage.upload).toHaveBeenCalled();
      expect(prisma.knowledgeSource.create).toHaveBeenCalled();
      expect(documentQueue.add).toHaveBeenCalledWith('PROCESS_DOCUMENT', {
        sourceId: mockKnowledgeSource.id,
        tenantId: 'tenant-1',
      });
      expect(result.sourceId).toBe(mockKnowledgeSource.id);
    });

    it('should upload DOCX document successfully', async () => {
      vi.mocked(prisma.knowledgeSource.create).mockResolvedValue({
        ...mockKnowledgeSource,
        type: 'DOCX',
      } as any);

      await knowledgeService.uploadDocument({
        ...baseParams,
        filename: 'doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      expect(prisma.knowledgeSource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DOCX',
        }),
      });
    });

    it('should upload TXT document successfully', async () => {
      vi.mocked(prisma.knowledgeSource.create).mockResolvedValue({
        ...mockKnowledgeSource,
        type: 'TXT',
      } as any);

      await knowledgeService.uploadDocument({
        ...baseParams,
        filename: 'doc.txt',
        mimeType: 'text/plain',
      });

      expect(prisma.knowledgeSource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'TXT',
        }),
      });
    });

    it('should throw for unsupported file type', async () => {
      await expect(
        knowledgeService.uploadDocument({
          ...baseParams,
          mimeType: 'image/png',
        })
      ).rejects.toThrow('Unsupported file type: image/png');
    });

    it('should throw for file type without processor', async () => {
      // CSV is in ALLOWED_MIME_TYPES but no processor exists
      vi.mocked(getProcessor).mockReturnValue(null);

      await expect(
        knowledgeService.uploadDocument({
          ...baseParams,
          mimeType: 'text/csv',
        })
      ).rejects.toThrow('No processor for file type: text/csv');
    });

    it('should create knowledgeSource with status PENDING', async () => {
      vi.mocked(prisma.knowledgeSource.create).mockResolvedValue(mockKnowledgeSource as any);

      await knowledgeService.uploadDocument(baseParams);

      expect(prisma.knowledgeSource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'PENDING',
        }),
      });
    });

    it('should generate storage path with tenantId', async () => {
      vi.mocked(prisma.knowledgeSource.create).mockResolvedValue(mockKnowledgeSource as any);

      await knowledgeService.uploadDocument(baseParams);

      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringContaining('tenant-1/'),
        expect.any(Buffer),
        'application/pdf'
      );
    });
  });

  describe('listSources', () => {
    it('should return paginated list of sources', async () => {
      vi.mocked(prisma.knowledgeSource.findMany).mockResolvedValue([mockKnowledgeSource] as any);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(1);

      const result = await knowledgeService.listSources('tenant-1', {
        limit: 20,
        offset: 0,
      });

      expect(result.sources).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should filter by status', async () => {
      vi.mocked(prisma.knowledgeSource.findMany).mockResolvedValue([]);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);

      await knowledgeService.listSources('tenant-1', {
        status: 'INDEXED',
        limit: 20,
        offset: 0,
      });

      expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'INDEXED',
          }),
        })
      );
    });

    it('should respect limit and offset', async () => {
      vi.mocked(prisma.knowledgeSource.findMany).mockResolvedValue([]);
      vi.mocked(prisma.knowledgeSource.count).mockResolvedValue(0);

      await knowledgeService.listSources('tenant-1', {
        limit: 10,
        offset: 20,
      });

      expect(prisma.knowledgeSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );
    });
  });

  describe('getSource', () => {
    it('should return source with chunk count', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue({
        ...mockKnowledgeSource,
        _count: { chunks: 10 },
      } as any);

      const result = await knowledgeService.getSource('tenant-1', 'source-123');

      expect(result).toBeDefined();
      expect(prisma.knowledgeSource.findFirst).toHaveBeenCalledWith({
        where: { id: 'source-123', tenantId: 'tenant-1' },
        include: { _count: { select: { chunks: true } } },
      });
    });

    it('should return null for non-existent source', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(null);

      const result = await knowledgeService.getSource('tenant-1', 'invalid');

      expect(result).toBeNull();
    });
  });

  describe('deleteSource', () => {
    it('should delete source from database', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(mockKnowledgeSource as any);
      vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([mockKnowledgeChunk] as any);

      await knowledgeService.deleteSource('tenant-1', 'source-123');

      expect(prisma.knowledgeSource.delete).toHaveBeenCalledWith({
        where: { id: 'source-123' },
      });
    });

    it('should delete vectors from Pinecone', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(mockKnowledgeSource as any);
      vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([mockKnowledgeChunk] as any);

      const mockDeleteManyFn = vi.fn();
      const mockNamespaceFn = vi.fn(() => ({ deleteMany: mockDeleteManyFn }));
      vi.mocked(getPineconeIndex).mockReturnValue({
        namespace: mockNamespaceFn,
      } as any);

      await knowledgeService.deleteSource('tenant-1', 'source-123');

      expect(mockNamespaceFn).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockDeleteManyFn).toHaveBeenCalledWith(['vec-1']);
    });

    it('should delete file from storage', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(mockKnowledgeSource as any);
      vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([]);

      await knowledgeService.deleteSource('tenant-1', 'source-123');

      expect(storage.delete).toHaveBeenCalledWith(mockKnowledgeSource.storagePath);
    });

    it('should throw for non-existent source', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(null);

      await expect(knowledgeService.deleteSource('tenant-1', 'invalid')).rejects.toThrow(
        'Source not found'
      );
    });

    it('should handle storage deletion failure gracefully', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(mockKnowledgeSource as any);
      vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([]);
      vi.mocked(storage.delete).mockRejectedValue(new Error('Storage error'));

      // Should not throw
      await expect(knowledgeService.deleteSource('tenant-1', 'source-123')).resolves.not.toThrow();

      const { logger } = await import('../../../src/lib/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('reindexSource', () => {
    it('should delete existing vectors and requeue', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(mockKnowledgeSource as any);
      vi.mocked(prisma.knowledgeChunk.findMany).mockResolvedValue([mockKnowledgeChunk] as any);

      const mockDeleteManyFn = vi.fn();
      const mockNamespaceFn = vi.fn(() => ({ deleteMany: mockDeleteManyFn }));
      vi.mocked(getPineconeIndex).mockReturnValue({
        namespace: mockNamespaceFn,
      } as any);

      const result = await knowledgeService.reindexSource('tenant-1', 'source-123');

      expect(mockNamespaceFn).toHaveBeenCalledWith('tenant_tenant-1');
      expect(mockDeleteManyFn).toHaveBeenCalledWith(['vec-1']);
      expect(prisma.knowledgeSource.update).toHaveBeenCalledWith({
        where: { id: 'source-123' },
        data: expect.objectContaining({
          status: 'PENDING',
          chunkCount: 0,
          tokenCount: 0,
        }),
      });
      expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
        where: { sourceId: 'source-123' },
      });
      expect(documentQueue.add).toHaveBeenCalled();
      expect(result.status).toBe('PENDING');
    });

    it('should throw for non-existent source', async () => {
      vi.mocked(prisma.knowledgeSource.findFirst).mockResolvedValue(null);

      await expect(knowledgeService.reindexSource('tenant-1', 'invalid')).rejects.toThrow(
        'Source not found'
      );
    });
  });

  describe('searchKnowledge', () => {
    it('should generate embedding and query Pinecone', async () => {
      vi.mocked(queryVectors).mockResolvedValue([mockPineconeMatch]);

      const result = await knowledgeService.searchKnowledge('tenant-1', {
        q: 'return policy',
        limit: 5,
        threshold: 0.7,
      });

      expect(generateEmbedding).toHaveBeenCalledWith('return policy');
      expect(queryVectors).toHaveBeenCalledWith('tenant_tenant-1', [0.1, 0.2, 0.3], 5, 0.7);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        score: 0.9,
        text: 'Return policy is 30 days',
        sourceId: 'source-123',
        sourceName: 'FAQ Document',
      });
    });
  });
});
