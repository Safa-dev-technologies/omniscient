import { prisma } from '../../lib/prisma.js';
import { CONSTANTS } from '../../config/index.js';
import type { Channel } from '@prisma/client';

interface CreateConversationParams {
  tenantId: string;
  userId: string;
  channel: Channel;
  metadata?: Record<string, unknown>;
}

export async function createConversation(params: CreateConversationParams) {
  const { tenantId, userId, channel, metadata } = params;

  return prisma.conversation.create({
    data: {
      tenantId,
      userId,
      channel,
      status: 'BOT_ACTIVE',
      metadata: metadata ? (metadata as any) : undefined,
    },
  });
}

export async function getConversationHistory(conversationId: string, limit?: number) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit ?? CONSTANTS.MAX_CONVERSATION_HISTORY,
  });

  // Return in chronological order
  return messages.reverse();
}
