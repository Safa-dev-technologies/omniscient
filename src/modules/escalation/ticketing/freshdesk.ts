import { logger } from '../../../lib/logger.js';
import type { ExternalTicket } from '../escalation.types.js';

interface CreateFreshdeskTicketParams {
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
}

/**
 * Create Freshdesk ticket (stub implementation)
 * TODO: Phase 3 - Implement actual Freshdesk API integration
 */
export async function createFreshdeskTicket(
  tenantId: string,
  params: CreateFreshdeskTicketParams
): Promise<ExternalTicket> {
  const { subject, description, priority, metadata } = params;

  logger.info({ tenantId, subject, priority }, 'Creating Freshdesk ticket (stub)');

  // TODO: Phase 3 - Implement actual Freshdesk API call
  // const config = await getTenantTicketingConfig(tenantId, 'freshdesk');
  // const ticket = await freshdeskApi.createTicket({ ... });

  // Stub implementation - return mock ticket
  const ticketId = `fd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    ticketId,
    system: 'freshdesk',
    url: `https://${tenantId}.freshdesk.com/a/tickets/${ticketId}`,
    metadata: {
      subject,
      description,
      priority,
      ...metadata,
      stub: true, // Mark as stub for testing
    },
  };
}
