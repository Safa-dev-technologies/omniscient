import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildFallbackResponse } from '../../../src/modules/bot/bot.prompts.js';

describe('Bot Prompts', () => {
  describe('buildSystemPrompt', () => {
    it('should include bot name in prompt', () => {
      const result = buildSystemPrompt({ botName: 'TestBot' });
      expect(result).toContain('You are TestBot');
    });

    it('should include base instructions', () => {
      const result = buildSystemPrompt({ botName: 'Bot' });
      expect(result).toContain('Answer questions using ONLY the provided knowledge base');
      expect(result).toContain('Be friendly, professional, and concise');
    });

    it('should append custom instructions when provided', () => {
      const result = buildSystemPrompt({
        botName: 'Bot',
        customInstructions: 'Always greet users warmly',
      });
      expect(result).toContain('Additional instructions:');
      expect(result).toContain('Always greet users warmly');
    });

    it('should append knowledge context when provided', () => {
      const result = buildSystemPrompt({
        botName: 'Bot',
        knowledgeContext: 'Product costs $99',
      });
      expect(result).toContain('Relevant information from the knowledge base:');
      expect(result).toContain('Product costs $99');
      expect(result).toContain('---');
    });

    it('should handle null customInstructions', () => {
      const result = buildSystemPrompt({
        botName: 'Bot',
        customInstructions: null,
      });
      expect(result).not.toContain('Additional instructions:');
    });

    it('should handle undefined knowledgeContext', () => {
      const result = buildSystemPrompt({
        botName: 'Bot',
        knowledgeContext: undefined,
      });
      expect(result).not.toContain('Relevant information from the knowledge base:');
    });
  });

  describe('buildFallbackResponse', () => {
    it('should return custom fallback message when provided', () => {
      const result = buildFallbackResponse('Custom fallback message');
      expect(result).toBe('Custom fallback message');
    });

    it('should return default fallback when message is null', () => {
      const result = buildFallbackResponse(null);
      expect(result).toContain("I'm sorry");
      expect(result).toContain('human agent');
    });

    it('should return default fallback when message is undefined', () => {
      const result = buildFallbackResponse(undefined);
      expect(result).toContain("I'm sorry");
    });
  });
});
