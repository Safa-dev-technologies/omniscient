import { logger } from '../lib/logger.js';

export interface ProcessingMetrics {
  sourceId: string;
  tenantId: string;
  fileSize: number;
  mimeType: string;
  chunkCount: number;
  tokenCount: number;
  extractionTimeMs: number;
  chunkingTimeMs: number;
  embeddingTimeMs: number;
  totalTimeMs: number;
  success: boolean;
  errorType?: string;
}

export function logProcessingMetrics(metrics: ProcessingMetrics): void {
  const derivedMetrics = {
    tokensPerChunk: metrics.chunkCount > 0 ? metrics.tokenCount / metrics.chunkCount : 0,
    bytesPerSecond: metrics.totalTimeMs > 0 ? metrics.fileSize / (metrics.totalTimeMs / 1000) : 0,
    embedsPerSecond:
      metrics.embeddingTimeMs > 0 ? metrics.chunkCount / (metrics.embeddingTimeMs / 1000) : 0,
  };

  logger.info(
    {
      event: 'document_processed',
      ...metrics,
      ...derivedMetrics,
    },
    'Document processing complete'
  );
}
