import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { processIncomingMessage, handleError, getAdapter } from './webhook.service.js';
import {
  resolveTenantFromWebhook,
  verifyWebhookSignature,
  webhookRateLimit,
  checkChannelEnabled,
} from './webhook.middleware.js';
import { WebAdapter } from '../adapters/web/index.js';

/**
 * Handle WhatsApp webhook verification (GET)
 * Meta sends this to verify webhook URL during setup
 */
export async function handleWhatsAppVerification(
  request: FastifyRequest<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  // Meta sends: hub.mode=subscribe, hub.verify_token=YOUR_TOKEN, hub.challenge=RANDOM_STRING
  if (mode === 'subscribe' && token && challenge) {
    // We need to find which tenant this token belongs to
    // For WhatsApp, we need to check all channel configs
    // This is not ideal, but necessary for webhook verification
    // In practice, you might want to use a separate verification endpoint per tenant

    // For now, we'll need to check all WhatsApp configs
    const configs = await prisma.channelConfig.findMany({
      where: {
        channel: 'WHATSAPP',
      },
      include: {
        tenant: true,
      },
    });

    for (const config of configs) {
      try {
        const { decryptJson } = await import('../utils/crypto.js');
        const credentials = decryptJson<{ webhookVerifyToken?: string }>(
          config.credentials as string
        );

        if (credentials.webhookVerifyToken === token) {
          // Token matches - return challenge (just the challenge string, no JSON)
          logger.info({ tenantId: config.tenantId }, 'WhatsApp webhook verified');
          return reply.type('text/plain').send(challenge);
        }
      } catch {
        // Skip configs with decryption errors
        continue;
      }
    }
  }

  // Invalid verification
  return reply.status(403).send({ error: 'Forbidden' });
}

/**
 * Handle WhatsApp incoming message (POST)
 */
export async function handleWhatsAppWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Resolve tenant from payload
    const tenant = await resolveTenantFromWebhook('WHATSAPP', request);
    if (!tenant) {
      // Return 200 even for unknown tenants (don't reveal existence)
      logger.warn('WhatsApp webhook from unknown phone number ID');
      return reply.status(200).send({ success: true });
    }

    // Verify signature
    const isValid = await verifyWebhookSignature('WHATSAPP', tenant.id, request);
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    // Process message (async for WhatsApp - respond quickly)
    processIncomingMessage(
      'WHATSAPP',
      tenant.id,
      request.body,
      request.headers as Record<string, string>
    )
      .then((result) => {
        logger.debug({ result, tenantId: tenant.id }, 'WhatsApp message processed');
      })
      .catch((error) => {
        logger.error({ error, tenantId: tenant.id }, 'Error processing WhatsApp message');
      });

    // Return 200 immediately (WhatsApp requires fast response)
    return reply.status(200).send({ success: true });
  } catch (error: any) {
    logger.error({ error }, 'Error in WhatsApp webhook handler');
    // Always return 200 for WhatsApp (they'll retry on errors)
    return reply.status(200).send({ success: true });
  }
}

/**
 * Handle Telegram incoming message
 */
export async function handleTelegramWebhook(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    // Resolve tenant from slug
    const tenant = await resolveTenantFromWebhook('TELEGRAM', request);
    if (!tenant) {
      return reply.status(404).send({ success: false, error: 'Tenant not found' });
    }

    // Check if channel is enabled
    const channelStatus = await checkChannelEnabled(tenant.id, 'TELEGRAM');
    if (!channelStatus.exists) {
      return reply.status(404).send({ success: false, error: 'Channel not configured' });
    }
    if (!channelStatus.enabled) {
      return reply.status(503).send({ success: false, error: 'Channel temporarily unavailable' });
    }

    // Check rate limit
    const rateLimit = await webhookRateLimit('TELEGRAM', tenant.id);
    if (!rateLimit.allowed) {
      return reply
        .status(429)
        .header('Retry-After', rateLimit.retryAfter?.toString() || '60')
        .send({ success: false, error: 'Too many requests' });
    }

    // Verify secret token
    const isValid = await verifyWebhookSignature('TELEGRAM', tenant.id, request);
    if (!isValid) {
      return reply.status(401).send({ error: 'Invalid secret token' });
    }

    // Process message
    const result = await processIncomingMessage(
      'TELEGRAM',
      tenant.id,
      request.body,
      request.headers as Record<string, string>
    );

    if (!result.success) {
      logger.error({ result, tenantId: tenant.id }, 'Telegram message processing failed');
      return reply.status(500).send({ success: false, error: 'Internal error' });
    }

    return reply.status(200).send({ success: true });
  } catch (error: any) {
    logger.error({ error }, 'Error in Telegram webhook handler');
    const result = handleError(error, 'TELEGRAM', request.params.tenantSlug);
    return reply.status(500).send(result);
  }
}

