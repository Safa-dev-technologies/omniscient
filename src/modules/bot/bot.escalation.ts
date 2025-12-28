import { CONSTANTS } from '../../config/index.js';

const USER_REQUEST_PATTERNS = [
  /speak.*(human|agent|person|someone)/i,
  /talk.*(human|agent|person|someone)/i,
  /escalate/i,
  /real person/i,
  /customer service/i,
  /representative/i,
  /manager/i,
];

const SENSITIVE_TOPICS = [
  'refund',
  'fraud',
  'dispute',
  'legal',
  'complaint',
  'lawyer',
  'sue',
  'police',
  'harassment',
  'discrimination',
];

export interface EscalationCheck {
  shouldEscalate: boolean;
  reason?: string;
}

export function checkUserRequestEscalation(message: string): EscalationCheck {
  for (const pattern of USER_REQUEST_PATTERNS) {
    if (pattern.test(message)) {
      return { shouldEscalate: true, reason: 'USER_REQUEST' };
    }
  }
  return { shouldEscalate: false };
}

export function checkSensitiveTopic(message: string): EscalationCheck {
  const lowerMessage = message.toLowerCase();
  for (const topic of SENSITIVE_TOPICS) {
    if (lowerMessage.includes(topic)) {
      return { shouldEscalate: true, reason: 'SENSITIVE_TOPIC' };
    }
  }
  return { shouldEscalate: false };
}

export function checkLowConfidence(confidence: number): EscalationCheck {
  if (confidence < CONSTANTS.LOW_CONFIDENCE_THRESHOLD) {
    return { shouldEscalate: true, reason: 'LOW_CONFIDENCE' };
  }
  return { shouldEscalate: false };
}

export function checkConversationLength(messageCount: number): EscalationCheck {
  if (messageCount >= CONSTANTS.LONG_CONVERSATION_THRESHOLD) {
    return { shouldEscalate: true, reason: 'LONG_CONVERSATION' };
  }
  return { shouldEscalate: false };
}

export function evaluateEscalation(params: {
  userMessage: string;
  confidence: number;
  historyLength: number;
}): EscalationCheck {
  const { userMessage, confidence, historyLength } = params;

  // Check in priority order
  const userRequest = checkUserRequestEscalation(userMessage);
  if (userRequest.shouldEscalate) return userRequest;

  const sensitive = checkSensitiveTopic(userMessage);
  if (sensitive.shouldEscalate) return sensitive;

  const lowConfidence = checkLowConfidence(confidence);
  if (lowConfidence.shouldEscalate) return lowConfidence;

  const longConversation = checkConversationLength(historyLength);
  if (longConversation.shouldEscalate) return longConversation;

  return { shouldEscalate: false };
}
