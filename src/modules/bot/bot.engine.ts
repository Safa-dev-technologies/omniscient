import { generateEmbedding } from '../../lib/llm/index.js';
import { chatWithFallback } from '../../lib/llm/index.js';
import { queryVectors } from '../../lib/pinecone.js';
import { CONSTANTS } from '../../config/index.js';
import { buildSystemPrompt, buildFallbackResponse } from './bot.prompts.js';
import { evaluateEscalation } from './bot.escalation.js';
import { truncateToTokenLimit } from '../../utils/token-counter.js';
import { logger } from '../../lib/logger.js';
import type { BotGenerateParams, BotResponse, RetrievedContext } from './bot.types.js';
import type { ChatMessage } from '../../lib/llm/llm.interface.js';

class BotEngine {
  async generateResponse(params: BotGenerateParams): Promise<BotResponse> {
    const { tenantId, tenant, conversationId, userMessage, history } = params;

    logger.debug({ conversationId, messageLength: userMessage.length }, 'Generating bot response');

    // Step 1: Check for escalation triggers in user message
    const preEscalation = evaluateEscalation({
      userMessage,
      confidence: 1, // Will be re-evaluated after retrieval
      historyLength: history.length,
    });

    if (preEscalation.shouldEscalate && preEscalation.reason === 'USER_REQUEST') {
      return {
        response: "I'll connect you with a human agent right away. Please hold on.",
        confidence: 1,
        tokensUsed: 0,
        sources: [],
        shouldEscalate: true,
        escalationReason: preEscalation.reason,
      };
    }

    // Step 2: Build search query with conversation context
    const searchQuery = this.buildSearchQuery(userMessage, history);

    // Step 3: Retrieve relevant knowledge
    const contexts = await this.retrieveKnowledge(tenantId, searchQuery);

    // Step 3: Calculate confidence based on retrieval
    const confidence = this.calculateConfidence(contexts);

    // Step 4: Check if we should use fallback
    if (contexts.length === 0 || confidence < 0.3) {
      const fallbackResponse = buildFallbackResponse(tenant.fallbackMessage);

      return {
        response: fallbackResponse,
        confidence,
        tokensUsed: 0,
        sources: [],
        shouldEscalate: confidence < CONSTANTS.LOW_CONFIDENCE_THRESHOLD,
        escalationReason:
          confidence < CONSTANTS.LOW_CONFIDENCE_THRESHOLD ? 'LOW_CONFIDENCE' : undefined,
      };
    }

    // Step 5: Build knowledge context
    const knowledgeContext = this.buildKnowledgeContext(contexts);

    // Step 6: Build system prompt
    const systemPrompt = buildSystemPrompt({
      botName: tenant.botName,
      customInstructions: tenant.systemPrompt,
      knowledgeContext,
    });

    // Step 7: Build messages for LLM
    const messages = this.buildMessages(systemPrompt, history, userMessage);

    // Step 8: Generate response
    const llmResponse = await chatWithFallback({
      messages,
      maxTokens: CONSTANTS.MAX_RESPONSE_TOKENS,
      temperature: 0.7,
    });

    // Step 9: Final escalation check
    const finalEscalation = evaluateEscalation({
      userMessage,
      confidence,
      historyLength: history.length,
    });

    return {
      response: llmResponse.content,
      confidence,
      tokensUsed: llmResponse.tokensUsed.total,
      sources: contexts.map((c) => ({
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        chunkIndex: c.chunkIndex,
        sectionTitle: c.sectionTitle,
        score: c.score,
      })),
      shouldEscalate: finalEscalation.shouldEscalate,
      escalationReason: finalEscalation.reason,
    };
  }

  private buildSearchQuery(
    userMessage: string,
    history: Array<{ role: string; content: string }>
  ): string {
    // For short/ambiguous queries, include recent context
    if (userMessage.length < 50 || this.isFollowUpQuery(userMessage)) {
      const recentMessages = history.slice(-4); // Last 2 exchanges
      const context = recentMessages
        .map((m) => m.content)
        .join(' ')
        .slice(0, 500); // Limit context length
      return `${context} ${userMessage}`.trim();
    }
    return userMessage;
  }

  private isFollowUpQuery(message: string): boolean {
    const followUpPatterns = [
      /^(what|how|when|where|who|why)\s+(about|is|are|was|were)\s+(that|this|it)/i,
      /^(and|but|also|so)\s+/i,
      /\b(that|this|it|they|them|those|these)\b/i,
      /^(more|explain|elaborate|tell me more)/i,
    ];
    return followUpPatterns.some((p) => p.test(message));
  }

  private async retrieveKnowledge(tenantId: string, query: string): Promise<RetrievedContext[]> {
    try {
      const queryEmbedding = await generateEmbedding(query);
      const namespace = `tenant_${tenantId}`;

      const matches = await queryVectors(
        namespace,
        queryEmbedding,
        CONSTANTS.RAG_TOP_K,
        CONSTANTS.RAG_MIN_SCORE
      );

      return matches.map((match) => ({
        text: (match.metadata?.text as string) || '',
        sourceId: (match.metadata?.sourceId as string) || '',
        sourceName: (match.metadata?.sourceName as string) || '',
        chunkIndex: (match.metadata?.chunkIndex as number) || 0,
        sectionTitle: match.metadata?.sectionTitle as string | undefined,
        score: match.score || 0,
      }));
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to retrieve knowledge');
      return [];
    }
  }

  private calculateConfidence(contexts: RetrievedContext[]): number {
    if (contexts.length === 0) return 0;

    // Average of top 3 scores
    const topScores = contexts.slice(0, 3).map((c) => c.score);
    const avgScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;

    return Math.round(avgScore * 100) / 100;
  }

  private buildKnowledgeContext(contexts: RetrievedContext[]): string {
    const contextTexts = contexts.map((c, i) => {
      let text = `[${i + 1}] ${c.text}`;
      if (c.sourceName) {
        text += `\n(Source: ${c.sourceName})`;
      }
      return text;
    });

    const fullContext = contextTexts.join('\n\n');

    // Truncate if too long
    return truncateToTokenLimit(fullContext, CONSTANTS.MAX_CONTEXT_TOKENS);
  }

  private buildMessages(
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    userMessage: string
  ): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // Add conversation history (limited)
    const recentHistory = history.slice(-CONSTANTS.MAX_CONVERSATION_HISTORY);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role.toLowerCase() as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }
}

export const botEngine = new BotEngine();
