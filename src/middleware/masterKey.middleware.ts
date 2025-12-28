import { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/index.js';
import crypto from 'node:crypto';

/**
 * Middleware to authenticate master API key for admin operations
 * Uses constant-time comparison to prevent timing attacks
 */
export async function masterKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

  if (!apiKey.startsWith('master_')) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key format',
      },
    });
    return;
  }

  const masterKey = env.MASTER_API_KEY;

  if (!masterKey) {
    // Don't reveal that master key feature exists or is misconfigured
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
    });
    return;
  }

  // Use HMAC to normalize key lengths and prevent timing attacks on length
  const normalizeKey = (key: string): Buffer => {
    return crypto.createHmac('sha256', 'omniscient-master-key-salt').update(key).digest();
  };

  const providedKeyHash = normalizeKey(apiKey);
  const masterKeyHash = normalizeKey(masterKey);

  const isValid = crypto.timingSafeEqual(providedKeyHash, masterKeyHash);

  if (!isValid) {
    reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
    });
    return;
  }

  // Mark request as authenticated with master key
  request.isMasterKey = true;
}
