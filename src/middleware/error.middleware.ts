import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  logger.error(
    {
      err: error,
      url: request.url,
      method: request.method,
    },
    'Request error'
  );

  // Zod validation error
  if (error instanceof ZodError) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    } satisfies ApiError);
    return;
  }

  // Fastify validation error
  if (error.validation) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      },
    } satisfies ApiError);
    return;
  }

  // Rate limit error
  if (error.statusCode === 429) {
    reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      },
    } satisfies ApiError);
    return;
  }

  // Known HTTP errors
  if (error.statusCode && error.statusCode < 500) {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code || 'CLIENT_ERROR',
        message: error.message,
      },
    } satisfies ApiError);
    return;
  }

  // Internal server error
  reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  } satisfies ApiError);
}
