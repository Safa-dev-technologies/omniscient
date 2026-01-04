import { logger } from '../../../lib/logger.js';
import type { ExternalTicket } from '../escalation.types.js';
import { createZendeskTicket } from './zendesk.js';
import { createFreshdeskTicket } from './freshdesk.js';

export interface CreateTicketParams {
  escalationId: string;
  system: 'zendesk' | 'freshdesk';
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
}

/**
 * Create external ticket for escalation
 * This is a stub implementation that will be enhanced in Phase 3
 */
export async function createExternalTicket(
  tenantId: string,
  params: CreateTicketParams
): Promise<ExternalTicket> {
  const { system, subject, description, priority, metadata } = params;

  logger.info({ tenantId, system, subject }, 'Creating external ticket (stub)');

  // TODO: Phase 3 - Get actual ticketing system config from tenant settings
  // For now, return a stub ticket

  switch (system) {
    case 'zendesk':
      return createZendeskTicket(tenantId, {
        subject,
        description,
        priority,
        metadata,
      });

    case 'freshdesk':
      return createFreshdeskTicket(tenantId, {
        subject,
        description,
        priority,
        metadata,
      });

    default:
      throw new Error(`Unsupported ticketing system: ${system}`);
  }
}
