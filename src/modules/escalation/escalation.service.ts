import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { evaluateEscalation } from '../bot/bot.escalation.js';
import type { EscalationReason } from '@prisma/client';
import type {
  CreateEscalationInput,
  UpdateEscalationInput,
  ResolveEscalationInput,
  ListEscalationsQuery,
  CreateExternalTicketInput,
} from './escalation.schema.js';
import type { EscalationContext, EscalationTrigger } from './escalation.types.js';
import { createExternalTicket } from './ticketing/index.js';

/**
 * Detect if escalation should be triggered based on context
 */
export function detectEscalation(context: EscalationContext): EscalationTrigger {
  const { userMessage, confidenceScore, conversationLength, hasMedia, repeatedQuestions } = context;

  // Check for media (always escalate)
  if (hasMedia) {
    return {
      shouldEscalate: true,
      reason: 'MEDIA_RECEIVED',
      confidence: 1.0,
      details: 'Media attachment detected',
    };
  }

  // Evaluate using bot escalation logic
  const evaluation = evaluateEscalation({
    userMessage,
    confidence: confidenceScore ?? 1.0,
    historyLength: conversationLength,
  });

  if (evaluation.shouldEscalate) {
    return {
      shouldEscalate: true,
      reason: (evaluation.reason as EscalationReason) || 'USER_REQUEST',
      confidence: 0.9,
      details: evaluation.reason,
    };
  }

  // Check for repeated questions
  if (repeatedQuestions >= 3) {
    return {
      shouldEscalate: true,
      reason: 'REPEATED_QUESTION',
      confidence: 0.8,
      details: `User asked similar question ${repeatedQuestions} times`,
    };
  }

  return {
    shouldEscalate: false,
    reason: 'USER_REQUEST', // Default, won't be used if shouldEscalate is false
    confidence: 0.0,
  };
}

/**
 * Create escalation for a conversation
 */
export async function createEscalation(
  tenantId: string,
  input: CreateEscalationInput
): Promise<{ escalation: any; conversation: any }> {
  const {
    conversationId,
    reason,
    reasonDetails,
    externalTicketId,
    externalSystem,
    agentId,
    agentName,
  } = input;

  return await prisma.$transaction(async (tx) => {
    // Verify conversation exists and belongs to tenant
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { escalation: true },
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Check if escalation already exists
    if (conversation.escalation) {
      throw new Error('Conversation already has an escalation');
    }

    // Transition conversation to ESCALATED status
    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ESCALATED',
        escalatedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    // Create escalation record
    const escalation = await tx.escalation.create({
      data: {
        conversationId,
        reason,
        reasonDetails,
        externalTicketId,
        externalSystem,
        agentId,
        agentName,
      },
    });

    logger.info(
      { escalationId: escalation.id, conversationId, reason, tenantId },
      'Escalation created'
    );

    // Get updated conversation with relations
    const updatedConversation = await tx.conversation.findFirst({
      where: { id: conversationId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 0,
        },
        escalation: true,
      },
    });

    return {
      escalation: {
        ...escalation,
        conversation: updatedConversation,
      },
      conversation: updatedConversation,
    };
  });
}

/**
 * Auto-escalate conversation based on context
 */
export async function autoEscalate(
  tenantId: string,
  conversationId: string,
  context: EscalationContext
): Promise<{ escalated: boolean; escalation?: any; trigger?: EscalationTrigger }> {
  const trigger = detectEscalation(context);

  if (!trigger.shouldEscalate) {
    return { escalated: false };
  }

  try {
    const result = await createEscalation(tenantId, {
      conversationId,
      reason: trigger.reason,
      reasonDetails: trigger.details,
    });

    logger.info(
      { conversationId, reason: trigger.reason, confidence: trigger.confidence },
      'Conversation auto-escalated'
    );

    return {
      escalated: true,
      escalation: result.escalation,
      trigger,
    };
  } catch (error: any) {
    // If escalation already exists, return existing
    if (error.message.includes('already has an escalation')) {
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        include: { escalation: true },
      });

      return {
        escalated: true,
        escalation: conversation?.escalation,
        trigger,
      };
    }
    throw error;
  }
}

/**
 * Get escalation by ID
 */
