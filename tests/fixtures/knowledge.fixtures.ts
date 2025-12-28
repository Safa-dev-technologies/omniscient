export const mockKnowledgeSource = {
  id: 'source-123',
  tenantId: 'tenant-1',
  name: 'FAQ Document',
  type: 'PDF',
  originalFilename: 'faq.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024,
  storagePath: 'tenant-1/abc123/faq.pdf',
  status: 'INDEXED',
  pineconeNamespace: 'tenant_tenant-1',
  chunkCount: 10,
  tokenCount: 500,
  uploadedAt: new Date(),
  indexedAt: new Date(),
};

export const mockKnowledgeChunk = {
  id: 'chunk-1',
  sourceId: 'source-123',
  vectorId: 'vec-1',
  content: 'This is chunk content',
  chunkIndex: 0,
};

export const mockPineconeMatch = {
  id: 'vec-1',
  score: 0.9,
  metadata: {
    text: 'Return policy is 30 days',
    sourceId: 'source-123',
    sourceName: 'FAQ Document',
    chunkIndex: 0,
    pageNumber: 1,
  },
};
