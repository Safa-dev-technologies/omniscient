import type { ConversationStatus } from '@prisma/client';
import { logger } from '../../lib/logger.js';

/**
 * Valid status transitions for conversations
 * Maps from current status to array of allowed next statuses
 */
const VALID_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  BOT_ACTIVE: ['ESCALATED', 'RESOLVED', 'CLOSED'],
  ESCALATED: ['HUMAN_ACTIVE', 'RESOLVED', 'CLOSED'],
  HUMAN_ACTIVE: ['BOT_ACTIVE', 'ESCALATED', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'BOT_ACTIVE'], // Can reopen resolved conversations
  CLOSED: [], // Terminal state - no transitions allowed
};

/**
 * Status transition metadata
 */
interface TransitionMetadata {
  timestampField?: 'escalatedAt' | 'resolvedAt' | 'closedAt';
  requiresEscalation?: boolean;
  requiresResolution?: boolean;
}

const TRANSITION_METADATA: Record<ConversationStatus, TransitionMetadata> = {
  BOT_ACTIVE: {},
  ESCALATED: {
    timestampField: 'escalatedAt',
    requiresEscalation: true,
  },
  HUMAN_ACTIVE: {},
  RESOLVED: {
    timestampField: 'resolvedAt',
    requiresResolution: true,
  },
  CLOSED: {
    timestampField: 'closedAt',
  },
};

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: ConversationStatus, to: ConversationStatus): boolean {
  const allowedTransitions = VALID_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}

/**
 * Get allowed transitions from a given status
 */
export function getAllowedTransitions(from: ConversationStatus): ConversationStatus[] {
  return [...VALID_TRANSITIONS[from]];
}

/**
 * Get transition metadata for a status
 */
export function getTransitionMetadata(status: ConversationStatus): TransitionMetadata {
  return TRANSITION_METADATA[status];
}

/**
 * Validate and prepare status transition
 * Returns update data for Prisma update operation
 */
export function prepareStatusTransition(
  from: ConversationStatus,
  to: ConversationStatus,
  existingEscalation?: { id: string } | null
): {
  status: ConversationStatus;
  escalatedAt?: Date;
  resolvedAt?: Date;
  closedAt?: Date;
} {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid status transition from ${from} to ${to}. Allowed transitions: ${getAllowedTransitions(from).join(', ')}`
    );
  }

  const metadata = getTransitionMetadata(to);
  const updateData: {
    status: ConversationStatus;
    escalatedAt?: Date;
    resolvedAt?: Date;
    closedAt?: Date;
  } = {
    status: to,
  };

  // Set timestamp field if required
  if (metadata.timestampField) {
    updateData[metadata.timestampField] = new Date();
  }

  // Validate escalation requirement
  if (metadata.requiresEscalation && !existingEscalation) {
    throw new Error(`Status ${to} requires an escalation record`);
  }

  // Update lastActivityAt for all transitions
  // (This will be handled in the service layer)

  logger.info({ from, to }, 'Status transition validated');

  return updateData;
}

/**
 * Check if conversation can be transitioned to a specific status
 */
export function canTransitionTo(
  currentStatus: ConversationStatus,
  targetStatus: ConversationStatus,
  hasEscalation?: boolean
): { allowed: boolean; reason?: string } {
  if (!isValidTransition(currentStatus, targetStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition from ${currentStatus} to ${targetStatus}`,
    };
  }

  const metadata = getTransitionMetadata(targetStatus);
  if (metadata.requiresEscalation && !hasEscalation) {
    return {
      allowed: false,
      reason: `Status ${targetStatus} requires an escalation record`,
    };
  }

  return { allowed: true };
}
