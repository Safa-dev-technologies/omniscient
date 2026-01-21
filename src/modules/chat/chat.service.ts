import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { botEngine } from '../bot/bot.engine.js';
import * as conversationService from '../conversation/conversation.service.js';
import { logger } from '../../lib/logger.js';
import { getUserRateLimiter, RateLimitExceededError } from '../../lib/rate-limit/index.js';
import type { UserRateLimitConfig } from '../../lib/rate-limit/index.js';
import type { ChatResponse } from './chat.types.js';
import type { Channel, EscalationReason } from '@prisma/client';

interface ProcessChatParams {
  tenantId: string;
  tenant: {
    id: string;
    botName: string;
    systemPrompt: string | null;
    fallbackMessage: string | null;
  };
  message: string;
  sessionId?: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

interface SendMessageParams {
  tenantId: string;
  tenant: {
    id: string;
    botName: string;
    systemPrompt: string | null;
    fallbackMessage: string | null;
  };
  conversationId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export async function processChat(params: ProcessChatParams): Promise<ChatResponse> {
  const { tenantId, tenant, message, sessionId, channel, metadata } = params;

  // Find or create user based on sessionId
  let user = sessionId
    ? await prisma.user.findFirst({
        where: { tenantId, webSessionId: sessionId },
      })
    : null;

  if (!user) {
    user = await prisma.user.create({
      data: {
        tenantId,
        webSessionId: sessionId || crypto.randomUUID(),
      },
    });
  }

  // Rate limit check - after user is identified
  const rateLimiter = getUserRateLimiter(redis);
  const tenantSettings = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const tenantLimits = (tenantSettings?.settings as Record<string, unknown>)?.rateLimits as
    | { chat?: UserRateLimitConfig }
    | undefined;
  const rateLimitResult = await rateLimiter.checkAndRecord(tenantId, user.id, tenantLimits?.chat);

  if (!rateLimitResult.allowed) {
    throw new RateLimitExceededError({
      retryAfter: rateLimitResult.retryAfter!,
      limitType: rateLimitResult.limitType!,
      userId: user.id,
    });
  }

  // Find active conversation or create new one
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      userId: user.id,
      status: { in: ['BOT_ACTIVE', 'HUMAN_ACTIVE'] },
    },
    orderBy: { lastActivityAt: 'desc' },
  });

  if (!conversation) {
    conversation = await conversationService.createConversation(tenantId, {
      userId: user.id,
      channel: channel as Channel,
      metadata,
    });
  }

  // Process message through bot engine
  return processMessage({
    tenantId,
    tenant,
    conversation,
    message,
    metadata,
  });
}

export async function sendMessageToConversation(params: SendMessageParams): Promise<ChatResponse> {
  const { tenantId, tenant, conversationId, message, metadata } = params;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.status === 'CLOSED') {
    throw new Error('Conversation is closed');
  }

  return processMessage({
    tenantId,
    tenant,
    conversation,
    message,
    metadata,
  });
}

async function processMessage(params: {
  tenantId: string;
  tenant: {
    id: string;
    botName: string;
    systemPrompt: string | null;
    fallbackMessage: string | null;
  };
  conversation: { id: string; userId: string; status: string };
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatResponse> {
  const { tenantId, tenant, conversation, message } = params;

  // Save user message
  const userMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: message,
    },
  });

  // If escalated, don't process through bot
  if (conversation.status === 'ESCALATED' || conversation.status === 'HUMAN_ACTIVE') {
    return {
      response: 'Your conversation has been escalated to a human agent.',
      conversationId: conversation.id,
      messageId: userMessage.id,
      confidence: 1,
      sources: [],
      shouldEscalate: false,
    };
  }

  // Get conversation history
  const history = await conversationService.getConversationHistory(tenantId, conversation.id);

  // Generate response using bot engine
  const botResponse = await botEngine.generateResponse({
    tenantId,
    tenant,
    conversationId: conversation.id,
    userMessage: message,
    history: history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
  });

  // Save assistant message
  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: botResponse.response,
      tokensUsed: botResponse.tokensUsed,
      confidenceScore: botResponse.confidence,
      knowledgeSources: botResponse.sources as any, // Cast to Json type
    },
  });

  // Update conversation activity
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastActivityAt: new Date() },
  });

  // Handle escalation if needed
  if (botResponse.shouldEscalate) {
    await escalateConversation(tenantId, conversation.id, botResponse.escalationReason);
  }

  logger.info(
    { conversationId: conversation.id, confidence: botResponse.confidence },
    'Chat response generated'
  );

  return {
    response: botResponse.response,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    confidence: botResponse.confidence,
    sources: botResponse.sources.map((s) => ({
      name: s.sourceName,
      section: s.sectionTitle,
    })),
    shouldEscalate: botResponse.shouldEscalate,
    escalationReason: botResponse.escalationReason,
  };
}

export async function getConversation(tenantId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      escalation: true,
    },
  });
}

export async function escalateConversation(
  tenantId: string,
  conversationId: string,
  reason?: string,
  options?: { notes?: string; priority?: string }
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Build reason details from reason and notes
  const reasonDetails = [reason, options?.notes].filter(Boolean).join('\n\n') || undefined;

  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ESCALATED',
        escalatedAt: new Date(),
      },
    }),
    prisma.escalation.create({
      data: {
        conversationId,
        reason: (reason as EscalationReason) || 'USER_REQUEST',
        reasonDetails,
      },
    }),
  ]);

  logger.info({ conversationId, reason, priority: options?.priority }, 'Conversation escalated');

  return { escalated: true, conversationId, priority: options?.priority };
}

export async function closeConversation(tenantId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });

  logger.info({ conversationId }, 'Conversation closed');
}
