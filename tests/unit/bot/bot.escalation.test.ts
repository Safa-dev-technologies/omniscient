import { describe, it, expect, vi } from 'vitest';
import {
  checkUserRequestEscalation,
  checkSensitiveTopic,
  checkLowConfidence,
  checkConversationLength,
  evaluateEscalation,
} from '../../../src/modules/bot/bot.escalation.js';

// Mock CONSTANTS
vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: {
    LOW_CONFIDENCE_THRESHOLD: 0.5,
    LONG_CONVERSATION_THRESHOLD: 20,
  },
}));

describe('Bot Escalation', () => {
  describe('checkUserRequestEscalation', () => {
    it('should detect "speak to human" request', () => {
      const result = checkUserRequestEscalation('I want to speak to a human');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "talk to agent" request', () => {
      const result = checkUserRequestEscalation('Can I talk to an agent?');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "escalate" keyword', () => {
      const result = checkUserRequestEscalation('Please escalate this issue');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "real person" request', () => {
      const result = checkUserRequestEscalation('I need a real person');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "customer service" request', () => {
      const result = checkUserRequestEscalation('Transfer me to customer service');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "representative" request', () => {
      const result = checkUserRequestEscalation('Get me a representative');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should detect "manager" request', () => {
      const result = checkUserRequestEscalation('I want to speak to a manager');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });

    it('should return false for normal messages', () => {
      const result = checkUserRequestEscalation('What are your business hours?');
      expect(result).toEqual({ shouldEscalate: false });
    });

    it('should be case insensitive', () => {
      const result = checkUserRequestEscalation('SPEAK TO A HUMAN NOW');
      expect(result).toEqual({ shouldEscalate: true, reason: 'USER_REQUEST' });
    });
  });

  describe('checkSensitiveTopic', () => {
    it('should detect "refund" topic', () => {
      const result = checkSensitiveTopic('I want a refund immediately');
      expect(result).toEqual({ shouldEscalate: true, reason: 'SENSITIVE_TOPIC' });
    });

    it('should detect "fraud" topic', () => {
      const result = checkSensitiveTopic('This looks like fraud');
      expect(result).toEqual({ shouldEscalate: true, reason: 'SENSITIVE_TOPIC' });
    });

    it('should detect "legal" topic', () => {
      const result = checkSensitiveTopic('I will take legal action');
      expect(result).toEqual({ shouldEscalate: true, reason: 'SENSITIVE_TOPIC' });
    });

    it('should detect "complaint" topic', () => {
      const result = checkSensitiveTopic('I want to file a formal complaint');
      expect(result).toEqual({ shouldEscalate: true, reason: 'SENSITIVE_TOPIC' });
    });

    it('should return false for non-sensitive topics', () => {
      const result = checkSensitiveTopic('What is the price of your product?');
      expect(result).toEqual({ shouldEscalate: false });
    });

    it('should be case insensitive', () => {
      const result = checkSensitiveTopic('I NEED A REFUND');
      expect(result).toEqual({ shouldEscalate: true, reason: 'SENSITIVE_TOPIC' });
    });
  });

  describe('checkLowConfidence', () => {
    it('should return shouldEscalate true when below threshold', () => {
      const result = checkLowConfidence(0.3);
      expect(result).toEqual({ shouldEscalate: true, reason: 'LOW_CONFIDENCE' });
    });

    it('should return shouldEscalate false when above threshold', () => {
      const result = checkLowConfidence(0.7);
      expect(result).toEqual({ shouldEscalate: false });
    });

    it('should return shouldEscalate false when equal to threshold', () => {
      const result = checkLowConfidence(0.5);
      expect(result).toEqual({ shouldEscalate: false });
    });
  });

  describe('checkConversationLength', () => {
    it('should return shouldEscalate true when above threshold', () => {
      const result = checkConversationLength(25);
      expect(result).toEqual({ shouldEscalate: true, reason: 'LONG_CONVERSATION' });
    });

    it('should return shouldEscalate false when below threshold', () => {
      const result = checkConversationLength(10);
      expect(result).toEqual({ shouldEscalate: false });
    });

    it('should return shouldEscalate true when equal to threshold', () => {
      const result = checkConversationLength(20);
      expect(result).toEqual({ shouldEscalate: true, reason: 'LONG_CONVERSATION' });
    });
  });

  describe('evaluateEscalation', () => {
    it('should prioritize USER_REQUEST over other reasons', () => {
      const result = evaluateEscalation({
        userMessage: 'I want to speak to a human about this refund',
        confidence: 0.3,
        historyLength: 25,
      });
      expect(result.reason).toBe('USER_REQUEST');
    });

    it('should return SENSITIVE_TOPIC if no user request', () => {
      const result = evaluateEscalation({
        userMessage: 'I need a refund',
        confidence: 0.8,
        historyLength: 5,
      });
      expect(result.reason).toBe('SENSITIVE_TOPIC');
    });

    it('should return LOW_CONFIDENCE if no sensitive topic', () => {
      const result = evaluateEscalation({
        userMessage: 'What is the price?',
        confidence: 0.3,
        historyLength: 5,
      });
      expect(result.reason).toBe('LOW_CONFIDENCE');
    });

    it('should return LONG_CONVERSATION as last check', () => {
      const result = evaluateEscalation({
        userMessage: 'What is the price?',
        confidence: 0.8,
        historyLength: 25,
      });
      expect(result.reason).toBe('LONG_CONVERSATION');
    });

    it('should return shouldEscalate false if no conditions met', () => {
      const result = evaluateEscalation({
        userMessage: 'What is the price?',
        confidence: 0.8,
        historyLength: 5,
      });
      expect(result).toEqual({ shouldEscalate: false });
    });
  });
});
