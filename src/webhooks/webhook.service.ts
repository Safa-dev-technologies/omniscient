import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { decryptJson } from '../utils/crypto.js';
import { RateLimitExceededError } from '../lib/rate-limit/index.js';
import type { Channel } from '@prisma/client';
import type { ChannelAdapter } from '../adapters/adapter.interface.js';
import type { AdapterConfig, NormalizedMessage } from '../adapters/adapter.types.js';
import { WhatsAppAdapter } from '../adapters/whatsapp/index.js';
import { TelegramAdapter } from '../adapters/telegram/index.js';
import { WebAdapter } from '../adapters/web/index.js';
import * as chatService from '../modules/chat/chat.service.js';
import { redis } from '../lib/redis.js';

/**
 * Adapter cache - stores initialized adapters per tenant/channel
 * Key format: `${tenantId}:${channel}`
 */
const adapterCache = new Map<string, ChannelAdapter>();

/**
 * Create adapter instance for channel type
 */
function createAdapter(channel: Channel): ChannelAdapter {
  switch (channel) {
    case 'WHATSAPP':
      return new WhatsAppAdapter();
    case 'TELEGRAM':
      return new TelegramAdapter();
    case 'WEB':
      return new WebAdapter();
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

/**
 * Get or create adapter instance for tenant/channel
 * Adapters are cached per tenant to avoid re-initialization
 */
export async function getAdapter(tenantId: string, channel: Channel): Promise<ChannelAdapter> {
  const cacheKey = `${tenantId}:${channel}`;

  // Check cache
  const cached = adapterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Get channel config from database
  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
    include: {
      tenant: true,
    },
  });

  if (!config) {
    throw new Error(`Channel config not found for ${channel}`);
  }

  if (!config.enabled) {
    throw new Error(`Channel ${channel} is disabled for tenant`);
  }

  // Decrypt credentials
  const encryptedCredentials = config.credentials as string;
  const credentials = decryptJson<Record<string, unknown>>(encryptedCredentials);

  // Create and initialize adapter
  const adapter = createAdapter(channel);
  const adapterConfig: AdapterConfig = {
    tenantId,
    channel,
    credentials: credentials as any,
    webhookUrl: config.webhookUrl || undefined,
    settings: (config.settings as Record<string, unknown>) || undefined,
  };

  await adapter.initialize(adapterConfig);

  // Cache adapter
  adapterCache.set(cacheKey, adapter);

  logger.debug({ tenantId, channel }, 'Adapter initialized and cached');

  return adapter;
}

/**
 * Clear adapter cache (useful when config changes)
 */
export function clearAdapterCache(tenantId: string, channel?: Channel): void {
  if (channel) {
    adapterCache.delete(`${tenantId}:${channel}`);
  } else {
    // Clear all adapters for tenant
    for (const key of adapterCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        adapterCache.delete(key);
      }
    }
  }
}

/**
 * Webhook processing result
 */
export interface WebhookResult {
  success: boolean;
  messageId?: string;
  error?: string;
  async?: boolean; // For WhatsApp - must respond quickly
}

/**
 * Check if message was already processed (deduplication)
 */
async function isDuplicateMessage(
  channel: Channel,
  messageId: string,
  tenantId: string
): Promise<boolean> {
  const cacheKey = `webhook:${tenantId}:${channel}:${messageId}`;

  // Check if already processed
  const existing = await redis.get(cacheKey);
  if (existing) {
    return true;
  }

  // Mark as processed (TTL 1 hour)
  await redis.setex(cacheKey, 3600, '1');
  return false;
}

/**
 * Process incoming webhook from any channel
 */
