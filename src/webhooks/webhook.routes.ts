import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  handleWhatsAppVerification,
  handleWhatsAppWebhook,
  handleTelegramWebhook,
  handleWebMessage,
  getWebWidgetConfig,
} from './webhook.controller.js';
import { resolveTenantFromWebhook } from './webhook.middleware.js';

/**
 * Register webhook routes
 */
export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // Add custom content type parser for WhatsApp (needs raw body for signature verification)
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    // Store raw body for signature verification
    request.rawBody = body as Buffer;
    try {
      const json = JSON.parse((body as Buffer).toString('utf8'));
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // WhatsApp routes
  fastify.get('/whatsapp', handleWhatsAppVerification);

  fastify.post('/whatsapp', async (request, reply) => {
    // Signature verification is done in the controller
    return handleWhatsAppWebhook(request, reply);
  });

  // Telegram routes (tenant in URL)
  fastify.post<{ Params: { tenantSlug: string } }>(
    '/telegram/:tenantSlug',
    async (request, reply) => {
      // Secret verification is done in the controller
      return handleTelegramWebhook(request, reply);
    }
  );

  // Web routes (tenant in URL) with CORS preflight support
  fastify.options<{ Params: { tenantSlug: string } }>(
    '/web/:tenantSlug',
    async (request, reply) => {
      return handleCorsPreflightWeb(request, reply);
    }
  );

  fastify.post<{ Params: { tenantSlug: string } }>('/web/:tenantSlug', async (request, reply) => {
    return handleWebMessage(request, reply);
  });

  fastify.options<{ Params: { tenantSlug: string } }>(
    '/web/:tenantSlug/config',
    async (request, reply) => {
      return handleCorsPreflightWeb(request, reply);
    }
  );

  fastify.get<{ Params: { tenantSlug: string } }>(
    '/web/:tenantSlug/config',
    async (request, reply) => {
      return getWebWidgetConfig(request, reply);
    }
  );
}

/**
 * Handle CORS preflight for web routes
 */
async function handleCorsPreflightWeb(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void> {
  const origin = request.headers.origin;

  if (!origin) {
    return reply.status(400).send();
  }

  // Resolve tenant to validate origin
  const tenant = await resolveTenantFromWebhook('WEB', request);
  if (!tenant) {
    return reply.status(404).send();
  }

  try {
    const { getAdapter } = await import('./webhook.service.js');
    const adapter = await getAdapter(tenant.id, 'WEB');

    if (adapter.validateOrigin && !adapter.validateOrigin(origin)) {
      return reply.status(403).send();
    }

    // Set CORS headers for preflight
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Credentials', 'true');
    reply.header('Access-Control-Max-Age', '86400'); // 24 hours

    return reply.status(204).send();
  } catch {
    return reply.status(500).send();
  }
}
