import type { EscalationReason } from '@prisma/client';

/**
 * Escalation trigger detection result
 */
export interface EscalationTrigger {
  shouldEscalate: boolean;
  reason: EscalationReason;
  confidence: number; // 0-1 score
  details?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Escalation evaluation context
 */
export interface EscalationContext {
  userMessage: string;
  confidenceScore?: number;
  conversationLength: number;
  hasMedia: boolean;
  repeatedQuestions: number;
  sensitiveTopics?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * External ticketing system configuration
 */
export interface TicketingSystemConfig {
  system: 'zendesk' | 'freshdesk';
  apiKey: string;
  domain: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

/**
 * External ticket creation result
 */
export interface ExternalTicket {
  ticketId: string;
  system: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Escalation resolution options
 */
export interface EscalationResolution {
  resolved: boolean;
  returnedToBot?: boolean;
  resolutionNotes?: string;
  agentId?: string;
  agentName?: string;
}