export async function processIncomingMessage(
  channel: Channel,
  tenantId: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<WebhookResult> {
  try {
    // Get adapter
    const adapter = await getAdapter(tenantId, channel);

    // Parse message
    const normalizedMessage = await adapter.parseIncoming(payload, headers);

    // If null, it's a system message (delivery receipt, etc.) - skip
    if (!normalizedMessage) {
      return { success: true };
    }

    // Check for duplicates
    const isDuplicate = await isDuplicateMessage(channel, normalizedMessage.externalId, tenantId);

    if (isDuplicate) {
      logger.debug(
        { messageId: normalizedMessage.externalId, tenantId, channel },
        'Duplicate message detected, skipping'
      );
      return { success: true };
    }

    // Get tenant info
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        botName: true,
        systemPrompt: true,
        fallbackMessage: true,
      },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Map normalized message to chat service params
    const chatParams = {
      tenantId,
      tenant: {
        id: tenant.id,
        botName: tenant.botName,
        systemPrompt: tenant.systemPrompt,
        fallbackMessage: tenant.fallbackMessage,
      },
      message: normalizedMessage.content,
      sessionId: getSessionId(channel, normalizedMessage),
      channel: channel.toLowerCase(),
      metadata: {
        ...normalizedMessage.metadata,
        externalId: normalizedMessage.externalId,
        externalUserId: normalizedMessage.externalUserId,
        externalConversationId: normalizedMessage.externalConversationId,
        senderName: normalizedMessage.senderName,
        senderPhone: normalizedMessage.senderPhone,
        senderUsername: normalizedMessage.senderUsername,
      },
    };

    // Process message through chat service
    const chatResponse = await chatService.processChat(chatParams);

    // Send response via adapter
    if (chatResponse.response && !chatResponse.shouldEscalate) {
      await adapter.sendMessage({
        externalUserId: normalizedMessage.externalUserId,
        externalConversationId: normalizedMessage.externalConversationId,
        content: chatResponse.response,
      });

      return {
        success: true,
        messageId: normalizedMessage.externalId,
      };
    }

    // If escalated, don't send message (human will handle)
    return {
      success: true,
      messageId: normalizedMessage.externalId,
    };
  } catch (error: any) {
    // Handle rate limit errors specially - send user-facing message
    if (error instanceof RateLimitExceededError) {
      logger.info(
        { tenantId, channel, userId: error.userId, retryAfter: error.retryAfter },
        'User rate limited on webhook'
      );

      // Try to send rate limit message to user
      try {
        const adapter = await getAdapter(tenantId, channel);
        const normalizedMessage = await adapter.parseIncoming(payload, headers);

        if (normalizedMessage) {
          await adapter.sendMessage({
            externalUserId: normalizedMessage.externalUserId,
            externalConversationId: normalizedMessage.externalConversationId,
            content: `You're sending messages too quickly. Please wait ${error.retryAfter} seconds before sending another message.`,
          });
        }
      } catch (sendError) {
        logger.warn({ sendError, tenantId, channel }, 'Failed to send rate limit message');
      }

      return {
        success: false,
        error: `Rate limit exceeded. Retry after ${error.retryAfter} seconds.`,
      };
    }

    logger.error({ error, tenantId, channel }, 'Error processing incoming message');
    return {
      success: false,
      error: error.message || 'Internal error',
    };
  }
}

/**
 * Extract session ID from normalized message based on channel
 */
function getSessionId(channel: Channel, message: NormalizedMessage): string | undefined {
  switch (channel) {
    case 'WEB':
      return message.externalUserId; // Web uses session ID as user ID
    case 'WHATSAPP':
      return message.senderPhone; // WhatsApp uses phone number
    case 'TELEGRAM':
      return message.externalUserId; // Telegram uses user ID
    default:
      return undefined;
  }
}

/**
 * Handle error and return appropriate webhook result
 */
export function handleError(error: Error, channel: Channel, tenantId: string): WebhookResult {
  logger.error({ error, channel, tenantId }, 'Webhook error');

  // Never expose internal errors to external services
  return {
    success: false,
    error: 'Internal error processing webhook',
  };
}
