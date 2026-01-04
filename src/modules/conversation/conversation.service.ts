import { prisma } from '../../lib/prisma.js';
import { CONSTANTS } from '../../config/index.js';
import type { Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prepareStatusTransition, getAllowedTransitions } from './conversation.state-machine.js';
import type {
  CreateConversationInput,
  UpdateConversationInput,
  ListConversationsQuery,
  TransitionConversationStatusInput,
} from './conversation.schema.js';

/**
 * Create a new conversation
 */
export async function createConversation(tenantId: string, input: CreateConversationInput) {
  const { userId, channel, channelConversationId, metadata } = input;

  // Verify user exists and belongs to tenant
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      userId,
      channel,
      channelConversationId,
      status: 'BOT_ACTIVE',
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
    },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 0, // Don't load messages on create
      },
      escalation: false,
    },
  });

  logger.info({ conversationId: conversation.id, tenantId, channel }, 'Conversation created');

  return conversation;
}

/**
 * Get conversation by ID
 */
export async function getConversation(tenantId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      escalation: true,
    },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  return conversation;
}

/**
 * List conversations with filters
 */
export async function listConversations(tenantId: string, query: ListConversationsQuery) {
  const { userId, channel, status, limit, offset } = query;

  const where: any = { tenantId };

  if (userId) {
    where.userId = userId;
  }

  if (channel) {
    where.channel = channel;
  }

  if (status) {
    where.status = status;
  }

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Only get latest message for preview
        },
        escalation: {
          select: {
            id: true,
            reason: true,
            resolvedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.conversation.count({ where }),
  ]);

  return {
    conversations,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

/**
 * Update conversation
 */
export async function updateConversation(
  tenantId: string,
  conversationId: string,
  input: UpdateConversationInput
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { escalation: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const updateData: any = {};

  // Handle status transition if provided
  if (input.status && input.status !== conversation.status) {
    const transitionData = prepareStatusTransition(
      conversation.status,
      input.status,
      conversation.escalation
    );
    Object.assign(updateData, transitionData);
  }

  // Handle metadata update
  if (input.metadata !== undefined) {
    updateData.metadata = input.metadata as Prisma.InputJsonValue;
  }

  // Always update lastActivityAt on any update
  updateData.lastActivityAt = new Date();

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: updateData,
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

  logger.info({ conversationId, tenantId, status: updated.status }, 'Conversation updated');

  return updated;
}

/**
 * Transition conversation status
 */
export async function transitionConversationStatus(
  tenantId: string,
  conversationId: string,
  input: TransitionConversationStatusInput
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { escalation: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const transitionData = prepareStatusTransition(
    conversation.status,
    input.status,
    conversation.escalation
  );

  // Merge with any provided metadata
  const updateData: any = {
    ...transitionData,
    lastActivityAt: new Date(),
  };

  if (input.metadata) {
    updateData.metadata = {
      ...((conversation.metadata as Record<string, unknown>) || {}),
      ...input.metadata,
    };
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: updateData,
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

  logger.info(
    { conversationId, tenantId, from: conversation.status, to: input.status },
    'Conversation status transitioned'
  );

  return updated;
}

/**
 * Get conversation history (messages)
 */
export async function getConversationHistory(
  tenantId: string,
  conversationId: string,
  limit?: number
) {
  // Verify conversation belongs to tenant
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit ?? CONSTANTS.MAX_CONVERSATION_HISTORY,
  });

  // Return in chronological order
  return messages.reverse();
}

/**
 * Delete conversation (soft delete by closing)
 */
export async function deleteConversation(tenantId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Transition to CLOSED if not already closed
  if (conversation.status !== 'CLOSED') {
    const transitionData = prepareStatusTransition(conversation.status, 'CLOSED');
    await prisma.conversation.update({
      where: { id: conversationId },
      data: transitionData,
    });
  }

  logger.info({ conversationId, tenantId }, 'Conversation closed');

  return { deleted: true, conversationId };
}

/**
 * Get allowed status transitions for a conversation
 */
export async function getAllowedStatusTransitions(tenantId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { escalation: true },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const allowed = getAllowedTransitions(conversation.status);

  return {
    currentStatus: conversation.status,
    allowedTransitions: allowed,
  };
}
