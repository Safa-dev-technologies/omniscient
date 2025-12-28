import { logger } from '../logger.js';
import { groqClient } from './groq.client.js';
import { openaiClient } from './openai.client.js';
import type { ChatCompletionOptions, ChatCompletionResult } from './llm.interface.js';

export * from './llm.interface.js';
export { groqClient } from './groq.client.js';
export { openaiClient } from './openai.client.js';

/**
 * Chat with fallback: Groq -> OpenAI
 */
export async function chatWithFallback(
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  try {
    return await groqClient.chat(options);
  } catch (error) {
    logger.warn({ error }, 'Groq failed, falling back to OpenAI');
    return await openaiClient.chat(options);
  }
}

/**
 * Generate embeddings using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return openaiClient.generateEmbedding(text);
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return openaiClient.generateEmbeddings(texts);
}
