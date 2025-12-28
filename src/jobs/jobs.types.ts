export interface ProcessDocumentJob {
  sourceId: string;
  tenantId: string;
}

export interface GenerateEmbeddingsJob {
  sourceId: string;
  tenantId: string;
  chunks: Array<{
    text: string;
    index: number;
    tokenCount: number;
    metadata: Record<string, unknown>;
  }>;
}
