import type { Channel } from '@prisma/client';

/**
 * Normalized incoming message (channel-agnostic)
 * This represents a message from any channel in a unified format
 */
export interface NormalizedMessage {
  /** Channel's message ID (unique within that channel) */
  externalId: string;
  /** Channel's user ID (identifies the sender) */
  externalUserId: string;
  /** Channel's conversation/chat ID (if applicable) */
  externalConversationId?: string;
  /** Channel type (from Prisma enum) */
  channel: Channel;
  /** Message text content */
  content: string;
  /** Type of message content */
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
  /** Whether message contains media */
  hasMedia: boolean;
  /** MIME type if media is present */
  mediaType?: string;
  /** URL to download media (if applicable) */
  mediaUrl?: string;
  /** When message was received */
  timestamp: Date;
  /** Additional channel-specific metadata */
  metadata?: Record<string, unknown>;

  // Sender info (if available from channel)
  /** Sender's display name */
  senderName?: string;
  /** Sender's phone number (WhatsApp) */
  senderPhone?: string;
  /** Sender's username (Telegram) */
  senderUsername?: string;
}

/**
 * Parameters for sending messages through adapters
 */
export interface SendMessageParams {
  /** Channel's user ID to send to */
  externalUserId: string;
  /** Channel's conversation/chat ID (if applicable) */
  externalConversationId?: string;
  /** Message text content */
  content: string;
  /** Type of content being sent */
  contentType?: 'text' | 'image' | 'document';
  /** URL to media file (if sending media) */
  mediaUrl?: string;
  /** Interactive buttons (if supported by channel) */
  buttons?: MessageButton[];
  /** Quick reply options (if supported by channel) */
  quickReplies?: string[];
  /** ID of message to reply to (if supported) */
  replyToMessageId?: string;
}

/**
 * Interactive button for messages
 */
export interface MessageButton {
  /** Button identifier */
  id: string;
  /** Button label text */
  text: string;
  /** Optional payload data */
  payload?: string;
}

/**
 * Result of sending a message through an adapter
 */
export interface SendResult {
  /** Whether message was sent successfully */
  success: boolean;
  /** Channel's message ID (if successful) */
  externalMessageId?: string;
  /** Error message (if failed) */
  error?: string;
  /** Timestamp when message was sent */
  timestamp: Date;
}

/**
 * Webhook verification parameters (for WhatsApp, Telegram setup)
 */
export interface WebhookVerifyParams {
  /** Verification mode (e.g., 'subscribe' for WhatsApp) */
  mode?: string;
  /** Verification token */
  token?: string;
  /** Challenge string to echo back */
  challenge?: string;
}

/**
 * Webhook verification result
 */
export interface WebhookVerifyResult {
  /** Whether webhook verification is valid */
  valid: boolean;
  /** Challenge string to return (if required) */
  challenge?: string;
}

/**
 * WhatsApp-specific credentials
 * ⚠️ SECURITY: These contain sensitive access tokens. Never log these values.
 */
export interface WhatsAppCredentials {
  /** WhatsApp Business Phone Number ID */
  phoneNumberId: string;
  /** WhatsApp Cloud API access token */
  accessToken: string;
  /** Webhook verification token (for webhook setup) */
  webhookVerifyToken: string;
  /** WhatsApp Business Account ID (optional) */
  businessAccountId?: string;
}

/**
 * Telegram-specific credentials
 * ⚠️ SECURITY: These contain sensitive bot tokens. Never log these values.
 */
export interface TelegramCredentials {
  /** Telegram Bot API token */
  botToken: string;
  /** Optional webhook secret for additional security */
  webhookSecret?: string;
}

/**
 * Web widget-specific credentials
 */
export interface WebCredentials {
  /** Allowed origins for CORS (for web widget) */
  allowedOrigins: string[];
  /** Rate limit (requests per minute per session) */
  rateLimit?: number;
  /** Session timeout in minutes */
  sessionTimeout?: number;
}

/**
 * Union type for all channel credentials
 * Each channel has its own credential structure
 */
export type ChannelCredentials = WhatsAppCredentials | TelegramCredentials | WebCredentials;

/**
 * Adapter initialization configuration
 */
export interface AdapterConfig {
  /** Tenant ID this adapter belongs to */
  tenantId: string;
  /** Channel type */
  channel: Channel;
  /** Channel-specific credentials (should be decrypted before passing) */
  credentials: ChannelCredentials;
  /** Webhook URL for receiving messages (if applicable) */
  webhookUrl?: string;
  /** Additional channel-specific settings */
  settings?: Record<string, unknown>;
}
