/**
 * Channel Adapters
 *
 * This module exports the foundational types and interfaces for all channel adapters.
 * Adapters provide a unified interface for handling messages across different channels
 * (WhatsApp, Telegram, Web, etc.).
 */

export type {
  NormalizedMessage,
  SendMessageParams,
  MessageButton,
  SendResult,
  WebhookVerifyParams,
  WebhookVerifyResult,
  WhatsAppCredentials,
  TelegramCredentials,
  WebCredentials,
  ChannelCredentials,
  AdapterConfig,
} from './adapter.types.js';

export type { ChannelAdapter } from './adapter.interface.js';
