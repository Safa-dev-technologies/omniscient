import OpenAI from 'openai';
import { env } from '../../config/index.js';
import { logger } from '../logger.js';
import { withKeyRotation, createKeyPair } from '../../utils/key-rotation.js';
import type { ChatCompletionOptions, ChatCompletionResult, LLMClient } from './llm.interface.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

// Key pair for zero-downtime rotation
const openaiKeys = createKeyPair(env.OPENAI_API_KEY, env.OPENAI_API_KEY_SECONDARY);

export class OpenAIClient implements LLMClient {
  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, maxTokens = 1000, temperature = 0.7, model = DEFAULT_MODEL } = options;

    logger.debug({ model, messageCount: messages.length }, 'OpenAI chat request');

    // Use key rotation for automatic fallback
    return withKeyRotation({ serviceName: 'openai-chat', keys: openaiKeys }, async (apiKey) => {
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      });

      const choice = response.choices[0];

      return {
        content: choice.message.content ?? '',
        tokensUsed: {
          prompt: response.usage?.prompt_tokens ?? 0,
          completion: response.usage?.completion_tokens ?? 0,
          total: response.usage?.total_tokens ?? 0,
        },
        model: response.model,
        finishReason: choice.finish_reason ?? 'unknown',
      };
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Use key rotation for automatic fallback
    return withKeyRotation(
      { serviceName: 'openai-embeddings', keys: openaiKeys },
      async (apiKey) => {
        const client = new OpenAI({ apiKey });

        const response = await client.embeddings.create({
          model: env.EMBEDDING_MODEL,
          input: text,
          dimensions: env.EMBEDDING_DIMENSIONS,
        });

        return response.data[0].embedding;
      }
    );
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Use key rotation for automatic fallback
    return withKeyRotation(
      { serviceName: 'openai-embeddings', keys: openaiKeys },
      async (apiKey) => {
        const client = new OpenAI({ apiKey });

        const response = await client.embeddings.create({
          model: env.EMBEDDING_MODEL,
          input: texts,
          dimensions: env.EMBEDDING_DIMENSIONS,
        });

        return response.data.map((d) => d.embedding);
      }
    );
  }
}

export const openaiClient = new OpenAIClient();
