import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Channel, Tenant } from '@prisma/client';
import { getAdapter } from './webhook.service.js';
import type { WhatsAppWebhookPayload } from '../adapters/whatsapp/whatsapp.types.js';

/**
 * Extended FastifyRequest with rawBody for signature verification
 */
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Resolve tenant from webhook request
 * Different channels have different tenant resolution strategies:
 * - WhatsApp: Phone number ID in payload → lookup ChannelConfig
 * - Telegram: Tenant slug in URL path
 * - Web: Tenant slug in URL path
 */
export async function resolveTenantFromWebhook(
  channel: Channel,
  request: FastifyRequest
): Promise<Tenant | null> {
  try {
    switch (channel) {
      case 'WHATSAPP': {
        // WhatsApp: Resolve tenant from phone number ID in payload
        const payload = request.body as WhatsAppWebhookPayload | undefined;
        if (!payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id) {
          return null;
        }

        const phoneNumberId = payload.entry[0].changes[0].value.metadata.phone_number_id;

        // Find channel config by phone number ID in credentials
        // Note: We need to check all WhatsApp configs (could be optimized with indexing)
        const configs = await prisma.channelConfig.findMany({
          where: {
            channel: 'WHATSAPP',
            enabled: true,
          },
          include: {
            tenant: true,
          },
        });

        // Check each config's credentials (we'd need to decrypt, but for now check a simpler approach)
        // Actually, WhatsApp adapter stores phoneNumberId in credentials, but we don't want to decrypt all
        // For now, we'll need to decrypt and check - this is not ideal but necessary
        for (const config of configs) {
          try {
            const { decryptJson } = await import('../utils/crypto.js');
            const credentials = decryptJson<{ phoneNumberId?: string }>(
              config.credentials as string
            );

            if (credentials.phoneNumberId === phoneNumberId) {
              return config.tenant;
            }
          } catch {
            // Skip configs with decryption errors
            continue;
          }
        }

        return null;
      }

      case 'TELEGRAM':
      case 'WEB': {
        // Telegram/Web: Resolve tenant from slug in URL path
        const params = request.params as { tenantSlug?: string };
        const tenantSlug = params.tenantSlug;

        if (!tenantSlug) {
          return null;
        }

        const tenant = await prisma.tenant.findUnique({
          where: { slug: tenantSlug.toLowerCase() },
        });

        return tenant;
      }

      default:
        return null;
    }
  } catch (error) {
    logger.error({ error, channel }, 'Error resolving tenant from webhook');
    return null;
  }
}

/**
 * Verify webhook signature/secret
 * Must be done BEFORE parsing body for WhatsApp
 */
export async function verifyWebhookSignature(
  channel: Channel,
  tenantId: string,
  request: FastifyRequest
): Promise<boolean> {
  try {
    const adapter = await getAdapter(tenantId, channel);

    if (channel === 'WHATSAPP') {
      const signature = request.headers['x-hub-signature-256'] as string;
      if (!signature) {
        return false;
      }

      const rawBody = request.rawBody;
      if (!rawBody) {
        return false;
      }

      return adapter.verifySignature?.(rawBody.toString('utf8'), signature) ?? false;
    }

    if (channel === 'TELEGRAM') {
      const secretToken = request.headers['x-telegram-bot-api-secret-token'] as string;
      if (!secretToken) {
        // If no secret token header, skip verification (not configured)
        return true;
      }

      // Get channel config to retrieve webhook secret
      const config = await prisma.channelConfig.findUnique({
        where: {
          tenantId_channel: {
            tenantId,
            channel: 'TELEGRAM',
          },
        },
      });

      if (!config?.webhookSecret) {
        return false;
      }

      // Use crypto timing-safe comparison
      const crypto = await import('node:crypto');
      if (secretToken.length !== config.webhookSecret.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(secretToken, 'utf8'),
        Buffer.from(config.webhookSecret, 'utf8')
      );
    }

    // Web doesn't require signature verification (we control both ends)
    if (channel === 'WEB') {
      return true;
    }

    return false;
  } catch (error) {
    logger.error({ error, channel, tenantId }, 'Error verifying webhook signature');
    return false;
  }
}

/**
 * Rate limit webhook requests
 * Per-channel, per-tenant limits
 */
export async function webhookRateLimit(
  channel: Channel,
  tenantId: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const { redis } = await import('../lib/redis.js');

  // Rate limit config per channel (requests per minute)
  const limits: Record<Channel, number> = {
    WHATSAPP: 100,
    TELEGRAM: 100,
    WEB: 60,
    SLACK: 100,
    EMAIL: 50,
    SMS: 50,
  };

  const limit = limits[channel] || 60;
  const windowSeconds = 60;
  const key = `ratelimit:webhook:${tenantId}:${channel}`;

  try {
    // Increment counter
    const count = await redis.incr(key);

    // Set expiry on first request in window
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    if (count > limit) {
      // Get TTL to calculate retry-after
      const ttl = await redis.ttl(key);
      return {
        allowed: false,
        retryAfter: ttl > 0 ? ttl : windowSeconds,
      };
    }

    return { allowed: true };
  } catch (error) {
    // If Redis fails, allow request (fail open for availability)
    logger.warn({ error, channel, tenantId }, 'Rate limit check failed, allowing request');
    return { allowed: true };
  }
}

/**
 * Check if channel is enabled for tenant
 * Returns the config if enabled, null if not found, throws if disabled
 */
export async function checkChannelEnabled(
  tenantId: string,
  channel: Channel
): Promise<{ enabled: boolean; exists: boolean }> {
  const config = await prisma.channelConfig.findUnique({
    where: {
      tenantId_channel: {
        tenantId,
        channel,
      },
    },
    select: {
      enabled: true,
    },
  });

  if (!config) {
    return { enabled: false, exists: false };
  }

  return { enabled: config.enabled, exists: true };
}
