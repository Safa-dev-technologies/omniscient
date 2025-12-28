/**
 * Approximate token count for text.
 * Uses a simple heuristic: ~4 characters per token for English text.
 * For production, consider using tiktoken for accurate counts.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token limit.
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 4;
  if (text.length <= estimatedChars) {
    return text;
  }
  return text.substring(0, estimatedChars - 3) + '...';
}
