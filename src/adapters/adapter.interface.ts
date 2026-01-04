import type { Channel } from '@prisma/client';
import type {
  AdapterConfig,
  NormalizedMessage,
  SendMessageParams,
  SendResult,
  WebhookVerifyParams,
  WebhookVerifyResult,
} from './adapter.types.js';

/**
 * Channel Adapter Interface
 *
 * All channel adapters (WhatsApp, Telegram, Web, etc.) must implement this interface.
 * This provides a consistent contract for message handling across all channels.
 *
 * @example
 * ```typescript
 * class WhatsAppAdapter implements ChannelAdapter {
 *   readonly channel = 'WHATSAPP';
 *   // ... implement all required methods
 * }
 * ```
 */
export interface ChannelAdapter {
  /** Channel type this adapter handles (readonly after initialization) */
  readonly channel: Channel;

  /**
   * Initialize the adapter with configuration
   * Called once when adapter is created/configured
   *
   * @param config - Adapter configuration including credentials
   * @throws Error if initialization fails (invalid credentials, etc.)
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Shutdown the adapter gracefully
   * Optional - called when adapter is being removed or app is shutting down
   * Use for cleanup: close connections, cancel webhooks, etc.
   */
  shutdown?(): Promise<void>;

  /**
   * Parse incoming webhook payload into normalized message format
   *
   * Returns `null` for:
   * - Status updates (delivery receipts, read receipts)
   * - System messages (user joined, etc.)
   * - Unsupported message types
   * - Malformed payloads
   *
   * @param payload - Raw webhook payload (JSON object, string, or Buffer)
   * @param headers - HTTP headers from webhook request (for signature verification)
   * @returns Normalized message or null if message should be ignored
   * @throws Error if payload is invalid and cannot be parsed
   */
  parseIncoming(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedMessage | null>;

  /**
   * Send a message through the channel
   *
   * Handles:
   * - Empty content (should reject with error)
   * - Content exceeding channel limits (WhatsApp: 4096 chars, Telegram: 4096 chars)
   * - Invalid media URLs
   *
   * @param params - Message parameters
   * @returns Result indicating success/failure
   * @throws Error if message cannot be sent (network error, invalid params, etc.)
   */
  sendMessage(params: SendMessageParams): Promise<SendResult>;

  /**
   * Verify webhook during initial setup
   * Optional - not all channels require webhook verification
   *
   * Used by WhatsApp and Telegram during webhook configuration.
   * The platform sends a verification request that must be validated.
   *
   * @param params - Verification parameters from webhook request
   * @returns Verification result with challenge (if required)
   */
  verifyWebhook?(params: WebhookVerifyParams): WebhookVerifyResult;

  /**
   * Verify webhook signature for security
   * Optional - but strongly recommended for production
   *
   * ⚠️ SECURITY: Must use timing-safe comparison to prevent timing attacks.
   * Both WhatsApp and Telegram sign their webhook payloads.
   *
   * @param payload - Raw payload (string or Buffer)
   * @param signature - Signature from request headers
   * @returns true if signature is valid, false otherwise
   */
  verifySignature?(payload: string | Buffer, signature: string): boolean;

  /**
   * Health check for the adapter
   * Optional - used to verify adapter is functioning correctly
   *
   * @returns true if adapter is healthy, false otherwise
   */
  isHealthy?(): Promise<boolean>;

  /**
   * Validate origin for CORS/security checks
   * Optional - used by Web adapter to validate allowed origins
   *
   * @param origin - Origin string from request headers
   * @returns true if origin is allowed, false otherwise
   */
  validateOrigin?(origin: string): boolean;
}
