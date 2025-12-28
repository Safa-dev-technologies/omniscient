import { describe, it, expect, vi, beforeEach } from 'vitest';
import { botEngine } from '../../../src/modules/bot/bot.engine.js';

// Mock all dependencies
vi.mock('../../../src/lib/llm/index.js', () => ({
  generateEmbedding: vi.fn(() => Promise.resolve([0.1, 0.2, 0.3])),
  chatWithFallback: vi.fn(() =>
    Promise.resolve({
      content: 'This is the bot response.',
      tokensUsed: { total: 150 },
    })
  ),
}));

vi.mock('../../../src/lib/pinecone.js', () => ({
  queryVectors: vi.fn(),
}));

vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: {
    RAG_TOP_K: 5,
    RAG_MIN_SCORE: 0.7,
    MAX_RESPONSE_TOKENS: 500,
    MAX_CONTEXT_TOKENS: 2000,
    MAX_CONVERSATION_HISTORY: 10,
    LOW_CONFIDENCE_THRESHOLD: 0.5,
  },
}));

vi.mock('../../../src/utils/token-counter.js', () => ({
  truncateToTokenLimit: vi.fn((text: string) => text),
}));

vi.mock('../../../src/lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/modules/bot/bot.prompts.js', () => ({
  buildSystemPrompt: vi.fn((params: any) => {
    let prompt = `You are ${params.botName}. Answer questions using ONLY the provided knowledge base.`;
    if (params.customInstructions) {
      prompt += `\n\nAdditional instructions: ${params.customInstructions}`;
    }
    if (params.knowledgeContext) {
      prompt += `\n\nRelevant information from the knowledge base:\n${params.knowledgeContext}\n---`;
    }
    return prompt;
  }),
  buildFallbackResponse: vi.fn((message: string | null) => {
    return (
      message || "I'm sorry, I cannot help with that. Please contact a human agent for assistance."
    );
  }),
}));

vi.mock('../../../src/modules/bot/bot.escalation.js', () => ({
  evaluateEscalation: vi.fn((params: any) => {
    // Mock escalation logic - check USER_REQUEST patterns first
    if (
      /speak.*(human|agent|person|someone)/i.test(params.userMessage) ||
      /talk.*(human|agent|person|someone)/i.test(params.userMessage) ||
      /escalate/i.test(params.userMessage) ||
      /real person/i.test(params.userMessage) ||
      /customer service/i.test(params.userMessage) ||
      /representative/i.test(params.userMessage) ||
      /manager/i.test(params.userMessage)
    ) {
      return { shouldEscalate: true, reason: 'USER_REQUEST' };
    }
    if (params.confidence < 0.5) {
      return { shouldEscalate: true, reason: 'LOW_CONFIDENCE' };
    }
    return { shouldEscalate: false };
  }),
}));

const { queryVectors } = await import('../../../src/lib/pinecone.js');
const { chatWithFallback, generateEmbedding } = await import('../../../src/lib/llm/index.js');

