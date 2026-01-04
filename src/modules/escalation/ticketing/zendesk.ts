import { logger } from '../../../lib/logger.js';
import type { ExternalTicket } from '../escalation.types.js';

interface CreateZendeskTicketParams {
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
}

/**
 * Create Zendesk ticket (stub implementation)
 * TODO: Phase 3 - Implement actual Zendesk API integration
 */
export async function createZendeskTicket(
  tenantId: string,
  params: CreateZendeskTicketParams
): Promise<ExternalTicket> {
  const { subject, description, priority, metadata } = params;

  logger.info({ tenantId, subject, priority }, 'Creating Zendesk ticket (stub)');

  // TODO: Phase 3 - Implement actual Zendesk API call
  // const config = await getTenantTicketingConfig(tenantId, 'zendesk');
  // const ticket = await zendeskApi.createTicket({ ... });

  // Stub implementation - return mock ticket
  const ticketId = `zd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    ticketId,
    system: 'zendesk',
    url: `https://${tenantId}.zendesk.com/agent/tickets/${ticketId}`,
    metadata: {
      subject,
      description,
      priority,
      ...metadata,
      stub: true, // Mark as stub for testing
    },
  };
}
