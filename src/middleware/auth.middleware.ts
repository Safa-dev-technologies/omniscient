import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashApiKey } from '../utils/hash.js';
import { logger } from '../lib/logger.js';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header',
      },
    });
    return;
  }

  const apiKey = authHeader.substring(7); // Remove 'Bearer '

  if (!apiKey.startsWith('omni_')) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key format',
      },
    });
    return;
  }

  const keyHash = hashApiKey(apiKey);

  try {
    const apiKeyRecord = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        tenant: true,
      },
    });

    if (!apiKeyRecord) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
      return;
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
      reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key has expired',
        },
      });
      return;
    }

    if (apiKeyRecord.tenant.status !== 'ACTIVE') {
      reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Tenant account is not active',
        },
      });
      return;
    }

    // Attach tenant and apiKey to request
    request.tenant = {
      id: apiKeyRecord.tenant.id,
      slug: apiKeyRecord.tenant.slug,
      name: apiKeyRecord.tenant.name,
      botName: apiKeyRecord.tenant.botName,
      systemPrompt: apiKeyRecord.tenant.systemPrompt,
      welcomeMessage: apiKeyRecord.tenant.welcomeMessage,
      fallbackMessage: apiKeyRecord.tenant.fallbackMessage,
      settings: apiKeyRecord.tenant.settings as Record<string, unknown> | null,
    };

    request.apiKey = {
      id: apiKeyRecord.id,
      permissions: apiKeyRecord.permissions as Record<string, boolean>,
    };

    // Update lastUsedAt asynchronously (fire and forget)
    prisma.apiKey
      .update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) => logger.error(err, 'Failed to update API key lastUsedAt'));
  } catch (error) {
    logger.error(error, 'Auth middleware error');
    reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication failed',
      },
    });
  }
}