describe('Bot Engine', () => {
  const baseTenant = {
    id: 'tenant-1',
    botName: 'TestBot',
    systemPrompt: null,
    fallbackMessage: null,
  };

  const baseParams = {
    tenantId: 'tenant-1',
    tenant: baseTenant,
    conversationId: 'conv-1',
    userMessage: 'What is the return policy?',
    history: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateResponse', () => {
    it('should return immediate escalation for USER_REQUEST trigger', async () => {
      const result = await botEngine.generateResponse({
        ...baseParams,
        userMessage: 'I want to speak to a human',
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.escalationReason).toBe('USER_REQUEST');
      expect(result.response).toContain('human agent');
      expect(queryVectors).not.toHaveBeenCalled();
    });

    it('should return fallback when no contexts retrieved', async () => {
      vi.mocked(queryVectors).mockResolvedValue([]);

      const result = await botEngine.generateResponse(baseParams);

      expect(result.confidence).toBe(0);
      expect(result.response).toContain("I'm sorry");
      expect(chatWithFallback).not.toHaveBeenCalled();
    });

    it('should return fallback when confidence < 0.3', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.2, metadata: { text: 'Low relevance' } },
      ]);

      const result = await botEngine.generateResponse(baseParams);

      expect(result.confidence).toBeLessThan(0.3);
      expect(chatWithFallback).not.toHaveBeenCalled();
    });

    it('should generate response with knowledge context', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        {
          id: '1',
          score: 0.9,
          metadata: {
            text: 'Return policy is 30 days',
            sourceId: 'src-1',
            sourceName: 'FAQ',
            chunkIndex: 0,
          },
        },
        {
          id: '2',
          score: 0.85,
          metadata: {
            text: 'Full refund within 30 days',
            sourceId: 'src-1',
            sourceName: 'FAQ',
            chunkIndex: 1,
          },
        },
      ]);

      const result = await botEngine.generateResponse(baseParams);

      expect(chatWithFallback).toHaveBeenCalled();
      expect(result.response).toBe('This is the bot response.');
      expect(result.tokensUsed).toBe(150);
    });

    it('should include sources in response', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        {
          id: '1',
          score: 0.9,
          metadata: {
            text: 'Content',
            sourceId: 'src-1',
            sourceName: 'FAQ Document',
            chunkIndex: 0,
            sectionTitle: 'Returns',
          },
        },
      ]);

      const result = await botEngine.generateResponse(baseParams);

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        sourceId: 'src-1',
        sourceName: 'FAQ Document',
        chunkIndex: 0,
        sectionTitle: 'Returns',
        score: 0.9,
      });
    });

    it('should calculate confidence from top 3 context scores', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.9, metadata: { text: 'A' } },
        { id: '2', score: 0.8, metadata: { text: 'B' } },
        { id: '3', score: 0.7, metadata: { text: 'C' } },
        { id: '4', score: 0.6, metadata: { text: 'D' } }, // Not included in avg
      ]);

      const result = await botEngine.generateResponse(baseParams);

      // Average of 0.9, 0.8, 0.7 = 0.8
      expect(result.confidence).toBe(0.8);
    });

    it('should trigger escalation for low confidence', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.4, metadata: { text: 'Marginal match' } },
      ]);

      const result = await botEngine.generateResponse(baseParams);

      expect(result.shouldEscalate).toBe(true);
      expect(result.escalationReason).toBe('LOW_CONFIDENCE');
    });

    it('should not escalate for high confidence', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.9, metadata: { text: 'Good match' } },
        { id: '2', score: 0.85, metadata: { text: 'Also good' } },
      ]);

      const result = await botEngine.generateResponse(baseParams);

      expect(result.shouldEscalate).toBe(false);
      expect(result.escalationReason).toBeUndefined();
    });

    it('should include history context for short queries', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.9, metadata: { text: 'Content' } },
      ]);

      await botEngine.generateResponse({
        ...baseParams,
        userMessage: 'How much?', // Short query
        history: [
          { role: 'user', content: 'Tell me about Product X' },
          { role: 'assistant', content: 'Product X is great' },
        ],
      });

      // The embedding should include context from history
      expect(generateEmbedding).toHaveBeenCalledWith(expect.stringContaining('Product X'));
    });

    it('should include history context for follow-up queries', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.9, metadata: { text: 'Content' } },
      ]);

      await botEngine.generateResponse({
        ...baseParams,
        userMessage: 'What about that feature?', // Follow-up pattern
        history: [
          { role: 'user', content: 'Tell me about the premium plan' },
          { role: 'assistant', content: 'The premium plan includes...' },
        ],
      });

      expect(generateEmbedding).toHaveBeenCalledWith(expect.stringContaining('premium plan'));
    });

    it('should use message only for long standalone queries', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        { id: '1', score: 0.9, metadata: { text: 'Content' } },
      ]);

      // Use a message > 50 chars that doesn't match follow-up patterns (no "that", "this", "it", etc.)
      const longMessage =
        'Please provide detailed information about your product pricing structure and available payment options for enterprise customers.';
      await botEngine.generateResponse({
        ...baseParams,
        userMessage: longMessage,
        history: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
      });

      // Should use the long message directly (no history context)
      expect(generateEmbedding).toHaveBeenCalledWith(longMessage);
    });

    it('should handle retrieval errors gracefully', async () => {
      vi.mocked(queryVectors).mockRejectedValue(new Error('Pinecone error'));

      const result = await botEngine.generateResponse(baseParams);

      // Should return fallback, not throw
      expect(result.confidence).toBe(0);
      expect(result.response).toContain("I'm sorry");
    });

    it('should use custom fallback message from tenant', async () => {
      vi.mocked(queryVectors).mockResolvedValue([]);

      const result = await botEngine.generateResponse({
        ...baseParams,
        tenant: {
          ...baseTenant,
          fallbackMessage: 'Custom: Please contact support@example.com',
        },
      });

      expect(result.response).toBe('Custom: Please contact support@example.com');
    });

    it('should format knowledge context with numbering and source names', async () => {
      vi.mocked(queryVectors).mockResolvedValue([
        {
          id: '1',
          score: 0.9,
          metadata: {
            text: 'First context',
            sourceId: 'src-1',
            sourceName: 'Document A',
            chunkIndex: 0,
          },
        },
        {
          id: '2',
          score: 0.85,
          metadata: {
            text: 'Second context',
            sourceId: 'src-2',
            sourceName: 'Document B',
            chunkIndex: 1,
          },
        },
      ]);

      await botEngine.generateResponse(baseParams);

      // Check that buildSystemPrompt was called with formatted context
      const { buildSystemPrompt } = await import('../../../src/modules/bot/bot.prompts.js');
      expect(buildSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          knowledgeContext: expect.stringContaining('[1] First context'),
        })
      );
    });

    it('should truncate long contexts', async () => {
      const { truncateToTokenLimit } = await import('../../../src/utils/token-counter.js');
      vi.mocked(truncateToTokenLimit).mockImplementation((text: string) => text.substring(0, 100));

      vi.mocked(queryVectors).mockResolvedValue([
        {
          id: '1',
          score: 0.9,
          metadata: {
            text: 'A'.repeat(500), // Very long text
            sourceId: 'src-1',
            sourceName: 'Long Document',
            chunkIndex: 0,
          },
        },
      ]);

      await botEngine.generateResponse(baseParams);

      expect(truncateToTokenLimit).toHaveBeenCalled();
    });
  });
});
