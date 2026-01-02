# Task 01: Adapter Interface and Types

## Overview
Create the foundational interface and types that all channel adapters must implement. This establishes a consistent contract for WhatsApp, Telegram, Web, and future channel integrations.

## Files to Create

```
src/adapters/
├── adapter.interface.ts    # Main interface definition
├── adapter.types.ts        # Shared types and enums
└── index.ts                # Re-exports
```

## Requirements

### 1. adapter.types.ts

Define the following types:

```typescript
// Import Channel enum from Prisma
import { Channel } from '@prisma/client';

// Normalized incoming message (channel-agnostic)
interface NormalizedMessage {
  externalId: string;           // Channel's message ID
  externalUserId: string;       // Channel's user ID
  externalConversationId?: string; // Channel's conversation/chat ID
  channel: Channel;
  content: string;
  contentType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
  hasMedia: boolean;
  mediaType?: string;           // MIME type if media
  mediaUrl?: string;            // URL to download media
  timestamp: Date;
  metadata?: Record<string, unknown>;

  // Sender info (if available from channel)
  senderName?: string;
  senderPhone?: string;         // WhatsApp
  senderUsername?: string;      // Telegram
}

// Parameters for sending messages
interface SendMessageParams {
  externalUserId: string;
  externalConversationId?: string;
  content: string;
  contentType?: 'text' | 'image' | 'document';
  mediaUrl?: string;
  buttons?: MessageButton[];
  quickReplies?: string[];
  replyToMessageId?: string;
}

interface MessageButton {
  id: string;
  text: string;
  payload?: string;
}

// Result of sending a message
interface SendResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
  timestamp: Date;
}

// Webhook verification (for WhatsApp, Telegram setup)
interface WebhookVerifyParams {
  mode?: string;
  token?: string;
  challenge?: string;
}

interface WebhookVerifyResult {
  valid: boolean;
  challenge?: string;
}

// Channel-specific credentials (stored encrypted in DB)
interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  businessAccountId?: string;
}

interface TelegramCredentials {
  botToken: string;
  webhookSecret?: string;
}

interface WebCredentials {
  allowedOrigins: string[];
  rateLimit?: number;           // Requests per minute
  sessionTimeout?: number;      // Minutes
}

type ChannelCredentials = WhatsAppCredentials | TelegramCredentials | WebCredentials;

// Adapter initialization config
interface AdapterConfig {
  tenantId: string;
  channel: Channel;
  credentials: ChannelCredentials;
  webhookUrl?: string;
  settings?: Record<string, unknown>;
}
```

### 2. adapter.interface.ts

```typescript
interface ChannelAdapter {
  readonly channel: Channel;

  // Lifecycle
  initialize(config: AdapterConfig): Promise<void>;
  shutdown?(): Promise<void>;

  // Message handling
  parseIncoming(payload: unknown, headers?: Record<string, string>): Promise<NormalizedMessage | null>;
  sendMessage(params: SendMessageParams): Promise<SendResult>;

  // Webhook verification (optional - not all channels need it)
  verifyWebhook?(params: WebhookVerifyParams): WebhookVerifyResult;

  // Signature verification for security
  verifySignature?(payload: string | Buffer, signature: string): boolean;

  // Health check
  isHealthy?(): Promise<boolean>;
}
```

### 3. index.ts

Re-export all types and interfaces for easy importing.

## Security Considerations

1. **Credential types must NOT be logged** - Ensure types have JSDoc comments warning against logging
2. **Signature verification is critical** - WhatsApp and Telegram both sign payloads; adapters MUST verify
3. **Access tokens are sensitive** - Document that these should be encrypted at rest

## Edge Cases to Handle

1. `parseIncoming` should return `null` for:
   - Status updates (delivery receipts, read receipts)
   - System messages (user joined, etc.)
   - Unsupported message types
   - Malformed payloads

2. `sendMessage` should handle:
   - Empty content (reject with error)
   - Content exceeding channel limits (WhatsApp: 4096 chars, Telegram: 4096 chars)
   - Invalid media URLs

## Acceptance Criteria

- [ ] All types are properly exported
- [ ] JSDoc comments on all interfaces and critical fields
- [ ] No `any` types - use `unknown` where needed
- [ ] Prisma `Channel` enum is used (not duplicated)
- [ ] Types compile without errors
- [ ] Types are importable from `@/adapters`

## Testing Requirements

No runtime tests needed for types, but:
- [ ] `pnpm build` must succeed
- [ ] `pnpm lint` must pass

## Notes for Implementer

- Use `readonly` for properties that shouldn't change after initialization
- Use discriminated unions where appropriate (e.g., credentials by channel type)
- Keep types strict - avoid optional properties unless truly optional
- Consider using branded types for IDs (e.g., `WhatsAppMessageId`, `TelegramChatId`)
