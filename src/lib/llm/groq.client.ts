import Groq from 'groq-sdk';
import { env } from '../../config/index.js';
import { logger } from '../logger.js';
import type { ChatCompletionOptions, ChatCompletionResult, LLMClient } from './llm.interface.js';

const DEFAULT_MODEL = 'llama-3.1-70b-versatile';

export class GroqClient implements Omit<LLMClient, 'generateEmbedding' | 'generateEmbeddings'> {
  private client: Groq;

  constructor() {
    this.client = new Groq({
      apiKey: env.GROQ_API_KEY,
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const { messages, maxTokens = 1000, temperature = 0.7, model = DEFAULT_MODEL } = options;

    logger.debug({ model, messageCount: messages.length }, 'Groq chat request');

    const response = await this.client.chat.completions.create({
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
  }
}

export const groqClient = new GroqClient();