/**
 * Handle Web widget message
 */
export async function handleWebMessage(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void> {
  const origin = request.headers.origin;

  try {
    // Resolve tenant from slug
    const tenant = await resolveTenantFromWebhook('WEB', request);
    if (!tenant) {
      return reply.status(404).send({ success: false, error: 'Tenant not found' });
    }

    // Check if channel is enabled
    const channelStatus = await checkChannelEnabled(tenant.id, 'WEB');
    if (!channelStatus.exists) {
      return reply.status(404).send({ success: false, error: 'Channel not configured' });
    }
    if (!channelStatus.enabled) {
      return reply.status(503).send({ success: false, error: 'Channel temporarily unavailable' });
    }

    // Get adapter for origin validation and CORS
    const adapter = (await getAdapter(tenant.id, 'WEB')) as WebAdapter;

    // Verify origin (CORS)
    if (origin) {
      if (!adapter.validateOrigin(origin)) {
        return reply.status(403).send({ success: false, error: 'Invalid origin' });
      }
      // Set CORS headers for valid origin
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
    }

    // Check rate limit
    const rateLimit = await webhookRateLimit('WEB', tenant.id);
    if (!rateLimit.allowed) {
      return reply
        .status(429)
        .header('Retry-After', rateLimit.retryAfter?.toString() || '60')
        .send({ success: false, error: 'Too many requests' });
    }

    // Process message
    const result = await processIncomingMessage(
      'WEB',
      tenant.id,
      request.body,
      request.headers as Record<string, string>
    );

    if (!result.success) {
      return reply.status(400).send({ success: false, error: result.error });
    }

    // Return response (synchronous for web)
    return reply.status(200).send({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error }, 'Error in Web message handler');
    const result = handleError(error, 'WEB', request.params.tenantSlug);
    return reply.status(500).send(result);
  }
}

/**
 * Get Web widget configuration
 */
export async function getWebWidgetConfig(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void> {
  const origin = request.headers.origin;

  try {
    // Resolve tenant from slug
    const tenant = await resolveTenantFromWebhook('WEB', request);
    if (!tenant) {
      return reply.status(404).send({ success: false, error: 'Tenant not found' });
    }

    // Check if channel is enabled
    const channelStatus = await checkChannelEnabled(tenant.id, 'WEB');
    if (!channelStatus.exists) {
      return reply.status(404).send({ success: false, error: 'Channel not configured' });
    }
    if (!channelStatus.enabled) {
      return reply.status(503).send({ success: false, error: 'Channel temporarily unavailable' });
    }

    // Get adapter for origin validation
    const adapter = (await getAdapter(tenant.id, 'WEB')) as WebAdapter;

    // Verify origin and set CORS headers
    if (origin) {
      if (!adapter.validateOrigin(origin)) {
        return reply.status(403).send({ success: false, error: 'Invalid origin' });
      }
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
    }

    // Get full tenant data
    const fullTenant = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: {
        slug: true,
        botName: true,
        welcomeMessage: true,
        settings: true,
      },
    });

    if (!fullTenant) {
      return reply.status(404).send({ success: false, error: 'Tenant not found' });
    }

    // Get widget config from adapter
    const config = adapter.getWidgetConfig({
      slug: fullTenant.slug,
      botName: fullTenant.botName,
      welcomeMessage: fullTenant.welcomeMessage,
      settings: fullTenant.settings as Record<string, unknown> | null,
    });

    return reply.status(200).send({ success: true, data: config });
  } catch (error: any) {
    logger.error({ error }, 'Error getting Web widget config');
    return reply.status(500).send({ success: false, error: 'Internal error' });
  }
}
