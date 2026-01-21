import * as Sentry from '@sentry/node';
import { env } from '../config/index.js';
import { logger } from './logger.js';

let initialized = false;

/**
 * Initialize Sentry for error tracking.
 * Safe to call multiple times - only initializes once.
 * No-op if SENTRY_DSN is not configured.
 */
export function initSentry(): void {
  if (initialized) {
    return;
  }

  if (!env.SENTRY_DSN) {
    logger.info('Sentry DSN not configured, error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.npm_package_version,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      // Scrub sensitive data from headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['x-api-key'];
        delete event.request.headers['x-admin-session'];
        delete event.request.headers['cookie'];
      }
      return event;
    },
  });

  initialized = true;
  logger.info({ dsn: env.SENTRY_DSN.substring(0, 20) + '...' }, 'Sentry initialized');
}

/**
 * Capture an exception and send to Sentry.
 * No-op if Sentry is not initialized.
 *
 * @param error - The error to capture
 * @param context - Additional context to attach to the error
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureException(error);
  });
}

/**
 * Set the user context for subsequent error reports.
 * No-op if Sentry is not initialized.
 *
 * @param user - User information to attach
 */
export function setUser(user: { id: string; tenantId?: string }): void {
  if (!initialized) {
    return;
  }
  Sentry.setUser(user);
}

/**
 * Clear the user context.
 * No-op if Sentry is not initialized.
 */
export function clearUser(): void {
  if (!initialized) {
    return;
  }
  Sentry.setUser(null);
}

/**
 * Check if Sentry is initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

export { Sentry };
