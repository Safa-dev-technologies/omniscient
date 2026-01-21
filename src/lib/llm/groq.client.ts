import Groq from 'groq-sdk';
import { env } from '../../config/index.js';
import { logger } from '../logger.js';
import { withKeyRotation, createKeyPair } from '../../utils/key-rotation.js';
import type { ChatCompletionOptions, ChatCompletionResult, LLMClient } from './llm.interface.js';

const DEFAULT_MODEL = 'llama-3.1-70b-versatile';

// Key pair for zero-downtime rotation
const groqKeys = createKeyPair(env.GROQ_API_KEY, env.GROQ_API_KEY_SECONDARY);

export class GroqClient implements Omit<LLMClient, 'generateEmbedding' | 'generateEmbeddings'> {
  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, maxTokens = 1000, temperature = 0.7, model = DEFAULT_MODEL } = options;

    logger.debug({ model, messageCount: messages.length }, 'Groq chat request');

    // Use key rotation for automatic fallback
    return withKeyRotation({ serviceName: 'groq', keys: groqKeys }, async (apiKey) => {
      const client = new Groq({ apiKey });

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
}

export const groqClient = new GroqClient();
