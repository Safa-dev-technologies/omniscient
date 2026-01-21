/**
 * Zero-downtime API key rotation utility
 *
 * Supports PRIMARY and SECONDARY keys for seamless rotation:
 * 1. Create new key in provider dashboard
 * 2. Set it as SECONDARY_KEY in environment
 * 3. Redeploy - app now tries PRIMARY, falls back to SECONDARY
 * 4. Promote SECONDARY → PRIMARY (swap env vars)
 * 5. Delete old key from provider dashboard
 *
 * No downtime, no race conditions.
 */

import { logger } from '../lib/logger.js';

export interface KeyPair {
  primary: string;
  secondary?: string;
}

export interface KeyRotationConfig {
  serviceName: string;
  keys: KeyPair;
  /** Whether to log key rotation events (default: true) */
  logRotation?: boolean;
}

/**
 * Track which key is currently active for each service
 * This helps with logging and debugging
 */
const activeKeys = new Map<string, 'primary' | 'secondary'>();

/**
 * Check if an error is an authentication/authorization error
 * These are the errors that trigger fallback to secondary key
 */
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Common auth error patterns across providers
    return (
      message.includes('invalid api key') ||
      message.includes('invalid_api_key') ||
      message.includes('unauthorized') ||
      message.includes('authentication') ||
      message.includes('api key') ||
      message.includes('apikey') ||
      message.includes('forbidden') ||
      message.includes('access denied') ||
      message.includes('invalid credentials') ||
      message.includes('expired') ||
      name.includes('authenticationerror') ||
      name.includes('authorizationerror')
    );
  }
  return false;
}

/**
 * Execute a function with automatic key rotation fallback
 *
 * @param config - Key rotation configuration
 * @param fn - Function that takes an API key and returns a promise
 * @returns The result of the function
 * @throws The last error if both keys fail
 */
export async function withKeyRotation<T>(
  config: KeyRotationConfig,
  fn: (apiKey: string) => Promise<T>
): Promise<T> {
  const { serviceName, keys, logRotation = true } = config;

  // Try primary key first
  try {
    const result = await fn(keys.primary);
    // Mark primary as active if it wasn't already
    if (activeKeys.get(serviceName) !== 'primary') {
      activeKeys.set(serviceName, 'primary');
      if (logRotation) {
        logger.info({ service: serviceName }, 'Using primary API key');
      }
    }
    return result;
  } catch (primaryError) {
    // Only fall back to secondary if:
    // 1. There is a secondary key
    // 2. The error is an auth error (not a rate limit, network error, etc.)
    if (!keys.secondary) {
      throw primaryError;
    }

    if (!isAuthError(primaryError)) {
      // Not an auth error - don't try secondary key
      throw primaryError;
    }

    if (logRotation) {
      logger.warn(
        {
          service: serviceName,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
        'Primary API key failed, trying secondary key'
      );
    }

    // Try secondary key
    try {
      const result = await fn(keys.secondary);
      activeKeys.set(serviceName, 'secondary');
      if (logRotation) {
        logger.info(
          { service: serviceName },
          'Secondary API key succeeded - consider promoting it to primary'
        );
      }
      return result;
    } catch (secondaryError) {
      if (logRotation) {
        logger.error(
          {
            service: serviceName,
            primaryError:
              primaryError instanceof Error ? primaryError.message : String(primaryError),
            secondaryError:
              secondaryError instanceof Error ? secondaryError.message : String(secondaryError),
          },
          'Both primary and secondary API keys failed'
        );
      }
      // Throw the secondary error as it's more recent
      throw secondaryError;
    }
  }
}

/**
 * Get the currently active key for a service
 */
export function getActiveKey(serviceName: string): 'primary' | 'secondary' | undefined {
  return activeKeys.get(serviceName);
}

/**
 * Create a key pair from environment variables
 * Handles undefined secondary keys gracefully
 */
export function createKeyPair(primary: string, secondary?: string): KeyPair {
  return {
    primary,
    secondary: secondary && secondary.length > 0 ? secondary : undefined,
  };
}

/**
 * Validate that at least the primary key is provided
 */
export function validateKeyPair(serviceName: string, keys: KeyPair): void {
  if (!keys.primary || keys.primary.length === 0) {
    throw new Error(`${serviceName}: Primary API key is required`);
  }
}
