/**
 * Mock utilities for external services in integration tests
 *
 * Note: Integration tests use REAL services, but we may want to
 * mock certain external APIs (like OpenAI) in some scenarios
 * to reduce costs and improve test speed.
 */

import { vi } from 'vitest';

/**
 * Mock OpenAI embeddings (optional - for cost savings)
 * Returns deterministic mock embeddings
 */
export function mockOpenAIEmbeddings() {
  const mockEmbedding = Array(1536)
    .fill(0)
    .map(() => Math.random() - 0.5);

  vi.mock('../../../src/lib/llm/index.js', async () => {
    const actual = await vi.importActual('../../../src/lib/llm/index.js');
    return {
      ...actual,
      generateEmbedding: vi.fn().mockResolvedValue(mockEmbedding),
      generateEmbeddings: vi.fn().mockResolvedValue([mockEmbedding]),
    };
  });
}

/**
 * Restore real OpenAI client
 */
export function restoreOpenAIEmbeddings() {
  vi.restoreAllMocks();
}

/**
 * Check if we should use mocks (based on env var)
 */
export function shouldUseMocks(): boolean {
  return process.env.INTEGRATION_USE_MOCKS === 'true';
}