export async function getEscalation(tenantId: string, escalationId: string) {
  const escalation = await prisma.escalation.findFirst({
    where: {
      id: escalationId,
      conversation: {
        tenantId,
      },
    },
    include: {
      conversation: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      },
    },
  });

  if (!escalation) {
    throw new Error('Escalation not found');
  }

  return escalation;
}

/**
 * List escalations with filters
 */
export async function listEscalations(tenantId: string, query: ListEscalationsQuery) {
  const { conversationId, reason, resolved, externalSystem, limit, offset } = query;

  const where: any = {
    conversation: {
      tenantId,
    },
  };

  if (conversationId) {
    where.conversationId = conversationId;
  }

  if (reason) {
    where.reason = reason;
  }

  if (resolved !== undefined) {
    where.resolvedAt = resolved ? { not: null } : null;
  }

  if (externalSystem) {
    where.externalSystem = externalSystem;
  }

  const [escalations, total] = await Promise.all([
    prisma.escalation.findMany({
      where,
      include: {
        conversation: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.escalation.count({ where }),
  ]);

  return {
    escalations,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

/**
 * Update escalation
 */
export async function updateEscalation(
  tenantId: string,
  escalationId: string,
  input: UpdateEscalationInput
) {
  // Verify escalation belongs to tenant
  await getEscalation(tenantId, escalationId);

  const updated = await prisma.escalation.update({
    where: { id: escalationId },
    data: input,
    include: {
      conversation: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  logger.info({ escalationId, tenantId }, 'Escalation updated');

  return updated;
}

/**
 * Resolve escalation
 */
export async function resolveEscalation(
  tenantId: string,
  escalationId: string,
  input: ResolveEscalationInput
) {
  const { resolutionNotes, returnedToBot, agentId, agentName } = input;

  return await prisma.$transaction(async (tx) => {
    // Verify escalation belongs to tenant
    const escalation = await tx.escalation.findFirst({
      where: {
        id: escalationId,
        conversation: {
          tenantId,
        },
      },
      include: {
        conversation: true,
      },
    });

    if (!escalation) {
      throw new Error('Escalation not found');
    }

    if (escalation.resolvedAt) {
      throw new Error('Escalation already resolved');
    }

    const updateData: any = {
      resolvedAt: new Date(),
      resolutionNotes,
      returnedToBot,
    };

    if (agentId) {
      updateData.agentId = agentId;
    }

    if (agentName) {
      updateData.agentName = agentName;
    }

    await tx.escalation.update({
      where: { id: escalationId },
      data: updateData,
    });

    // Determine target status based on returnedToBot flag
    const targetStatus = returnedToBot ? 'BOT_ACTIVE' : 'RESOLVED';
    const timestampField = returnedToBot ? undefined : 'resolvedAt';

    // Update conversation status
    const conversationUpdateData: any = {
      status: targetStatus,
      lastActivityAt: new Date(),
    };

    if (timestampField) {
      conversationUpdateData[timestampField] = new Date();
    }

    await tx.conversation.update({
      where: { id: escalation.conversationId },
      data: conversationUpdateData,
    });

    logger.info({ escalationId, tenantId, returnedToBot }, 'Escalation resolved');

    // Get updated escalation with relations
    const updatedWithRelations = await tx.escalation.findFirst({
      where: { id: escalationId },
      include: {
        conversation: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return updatedWithRelations!;
  });
}

/**
 * Create external ticket for escalation
 */
export async function createEscalationTicket(
  tenantId: string,
  escalationId: string,
  input: CreateExternalTicketInput
) {
  // Verify escalation belongs to tenant
  await getEscalation(tenantId, escalationId);

  // Create ticket in external system
  const ticket = await createExternalTicket(tenantId, {
    escalationId,
    system: input.system,
    subject: input.subject,
    description: input.description,
    priority: input.priority,
    metadata: input.metadata,
  });

  // Update escalation with external ticket info
  const updated = await prisma.escalation.update({
    where: { id: escalationId },
    data: {
      externalTicketId: ticket.ticketId,
      externalSystem: input.system,
    },
    include: {
      conversation: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  logger.info(
    { escalationId, tenantId, ticketId: ticket.ticketId, system: input.system },
    'External ticket created for escalation'
  );

  return {
    escalation: updated,
    ticket,
  };
}
